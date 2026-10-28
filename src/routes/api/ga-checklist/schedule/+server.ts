import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';

/**
 * Ruangan tanggung jawab karyawan login hari ini -- BUKAN lagi berbasis
 * ga_checklist_schedule (Fase 5, rencana v2 GA Ruangan↔Barang↔Checklist, 16 Sep 2026,
 * keputusan Q2 opsi C "buang jadwal, pakai Cakupan Harian"):
 *
 * Audit 16 Sep 2026 menemukan ga_checklist_schedule TIDAK PERNAH berfungsi --
 * scheduled_date tersimpan sebagai tanggal statis yang tidak pernah di-expand jadi
 * occurrence harian (27 baris total, sebagian besar tanggal Juli), sehingga endpoint
 * lama (filter scheduled_date=hari ini) HAMPIR SELALU kosong. 695 respons/30 hari
 * yang benar-benar masuk semuanya lewat scan QR patroli, bukan lewat jadwal ini.
 *
 * Sumber kebenaran baru: ga_areas.assigned_staff_ids (siapa PIC tetap ruangan) --
 * field yang sama dipakai src/routes/api/ga-checklist/checkpoint/resolve/+server.ts
 * untuk validasi submit. "Hari ini" di sini murni untuk cek status existing_response,
 * bukan untuk memfilter apakah ruangan "dijadwalkan" -- ruangan tanggung jawab selalu
 * muncul setiap hari (itulah "Cakupan Harian": kerjakan ruangan Anda tiap hari, tanpa
 * jadwal formal).
 *
 * PENGECUALIAN (19 Sep 2026, ditemukan saat sinkron dengan Major): fitur "Kontrol
 * Patroli Fase 1" (submit/+server.ts) menulis baris BARU ke ga_checklist_schedule untuk
 * checklist remedial saat checklist menyimpang (skor rendah/ada temuan) -- lihat komentar
 * "R8 Kontrol Patroli" di sana. Baris ini konkret (satu tanggal pasti, dibuat saat
 * dibutuhkan), BUKAN baris rekurensi mati yang diaudit 16 Sep -- jadi TETAP dibaca di sini
 * sebagai tambahan, supaya reminder-nya tidak hilang untuk konteks route-based (satpam/
 * patroli) yang areanya biasanya tidak ada di assigned_staff_ids.
 */
