// src/lib/server/gates/plDisiplinFieldGates.ts
// SERVER-ONLY. Penajaman Gate Packing List (13 Okt 2026), Fase 3 — sisi lapangan.
// Kembar dari erp-epi/src/lib/server/gates/plDisiplinGates.js (G_PKL_EQUIPMENT_P2H &
// G_PKL_LAPORAN_HARIAN). Dibaca LANGSUNG lewat Directus (satu instance), tidak mengimpor
// kode erp-epi. Logika murni WAJIB identik dengan versi admin (dijaga test kontrak di erp-epi).
//
// Keputusan user: berlaku untuk SEMUA pengaju (leader, mekanik, operator) — gate dievaluasi
// per PROYEK, bukan per pengaju, jadi tidak ada cabang berdasar peran. Ini berbeda dari
// G_LAPOR_* lama yang per-karyawan.
//
// Mode (shadow/soft/warn/hard) dari gate_definitions + gate_enforcement jenis 'PL' lewat
// resolveGateMode — diatur superadmin di Kalibrasi Gate, TIDAK hardcode (CLAUDE.md #11).
//   shadow      : dievaluasi & dikembalikan di `disiplin` (untuk banner), TIDAK masuk gates/warnings.
//   soft / warn : peringatan (SEMI) — pengajuan tetap terkirim.
//   hard        : blokir (WAJIB); super admin/GM (overrideAllowed) → peringatan + `overridden`.
// Aturan anti-lockdown: gate baru lahir shadow + enforce_from klem di resolver. Kegagalan baca data
// ⇒ not_applicable (fail-open, dilog) — tidak pernah mengunci lapangan karena gangguan Directus.

import { resolveGateMode, type GateMode } from '../gateDefinitionsMode';
import { DATA_DASAR_LABELS, DEFAULT_GATE_EXTRA_ITEMS, missingDataDasar } from '../../utils/dataDasarProyek';
import {
	evaluateFieldPLGatesFor,
	type FieldGate,
	type FieldPLResult,
	type FieldPLRow
} from './plFieldGates';

type Dx = (path: string, init?: any) => Promise<any>;

const WIB_MS = 7 * 3600 * 1000;
const DEFAULT_HARI_WAJIB = [1, 2, 3, 4, 5, 6];
const DEFAULT_WINDOW_HARI = 7;
const DEFAULT_STATUS_WAJIB = ['on progress', 'repair'];
const DEFAULT_GRACE_JAM = '09:00';
const MAX_LIST = 5;

const asId = (v: any) => (v && typeof v === 'object' ? v.id : v);

// ─── Util tanggal WIB (identik dengan versi admin) ──────────────────────────
export function wibParts(now = new Date()) {
	const w = new Date(now.getTime() + WIB_MS);
	return { ymd: w.toISOString().slice(0, 10), minutes: w.getUTCHours() * 60 + w.getUTCMinutes() };
}
export function addDays(ymd: string, delta: number) {
	const [y, m, d] = ymd.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}
export function toWibYmd(value: any): string | null {
	if (!value) return null;
	const t = new Date(value).getTime();
	if (Number.isNaN(t)) return null;
	if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}(T[\d:.]+)?$/.test(value)) return value.slice(0, 10);
	return new Date(t + WIB_MS).toISOString().slice(0, 10);
}
const dowOf = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();
const fmtId = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;
function hhmmToMinutes(s: any) {
	const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || ''));
	return m ? Number(m[1]) * 60 + Number(m[2]) : 9 * 60;
}

export function computeRequiredReportDates(p: {
	todayYmd: string;
	hariWajib: number[];
	windowHari: number;
	startDate?: string | null;
}): string[] {
	const days = Array.isArray(p.hariWajib) && p.hariWajib.length ? p.hariWajib : DEFAULT_HARI_WAJIB;
	const want = Math.max(1, Math.min(Number(p.windowHari) || DEFAULT_WINDOW_HARI, 31));
	const start = toWibYmd(p.startDate ?? null);
	const out: string[] = [];
	for (let i = 1; i <= 62 && out.length < want; i++) {
		const ymd = addDays(p.todayYmd, -i);
		if (start && ymd < start) break;
		if (days.includes(dowOf(ymd))) out.push(ymd);
	}
	return out.reverse();
}

