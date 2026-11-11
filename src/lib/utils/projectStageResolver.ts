// src/lib/utils/projectStageResolver.ts
// "Panduan SOP Tahap Ini" (lapangan): menentukan TAHAP AKTIF sebuah proyek dan memilih SOP yang relevan. MURNI — dites.
// Rancangan: erp-epi/docs/rancangan-skema-tahap-proyek-panduan-alur.md. Prinsip: tidak menebak — tanpa sinyal yang cocok, tidak ada tahap.
import { DEFAULT_PROJECT_STAGES, type ProjectStage } from '$lib/data/processProjectStageDefaults';

const lc = (v: unknown) => String(v ?? '').trim().toLowerCase();
const strList = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(lc).filter(Boolean))] : []);

/** Setelan tahap dari server (apa pun bentuknya) → daftar tahap valid terurut. Kosong/rusak → bawaan. */
export function normalizeStages(raw: unknown): ProjectStage[] {
	const out: ProjectStage[] = [];
	const seen = new Set<string>();
	for (const [i, s] of (Array.isArray(raw) ? raw : []).entries()) {
		const key = String(s?.key ?? '').trim();
		const label = String(s?.label ?? '').trim().slice(0, 60);
		if (!/^[a-z][a-z0-9_]{1,39}$/.test(key) || !label || seen.has(key)) continue;
		seen.add(key);
		const urutan = Number.isFinite(Number(s?.urutan)) ? Number(s.urutan) : i + 1;
		out.push({ key, label, urutan, aktif: s?.aktif !== false, match: { project_status: strList(s?.match?.project_status), wajib_key: strList(s?.match?.wajib_key) } });
	}
	out.sort((a, b) => a.urutan - b.urutan || a.key.localeCompare(b.key));
	return out.length ? out : DEFAULT_PROJECT_STAGES.map((s) => ({ ...s, match: { project_status: [...s.match.project_status], wajib_key: [...s.match.wajib_key] } }));
}

const dayKeys = (sub: any): string[] =>
	Object.keys(sub?.daily_plan || {})
		.filter((k) => (Number(sub.daily_plan[k]) || 0) > 0)
		.sort();

/**
 * `wajib_key` subtask timeline yang SEDANG berjalan pada `today` (YYYY-MM-DD): tanggal rencana pertama ≤ today ≤ terakhir.
 * `timeline_planning` boleh string JSON atau objek `{categories:[{subtasks:[{wajib_key,daily_plan}]}]}`; rusak → kosong.
 */
export function activeWajibKeys(timelinePlanning: unknown, today: string): string[] {
	let tl: any = timelinePlanning;
	if (typeof tl === 'string') {
		try { tl = JSON.parse(tl); } catch { return []; }
	}
	const out = new Set<string>();
	for (const cat of Array.isArray(tl?.categories) ? tl.categories : []) {
		for (const sub of Array.isArray(cat?.subtasks) ? cat.subtasks : []) {
			const wk = lc(sub?.wajib_key);
			if (!wk) continue;
			const keys = dayKeys(sub);
			if (keys.length && keys[0] <= today && today <= keys[keys.length - 1]) out.add(wk);
		}
	}
	return [...out];
}

export interface StageSignals {
	status?: string | null;
	timelinePlanning?: unknown;
}

/**
 * Tahap aktif: (1) subtask wajib yang sedang berjalan hari ini → tahap yang `match.wajib_key`-nya memuat; (2) kalau tidak ada, status proyek →
 * tahap yang `match.project_status`-nya memuat. Beberapa cocok → tahap dengan urutan TERBESAR (tahap lebih akhir menggantikan). Tak cocok → null.
 */
export function resolveProjectStage(stages: ProjectStage[], signals: StageSignals, today: string): { stage: ProjectStage; via: 'subtask' | 'status' } | null {
	const active = stages.filter((s) => s.aktif !== false);
	const pickLast = (list: ProjectStage[]) => list.reduce<ProjectStage | null>((best, s) => (!best || s.urutan >= best.urutan ? s : best), null);
	const wk = new Set(activeWajibKeys(signals.timelinePlanning, today));
	if (wk.size) {
		const hit = pickLast(active.filter((s) => s.match.wajib_key.some((k) => wk.has(k))));
		if (hit) return { stage: hit, via: 'subtask' };
	}
	const st = lc(signals.status);
	if (st) {
		const hit = pickLast(active.filter((s) => s.match.project_status.includes(st)));
		if (hit) return { stage: hit, via: 'status' };
	}
	return null;
}

export interface StageFlow {
	id: string;
	title: string;
	sop_code?: string;
	kategori_sop?: string;
	sub_kategori?: string;
	tahap_proyek: string[];
	approval_status?: string;
	sosialisasi_end_date?: string;
	node_count?: number;
}

/**
 * Pilih maksimal `max` SOP untuk satu tahap. Urutan: (1) alur yang punya langkah milik jabatan saya, (2) masa sosialisasi aktif (perlu dibaca),
 * (3) Induk sebelum Turunan, (4) judul. Tanpa duplikat. Alur tanpa tahap tersebut tidak pernah ikut.
 */
export function pickStageFlows(flows: StageFlow[], stageKey: string, { myFlowIds = new Set<string>(), max = 3, today = '' }: { myFlowIds?: Set<string>; max?: number; today?: string } = {}): StageFlow[] {
	const rank = (f: StageFlow) => [
		myFlowIds.has(f.id) ? 0 : 1,
		f.approval_status === 'butuh_sosialisasi' || (f.sosialisasi_end_date && today && f.sosialisasi_end_date >= today) ? 0 : 1,
		f.kategori_sop === 'induk' ? 0 : f.kategori_sop === 'turunan' ? 1 : 2
	];
	return flows
		.filter((f) => Array.isArray(f.tahap_proyek) && f.tahap_proyek.includes(stageKey))
		.sort((a, b) => {
			const ra = rank(a), rb = rank(b);
			for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
			return a.title.localeCompare(b.title, 'id');
		})
		.slice(0, Math.max(0, max));
}
