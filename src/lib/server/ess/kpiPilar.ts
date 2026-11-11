// src/lib/server/ess/kpiPilar.ts
// 4 Pilar KPI Karyawan untuk ESS (General / Teknis / Administrasi / Inovasi). Salinan setia dari
// erp-epi/src/lib/utils/kpiPilarKaryawan.js (logika murni) + pembaca setelan app_settings 'kpi_engine'
// (cache 60 dtk). Bobot & mode diatur Super Admin di Pengaturan > Mesin KPI (erp-epi); tidak ada angka tetap di sini
// selain bawaan darurat. Mode 'off' -> ESS tidak menampilkan pilar. 'shadow'/'on' -> tampil (label simulasi bila shadow).

import { directusServerJson } from '$lib/server/directus';

export type PilarKey = 'general' | 'teknis' | 'administrasi' | 'inovasi';
export const PILAR_URUT: PilarKey[] = ['general', 'teknis', 'administrasi', 'inovasi'];
export const DEFAULT_PILAR_WEIGHTS: Record<PilarKey, number> = { general: 25, teknis: 45, administrasi: 20, inovasi: 10 };

const DATASOURCE_PILAR: Record<string, PilarKey> = {
	absensi: 'general', absensi_harian: 'general', absensi_alpa: 'general', rekap_absensi_bulanan: 'general', rekap_absensi_bulanan_only: 'general',
	sanksi_karyawan: 'general', training_enrollment: 'general', silabus_jabatan: 'general', tutorial_adoption: 'general',
	skill_kompetensi_jabatan: 'general', skill_sertifikat_expired: 'general', sop_training_compliance: 'general', sop_readiness_pct: 'general',
	peer_review_360: 'inovasi',
	reports: 'administrasi', project_report_compliance: 'administrasi', project_readiness_ontime: 'administrasi', project_charter_speed: 'administrasi',
	approval_sla_speed: 'administrasi', pr_approval_speed: 'administrasi', gate_compliance: 'administrasi', revenue_ops_invoice_timeliness: 'administrasi',
	hr_payroll_approval_dept: 'administrasi', hrd_kpi_finalization_dept: 'administrasi', hrd_data_completeness_dept: 'administrasi',
	ga_checklist_compliance_dept: 'administrasi', project_report_compliance_dept: 'administrasi', project_readiness_ontime_dept: 'administrasi',
	project_charter_speed_dept: 'administrasi'
};
const NAME_RULES: [PilarKey, RegExp][] = [
	['inovasi', /360|kepemimpinan|leadership|inisiatif|inovasi|kaizen|koordinasi tim|perilaku|sikap kerja|budaya/i],
	['administrasi', /laporan|administrasi|dokumen|berkas|\bsla\b|lpj|kasbon|approval|persetujuan|gate|tertib/i],
	['general', /kehadiran|absensi|kedisiplinan|disiplin|sanksi|\bsp\b|pelatihan|training|kompetensi|\bsop\b|onboarding/i]
];

const isPilar = (p: unknown): p is PilarKey => PILAR_URUT.includes(p as PilarKey);
const fin = (v: unknown): number | null => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
const r1 = (v: number) => Math.round(v * 10) / 10;

export function pilarOf(ind: { data_source?: string | null; name?: string | null }, overrideMap?: Record<string, unknown> | null): PilarKey {
	const ds = String(ind.data_source ?? '').trim();
	const name = String(ind.name ?? '').trim();
	if (overrideMap) {
		for (const key of [name.toLowerCase(), ds]) {
			const p = key ? String(overrideMap[key] ?? '').trim().toLowerCase() : '';
			if (isPilar(p)) return p;
		}
	}
	if (ds && DATASOURCE_PILAR[ds]) return DATASOURCE_PILAR[ds];
	for (const [pilar, re] of NAME_RULES) if (re.test(name)) return pilar;
	return 'teknis';
}

function sanitize(raw: unknown): Record<PilarKey, number> | null {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
	const o = raw as Record<string, unknown>;
	const out = {} as Record<PilarKey, number>;
	let sum = 0;
	for (const p of PILAR_URUT) {
		const n = fin(o[p]);
		out[p] = n != null && n > 0 ? n : 0;
		sum += out[p];
	}
	return sum > 0 ? out : null;
}

export interface PilarSkor { score: number | null; weight: number; effectiveWeight: number; terukur: number; total: number }
export interface PilarKaryawan {
	mode: 'shadow' | 'on';
	composite: number | null;
	pilars: Record<PilarKey, PilarSkor>;
	missing: PilarKey[];
}
export interface PilarConfig {
	mode: 'off' | 'shadow' | 'on';
	perDept: Record<string, unknown>;
	globalDefault: Record<string, unknown>;
	overrideMap: Record<string, unknown>;
}