// ─── Gate murni ──────────────────────────────────────────────────────────────
export interface P2hCtx {
	today: string;
	equipment: Array<{ id: string; label: string }>;
	doneIds: string[];
}
export interface LaporanCtx {
	required: string[];
	reported: string[];
	applicable: boolean;
	naReason?: string;
}
type Raw = { status: 'passed' | 'failed' | 'not_applicable'; message: string; missing?: Array<{ id: string; label: string }>; gaps?: string[] };

export function checkEquipmentP2h(p2h: P2hCtx | null): Raw {
	if (!p2h) return { status: 'not_applicable', message: 'N/A — data P2H equipment tidak diambil' };
	const equipment = Array.isArray(p2h.equipment) ? p2h.equipment : [];
	if (equipment.length === 0) return { status: 'not_applicable', message: 'N/A — proyek tidak memiliki equipment aktif di lokasi' };
	const done = new Set((p2h.doneIds || []).map(String));
	const missing = equipment.filter((e) => !done.has(String(e.id)));
	if (missing.length === 0) return { status: 'passed', message: `${equipment.length} unit equipment aktif sudah P2H (${fmtId(p2h.today)})` };
	const names = missing.slice(0, MAX_LIST).map((e) => e.label).join(', ');
	const more = missing.length > MAX_LIST ? ` +${missing.length - MAX_LIST} lainnya` : '';
	return {
		status: 'failed',
		message: `${missing.length} dari ${equipment.length} unit di lokasi belum P2H ${fmtId(p2h.today)}: ${names}${more}`,
		missing
	};
}

export function checkLaporanHarian(l: LaporanCtx | null): Raw {
	if (!l) return { status: 'not_applicable', message: 'N/A — data laporan harian tidak diambil' };
	if (!l.applicable) return { status: 'not_applicable', message: `N/A — ${l.naReason || 'proyek tidak wajib lapor harian'}` };
	const required = Array.isArray(l.required) ? l.required : [];
	if (required.length === 0) return { status: 'not_applicable', message: 'N/A — belum ada hari-wajib lapor dalam jendela evaluasi' };
	const reported = new Set(l.reported || []);
	const gaps = required.filter((d) => !reported.has(d));
	if (gaps.length === 0) return { status: 'passed', message: `Laporan harian lengkap untuk ${required.length} hari-wajib terakhir` };
	const list = gaps.slice(0, MAX_LIST).map(fmtId).join(', ');
	const more = gaps.length > MAX_LIST ? ` +${gaps.length - MAX_LIST} tanggal lain` : '';
	return {
		status: 'failed',
		message: `Laporan harian proyek belum diisi untuk tanggal ${list}${more}. Lengkapi laporan sebelum mengajukan packing list.`,
		gaps
	};
}

// ─── Loader (Directus) ───────────────────────────────────────────────────────
async function readRule(dx: Dx) {
	try {
		const r: any = (await dx('/items/laporan_compliance_rule/1'))?.data || {};
		return {
			hariWajib: Array.isArray(r.hari_wajib) ? r.hari_wajib : DEFAULT_HARI_WAJIB,
			windowHari: Number.isFinite(r.g10_harian_jendela_hari) ? r.g10_harian_jendela_hari : DEFAULT_WINDOW_HARI,
			statusWajib:
				Array.isArray(r.wajib_lapor_status_proyek) && r.wajib_lapor_status_proyek.length ? r.wajib_lapor_status_proyek : DEFAULT_STATUS_WAJIB,
			graceJam: r.briefing_batas_jam || DEFAULT_GRACE_JAM
		};
	} catch (e: any) {
		console.warn('[plDisiplinFieldGates] baca laporan_compliance_rule gagal, pakai default:', e?.message || e);
		return { hariWajib: DEFAULT_HARI_WAJIB, windowHari: DEFAULT_WINDOW_HARI, statusWajib: DEFAULT_STATUS_WAJIB, graceJam: DEFAULT_GRACE_JAM };
	}
}

