import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateDriver } from '$lib/server/driver/driverGuard';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';

/**
 * POD (Bukti Pengiriman) untuk trip jenis logistik_harian — dicatat di fleet_trip_log,
 * BUKAN fleet_shipments (koleksi itu untuk paket lewat ekspedisi pihak ketiga, lihat
 * fleet_expeditions). Menerima multipart/form-data: foto & tanda tangan diunggah ke
 * Directus /files lewat token server, lalu id file dipakai untuk PATCH trip.
 */
export const POST: RequestHandler = async (event) => {
	const { driver } = await authenticateDriver(event);
	const tripId = event.params.id;

	const form = await event.request.formData().catch(() => null);
	if (!form) throw error(400, 'Form data tidak valid.');

	const penerimaNama = String(form.get('penerima_nama') || '').trim();
	const status = String(form.get('status') || '').trim(); // 'tiba' | 'gagal'
	const catatan = String(form.get('catatan') || '').trim();
	const lat = form.get('lat') != null ? Number(form.get('lat')) : null;
	const lng = form.get('lng') != null ? Number(form.get('lng')) : null;
	const foto = form.get('foto'); // File
	const ttd = form.get('ttd'); // File (signature)

	if (status !== 'tiba' && status !== 'gagal') throw error(400, 'Status POD tidak valid.');
	if (status === 'tiba' && !penerimaNama) throw error(400, 'Nama penerima wajib diisi bila status Tiba.');

	const tripQuery = new URLSearchParams({
		'filter[id][_eq]': tripId,
		'filter[driver_id][_eq]': driver.id,
		limit: '1'
	});
	const tripRes = await directusServerJson<{ data: any[] }>(`/items/fleet_trip_log?${tripQuery.toString()}`);
	const trip = tripRes?.data?.[0];
	if (!trip) throw error(404, 'Trip tidak ditemukan atau bukan milik Anda.');
	if (trip.jenis !== 'logistik_harian') throw error(400, 'POD hanya berlaku untuk trip jenis logistik harian.');

	let fotoId: string | null = null;
	let ttdId: string | null = null;

	if (foto instanceof File && foto.size > 0) {
		const uploadForm = new FormData();
		uploadForm.append('file', foto);
		const res = await directusServerUpload(uploadForm);
		if (!res.ok) throw error(502, 'Gagal mengunggah foto POD.');
		const uploaded = await res.json();
		fotoId = uploaded?.data?.id ?? null;
	}

	if (ttd instanceof File && ttd.size > 0) {
		const uploadForm = new FormData();
		uploadForm.append('file', ttd);
		const res = await directusServerUpload(uploadForm);
		if (!res.ok) throw error(502, 'Gagal mengunggah tanda tangan POD.');
		const uploaded = await res.json();
		ttdId = uploaded?.data?.id ?? null;
	}

	const patch: Record<string, unknown> = {
		pod_status: status,
		pod_penerima_nama: penerimaNama || null,
		pod_catatan: catatan || null,
		pod_waktu_tiba: new Date().toISOString(),
		pod_lat: Number.isFinite(lat) ? lat : null,
		pod_lng: Number.isFinite(lng) ? lng : null
	};
	if (fotoId) patch.pod_foto = fotoId;
	if (ttdId) patch.pod_ttd = ttdId;

	const result = await directusServerJson<{ data: any }>(`/items/fleet_trip_log/${tripId}`, {
		method: 'PATCH',
		body: JSON.stringify(patch)
	});

	return json({ record: result?.data ?? result });
};
