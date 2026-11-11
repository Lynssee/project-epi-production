// src/lib/utils/p2hPhotoUpload.ts
// PMT-52 (6 Nov 2026): jalur unggah foto P2H tunggal — dipakai form P2H (item & foto unit) dan
// form Tutup Pemakaian (PMT-49). Kebijakan foto (item/jumlah wajib foto) TIDAK diubah di sini.
//
// Urutan: kompres utama (batas 20 dtk) -> kompres DARURAT (800 px, q0,6, batas 8 dtk) -> bila
// keduanya gagal, lempar P2hPhotoCompressFailed (membawa file asli) sehingga UI menawarkan
// "Kirim foto asli (lambat)" — TIDAK lagi otomatis mengirim file mentah 5–15 MB lewat sinyal site.
// Unggah dicoba ulang (backoff 1 dtk, 2 dtk) untuk gangguan jaringan / 5xx; 4xx tidak diulang.

import { compressPhoto, compressPhotoEmergency } from '$lib/utils/photoCompress';
import { secureDirectusFetch } from '$lib/services/secureDirectus';
import { readExifDate } from '$lib/utils/exifDate';
import { currentNetworkSpeed, isWeakDevice } from '$lib/utils/deviceProfile';

export const P2H_MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // = BODY_SIZE_LIMIT server (.env)
export const P2H_MAX_RAW_PHOTO_BYTES = 30 * 1024 * 1024; // file mentah > ini tidak dicoba dikompres (rawan crash)
const COMPRESS_TIMEOUT_MS = 20_000;
const EMERGENCY_TIMEOUT_MS = 8_000;
const UPLOAD_RETRIES = 2; // percobaan ulang setelah yang pertama => maksimal 3 kali

export type P2hPhotoMode = 'compress' | 'direct';
export type FotoKonteks = 'p2h-item' | 'p2h-unit' | 'p2h-tutup' | 'pm';

/**
 * Tanggal pengambilan foto (EXIF, dibaca dari file ASLI sebelum kompres — canvas membuang EXIF). Dikaitkan ke File hasil kompres lewat
 * WeakMap supaya tanda tangan fungsi tidak berubah; dipakai sendPreparedPhoto sebagai deskripsi berkas Directus.
 */
const diambilPada = new WeakMap<File, { iso: string; sumber: 'exif' | 'perkiraan' }>();
const konteksFile = new WeakMap<File, FotoKonteks>();

/** Tandai konteks (untuk telemetri) pada file yang akan diproses — opsional. */
export function tandaiKonteksFoto(file: File, konteks: FotoKonteks): void {
	konteksFile.set(file, konteks);
}

/** Telemetri ringan fire-and-forget; TIDAK pernah mengganggu unggah. Tanpa data pribadi. */
function kirimTelemetri(p: { tier: 'utama' | 'darurat' | 'gagal' | 'asli'; ms?: number; asalKb?: number; hasilKb?: number; konteks?: FotoKonteks }) {
	void (async () => {
		try {
			const { auth } = await import('$lib/firebase');
			const user = auth.currentUser;
			if (!user) return;
			const token = await user.getIdToken();
			await fetch('/api/preventive/foto-telemetri', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				keepalive: true,
				body: JSON.stringify({
					tier: p.tier,
					durasi_ms: p.ms,
					ukuran_asal_kb: p.asalKb,
					ukuran_hasil_kb: p.hasilKb,
					perangkat_lemah: isWeakDevice(),
					jaringan: currentNetworkSpeed(),
					konteks: p.konteks
				})
			});
		} catch {
			/* telemetri gagal = tidak apa-apa */
		}
	})();
}

/** Kompresi utama & darurat gagal. `original` = file asli untuk opsi "Kirim foto asli (lambat)". */
export class P2hPhotoCompressFailed extends Error {
	original: File;
	constructor(original: File) {
		super(
			`Foto ${(original.size / 1024 / 1024).toFixed(1)}MB gagal diperkecil di HP ini. Turunkan resolusi kamera (mis. 12MP) lalu foto ulang, atau kirim foto asli (lebih lambat).`
		);
		this.name = 'P2hPhotoCompressFailed';
		this.original = original;
	}
}

