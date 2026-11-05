// src/routes/api/site-checkin/planning/+server.ts
// Modul Perencanaan Site Visit Karyawan (Fase 3 Penajaman Absensi).
// Menyimpan jadwal rencana kunjungan (site visit) harian dengan jam mulai, jam selesai,
// agenda rinci, dan status rencana untuk rekonsiliasi rencana vs aktual.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const tanggal = event.url.searchParams.get('tanggal') || todayJakarta();

	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawan.id),
		'filter[tanggal_rencana][_eq]': tanggal,
		'filter[is_planned][_eq]': 'true',
		sort: 'planned_start_time',
		fields: 'id,karyawan_id,tanggal_rencana,planned_start_time,planned_end_time,planned_agenda,nama_lokasi,tipe_checkin,referensi_id,is_planned,plan_status,alasan_deviasi,check_in_at,check_out_at,durasi_menit,status',
		limit: '-1'
	});

	try {
		const res = await directusServerJson<{ data: any[] }>(`/items/site_checkin?${query.toString()}`);
		return json({ plans: res?.data || [] });
	} catch (e) {
		console.error('[site-checkin/planning GET] Gagal mengambil daftar rencana:', e);
		throw error(500, 'Gagal mengambil daftar rencana kunjungan.');
	}
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	let body: any;
	try {
		body = await event.request.json();
	} catch {
		throw error(400, 'Format payload JSON tidak valid.');
	}

	const tanggalRencana = body.tanggal_rencana?.toString()?.trim() || todayJakarta();
	const plannedStartTime = body.planned_start_time?.toString()?.trim() || '';
	const plannedEndTime = body.planned_end_time?.toString()?.trim() || '';
	const namaLokasi = body.nama_lokasi?.toString()?.trim() || '';
	const plannedAgenda = body.planned_agenda?.toString()?.trim() || '';
	const tipeCheckin = body.tipe_checkin?.toString()?.trim() || 'proyek';
	const referensiId = body.referensi_id != null ? Number(body.referensi_id) : null;

	if (!namaLokasi) {
		throw error(400, 'Nama lokasi/site tujuan kunjungan wajib diisi.');
	}
	if (!plannedStartTime || !plannedEndTime) {
		throw error(400, 'Jam mulai dan jam selesai rencana kunjungan wajib diisi.');
	}
	if (!plannedAgenda) {
		throw error(400, 'Agenda detail kunjungan wajib diisi.');
	}
	if (plannedStartTime >= plannedEndTime) {
		throw error(400, 'Jam selesai rencana harus lebih besar dari jam mulai.');
	}

	const payload = {
		karyawan_id: String(karyawan.id),
		tanggal_rencana: tanggalRencana,
		planned_start_time: plannedStartTime,
		planned_end_time: plannedEndTime,
		planned_agenda: plannedAgenda,
		nama_lokasi: namaLokasi,
		tipe_checkin: tipeCheckin,
		referensi_id: referensiId,
		is_planned: true,
		plan_status: 'planned',
		status: 'planned'
	};

	try {
		const res = await directusServerJson<{ data: any }>('/items/site_checkin', {
			method: 'POST',
			body: JSON.stringify(payload)
		});
		return json({ success: true, plan: res?.data });
	} catch (e) {
		console.error('[site-checkin/planning POST] Gagal membuat rencana kunjungan:', e);
		throw error(500, 'Gagal menyimpan rencana kunjungan ke server.');
	}
};

export const PATCH: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	let body: any;
	try {
		body = await event.request.json();
	} catch {
		throw error(400, 'Format payload JSON tidak valid.');
	}

	const id = body.id;
	const action = body.action || 'cancel'; // 'cancel' | 'deviate'
	const alasanDeviasi = body.alasan_deviasi?.toString()?.trim() || '';

	if (!id) {
		throw error(400, 'ID rencana kunjungan tidak ditentukan.');
	}
	if (!alasanDeviasi) {
		throw error(400, 'Alasan pembatalan/deviasi rencana kunjungan wajib diisi.');
	}

	// Pastikan record milik karyawan yang login
	const planRes = await directusServerJson<{ data: any }>(`/items/site_checkin/${id}?fields=id,karyawan_id,plan_status`).catch(() => null);
	if (!planRes?.data || String(planRes.data.karyawan_id) !== String(karyawan.id)) {
		throw error(403, 'Anda tidak berhak mengubah rencana kunjungan ini.');
	}

	const newPlanStatus = action === 'cancel' ? 'cancelled' : 'missed';
	const updatePayload = {
		plan_status: newPlanStatus,
		alasan_deviasi: alasanDeviasi
	};

	try {
		const res = await directusServerJson<{ data: any }>(`/items/site_checkin/${id}`, {
			method: 'PATCH',
			body: JSON.stringify(updatePayload)
		});
		return json({ success: true, plan: res?.data });
	} catch (e) {
		console.error('[site-checkin/planning PATCH] Gagal mengupdate rencana:', e);
		throw error(500, 'Gagal memperbarui rencana kunjungan.');
	}
};
