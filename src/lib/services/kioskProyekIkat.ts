// src/lib/services/kioskProyekIkat.ts
// Klien tipis untuk /api/kiosk-proyek/ikat (ikat HP pribadi, Fase 3). Tanpa Firebase.

export interface KruIkat {
	manpower_id: number;
	nama: string;
	posisi: string | null;
	terikat: boolean;
}

async function jalankan<T>(url: string, init?: RequestInit): Promise<T> {
	let res: Response;
	try {
		res = await fetch(url, { cache: 'no-store', ...init });
	} catch {
		throw new Error('Tidak ada koneksi internet. Coba lagi saat sinyal ada.');
	}
	const j = await res.json().catch(() => null);
	if (!res.ok || !j?.ok) throw new Error(j?.message || `Gagal (${res.status}).`);
	return j as T;
}

export const infoIkat = (kode: string) =>
	jalankan<{ ok: true; project_name: string; butuh_kode_harian: boolean }>(`/api/kiosk-proyek/ikat?kode=${encodeURIComponent(kode)}`);

export const ikatLangkahKode = (kode: string, kodeHarian?: string) =>
	jalankan<{ ok: true; bind_token: string; project_name: string; kru: KruIkat[] }>('/api/kiosk-proyek/ikat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ kode, langkah: 'kode', kode_harian: kodeHarian })
	});

export const ikatPilih = (kode: string, bindToken: string, manpowerId: number) =>
	jalankan<{ ok: true; nama: string; hp_lama_dicabut: number; kedaluwarsa_pada: string }>('/api/kiosk-proyek/ikat', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ kode, langkah: 'pilih', bind_token: bindToken, manpower_id: manpowerId })
	});
