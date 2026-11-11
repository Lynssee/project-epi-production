// src/routes/api/proyek/[project_id]/dossier-readiness/+server.ts
// Visibilitas Leader Fase 3 — data mentah Kesiapan Dokumentasi Lapangan (presensi, log harian, QC ambient, LPJ) satu proyek.
// READ-ONLY, TANPA nominal rupiah. Auth: scope SAMA dengan pa-status (role manajemen / leader / co-leader / manpower leader).
// Query dipisah per relasi (Aturan #2) & berjalan bersamaan; sumber opsional gagal -> bagian itu null + warning
// (BUKAN dianggap lengkap) supaya kegagalan tidak menyamar sebagai "aman". Gerbang/ambang dibaca dari system_settings
// project.field_dossier.* (tanpa hardcode); jendela hari & libur mingguan dipakai server untuk menentukan rentang query.

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveFieldProjectScope } from '$lib/server/fieldProjectScope';
import { directusServerJson } from '$lib/server/directus';
import { wibParts, toWibYmd, addDays } from '$lib/server/gates/plDisiplinFieldGates';
import { requiredDays, DEFAULT_THRESHOLDS } from '$lib/utils/dossierReadiness';
import { readSettingsNamespace } from '$lib/server/fieldSettings';

const NS = 'project.field_dossier.';
const DAY_MS = 86_400_000;

