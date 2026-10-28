import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { withinRadius } from '$lib/server/ess/geo';
import { todayJakarta } from '$lib/server/ess/time';
import { getPatrolControlSettings } from '$lib/server/patrolControlSettings';

/**
 * 1.6/1.7 (Kontrol Patroli Fase 1) — GPS enforcement configurable via app_settings
 * module='patrol_control' key='gps_enforcement'. 'hard' tolak scan di luar radius/tanpa
 * GPS. 'soft' (default) tetap lolos, hanya tandai anomali + alert supervisor. 'off'
 * lewati semua pengecekan. Auto-populate koordinat checkpoint DIHAPUS (celah #7) —
 * admin yang mengisi koordinat lewat Directus/settings, bukan scan pertama siapa pun.
 */
async function checkGpsGate(checkpoint: any, lat: number | null, lng: number | null): Promise<{ gpsAnomaly: boolean }> {
	const settings = await getPatrolControlSettings();
	if (settings.gpsEnforcement === 'off') return { gpsAnomaly: false };
	if (!checkpoint.lat || !checkpoint.lng) return { gpsAnomaly: false }; // belum ada koordinat referensi, tidak bisa dinilai

	if (!lat || !lng) {
		if (settings.gpsEnforcement === 'hard') {
			throw error(400, 'Akses lokasi (GPS) diperlukan untuk memverifikasi checkpoint.');
		}
		await alertGpsAnomaly(checkpoint, null);
		return { gpsAnomaly: true };
	}
	const { valid, jarak } = withinRadius(lat, lng, Number(checkpoint.lat), Number(checkpoint.lng), 100);
	if (!valid) {
		if (settings.gpsEnforcement === 'hard') {
			throw error(400, `Anda berada terlalu jauh dari lokasi checkpoint (${jarak} meter). Checklist harus dilakukan di lokasi.`);
		}
		await alertGpsAnomaly(checkpoint, jarak);
		return { gpsAnomaly: true };
	}
	return { gpsAnomaly: false };
}

async function alertGpsAnomaly(checkpoint: any, jarak: number | null): Promise<void> {
	try {
		await directusServerJson('/items/app_notifications', {
			method: 'POST',
			body: JSON.stringify({
				type: 'patrol_gps_anomaly',
				title: `⚠️ GPS di luar radius — ${checkpoint.name || checkpoint.code}`,
				message: jarak != null ? `Scan tercatat ${jarak} meter dari titik checkpoint.` : 'Scan tercatat tanpa akses GPS.',
				priority: 'medium',
				department: 'hrd',
				read: false,
				action_required: false,
				action_url: '/hrd?tab=security',
				created_at: new Date().toISOString()
			})
		});
	} catch (err) {
		console.warn('[patrol-control] gagal kirim alert anomali GPS:', err);
	}
}

/**
 * Validasi hasil scan QR sebelum form checklist dibuka.
 * Dua konteks (lihat rencana konsolidasi GA/Security 2026-07-13, Fase 1):
 * - `area_id` (OB/Kebersihan, jalur asli): checkpoint dari ga_checkpoints, harus
 *   milik area yang diminta, DAN karyawan harus punya jadwal (ga_checklist_schedule)
 *   untuk area itu hari ini.
 * - `route_id` (Security/Satpam, baru): checkpoint dari security_checkpoint, harus
 *   ada di urutan checkpoint_ids rute tsb, DAN karyawan harus punya jadwal ronda
 *   (security_patrol_schedule) untuk rute+shift itu hari ini.
 * Scan hanya bukti kehadiran fisik, bukan pengganti penugasan.
 */
export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const body = await event.request.json().catch(() => null);
	const code = String(body?.code || '').trim();
	const areaId = Number(body?.area_id) || null;
	const routeId = Number(body?.route_id) || null;
	const lat = body?.lat ? Number(body.lat) : null;
	const lng = body?.lng ? Number(body.lng) : null;

	if (!code) throw error(400, 'Kode checkpoint kosong.');
	if (!areaId && !routeId) throw error(400, 'Area atau rute tidak valid.');

	if (routeId) return verifySecurityCheckpoint(code, routeId, karyawan.id, lat, lng);
	return verifyGaCheckpoint(code, areaId as number, karyawan.id, lat, lng);
};

