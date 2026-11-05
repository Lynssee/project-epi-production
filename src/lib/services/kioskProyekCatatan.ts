// src/lib/services/kioskProyekCatatan.ts
// Klien tipis untuk /api/kiosk-proyek/catatan (Catatan Kerja kru, Fase 4). Tanpa Firebase.
import { bisaDiulang } from '$lib/utils/kioskProyekRetry';

export interface PengaturanCatatan {
	progres: string[];
	kendala: string[];
	maks_karakter: number;
}

export class CatatanKioskError extends Error {
	constructor(message: string, public reason: string | null = null, public status = 0) {
		super(message);
	}
	/** Layak "Kirim ulang" dengan isi yang sama (jaringan/server), bukan karena isinya ditolak. */
	get bisaUlang(): boolean {
		return !this.reason && bisaDiulang(this.status);
	}
}

export async function kirimCatatan(p: {
	manpowerId: number | null; // null untuk HP pribadi (identitas dari server)
	kategori: string;
	catatan: string;
	/** Foto yang SUDAH dikompres (kompresFotoKiosk) — kompres dilakukan pemanggil sekali dan di-cache. */
	foto: File | null;
	/** Tetap sama selama isi tidak berubah; server memakainya membuang duplikat bila respons sebelumnya hilang. */
	txnId: string;
}): Promise<{ ok: true; id: number; jenis: 'progres' | 'kendala'; sudah_ada?: boolean }> {
	const fd = new FormData();
	if (p.manpowerId != null) fd.append('manpower_id', String(p.manpowerId));
	fd.append('kategori', p.kategori);
	fd.append('catatan', p.catatan);
	fd.append('txn_id', p.txnId);
	if (p.foto) fd.append('foto', p.foto, p.foto.name || 'catatan.jpg');
	let res: Response;
	try {
		res = await fetch('/api/kiosk-proyek/catatan', { method: 'POST', body: fd, cache: 'no-store' });
	} catch {
		throw new CatatanKioskError('Tidak ada koneksi internet. Catatan belum terkirim — isi dan foto Anda masih tersimpan, tekan Kirim ulang saat sinyal ada.');
	}
	const j = await res.json().catch(() => null);
	if (!res.ok || !j?.ok) {
		throw new CatatanKioskError(j?.message || (j?.reason ? 'Perangkat tidak berlaku.' : `Gagal mengirim (${res.status}).`), j?.reason ?? null, res.status);
	}
	return j;
}
