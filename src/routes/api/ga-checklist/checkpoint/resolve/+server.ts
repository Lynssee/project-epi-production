import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';
import { getRoomMeta, getRoomItemCount } from '$lib/server/gaRuanganMeta';
import { getGaAsetSettings } from '$lib/server/gaAsetSettings';

/**
 * Resolusi QR untuk tombol "Scan" universal & /scan/[code] (rencana konsolidasi
 * GA/Security 2026-07-13, Fase 2). Satu QR discan tanpa perlu pilih area/rute dulu,
 * server yang menentukan konteksnya.
 *
 * Diperluas oleh "Barang per Ruangan via QR Patroli" (Fase 1, 10 Sep 2026):
 * respons kini juga membawa `room` (meta ruangan + jumlah barang) dan `is_assigned`
 * (petugas terjadwal hari ini ATAU terdaftar di ga_areas.assigned_staff_ids), supaya
 * klien bisa merutekan non-petugas ke Halaman Ruangan lewat helper routeCheckpointScan.
 * Field lama TIDAK diubah — kompatibel dengan klien versi sebelumnya.
 */
export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json().catch(() => null);
	const code = String(body?.code || '').trim();
	if (!code) throw error(400, 'Kode checkpoint kosong.');

	const cpRes = await directusServerJson<{ data: any[] }>(
		`/items/security_checkpoint?${new URLSearchParams({
			'filter[code][_eq]': code,
			'filter[status][_eq]': 'active',
			limit: '1'
		}).toString()}`
	);
	const checkpoint = cpRes?.data?.[0];
	if (!checkpoint) {
		throw error(404, 'Kode QR tidak dikenali atau titik nonaktif.');
	}

	const settings = await getGaAsetSettings();

	if (!checkpoint.area_id) {
		return json({
			kind: 'security',
			checkpoint_name: checkpoint.name,
			is_assigned: false,
			room: null,
			scan_route_mode: settings.scanRouteMode
		});
	}

	const today = todayJakarta();
	const scheduleRes = await directusServerJson<{ data: any[] }>(
		`/items/ga_checklist_schedule?${new URLSearchParams({
			'filter[area_id][_eq]': String(checkpoint.area_id),
			'filter[scheduled_date][_eq]': today,
			'filter[status][_neq]': 'done',
			limit: '-1'
		}).toString()}`
	);
	const schedule = (scheduleRes?.data || []).find(
		(s) => Array.isArray(s.assigned_to_ids) && s.assigned_to_ids.map(String).includes(String(karyawan.id))
	);

	// Meta ruangan + jumlah barang — relasi dipisah, di-cache 5 menit (Aturan #2).
	const roomMeta = await getRoomMeta(Number(checkpoint.area_id));
	const itemCount = await getRoomItemCount(Number(checkpoint.area_id));

	// is_assigned: ada jadwal hari ini untuk karyawan ini, ATAU dia terdaftar sebagai
	// staff tetap ruangan (ga_areas.assigned_staff_ids).
	const isAssigned =
		!!schedule ||
		(roomMeta?.assigned_staff_ids?.includes(String(karyawan.id)) ?? false);

	let scheduleId: string | number | undefined = schedule?.id;
	let templateId = schedule?.template_id;

	if (!schedule) {
		const fallbackSchedule = (scheduleRes?.data || [])[0];
		if (fallbackSchedule) {
			scheduleId = fallbackSchedule.id;
			templateId = fallbackSchedule.template_id;
		} else {
			// Ganti .catch(() => null) lama dengan log jelas (Aturan #1): kegagalan di sini
			// dulu tersembunyi — sekarang tercatat, dan meta ruangan sudah diambil terpisah.
			templateId = roomMeta?.template_id || checkpoint.checklist_template_id;
			scheduleId = 'unscheduled';
		}
	}

	return json({
		kind: 'ga',
		schedule_id: scheduleId,
		area_id: checkpoint.area_id,
		template_id: templateId,
		checkpoint_name: checkpoint.name,
		is_assigned: isAssigned,
		scan_route_mode: settings.scanRouteMode,
		room: roomMeta
			? {
					area_id: roomMeta.area_id,
					area_name: roomMeta.area_name,
					zone_name: roomMeta.zone_name,
					location_name: roomMeta.location_name,
					item_count: itemCount
				}
			: null
	});
};
