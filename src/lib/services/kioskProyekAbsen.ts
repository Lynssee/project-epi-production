// src/lib/services/kioskProyekAbsen.ts
// Klien tipis untuk /api/kiosk-proyek/absen (Rencana Kiosk Proyek, Fase 2). Tanpa Firebase.
// Keputusan (jam, jarak, valid/tidak) SEPENUHNYA di server — di sini hanya GPS, kompres foto, kirim.
//
// Kompres DIPISAH dari kirim: foto terkompres + lokasi disimpan pemanggil di memori, sehingga "Kirim ulang"
// setelah sinyal putus tidak perlu memotret ulang (lihat utils/kioskProyekRetry.ts untuk kapan layak diulang).

import { compressPhoto } from '$lib/utils/photoCompress';
import { bisaDiulang } from '$lib/utils/kioskProyekRetry';

export interface Lokasi {
	lat: number;
	lng: number;
	accuracy: number | null;
}

export interface HasilAbsen {
	ok: true;
	aksi: 'masuk' | 'pulang';
	sudah_ada: boolean;
	message: string;
	masuk_valid: boolean | null;
	jarak_m: number | null;
	peringatan: string[];
	jam: string;
}

/** Error dengan `reason` bila server menolak perangkatnya (dicabut / kedaluwarsa / kiosk dimatikan). */
export class AbsenKioskError extends Error {
	constructor(message: string, public reason: string | null = null, public status = 0) {
		super(message);
	}
	/** Layak "Kirim ulang" dengan foto & lokasi yang sama (jaringan/server), bukan karena isinya ditolak. */
	get bisaUlang(): boolean {
		return !this.reason && bisaDiulang(this.status);
	}
}

/** GPS dengan batas waktu. Dipanggil langsung dari gestur tekan tombol supaya izin lokasi muncul tepat waktu. */
export function ambilLokasi(timeoutMs = 15000): Promise<Lokasi> {
	return new Promise((resolve, reject) => {
		if (!('geolocation' in navigator)) {
			reject(new AbsenKioskError('Perangkat ini tidak mendukung GPS.'));
			return;
		}
		navigator.geolocation.getCurrentPosition(
			(p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null }),
			(e) =>
				reject(
					new AbsenKioskError(
						e.code === e.PERMISSION_DENIED
							? 'Izin lokasi ditolak. Aktifkan izin lokasi untuk situs ini di pengaturan browser, lalu coba lagi.'
							: 'Lokasi tidak terbaca. Pindah ke tempat terbuka dan coba lagi.'
					)
				),
			{ enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 10000 }
		);
	});
}

/** Kompres sekali; hasilnya disimpan pemanggil untuk dikirim ulang bila perlu. */
export const kompresFotoKiosk = (foto: File, maxKb: number, maxDim = 1024): Promise<File> =>
	compressPhoto(foto, { maxSizeMB: Math.max(0.05, maxKb / 1024), maxWidthOrHeight: maxDim });

export async function kirimAbsenKiosk(p: {
	aksi: 'masuk' | 'pulang';
	manpowerId: number;
	/** Foto yang SUDAH dikompres (kompresFotoKiosk). */
	foto: File;
	lokasi: Lokasi;
}): Promise<HasilAbsen> {
	const fd = new FormData();
	fd.append('aksi', p.aksi);
	fd.append('manpower_id', String(p.manpowerId));
	fd.append('lat', String(p.lokasi.lat));
	fd.append('lng', String(p.lokasi.lng));
	if (p.lokasi.accuracy != null) fd.append('accuracy', String(p.lokasi.accuracy));
	fd.append('foto', p.foto, p.foto.name || 'absen-kiosk.jpg');

	let res: Response;
	try {
		res = await fetch('/api/kiosk-proyek/absen', { method: 'POST', body: fd, cache: 'no-store' });
	} catch {
		throw new AbsenKioskError('Tidak ada koneksi internet. Absen belum terkirim — foto dan lokasi Anda disimpan, tekan Kirim ulang saat sinyal ada.');
	}
	const j = await res.json().catch(() => null);
	if (!res.ok || !j?.ok) {
		throw new AbsenKioskError(j?.message || (j?.reason ? 'Perangkat tidak berlaku.' : `Absen gagal (${res.status}).`), j?.reason ?? null, res.status);
	}
	return j as HasilAbsen;
}
