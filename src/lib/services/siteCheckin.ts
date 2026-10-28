// src/lib/services/siteCheckin.ts
// Client-side service Site Check-in — SELALU lewat /api/site-checkin/*, TIDAK PERNAH akses
// Directus langsung dari sini (pola sama dengan services/ess/attendance.ts).

import { auth } from '$lib/firebase';
import { compressPhoto } from '$lib/utils/photoCompress';
import { fetchWithTimeout } from '$lib/utils/fetchWithTimeout';
import { HttpError } from '$lib/utils/networkError';

export interface SiteCheckinRecord {
	id: string;
	karyawan_id: string;
	referensi_id: number;
	nama_lokasi: string | null;
	tier_absensi: string | null;
	area_sumber: string | null;
	area_status: string | null;
	check_in_at: string;
	check_out_at: string | null;
	in_geofence: boolean | null;
	jarak_in_m: number | null;
	durasi_menit: number | null;
	status: 'active' | 'completed' | 'cancelled';
	[key: string]: any;
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

/** Paket 02 §3.2 — lempar HttpError (status terlampir) supaya isRetryableError bisa membedakan
 *  5xx/408/425/429 (layak diantrekan/diulang) dari 4xx lain (permanen, salah data). */
async function throwHttpError(res: Response): Promise<never> {
	throw new HttpError(await parseErrorMessage(res), res.status);
}

interface CheckinParams {
	referensiId: number | string; // string (UUID) untuk tipeKeperluan 'maintenance'
	lat: number;
	lng: number;
	accuracy?: number | null;
	photoFile: File;
	catatan?: string;
	bookingId?: string | null;
	// "4-Gate Site Visit System" Fase 3 (8 Sep 2026) — default 'proyek' bila tak diisi.
	// maintenance: referensiId adalah UUID work_order.id (dikirim sebagai string).
	tipeKeperluan?: 'proyek' | 'marketing' | 'maintenance';
	// SV-12: waktu check-in SEBENARNYA di HP (ISO), diisi saat replay dari antrean offline —
	// tanpa ini, check-in offline pagi yang baru tersinkron malam tercatat jam sinkron, bukan
	// jam sebenarnya. Kosong untuk check-in online biasa (server pakai waktu server).
	clientCreatedAt?: string | null;
	// SV-12 (skema disetujui Lead 26 Sep 2026): UUID dari antrean offline — server dedup exact-match
	// terhadap site_checkin.client_txn_id (unique). Kosong untuk check-in online biasa.
	clientTxnId?: string | null;
}

/** Penajaman SDM v2 Fase 5 — navigator.connection tidak distandarkan semua browser (Safari/iOS
 * tidak punya), jadi selalu opsional & gagal-lunak. Server menerima null tanpa masalah.
 * KOREKSI (code review): versi awal memakai `effectiveType` (mis. '4g') sebagai proxy "berarti
 * cellular" — salah, effectiveType adalah ESTIMASI kecepatan yang dilaporkan Chrome untuk SEMUA
 * jenis koneksi termasuk WiFi saat `type` sendiri tidak tersedia, jadi itu akan salah label
 * mayoritas WiFi Android jadi "cellular". Sekarang HANYA percaya `type` eksplisit; kalau browser
 * tidak melaporkannya, kembalikan null (tidak diketahui) — field ini murni informasi, salah label
 * lebih buruk daripada kosong. */
function detectNetworkType(): 'wifi' | 'cellular' | 'offline' | null {
	if (typeof navigator === 'undefined') return null;
	if ('onLine' in navigator && navigator.onLine === false) return 'offline';
	const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
	if (!conn) return null;
	const type = conn.type as string | undefined;
	if (type === 'wifi' || type === 'ethernet') return 'wifi';
	if (type === 'cellular') return 'cellular';
	return null;
}

export async function submitCheckin(params: CheckinParams): Promise<{ record: SiteCheckinRecord }> {
	const idToken = await getIdToken();
	// Paket 03 §3.2 — watermark SUDAH ditulis sekali saat foto diambil (CheckinForm.svelte
	// handleCapture), bukan di sini lagi. Menstempel dua kali (di sini + saat capture)
	// menumpuk kompas/peta/teks di posisi sama, foto terlihat rusak/dimanipulasi (SVR-08).
	const compressed = await compressPhoto(params.photoFile);

	const formData = new FormData();
	formData.append('referensi_id', String(params.referensiId));
	formData.append('lat', String(params.lat));
	formData.append('lng', String(params.lng));
	if (params.accuracy != null) formData.append('accuracy', String(params.accuracy));
	formData.append('foto', compressed, compressed.name || 'checkin.jpg');
	if (params.catatan) formData.append('catatan', params.catatan);
	if (params.bookingId) formData.append('booking_id', String(params.bookingId));
	if (params.tipeKeperluan) formData.append('tipe_keperluan', params.tipeKeperluan);
	if (params.clientCreatedAt) formData.append('client_created_at', params.clientCreatedAt);
	if (params.clientTxnId) formData.append('client_txn_id', params.clientTxnId);
	const networkType = detectNetworkType();
	if (networkType) formData.append('network_type', networkType);

	const res = await fetchWithTimeout(
		'/api/site-checkin',
		{ method: 'POST', headers: { Authorization: `Bearer ${idToken}` }, body: formData },
		30_000
	);
	if (!res.ok) await throwHttpError(res);
	return res.json();
}

interface CheckoutParams {
	// Paket 02 §3.9.2 (worst case I) — kosong diperbolehkan HANYA bila checkinClientTxnId
	// diisi (checkout diantrekan sebelum checkin_id server diketahui); server me-resolve.
	checkinId: string;
	// Diisi saat checkinId masih kosong (lihat catatan di atas) — server mencari baris
	// check-in lewat client_txn_id-nya sendiri.
	checkinClientTxnId?: string | null;
	lat?: number | null;
	lng?: number | null;
	accuracy?: number | null;
	photoFile?: File | null;
	// Fase 3 (Q7-a) — form kunjungan, dijembatani ke project_visit_leader
	kegiatan?: string;
	temuan?: string;
	tindakLanjut?: string;
	rencanaBesok?: string;
	// "4-Gate Site Visit System" Fase 3 (8 Sep 2026) — form checkout tipe 'marketing',
	// dijembatani ke follow_ups.
	picDitemui?: string;
	jabatanPic?: string;
	noWaPic?: string;
	hasilMeeting?: string;
	statusBant?: { budget?: string; authority?: string; need?: string; timeline?: string };
	nextAction?: string;
	followUpDate?: string;
	// "4-Gate Site Visit System" Fase 3c (8 Sep 2026) — form checkout tipe 'maintenance',
	// dijembatani ke mekanik_activity.
	serviceLog?: string;
	sparepartDipakai?: string;
	statusUnit?: string;
	hourMeter?: number;
	// Paket 02 §3.9 — idempotensi replay checkout offline (pola sama client_txn_id check-in).
	clientTxnId?: string | null;
	clientCreatedAt?: string | null;
}

export async function submitCheckout(params: CheckoutParams): Promise<{ record: SiteCheckinRecord }> {
	const idToken = await getIdToken();
	const formData = new FormData();
	if (params.checkinId) formData.append('checkin_id', params.checkinId);
	if (params.checkinClientTxnId) formData.append('checkin_client_txn_id', params.checkinClientTxnId);
	if (params.clientTxnId) formData.append('client_txn_id', params.clientTxnId);
	if (params.clientCreatedAt) formData.append('client_created_at', params.clientCreatedAt);
	if (params.lat != null) formData.append('lat', String(params.lat));
	if (params.lng != null) formData.append('lng', String(params.lng));
	if (params.accuracy != null) formData.append('accuracy', String(params.accuracy));
	if (params.kegiatan) formData.append('kegiatan', params.kegiatan);
	if (params.temuan) formData.append('temuan', params.temuan);
	if (params.tindakLanjut) formData.append('tindak_lanjut', params.tindakLanjut);
	if (params.rencanaBesok) formData.append('rencana_besok', params.rencanaBesok);
	if (params.picDitemui) formData.append('pic_ditemui', params.picDitemui);
	if (params.jabatanPic) formData.append('jabatan_pic', params.jabatanPic);
	if (params.noWaPic) formData.append('no_wa_pic', params.noWaPic);
	if (params.hasilMeeting) formData.append('hasil_meeting', params.hasilMeeting);
	if (params.statusBant) formData.append('status_bant', JSON.stringify(params.statusBant));
	if (params.nextAction) formData.append('next_action', params.nextAction);
	if (params.followUpDate) formData.append('follow_up_date', params.followUpDate);
	if (params.serviceLog) formData.append('service_log', params.serviceLog);
	if (params.sparepartDipakai) formData.append('sparepart_dipakai', params.sparepartDipakai);
	if (params.statusUnit) formData.append('status_unit', params.statusUnit);
	if (params.hourMeter != null) formData.append('hour_meter', String(params.hourMeter));

	if (params.photoFile) {
		// Paket 03 §3.2 — watermark SUDAH ditulis sekali saat foto diambil (CheckoutDialog.svelte
		// handleCapture, dengan GPS SAAT ITU — boleh null). SEBELUMNYA di sini: `lat ?? 0, lng ?? 0`
		// membuat checkout tanpa GPS (di dalam gedung) berstempel 0.0000,0.0000 — koordinat NYATA
		// di Teluk Guinea, bukan "tidak ada data" (SVR-08 poin 3). Tidak lagi relevan — hanya kompres.
		const compressed = await compressPhoto(params.photoFile);
		formData.append('foto', compressed, compressed.name || 'checkout.jpg');
	}

	const res = await fetchWithTimeout(
		'/api/site-checkin/checkout',
		{ method: 'POST', headers: { Authorization: `Bearer ${idToken}` }, body: formData },
		30_000
	);
	if (!res.ok) await throwHttpError(res);
	return res.json();
}

export async function getActiveCheckin(): Promise<{ record: SiteCheckinRecord | null }> {
	const idToken = await getIdToken();
	const res = await fetchWithTimeout(
		'/api/site-checkin/active',
		{ headers: { Authorization: `Bearer ${idToken}` } },
		15_000
	);
	if (!res.ok) await throwHttpError(res);
	return res.json();
}

export interface SiteCheckinProjectOption {
	id: number;
	name: string;
	lokasi: string | null;
	geo_lat: number | null;
	geo_lng: number | null;
	geo_radius_m: number | null;
	peran: 'leader' | 'manpower_leader' | 'wakil_leader' | 'anggota_regu' | 'kunjungan';
	// UX-03: disambiguasi proyek bernama identik. UX-04: tier yang akan dicatat ke absensi.
	status: string | null;
	tier_absensi: string | null;
	// Paket 04 §3.7 — untuk debugging: dari jalur mana proyek ini masuk daftar.
	sumber_cocok?: 'leader_id' | 'nama' | 'manpower' | 'kunjungan';
}

// Paket 04 §3.7 — q opsional: kotak cari "Cari proyek lain…" (>=2 huruf) untuk mencari proyek
// kunjungan di luar 200 pertama, tanpa menampilkan daftar panjang di HP 2G.
export async function getMyProjects(q?: string): Promise<{ projects: SiteCheckinProjectOption[]; assignedCount?: number }> {
	const idToken = await getIdToken();
	const qs = q && q.trim().length >= 2 ? `?q=${encodeURIComponent(q.trim())}` : '';
	const res = await fetchWithTimeout(
		`/api/site-checkin/my-projects${qs}`,
		{ headers: { Authorization: `Bearer ${idToken}` } },
		15_000
	);
	if (!res.ok) await throwHttpError(res);
	return res.json();
}

export interface SiteCheckinProspectOption {
	id: number;
	name: string;
	company: string | null;
	stage: string | null;
	peran: 'assigned' | 'lainnya';
}

/** "4-Gate Site Visit System" Fase 3 — daftar prospect untuk check-in tipe 'marketing'. */
export async function getMyProspects(): Promise<{ prospects: SiteCheckinProspectOption[]; assignedCount?: number }> {
	const idToken = await getIdToken();
	const res = await fetchWithTimeout(
		'/api/site-checkin/my-prospects',
		{ headers: { Authorization: `Bearer ${idToken}` } },
		15_000
	);
	if (!res.ok) await throwHttpError(res);
	return res.json();
}

export interface SiteCheckinWorkOrderOption {
	id: string;
	wo_number: string | null;
	equipment_name: string | null;
	peran: 'assigned' | 'lainnya';
}

/** "4-Gate Site Visit System" Fase 3c — daftar work order untuk check-in tipe 'maintenance'. */
export async function getMyWorkOrders(q?: string): Promise<{ workOrders: SiteCheckinWorkOrderOption[]; assignedCount?: number }> {
	const idToken = await getIdToken();
	const qs = q && q.trim().length >= 2 ? `?q=${encodeURIComponent(q.trim())}` : '';
	const res = await fetchWithTimeout(
		`/api/site-checkin/my-work-orders${qs}`,
		{ headers: { Authorization: `Bearer ${idToken}` } },
		15_000
	);
	if (!res.ok) await throwHttpError(res);
	return res.json();
}

// Paket 09 §2.6 — hoursmeter TERAKHIR tercatat untuk equipment WO ini (query terpisah di
// server), dipakai peringatan "lebih kecil dari catatan terakhir" di CheckoutDialog.
export async function getLastHoursmeter(workOrderId: string): Promise<{ hoursmeter: number | null; tanggalInput: string | null }> {
	const idToken = await getIdToken();
	const res = await fetch(`/api/site-checkin/last-hoursmeter?workOrderId=${encodeURIComponent(workOrderId)}`, {
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) return { hoursmeter: null, tanggalInput: null };
	return res.json();
}

/**
 * R1 (Fase 0) — patok koordinat proyek dari GPS perangkat saat check-in di lokasi.
 * Hanya berhasil bila proyek belum punya geo_lat/geo_lng (server menolak menimpa data GA).
 */
export async function saveProjectCoordinate(params: {
	projectId: number;
	lat: number;
	lng: number;
	accuracy?: number | null;
}): Promise<{ ok: true; geo_lat: number; geo_lng: number; geo_radius_m: number }> {
	const idToken = await getIdToken();
	const res = await fetchWithTimeout(
		'/api/site-checkin/project-koordinat',
		{
			method: 'POST',
			headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				projectId: params.projectId,
				lat: params.lat,
				lng: params.lng,
				accuracy: params.accuracy ?? null
			})
		},
		15_000
	);
	if (!res.ok) await throwHttpError(res);
	return res.json();
}

