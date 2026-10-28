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