async function loadP2h(dx: Dx, projectId: number, today: string, acceptFrom: string): Promise<P2hCtx> {
	const peFilter = encodeURIComponent(
		JSON.stringify({
			_and: [
				{ project_id: { _eq: projectId } },
				{ deployment_status: { _eq: 'aktif' } },
				{ _or: [{ mobilization_date: { _null: true } }, { mobilization_date: { _lte: today } }] },
				{ _or: [{ sumber_data: { _neq: 'bootstrap_p2h' } }, { confirmed_at: { _nnull: true } }] }
			]
		})
	);
	const pe: any[] = (await dx(`/items/project_equipment?filter=${peFilter}&fields=id,equipment_id&limit=-1`))?.data || [];
	const ids = [...new Set(pe.map((r) => asId(r.equipment_id)).filter(Boolean).map(String))];
	if (ids.length === 0) return { today, equipment: [], doneIds: [] };
	const [eq, sessions] = await Promise.all([
		dx(`/items/equipment?filter[id][_in]=${ids.join(',')}&fields=id,code,name&limit=-1`),
		dx(
			`/items/p2h_session?filter[equipment_id][_in]=${ids.join(',')}` +
				`&filter[date][_gte]=${acceptFrom}&filter[date][_lte]=${today}&fields=equipment_id&limit=-1`
		)
	]);
	const byId = new Map<string, any>((eq?.data || []).map((e: any) => [String(e.id), e]));
	return {
		today,
		equipment: ids.map((id) => {
			const e = byId.get(id);
			return { id, label: e ? (e.code ? `${e.code}${e.name ? ` — ${e.name}` : ''}` : e.name || id) : id };
		}),
		doneIds: [...new Set<string>((sessions?.data || []).map((s: any) => String(asId(s.equipment_id))))]
	};
}

async function loadLaporan(dx: Dx, projectId: number, today: string, rule: Awaited<ReturnType<typeof readRule>>, project: any): Promise<LaporanCtx> {
	if (!project) return { required: [], reported: [], applicable: false, naReason: 'proyek tidak ditemukan' };
	const status = String(project.status || '').toLowerCase();
	if (!rule.statusWajib.map((s: any) => String(s).toLowerCase()).includes(status)) {
		return { required: [], reported: [], applicable: false, naReason: `status proyek "${project.status || '-'}" tidak wajib lapor harian` };
	}
	const startYmd = toWibYmd(project.start_date);
	if (startYmd && startYmd >= today) return { required: [], reported: [], applicable: false, naReason: 'proyek belum mulai (mobilisasi awal)' };
	const required = computeRequiredReportDates({ todayYmd: today, hariWajib: rule.hariWajib, windowHari: rule.windowHari, startDate: startYmd });
	if (required.length === 0) return { required, reported: [], applicable: true };
	const gte = encodeURIComponent(`${required[0]}T00:00:00+07:00`);
	const lt = encodeURIComponent(`${addDays(required[required.length - 1], 1)}T00:00:00+07:00`);
	const rows: any[] =
		(await dx(`/items/reports?filter[project_id][_eq]=${projectId}&filter[date][_gte]=${gte}&filter[date][_lt]=${lt}&fields=date&limit=-1`))?.data || [];
	return { required, reported: [...new Set(rows.map((r) => toWibYmd(r.date)).filter(Boolean) as string[])], applicable: true };
}

// ─── G_PKL_READINESS — kesiapan data proyek (13 Okt 2026) ────────────────────
// Kembar dari erp-epi/src/lib/server/gates/plReadinessGate.js + resolveReadinessStatus (projectReadinessGate.js).
// Doktrin Aturan #3 identik: kickoff mati / proyek tak ada / dibuat sebelum project.kickoff.enforce_from /
// proyek TANPA Charter ⇒ not_applicable. Relasi dibaca PER QUERY (Aturan #2). Gagal baca ⇒ not_applicable (dilog).
const DEFAULT_ENFORCED_ITEMS = ['leader_assigned', 'charter_approved', 'rab_gt_zero', 'timeline_set'];
const BASE_LABELS: Record<string, string> = {
	leader_assigned: 'Project Leader ditunjuk',
	charter_approved: 'Charter disetujui',
	rab_gt_zero: 'RAB/RAP > 0',
	timeline_set: 'Timeline planning tersusun',
	...DATA_DASAR_LABELS
};

