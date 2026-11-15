// src/lib/services/projectFulfillment.ts
// Klien tipis lintas-origin ke erp-epi GET /api/project/[id]/fulfillment (Status Realisasi Subtask, Fase 5).
// Pola sama forecastMobilizationRequest.ts: Bearer token Firebase yang sama. READ-ONLY; server meng-cache 60 dtk,
// ditambah cache modul di sini supaya kartu & sheet yang terbuka bersamaan memakai 1 request.
import { getIdToken } from './secureDirectus';

const ADMIN_APP_ORIGIN = '';
const TTL_MS = 60_000;

export interface FulfillmentSj {
	id: number | string;
	nomor_sj: string | null;
	status: string;
	tanggal: string | null;
	received_at: string | null;
	driver: string | null;
	/** Estimasi tiba (SJ ekspedisi, diisi admin logistik). */
	eta_tiba?: string | null;
	mode_kirim?: string | null;
	/** Tahap tracking: dimuat | diserahkan_ekspedisi | dalam_perjalanan | tiba_lokasi … */
	track_stage?: string | null;
	no_resi?: string | null;
	ekspedisi?: string | null;
}

/** Sinkronisasi mobilisasi (gate G_MOB_SYNC) — dihitung server erp-epi; lapangan hanya menampilkan. */
export interface FulfillmentMobSync {
	status: 'waiting_material' | 'synchronized' | 'early_material' | 'waiting_manpower' | 'unknown';
	reason?: string | null;
	/** Tim mulai − ETA material (hari). Negatif = tim menunggu material. */
	gap_days: number | null;
	manpower_start: string | null;
	material_eta: string | null;
	eta_source?: string | null;
	projected?: boolean;
	estimated_idle_cost?: number;
	blocking?: Array<{ ref_name: string; eta: string; source: string | null; nomor_sj: string | null }>;
	at_risk_manpower?: Array<{ nama: string | null; jabatan: string; tanggal_mulai: string; idle_days: number }>;
}

export interface FulfillmentMaterial {
	id: number | string; // = id baris project_resource_forecast
	ref_name: string;
	status: string;
	late: boolean;
	pl: { id: number | string; nomor_pl: string } | null;
	sj: FulfillmentSj[];
}

export interface FulfillmentReadiness {
	state: 'none' | 'ready' | 'partial' | 'problem';
	reasons: string[];
	total: number;
	ready: number;
}

export interface FulfillmentSubtask {
	id: string;
	name: string;
	category: string;
	first: string | null;
	last: string | null;
	activeToday: boolean;
	readiness: FulfillmentReadiness;
}

export interface ProjectFulfillment {
	projectId: number;
	today: string;
	forecastEmpty: boolean;
	bySubtask: Record<string, { materials: FulfillmentMaterial[]; equipment: any[]; manpowerRoles: any[] }>;
	subtasks: FulfillmentSubtask[];
	manpowerToday: { roles: Array<{ role: string; need: number; present: number; shortage: number }> };
	/** Tidak ada pada respons lama / proxy fallback → anggap belum dinilai. */
	mobSync?: FulfillmentMobSync;
	/** Konfigurasi dari server (setelan admin) — lapangan tak menyalin default setelan sendiri. */
	config?: { notReadyDays: number; checklistAutocheck: Array<{ item_id: number; source: ChecklistSource }> };
	/** L4: sinyal untuk centang otomatis Checklist Pra-Mobilisasi. 'na' = tak ada data, JANGAN dipakai mencentang. */
	checklistSignals?: Record<ChecklistSource, { state: 'ok' | 'not_ok' | 'na'; detail: string }>;
	syncedAt: string;
}

export type ChecklistSource = 'manpower_complete' | 'material_ready' | 'equipment_ready' | 'bpjstk_proyek';

const cache = new Map<string, { at: number; promise: Promise<ProjectFulfillment> }>();

export function fetchProjectFulfillment(projectId: number | string, force = false): Promise<ProjectFulfillment> {
	const key = String(projectId);
	const hit = cache.get(key);
	if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.promise;
	const promise = (async () => {
		const token = await getIdToken();
		const res = await fetch(`${ADMIN_APP_ORIGIN}/api/project/${key}/fulfillment${force ? '?force=1' : ''}`, {
			headers: { Authorization: `Bearer ${token}` }
		});
		if (!res.ok) throw new Error(`Gagal memuat status kesiapan (${res.status})`);
		return (await res.json()) as ProjectFulfillment;
	})().catch((err) => {
		cache.delete(key); // jangan cache kegagalan
		throw err;
	});
	cache.set(key, { at: Date.now(), promise });
	return promise;
}

/**
 * Status sinkronisasi mobilisasi untuk BANYAK proyek (kolom di Manpower Rencana vs Realisasi). Memakai cache modul
 * fetchProjectFulfillment (60 dtk) + konkurensi dibatasi; proyek yang gagal → null (tampil "—"), tidak menggagalkan yang lain.
 * Dibatasi `max` proyek pertama agar halaman tidak memicu puluhan request sekaligus.
 */
export async function fetchMobSyncForProjects(
	projectIds: Array<number | string>,
	{ max = 15, concurrency = 3 }: { max?: number; concurrency?: number } = {}
): Promise<Map<string, FulfillmentMobSync | null>> {
	const out = new Map<string, FulfillmentMobSync | null>();
	const ids = [...new Set(projectIds.map(String))].slice(0, max);
	let i = 0;
	await Promise.all(
		Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
			while (i < ids.length) {
				const id = ids[i++];
				try {
					out.set(id, (await fetchProjectFulfillment(id)).mobSync ?? null);
				} catch (e) {
					console.warn(`[projectFulfillment] mobSync proyek ${id} tidak termuat:`, e);
					out.set(id, null);
				}
			}
		})
	);
	return out;
}

export interface ReportShortageResult {
	success: boolean;
	error?: string;
}

/** L3 — Leader melapor kekurangan 1 subtask -> notifikasi in-app ke dept Project (admin). Anti-spam 1/jam per subtask di server. */
export async function reportShortage(
	projectId: number | string,
	params: { subtaskId: string; note?: string; reportedByName?: string }
): Promise<ReportShortageResult> {
	try {
		const token = await getIdToken();
		const res = await fetch(`${ADMIN_APP_ORIGIN}/api/project/${projectId}/fulfillment/report-shortage`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify(params)
		});
		const parsed: any = await res.json().catch(() => null);
		if (!res.ok || !parsed?.success) {
			return { success: false, error: parsed?.message || `Gagal melapor (${res.status})` };
		}
		return { success: true };
	} catch (err: any) {
		console.warn('[projectFulfillment] reportShortage error:', err);
		return { success: false, error: err?.message || 'Gagal menghubungi server admin.' };
	}
}
