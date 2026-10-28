// src/lib/server/gerbangSj/effects.ts
// GSP-05/06 — efek samping Loloskan/Tahan. SEMUA best-effort: gagal → log keras + masuk effects_gagal[],
// tidak pernah membatalkan hasil utama (PATCH surat_jalan). Satu-satunya yang menentukan sukses ada di actions.ts.

import { directusServerJson } from '../directus';
import { resolveGateMode } from '../gateDefinitionsMode';
import { recordKioskTrackingEvent } from '../sjTracking';
import { SCAN_SOURCE_BY_SUMBER, type GateActor, type GateGps } from './types';

const ACTION_URL = '/inventory/keluar-masuk?tab=surat_jalan';
const cut = (s: string, n = 255) => (s.length > n ? s.slice(0, n) : s);
const hhmm = () => new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' }).replace('.', ':');

/** Jalankan satu efek; kembalikan nama langkah bila gagal (untuk effects_gagal). */
export async function runEffect(nama: string, sjId: number, fn: () => Promise<unknown>): Promise<string | null> {
	try {
		await fn();
		return null;
	} catch (err) {
		console.error(`[gerbangSj] efek "${nama}" gagal`, { sjId, err: err instanceof Error ? err.message : err });
		return nama;
	}
}

/** G_SJ_PATROL_NO_ACTIVE_SESSION — hanya dicatat, TIDAK pernah memblokir (keputusan Kontrol Patroli Fase 3+4.3). */
export async function checkPatrolActiveToday(karyawanId: number | null): Promise<boolean | null> {
	if (!karyawanId) return null;
	try {
		await resolveGateMode('G_SJ_PATROL_NO_ACTIVE_SESSION', 'sj_gate');
		const res = await directusServerJson<{ data: any[] }>(
			`/items/security_patrol_log?${new URLSearchParams({ 'filter[satpam_id][_eq]': String(karyawanId), 'filter[status][_eq]': 'ongoing', limit: '1', fields: 'id' })}`
		);
		return (res?.data?.length || 0) > 0;
	} catch (err) {
		console.warn('[gerbangSj] gagal evaluasi G_SJ_PATROL_NO_ACTIVE_SESSION, dilewati:', err);
		return null;
	}
}

/** G_SATPAM_P2H_KENDARAAN — hanya dicatat, keputusan tetap di tangan satpam. */
export async function checkP2hVehicleToday(vehicleId: number | string | null): Promise<boolean | null> {
	if (!vehicleId) return null;
	try {
		await resolveGateMode('G_SATPAM_P2H_KENDARAAN', 'sj_gate');
		const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
		const res = await directusServerJson<{ data: any[] }>(
			`/items/fleet_vehicle_check?${new URLSearchParams({
				'filter[vehicle_id][_eq]': String(vehicleId),
				'filter[_or][0][tanggal][_eq]': today,
				'filter[_or][1][date_created][_between]': `${today}T00:00:00+07:00,${today}T23:59:59+07:00`,
				sort: '-date_created', limit: '1', fields: 'id,status'
			})}`
		);
		const row = res?.data?.[0];
		return row ? row.status !== 'tidak_laik' : false;
	} catch (err) {
		console.warn('[gerbangSj] gagal evaluasi G_SATPAM_P2H_KENDARAAN, dilewati:', err);
		return null;
	}
}

type StageArgs = {
	sjId: number; actor: GateActor; gps: GateGps | null; fotoId: string | null; notes: string; clientEventId: string;
};

/** Loloskan → tahap lolos_gerbang (1 baris scan_log + cache track_*). */
export const recordLolos = (a: StageArgs) =>
	recordKioskTrackingEvent({
		sjId: a.sjId, stageTo: 'lolos_gerbang',
		actor: { id: a.actor.karyawanId, nama: a.actor.nama, role: 'satpam' },
		gps: a.gps ? { lat: a.gps.lat, lng: a.gps.lng, accuracy: a.gps.accuracy ?? undefined } : null,
		fotoId: a.fotoId, notes: a.notes, clientEventId: a.clientEventId,
		source: SCAN_SOURCE_BY_SUMBER[a.actor.sumber]
	});

/** Tahan → baris scan_log TANPA perpindahan tahap (stage_to null, track_stage tidak diubah). */
export async function recordTahan(a: StageArgs & { stageFrom: string | null }) {
	await directusServerJson('/items/scan_log', {
		method: 'POST',
		body: JSON.stringify({
			ref_collection: 'surat_jalan', ref_id: String(a.sjId),
			actor_id: a.actor.karyawanId, actor_role: 'satpam', timestamp: new Date().toISOString(),
			gps_lat: a.gps?.lat ?? null, gps_lng: a.gps?.lng ?? null, gps_accuracy: a.gps?.accuracy ?? null,
			foto_id: a.fotoId, notes: a.notes, stage_from: a.stageFrom, stage_to: null,
			source: SCAN_SOURCE_BY_SUMBER[a.actor.sumber], client_event_id: a.clientEventId
		})
	});
}

export type GateLogArgs = {
	deskripsi: string; qty: number | null; satuan: 'koli' | 'item'; driver: string | null; fotoId: string | null;
	nomorSj: string; actor: GateActor; expectedReturn?: string | null;
};
export const writeGateGoodsLog = (a: GateLogArgs) =>
	directusServerJson('/items/security_gate_goods_log', {
		method: 'POST',
		body: JSON.stringify({
			deskripsi: cut(a.deskripsi), qty: a.qty, satuan: a.satuan, arah: 'out',
			pembawa_tipe: 'karyawan', pembawa_nama: a.driver, jenis: 'kiriman', foto: a.fotoId,
			no_sj_manual: a.nomorSj, expected_return: a.expectedReturn ?? null,
			satpam_pencatat_id: a.actor.karyawanId
		})
	});

export const notifyLogistik = (a: { title: string; message: string; priority: 'medium' | 'high'; actionRequired: boolean }) =>
	directusServerJson('/items/app_notifications', {
		method: 'POST',
		body: JSON.stringify({
			type: 'surat_jalan', title: a.title, message: a.message, priority: a.priority, department: 'logistik',
			read: false, action_required: a.actionRequired, action_url: ACTION_URL, created_at: new Date().toISOString()
		})
	});

/** Notifikasi kedua untuk tim proyek (GSP-06 K1) — hanya bila SJ punya project_id. Departemen 'project' (konvensi existing). */
export const notifyProject = (a: { title: string; message: string }) =>
	directusServerJson('/items/app_notifications', {
		method: 'POST',
		body: JSON.stringify({
			type: 'surat_jalan', module: 'project', title: a.title, message: a.message, priority: 'high', department: 'project',
			read: false, action_required: true, action_url: ACTION_URL, created_at: new Date().toISOString()
		})
	});

export const lolosMessage = (actor: GateActor) => `Diloloskan ${actor.label} pukul ${hhmm()}. Barang boleh berangkat.`;

export const logProcess = (sjId: number, stageKey: 'security_passed' | 'security_held', actor: GateActor, meta: Record<string, unknown> = {}) =>
	directusServerJson('/items/process_event_log', {
		method: 'POST',
		body: JSON.stringify({
			process_code: 'SURAT_JALAN', instance_id: String(sjId), instance_ref: `surat_jalan:${sjId}`, stage_key: stageKey,
			event_ts: new Date().toISOString(), source: 'live', meta: { by: actor.label, sumber: actor.sumber, ...meta }
		})
	});
