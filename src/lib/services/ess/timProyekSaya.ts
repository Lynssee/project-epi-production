// src/lib/services/ess/timProyekSaya.ts
// Klien "Performa Tim Proyek Saya" (ESS Kinerja, khusus Project Leader / Co-Leader). Cache memori 2 menit (hemat kuota lapangan).
// Tidak pernah melempar: gagal -> { available:false }.
import { getIdToken } from '$lib/services/secureDirectus';

export interface TimAnggota {
	manpower_id: number;
	nama: string;
	jabatan: string;
	composite: number | null;
	badge: string;
	ratingCount: number;
	kehadiranPct: number | null;
	perluPerhatian: boolean;
	belumDinilai: boolean;
}

export interface TimProyek {
	project_id: number;
	nama: string;
	anggota: TimAnggota[];
	ringkas: { total: number; belumDinilai: number; perluPerhatian: number; ratingKurang: number };
}

export interface TimInternalAnggota {
	karyawan_id: number;
	nama: string;
	posisi: string;
	periode: string | null;
	total_skor: number | null;
	skor_general: number | null;
	skor_spesifik: number | null;
	delta: number | null;
	turun: boolean;
}

/** Bawahan langsung (garis komando andal); hanya skor Finalized pada periode yang sudah dirilis. */
export interface TimInternal {
	sumber: string | null;
	anggota: TimInternalAnggota[];
	ringkas: { anggota: number; denganSkor: number; belumAdaSkor: number; rataSkor: number | null; turun: number };
}

export interface TimProyekSaya {
	available: boolean;
	reason?: string;
	adalahLeader?: boolean;
	proyek?: TimProyek[];
	ringkas?: { proyek: number; total: number; belumDinilai: number; perluPerhatian: number };
	/** null = bagian internal gagal dimuat (tim outsource tetap ada). */
	internal?: TimInternal | null;
}

const TTL_MS = 2 * 60 * 1000;
let cache: { at: number; data: TimProyekSaya } | null = null;

export async function getTimProyekSaya(force = false): Promise<TimProyekSaya> {
	if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
	try {
		const res = await fetch('/api/ess/tim-proyek-saya', { headers: { Authorization: `Bearer ${await getIdToken()}` } });
		const data = (await res.json().catch(() => null)) as TimProyekSaya | null;
		if (!res.ok || !data) return { available: false, reason: `HTTP ${res.status}` };
		if (data.available) cache = { at: Date.now(), data };
		return data;
	} catch (e: any) {
		return { available: false, reason: e?.message || 'Gagal memuat' };
	}
}