const asArr = (v: unknown): any[] => {
	if (Array.isArray(v)) return v;
	if (typeof v === 'string') { try { const p = JSON.parse(v || '[]'); return Array.isArray(p) ? p : []; } catch { return []; } }
	return [];
};

/** Hitung pilar dari targets + sumber_perhitungan tersimpan. null bila mode off / tak ada indikator. */
export function hitungPilar(rec: { departemen?: string | null; targets?: unknown; sumber_perhitungan?: unknown }, cfg: PilarConfig): PilarKaryawan | null {
	if (cfg.mode === 'off') return null;
	const targets = asArr(rec.targets);
	const sumber = asArr(rec.sumber_perhitungan);
	if (targets.length === 0) return null;
	const byName = new Map(sumber.filter((s) => s?.indikator).map((s) => [s.indikator, s]));
	const w = sanitize(cfg.perDept?.[String(rec.departemen || '').trim().toUpperCase()]) || sanitize(cfg.globalDefault) || DEFAULT_PILAR_WEIGHTS;

	const acc = Object.fromEntries(PILAR_URUT.map((p) => [p, { sum: 0, w: 0, n: 0, scored: 0 }])) as Record<PilarKey, { sum: number; w: number; n: number; scored: number }>;
	targets.forEach((t, i) => {
		const s = (sumber[i]?.indikator === t?.name ? sumber[i] : byName.get(t?.name)) || {};
		const p = pilarOf({ data_source: s.data_source, name: t?.name }, cfg.overrideMap);
		const wt = fin(t?.weight) ?? 0;
		const skor = fin(s.skor);
		acc[p].n += 1;
		if ((s.terukur ?? t?.terukur) && skor != null && wt > 0) { acc[p].sum += skor * wt; acc[p].w += wt; acc[p].scored += 1; }
	});
	const scoreOf = (p: PilarKey) => (acc[p].w > 0 ? r1(acc[p].sum / acc[p].w) : null);
	let covered = 0;
	for (const p of PILAR_URUT) if (scoreOf(p) != null) covered += w[p] || 0;

	let composite = 0;
	const missing: PilarKey[] = [];
	const pilars = {} as Record<PilarKey, PilarSkor>;
	for (const p of PILAR_URUT) {
		const score = scoreOf(p);
		if (score == null) missing.push(p);
		else if (covered > 0) composite += score * ((w[p] || 0) / covered);
		pilars[p] = { score, weight: w[p] || 0, effectiveWeight: score != null && covered > 0 ? r1(((w[p] || 0) / covered) * 100) : 0, terukur: acc[p].scored, total: acc[p].n };
	}
	return { mode: cfg.mode, composite: covered > 0 ? r1(composite) : null, pilars, missing };
}

const obj = (v: unknown): Record<string, unknown> => {
	if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
	try { const o = JSON.parse(String(v ?? '{}')); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; }
};

let cache: { at: number; value: PilarConfig } | null = null;

/** Setelan 4 Pilar dari app_settings kpi_engine (1 query, cache 60 dtk). Gagal baca -> 'off' (ESS tidak menampilkan, tak menebak). */
export async function loadPilarConfig(): Promise<PilarConfig> {
	if (cache && Date.now() - cache.at < 60_000) return cache.value;
	let value: PilarConfig = { mode: 'off', perDept: {}, globalDefault: {}, overrideMap: {} };
	try {
		const res = await directusServerJson<{ data: { setting_key: string; setting_value: unknown }[] }>(
			`/items/app_settings?filter[module][_eq]=kpi_engine&filter[setting_key][_starts_with]=pilar_&fields=setting_key,setting_value&limit=-1`
		);
		const m = new Map((res?.data || []).map((r) => [r.setting_key, r.setting_value]));
		const mode = String(m.get('pilar_karyawan_mode') ?? 'shadow').trim().toLowerCase();
		value = {
			mode: mode === 'off' || mode === 'on' ? mode : 'shadow',
			perDept: obj(m.get('pilar_karyawan_bobot_per_dept')),
			globalDefault: obj(m.get('pilar_karyawan_bobot_default')),
			overrideMap: obj(m.get('pilar_indikator_map'))
		};
	} catch (e) {
		console.error('[ess/kpiPilar] gagal baca setelan pilar, pilar disembunyikan:', (e as Error)?.message);
	}
	cache = { at: Date.now(), value };
	return value;
}