/** Gagal unggah (jaringan/server) — file tetap dipegang pemanggil untuk "Coba lagi" tanpa foto ulang. */
export class P2hPhotoUploadFailed extends Error {
	file: File;
	constructor(message: string, file: File) {
		super(message);
		this.name = 'P2hPhotoUploadFailed';
		this.file = file;
	}
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label} melebihi batas waktu.`)), ms);
		promise.then(
			(v) => {
				clearTimeout(timer);
				resolve(v);
			},
			(e) => {
				clearTimeout(timer);
				reject(e);
			}
		);
	});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function uploadErrorMessage(res: Response): Promise<string> {
	if (res.status === 401) return 'Sesi login habis. Muat ulang halaman lalu login lagi, kemudian unggah ulang fotonya.';
	if (res.status === 413) return 'Foto terlalu besar untuk server. Pilih mode "Kompres Otomatis" lalu coba lagi.';
	let detail = '';
	try {
		const body = await res.json();
		detail = body?.errors?.[0]?.message || body?.error || body?.message || '';
	} catch {
		// respons bukan JSON
	}
	return `Gagal mengunggah foto (${res.status}${detail ? `: ${detail}` : ''}). Silakan coba lagi.`;
}

/** Siapkan file yang akan dikirim sesuai mode. Dipisah agar "Coba lagi" tidak mengompres ulang. */
export async function preparePhotoForUpload(file: File, mode: P2hPhotoMode): Promise<File> {
	if (file.size > P2H_MAX_RAW_PHOTO_BYTES) {
		throw new Error(`Ukuran foto ${(file.size / 1024 / 1024).toFixed(1)}MB terlalu besar. Turunkan resolusi kamera (mis. 12MP) lalu foto ulang.`);
	}
	const konteks = konteksFile.get(file);
	// EXIF dibaca SEBELUM kompres (kompres membuang EXIF). Tanpa EXIF → waktu berkas dari kamera sebagai perkiraan.
	const exif = await readExifDate(file);
	const catat = (hasil: File) => {
		if (exif) diambilPada.set(hasil, { iso: exif, sumber: 'exif' });
		else if (file.lastModified) diambilPada.set(hasil, { iso: new Date(file.lastModified).toISOString(), sumber: 'perkiraan' });
		if (konteks) konteksFile.set(hasil, konteks);
		return hasil;
	};
	if (mode === 'direct') {
		kirimTelemetri({ tier: 'asli', asalKb: Math.round(file.size / 1024), hasilKb: Math.round(file.size / 1024), konteks });
		return catat(file);
	}

	const t0 = performance.now();
	try {
		const out = await withTimeout(compressPhoto(file), COMPRESS_TIMEOUT_MS, 'Kompresi foto');
		const ms = Math.round(performance.now() - t0);
		console.info('[P2H foto] kompres utama', { ms, dari_kb: Math.round(file.size / 1024), ke_kb: Math.round(out.size / 1024) });
		kirimTelemetri({ tier: 'utama', ms, asalKb: Math.round(file.size / 1024), hasilKb: Math.round(out.size / 1024), konteks });
		return catat(out);
	} catch (err) {
		console.warn('[P2H foto] kompresi utama gagal, mencoba kompresi darurat:', err);
	}
	try {
		const t1 = performance.now();
		const out = await withTimeout(compressPhotoEmergency(file), EMERGENCY_TIMEOUT_MS, 'Kompresi darurat');
		if (out) {
			const ms = Math.round(performance.now() - t1);
			console.info('[P2H foto] kompres darurat', { ms, dari_kb: Math.round(file.size / 1024), ke_kb: Math.round(out.size / 1024) });
			kirimTelemetri({ tier: 'darurat', ms, asalKb: Math.round(file.size / 1024), hasilKb: Math.round(out.size / 1024), konteks });
			return catat(out);
		}
	} catch (err) {
		console.warn('[P2H foto] kompresi darurat gagal:', err);
	}
	kirimTelemetri({ tier: 'gagal', asalKb: Math.round(file.size / 1024), konteks });
	throw new P2hPhotoCompressFailed(catat(file));
}

/** Unggah file siap-kirim ke Directus (dengan retry). Mengembalikan file id. */
export async function sendPreparedPhoto(toUpload: File, fileName: string, mode: P2hPhotoMode): Promise<string> {
	if (toUpload.size > P2H_MAX_UPLOAD_BYTES) {
		throw new Error(
			mode === 'direct'
				? `Foto asli ${(toUpload.size / 1024 / 1024).toFixed(1)}MB melebihi batas 15MB. Pilih mode "Kompres Otomatis" lalu coba lagi.`
				: `Foto ${(toUpload.size / 1024 / 1024).toFixed(1)}MB terlalu besar untuk dikirim. Turunkan resolusi kamera lalu foto ulang.`
		);
	}

	let lastMessage = 'Gagal mengunggah foto. Silakan coba lagi.';
	for (let attempt = 0; attempt <= UPLOAD_RETRIES; attempt++) {
		if (attempt > 0) await sleep(1000 * attempt);
		const formData = new FormData();
		// Metadata berkas HARUS sebelum 'file' pada multipart Directus. Tanggal ambil foto dari EXIF (atau perkiraan dari waktu berkas).
		const taken = diambilPada.get(toUpload);
		if (taken) formData.append('description', taken.sumber === 'exif' ? `Foto diambil ${taken.iso.replace('T', ' ')} (EXIF)` : `Foto diambil ${taken.iso.slice(0, 16).replace('T', ' ')} UTC (perkiraan dari waktu berkas)`);
		formData.append('file', toUpload, fileName);
		let res: Response;
		try {
			res = await secureDirectusFetch('/files', { method: 'POST', body: formData });
		} catch (err: any) {
			if (err instanceof TypeError) {
				lastMessage = 'Koneksi terputus saat mengunggah foto. Periksa sinyal lalu tekan "Coba lagi".';
				console.warn(`[P2H foto] unggah percobaan ${attempt + 1} gagal (jaringan)`);
				continue;
			}
			throw err;
		}
		if (res.ok) {
			const data = await res.json().catch(() => null);
			const fileId = data?.data?.id;
			if (!fileId) throw new Error('Respons server tidak berisi file foto. Silakan coba lagi.');
			return fileId;
		}
		lastMessage = await uploadErrorMessage(res);
		console.warn(`[P2H foto] unggah percobaan ${attempt + 1} gagal: HTTP ${res.status}`);
		if (res.status < 500) break; // 4xx: mengulang tidak akan membantu
	}
	throw new P2hPhotoUploadFailed(lastMessage, toUpload);
}

/** Jalur lengkap: siapkan (kompres) lalu unggah. */
export async function uploadP2hPhoto(file: File, mode: P2hPhotoMode, fileName: (f: File) => string): Promise<string> {
	const prepared = await preparePhotoForUpload(file, mode);
	return sendPreparedPhoto(prepared, fileName(prepared), mode);
}

export function p2hPhotoFileName(code: string, slot: string, file: File): string {
	const safe = String(code || 'unit').replace(/[^a-zA-Z0-9_-]+/g, '-');
	const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
	return `p2h-${safe}-${slot}-${Date.now()}.${ext}`;
}