/**
 * UX-07 (correction plan site-visit-payroll): laporkan koordinat proyek yang kelihatan salah
 * (SUDAH ada koordinat, tapi leader selalu tampak di luar geofence). BEDA dari
 * saveProjectCoordinate() — ini tidak langsung menimpa geo_lat/geo_lng, hanya masuk antrean
 * usulan yang direview GA (lihat ProyekLokasiWizard di erp-epi).
 */
export async function laporKoordinatProyekSalah(params: {
	projectId: number;
	lat: number;
	lng: number;
	accuracy?: number | null;
}): Promise<{ ok: true }> {
	const idToken = await getIdToken();
	const res = await fetchWithTimeout(
		'/api/site-checkin/report-koordinat-salah',
		{
			method: 'POST',
			headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({
				projectId: params.projectId,
				lat: params.lat,
				lng: params.lng,
				accuracy: params.accuracy ?? null
			})
		},
		15_000
	);
	if (!res.ok) await throwHttpError(res);
	return res.json();
}

export interface VisitPickerOption {
	id: string;
	tipe_checkin: string;
	nama_lokasi: string | null;
	check_in_at: string;
	check_out_at: string | null;
	durasi_menit: number | null;
	in_geofence: boolean | null;
	status: 'active' | 'completed' | 'cancelled';
	flagged_durasi_rendah: boolean;
	flagged_luar_geofence: boolean;
}

