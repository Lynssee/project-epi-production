// src/routes/api/preventive/pm/selesai/+server.ts
// PMT-51 — mekanik menandai tugas PM selesai dari HP. Menggantikan completePmTask() klien yang (a) langsung gagal selama kategori
// status PM belum ada, dan (b) bila berjalan akan menandai tracker "Completed" SEKALIGUS memajukan due_date sehingga tugas berulang
// hilang selamanya dari daftar. Model baru: 1 baris pm_due_tracker = 1 siklus. Selesai → baris ditandai Completed (riwayat), dan SATU
// baris baru dibuat untuk siklus berikutnya (selesai + interval kalender). Foto wajib hanya bila ada temuan. Idempoten server-side.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticatePreventiveOperator } from '$lib/server/preventive/preventiveGuard';
import { directusServerJson } from '$lib/server/directus';
import { getMleSettingServer } from '$lib/server/mleSettings';
import { nextDueDate } from '$lib/server/preventive/pmNext';

// Sama dengan P2H_WO_IDS di p2h/submit/+server.ts — jangan diubah sepihak.
const WO = {
	MINOR: '5e393139-0ff7-426a-8673-3af319161663',
	CORRECTIVE: '561ad0b7-c246-4c24-bb66-5cc7e123fbda',
	STATUS_OPEN: '0e119df1-b7e5-44c1-ace4-d14c5a99c10b'
};
const ID_RE = /^[0-9a-f-]{36}$/i;
const wibToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const asId = (v: any) => (v && typeof v === 'object' ? v.id : v);

export const POST: RequestHandler = async (event) => {
	const { personnel } = await authenticatePreventiveOperator(event);
	const body = await event.request.json().catch(() => null);
	const trackerId = body?.tracker_id ? String(body.tracker_id) : '';
	const adaTemuan = body?.ada_temuan === true;
	const foto = body?.foto_id ? String(body.foto_id) : null;
	const catatan = body?.catatan ? String(body.catatan).trim().slice(0, 2000) : null;
	const hm = typeof body?.hoursmeter === 'number' && Number.isFinite(body.hoursmeter) ? body.hoursmeter : null;

	if (!ID_RE.test(trackerId)) throw error(400, 'tracker_id tidak valid.');
	if (adaTemuan && !foto) throw error(400, 'Foto temuan wajib dilampirkan bila ada temuan.');
	if (adaTemuan && !catatan) throw error(400, 'Jelaskan temuan pada catatan.');

	// Referensi status PM — wajib ada (Active/Completed). Pesan jelas bila belum.
	const cats = (await directusServerJson<{ data: any[] }>(`/items/category?filter[group][_in]=pm_status,interval_unit&fields=id,name,group&limit=-1`))?.data || [];
	const status = Object.fromEntries(cats.filter((c) => c.group === 'pm_status').map((c) => [c.name, c.id]));
	const satuan = new Map(cats.filter((c) => c.group === 'interval_unit').map((c) => [String(c.id), c.name]));
	if (!status.Completed || !status.Active) throw error(503, 'Kategori status PM (Active/Completed) belum ada di Directus. Hubungi admin.');

	let tracker: any = null;
	try {
		tracker = (await directusServerJson<{ data: any }>(`/items/pm_due_tracker/${trackerId}?fields=id,equipment_id,pm_task_template_id,due_date,status_id`))?.data;
	} catch (err: any) {
		if (/\b40[34]\b|not exist|does not exist/i.test(String(err?.message))) throw error(404, 'Tugas PM tidak ditemukan.');
		console.error('[pm/selesai] gagal membaca tracker', trackerId, err);
		throw error(502, 'Gagal membaca tugas PM dari server. Coba lagi.');
	}
	if (!tracker) throw error(404, 'Tugas PM tidak ditemukan.');
	if (String(asId(tracker.status_id)) === String(status.Completed)) throw error(409, 'Tugas PM ini sudah ditandai selesai.');

	const equipmentId = String(asId(tracker.equipment_id));
	const templateId = tracker.pm_task_template_id ? String(asId(tracker.pm_task_template_id)) : null;
	const template = templateId
		? (await directusServerJson<{ data: any }>(`/items/pm_task_template/${templateId}?fields=id,task_name,interval_value_primary,interval_unit_primary`).catch((e) => {
				console.error('[pm/selesai] gagal membaca template', templateId, e);
				return null;
			}))?.data
		: null;
	const doneDate = wibToday();

	await directusServerJson(`/items/pm_due_tracker/${trackerId}`, {
		method: 'PATCH',
		body: JSON.stringify({
			status_id: status.Completed,
			last_done_date: doneDate,
			...(hm != null ? { last_done_hoursmeter: hm } : {}),
			catatan_selesai: catatan,
			foto_selesai: foto,
			ada_temuan: adaTemuan,
			selesai_oleh: personnel.name
		})
	});

	// Siklus berikutnya (hanya interval kalender). Idempoten: jangan buat bila sudah ada tracker terbuka untuk pasangan yang sama.
	let berikutnya: string | null = null;
	if (template && templateId) {
		const due = nextDueDate(doneDate, template.interval_value_primary, satuan.get(String(asId(template.interval_unit_primary))));
		if (due) {
			const terbuka = (
				await directusServerJson<{ data: any[] }>(
					`/items/pm_due_tracker?filter[equipment_id][_eq]=${equipmentId}&filter[pm_task_template_id][_eq]=${templateId}&filter[status_id][_neq]=${status.Completed}&fields=id&limit=1`
				)
			)?.data || [];
			if (terbuka.length === 0) {
				await directusServerJson('/items/pm_due_tracker', {
					method: 'POST',
					body: JSON.stringify({ equipment_id: equipmentId, pm_task_template_id: templateId, due_date: due, status_id: status.Active })
				});
				berikutnya = due;
			}
		}
	}

	// Temuan → WO minor (mengikuti setelan P2H auto-WO). Gagal membuat WO TIDAK membatalkan penutupan PM, tapi dicatat di log.
	let workOrderId: string | null = null;
	if (adaTemuan) {
		try {
			if (await getMleSettingServer('mle.equipment.p2h_auto_wo', true)) {
				const wo = await directusServerJson<{ data: any }>('/items/work_order', {
					method: 'POST',
					body: JSON.stringify({
						equipment_id: equipmentId,
						keluhan: `[Temuan PM ${template?.task_name || ''}] ${catatan}`,
						kategori_perbaikan_id: WO.MINOR,
						jenis_pekerjaan_id: WO.CORRECTIVE,
						order_status: WO.STATUS_OPEN,
						tanggal_rusak: doneDate,
						is_quick_create: true,
						alasan_pengajuan: 'Auto PM bulanan — mekanik melaporkan temuan'
					})
				});
				workOrderId = wo?.data?.id ?? null;
			}
		} catch (err) {
			console.error('[pm/selesai] gagal membuat WO temuan untuk tracker', trackerId, err);
		}
	}

	return json({ ok: true, selesai: doneDate, berikutnya, workOrderId });
};
