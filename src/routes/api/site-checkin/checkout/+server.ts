// src/routes/api/site-checkin/checkout/+server.ts
// POST: check-out manual (multipart/form-data: checkin_id, lat?, lng?, accuracy?, foto?,
// kegiatan?/temuan?/tindak_lanjut?/rencana_besok? — 4 field kunjungan, dijembatani ke
// project_visit_leader oleh closeCheckin() bila kill-switch tulis_visit_leader_aktif aktif)

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { closeCheckin, findCheckinByClientTxnId } from '$lib/server/siteCheckin';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const form = await event.request.formData();
	let checkinId = form.get('checkin_id')?.toString() || null;
	const lat = form.get('lat') != null ? Number(form.get('lat')) : null;
	const lng = form.get('lng') != null ? Number(form.get('lng')) : null;
	const akurasi = form.get('accuracy') != null ? Number(form.get('accuracy')) : null;
	const foto = form.get('foto');
	// Paket 02 §3.9 — idempotensi replay checkout offline (pola sama client_txn_id check-in).
	const clientTxnId = form.get('client_txn_id')?.toString() || null;
	const clientCreatedAt = form.get('client_created_at')?.toString() || null;
	// Paket 02 §3.9.2 (worst case I) — checkout diantrekan sebelum checkin_id server diketahui
	// (check-in pasangannya SENDIRI masih/baru tersinkron). Klien mengirim checkin_client_txn_id
	// sebagai gantinya; server yang mencari baris check-in-nya.
	const checkinClientTxnId = form.get('checkin_client_txn_id')?.toString() || null;

	if (!checkinId && checkinClientTxnId) {
		const resolved = await findCheckinByClientTxnId(String(karyawan.id), checkinClientTxnId);
		if (!resolved) {
			// 425 (Too Early) — RETRYABLE di klien (lihat isRetryableError di
			// $lib/utils/networkError.ts): check-in pasangannya kemungkinan besar akan
			// tersinkron sebentar lagi (flush berurutan createdAt), bukan error permanen.
			throw error(425, 'Check-in pasangannya belum tersinkron ke server. Coba lagi nanti.');
		}
		checkinId = resolved.id;
	}

	if (!checkinId) {
		throw error(400, 'checkin_id wajib diisi.');
	}

	try {
		const record = await closeCheckin({
			checkinId,
			karyawanId: String(karyawan.id),
			karyawanNama: karyawan.nama_karyawan,
			method: 'manual',
			lat: lat != null && Number.isFinite(lat) ? lat : null,
			lng: lng != null && Number.isFinite(lng) ? lng : null,
			akurasi,
			foto: foto instanceof File && foto.size > 0 ? foto : null,
			clientTxnId,
			clientCreatedAt,
			kegiatan: form.get('kegiatan')?.toString() || null,
			temuan: form.get('temuan')?.toString() || null,
			tindakLanjut: form.get('tindak_lanjut')?.toString() || null,
			rencanaBesok: form.get('rencana_besok')?.toString() || null,
			// "4-Gate Site Visit System" Fase 3 — form checkout tipe 'marketing'.
			picDitemui: form.get('pic_ditemui')?.toString() || null,
			jabatanPic: form.get('jabatan_pic')?.toString() || null,
			noWaPic: form.get('no_wa_pic')?.toString() || null,
			hasilMeeting: form.get('hasil_meeting')?.toString() || null,
			statusBant: (() => {
				const raw = form.get('status_bant')?.toString();
				if (!raw) return null;
				try {
					return JSON.parse(raw);
				} catch {
					return null;
				}
			})(),
			nextAction: form.get('next_action')?.toString() || null,
			followUpDate: form.get('follow_up_date')?.toString() || null,
			// "4-Gate Site Visit System" Fase 3c — form checkout tipe 'maintenance'.
			serviceLog: form.get('service_log')?.toString() || null,
			sparepartDipakai: form.get('sparepart_dipakai')?.toString() || null,
			statusUnit: form.get('status_unit')?.toString() || null,
			hourMeter: form.get('hour_meter') != null && form.get('hour_meter') !== '' ? Number(form.get('hour_meter')) : null
		});
		return json({ record });
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Gagal check-out');
	}
};