function parseSetting(raw: any, fallback: any) {
	if (raw == null) return fallback;
	try {
		return JSON.parse(raw);
	} catch {
		return raw;
	}
}

function timelineHasContent(tl: any): boolean {
	if (!tl) return false;
	let parsed = tl;
	if (typeof tl === 'string') {
		try {
			parsed = JSON.parse(tl);
		} catch {
			return tl.trim().length > 0;
		}
	}
	const subtasks = Array.isArray(parsed) ? parsed : parsed?.subtasks;
	return Array.isArray(subtasks) ? subtasks.length > 0 : !!parsed;
}

export interface ReadinessResult {
	status: 'passed' | 'failed' | 'not_applicable';
	message: string;
	missing: string[];
}

export async function loadReadiness(dx: Dx, projectId: number): Promise<ReadinessResult> {
	const na = (message: string): ReadinessResult => ({ status: 'not_applicable', message: `N/A — ${message}`, missing: [] });
	const keys = ['project.kickoff.enabled', 'project.kickoff.enforce_from', 'project.readiness.checklist', 'project.readiness.gate_extra_items'];
	const [settingsRes, projRes] = await Promise.all([
		dx(`/items/system_settings?filter[setting_key][_in]=${keys.join(',')}&fields=setting_key,setting_value&limit=-1`),
		dx(`/items/projects/${encodeURIComponent(String(projectId))}?fields=id,so_customer_id,leader,timeline_planning,date_created,end_date,lokasi,jenis_project`)
	]);
	const map = new Map<string, any>((settingsRes?.data || []).map((r: any) => [r.setting_key, r.setting_value]));
	if (parseSetting(map.get('project.kickoff.enabled'), true) === false) return na('gerbang persiapan dimatikan');
	const project = projRes?.data;
	if (!project) return na('proyek tidak ditemukan');

	const efRaw = parseSetting(map.get('project.kickoff.enforce_from'), null);
	const enforceFrom = typeof efRaw === 'string' && efRaw.trim() ? efRaw.slice(0, 10) : null;
	const created = project.date_created ? String(project.date_created).slice(0, 10) : null;
	if (enforceFrom && created && created < enforceFrom) return na(`proyek dibuat ${created} (sebelum ${enforceFrom})`);

	let charter: any = null;
	if (project.so_customer_id != null) {
		charter = (await dx(
			`/items/project_charters?filter[so_customer_id][_eq]=${encodeURIComponent(project.so_customer_id)}&fields=id,status,project_leader,timeline_planning&limit=1`
		))?.data?.[0] || null;
	}
	if (!charter) return na('proyek belum punya Project Charter');

	const rabRows: any[] = (await dx(`/items/project_budgets?filter[project_id][_eq]=${projectId}&fields=planned_amount&limit=-1`))?.data || [];
	const rabTotal = rabRows.reduce((sum, r) => sum + (Number(r.planned_amount) || 0), 0);

	const checklist = parseSetting(map.get('project.readiness.checklist'), null);
	const wajib: string[] = Array.isArray(checklist) ? checklist.filter((i: any) => i && i.wajib && i.id).map((i: any) => i.id) : DEFAULT_ENFORCED_ITEMS;
	const extraRaw = parseSetting(map.get('project.readiness.gate_extra_items'), null);
	const extra: string[] = Array.isArray(extraRaw) ? extraRaw : DEFAULT_GATE_EXTRA_ITEMS;
	const enforced = [...new Set([...(wajib.length ? wajib : DEFAULT_ENFORCED_ITEMS), ...extra])];

	const base: Record<string, boolean> = {
		leader_assigned: !!(charter.project_leader || project.leader || project.co_leader),
		charter_approved: charter.status === 'approved',
		rab_gt_zero: rabTotal > 0,
		timeline_set: timelineHasContent(charter.timeline_planning || project.timeline_planning)
	};
	const failedBase = enforced.filter((id) => id in base && !base[id]);
	const failed = [...failedBase, ...missingDataDasar(project, enforced)];
	if (failed.length === 0) return { status: 'passed', message: 'Data dasar proyek lengkap', missing: [] };
	const pct = Math.round(((enforced.length - failed.length) / enforced.length) * 100);
	return {
		status: 'failed',
		message: `Persiapan proyek baru ${pct}% — belum lengkap: ${failed.map((id) => BASE_LABELS[id] || id).join(', ')}. Lengkapi sebelum membuat Packing List.`,
		missing: failed
	};
}

