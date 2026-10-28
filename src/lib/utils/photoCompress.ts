// src/lib/utils/photoCompress.ts
// Kompresi foto sisi klien sebelum upload. Diekstrak dari ess/attendance.ts agar
// seluruh modul (ESS Lembur, Reimburse, Petty Cash, Stock Lapangan, Kiosk) memakai
// fungsi yang sama dengan multi-tier fallback yang andal di HP mobile.

import imageCompression from 'browser-image-compression';
import { currentNetworkSpeed, isWeakDevice } from './deviceProfile';
import { isHematActive } from '$lib/stores/hematStore';

export interface CompressPhotoOptions {
	maxSizeMB?: number;
	maxWidthOrHeight?: number;
	initialQuality?: number;
}

/**
 * Fallback resize menggunakan HTML Canvas native di browser bila browser-image-compression
 * gagal (sering terjadi pada mobile browser akibat keterbatasan memori worker saat memuat foto kamera besar).
 */
async function canvasResizeFallback(file: File, maxDim: number, quality: number): Promise<File | null> {
	if (typeof window === 'undefined' || typeof document === 'undefined') return null;
	return new Promise((resolve) => {
		const img = new Image();
		const url = URL.createObjectURL(file);
		img.onload = () => {
			URL.revokeObjectURL(url);
			try {
				let { width, height } = img;
				if (width > maxDim || height > maxDim) {
					if (width > height) {
						height = Math.round((height * maxDim) / width);
						width = maxDim;
					} else {
						width = Math.round((width * maxDim) / height);
						height = maxDim;
					}
				}
				const canvas = document.createElement('canvas');
				canvas.width = width;
				canvas.height = height;
				const ctx = canvas.getContext('2d');
				if (!ctx) return resolve(null);
				ctx.drawImage(img, 0, 0, width, height);
				canvas.toBlob(
					(blob) => {
						if (!blob) return resolve(null);
						const outName = file.name ? file.name.replace(/\.[^.]+$/, '') + '.jpg' : 'photo.jpg';
						resolve(new File([blob], outName, { type: 'image/jpeg' }));
					},
					'image/jpeg',
					quality
				);
			} catch (err) {
				console.warn('[photoCompress] Canvas resize fallback gagal:', err);
				resolve(null);
			}
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			resolve(null);
		};
		img.src = url;
	});
}

/**
 * Kompresi foto sisi klien.
 * Target default ~0.35 MB (350 KB) / max 1200px agar aman di bawah limit default adapter-node (512 KB)
 * dan reverse proxy nginx (1 MB).
 */
export async function compressPhoto(file: File, customOptions?: CompressPhotoOptions): Promise<File> {
	// Jika file bukan gambar atau sudah sangat kecil (<= 150 KB), tidak perlu kompresi ulang
	if (file.type && !file.type.startsWith('image/')) return file;
	if (file.size <= 150 * 1024) return file;

	const lambat = currentNetworkSpeed() === 'slow' || isHematActive() || isWeakDevice();
	const targetMaxSizeMB = customOptions?.maxSizeMB ?? (lambat ? 0.25 : 0.35);
	const targetMaxDim = customOptions?.maxWidthOrHeight ?? (lambat ? 800 : 1200);
	const initialQuality = customOptions?.initialQuality ?? 0.75;

	// 1. Coba browser-image-compression dengan Web Worker
	try {
		const res = await imageCompression(file, {
			maxSizeMB: targetMaxSizeMB,
			maxWidthOrHeight: targetMaxDim,
			useWebWorker: true,
			initialQuality
		});
		if (res && res.size <= 450 * 1024) return res;
		// Jika hasil kompresi masih > 450KB, lanjutkan ke canvas pass kedua
		file = res;
	} catch (workerErr) {
		console.warn('[photoCompress] Worker gagal, mencoba mode non-worker:', workerErr);
		// 2. Coba browser-image-compression tanpa worker (main thread)
		try {
			const res = await imageCompression(file, {
				maxSizeMB: targetMaxSizeMB,
				maxWidthOrHeight: targetMaxDim,
				useWebWorker: false,
				initialQuality
			});
			if (res && res.size <= 450 * 1024) return res;
			file = res;
		} catch (nonWorkerErr) {
			console.warn('[photoCompress] Non-worker gagal, mencoba canvas resize fallback:', nonWorkerErr);
		}
	}

	// 3. Fallback Canvas Resize native
	const canvasResult = await canvasResizeFallback(file, targetMaxDim, initialQuality);
	if (canvasResult) {
		if (canvasResult.size <= 450 * 1024) return canvasResult;
		// Pass kedua jika gambar sangat kompleks dan ukuran masih > 450KB
		const secondPass = await canvasResizeFallback(canvasResult, 960, 0.65);
		if (secondPass && secondPass.size < canvasResult.size) return secondPass;
		return canvasResult;
	}

	// 4. Jika semua kompresi gagal, cek apakah file terlalu besar untuk limit server
	// Batas aman kirim foto adalah ~500 KB agar tidak ditolak 413 Payload Too Large
	if (file.size > 500 * 1024) {
		throw new Error(
			'Ukuran foto terlalu besar dan gagal diperkecil di perangkat ini. Silakan coba foto ulang dengan resolusi standar atau tanpa mode HDR/Ultra.'
		);
	}

	return file;
}