/** "4-Gate Site Visit System" Fase 3b — daftar kunjungan untuk VisitPicker (reimburse &
 *  biaya-lapangan). Beda dari getTodayCheckins() (selalu hari ini) — menerima rentang hari. */
export async function fetchMyVisits(days = 7): Promise<{ visits: VisitPickerOption[] }> {
	const idToken = await getIdToken();
	const res = await fetchWithTimeout(
		`/api/site-checkin/my-visits?days=${days}`,
		{ headers: { Authorization: `Bearer ${idToken}` } },
		15_000
	);
	if (!res.ok) await throwHttpError(res);
	return res.json();
}

export async function getTodayCheckins(): Promise<{ records: SiteCheckinRecord[] }> {
	const idToken = await getIdToken();
	const res = await fetchWithTimeout(
		'/api/site-checkin',
		{ headers: { Authorization: `Bearer ${idToken}` } },
		15_000
	);
	if (!res.ok) await throwHttpError(res);
	return res.json();
}

/**
 * Fase 4 — dipanggil setelah laporan harian tersimpan sukses. Fail-safe MUTLAK: tidak
 * pernah throw, kegagalan apa pun (jaringan, tidak login, dll) ditelan diam-diam supaya
 * jalur penyimpanan laporan tidak pernah terganggu olehnya (lihat reports.ts::submitReport).
 */
