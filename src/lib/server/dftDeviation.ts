// src/lib/server/dftDeviation.ts
// SERVER-ONLY. Deviasi DFT lapangan vs spesifikasi proyek (Scope Teknis Fase 4).
// Server MENGHITUNG ULANG dari data tersimpan (laporan inspeksi + spesifikasi objek) — klien hanya menyebut
// report & objek yang dijadikan acuan, sehingga pengguna tidak bisa memicu pesan WA ke PM dengan angka karangan.
// Gerbang: setelan system_settings `project.scopespec.notify_dft_deviation` (fail-closed: mati sampai dinyalakan
// Superadmin di /settings/project-management). Satu notifikasi per (laporan, layer, status, rata-rata) per jam.

import { directusServerJson } from './directus';
import { compareDftToLayer, parseSpecJson, specLayers } from '$lib/shared/projectSpecDft';
import { notifyProjectDftDeviation } from './projectNotify';

export const NOTIFY_SETTING_KEY = 'project.scopespec.notify_dft_deviation';
const THROTTLE_MS = 60 * 60 * 1000;
const recent = new Map<string, number>();

export interface DftDeviation {
	layerNo: number;
	status: 'kurang' | 'over';
	avg: number;
	target: number;
	min: number;
	max: number;
}

/** Murni: bandingkan titik ukur per layer dengan lapisan spesifikasi → hanya yang menyimpang. */
export function buildDftDeviations(
	readingsByLayer: Record<number, Array<number | string | null>>,
	spec: unknown
): DftDeviation[] {
	const layers = specLayers(parseSpecJson(spec));
	const out: DftDeviation[] = [];
	for (const [k, readings] of Object.entries(readingsByLayer || {})) {
		const layerNo = Number(k);
		const layer = layers.find((l) => l.no === layerNo);
		if (!layer) continue; // layer tanpa acuan spesifikasi tidak dinilai
		const c = compareDftToLayer(readings, layer);
		if (c.status === 'kurang' || c.status === 'over') {
			out.push({ layerNo, status: c.status, avg: c.avg as number, target: layer.target, min: layer.min, max: layer.max });
		}
	}
	return out.sort((a, b) => a.layerNo - b.layerNo);
}

export async function isDftNotifyEnabled(): Promise<boolean> {
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/system_settings?filter[setting_key][_eq]=${encodeURIComponent(NOTIFY_SETTING_KEY)}&fields=setting_value&limit=1`
		);
		const raw = res?.data?.[0]?.setting_value;
		if (raw == null) return false;
		return (typeof raw === 'string' ? JSON.parse(raw) : raw) === true;
	} catch (err) {
		console.warn('[dftDeviation] gagal baca setelan notifikasi, dianggap mati:', err);
		return false;
	}
}

export type DftNotifyResult =
	| { sent: false; reason: 'disabled' | 'no_project' | 'no_spec' | 'no_deviation' | 'throttled' | 'not_found' }
	| { sent: true; deviations: DftDeviation[] };

/** Evaluasi laporan inspeksi terhadap spesifikasi objek lalu kirim notifikasi bila menyimpang. Tidak melempar untuk kasus bisnis. */
export async function evaluateAndNotifyDftDeviation(reportId: number, objectId: number): Promise<DftNotifyResult> {
	if (!(await isDftNotifyEnabled())) return { sent: false, reason: 'disabled' };

	const rep = await directusServerJson<{ data: any }>(
		`/items/inspection_report/${reportId}?fields=id,project_id,report_no,part_name`
	).catch(() => null);
	const report = rep?.data;
	if (!report) return { sent: false, reason: 'not_found' };
	const projectId = Number(report.project_id);
	if (!projectId) return { sent: false, reason: 'no_project' };

	// Relasi dipisah (Aturan #2): charter proyek → objek (harus milik proyek ini) → pembacaan DFT.
	const ch = await directusServerJson<{ data: any[] }>(
		`/items/project_charters?filter[project_id][_eq]=${projectId}&fields=id&limit=-1`
	);
	const charterIds = (ch?.data || []).map((c) => c.id);
	if (charterIds.length === 0) return { sent: false, reason: 'no_spec' };
	const ob = await directusServerJson<{ data: any[] }>(
		`/items/project_objects?filter[id][_eq]=${objectId}&filter[project_charter_id][_in]=${charterIds.join(',')}` +
			`&fields=id,nama_objek,nama_area,spesifikasi_teknis&limit=1`
	);
	const obj = ob?.data?.[0];
	if (!obj) return { sent: false, reason: 'no_spec' };

	const rd = await directusServerJson<{ data: any[] }>(
		`/items/inspection_dft_reading?filter[report_id][_eq]=${reportId}&fields=layer_no,value_um&limit=-1`
	);
	const byLayer: Record<number, number[]> = {};
	for (const r of rd?.data || []) (byLayer[r.layer_no] ||= []).push(Number(r.value_um));

	const deviations = buildDftDeviations(byLayer, obj.spesifikasi_teknis);
	if (deviations.length === 0) return { sent: false, reason: 'no_deviation' };

	// Throttle per tanda-tangan deviasi: simpan ulang draf tanpa perubahan tidak mengirim ulang.
	const fresh = deviations.filter((d) => {
		const key = `${reportId}:${d.layerNo}:${d.status}:${Math.round(d.avg)}`;
		const last = recent.get(key);
		if (last && Date.now() - last < THROTTLE_MS) return false;
		recent.set(key, Date.now());
		return true;
	});
	if (recent.size > 500) recent.clear();
	if (fresh.length === 0) return { sent: false, reason: 'throttled' };

	const proj = await directusServerJson<{ data: any }>(`/items/projects/${projectId}?fields=id,name`).catch(() => null);
	await notifyProjectDftDeviation({
		reportId,
		reportNo: report.report_no || `#${reportId}`,
		projectId,
		projectName: proj?.data?.name || 'proyek',
		objectName: String(obj.nama_objek || obj.nama_area || `Objek #${obj.id}`),
		deviations: fresh
	});
	return { sent: true, deviations: fresh };
}
