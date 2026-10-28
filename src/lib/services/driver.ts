// Bacaan sisi klien untuk dashboard Driver App. Semua PENULISAN (mulai/selesai trip, POD,
// checkpoint, checklist P2H) wajib lewat /api/driver/* (token server) — lihat
// src/lib/server/driver/driverGuard.ts. File ini hanya untuk menampilkan data ke driver.

import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';
import { auth } from '$lib/firebase';
import { enqueue } from '$lib/utils/offlineQueue';
import { normalizeP2HTemplate, DEFAULT_P2H_TEMPLATE } from '$lib/data/p2hChecklist';

const driverIdCache = new Map<number, string>();

/**
 * Peta karyawanId (login) -> fleet_drivers.id, lewat field fleet_drivers.karyawan_id
 * yang sudah tersedia di skema (belum dipakai di form admin sebelum Sprint 0 ini).
 */
export async function resolveDriverId(karyawanId: number): Promise<string> {
	if (driverIdCache.has(karyawanId)) return driverIdCache.get(karyawanId)!;

	const result = (await directus.request(
		readItems('fleet_drivers', {
			filter: { karyawan_id: { _eq: String(karyawanId) } },
			fields: ['id', 'nama', 'status'],
			limit: 1
		})
	)) as any[];

	const match = result[0];
	if (!match) {
		throw new Error('Akun ini belum tertaut ke data driver (fleet_drivers). Hubungi admin Fleet.');
	}
	driverIdCache.set(karyawanId, match.id);
	return match.id;
}

