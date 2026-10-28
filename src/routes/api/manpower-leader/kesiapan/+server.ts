// src/routes/api/manpower-leader/kesiapan/+server.ts
// Check-in kesiapan fisik & mental kru saat toolbox meeting (Safety & Fatigue Readiness).
// Di server: hanya pemegang kursi leader di proyek itu yang boleh mencatat, hanya untuk anggota
// aktif proyek itu, hanya untuk HARI INI (WIB) — bukan untuk dibackfill agar tidak jadi formalitas.
// Upsert per (proyek, tanggal, manpower), jadi mengulang simpan di hari yang sama memperbarui.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateManpowerLeader } from '$lib/server/manpowerLeaderGuard';
import { directusServerJson } from '$lib/server/directus';
import { validasiCheckin, tindakanDisarankan, type CheckinInput } from '$lib/shared/kesiapanKru';

const idOf = (v: any) => (v && typeof v === 'object' ? v.id : v);
const hariIniWib = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });

export const GET: RequestHandler = async (event) => {
	const projectId = Number(event.url.searchParams.get('project_id'));
	if (!Number.isFinite(projectId)) throw error(400, 'project_id wajib diisi.');
	await authenticateManpowerLeader(event, projectId);
	const tanggal = hariIniWib();
	const r = await directusServerJson<{ data: any[] }>(
		`/items/kesiapan_kru_checkin?filter[project_id][_eq]=${projectId}&filter[tanggal][_eq]=${tanggal}` +
			`&fields=id,manpower_id,kondisi_fisik,kondisi_mental,tidur_cukup,tindakan,catatan&limit=-1`
	);
	return json({ tanggal, data: r?.data || [] });
};

export const POST: RequestHandler = async (event) => {
	const body = await event.request.json().catch(() => null);
	const projectId = Number(body?.project_id);
	if (!Number.isFinite(projectId)) throw error(400, 'project_id wajib diisi.');
	const items: CheckinInput[] = Array.isArray(body?.items) ? body.items : [];
	if (!items.length) throw error(400, 'Tidak ada data check-in.');
	if (items.length > 200) throw error(400, 'Terlalu banyak data.');

	const { manpower } = await authenticateManpowerLeader(event, projectId);
	const tanggal = hariIniWib();

	// anggota aktif proyek ini (cegah menulis untuk orang di luar regu)
	const assign = await directusServerJson<{ data: any[] }>(
		`/items/manpower_assignment?filter[project_id][_eq]=${projectId}&filter[status][_eq]=aktif&fields=manpower_id&limit=-1`
	);
	const anggota = new Set((assign?.data || []).map((a) => Number(idOf(a.manpower_id))));

	for (const it of items) {
		if (!anggota.has(Number(it.manpower_id))) throw error(400, `Manpower #${it.manpower_id} bukan anggota aktif proyek ini.`);
		const salah = validasiCheckin(it);
		if (salah) throw error(400, salah);
	}

	const existing = await directusServerJson<{ data: any[] }>(
		`/items/kesiapan_kru_checkin?filter[project_id][_eq]=${projectId}&filter[tanggal][_eq]=${tanggal}&fields=id,manpower_id&limit=-1`
	);
	const idByMp = new Map<number, number>((existing?.data || []).map((e) => [Number(e.manpower_id), e.id]));

	let baru = 0;
	let diperbarui = 0;
	for (const it of items) {
		const payload = {
			project_id: projectId,
			manpower_id: Number(it.manpower_id),
			tanggal,
			kondisi_fisik: it.kondisi_fisik,
			kondisi_mental: it.kondisi_mental,
			tidur_cukup: it.tidur_cukup === false ? false : true,
			tindakan: it.tindakan || tindakanDisarankan(it),
			catatan: String(it.catatan ?? '').trim() || null,
			dicatat_oleh: manpower.id
		};
		const eid = idByMp.get(payload.manpower_id);
		if (eid) {
			await directusServerJson(`/items/kesiapan_kru_checkin/${eid}`, { method: 'PATCH', body: JSON.stringify(payload) });
			diperbarui++;
		} else {
			await directusServerJson('/items/kesiapan_kru_checkin', { method: 'POST', body: JSON.stringify(payload) });
			baru++;
		}
	}
	return json({ success: true, tanggal, baru, diperbarui });
};