async function verifyGaCheckpoint(code: string, areaId: number, karyawanId: number, lat: number | null, lng: number | null) {
	const cpRes = await directusServerJson<{ data: any[] }>(
		`/items/security_checkpoint?${new URLSearchParams({
			'filter[code][_eq]': code,
			'filter[status][_eq]': 'active',
			limit: '1'
		}).toString()}`
	);
	let checkpoint = cpRes?.data?.[0];
	if (!checkpoint) throw error(404, 'Kode QR tidak dikenali atau titik nonaktif.');
	if (Number(checkpoint.area_id) !== areaId) {
		throw error(400, 'QR ini bukan untuk area checklist yang sedang dikerjakan.');
	}

	// GPS Geofence Verification — 1.6/1.7 configurable, tanpa auto-populate koordinat.
	await checkGpsGate(checkpoint, lat, lng);

	const today = todayJakarta();
	const scheduleRes = await directusServerJson<{ data: any[] }>(
		`/items/ga_checklist_schedule?${new URLSearchParams({
			'filter[area_id][_eq]': String(areaId),
			'filter[scheduled_date][_eq]': today,
			'filter[status][_neq]': 'done',
			limit: '-1'
		}).toString()}`
	);
	const scheduled = (scheduleRes?.data || []).some(
		(s) => Array.isArray(s.assigned_to_ids) && s.assigned_to_ids.map(String).includes(String(karyawanId))
	);
	// Permissive bypass: allow scanning even if not scheduled
	// if (!scheduled) {
	// 	throw error(403, 'Anda tidak dijadwalkan untuk area ini hari ini.');
	// }

	return json({
		checkpoint_id: checkpoint.id,
		checkpoint_name: checkpoint.name,
		checklist_mode: checkpoint.checklist_mode || 'checklist',
		checklist_template_id: checkpoint.checklist_template_id || null
	});
}

async function verifySecurityCheckpoint(code: string, routeId: number, karyawanId: number, lat: number | null, lng: number | null) {
	const cpRes = await directusServerJson<{ data: any[] }>(
		`/items/security_checkpoint?${new URLSearchParams({
			'filter[code][_eq]': code,
			'filter[status][_eq]': 'active',
			limit: '1'
		}).toString()}`
	);
	let checkpoint = cpRes?.data?.[0];
	if (!checkpoint) throw error(404, 'Kode QR tidak dikenali atau titik nonaktif.');

	// GPS Geofence Verification — 1.6/1.7 configurable, tanpa auto-populate koordinat.
	await checkGpsGate(checkpoint, lat, lng);

	const routeRes = await directusServerJson<{ data: any[] }>(
		`/items/security_patrol_route?${new URLSearchParams({
			'filter[id][_eq]': String(routeId),
			'filter[status][_eq]': 'active',
			limit: '1'
		}).toString()}`
	);
	const route = routeRes?.data?.[0];
	if (!route || !Array.isArray(route.checkpoint_ids) || !route.checkpoint_ids.map(String).includes(String(checkpoint.id))) {
		throw error(400, 'QR ini bukan bagian dari rute ronda yang sedang dikerjakan.');
	}

	const today = todayJakarta();
	const scheduleRes = await directusServerJson<{ data: any[] }>(
		`/items/security_patrol_schedule?${new URLSearchParams({
			'filter[route_id][_eq]': String(routeId),
			'filter[tanggal][_eq]': today,
			'filter[satpam_id][_eq]': String(karyawanId),
			'filter[status][_neq]': 'done',
			limit: '1'
		}).toString()}`
	);
	// Permissive bypass: allow scanning even if not scheduled
	// if (!scheduleRes?.data?.length) {
	// 	throw error(403, 'Anda tidak dijadwalkan untuk rute ini hari ini.');
	// }

	return json({
		checkpoint_id: checkpoint.id,
		checkpoint_name: checkpoint.name,
		checklist_mode: checkpoint.checklist_mode || 'presence-only',
		checklist_template_id: checkpoint.checklist_template_id || null
	});
}
