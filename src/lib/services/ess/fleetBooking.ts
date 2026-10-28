// src/lib/services/ess/fleetBooking.ts
// Client-side service ESS Peminjaman Kendaraan (Fleet Booking)
// Memanggil /api/fleet-booking untuk validasi, meta kendaraan, dan riwayat.

import { auth } from '$lib/firebase';
import { fetchWithTimeout } from '$lib/utils/fetchTimeout';

export interface VehicleOption {
	id: number;
	name: string;
	merk: string;
	model: string;
	plat: string;
	nomor_polisi: string;
	jenis: string;
	kapasitas: number;
	bahan_bakar: string;
	lokasi: string;
	status: string;
	odometer?: number;
}

export interface DriverInfo {
	id: number;
	nama: string;
	no_telepon: string;
	status?: string;
	foto?: string | null;
}

export interface FleetBookingRecord {
	id: number | string;
	kode_booking: string;
	vehicle_id: number | null;
	driver_id: number | null;
	karyawan_id: string;
	butuh_driver: boolean;
	requester_name: string;
	requester_dept: string | null;
	keperluan: string | null;
	tujuan: string;
	tanggal_mulai: string;
	tanggal_selesai_rencana: string | null;
	tanggal_selesai_aktual: string | null;
	status: 'diajukan' | 'disetujui' | 'aktif' | 'selesai' | 'ditolak' | 'dibatalkan';
	catatan: string | null;
	approver: string | null;
	/** Peminjaman 11 §3.1 — alasan penolakan (diisi callback approval); ditampilkan ke peminjam. */
	alasan_tolak?: string | null;
	approver_karyawan_id?: string | null;
	/** Peminjaman 11 §3.2 — progres approval nyata (hanya booking `diajukan`). */
	approval_progress?: {
		current_step: number;
		total_steps: number;
		step_label: string | null;
		steps: { order: number; label: string | null }[];
	} | null;
	tanggal_approve: string | null;
	trip_log_id: number | null;
	km_awal: number | null;
	km_akhir: number | null;
	date_created?: string;
	vehicle?: VehicleOption | null;
	driver?: DriverInfo | null;
	tipe_keperluan?: string | null;
	project_id?: number | null;
	referensi_site_visit_id?: string | null;
	kategori_kunjungan?: string | null;
	zona?: 'dalam_kota' | 'luar_kota' | null;
	butuh_kendaraan?: boolean | null;
	butuh_akomodasi?: boolean | null;
	// ESS Redesign Fase 2 — Uang Muka Operasional (Cash Advance)
	advance_diminta?: boolean | null;
	advance_est_bbm?: number | null;
	advance_est_tol?: number | null;
	advance_est_lain?: number | null;
	advance_amount_requested?: number | null;
	advance_status?: 'none' | 'diajukan' | 'menunggu_kasir' | 'disetujui' | 'dicairkan' | 'ditolak' | 'dibatalkan' | 'settled' | null;
	advance_amount_disbursed?: number | null;
	advance_disbursement_ref?: string | null;
	advance_alasan_tolak?: string | null;
	settlement_selisih?: number | null;
	settlement_status?: 'none' | 'menunggu_setor_balik' | 'menunggu_reimburse' | 'balanced' | 'closed' | null;
	settlement_bukti_setor_balik_file?: string | null;
	realisasi_bbm?: number | null;
	realisasi_tol?: number | null;
	realisasi_parkir?: number | null;
	realisasi_lain?: number | null;
	penyesuaian_manual?: number | null;
}

export interface VisitCategory {
	kode: string;
	label: string;
	zona_default: 'dalam_kota' | 'luar_kota' | 'keduanya';
	wajib_project: boolean;
	wajib_customer: boolean;
	wajib_kendaraan_default: boolean;
	butuh_akomodasi_default: boolean;
}

export interface FleetBookingMeta {
	settings: {
		maks_peminjaman_bersamaan_per_dept: number;
		minimal_pengajuan_jam_sebelum: number;
		label_zona_dalam_kota?: string;
		label_zona_luar_kota?: string;
		require_driver_for_heavy_vehicles?: boolean;
		checklist_template_peminjam?: ChecklistTemplateItem[];
		checklist_sebelum_wajib?: boolean;
		checklist_setelah_wajib?: boolean;
		checklist_harian_wajib?: boolean;
		foto_checklist_wajib?: boolean;
		blokir_checkout_bila_tidak_laik?: boolean;
		advance_aktif?: boolean | number;
		settlement_wajib_bukti_setor?: boolean | number;
	};
	/** Nomor WA GA (format 62xxx) dari fleet_notify_recipients peran ga_hrd; null bila belum dikonfigurasi. */
	kontak_ga_wa?: string | null;
	vehicles: VehicleOption[];
	vehiclesError?: boolean;
	visit_categories_error?: boolean;
	visit_categories?: VisitCategory[];
	requester: {
		id: number | string;
		name: string;
		dept: string;
		jabatan: string;
		email: string;
	};
}

