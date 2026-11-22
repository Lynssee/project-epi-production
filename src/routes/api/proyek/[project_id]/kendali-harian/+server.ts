// src/routes/api/proyek/[project_id]/kendali-harian/+server.ts
// Fase 4 (Penajaman KPI & Drilldown Detail Dept) — data mentah "Kartu Kendali Harian" Project Leader, SATU panggilan untuk 3 kartu:
//   (1) tanggal-tanggal yang punya Laporan Harian (kalender kepatuhan),
//   (2) kasbon/uang muka yang belum di-LPJ (umur dihitung di klien dengan tanggal "hari ini" server),
//   (3) baseline Kurva S + deret realisasi kumulatif (deviasi minggu berjalan dihitung di klien).
// READ-ONLY, TANPA nominal rupiah (kebijakan Lead: Leader melihat persen/umur saja). Auth: scope SAMA dengan dossier-readiness.
// Query dipisah per relasi (Aturan #2), berjalan bersamaan; sumber yang gagal -> bagian itu null + warning
// (BUKAN dianggap aman). Setelan dari system_settings project.field_kendali.* / project.field_dossier.lpj_grace_days.

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveFieldProjectScope } from '$lib/server/fieldProjectScope';
import { directusServerJson } from '$lib/server/directus';
import { wibParts, toWibYmd, addDays } from '$lib/server/gates/plDisiplinFieldGates';
import { readSettingsNamespace } from '$lib/server/fieldSettings';
import { actualCumulativeSeries } from '$lib/utils/fieldSCurve';

const NS = 'project.field_kendali.';
const DOSSIER_NS = 'project.field_dossier.';
const MAX_ACTUAL_POINTS = 120;

function parseJson(v: any): any {
	if (v == null) return null;
	if (typeof v !== 'string') return v;
	try {
		return JSON.parse(v);
	} catch {
		return null;
	}
}

const clampInt = (v: unknown, lo: number, hi: number, def: number) => {
	const n = Math.trunc(Number(v));
	return Number.isFinite(n) && n >= lo && n <= hi ? n : def;
};

