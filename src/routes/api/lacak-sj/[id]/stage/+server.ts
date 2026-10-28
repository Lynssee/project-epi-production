// src/routes/api/lacak-sj/[id]/stage/+server.ts
// Driver menandai tahap perjalanan dari layar lapangan: `dalam_perjalanan` / `tiba_lokasi`.
// Tidak menyentuh surat_jalan.status. Idempoten via client_event_id. Tracking SJ v2 Fase 4.

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { authenticateProjectLeader } from '$lib/server/goodsReceived/guard';
import { directusServerJson } from '$lib/server/directus';
import { recordKioskTrackingEvent } from '$lib/server/sjTracking';
import { sjButuhSatpam } from '$lib/server/driver/berangkatGuard';
import { canDriverMark, effectiveStage, stageBlockMessage, type DriverStageTo } from '$lib/shared/sjFieldTransitions';
import { resolveDriverIdentity, isSjDriver } from '$lib/server/driverIdentity';

const ALLOWED = new Set(['dalam_perjalanan', 'tiba_lokasi']);

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateProjectLeader(event);
	const id = Number(event.params.id);
	if (!Number.isFinite(id)) throw error(400, 'id tidak valid.');

	const body = await event.request.json().catch(() => null);
	const stageTo = String(body?.stage_to || '');
	const clientEventId = String(body?.client_event_id || '').trim();
	if (!ALLOWED.has(stageTo)) throw error(400, 'stage_to harus dalam_perjalanan atau tiba_lokasi.');
	if (!clientEventId) throw error(400, 'client_event_id wajib.');

	const sj = (await directusServerJson<{ data: any }>(
		`/items/surat_jalan/${id}?fields=id,driver,delegated_driver_id,delegated_user_id,status,track_stage,category`
	).catch(() => null))?.data;
	if (!sj) throw error(404, 'Surat Jalan tidak ditemukan.');
	const isDriver = isSjDriver(sj, await resolveDriverIdentity(karyawan));
	if (!isDriver) throw error(403, 'Hanya driver SJ ini yang bisa menandai tahap perjalanan.');

	// SJH-16: validasi urutan tahap (tak bisa tiba tanpa berangkat / berangkat sebelum lolos gerbang).
	// Panggilan ulang idempoten (client_event_id sama) tetap ditangani recordKioskTrackingEvent.
	const stageNow = effectiveStage(sj.track_stage, sj.status);
	const needsGate = await sjButuhSatpam(sj.category);
	if (stageNow !== stageTo && !canDriverMark(stageTo as DriverStageTo, stageNow, needsGate)) {
		throw error(409, `STAGE_INVALID: ${stageBlockMessage(stageTo as DriverStageTo, stageNow, needsGate)}`);
	}

	const gps = body?.gps && typeof body.gps === 'object'
		? { lat: Number(body.gps.lat), lng: Number(body.gps.lng), accuracy: Number(body.gps.accuracy) }
		: null;

	const out = await recordKioskTrackingEvent({
		sjId: id,
		stageTo: stageTo as any,
		actor: { id: karyawan.id, nama: karyawan.nama_karyawan, role: 'driver' },
		gps: gps && Number.isFinite(gps.lat) ? gps : null,
		notes: body?.notes ? String(body.notes).slice(0, 300) : null,
		clientEventId,
		source: 'lapangan'
	});
	return json({ success: true, ...out });
};
