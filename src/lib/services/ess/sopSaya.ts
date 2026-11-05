// src/lib/services/ess/sopSaya.ts
// Klien "SOP Saya" (ESS Pelatihan & Kinerja). Cache memori 2 menit — dua kartu di dua halaman memakai satu data, dan buka-tutup
// halaman tidak menembak server berulang (hemat kuota di lapangan). Tidak pernah melempar: gagal -> { available:false }.
import { getIdToken } from '$lib/services/secureDirectus';

export type SopProgramState = 'lulus' | 'belum' | 'tenggang' | 'tidak_terdaftar';

export interface SopProgram {
	program_id: number;
	judul: string;
	kode: string;
	state: SopProgramState;
	wajib: boolean;
	alur: Array<{ flow_title: string; node_label: string }>;
	alur_total: number;
}

export interface SopFlow {
	flow_id: string;
	flow_title: string;
	langkah: number;
	siap: number;
	belum_siap: number;
	ditunda: number;
	perlu_training: Array<{ program_id: number; judul: string }>;
}

export interface SopSaya {
	available: boolean;
	reason?: string;
	/** false = jabatan karyawan belum terhubung ke Peta Alur (kartu tidak tampil). */
	terhubung?: boolean;
	jabatan?: { id: number; nama: string } | null;
	grace_hari?: number;
	training?: { value: number; note: string } | null;
	readiness?: { value: number; note: string } | null;
	programs?: SopProgram[];
	flows?: SopFlow[];
	/** Checklist prasyarat siap proyek (diatur admin di Pengaturan Peta Alur); berlaku untuk semua karyawan. */
	prasyarat?: Array<{ program_id: number; judul: string; kode: string; state: SopProgramState }>;
	ringkas?: { lulus: number; belum: number; tenggang: number; tidak_terdaftar: number; total: number };
}

const TTL_MS = 2 * 60 * 1000;
let cache: { at: number; promise: Promise<SopSaya> } | null = null;

export function getSopSaya(force = false): Promise<SopSaya> {
	if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.promise;
	const promise = (async (): Promise<SopSaya> => {
		try {
			const res = await fetch('/api/ess/sop-saya', { headers: { Authorization: `Bearer ${await getIdToken()}` } });
			const data = (await res.json().catch(() => null)) as SopSaya | null;
			if (!res.ok || !data) return { available: false, reason: `HTTP ${res.status}` };
			return data;
		} catch (e: any) {
			return { available: false, reason: e?.message || 'Gagal memuat' };
		}
	})();
	cache = { at: Date.now(), promise };
	// Hasil gagal tidak boleh bertahan di cache (percobaan berikutnya memuat ulang).
	promise.then((d) => { if (!d.available && cache?.promise === promise) cache = null; });
	return promise;
}

export function clearSopSayaCache() {
	cache = null;
}

/** Label & tampilan status satu program SOP untuk karyawan (murni — dites). */
export function sopStateInfo(state: SopProgramState): { label: string; tone: 'ok' | 'jalan' | 'belum' | 'info' } {
	switch (state) {
		case 'lulus': return { label: 'Lulus', tone: 'ok' };
		case 'tenggang': return { label: 'Sedang berjalan', tone: 'jalan' };
		case 'belum': return { label: 'Belum selesai', tone: 'belum' };
		default: return { label: 'Belum terdaftar', tone: 'info' };
	}
}
