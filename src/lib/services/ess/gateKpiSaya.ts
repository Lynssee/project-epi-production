// src/lib/services/ess/gateKpiSaya.ts
// Klien "Dampak Gate ke KPI Saya" (ESS Kinerja). Cache memori 2 menit supaya buka-tutup halaman tidak
// menembak server berulang (hemat kuota di lapangan). Tidak pernah melempar: gagal -> { available:false }.
import { getIdToken } from '$lib/services/secureDirectus';

export interface GateKpiSayaDokumen {
	id: number;
	nomor: string;
	sumber: string;
	kategori?: string;
	aging_jam: number;
	sisa_jam: number;
	gate_keys: string[];
	status: 'edukasi' | 'penalti';
	alasan: 'edukasi' | 'lewat_batas' | 'berulang';
	link: string | null;
}

export interface GateKpiSaya {
	available: boolean;
	reason?: string;
	periode?: string;
	berlaku?: boolean;
	enforce_from?: string;
	settings?: { aging_jam_batas: number; toleransi_ulang: number; target_lolos_persen: number; sp_ambang_penalti: number; min_sampel: number };
	ringkas?: {
		total_dokumen: number;
		tertahan: number;
		penalti: number;
		edukasi: number;
		lewat_batas: number;
		berulang: number;
		lolos_persen: number | null;
		skor_kpi: number | null;
		dinilai: boolean;
		sisa_ke_ambang_sp: number;
	};
	per_kategori?: Array<{ key: string; label: string; total_dokumen: number; tertahan: number; penalti: number; edukasi: number }>;
	tertahan?: GateKpiSayaDokumen[];
	gate_penyebab?: Array<{ gate_key: string; label: string; count: number }>;
	sp?: { aktif_6_bulan: number };
}

const TTL_MS = 2 * 60 * 1000;
let cache: { at: number; data: GateKpiSaya } | null = null;

export async function getGateKpiSaya(force = false): Promise<GateKpiSaya> {
	if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.data;
	try {
		const res = await fetch('/api/ess/gate-kpi-saya', { headers: { Authorization: `Bearer ${await getIdToken()}` } });
		const data = (await res.json().catch(() => null)) as GateKpiSaya | null;
		if (!res.ok || !data) return { available: false, reason: `HTTP ${res.status}` };
		if (data.available) cache = { at: Date.now(), data };
		return data;
	} catch (e: any) {
		return { available: false, reason: e?.message || 'Gagal memuat' };
	}
}