// ─── Evaluasi + penggabungan ke hasil gate lapangan ─────────────────────────
export interface DisiplinInfo {
	gate_key: 'G_PKL_EQUIPMENT_P2H' | 'G_PKL_LAPORAN_HARIAN' | 'G_PKL_READINESS';
	label: string;
	mode: GateMode;
	status: 'passed' | 'failed' | 'not_applicable';
	message: string;
	project_id: number;
	fix_links: Array<{ label: string; href: string }>;
}

const LABELS = { G_PKL_EQUIPMENT_P2H: 'P2H equipment aktif proyek', G_PKL_LAPORAN_HARIAN: 'Disiplin laporan harian proyek', G_PKL_READINESS: 'Kesiapan data proyek' } as const;

/**
 * Evaluasi dua gate disiplin untuk satu proyek. Tidak pernah melempar: gagal baca ⇒ not_applicable.
 * `resolveMode` di-inject supaya pure/diuji tanpa Directus.
 */
export async function evaluateDisiplinForProject(
	projectId: number,
	dx: Dx,
	resolveMode: (gateKey: string) => Promise<GateMode> = (k) => resolveGateMode(k, 'PL'),
	now = new Date()
): Promise<DisiplinInfo[]> {
	const { ymd: today, minutes } = wibParts(now);
	const [rule, project, modeP2h, modeLap, modeReady] = await Promise.all([
		readRule(dx),
		dx(`/items/projects/${encodeURIComponent(String(projectId))}?fields=id,name,status,start_date`)
			.then((r: any) => r?.data || null)
			.catch((e: any) => {
				console.error(`[plDisiplinFieldGates] baca proyek ${projectId} gagal:`, e?.message || e);
				return null;
			}),
		resolveMode('G_PKL_EQUIPMENT_P2H').catch(() => 'shadow' as GateMode),
		resolveMode('G_PKL_LAPORAN_HARIAN').catch(() => 'shadow' as GateMode),
		resolveMode('G_PKL_READINESS').catch(() => 'shadow' as GateMode)
	]);
	const acceptFrom = minutes < hhmmToMinutes(rule.graceJam) ? addDays(today, -1) : today;

	const [p2h, laporan, ready] = await Promise.all([
		loadP2h(dx, projectId, today, acceptFrom).catch((e: any) => {
			console.error(`[plDisiplinFieldGates] baca P2H proyek ${projectId} gagal:`, e?.message || e);
			return null;
		}),
		loadLaporan(dx, projectId, today, rule, project).catch((e: any) => {
			console.error(`[plDisiplinFieldGates] baca laporan harian proyek ${projectId} gagal:`, e?.message || e);
			return null;
		}),
		loadReadiness(dx, projectId).catch((e: any) => {
			console.error(`[plDisiplinFieldGates] baca kesiapan proyek ${projectId} gagal:`, e?.message || e);
			return null;
		})
	]);

	const a = checkEquipmentP2h(p2h);
	const b = checkLaporanHarian(laporan);
	return [
		{
			gate_key: 'G_PKL_EQUIPMENT_P2H',
			label: LABELS.G_PKL_EQUIPMENT_P2H,
			mode: modeP2h,
			status: a.status,
			message: a.message,
			project_id: projectId,
			fix_links: (a.missing || []).slice(0, MAX_LIST).map((e) => ({ label: `Isi P2H ${e.label}`, href: `/preventive/p2h/${e.id}` }))
		},
		{
			gate_key: 'G_PKL_LAPORAN_HARIAN',
			label: LABELS.G_PKL_LAPORAN_HARIAN,
			mode: modeLap,
			status: b.status,
			message: b.message,
			project_id: projectId,
			fix_links: b.status === 'failed' ? [{ label: 'Tulis laporan harian proyek', href: `/laporan/${projectId}` }] : []
		},
		{
			gate_key: 'G_PKL_READINESS',
			label: LABELS.G_PKL_READINESS,
			mode: modeReady,
			status: ready?.status ?? 'not_applicable',
			message: ready?.message ?? 'N/A — data kesiapan proyek tidak diambil',
			project_id: projectId,
			fix_links: ready?.status === 'failed'
				? [{ label: ready.missing.includes('foto_proyek_set') ? 'Unggah foto awal & lengkapi data proyek' : 'Lengkapi data proyek', href: `/proyek/${projectId}` }]
				: []
		}
	];
}

