// src/lib/services/kioskProyekPemakaian.ts
// Klien tipis untuk /api/kiosk-proyek/barang & /pemakaian (Draf Pemakaian Barang, Fase 5). Tanpa Firebase.
import { bisaDiulang } from '$lib/utils/kioskProyekRetry';

export interface BarangKiosk {
	expense_id: number;
	nama: string;
	satuan: string;
	sisa: number;
}

export class PemakaianKioskError extends Error {
	constructor(message: string, public reason: string | null = null, public status = 0) {
		super(message);
	}
	/** Layak "Kirim ulang" dengan isi yang sama (jaringan/server), bukan karena isinya ditolak. */
	get bisaUlang(): boolean {
		return !this.reason && bisaDiulang(this.status);
	}
}

async function bacaJson(res: Response) {
	return res.json().catch(() => null);
}

export async function ambilBarang(): Promise<BarangKiosk[]> {
	let res: Response;
	try {
		res = await fetch('/api/kiosk-proyek/barang', { cache: 'no-store' });
	} catch {
		throw new PemakaianKioskError('Tidak ada koneksi internet. Coba lagi saat sinyal ada.');
	}
	const j = await bacaJson(res);
	if (!res.ok || !j?.ok) throw new PemakaianKioskError(j?.message || (j?.reason ? 'Perangkat tidak berlaku.' : `Gagal memuat barang (${res.status}).`), j?.reason ?? null, res.status);
	return j.barang as BarangKiosk[];
}

export async function kirimPemakaian(p: {
	manpowerId: number | null; // null untuk HP pribadi (identitas dari server)
	expenseId: number;
	qty: string; // dikirim apa adanya; server yang memvalidasi
	catatan: string;
	/** Foto yang SUDAH dikompres (kompresFotoKiosk). Duplikat akibat kirim ulang dibuang server (barang+jumlah sama < 2 menit). */
	foto: File | null;
}): Promise<{ ok: true; id: number; sudah_ada: boolean }> {
	const fd = new FormData();
	if (p.manpowerId != null) fd.append('manpower_id', String(p.manpowerId));
	fd.append('expense_id', String(p.expenseId));
	fd.append('qty', p.qty);
	fd.append('catatan', p.catatan);
	if (p.foto) fd.append('foto', p.foto, p.foto.name || 'pemakaian.jpg');
	let res: Response;
	try {
		res = await fetch('/api/kiosk-proyek/pemakaian', { method: 'POST', body: fd, cache: 'no-store' });
	} catch {
		throw new PemakaianKioskError('Tidak ada koneksi internet. Pengajuan belum terkirim — isi dan foto Anda masih tersimpan, tekan Kirim ulang saat sinyal ada.');
	}
	const j = await bacaJson(res);
	if (!res.ok || !j?.ok) throw new PemakaianKioskError(j?.message || (j?.reason ? 'Perangkat tidak berlaku.' : `Gagal mengirim (${res.status}).`), j?.reason ?? null, res.status);
	return j;
}
