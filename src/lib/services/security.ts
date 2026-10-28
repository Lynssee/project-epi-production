// src/lib/services/security.ts
// Modul Keamanan / Patroli Satpam — bacaan & tulis sisi klien via @directus/sdk.
// Pola sama dengan driver.ts: direct createItem untuk log lapangan (bukan operasi finansial/scoring
// yang butuh token server). Skema koleksi: lihat memory project-security-satpam.

import { auth } from '$lib/firebase';
import directus, { handleDirectusError } from './directus';
import { readItems, createItem, updateItem, uploadFiles } from '@directus/sdk';

export async function uploadSecurityFoto(file: File, description: string): Promise<string | null> {
	try {
		const formData = new FormData();
		formData.append('file', file);
		formData.append('description', description);
		const result: any = await directus.request(uploadFiles(formData));
		return result?.id || null;
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

export interface Checkpoint {
	id: number;
	code: string;
	name: string;
	zone: string | null;
	lat: number | null;
	lng: number | null;
	sort_order: number | null;
	status: string;
	role_scope?: 'kebersihan' | 'keamanan' | 'umum' | null;
	checklist_mode?: 'presence-only' | 'checklist' | 'both' | null;
	checklist_template_id?: number | null;
	area_id?: number | null;
}

const CHECKPOINT_FIELDS = ['id', 'code', 'name', 'zone', 'lat', 'lng', 'sort_order', 'status', 'role_scope', 'checklist_mode', 'checklist_template_id', 'area_id'];

export interface GaArea {
	id: number;
	area_name: string;
	template_id?: number | null;
}

export async function fetchGaAreasSimple(): Promise<GaArea[]> {
	try {
		return (await directus.request(
			readItems('ga_areas', {
				fields: ['id', 'area_name', 'template_id'],
				limit: -1
			})
		)) as GaArea[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function fetchActiveCheckpoints(): Promise<Checkpoint[]> {
	try {
		return (await directus.request(
			readItems('security_checkpoint', {
				filter: { status: { _eq: 'active' } },
				fields: CHECKPOINT_FIELDS,
				sort: ['sort_order'],
				limit: -1
			})
		)) as Checkpoint[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function fetchCheckpointByCode(code: string): Promise<Checkpoint | null> {
	try {
		const result = (await directus.request(
			readItems('security_checkpoint', {
				filter: { code: { _eq: code }, status: { _eq: 'active' } },
				fields: CHECKPOINT_FIELDS,
				limit: 1
			})
		)) as Checkpoint[];
		return result[0] || null;
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

export interface PatrolRoute {
	id: number;
	name: string;
	shift: string | null;
	interval_menit: number | null;
	checkpoint_ids: number[];
	status: string;
}

export async function fetchActiveRoutes(): Promise<PatrolRoute[]> {
	try {
		return (await directus.request(
			readItems('security_patrol_route', {
				filter: { status: { _eq: 'active' } },
				fields: ['id', 'name', 'shift', 'interval_menit', 'checkpoint_ids', 'status'],
				sort: ['name'],
				limit: -1
			})
		)) as PatrolRoute[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function fetchRouteById(routeId: number): Promise<PatrolRoute | null> {
	try {
		const result = (await directus.request(
			readItems('security_patrol_route', {
				filter: { id: { _eq: routeId } },
				fields: ['id', 'name', 'shift', 'interval_menit', 'checkpoint_ids', 'status'],
				limit: 1
			})
		)) as PatrolRoute[];
		return result[0] || null;
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

export async function fetchScansForLog(patrolLogId: number) {
	try {
		return await directus.request(
			readItems('security_patrol_scan', {
				filter: { patrol_log_id: { _eq: patrolLogId } },
				fields: ['id', 'checkpoint_id', 'waktu', 'kondisi', 'in_radius', 'mulai_kerja', 'selesai_kerja'],
				sort: ['waktu'],
				limit: -1
			})
		);
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function getActivePatrolLog(satpamId: number) {
	try {
		const result = (await directus.request(
			readItems('security_patrol_log', {
				filter: { satpam_id: { _eq: satpamId }, status: { _eq: 'ongoing' } },
				fields: ['id', 'schedule_id', 'mulai', 'skor_kepatuhan'],
				sort: ['-mulai'],
				limit: 1
			})
		)) as any[];
		return result[0] || null;
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

export async function fetchPatrolLogsHistory(satpamId: number) {
	try {
		return (await directus.request(
			readItems('security_patrol_log', {
				filter: { satpam_id: { _eq: satpamId } },
				fields: ['id', 'schedule_id', 'mulai', 'selesai', 'skor_kepatuhan', 'status'],
				sort: ['-mulai'],
				limit: 10
			})
		)) as any[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function fetchSatpamSchedules(satpamId: number) {
	try {
		return (await directus.request(
			readItems('security_patrol_schedule', {
				filter: { satpam_id: { _eq: satpamId } },
				fields: ['id', 'route_id', 'shift', 'jam_ronda', 'setiap_hari', 'tanggal', 'hari'],
				limit: -1
			})
		)) as any[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}


export async function startPatrolLog(satpamId: number, scheduleId?: number) {
	return directus.request(
		createItem('security_patrol_log', {
			satpam_id: satpamId,
			schedule_id: scheduleId ?? null,
			mulai: new Date().toISOString(),
			status: 'ongoing'
		})
	);
}

/**
 * Selesaikan ronda lewat server (/api/satpam/ronda/selesai): skor kepatuhan dihitung SERVER dari scan
 * di Directus dan gate G_SEC5 dievaluasi di sana. 422 (mode soft) = skor di bawah standar dan belum
 * ada `gate_sec5_reason` — error diberi flag `isGateSec5` agar UI minta alasan lalu kirim ulang.
 */
export async function finishPatrolLog(
	patrolLogId: number,
	opts: { routeId?: number | null; durasiOverrideReason?: string | null; gateSec5Reason?: string | null } = {}
): Promise<{ skor: number }> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	const idToken = await user.getIdToken();
	const res = await fetch('/api/satpam/ronda/selesai', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({
			patrol_log_id: patrolLogId,
			route_id: opts.routeId ?? undefined,
			durasi_override_reason: opts.durasiOverrideReason || undefined,
			gate_sec5_reason: opts.gateSec5Reason || undefined
		})
	});
	if (!res.ok) {
		let message = `Gagal (${res.status})`;
		try {
			message = (await res.json())?.message || message;
		} catch {
			/* pakai pesan default */
		}
		const err = new Error(message);
		if (res.status === 422) (err as any).isGateSec5 = true;
		throw err;
	}
	return res.json();
}

export async function submitPatrolScan(payload: {
	patrol_log_id: number;
	checkpoint_id: number;
	lat: number | null;
	lng: number | null;
	foto?: string | null;
	kondisi?: string;
	catatan?: string;
	in_radius?: boolean;
	override_reason?: string | null;
}) {
	return directus.request(
		createItem('security_patrol_scan', {
			...payload,
			waktu: new Date().toISOString()
		})
	);
}

/** Two-Tap kebersihan (Fase 2) — Tap 1: buat baris scan dengan mulai_kerja, belum ada checklist/foto akhir. */
export async function startDwellWork(payload: {
	patrol_log_id: number;
	checkpoint_id: number;
	lat: number | null;
	lng: number | null;
	in_radius?: boolean;
}) {
	return directus.request(
		createItem('security_patrol_scan', {
			...payload,
			waktu: new Date().toISOString(),
			mulai_kerja: new Date().toISOString()
		})
	);
}

/** Two-Tap kebersihan (Fase 2) — Tap 2: lengkapi baris scan yang sama dengan hasil kerja. */
export async function finishDwellWork(
	scanId: number,
	payload: { foto?: string | null; kondisi?: string; catatan?: string; dwell_override_reason?: string | null }
) {
	return directus.request(
		updateItem('security_patrol_scan', scanId, {
			...payload,
			selesai_kerja: new Date().toISOString()
		})
	);
}

export async function searchKaryawan(query: string): Promise<{ id: number; nama_karyawan: string }[]> {
	if (!query.trim()) return [];
	try {
		return (await directus.request(
			readItems('karyawan', {
				filter: { nama_karyawan: { _icontains: query } },
				fields: ['id', 'nama_karyawan'],
				limit: 15
			})
		)) as any[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function searchManpower(query: string): Promise<{ id: number; nama: string }[]> {
	if (!query.trim()) return [];
	try {
		return (await directus.request(
			readItems('manpower', {
				filter: { nama: { _icontains: query } },
				fields: ['id', 'nama'],
				limit: 15
			})
		)) as any[];
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function fetchOpenGatePersonLogs() {
	try {
		return await directus.request(
			readItems('security_gate_person_log', {
				filter: { arah: { _eq: 'out' }, paired_id: { _null: true } },
				fields: ['id', 'karyawan_id', 'manpower_id', 'nama_manual', 'waktu'],
				sort: ['-waktu'],
				limit: -1
			})
		);
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

/**
 * Catat orang keluar/masuk gerbang lewat server (/api/satpam/gate-orang): satpam pencatat diambil dari
 * sesi login, pairing KELUAR↔MASUK dan gate G_SEC2 dikerjakan di server. 422 (mode soft) = perlu alasan
 * `gate_sec2_reason` — error diberi flag `isGateSec2` agar UI minta alasan lalu kirim ulang.
 */
export async function submitGatePersonLog(payload: {
	karyawan_id?: number | null;
	manpower_id?: number | null;
	nama_manual?: string | null;
	tipe: 'tetap' | 'manpower' | 'tamu';
	arah: 'in' | 'out';
	keperluan?: string | null;
	gate_sec2_reason?: string;
}) {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	const idToken = await user.getIdToken();
	const res = await fetch('/api/satpam/gate-orang', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	});
	if (!res.ok) {
		let message = `Gagal (${res.status})`;
		try {
			message = (await res.json())?.message || message;
		} catch {
			/* pakai pesan default */
		}
		const err = new Error(message);
		if (res.status === 422) (err as any).isGateSec2 = true;
		throw err;
	}
	return res.json();
}

export async function fetchOpenGateGoodsLogs() {
	try {
		return await directus.request(
			readItems('security_gate_goods_log', {
				filter: { expected_return: { _nnull: true }, actual_return: { _null: true } },
				fields: ['id', 'deskripsi', 'pembawa_nama', 'expected_return'],
				sort: ['-date_created'],
				limit: -1
			})
		);
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function markGoodsReturned(id: number) {
	return directus.request(updateItem('security_gate_goods_log', id, { actual_return: new Date().toISOString() }));
}

export async function submitGateGoodsLog(payload: Record<string, any>) {
	return directus.request(createItem('security_gate_goods_log', payload));
}

export async function submitVisitor(payload: Record<string, any>) {
	return directus.request(
		createItem('security_visitor', { ...payload, checkin: new Date().toISOString(), status: 'di_dalam' })
	);
}

export async function fetchVisitorsInside() {
	try {
		return await directus.request(
			readItems('security_visitor', {
				filter: { status: { _eq: 'di_dalam' } },
				fields: ['id', 'nama', 'instansi', 'tujuan_pic', 'checkin'],
				sort: ['-checkin'],
				limit: -1
			})
		);
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function checkoutVisitor(id: number) {
	return directus.request(
		updateItem('security_visitor', id, { status: 'keluar', checkout: new Date().toISOString() })
	);
}

export async function submitVehicleLog(payload: Record<string, any>) {
	return directus.request(
		createItem('security_vehicle_log', { ...payload, waktu: new Date().toISOString() })
	);
}

// Notifikasi ke supervisor keamanan + HRD admin via app_notifications (koleksi yang benar,
// hindari bentrok Notifications IT — lihat memory project-notifications-collection-fix).
async function notifyIncident(incident: Record<string, any>) {
	const notification = {
		type: incident.is_panic ? 'security_panic' : 'security_incident',
		title: incident.is_panic ? `🚨 PANIC — ${incident.kategori || 'Darurat'}` : `⚠️ Insiden Keamanan — ${incident.kategori || '-'}`,
		message: `${incident.lokasi ? 'Lokasi: ' + incident.lokasi + '. ' : ''}${incident.kronologi || ''}`.trim() || 'Insiden dilaporkan satpam.',
		priority: incident.is_panic || incident.severity === 'critical' ? 'high' : 'medium',
		department: 'hrd',
		read: false,
		action_required: true,
		action_url: '/hrd?tab=security',
		created_at: new Date().toISOString()
	};
	try {
		await directus.request(createItem('app_notifications', notification));
	} catch (err) {
		console.warn('Gagal mengirim notifikasi insiden:', err);
	}
}

export async function submitIncident(payload: Record<string, any>) {
	const saved = await directus.request(createItem('security_incident', payload));
	if (payload.is_panic || payload.severity === 'critical') {
		await notifyIncident(payload);
	}
	return saved;
}

/**
 * Serah-terima shift lewat server (/api/satpam/serah-terima): pengirim diambil dari sesi login
 * dan gate G_SEC7 dievaluasi di sana. Server menjawab 422 (mode soft) bila belum lengkap dan
 * belum ada `gate_sec7_reason` — error diberi flag `isGateSec7` agar UI minta alasan lalu kirim ulang.
 */
export async function submitShiftHandover(payload: {
	shift: 'pagi' | 'siang' | 'malam';
	tanggal: string;
	satpam_masuk_id: number;
	catatan: string;
	gate_sec7_reason?: string;
}) {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	const idToken = await user.getIdToken();
	const res = await fetch('/api/satpam/serah-terima', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify(payload)
	});
	if (!res.ok) {
		let message = `Gagal (${res.status})`;
		try {
			message = (await res.json())?.message || message;
		} catch {
			/* pakai pesan default */
		}
		const err = new Error(message);
		if (res.status === 422) (err as any).isGateSec7 = true;
		throw err;
	}
	return res.json();
}

// GSP-09: fungsi baca/verifikasi SJ gerbang (fetchSjAntrian, fetchPreparingSuratJalan, verifySuratJalanSecurity,
// fetchSuratJalanDetail) dihapus — semua lewat /api/gerbang-sj/* (lib/services/gerbangSjApi.ts).