export async function getActiveTrip(driverId: string) {
	try {
		const result = await directus.request(
			readItems('fleet_trip_log', {
				filter: { driver_id: { _eq: driverId }, status: { _eq: 'active' } },
				fields: ['id', 'vehicle_id', 'tujuan', 'keperluan', 'km_awal', 'tanggal_berangkat', 'waktu_mulai', 'jenis'],
				sort: ['-tanggal_berangkat'],
				limit: 1
			})
		);
		return result.length > 0 ? result[0] : null;
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

export async function getRecentTrips(driverId: string, limit = 10) {
	try {
		return await directus.request(
			readItems('fleet_trip_log', {
				filter: { driver_id: { _eq: driverId } },
				fields: ['id', 'vehicle_id', 'tujuan', 'status', 'tanggal_berangkat', 'tanggal_kembali', 'km_awal', 'km_akhir'],
				sort: ['-tanggal_berangkat'],
				limit
			})
		);
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function getTripById(tripId: string) {
	try {
		const result = (await directus.request(
			readItems('fleet_trip_log', {
				filter: { id: { _eq: tripId } },
				fields: [
					'id', 'vehicle_id', 'driver_id', 'tujuan', 'keperluan', 'jenis', 'status',
					'km_awal', 'km_akhir', 'tanggal_berangkat', 'tanggal_kembali', 'waktu_mulai',
					'waktu_selesai', 'catatan_driver', 'biaya_bbm', 'biaya_tol', 'biaya_parkir'
				],
				limit: 1
			})
		)) as any[];
		return result[0] || null;
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

/** Kendaraan (fleet_kendaraan, master tunggal sejak Fase 0 Fleet v2) yang sedang TERSEDIA untuk dipakai. */
export async function getAvailableVehicles() {
	try {
		const rows = (await directus.request(
			readItems('fleet_kendaraan', {
				filter: { status: { _eq: 'Tersedia' } },
				fields: ['id', 'merk', 'model', 'nomor_polisi', 'kode_aset'],
				sort: ['merk'],
				limit: -1
			})
		)) as any[];
		return rows.map((v) => ({
			id: v.id,
			name: [v.merk, v.model].filter(Boolean).join(' ') || v.nomor_polisi,
			code: v.kode_aset || v.nomor_polisi
		}));
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

async function parseErrorMessage(res: Response): Promise<string> {
	try {
		const data = await res.json();
		return data?.message || `Gagal (${res.status})`;
	} catch {
		return `Gagal (${res.status})`;
	}
}

/**
 * POST ke /api/driver/* dengan Firebase ID token. Jika gagal karena offline (bukan
 * ditolak server), payload diantre di localStorage dan dikirim ulang otomatis saat online
 * (lihat src/lib/utils/offlineQueue.ts).
 */
async function postDriver(url: string, params: unknown): Promise<{ queued: true } | any> {
	let idToken: string;
	try {
		idToken = await getIdToken();
	} catch {
		enqueue(url, 'POST', params);
		return { queued: true };
	}

	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
			body: JSON.stringify(params)
		});
		if (!res.ok) throw new Error(await parseErrorMessage(res));
		return res.json();
	} catch (err) {
		if (err instanceof TypeError) {
			// Kegagalan jaringan (bukan penolakan server) — antre untuk retry saat online.
			enqueue(url, 'POST', params);
			return { queued: true };
		}
		throw err;
	}
}

export interface StartTripParams {
	vehicle_id: string;
	km_awal: number;
	foto_odometer_awal?: string | null;
	catatan_driver?: string;
	booking_id?: string | null;
	tujuan?: string;
	keperluan?: string;
	jenis?: 'umum' | 'peminjaman' | 'logistik_harian';
}

export async function startTrip(params: StartTripParams) {
	return postDriver('/api/driver/trip/start', params);
}

export interface FinishTripParams {
	km_akhir: number;
	foto_odometer_akhir?: string | null;
	catatan_driver?: string;
}

export async function finishTrip(tripId: string, params: FinishTripParams) {
	return postDriver(`/api/driver/trip/${tripId}/finish`, params);
}

export interface CheckpointParams {
	trip_log_id?: string;
	shipment_id?: string;
	label: string;
	latitude: number;
	longitude: number;
	alamat?: string;
	odometer?: number;
}

export async function sendCheckpoint(params: CheckpointParams) {
	return postDriver('/api/driver/checkpoint', params);
}

/** Surat Jalan yang didelegasikan ke driver ini (Fase 2 Fleet v2, 3 Agu 2026). */
export async function getDelegatedSuratJalan(driverId: string) {
	try {
		return await directus.request(
			readItems('surat_jalan', {
				filter: { delegated_driver_id: { _eq: driverId }, delegation_status: { _in: ['pending', 'diterima', 'jalan'] } },
				fields: ['id', 'nomor_sj', 'delivery_address', 'notes', 'delegation_status', 'delegation_notes', 'vehicle_id', 'date_created', 'status', 'print_count', 'approval_status', 'security_verified_at', 'track_stage'],
				sort: ['-date_created'],
				limit: -1
			})
		);
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export interface DelegationResponseParams {
	action: 'terima' | 'tolak' | 'berangkat';
	reason?: string;
	km_awal?: number;
}

/** Driver menerima/menolak delegasi Surat Jalan. Terima → otomatis membuat fleet_trip_log. */
/** SJH-18: kesiapan SJ (langkah, "menunggu siapa", plat, boleh berangkat?) dihitung di server. */
export async function fetchSjReadiness(ids: number[]): Promise<any[]> {
	if (!ids.length) return [];
	const idToken = await getIdToken();
	const res = await fetch(`/api/driver/sj-readiness?ids=${ids.join(',')}`, { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return (await res.json())?.items || [];
}

export async function respondToDelegation(sjId: number, params: DelegationResponseParams) {
	return postDriver(`/api/driver/delegation/${sjId}/respond`, params);
}

/** Ambil koordinat lokasi saat ini lewat browser Geolocation API. */
export function getCurrentPosition(): Promise<GeolocationPosition> {
	return new Promise((resolve, reject) => {
		if (typeof navigator === 'undefined' || !navigator.geolocation) {
			reject(new Error('Perangkat ini tidak mendukung layanan lokasi.'));
			return;
		}
		navigator.geolocation.getCurrentPosition(resolve, reject, {
			enableHighAccuracy: true,
			timeout: 10000,
			maximumAge: 0
		});
	});
}

export interface SubmitPodParams {
	status: 'tiba' | 'gagal';
	penerima_nama?: string;
	catatan?: string;
	lat?: number;
	lng?: number;
	foto?: File | null;
	ttd?: File | null;
}

/**
 * Kirim POD (bukti serah terima) untuk trip logistik_harian. Mengirim file (foto/ttd)
 * lewat multipart — TIDAK dilewatkan ke offlineQueue (File tidak bisa disimpan di
 * localStorage), jadi kegagalan jaringan di sini harus di-retry manual oleh driver.
 */
export async function submitPod(tripId: string, params: SubmitPodParams) {
	const idToken = await getIdToken();
	const form = new FormData();
	form.set('status', params.status);
	if (params.penerima_nama) form.set('penerima_nama', params.penerima_nama);
	if (params.catatan) form.set('catatan', params.catatan);
	if (params.lat != null) form.set('lat', String(params.lat));
	if (params.lng != null) form.set('lng', String(params.lng));
	if (params.foto) form.set('foto', params.foto);
	if (params.ttd) form.set('ttd', params.ttd);

	const res = await fetch(`/api/driver/trip/${tripId}/pod`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` },
		body: form
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function getTripExpenses(tripId: string) {
	try {
		return await directus.request(
			readItems('fleet_trip_expense', {
				filter: { trip_log_id: { _eq: tripId } },
				fields: ['id', 'jenis', 'nominal', 'catatan', 'waktu'],
				sort: ['-waktu'],
				limit: -1
			})
		);
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export interface SubmitExpenseParams {
	jenis: 'bbm' | 'tol' | 'parkir' | 'lain';
	nominal: number;
	catatan?: string;
	foto_struk?: File | null;
}

/** Kirim satu baris biaya (BBM/tol/parkir/lain). Multipart — tidak lewat offlineQueue (ada file). */
export async function submitTripExpense(tripId: string, params: SubmitExpenseParams) {
	const idToken = await getIdToken();
	const form = new FormData();
	form.set('jenis', params.jenis);
	form.set('nominal', String(params.nominal));
	if (params.catatan) form.set('catatan', params.catatan);
	if (params.foto_struk) form.set('foto_struk', params.foto_struk);

	const res = await fetch(`/api/driver/trip/${tripId}/expense`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` },
		body: form
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

/** Semua kendaraan (fleet_kendaraan, master tunggal sejak Fase 0 Fleet v2), untuk pilih target Cek Kendaraan (P2H). */
export async function getVehiclesForCheck() {
	try {
		const rows = (await directus.request(
			readItems('fleet_kendaraan', {
				fields: ['id', 'merk', 'model', 'nomor_polisi', 'kode_aset', 'status'],
				sort: ['merk'],
				limit: -1
			})
		)) as any[];
		return rows.map((v) => ({
			id: v.id,
			name: [v.merk, v.model].filter(Boolean).join(' ') || v.nomor_polisi,
			code: v.kode_aset || v.nomor_polisi,
			status_operational: v.status
		}));
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export async function getTodayVehicleCheck(vehicleId: string, date: string) {
	try {
		const result = (await directus.request(
			readItems('fleet_vehicle_check', {
				filter: { vehicle_id: { _eq: vehicleId }, tanggal: { _eq: date } },
				fields: ['id', 'status', 'tanggal'],
				limit: 1
			})
		)) as any[];
		return result[0] || null;
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

export interface VehicleCheckItem {
	key?: string;
	label?: string;
	/** kompat lama */
	name?: string;
	status: 'ok' | 'rusak' | 'tidak_ada';
	kritis?: boolean;
}

export interface SubmitVehicleCheckParams {
	vehicle_id: string;
	items: VehicleCheckItem[];
	temuan?: string;
	foto?: File | null;
	bookingId?: string | number | null;
	kmSaatCek?: number | null;
}

/**
 * ESS Redesign — daftar item P2H dari fleet_settings.checklist_template_peminjam (config,
 * sama untuk semua pengemudi). Fail-soft ke DEFAULT_P2H_TEMPLATE bila tak terbaca.
 */
export async function getP2HChecklistTemplate() {
	try {
		const rows = (await directus.request(
			readItems('fleet_settings', {
				filter: { key: { _eq: 'checklist_template_peminjam' } },
				fields: ['value'],
				limit: 1
			})
		)) as any[];
		const raw = rows?.[0]?.value;
		return normalizeP2HTemplate(Array.isArray(raw) ? raw : []);
	} catch {
		return DEFAULT_P2H_TEMPLATE;
	}
}

export interface DailyTaskResult {
	booking: any;
	created: boolean;
	needsVehicleSelection?: boolean;
}

/**
 * Tombol "Mulai Tugas Hari Ini" (Fase 2, §9.2.1) — buat/ambil booking operasional_harian
 * hari ini untuk driver ini, tahap 1 approval dilewati (K3). Idempoten.
 */
export async function startDailyTask(vehicleId?: string | number | null): Promise<DailyTaskResult> {
	const idToken = await getIdToken();
	const res = await fetch('/api/driver/start-daily-task', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ vehicle_id: vehicleId || null })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

/** Kirim checklist P2H harian. Multipart — tidak lewat offlineQueue (ada file). */
export async function submitVehicleCheck(params: SubmitVehicleCheckParams) {
	const idToken = await getIdToken();
	const form = new FormData();
	form.set('vehicle_id', params.vehicle_id);
	form.set('items', JSON.stringify(params.items));
	if (params.temuan) form.set('temuan', params.temuan);
	if (params.foto) form.set('foto', params.foto);
	if (params.bookingId) form.set('booking_id', String(params.bookingId));
	if (params.kmSaatCek != null) form.set('km_saat_cek', String(params.kmSaatCek));

	const res = await fetch('/api/driver/vehicle-check', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` },
		body: form
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export interface SubmitFuelLogParams {
	vehicle_id: string;
	liter: number;
	total_biaya: number;
	odometer?: number | null;
	catatan?: string;
	foto?: File | null;
}

/** Catat pengisian BBM aktual — dasar kalibrasi Cost Estimator. Multipart (ada foto struk). */
export async function submitFuelLog(params: SubmitFuelLogParams) {
	const idToken = await getIdToken();
	const form = new FormData();
	form.set('vehicle_id', params.vehicle_id);
	form.set('liter', String(params.liter));
	form.set('total_biaya', String(params.total_biaya));
	if (params.odometer != null) form.set('odometer', String(params.odometer));
	if (params.catatan) form.set('catatan', params.catatan);
	if (params.foto) form.set('foto', params.foto);

	const res = await fetch('/api/driver/fuel-log', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` },
		body: form
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