export interface FieldPLResultWithDisiplin extends FieldPLResult {
	/** Semua hasil gate disiplin (termasuk shadow) — untuk banner Quick-Fix; bukan penentu blokir. */
	disiplin: DisiplinInfo[];
}

/**
 * Terapkan hasil disiplin ke FieldPLResult (pure). shadow tidak mengubah gates/warnings/blocking.
 */
export function mergeDisiplinIntoResult(base: FieldPLResult, info: DisiplinInfo[], opts: { overrideAllowed?: boolean } = {}): FieldPLResultWithDisiplin {
	const overrideAllowed = !!opts.overrideAllowed;
	const gates: FieldGate[] = [...base.gates];
	const blocking = [...base.blocking];
	const warnings = [...base.warnings];
	const overridden = [...base.overridden];

	// Satu entri per gate_key (agregasi bila pengajuan lintas proyek).
	const byKey = new Map<string, DisiplinInfo[]>();
	for (const d of info) byKey.set(d.gate_key, [...(byKey.get(d.gate_key) || []), d]);

	for (const [key, list] of byKey) {
		const mode = list[0].mode;
		if (mode === 'shadow') continue;
		const failed = list.filter((d) => d.status === 'failed');
		const applicable = list.filter((d) => d.status !== 'not_applicable');
		const multi = list.length > 1;
		const message = failed.length
			? failed.map((d) => (multi ? `Proyek #${d.project_id}: ${d.message}` : d.message)).join(' | ')
			: applicable.length
				? list.find((d) => d.status === 'passed')!.message
				: list[0].message;
		const label = list[0].label;
		const fixLinks = failed.flatMap((d) => d.fix_links);

		if (!failed.length) {
			gates.push({ gate_key: key, label, severity: 'SEMI', status: applicable.length ? 'passed' : 'not_applicable', message });
			continue;
		}
		if (mode === 'hard' && !overrideAllowed) {
			gates.push({ gate_key: key, label, severity: 'WAJIB', status: 'failed', message, fix_links: fixLinks });
			blocking.push(key);
		} else if (mode === 'hard') {
			gates.push({ gate_key: key, label, severity: 'SEMI', status: 'failed', message: `${message} — DILEWATI (override super admin/GM)`, overridden: true, fix_links: fixLinks });
			overridden.push(key);
		} else {
			gates.push({ gate_key: key, label, severity: 'SEMI', status: 'failed', message: `${message} Pengajuan tetap bisa dikirim.`, fix_links: fixLinks });
			warnings.push(key);
		}
	}

	const status = blocking.length ? 'blocked' : warnings.length ? 'soft_warning' : 'passed';
	return { gates, status, blocking, warnings, overridden, override_allowed: overrideAllowed, disiplin: info };
}

/**
 * Pengganti evaluateFieldPLGatesFor di titik pemanggil: gate lama + gate disiplin proyek.
 * Kegagalan evaluasi disiplin TIDAK melempar (fail-open); gate lama tetap melempar seperti sebelumnya.
 */
export async function evaluateFieldPLGatesWithDisiplin(
	rows: FieldPLRow[],
	dx: Dx,
	opts: { overrideAllowed?: boolean } = {}
): Promise<FieldPLResultWithDisiplin> {
	const base = await evaluateFieldPLGatesFor(rows, dx, opts);
	const projectIds = [...new Set(rows.map((r) => r.project_id).filter(Boolean).map(Number))].filter((n) => Number.isFinite(n));
	try {
		const info = (await Promise.all(projectIds.map((pid) => evaluateDisiplinForProject(pid, dx)))).flat();
		return mergeDisiplinIntoResult(base, info, opts);
	} catch (e: any) {
		console.warn('[plDisiplinFieldGates] evaluasi disiplin gagal (fail-open):', e?.message || e);
		return { ...base, disiplin: [] };
	}
}