const isHoldReport = (r: any) => r?.activity_status === 'hold';
function parseJson(v: any): any {
	if (v == null) return null;
	if (typeof v !== 'string') return v;
	try {
		return JSON.parse(v);
	} catch {
		return null;
	}
}

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

	// Setelan + proyek dulu (dibutuhkan untuk rentang tanggal); keduanya independen -> bersamaan.
	const [setRes, projRes] = await Promise.all([
		readSettingsNamespace(NS),
		directusServerJson<{ data: any }>(`/items/projects/${projectId}?fields=id,status,start_date`).then(
			(r) => r?.data ?? null,
			(e: any) => {
				console.error(`[dossier-readiness] proyek ${projectId}: gagal baca projects:`, e?.message);
				throw error(502, 'Gagal memuat data proyek.');
			}
		)
	]);
	if (!projRes) throw error(404, 'Proyek tidak ditemukan.');

	const cfg = setRes.cfg; // gagal baca -> {} -> default di bawah (sudah dicatat oleh pembaca)
	const enabled = cfg[`${NS}enabled`] !== false;
	const windowDays = Number(cfg[`${NS}window_days`]) > 0 ? Number(cfg[`${NS}window_days`]) : 7;
	const offWeekdays = Array.isArray(cfg[`${NS}off_weekdays`]) ? (cfg[`${NS}off_weekdays`] as unknown[]).map(Number) : [0];
	const okPct = Number(cfg[`${NS}ok_pct`]) > 0 ? Number(cfg[`${NS}ok_pct`]) : DEFAULT_THRESHOLDS.okPct;
	const warnPct = Number(cfg[`${NS}warn_pct`]) > 0 ? Number(cfg[`${NS}warn_pct`]) : DEFAULT_THRESHOLDS.warnPct;
	// Masa tenggang LPJ sejak dana cair sebelum dihitung "lewat" (Aturan #3: tidak menandai mundur secara kaku).
	const rawGrace = cfg[`${NS}lpj_grace_days`];
	const lpjGraceDays = rawGrace != null && Number(rawGrace) >= 0 ? Number(rawGrace) : 7;

	const status = String(projRes.status || '').trim().toLowerCase();
	// Hanya relevan setelah proyek berjalan; sebelum itu (persiapan) atau sesudah closed kartu tidak ditampilkan.
	if (!enabled || status !== 'on progress') {
		return json({ success: true, data: { applicable: false, reason: !enabled ? 'disabled' : 'status', generated_at: new Date().toISOString() } });
	}

	const todayYmd = wibParts().ymd;
	const startYmd = toWibYmd(projRes.start_date);
	const days = requiredDays({ todayYmd, windowDays, offWeekdays, startYmd });
	if (!days.length) {
		return json({
			success: true,
			data: { applicable: true, days, absensiDates: [], absensiMenunggu: 0, reportDates: [], qcRequiredDays: [], qcDoneDays: [], lpj: null, thresholds: { okPct, warnPct }, warnings, generated_at: new Date().toISOString() }
		});
	}
	const from = days[0];
	const to = days[days.length - 1];

	const [absRes, repRes, teamRes, lpjRes] = await Promise.all([
		optional<{ tanggal: string; verifikasi_leader_status: string | null }>(
			`/items/manpower_absensi?filter[project_id][_eq]=${projectId}&filter[tanggal][_gte]=${from}&filter[tanggal][_lte]=${to}&fields=tanggal,verifikasi_leader_status&limit=-1`
		),
		// reports.date = datetime (UTC) -> rentang dilebarkan sehari lalu dikonversi ke tanggal WIB di bawah.
		// Satu query laporan dipakai untuk log harian DAN QC ambient (hemat API). qc_ambient/progress = JSON.
		optional<{ date: string; activity_status: string | null; qc_ambient: any; progress: any }>(
			`/items/reports?filter[project_id][_eq]=${projectId}&filter[date][_gte]=${addDays(from, -1)}&filter[date][_lte]=${addDays(to, 1)}T23:59:59&fields=date,activity_status,qc_ambient,progress&limit=-1`
		),
		optional<{ id: number }>(`/items/manpower_assignment?filter[project_id][_eq]=${projectId}&fields=id&limit=1`),
		// LPJ: HANYA yang eksplisit "belum" — pengajuan lama bernilai null (sebelum fitur SPJ) tidak dihitung (Aturan #3).
		optional<{ id: number; tanggal_dicairkan: string | null }>(
			`/items/pengajuan_anggaran?filter[project_id][_eq]=${projectId}&filter[status_pertanggungjawaban][_eq]=belum&fields=id,tanggal_dicairkan&sort=id&limit=-1`
		)
	]);

	let absensiDates: string[] | null = null;
	let absensiMenunggu = 0;
	if (absRes.ok) {
		absensiDates = [...new Set(absRes.rows.map((r) => String(r.tanggal || '').slice(0, 10)).filter(Boolean))];
		absensiMenunggu = absRes.rows.filter((r) => (r.verifikasi_leader_status || 'menunggu') === 'menunggu').length;
		// Proyek tanpa tim terdaftar & tanpa presensi sama sekali: indikator presensi tidak berlaku (bukan 0%).
		if (!absRes.rows.length && teamRes.ok && teamRes.rows.length === 0) absensiDates = null;
	} else {
		console.error(`[dossier-readiness] proyek ${projectId}: gagal baca manpower_absensi:`, absRes.message);
		warnings.push('Data presensi gagal dimuat — indikator presensi tidak ditampilkan.');
	}

	let reportDates: string[] | null = null;
	let qcRequiredDays: string[] | null = null;
	let qcDoneDays: string[] | null = null;
	if (repRes.ok) {
		const inWindow = new Set(days);
		reportDates = [...new Set(repRes.rows.map((r) => toWibYmd(r.date)).filter((d): d is string => !!d))].sort();
		// QC ambient wajib hanya pada laporan proyek coating/blasting (qc_ambient.applicable) yang ada progres & bukan Hold —
		// aturan SAMA dengan gate G_LH_QC_AMBIENT di form laporan harian.
		const req = new Set<string>();
		const done = new Set<string>();
		for (const r of repRes.rows) {
			const d = toWibYmd(r.date);
			if (!d || !inWindow.has(d)) continue;
			const qc = parseJson(r.qc_ambient);
			if (!qc?.applicable || isHoldReport(r)) continue;
			const progress = parseJson(r.progress);
			if (!Array.isArray(progress) || progress.length === 0) continue;
			req.add(d);
			if (qc.filled_today) done.add(d);
		}
		qcRequiredDays = [...req].sort();
		qcDoneDays = [...done].sort();
	} else {
		console.error(`[dossier-readiness] proyek ${projectId}: gagal baca reports:`, repRes.message);
		warnings.push('Data laporan harian gagal dimuat — indikator log harian tidak ditampilkan.');
	}

	let lpj: { belum: number; overdue: number; firstId: number | null } | null = null;
	if (lpjRes.ok) {
		const cutoff = Date.now() - lpjGraceDays * DAY_MS;
		const overdueRows = lpjRes.rows.filter((r) => {
			const t = r.tanggal_dicairkan ? new Date(r.tanggal_dicairkan).getTime() : NaN;
			return Number.isFinite(t) && t < cutoff;
		});
		lpj = { belum: lpjRes.rows.length, overdue: overdueRows.length, firstId: (overdueRows[0] ?? lpjRes.rows[0])?.id ?? null };
	} else {
		console.error(`[dossier-readiness] proyek ${projectId}: gagal baca pengajuan_anggaran (SPJ):`, lpjRes.message);
		warnings.push('Status LPJ gagal dimuat — indikator Kasbon/LPJ tidak ditampilkan.');
	}

	return json({
		success: true,
		data: {
			applicable: true,
			days,
			absensiDates,
			absensiMenunggu,
			reportDates,
			qcRequiredDays,
			qcDoneDays,
			lpj,
			absensiFailed: !absRes.ok,
			reportsFailed: !repRes.ok,
			thresholds: { okPct, warnPct },
			warnings,
			generated_at: new Date().toISOString()
		}
	});
}