export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const today = todayJakarta();

	// _contains JSON array tidak konsisten lintas backend Directus (SQLite vs Postgres) --
	// filter dilakukan di klien, pola sama checkpoint/resolve & delegasi di bawah.
	const areasRes = await directusServerJson<{ data: any[] }>(
		`/items/ga_areas?${new URLSearchParams({
			limit: '-1',
			fields: 'id,area_name,template_id,template_ids,assigned_staff_ids'
		}).toString()}`
	);
	const allAreas = areasRes?.data || [];

	function resolveTemplateId(area: any): number | null {
		const templateIds = Array.isArray(area.template_ids) && area.template_ids.length ? area.template_ids : [area.template_id].filter(Boolean);
		return templateIds[0] ?? null;
	}

	const mineAreas = allAreas.filter(
		(a) => Array.isArray(a.assigned_staff_ids) && a.assigned_staff_ids.map(String).includes(String(karyawan.id))
	);
	const areaIds = mineAreas.map((a) => a.id);

	const responsesRes = await directusServerJson<{ data: any[] }>(
		`/items/ga_checklist_responses?${new URLSearchParams({
			'filter[area_id][_in]': areaIds.length ? areaIds.join(',') : '0',
			'filter[filled_by][_eq]': String(karyawan.id),
			'filter[submitted_at][_gte]': `${today}T00:00:00`,
			limit: '-1',
			fields: 'id,area_id,status,scoring_result,submitted_at'
		}).toString()}`
	);
	const responsesByArea: Record<string, any> = Object.fromEntries((responsesRes?.data || []).map((r) => [r.area_id, r]));

	// R4 (rencana v2 Fase 6, 16 Sep 2026): "Ruangan Anda" -- petugas tidak pernah lihat
	// skor riwayatnya sendiri. Jumlah area tanggung jawab per karyawan kecil (biasanya
	// 1-3), jadi satu query 30 hari terbatas ke areaIds miliknya sendiri -- BUKAN
	// query global 28 ruangan (itu urusan endpoint admin gaRuanganAdminApi.js).
	const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString();
	const history30Res = areaIds.length
		? await directusServerJson<{ data: any[] }>(
				`/items/ga_checklist_responses?${new URLSearchParams({
					'filter[area_id][_in]': areaIds.join(','),
					'filter[filled_by][_eq]': String(karyawan.id),
					'filter[submitted_at][_gte]': since30,
					limit: '-1',
					fields: 'area_id,scoring_result'
				}).toString()}`
			).catch(() => ({ data: [] }))
		: { data: [] };
	const stats30ByArea: Record<string, { avg: number; count: number }> = {};
	for (const r of history30Res?.data || []) {
		const key = String(r.area_id);
		if (!stats30ByArea[key]) stats30ByArea[key] = { avg: 0, count: 0 };
		stats30ByArea[key].avg += r.scoring_result || 0;
		stats30ByArea[key].count += 1;
	}
	for (const key of Object.keys(stats30ByArea)) {
		stats30ByArea[key].avg = Math.round((stats30ByArea[key].avg / stats30ByArea[key].count) * 10) / 10;
	}

	const items = mineAreas
		.map((a) => ({
			id: `assigned-${a.id}`,
			area_id: a.id,
			template_id: resolveTemplateId(a),
			checklist_type: 'routine' as const,
			status: 'assigned',
			area: { id: a.id, area_name: a.area_name },
			existing_response: responsesByArea[a.id] || null,
			stats_30d: stats30ByArea[String(a.id)] || null
		}))
		.filter((it) => it.template_id != null);

	// Delegasi user per item checklist (ga_checklist_items.delegated_staff_ids): karyawan yang
	// didelegasikan pada item tertentu tetap harus melihat checklist area-nya di sini walau bukan
	// PIC tetap area (assigned_staff_ids). Logika ini TIDAK BERUBAH dari sebelumnya -- sudah
	// berbasis area/template, tidak pernah bergantung pada ga_checklist_schedule.
	const alreadyCoveredAreaIds = new Set(items.map((it) => it.area_id));
	const itemsRes = await directusServerJson<{ data: any[] }>(
		`/items/ga_checklist_items?${new URLSearchParams({ limit: '-1', fields: 'id,template_id,delegated_staff_ids' }).toString()}`
	);
	const delegatedTemplateIds = new Set(
		(itemsRes?.data || [])
			.filter((it) => Array.isArray(it.delegated_staff_ids) && it.delegated_staff_ids.map(String).includes(String(karyawan.id)))
			.map((it) => it.template_id)
			.filter(Boolean)
	);
	if (delegatedTemplateIds.size > 0) {
		for (const area of allAreas) {
			if (alreadyCoveredAreaIds.has(area.id)) continue;
			const areaTemplateIds = Array.isArray(area.template_ids) && area.template_ids.length ? area.template_ids : [area.template_id].filter(Boolean);
			const matchedTemplateId = areaTemplateIds.find((tid: number) => delegatedTemplateIds.has(tid));
			if (!matchedTemplateId) continue;
			alreadyCoveredAreaIds.add(area.id);
			items.push({
				id: `delegated-${area.id}`,
				area_id: area.id,
				template_id: matchedTemplateId,
				checklist_type: 'routine',
				status: 'delegated',
				area: { id: area.id, area_name: area.area_name },
				existing_response: responsesByArea[area.id] || null,
				stats_30d: stats30ByArea[String(area.id)] || null
			});
		}
	}

	// Remedial dari Kontrol Patroli Fase 1 (lihat komentar modul di atas) -- hanya baris
	// HARI INI, status belum 'done', assigned_to_ids berisi karyawan ini. Area yang SUDAH
	// tercakup (assigned/delegated) dilewati supaya tidak dobel kartu untuk area yang sama.
	const remedialRes = await directusServerJson<{ data: any[] }>(
		`/items/ga_checklist_schedule?${new URLSearchParams({
			'filter[scheduled_date][_eq]': today,
			'filter[status][_neq]': 'done',
			limit: '-1'
		}).toString()}`
	);
	const myRemedial = (remedialRes?.data || []).filter(
		(s) => Array.isArray(s.assigned_to_ids) && s.assigned_to_ids.map(String).includes(String(karyawan.id)) && !alreadyCoveredAreaIds.has(s.area_id)
	);
	for (const s of myRemedial) {
		alreadyCoveredAreaIds.add(s.area_id);
		const area = allAreas.find((a) => a.id === s.area_id);
		items.push({
			id: `remedial-${s.id}`,
			area_id: s.area_id,
			template_id: s.template_id,
			checklist_type: s.checklist_type || 'routine',
			status: 'remedial',
			area: area ? { id: area.id, area_name: area.area_name } : { id: s.area_id, area_name: `Ruangan #${s.area_id}` },
			existing_response: responsesByArea[s.area_id] || null,
			stats_30d: stats30ByArea[String(s.area_id)] || null
		});
	}

	return json({ date: today, items });
};