export async function triggerAutoCheckout(reportId?: number | string | null, projectId?: number | string | null): Promise<void> {
	try {
		const idToken = await getIdToken();
		await fetchWithTimeout(
			'/api/site-checkin/auto-checkout',
			{
				method: 'POST',
				headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
				// Paket 10 §2.3 (SVR-29) — projectId dikirim supaya server hanya menutup kunjungan
				// aktif bila memang proyek laporan ini, bukan proyek lain yang kebetulan aktif.
				body: JSON.stringify({ reportId: reportId ?? null, projectId: projectId ?? null })
			},
			15_000
		);
	} catch {
		// diam-diam — lihat catatan fail-safe di atas
	}
}

export interface SiteCheckinSettings {
	foto_checkin_wajib: boolean;
	foto_checkout_wajib: boolean;
	radius_default_m: number;
	min_durasi_menit: number;
	max_durasi_jam: number;
	// UX-05: gate untuk prompt "Masih di lokasi?" setelah laporan harian — false berarti
	// submit laporan tidak pernah menyentuh check-in aktif sama sekali.
	auto_checkout_on_report: boolean;
	// Paket 04 Site Visit Release §3.1/§3.2 — gate akurasi GPS.
	akurasi_maks_m: number | null;
	akurasi_mode: 'shadow' | 'soft' | 'hard' | null;
	akurasi_enforce_from: string | null;
	// Paket 06 §2.1/§2.4 — jendela klaim & rentang picker kunjungan.
	visit_picker_hari: number;
	maks_selisih_hari_klaim: number;
	// Paket 09 Site Visit Release §0 — tab Maintenance disembunyikan sampai admin mengaktifkan.
	tipe_maintenance_aktif: boolean;
	// Paket 10 Site Visit Release §2.2 — jam pengingat lupa checkout (csv, WIB), default 17:30,21:00.
	pengingat_checkout_jam: string | null;
}

// Paket 06 §2.5 (Aturan #3) — UI ikut mode SERVER (bukan hardcode terkunci): 'hard' saja
// yang boleh memblokir tombol; 'soft' tampil peringatan tapi tetap bisa submit; 'shadow'
// tanpa peringatan sama sekali.
export interface FieldGateModeMap {
	G_RMR_VISIT: 'shadow' | 'soft' | 'hard';
	G_BBM_VISIT: 'shadow' | 'soft' | 'hard';
}

export async function getSiteCheckinSettings(): Promise<{ settings: SiteCheckinSettings; mode_gate: FieldGateModeMap }> {
	const idToken = await getIdToken();
	const res = await fetchWithTimeout(
		'/api/site-checkin/settings',
		{ headers: { Authorization: `Bearer ${idToken}` } },
		15_000
	);
	if (!res.ok) await throwHttpError(res);
	return res.json();
}