export interface BookingSubmission {
	tujuan: string;
	keperluan?: string;
	vehicle_id?: number | null;
	butuh_driver: boolean;
	tanggal_mulai: string;
	tanggal_selesai_rencana?: string | null;
	catatan?: string;
	tipe_keperluan?: string;
	project_id?: number | null;
	kategori_kunjungan?: string | null;
	zona?: 'dalam_kota' | 'luar_kota' | null;
	butuh_kendaraan?: boolean;
	butuh_akomodasi?: boolean;
	// ESS Redesign Fase 2 — Uang Muka Operasional
	advance_diminta?: boolean;
	advance_est_bbm?: number;
	advance_est_tol?: number;
	advance_est_lain?: number;
	/** Peminjaman 07 — kunci idempotensi: ID yang SAMA dipakai ulang untuk setiap percobaan kirim dari form yang sama. */
	client_txn_id?: string;
}

export interface AvailabilityBlock {
	vehicle_id: number;
	source: 'booking' | 'trip' | 'maintenance' | 'service';
	label: string;
	start: string | null;
	end: string | null;
}

/**
 * Cek ketersediaan kendaraan (kalender ringkas) untuk rentang tanggal & unit tertentu.
 */
export async function getFleetAvailability(from: string, to: string, vehicleId?: number | ''): Promise<AvailabilityBlock[]> {
	const token = await getIdToken();
	const params = new URLSearchParams({ from, to });
	if (vehicleId) params.set('vehicle_id', String(vehicleId));
	const res = await fetchWithTimeout(`/api/fleet-booking/availability?${params.toString()}`, {
		headers: { Authorization: `Bearer ${token}` }
	});
	if (!res.ok) return [];
	const body = await res.json();
	return body.blocks || [];
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

/** Seperti parseErrorMessage tapi mengembalikan Error dengan `.code`/`.bookingId` bila ada
 *  (Fase 3 G7 — CHECKIN_REQUIRED memicu tombol "Minta Dispensasi GA"). */
async function toError(res: Response): Promise<Error & { code?: string; bookingId?: string; status?: number }> {
	let msg = `Gagal (${res.status})`;
	let code: string | undefined;
	let bookingId: string | undefined;
	try {
		const data = await res.json();
		msg = data?.message || msg;
		code = data?.code;
		bookingId = data?.booking_id;
	} catch {
		/* body bukan JSON */
	}
	const err = new Error(msg) as Error & { code?: string; bookingId?: string; status?: number };
	err.status = res.status; // dipakai antrean offline P2H: 4xx = ditolak permanen, 5xx/jaringan = coba lagi
	if (code) err.code = code;
	if (bookingId) err.bookingId = bookingId;
	return err;
}

/** Fase 3 G7 — kirim permintaan dispensasi check-in ke GA (WA). Tidak mengubah status booking. */
export async function requestCheckinDispensation(
	bookingId: string | number,
	alasan: string
): Promise<{ ok: boolean; tercatat?: boolean; wa_terkirim?: boolean }> {
	const token = await getIdToken();
	const res = await fetchWithTimeout('/api/fleet-booking/request-checkin-dispensation', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
		body: JSON.stringify({ bookingId: String(bookingId), alasan })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

/**
 * Ambil metadata kendaraan, setelan GA, dan data pemohon
 */
export async function getFleetBookingMeta(): Promise<FleetBookingMeta> {
	const token = await getIdToken();
	const res = await fetchWithTimeout('/api/fleet-booking?meta=1', {
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`
		}
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

/**
 * Ambil riwayat peminjaman kendaraan karyawan login
 */
export async function getMyFleetBookings(): Promise<FleetBookingRecord[]> {
	const token = await getIdToken();
	const res = await fetchWithTimeout('/api/fleet-booking', {
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`
		}
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	const json = await res.json();
	return json.data || [];
}

/**
 * Ambil detail satu peminjaman
 */
export async function getFleetBookingDetail(id: string | number): Promise<FleetBookingRecord> {
	const token = await getIdToken();
	const res = await fetchWithTimeout(`/api/fleet-booking/${id}`, {
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`
		}
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	const json = await res.json();
	return json.data;
}

/**
 * Ajukan peminjaman kendaraan baru
 */
export async function submitFleetBooking(payload: BookingSubmission): Promise<FleetBookingRecord> {
	const token = await getIdToken();
	const res = await fetchWithTimeout('/api/fleet-booking', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`
		},
		body: JSON.stringify(payload)
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	const json = await res.json();
	// Fase 3 G3 — peringatan duplikat (mode peringatan, tidak memblokir) ditempel ke record.
	return json.warning ? { ...json.record, _warning: json.warning as string } : json.record;
}

/**
 * ESS Redesign Fase 3 — unggah bukti setor balik sisa uang muka (settlement_status = menunggu_setor_balik).
 */
export async function submitSettlementSetor(bookingId: string | number, file: File): Promise<FleetBookingRecord | null> {
	const token = await getIdToken();
	const fd = new FormData();
	fd.append('booking_id', String(bookingId));
	fd.append('foto', file);
	const res = await fetchWithTimeout('/api/fleet-booking/settlement-setor', {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}` },
		body: fd
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	const json = await res.json();
	return json.booking ?? null;
}

/**
 * Batalkan peminjaman yang diajukan
 */
export async function cancelFleetBooking(id: string | number, reason: string = ''): Promise<void> {
	const token = await getIdToken();
	const res = await fetchWithTimeout(`/api/fleet-booking/${id}`, {
		method: 'PATCH',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`
		},
		body: JSON.stringify({ action: 'cancel', reason })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
}

export interface ChecklistItemInput {
	key: string;
	label: string;
	status: 'ok' | 'rusak' | 'tidak_ada';
	kritis?: boolean;
}

export interface ChecklistTemplateItem {
	key: string;
	label: string;
	kritis: boolean;
	wajib_foto: boolean;
}

export interface ChecklistResult {
	record: any;
	work_order: any;
	blocked: boolean;
	booking: any;
	/** Peminjaman 08 — status sudah sesuai target (kirim ulang setelah respons hilang) = sukses. */
	already?: boolean;
	replay?: boolean;
}

/**
 * Kirim checklist kendaraan (tahap sebelum/selama/setelah). Checklist "sebelum" yang laik
 * otomatis mengaktifkan booking (self-checkout); "setelah" otomatis menutupnya (self-return).
 */
export async function submitFleetChecklist(params: {
	bookingId: string | number;
	tahap: 'sebelum' | 'selama' | 'setelah';
	items: ChecklistItemInput[];
	kmSaatCek: number;
	temuan?: string;
	foto?: File | null;
	/** Peminjaman 08 — foto dashboard (angka KM) terpisah dari foto kerusakan. */
	fotoDashboard?: File | null;
	/** Kunci idempotensi: dipakai ULANG untuk setiap percobaan kirim P2H yang sama. */
	clientTxnId?: string;
	kmKoreksiAlasan?: string;
	lupaSebelum?: boolean;
	/** Waktu kejadian di HP (ISO) — dipakai server bila ≤ 24 jam (antrean offline). */
	clientCreatedAt?: string;
}): Promise<ChecklistResult> {
	const token = await getIdToken();
	const form = new FormData();
	form.append('booking_id', String(params.bookingId));
	form.append('tahap', params.tahap);
	form.append('items', JSON.stringify(params.items));
	form.append('km_saat_cek', String(params.kmSaatCek));
	if (params.temuan) form.append('temuan', params.temuan);
	if (params.foto) form.append('foto', params.foto);
	if (params.fotoDashboard) form.append('foto_dashboard', params.fotoDashboard);
	if (params.clientTxnId) form.append('client_txn_id', params.clientTxnId);
	if (params.kmKoreksiAlasan) form.append('km_koreksi_alasan', params.kmKoreksiAlasan);
	if (params.lupaSebelum) form.append('lupa_sebelum', '1');
	if (params.clientCreatedAt) form.append('client_created_at', params.clientCreatedAt);

	const res = await fetchWithTimeout('/api/fleet-booking/checklist', {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}` },
		body: form
	});
	if (!res.ok) throw await toError(res);
	return res.json();
}