export async function GET(event: RequestEvent) {
	const user = await requireUser(event);
	const projectId = Number(event.params.project_id);
	if (!Number.isSafeInteger(projectId) || projectId <= 0) throw error(400, 'project_id tidak valid.');

	const idToken = (event.request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
	const scope = await resolveFieldProjectScope(idToken, user.localId, user.email);
	if (!scope.unrestricted && !scope.projectIds.includes(projectId)) {
		throw error(403, 'Anda tidak memegang proyek ini (bukan Leader, Co-Leader, atau Manpower Leader proyek ini).');
	}

	const warnings: string[] = [];
	const optional = <T>(url: string) =>
		directusServerJson<{ data: T[] }>(url).then(
			(r) => ({ ok: true as const, rows: r?.data || [] }),
			(e: any) => ({ ok: false as const, message: e?.message as string | undefined })
		);

	// Setelan (satu query untuk dua namespace: prefix bersama) + proyek: independen -> bersamaan.
	const [setRes, projRes] = await Promise.all([
		readSettingsNamespace('project.field_'),
		directusServerJson<{ data: any }>(
			`/items/projects/${projectId}?fields=id,status,start_date,end_date,so_customer_id,timeline_planning`
		).then(
			(r) => r?.data ?? null,
			(e: any) => {
				console.error(`[kendali-harian] proyek ${projectId}: gagal baca projects:`, e?.message);
				throw error(502, 'Gagal memuat data proyek.');
			}
		)
	]);
	if (!projRes) throw error(404, 'Proyek tidak ditemukan.');

	const cfg = setRes.cfg; // gagal baca -> {} -> default di bawah (sudah dicatat oleh pembaca)
	const enabled = cfg[`${NS}enabled`] !== false;
	const status = String(projRes.status || '').trim().toLowerCase();
	// Hanya relevan saat proyek berjalan; sebelum itu (persiapan) atau sesudah closed kartu tidak ditampilkan.
	if (!enabled || status !== 'on progress') {
		return json({ success: true, data: { applicable: false, reason: !enabled ? 'disabled' : 'status', generated_at: new Date().toISOString() } });
	}

	const calendarDays = clampInt(cfg[`${NS}calendar_days`], 7, 62, 28);
	const offWeekdays = Array.isArray(cfg[`${NS}off_weekdays`])
		? (cfg[`${NS}off_weekdays`] as unknown[]).map(Number)
		: Array.isArray(cfg[`${DOSSIER_NS}off_weekdays`])
			? (cfg[`${DOSSIER_NS}off_weekdays`] as unknown[]).map(Number)
			: [0];
	const tolerancePct = Number(cfg[`${NS}scurve_tolerance_pct`]) >= 0 && cfg[`${NS}scurve_tolerance_pct`] != null ? Number(cfg[`${NS}scurve_tolerance_pct`]) : 5;
	const rawGrace = cfg[`${DOSSIER_NS}lpj_grace_days`];
	const lpjGraceDays = rawGrace != null && Number(rawGrace) >= 0 ? Number(rawGrace) : 7;
	const showCalendar = cfg[`${NS}show_calendar`] !== false;
	const showLpj = cfg[`${NS}show_lpj`] !== false;
	const showScurve = cfg[`${NS}show_scurve`] !== false;

	const todayYmd = wibParts().ymd;
	const startYmd = toWibYmd(projRes.start_date);
	const fromYmd = addDays(todayYmd, -(calendarDays - 1));

	// Kurva S hanya relevan bila timeline punya subtask; tanpa itu, baseline & progres tak berguna (hemat query).
	const planning = parseJson(projRes.timeline_planning);
	const hasSubtasks = (planning?.categories || []).some((c: any) => (c?.subtasks || []).length > 0);
	const needScurve = showScurve && hasSubtasks;

	// Baseline: SO utama proyek; jatuh ke so_customer.project_id bila projects.so_customer_id kosong.
	const soCustomerId = async (): Promise<number | null> => {
		const direct = Number(projRes.so_customer_id?.id ?? projRes.so_customer_id);
		if (Number.isFinite(direct) && direct > 0) return direct;
		const r = await optional<{ id: number }>(`/items/so_customer?filter[project_id][_eq]=${projectId}&fields=id&limit=1`);
		return r.ok && r.rows[0]?.id ? Number(r.rows[0].id) : null;
	};
	const baselineQuery = async () => {
		const so = await soCustomerId();
		if (!so) return { ok: true as const, rows: [] as Array<{ scurve_baseline: any }> };
		return optional<{ scurve_baseline: any }>(
			`/items/so_rab?filter[so_customer_id][_eq]=${so}&filter[scurve_baseline][_nnull]=true&fields=scurve_baseline&sort=-id&limit=1`
		);
	};

	const [repRes, lpjRes, baseRes] = await Promise.all([
		// reports.date = datetime (UTC) -> rentang dilebarkan sehari lalu dikonversi ke tanggal WIB.
		// Progres (JSON berat) hanya diminta bila Kurva S dipakai; saat itu SEMUA laporan dibaca (kumulatif butuh seluruh riwayat).
		showCalendar || needScurve
			? optional<{ date: string; progress?: any }>(
					needScurve
						? `/items/reports?filter[project_id][_eq]=${projectId}&fields=date,progress&sort=date&limit=-1`
						: `/items/reports?filter[project_id][_eq]=${projectId}&filter[date][_gte]=${addDays(fromYmd, -1)}&filter[date][_lte]=${addDays(todayYmd, 1)}T23:59:59&fields=date&limit=-1`
				)
			: Promise.resolve(null),
		// LPJ: HANYA yang eksplisit "belum" — pengajuan lama bernilai null (sebelum fitur SPJ) tidak dihitung (Aturan #3).
		showLpj
			? optional<{ id: number; nomor_pengajuan: string | null; tujuan_pengajuan: string | null; tanggal_dicairkan: string | null }>(
					`/items/pengajuan_anggaran?filter[project_id][_eq]=${projectId}&filter[status_pertanggungjawaban][_eq]=belum&fields=id,nomor_pengajuan,tujuan_pengajuan,tanggal_dicairkan&sort=tanggal_dicairkan&limit=50`
				)
			: Promise.resolve(null),
		needScurve ? baselineQuery() : Promise.resolve(null)
	]);

	let reportDates: string[] | null = null;
	let scurve: { baseline: Array<{ d: string; p: number }> | null; actual: Array<{ d: string; p: number }>; hasSubtasks: boolean; tolerancePct: number } | null = null;
	if (repRes) {
		if (repRes.ok) {
			const all = repRes.rows.map((r) => toWibYmd(r.date)).filter((d): d is string => !!d);
			reportDates = [...new Set(all)].filter((d) => d >= fromYmd).sort();
			if (needScurve) {
				// Deret aktual: basis & aturan SAMA dengan FieldSCurve di halaman Laporan (actualCumulativeSeries).
				const actual = actualCumulativeSeries(repRes.rows.map((r) => ({ date: toWibYmd(r.date), progress: r.progress })), projRes).slice(-MAX_ACTUAL_POINTS);
				let baseline: Array<{ d: string; p: number }> | null = null;
				if (baseRes?.ok) {
					const b = parseJson(baseRes.rows[0]?.scurve_baseline);
					baseline = Array.isArray(b) && b.length ? b : null;
				} else if (baseRes) {
					console.error(`[kendali-harian] proyek ${projectId}: gagal baca so_rab baseline:`, baseRes.message);
					warnings.push('Baseline Kurva S gagal dimuat — kartu deviasi tidak ditampilkan.');
					scurve = null;
				}
				if (!baseRes || baseRes.ok) scurve = { baseline, actual, hasSubtasks, tolerancePct };
			}
		} else {
			console.error(`[kendali-harian] proyek ${projectId}: gagal baca reports:`, repRes.message);
			warnings.push('Data laporan harian gagal dimuat — kalender & deviasi tidak ditampilkan.');
		}
	}
	if (showScurve && !hasSubtasks) scurve = { baseline: null, actual: [], hasSubtasks: false, tolerancePct };

	let lpj: Array<{ id: number; nomor_pengajuan: string | null; tujuan_pengajuan: string | null; tanggal_dicairkan: string | null }> | null = null;
	if (lpjRes) {
		if (lpjRes.ok) lpj = lpjRes.rows;
		else {
			console.error(`[kendali-harian] proyek ${projectId}: gagal baca pengajuan_anggaran (SPJ):`, lpjRes.message);
			warnings.push('Status LPJ gagal dimuat — daftar kasbon belum LPJ tidak ditampilkan.');
		}
	}

	return json({
		success: true,
		data: {
			applicable: true,
			today: todayYmd,
			startYmd,
			calendarDays,
			offWeekdays,
			show: { calendar: showCalendar, lpj: showLpj, scurve: showScurve },
			reportDates: showCalendar ? reportDates : null,
			reportsFailed: !!repRes && !repRes.ok,
			lpj,
			lpjFailed: !!lpjRes && !lpjRes.ok,
			lpjGraceDays,
			scurve,
			warnings,
			generated_at: new Date().toISOString()
		}
	});
}
