// src/routes/api/laporan/tutup-bulan/+server.ts
// "Tutup Bulan" Laporan Bulanan Terpadu (dashboard lapangan): checklist kelengkapan laporan harian + narasi Project Leader.
//   GET  ?projectId=<int>&period=YYYY-MM → { success, project, period, checklist, warnings, narasi, schemaReady, narasiError, photoCandidates }
//   POST { projectId, period, action:'save'|'close'|'reopen', kendala_utama, rencana_bulan_depan, catatan_manajemen, photo_ids[] } → { success, narasi }
// Akses: user login yang proyeknya dalam cakupannya (view_all_projects / leader-co-leader proyek) — pola sama dgn aiProjectScope.
// Tulis memakai TOKEN SERVER ke koleksi `laporan_bulanan_narasi` (skema: erp-epi/scripts/laporan-bulanan-narasi-schema.mjs, diterapkan Lead).
// Koleksi belum ada ⇒ GET tetap jalan (schemaReady:false), POST dijawab 503 dengan pesan jelas — bukan diam-diam.
// Penutupan TIDAK pernah diblokir oleh kekurangan data (hanya peringatan); tidak ada gate baru (pemeriksaan "bulan ditutup" ada di gate cetak erp-epi, mode shadow).
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { getUserPermissions } from '$lib/server/rbacServer';
import { resolveProjectScope, isProjectAllowed } from '$lib/server/aiProjectScope';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { directusServerJson } from '$lib/server/directus';
import { periodRange, isValidPeriod, currentPeriod, buildChecklist, closeWarnings, photoCandidatesOf, validateNarasiInput } from '$lib/utils/tutupBulan';

const NARASI_FIELDS = 'id,project_id,period,kendala_utama,rencana_bulan_depan,catatan_manajemen,photo_ids,status,closed_at,closed_by,closed_by_name';
const REPORT_FIELDS = 'id,date,status,progress,progress_photos,area_kerja_photos,toolbox_photos,issue_photos,hse_daily';

async function authorize(event: Parameters<RequestHandler>[0], projectId: number) {
	const user = await requireUser(event);
	const idToken = (event.request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
	const perms = await getUserPermissions(idToken, user.localId, { email: user.email });
	const scope = await resolveProjectScope(perms.permissions, user.email || null);
	if (!isProjectAllowed(scope, projectId)) throw error(403, 'Proyek ini di luar cakupan akses Anda.');
	return user;
}

const narasiUrl = (projectId: number, period: string) =>
	`/items/laporan_bulanan_narasi?filter[project_id][_eq]=${projectId}&filter[period][_eq]=${period}&fields=${NARASI_FIELDS}&limit=1`;

export const GET: RequestHandler = async (event) => {
	const q = event.url.searchParams;
	const projectId = Number(q.get('projectId'));
	if (!Number.isInteger(projectId) || projectId <= 0) throw error(400, 'projectId wajib berupa angka.');
	const period = q.get('period') || currentPeriod();
	if (!isValidPeriod(period)) throw error(400, 'period harus format YYYY-MM.');
	await authorize(event, projectId);
	const range = periodRange(period)!;

	let projRes: any; let repRes: any;
	try {
		// Dua sumber utama, query terpisah (Aturan #2); gagal = dilaporkan (bukan data kosong).
		[projRes, repRes] = await Promise.all([
			directusServerJson(`/items/projects/${projectId}?fields=id,name,nomor_po`),
			directusServerJson(`/items/reports?filter[project_id][_eq]=${projectId}&filter[date][_gte]=${range.start}&filter[date][_lt]=${range.endExclusive}&sort=date&fields=${REPORT_FIELDS}&limit=-1`)
		]);
	} catch (e: any) {
		console.error('[laporan/tutup-bulan] baca proyek/laporan gagal:', e?.message || e);
		throw error(502, `Data laporan harian gagal dibaca: ${e?.message || 'tidak diketahui'}`);
	}

	let narasi: any = null; let schemaReady = true; let narasiError: string | null = null;
	try {
		narasi = (await directusServerJson<{ data: any[] }>(narasiUrl(projectId, period)))?.data?.[0] ?? null;
	} catch (e: any) {
		schemaReady = false;
		narasiError = e?.message || String(e);
		console.warn('[laporan/tutup-bulan] koleksi laporan_bulanan_narasi tak terbaca (skema belum diterapkan?):', narasiError);
	}

	const reports = repRes?.data || [];
	const checklist = buildChecklist(reports, period);
	return json({ success: true, project: projRes?.data || { id: projectId }, period, checklist, warnings: closeWarnings(checklist, narasi), narasi, schemaReady, narasiError, photoCandidates: photoCandidatesOf(reports) });
};

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => ({}));
	const v = validateNarasiInput(body);
	if (!v.ok) throw error(400, v.error);
	const { projectId, period, action } = v.value;
	const user = await authorize(event, projectId);

	let existing: any = null;
	try {
		existing = (await directusServerJson<{ data: any[] }>(narasiUrl(projectId, period)))?.data?.[0] ?? null;
	} catch (e: any) {
		console.error('[laporan/tutup-bulan] koleksi narasi tak terbaca:', e?.message || e);
		throw error(503, 'Fitur Tutup Bulan belum aktif: skema laporan_bulanan_narasi belum diterapkan (hubungi Lead).');
	}

	const data: Record<string, any> = {
		project_id: projectId, period,
		kendala_utama: v.value.kendala_utama, rencana_bulan_depan: v.value.rencana_bulan_depan, catatan_manajemen: v.value.catatan_manajemen, photo_ids: v.value.photo_ids,
		status: existing?.status === 'closed' ? 'closed' : 'draft'
	};
	if (action === 'close') {
		const karyawan = await getKaryawanByFirebaseUid(user.localId).catch((e: any) => { console.warn('[laporan/tutup-bulan] cari karyawan gagal:', e?.message || e); return null; });
		Object.assign(data, { status: 'closed', closed_at: new Date().toISOString(), closed_by: karyawan?.id ?? null, closed_by_name: karyawan?.nama_karyawan ?? user.email ?? null });
	} else if (action === 'reopen') {
		Object.assign(data, { status: 'draft', closed_at: null, closed_by: null, closed_by_name: null });
	}

	try {
		const res = existing
			? await directusServerJson<{ data: any }>(`/items/laporan_bulanan_narasi/${existing.id}`, { method: 'PATCH', body: JSON.stringify(data) })
			: await directusServerJson<{ data: any }>('/items/laporan_bulanan_narasi', { method: 'POST', body: JSON.stringify(data) });
		return json({ success: true, action, narasi: res?.data ?? { ...existing, ...data } });
	} catch (e: any) {
		console.error('[laporan/tutup-bulan] simpan gagal:', e?.message || e);
		throw error(502, `Gagal menyimpan: ${e?.message || 'tidak diketahui'}`);
	}
};
