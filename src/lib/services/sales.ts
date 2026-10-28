import directus, { handleDirectusError } from './directus';
import { readItems, readItem, createItem, updateItem, uploadFiles } from '@directus/sdk';
import { auth } from '$lib/firebase';
import { HttpError } from '$lib/utils/networkError';

export type VerifikasiStatus = 'draft' | 'submitted' | 'verified' | 'rejected';

/**
 * Fase 2a (Maksimalisasi Notifikasi Sales): kirim event ke /api/sales/notify (relay ke
 * erp-epi-1). Best-effort — TIDAK PERNAH melempar error, supaya kegagalan notifikasi tidak
 * pernah menggagalkan alur submit visit/laporan yang sebenarnya.
 */
async function notifySales(
	eventCode: string,
	message: string,
	opts: { karyawanId?: number; sourceCollection?: string; sourceId?: number | string } = {}
): Promise<void> {
	try {
		const user = auth.currentUser;
		if (!user) return;
		const idToken = await user.getIdToken();
		await fetch('/api/sales/notify', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
			body: JSON.stringify({ eventCode, message, ...opts })
		});
	} catch (e) {
		console.warn('[sales] gagal kirim notifikasi (diabaikan):', e);
	}
}

export interface CustomerOption {
	id: number;
	customer_name: string;
	kode_customer: string;
	alamat?: string | null;
	alamat_surat_jalan?: string | null;
	alamat_penagihan?: string | null;
	kota?: string | null;
	telepon?: string | null;
	telp?: string | null;
	pic_nama?: string | null;
	contact_person?: string | null;
	pic_telepon?: string | null;
	// Paket 08c Site Visit Release §5.1 — status lokasi "Anda di lokasi customer" di /sales/baru.
	latitude?: number | null;
	longitude?: number | null;
}

export interface CustomerRelationInfo {
	nama: string;
	kode?: string | null;
	pic?: string | null;
	alamat?: string | null;
	telp?: string | null;
}

export interface VisitSalesRow {
	id: number;
	tanggal_kunjungan: string;
	sales_name: string;
	sales_id: number | null;
	tujuan: string;
	kendaraan_id: number | null;
	kegiatan: string;
	status: string;
	masterCustomerId: number | null;
	customer_name: string | null;
	customer_kode?: string | null;
	customer_pic?: string | null;
	customer_alamat?: string | null;
	customer_telp?: string | null;
	check_in_at: string | null;
	check_out_at: string | null;
	latitude: number | null;
	longitude: number | null;
	foto_id: string | null;
	hasil_kunjungan: string | null;
	follow_up_date: string | null;
	verifikasi_status: VerifikasiStatus;
	catatan_spv: string | null;
}

export interface SalesVisitKpis {
	kunjunganHariIni: number;
	menungguVerifikasi: number;
	terverifikasi: number;
}

const VISIT_FIELDS = [
	'id',
	'tanggal_kunjungan',
	'sales_name',
	'sales_id',
	'tujuan',
	'kendaraan_id',
	'kegiatan',
	'status',
	'master_customer_id',
	'check_in_at',
	'check_out_at',
	'latitude',
	'longitude',
	'foto_id',
	'hasil_kunjungan',
	'follow_up_date',
	'verifikasi_status',
	'catatan_spv'
];

function mapVisitRow(row: any, customerInfo?: CustomerRelationInfo | string | null): VisitSalesRow {
	const masterCustomerId = typeof row.master_customer_id === 'object' ? row.master_customer_id?.id : row.master_customer_id;
	const isObj = typeof customerInfo === 'object' && customerInfo !== null;
	const resolvedName = isObj ? customerInfo.nama : (typeof customerInfo === 'string' ? customerInfo : (typeof row.master_customer_id === 'object' ? row.master_customer_id?.nama_sj_fp : null));
	const resolvedKode = isObj ? (customerInfo.kode || null) : null;
	const resolvedPic = isObj ? (customerInfo.pic || null) : null;
	const resolvedAlamat = isObj ? (customerInfo.alamat || null) : null;
	const resolvedTelp = isObj ? (customerInfo.telp || null) : null;

	return {
		id: row.id,
		tanggal_kunjungan: row.tanggal_kunjungan,
		sales_name: row.sales_name,
		sales_id: row.sales_id ?? null,
		tujuan: row.tujuan,
		kendaraan_id: row.kendaraan_id ?? null,
		kegiatan: row.kegiatan,
		status: row.status,
		masterCustomerId: masterCustomerId ?? null,
		customer_name: resolvedName ?? null,
		customer_kode: resolvedKode,
		customer_pic: resolvedPic,
		customer_alamat: resolvedAlamat,
		customer_telp: resolvedTelp,
		check_in_at: row.check_in_at ?? null,
		check_out_at: row.check_out_at ?? null,
		latitude: row.latitude != null ? Number(row.latitude) : null,
		longitude: row.longitude != null ? Number(row.longitude) : null,
		foto_id: row.foto_id ?? null,
		hasil_kunjungan: row.hasil_kunjungan ?? null,
		follow_up_date: row.follow_up_date ?? null,
		verifikasi_status: row.verifikasi_status || 'draft',
		catatan_spv: row.catatan_spv ?? null
	};
}

export async function getCustomerOptions(search?: string): Promise<CustomerOption[]> {
	try {
		const q = (search || '').trim();
		const filter: any = {};
		if (q) {
			filter._or = [
				{ nama_sj_fp: { _icontains: q } },
				{ kode_customer: { _icontains: q } },
				{ contact_person: { _icontains: q } }
			];
		}
		const result = (await directus.request(
			readItems('master_customer', {
				filter,
				fields: ['id', 'nama_sj_fp', 'kode_customer', 'alamat_surat_jalan', 'alamat_penagihan', 'telp', 'contact_person', 'latitude', 'longitude'],
				sort: ['nama_sj_fp'],
				limit: 50
			})
		)) as any[];
		return result.map((r) => ({
			id: r.id,
			customer_name: r.nama_sj_fp || `Customer #${r.id}`,
			kode_customer: r.kode_customer || '',
			alamat: r.alamat_surat_jalan || r.alamat_penagihan || null,
			alamat_surat_jalan: r.alamat_surat_jalan || null,
			alamat_penagihan: r.alamat_penagihan || null,
			kota: null,
			telepon: r.telp || null,
			telp: r.telp || null,
			pic_nama: r.contact_person || null,
			contact_person: r.contact_person || null,
			pic_telepon: r.telp || null,
			latitude: r.latitude ?? null,
			longitude: r.longitude ?? null
		}));
	} catch (error) {
		console.error('[sales] getCustomerOptions error:', error);
		return [];
	}
}

export async function getCustomerById(id: number): Promise<CustomerOption | null> {
	try {
		const r: any = await directus.request(
			readItem('master_customer', id, {
				fields: ['id', 'nama_sj_fp', 'kode_customer', 'alamat_surat_jalan', 'alamat_penagihan', 'telp', 'contact_person', 'latitude', 'longitude']
			})
		);
		if (!r) return null;
		return {
			id: r.id,
			customer_name: r.nama_sj_fp || `Customer #${r.id}`,
			kode_customer: r.kode_customer || '',
			alamat: r.alamat_surat_jalan || r.alamat_penagihan || null,
			alamat_surat_jalan: r.alamat_surat_jalan || null,
			alamat_penagihan: r.alamat_penagihan || null,
			kota: null,
			telepon: r.telp || null,
			telp: r.telp || null,
			pic_nama: r.contact_person || null,
			contact_person: r.contact_person || null,
			pic_telepon: r.telp || null,
			latitude: r.latitude ?? null,
			longitude: r.longitude ?? null
		};
	} catch (error) {
		console.error('[sales] getCustomerById error:', error);
		return null;
	}
}

export async function getRecentVisitedCustomers(salesId: number | null, limit = 6): Promise<CustomerOption[]> {
	try {
		const visits = await getMyVisits(salesId, 25);
		const seen = new Set<number>();
		const result: CustomerOption[] = [];
		for (const v of visits) {
			if (v.masterCustomerId && !seen.has(v.masterCustomerId) && v.customer_name) {
				seen.add(v.masterCustomerId);
				result.push({
					id: v.masterCustomerId,
					customer_name: v.customer_name,
					kode_customer: ''
				});
				if (result.length >= limit) break;
			}
		}
		return result;
	} catch {
		return [];
	}
}

export async function getMyVisits(salesId: number | null, limit = 150): Promise<VisitSalesRow[]> {
	try {
		const filter = salesId ? { sales_id: { _eq: salesId } } : {};
		const result = (await directus.request(
			readItems('visit_sales', {
				filter,
				fields: VISIT_FIELDS,
				sort: ['-tanggal_kunjungan', '-id'],
				limit
			})
		)) as any[];

		if (!result || result.length === 0) return [];

		// Separated relation fetching for master_customer
		const customerIds = [
			...new Set(
				result
					.map((r) => (typeof r.master_customer_id === 'object' ? r.master_customer_id?.id : r.master_customer_id))
					.filter((id): id is number => typeof id === 'number' && id > 0)
			)
		];

		const customerMap = new Map<number, CustomerRelationInfo>();
		if (customerIds.length > 0) {
			try {
				const customers = (await directus.request(
					readItems('master_customer', {
						filter: { id: { _in: customerIds } },
						fields: ['id', 'nama_sj_fp', 'kode_customer', 'contact_person', 'alamat_surat_jalan', 'telp'],
						limit: customerIds.length
					})
				)) as any[];
				customers.forEach((c) => {
					if (c && c.id) {
						customerMap.set(c.id, {
							nama: c.nama_sj_fp || '',
							kode: c.kode_customer || null,
							pic: c.contact_person || null,
							alamat: c.alamat_surat_jalan || null,
							telp: c.telp || null
						});
					}
				});
			} catch (cErr) {
				console.warn('[sales] Gagal fetch relasi master_customer terpisah:', cErr);
			}
		}

		return result.map((row) => {
			const mId = typeof row.master_customer_id === 'object' ? row.master_customer_id?.id : row.master_customer_id;
			const cInfo = mId ? customerMap.get(mId) || null : null;
			return mapVisitRow(row, cInfo);
		});
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function getVisitById(id: number): Promise<VisitSalesRow | null> {
	try {
		const row: any = await directus.request(readItem('visit_sales', id, { fields: VISIT_FIELDS }));
		if (!row) return null;

		let customerInfo: CustomerRelationInfo | null = null;
		const mId = typeof row.master_customer_id === 'object' ? row.master_customer_id?.id : row.master_customer_id;
		if (mId && typeof mId === 'number') {
			try {
				const cust: any = await directus.request(
					readItem('master_customer', mId, {
						fields: ['id', 'nama_sj_fp', 'kode_customer', 'contact_person', 'alamat_surat_jalan', 'telp']
					})
				);
				if (cust) {
					customerInfo = {
						nama: cust.nama_sj_fp || '',
						kode: cust.kode_customer || null,
						pic: cust.contact_person || null,
						alamat: cust.alamat_surat_jalan || null,
						telp: cust.telp || null
					};
				}
			} catch (cErr) {
				console.warn('[sales] Gagal fetch customer di getVisitById:', cErr);
			}
		}

		return mapVisitRow(row, customerInfo);
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/**
 * Verifikasi kunjungan sales oleh SPV / Admin.
 */
export async function verifyVisit(
	id: number,
	status: 'verified' | 'rejected',
	catatanSpv?: string | null
): Promise<VisitSalesRow | null> {
	try {
		const payload: any = {
			verifikasi_status: status,
			catatan_spv: catatanSpv || null
		};
		const row: any = await directus.request(updateItem('visit_sales', id, payload));
		const visit = mapVisitRow(row);
		const eventCode = status === 'verified' ? 'VISIT_VERIFIED' : 'VISIT_REJECTED';
		const msg = status === 'verified'
			? `Kunjungan ke ${visit.tujuan || 'customer'} telah diverifikasi & disetujui SPV.`
			: `Kunjungan ke ${visit.tujuan || 'customer'} ditolak SPV. Catatan: ${catatanSpv || '-'}`;
		notifySales(eventCode, msg, {
			sourceCollection: 'visit_sales',
			sourceId: visit.id
		});
		return visit;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

// Paket 08b Site Visit Release §4.3 (SVR-13 worst case #7) — "hari ini" WIB, bukan UTC (kunjungan
// 00:00-06:59 WIB sebelumnya dihitung masuk hari SEBELUMNYA di KPI ini).
function todayWib(): string {
	return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
}

export async function getSalesVisitKpis(salesId: number | null): Promise<SalesVisitKpis> {
	const today = todayWib();
	try {
		const filter = salesId ? { sales_id: { _eq: salesId } } : {};
		const rows = (await directus.request(
			readItems('visit_sales', {
				filter,
				fields: ['id', 'tanggal_kunjungan', 'verifikasi_status'],
				limit: -1
			})
		)) as any[];
		return {
			kunjunganHariIni: rows.filter((r) => r.tanggal_kunjungan === today).length,
			menungguVerifikasi: rows.filter((r) => r.verifikasi_status === 'submitted').length,
			terverifikasi: rows.filter((r) => r.verifikasi_status === 'verified').length
		};
	} catch (error) {
		handleDirectusError(error);
		return { kunjunganHariIni: 0, menungguVerifikasi: 0, terverifikasi: 0 };
	}
}

/**
 * Paket 08b Site Visit Release §4.3 — fetch ke server (bukan Directus SDK langsung dari
 * browser). Identitas sales & site_checkin tertaut kini SELALU diresolusi server-side
 * (/api/sales/visit/checkin) — worst case #8 dokumen: sebelumnya sales_id/sales_name dikirim
 * dari klien apa adanya, bisa dipalsukan begitu saja.
 */
export async function checkInVisit(params: {
	// Paket 08c §5.1 — salah satu wajib ada (customer existing ATAU prospek baru, tab "Prospek
	// Baru" di /sales/baru); endpoint /api/sales/visit/checkin sudah mendukung keduanya sejak 08b.
	customerId?: number | null;
	prospectId?: number | null;
	tujuan: string;
	latitude: number;
	longitude: number;
	accuracy?: number | null;
	fotoFile?: File | null;
	bookingId?: string | null;
	clientCreatedAt?: string | null;
	// Paket 08c §5.3 — write-ahead offline: dibuat SEKALI oleh pemanggil (sebelum tahu hasil
	// online/offline, pola sama submitCheckin) supaya replay dari antrean (siteCheckinSync.ts)
	// mengirim ID yang SAMA, bukan baru tiap percobaan (yang akan bikin site_checkin dobel
	// kalau request pertama sebenarnya sukses tapi responsnya hilang di jalan).
	clientTxnId?: string;
}): Promise<VisitSalesRow> {
	const idToken = await auth.currentUser?.getIdToken();
	if (!idToken) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	if (!params.prospectId && !params.customerId) {
		throw new Error('Pilih customer atau prospek tujuan terlebih dahulu.');
	}

	const formData = new FormData();
	if (params.prospectId) formData.append('prospect_id', String(params.prospectId));
	else formData.append('master_customer_id', String(params.customerId));
	formData.append('tujuan', params.tujuan);
	formData.append('lat', String(params.latitude));
	formData.append('lng', String(params.longitude));
	if (params.accuracy != null) formData.append('accuracy', String(params.accuracy));
	if (params.fotoFile) formData.append('foto', params.fotoFile, params.fotoFile.name || 'checkin.jpg');
	if (params.bookingId) formData.append('booking_id', params.bookingId);
	if (params.clientCreatedAt) formData.append('client_created_at', params.clientCreatedAt);
	formData.append('client_txn_id', params.clientTxnId || crypto.randomUUID());

	const res = await fetch('/api/sales/visit/checkin', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` },
		body: formData
	});
	if (!res.ok) {
		const body = await res.json().catch(() => null);
		throw new Error(body?.message || 'Gagal memulai kunjungan.');
	}
	const data = await res.json();
	if (!data.visit) {
		// §4.2 poin 6 — site_checkin tersimpan, tapi visit_sales gagal ditulis. Beri tahu
		// pengguna apa adanya, jangan pura-pura sukses.
		throw new Error(data.peringatan || 'Kunjungan tercatat, tetapi data sales belum lengkap. Hubungi admin.');
	}
	return mapVisitRow(data.visit);
}

/** @deprecated Paket 08b — foto sekarang dikirim langsung ke /api/sales/visit/[id]/submit
 *  (multipart), tidak diunggah terpisah dari browser. Dipertahankan hanya untuk kompatibilitas
 *  bila ada pemanggil lama yang belum di-refresh. */
export async function uploadVisitPhoto(file: File): Promise<string | null> {
	try {
		const formData = new FormData();
		formData.append('file', file);
		formData.append('description', 'visit_sales:evidence');
		const result: any = await directus.request(uploadFiles(formData));
		return result?.id || null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/**
 * Submit kunjungan: check-out + hasil + foto + rencana follow-up.
 * Status verifikasi masuk 'submitted' agar SPV/Admin memverifikasi di :9391.
 * Paket 08b §4.3 — fetch ke /api/sales/visit/[id]/submit (server memvalidasi kepemilikan,
 * upload foto, dan GAGAL bila upload gagal — bukan diam-diam lanjut tanpa foto, SVR-38).
 */
export async function submitVisit(
	id: number,
	params: {
		hasilKunjungan: string;
		followUpDate: string | null;
		nextAction?: string | null;
		fotoFile: File | null;
		kegiatan: string;
		lat?: number | null;
		lng?: number | null;
		accuracy?: number | null;
		picDitemui?: string | null;
		jabatanPic?: string | null;
		noWaPic?: string | null;
		statusBant?: Record<string, string | null> | null;
		// Paket 08c §5.3 — write-ahead offline (pola sama checkInVisit): dibuat SEKALI oleh
		// pemanggil supaya replay dari antrean mengirim ID yang sama, bukan baru tiap percobaan.
		clientTxnId?: string;
	}
): Promise<VisitSalesRow> {
	const idToken = await auth.currentUser?.getIdToken();
	if (!idToken) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');

	const formData = buildSubmitVisitFormData(params);

	const res = await fetch(`/api/sales/visit/${id}/submit`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` },
		body: formData
	});
	if (!res.ok) {
		const body = await res.json().catch(() => null);
		throw new Error(body?.message || 'Gagal mengirim hasil kunjungan.');
	}
	const data = await res.json();
	// Notifikasi VISIT_SUBMITTED sekarang dikirim SERVER-SIDE dalam endpoint di atas (tidak lagi
	// dari sini) — mencegah notifikasi dobel dan identitas sales yang bisa dipalsukan dari klien.
	return mapVisitRow(data.visit);
}

interface SubmitVisitParams {
	hasilKunjungan: string;
	followUpDate: string | null;
	nextAction?: string | null;
	fotoFile: File | null;
	kegiatan: string;
	lat?: number | null;
	lng?: number | null;
	accuracy?: number | null;
	picDitemui?: string | null;
	jabatanPic?: string | null;
	noWaPic?: string | null;
	statusBant?: Record<string, string | null> | null;
	clientTxnId?: string;
}

function buildSubmitVisitFormData(params: SubmitVisitParams): FormData {
	const formData = new FormData();
	formData.append('hasil_kunjungan', params.hasilKunjungan);
	formData.append('kegiatan', params.kegiatan || '');
	if (params.followUpDate) formData.append('follow_up_date', params.followUpDate);
	if (params.nextAction) formData.append('next_action', params.nextAction);
	if (params.fotoFile) formData.append('foto', params.fotoFile, params.fotoFile.name || 'submit.jpg');
	if (params.lat != null) formData.append('lat', String(params.lat));
	if (params.lng != null) formData.append('lng', String(params.lng));
	if (params.accuracy != null) formData.append('accuracy', String(params.accuracy));
	if (params.picDitemui) formData.append('pic_ditemui', params.picDitemui);
	if (params.jabatanPic) formData.append('jabatan_pic', params.jabatanPic);
	if (params.noWaPic) formData.append('no_wa_pic', params.noWaPic);
	if (params.statusBant) formData.append('status_bant', JSON.stringify(params.statusBant));
	formData.append('client_txn_id', params.clientTxnId || crypto.randomUUID());
	return formData;
}

/**
 * Paket 08c §5.3 — submit hasil kunjungan yang DIMULAI OFFLINE (visitId belum diketahui klien,
 * hanya checkin_client_txn_id dari antrean check-in pasangannya). Dipakai HANYA oleh
 * siteCheckinSync.ts; submit normal (visitId sudah ada) tetap lewat submitVisit() di atas.
 */
export async function submitVisitByTxn(checkinClientTxnId: string, params: SubmitVisitParams): Promise<VisitSalesRow> {
	const idToken = await auth.currentUser?.getIdToken();
	if (!idToken) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');

	const formData = buildSubmitVisitFormData(params);
	formData.append('checkin_client_txn_id', checkinClientTxnId);

	const res = await fetch('/api/sales/visit/submit-by-txn', {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` },
		body: formData
	});
	if (!res.ok) {
		const body = await res.json().catch(() => null);
		throw new HttpError(body?.message || 'Gagal mengirim hasil kunjungan.', res.status);
	}
	const data = await res.json();
	return mapVisitRow(data.visit);
}

/**
 * Ambil koordinat GPS browser. Reject dengan pesan yang jelas kalau ditolak/tidak tersedia.
 */
export function getCurrentPosition(): Promise<{ latitude: number; longitude: number }> {
	return new Promise((resolve, reject) => {
		if (!navigator.geolocation) {
			reject(new Error('Perangkat tidak mendukung GPS.'));
			return;
		}
		navigator.geolocation.getCurrentPosition(
			(pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
			(err) => reject(new Error(err.message || 'Gagal mengambil lokasi GPS. Izinkan akses lokasi.')),
			{ enableHighAccuracy: true, timeout: 15000 }
		);
	});
}

export interface DailyReportRow {
	id: number;
	tanggal: string;
	total_kunjungan: number;
	total_order: number | null;
	ringkasan: string | null;
	kendala: string | null;
	verifikasi_status: VerifikasiStatus;
	catatan_spv: string | null;
}

const DAILY_REPORT_FIELDS = [
	'id',
	'tanggal',
	'total_kunjungan',
	'total_order',
	'ringkasan',
	'kendala',
	'verifikasi_status',
	'catatan_spv'
];

/**
 * Cek apakah sales sudah punya laporan harian untuk tanggal tsb (1 laporan per hari).
 */
export async function getTodayDailyReport(salesId: number, date: string): Promise<DailyReportRow | null> {
	try {
		const result = (await directus.request(
			readItems('sales_daily_report', {
				filter: { sales_id: { _eq: salesId }, tanggal: { _eq: date } },
				fields: DAILY_REPORT_FIELDS,
				limit: 1
			})
		)) as any[];
		return result[0] || null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

export async function getMyDailyReports(salesId: number, limit = 60): Promise<DailyReportRow[]> {
	try {
		return (await directus.request(
			readItems('sales_daily_report', {
				filter: { sales_id: { _eq: salesId } },
				fields: DAILY_REPORT_FIELDS,
				sort: ['-tanggal'],
				limit
			})
		)) as DailyReportRow[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/**
 * Hitung kunjungan hari ini sebagai rekap otomatis — sales tidak perlu isi ulang jumlah kunjungan.
 */
export async function countTodayVisits(salesId: number, date: string): Promise<number> {
	try {
		const result = (await directus.request(
			readItems('visit_sales', {
				filter: { sales_id: { _eq: salesId }, tanggal_kunjungan: { _eq: date } },
				fields: ['id'],
				limit: -1
			})
		)) as any[];
		return result.length;
	} catch (error) {
		handleDirectusError(error);
		return 0;
	}
}

export async function submitDailyReport(params: {
	salesId: number;
	salesName: string;
	tanggal: string;
	totalKunjungan: number;
	totalOrder: number | null;
	ringkasan: string;
	kendala: string;
}): Promise<DailyReportRow> {
	const row = (await directus.request(
		createItem('sales_daily_report', {
			sales_id: params.salesId,
			sales_name: params.salesName,
			tanggal: params.tanggal,
			total_kunjungan: params.totalKunjungan,
			total_order: params.totalOrder,
			ringkasan: params.ringkasan,
			kendala: params.kendala || null,
			verifikasi_status: 'submitted'
		})
	)) as DailyReportRow;
	notifySales('DAILY_REPORT_SUBMITTED', `${params.salesName} submit laporan harian ${params.tanggal} — menunggu verifikasi.`, {
		sourceCollection: 'sales_daily_report',
		sourceId: row.id
	});
	return row;
}

// ── Pipeline Prospek (Fase 3) — reuse koleksi `prospects` & `follow_ups` yang
// sudah dipakai modul CRM erp-epi-1 (src/lib/services/crmApi.js). Field & nilai
// stage/type di bawah harus tetap selaras dengan koleksi itu.

export type ProspectStage = 'new' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
export type FollowUpType = 'call' | 'meeting' | 'email' | 'whatsapp' | 'visit' | 'other';

export const PROSPECT_STAGES: { value: ProspectStage; label: string }[] = [
	{ value: 'new', label: 'Baru' },
	{ value: 'qualified', label: 'Kualifikasi' },
	{ value: 'proposal', label: 'Penawaran' },
	{ value: 'negotiation', label: 'Negosiasi' },
	{ value: 'won', label: 'Menang' },
	{ value: 'lost', label: 'Kalah' }
];

export function cleanSalesmanName(name?: string | null): string {
	if (!name) return '';
	const n = name.trim();
	const upper = n.toUpperCase();
	if (upper === 'AIE SUYA DILAGA') return 'AIE SURYA DILAGA';
	if (upper === 'ASEP ACHMAD YANUAR W.S') return 'ASEP ACHMAD YANUAR';
	if (upper === 'MOHAMMAD IKHSAN') return 'MOCHAMMAD IKHSAN';
	return n;
}

/**
 * Normalisasi dan resolusi nama tampilan Sales/PIC agar tidak pernah menampilkan email mentah.
 * Contoh:
 * - 'adit.eltamaprimaindo@gmail.com' -> 'Adit'
 * - 'santi@eltamaprimaindo.com' -> 'Santi'
 * - 'ASEP ACHMAD YANUAR W.S' -> 'ASEP ACHMAD YANUAR'
 */
export function resolveSalesDisplayName(raw?: string | null, karyawanList?: any[]): string {
	if (!raw || !raw.trim()) return 'Sales Rep';
	const str = raw.trim();

	// Jika ada match di karyawanList
	if (karyawanList && Array.isArray(karyawanList) && karyawanList.length > 0) {
		const lower = str.toLowerCase();
		const matchedKaryawan = karyawanList.find((k) => {
			return (
				(k.email_company && k.email_company.toLowerCase() === lower) ||
				(k.email && k.email.toLowerCase() === lower) ||
				(k.nama_karyawan && k.nama_karyawan.toLowerCase() === lower)
			);
		});
		if (matchedKaryawan?.nama_karyawan) {
			return cleanSalesmanName(matchedKaryawan.nama_karyawan);
		}
	}

	// Pengecekan alias email / nama umum yang sering muncul
	const lower = str.toLowerCase();
	if (lower.startsWith('adit.') || lower.startsWith('adit@') || lower.includes('adit.eltamaprimaindo')) {
		return 'Adit';
	}
	if (lower.startsWith('santi@') || lower.startsWith('santi.') || lower.includes('santi@eltama')) {
		return 'Santi';
	}
	if (lower.includes('asep')) {
		return 'ASEP ACHMAD YANUAR';
	}
	if (lower.includes('elvian')) {
		return 'Elvian Helmi';
	}
	if (lower.includes('ikhsan')) {
		return 'MOCHAMMAD IKHSAN';
	}

	// Jika mengandung email (@), ambil username di depan @ dan rapikan
	if (str.includes('@')) {
		const uname = str.split('@')[0];
		const cleaned = uname
			.replace(/[._\-+]/g, ' ')
			.replace(/\b\w/g, (c) => c.toUpperCase())
			.trim();
		return cleanSalesmanName(cleaned) || 'Sales Rep';
	}

	return cleanSalesmanName(str);
}

export interface SalesOption {
	name: string;
	email?: string | null;
	karyawanId?: number | null;
}

/**
 * @deprecated Pakai `getFieldSalesOptions()`. Fungsi ini menarik semua karyawan tanpa
 * filter divisi dan menyuntik nama hardcode (Adit/Santi) sehingga memunculkan
 * user non-sales lapangan di dropdown. Dipertahankan sementara untuk kompatibilitas.
 *
 * Mengambil daftar Sales Representative resmi & terpadu dari koleksi karyawan dan data historis.
 * Mematuhi aturan directus separated query tanpa multi-level expand.
 */
export async function getSalesRepresentativeOptions(): Promise<SalesOption[]> {
	try {
		let karyawanItems: any[] = [];
		try {
			karyawanItems = (await directus.request(
				readItems('karyawan', {
					fields: ['id', 'nama_karyawan', 'email_company', 'email', 'divisi', 'status'],
					limit: 200,
					sort: ['nama_karyawan']
				})
			)) as any[];
		} catch (e) {
			console.warn('[sales] getSalesRepresentativeOptions karyawan error:', e);
		}

		let activeNames = new Set<string>();
		try {
			const [visitRows, prospectRows] = await Promise.all([
				directus.request(
					readItems('visit_sales', {
						fields: ['sales_name'],
						limit: 100
					})
				) as Promise<any[]>,
				directus.request(
					readItems('prospects', {
						fields: ['assigned_name'],
						limit: 100
					})
				) as Promise<any[]>
			]);

			(visitRows || []).forEach((r) => {
				if (r.sales_name) activeNames.add(r.sales_name);
			});
			(prospectRows || []).forEach((r) => {
				if (r.assigned_name) activeNames.add(r.assigned_name);
			});
		} catch {}

		const optionsMap = new Map<string, SalesOption>();

		for (const k of karyawanItems) {
			if (k.nama_karyawan) {
				const cName = cleanSalesmanName(k.nama_karyawan);
				if (!optionsMap.has(cName)) {
					optionsMap.set(cName, {
						name: cName,
						email: k.email_company || k.email || null,
						karyawanId: k.id
					});
				}
			}
		}

		for (const raw of activeNames) {
			const resolved = resolveSalesDisplayName(raw, karyawanItems);
			if (resolved && resolved !== 'Sales Rep' && !optionsMap.has(resolved)) {
				optionsMap.set(resolved, {
					name: resolved,
					email: null,
					karyawanId: null
				});
			}
		}

		const standardSales = ['Adit', 'ASEP ACHMAD YANUAR', 'Elvian Helmi', 'MOCHAMMAD IKHSAN', 'Santi'];
		for (const s of standardSales) {
			if (!optionsMap.has(s)) {
				optionsMap.set(s, { name: s });
			}
		}

		return Array.from(optionsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
	} catch (error) {
		console.error('[sales] getSalesRepresentativeOptions error:', error);
		return [
			{ name: 'Adit' },
			{ name: 'ASEP ACHMAD YANUAR' },
			{ name: 'Elvian Helmi' },
			{ name: 'MOCHAMMAD IKHSAN' },
			{ name: 'Santi' }
		];
	}
}

/**
 * Divisi resmi untuk sales lapangan (field sales) di koleksi `karyawan`.
 * Catatan: divisi "SALES" berisi inside-sales/admin, bukan sales lapangan.
 */
const FIELD_SALES_DIVISI = 'MARKETING & SALES';

/**
 * Whitelist karyawan yang berperan sebagai sales lapangan namun tercatat di divisi lain.
 * - 237 = Elvian Helmi (divisi MANAGEMENT, tetap memegang pipeline sales)
 */
const FIELD_SALES_WHITELIST_IDS = [237];

/**
 * Daftar sales lapangan aktif untuk filter Pipeline Prospek.
 * Sumber: koleksi `karyawan` divisi "MARKETING & SALES" + whitelist, status != Off.
 * Tidak menyertakan user email/inside-sales dan tidak ada nama hardcode.
 */
export async function getFieldSalesOptions(): Promise<SalesOption[]> {
	try {
		const rows = (await directus.request(
			readItems('karyawan', {
				fields: ['id', 'nama_karyawan', 'email_company', 'email', 'divisi', 'status'],
				filter: {
					_and: [
						{ status: { _nin: ['Off', 'off', 'OFF'] } },
						{
							_or: [
								{ divisi: { _eq: FIELD_SALES_DIVISI } },
								{ id: { _in: FIELD_SALES_WHITELIST_IDS } }
							]
						}
					]
				},
				limit: 200,
				sort: ['nama_karyawan']
			})
		)) as any[];

		const optionsMap = new Map<string, SalesOption>();
		for (const k of rows) {
			if (!k?.nama_karyawan) continue;
			const cName = cleanSalesmanName(k.nama_karyawan);
			if (!cName || optionsMap.has(cName)) continue;
			optionsMap.set(cName, {
				name: cName,
				email: k.email_company || k.email || null,
				karyawanId: k.id
			});
		}

		return Array.from(optionsMap.values()).sort((a, b) => a.name.localeCompare(b.name));
	} catch (error) {
		console.error('[sales] getFieldSalesOptions error:', error);
		return [];
	}
}

export interface ProspectRow {
	id: number;
	name: string;
	company: string;
	phone: string;
	email: string;
	stage: ProspectStage;
	priority: 'low' | 'medium' | 'high';
	notes: string | null;
	expected_close: string | null;
	quoted_amount: number | null;
	po_amount?: number | null;
	assigned_name: string | null;
	display_assigned_name?: string;
	customer_id: number | null;
	lead_date?: string | null;
	date_created?: string | null;
	date_updated?: string | null;
	lost_reason?: string | null;
	tags?: string | null;
	// Omnichannel context
	source_channel?: string | null;
	omni_contact_id?: number | null;
	omni_channel?: 'WhatsApp' | 'Instagram' | 'Messenger' | 'Webchat' | string | null;
	// Attached relations (calculated or fetched separately)
	latest_follow_up?: FollowUpRow | null;
	next_follow_up?: string | null;
	follow_up_count?: number;
}

export interface FollowUpRow {
	id: number;
	// Paket 08d §6.2 — nullable: kunjungan ke master_customer tanpa prospek tertaut menulis
	// follow_ups.prospect_id = null (nama customer ada di `notes`, lihat visitMarketingBridge.ts).
	prospect_id: number | null;
	type: FollowUpType;
	notes: string | null;
	next_follow_up: string | null;
	completed: boolean;
	result: string | null;
	date_created: string;
	sales_name?: string | null;
}

const PROSPECT_FIELDS = [
	'id',
	'name',
	'company',
	'phone',
	'email',
	'stage',
	'priority',
	'notes',
	'expected_close',
	'quoted_amount',
	'po_amount',
	'assigned_name',
	'customer_id',
	'lead_date',
	'date_created',
	'date_updated',
	'lost_reason',
	'tags'
];

const FOLLOWUP_FIELDS = ['id', 'prospect_id', 'type', 'notes', 'next_follow_up', 'completed', 'result', 'date_created', 'sales_name'];

export async function getMyProspects(salesName?: string | null): Promise<ProspectRow[]> {
	try {
		const filter: any = { status: { _neq: 'archived' } };
		if (salesName) filter.assigned_name = { _eq: salesName };
		return (await directus.request(
			readItems('prospects', {
				filter,
				fields: PROSPECT_FIELDS,
				sort: ['-date_created'],
				limit: -1
			})
		)) as ProspectRow[];
	} catch (error) {
		console.error('[sales] getMyProspects error:', error);
		return [];
	}
}

/**
 * Mengambil prospek beserta data follow-up terakhir & jadwal berikutnya.
 * Fetching relasi dipisah (Directus Separated Relation Fetching Rule) agar tidak memicu 403.
 */
export async function getMyProspectsWithFollowUps(salesName?: string | null): Promise<ProspectRow[]> {
	try {
		const filter: any = { status: { _neq: 'archived' } };
		if (salesName) filter.assigned_name = { _eq: salesName };
		const prospects = (await directus.request(
			readItems('prospects', {
				filter,
				fields: PROSPECT_FIELDS,
				sort: ['-date_created'],
				limit: -1
			})
		)) as ProspectRow[];

		if (prospects.length === 0) return [];

		const prospectIds = prospects.map((p) => p.id);

		// 1. Fetch follow-ups separately
		let followUps: FollowUpRow[] = [];
		try {
			followUps = (await directus.request(
				readItems('follow_ups', {
					filter: {
						prospect_id: { _in: prospectIds },
						status: { _neq: 'archived' }
					},
					fields: FOLLOWUP_FIELDS,
					sort: ['-date_created'],
					limit: -1
				})
			)) as FollowUpRow[];
		} catch (fuErr) {
			console.warn('[sales] follow_ups batch fetch warning:', fuErr);
		}

		// 2. Fetch omni_contacts separately to link omnichannel context
		let omniMap = new Map<number, any>();
		try {
			const omniContacts = (await directus.request(
				readItems('omni_contacts', {
					filter: { prospect_id: { _in: prospectIds } },
					fields: ['id', 'prospect_id', 'channel_type', 'phone', 'tags'],
					limit: -1
				})
			)) as any[];
			for (const c of omniContacts) {
				if (c.prospect_id) omniMap.set(c.prospect_id, c);
			}
		} catch (omniErr) {
			console.warn('[sales] omni_contacts batch fetch warning:', omniErr);
		}

		// Group follow-ups by prospect_id (query di atas sudah filter prospect_id _in prospectIds,
		// jadi null tidak mungkin muncul di sini — guard hanya untuk type-safety).
		const fuByProspect = new Map<number, FollowUpRow[]>();
		for (const fu of followUps) {
			if (fu.prospect_id == null) continue;
			const list = fuByProspect.get(fu.prospect_id) || [];
			list.push(fu);
			fuByProspect.set(fu.prospect_id, list);
		}

		return prospects.map((p) => {
			const pFUs = fuByProspect.get(p.id) || [];
			const latest = pFUs.length > 0 ? pFUs[0] : null;
			const pendingUpcoming = pFUs
				.filter((f) => !f.completed && f.next_follow_up)
				.sort((a, b) => (a.next_follow_up! > b.next_follow_up! ? 1 : -1));
			const nextDate = pendingUpcoming.length > 0 ? pendingUpcoming[0].next_follow_up : null;

			const omni = omniMap.get(p.id);
			let inferredChannel = omni?.channel_type || null;
			if (!inferredChannel && (p.notes?.includes('[Inbound WhatsApp]') || p.tags?.includes('whatsapp'))) {
				inferredChannel = 'WhatsApp';
			} else if (!inferredChannel && (p.notes?.includes('[Inbound Instagram]') || p.tags?.includes('instagram'))) {
				inferredChannel = 'Instagram';
			} else if (!inferredChannel && p.notes?.includes('[Inbound')) {
				inferredChannel = 'Webchat';
			}

			return {
				...p,
				display_assigned_name: resolveSalesDisplayName(p.assigned_name),
				source_channel: inferredChannel || (p.customer_id ? 'Customer Terdaftar' : 'Manual'),
				omni_contact_id: omni?.id || null,
				omni_channel: inferredChannel,
				latest_follow_up: latest,
				next_follow_up: nextDate,
				follow_up_count: pFUs.length
			};
		});
	} catch (error) {
		console.error('[sales] getMyProspectsWithFollowUps error:', error);
		return [];
	}
}

/**
 * Ringkasan pipeline milik 1 sales (Widget "My Sales Pipeline", Fase 8, Pertajam
 * KPI Marketing & Manufaktur v2) — hitung dari getMyProspects(), bukan query baru.
 */
export function buildMyPipelineSummary(prospects: ProspectRow[]) {
	const byStage: Record<ProspectStage, number> = { new: 0, qualified: 0, proposal: 0, negotiation: 0, won: 0, lost: 0 };
	for (const p of prospects) {
		if (byStage[p.stage] != null) byStage[p.stage] += 1;
	}
	const openCount = byStage.new + byStage.qualified + byStage.proposal + byStage.negotiation;
	return { byStage, openCount, totalCount: prospects.length };
}

export async function getProspectById(id: number): Promise<ProspectRow | null> {
	try {
		const row = (await directus.request(readItem('prospects', id, { fields: PROSPECT_FIELDS }))) as ProspectRow;
		if (!row) return null;
		return {
			...row,
			display_assigned_name: resolveSalesDisplayName(row.assigned_name)
		};
	} catch (error) {
		console.error('[sales] getProspectById error:', error);
		return null;
	}
}

export async function createProspect(params: {
	name: string;
	company: string;
	phone: string;
	email: string;
	notes: string;
	assignedName: string;
	priority?: 'low' | 'medium' | 'high';
	quotedAmount?: number | null;
	expectedClose?: string | null;
	customerId?: number | null;
}): Promise<ProspectRow> {
	const cleanAssignee = resolveSalesDisplayName(params.assignedName);
	const row = (await directus.request(
		createItem('prospects', {
			status: 'published',
			name: params.name,
			company: params.company,
			phone: params.phone,
			email: params.email,
			notes: params.notes || null,
			assigned_name: cleanAssignee,
			stage: 'new',
			priority: params.priority || 'medium',
			quoted_amount: params.quotedAmount || null,
			expected_close: params.expectedClose || null,
			customer_id: params.customerId || null,
			lead_date: new Date().toISOString().split('T')[0]
		})
	)) as ProspectRow;
	notifySales('PROSPECT_CREATED', `${cleanAssignee} membuat lead baru: ${params.name || params.company}.`, {
		sourceCollection: 'prospects',
		sourceId: row.id
	});
	return {
		...row,
		display_assigned_name: resolveSalesDisplayName(row.assigned_name)
	};
}

export async function updateProspect(id: number, patch: Partial<ProspectRow>): Promise<void> {
	const payload = { ...patch };
	if (payload.assigned_name) {
		payload.assigned_name = resolveSalesDisplayName(payload.assigned_name);
	}
	delete payload.display_assigned_name;
	delete payload.latest_follow_up;
	delete payload.next_follow_up;
	delete payload.follow_up_count;
	delete payload.source_channel;
	delete payload.omni_contact_id;
	delete payload.omni_channel;

	await directus.request(updateItem('prospects', id, payload));
}

export async function updateProspectDetails(id: number, patch: Partial<ProspectRow>): Promise<void> {
	await directus.request(updateItem('prospects', id, patch));
}

/** prospects TIDAK punya FK karyawan (hanya assigned_name teks) — notifikasi ke Supervisor saja, tidak bisa target rep tertentu. */
export async function updateProspectStage(
	id: number,
	stage: ProspectStage,
	context?: { oldStage: ProspectStage; displayName: string; assignedName: string }
): Promise<void> {
	await directus.request(updateItem('prospects', id, { stage }));
	if (!context || context.oldStage === stage) return;
	const stageLabel = PROSPECT_STAGES.find((s) => s.value === stage)?.label || stage;
	if (stage === 'won') {
		notifySales('PROSPECT_WON', `🎉 Prospect "${context.displayName}" (${context.assignedName}) WON!`, { sourceCollection: 'prospects', sourceId: id });
	} else if (stage === 'lost') {
		notifySales('PROSPECT_LOST', `Prospect "${context.displayName}" (${context.assignedName}) ditandai LOST.`, { sourceCollection: 'prospects', sourceId: id });
	} else {
		notifySales('PROSPECT_STAGE_CHANGED', `Prospect "${context.displayName}" (${context.assignedName}) pindah tahap ke ${stageLabel}.`, { sourceCollection: 'prospects', sourceId: id });
	}
}

// ── PIPELINE PROGRESS BADGES (CRM Sharpening Fase 4) ─────────────────
// Ringkasan lifecycle quotation → SO per prospect, untuk badge di kartu pipeline
// lapangan. Read-only, tanpa nominal sensitif.

export interface PipelineBadge {
	qCount: number;
	qAccepted: number;
	qLatestStatus: string | null;
	soId: number | null;
	soNomor: string | null;
	soStatus: string | null;
}

export async function getPipelineBadges(prospectIds: number[]): Promise<Map<number, PipelineBadge>> {
	const out = new Map<number, PipelineBadge>();
	const ids = [...new Set(prospectIds.filter((n) => Number.isFinite(n)))];
	if (!ids.length) return out;
	for (const id of ids) out.set(id, { qCount: 0, qAccepted: 0, qLatestStatus: null, soId: null, soNomor: null, soStatus: null });

	try {
		const quotes = (await directus.request(
			readItems('quotations', {
				filter: { prospect_id: { _in: ids }, status: { _neq: 'archived' } },
				fields: ['id', 'prospect_id', 'quote_status', 'so_id', 'date_created'],
				sort: ['-date_created'],
				limit: -1
			})
		)) as any[];

		const soIds = new Set<number>();
		for (const q of quotes) {
			const pid = typeof q.prospect_id === 'object' ? q.prospect_id?.id : q.prospect_id;
			const b = out.get(Number(pid));
			if (!b) continue;
			b.qCount += 1;
			if (q.quote_status === 'accepted') b.qAccepted += 1;
			if (!b.qLatestStatus) b.qLatestStatus = q.quote_status || null;
			if (q.so_id && !b.soId) b.soId = Number(q.so_id);
			if (q.so_id) soIds.add(Number(q.so_id));
		}

		if (soIds.size) {
			const sos = (await directus.request(
				readItems('so_customer', {
					filter: { id: { _in: [...soIds] } },
					fields: ['id', 'nomor_so', 'status'],
					limit: -1
				})
			)) as any[];
			const soMap = new Map(sos.map((s) => [Number(s.id), s]));
			for (const b of out.values()) {
				if (b.soId && soMap.has(b.soId)) {
					b.soNomor = soMap.get(b.soId).nomor_so || null;
					b.soStatus = soMap.get(b.soId).status || null;
				}
			}
		}
	} catch (error) {
		console.warn('[sales] getPipelineBadges error (diabaikan):', error);
	}
	return out;
}

export async function getFollowUpsForProspect(prospectId: number): Promise<FollowUpRow[]> {
	try {
		return (await directus.request(
			readItems('follow_ups', {
				filter: { prospect_id: { _eq: prospectId }, status: { _neq: 'archived' } },
				fields: FOLLOWUP_FIELDS,
				sort: ['-date_created'],
				limit: -1
			})
		)) as FollowUpRow[];
	} catch (error) {
		console.error('[sales] getFollowUpsForProspect error:', error);
		return [];
	}
}

export async function createFollowUp(params: {
	prospectId: number;
	type: FollowUpType;
	notes: string;
	nextFollowUp: string | null;
	result: string;
}): Promise<FollowUpRow> {
	return (await directus.request(
		createItem('follow_ups', {
			status: 'published',
			prospect_id: params.prospectId,
			type: params.type,
			notes: params.notes || null,
			next_follow_up: params.nextFollowUp,
			completed: false,
			result: params.result || null
		})
	)) as FollowUpRow;
}

export interface UpcomingFollowUp extends FollowUpRow {
	prospectName: string;
	prospectCompany: string;
}

/** Paket 08d §6.2 — follow_ups.notes diawali "Customer: {nama} — " untuk kunjungan ke
 *  master_customer tanpa prospek tertaut (prospect_id null). Ekstrak nama customer itu
 *  supaya widget pengingat tetap menampilkan nama, bukan kosong. */
function fallbackDisplayFromNotes(notes: string | null): { name: string; company: string } {
	if (!notes) return { name: '', company: '' };
	const m = notes.match(/^Customer:\s*(.+?)\s*—/);
	return { name: m ? m[1] : notes, company: '' };
}

/**
 * Follow-up yang jatuh tempo hari ini atau sudah lewat, untuk widget reminder di /sales.
 *
 * Paket 08d §6.2 — sebelumnya HANYA mencari lewat prospect_id milik sales (follow_ups dari
 * kunjungan ke master_customer tanpa prospek tertaut tidak pernah ketemu, dan sales tanpa
 * satu pun prospek selalu dapat array kosong walau punya follow-up aktif). Sekarang filter
 * utama memakai follow_ups.sales_name (diisi bridge sejak 08d), prospect_id tetap dipakai
 * sebagai fallback untuk baris lama sebelum kolom ini ada.
 */
export async function getUpcomingFollowUps(salesName?: string | null): Promise<UpcomingFollowUp[]> {
	try {
		const today = new Date().toISOString().split('T')[0];
		const myProspects = await getMyProspects(salesName);
		const prospectMap = new Map(myProspects.map((p) => [p.id, p]));
		const prospectIds = myProspects.map((p) => p.id);

		const baseFilter = {
			completed: { _eq: false },
			next_follow_up: { _nnull: true, _lte: `${today}T23:59:59` }
		};
		let filter: Record<string, any>;
		if (salesName) {
			const or: Record<string, any>[] = [{ sales_name: { _eq: salesName } }];
			if (prospectIds.length > 0) or.push({ prospect_id: { _in: prospectIds } });
			filter = { ...baseFilter, _or: or };
		} else if (prospectIds.length > 0) {
			filter = { ...baseFilter, prospect_id: { _in: prospectIds } };
		} else {
			return [];
		}

		const result = (await directus.request(
			readItems('follow_ups', {
				filter,
				fields: FOLLOWUP_FIELDS,
				sort: ['next_follow_up'],
				limit: -1
			})
		)) as FollowUpRow[];

		return result.map((f) => {
			if (f.prospect_id) {
				return {
					...f,
					prospectName: prospectMap.get(f.prospect_id)?.name || '',
					prospectCompany: prospectMap.get(f.prospect_id)?.company || ''
				};
			}
			const fallback = fallbackDisplayFromNotes(f.notes);
			return { ...f, prospectName: fallback.name, prospectCompany: fallback.company };
		});
	} catch (error) {
		console.error('[sales] getUpcomingFollowUps error:', error);
		return [];
	}
}

// ── Master Customer + Histori (item #6 rencana) — gabungan kunjungan (visit_sales)
// dan lead/aktivitas (prospects/follow_ups) yang tertaut ke customer yang sama,
// dibatasi ke milik sales yang login (bukan lintas sales, demi privasi data lead).

export interface CustomerHistoryVisit {
	id: number;
	tanggal_kunjungan: string;
	tujuan: string;
	hasil_kunjungan: string | null;
	verifikasi_status: VerifikasiStatus;
}

export interface CustomerHistory {
	customer: CustomerOption | null;
	visits: CustomerHistoryVisit[];
	prospects: ProspectRow[];
	followUps: FollowUpRow[];
	surveys: SurveyRow[];
}

export async function getCustomerHistory(masterCustomerId: number, salesName?: string | null): Promise<CustomerHistory> {
	try {
		const visitFilter: any = { master_customer_id: { _eq: masterCustomerId } };
		if (salesName) visitFilter.sales_name = { _eq: salesName };

		const prospectFilter: any = { customer_id: { _eq: masterCustomerId } };
		if (salesName) prospectFilter.assigned_name = { _eq: salesName };

		const surveyFilter: any = { customer_id: { _eq: masterCustomerId } };
		if (salesName) surveyFilter.surveyor = { _eq: salesName };

		const [customerRow, visitRows, prospectRows, surveyRows] = await Promise.all([
			directus.request(
				readItem('master_customer', masterCustomerId, {
					fields: ['id', 'nama_sj_fp', 'kode_customer', 'alamat_surat_jalan', 'alamat_penagihan', 'telp', 'contact_person']
				})
			) as Promise<any>,
			directus.request(
				readItems('visit_sales', {
					filter: visitFilter,
					fields: ['id', 'tanggal_kunjungan', 'tujuan', 'hasil_kunjungan', 'verifikasi_status'],
					sort: ['-tanggal_kunjungan'],
					limit: -1
				})
			) as Promise<any[]>,
			directus.request(
				readItems('prospects', {
					filter: prospectFilter,
					fields: PROSPECT_FIELDS,
					limit: -1
				})
			) as Promise<any[]>,
			directus.request(
				readItems('sales_survey', {
					filter: surveyFilter,
					fields: ['id', 'nomor_survey', 'tanggal_survey', 'lokasi_project', 'customer_name', 'status'],
					sort: ['-tanggal_survey'],
					limit: -1
				})
			).catch(() => []) as Promise<any[]>
		]);

		const prospectIds = (prospectRows || []).map((p) => p.id);
		const followUps = prospectIds.length
			? ((await directus.request(
					readItems('follow_ups', {
						filter: { prospect_id: { _in: prospectIds } },
						fields: FOLLOWUP_FIELDS,
						sort: ['-date_created'],
						limit: -1
					})
				)) as FollowUpRow[])
			: [];

		return {
			customer: customerRow
				? {
						id: customerRow.id,
						customer_name: customerRow.nama_sj_fp,
						kode_customer: customerRow.kode_customer,
						alamat: customerRow.alamat_surat_jalan || customerRow.alamat_penagihan || null,
						alamat_surat_jalan: customerRow.alamat_surat_jalan || null,
						alamat_penagihan: customerRow.alamat_penagihan || null,
						telepon: customerRow.telp || null,
						telp: customerRow.telp || null,
						pic_nama: customerRow.contact_person || null,
						contact_person: customerRow.contact_person || null,
						pic_telepon: customerRow.telp || null
				  }
				: null,
			visits: visitRows || [],
			prospects: (prospectRows as ProspectRow[]) || [],
			followUps,
			surveys: (surveyRows as SurveyRow[]) || []
		};
	} catch (error) {
		console.error('[sales] getCustomerHistory error:', error);
		return { customer: null, visits: [], prospects: [], followUps: [], surveys: [] };
	}
}

// ── Target vs Realisasi (Fase 4, item #7) — reuse koleksi `sales_target` yang
// sudah ada; realisasi dihitung dari `so_customer.grand_total` bulan berjalan.

export interface TargetRealisasi {
	targetAmount: number;
	realisasiAmount: number;
	percentage: number;
}

export async function getTargetVsRealisasi(salesName?: string | null): Promise<TargetRealisasi | null> {
	try {
		const now = new Date();
		const tahun = now.getFullYear();
		const bulan = now.getMonth() + 1;

		const filterTargets: any = { tahun: { _eq: tahun }, bulan: { _eq: bulan } };
		if (salesName) filterTargets.sales_name = { _eq: salesName };

		const targets = (await directus.request(
			readItems('sales_target', {
				filter: filterTargets,
				fields: ['id', 'target_amount'],
				limit: salesName ? 1 : -1
			})
		)) as any[];
		if (targets.length === 0) return null;

		const monthStart = `${tahun}-${String(bulan).padStart(2, '0')}-01`;
		const nextMonth = new Date(tahun, bulan, 1).toISOString().split('T')[0];

		const filterOrders: any = {
					tanggal_so: { _gte: monthStart, _lt: nextMonth },
					status: { _neq: 'cancelled' }
				};
		if (salesName) filterOrders.sales_name = { _eq: salesName };

		const orders = (await directus.request(
			readItems('so_customer', {
				filter: filterOrders,
				fields: ['grand_total'],
				limit: -1
			})
		)) as any[];

		const targetAmount = targets.reduce((sum, t) => sum + (Number(t.target_amount) || 0), 0);
		const realisasiAmount = orders.reduce((sum, o) => sum + (Number(o.grand_total) || 0), 0);

		return {
			targetAmount,
			realisasiAmount,
			percentage: targetAmount > 0 ? Math.round((realisasiAmount / targetAmount) * 100) : 0
		};
	} catch (error) {
		console.error('[sales] getTargetVsRealisasi error:', error);
		return null;
	}
}

// ── Survey Lokasi/Kebutuhan (Fase 4, item #9) — reuse koleksi `sales_survey` +
// `sales_survey_images` yang sudah dipakai erp-epi-1 (src/lib/services/salesSurveyApi.js).
// Mode dikunci ke 'dengan_survey' karena form ini khusus alur sales datang ke lokasi;
// keputusan 'tanpa_survey' tetap dilakukan dari kantor (di luar cakupan mobile).

export const KETERSEDIAAN_OPTIONS = ['ADA', 'TIDAK ADA'];
export const JAM_KERJA_OPTIONS = ['SENIN-MINGGU', 'SENIN-JUMAT', 'SENIN-SABTU'];
export const SHIFT_KERJA_OPTIONS = ['SIANG', 'MALAM', 'SIANG & MALAM'];
export const KONDISI_PERMUKAAN_OPTIONS = ['Baru', 'Berkarat Ringan', 'Berkarat Berat', 'Existing Coating', 'Lainnya'];

export interface SurveyRow {
	id: number;
	nomor_survey: string;
	tanggal_survey: string;
	lokasi_project: string;
	customer_name: string | null;
	status: string;
	luas_area?: number | null;
	pic_lapangan?: string | null;
	pic_lapangan_telp?: string | null;
	kondisi_permukaan?: string | null;
	catatan_khusus?: string | null;
	surveyor?: string | null;
}

// Fase 4 (Quick Estimasi Survey & Omnichannel) — ambang notifikasi "perlu validasi RAB
// cepat", bukan parameter harga (beda dengan quick_estimator_rates/multipliers di
// kalkulator_config yang wajib UI-editable). Konstanta operasional sederhana; promosikan
// ke kalkulator_config kalau tim ops perlu mengubahnya tanpa deploy.
const SURVEY_HIGH_VALUE_ESTIMATE_THRESHOLD = 50_000_000;

async function generateNomorSurvey(): Promise<string> {
	const year = new Date().getFullYear();
	try {
		const result = (await directus.request(
			readItems('sales_survey', {
				filter: { nomor_survey: { _starts_with: `SRV-${year}-` } },
				fields: ['nomor_survey'],
				sort: ['-nomor_survey'],
				limit: 1
			})
		)) as any[];
		const last = result[0]?.nomor_survey;
		const lastSeq = last ? parseInt(last.split('-')[2], 10) || 0 : 0;
		return `SRV-${year}-${String(lastSeq + 1).padStart(4, '0')}`;
	} catch {
		return `SRV-${year}-${String(Date.now()).slice(-4)}`;
	}
}

export async function getMySurveys(surveyorName?: string | null): Promise<SurveyRow[]> {
	try {
		const filter: any = {};
		if (surveyorName) filter.surveyor = { _eq: surveyorName };
		return (await directus.request(
			readItems('sales_survey', {
				filter,
				fields: [
					'id',
					'nomor_survey',
					'tanggal_survey',
					'lokasi_project',
					'customer_name',
					'status',
					'luas_area',
					'pic_lapangan',
					'pic_lapangan_telp',
					'kondisi_permukaan',
					'catatan_khusus',
					'surveyor'
				],
				sort: ['-date_created'],
				limit: 100
			})
		)) as SurveyRow[];
	} catch (error) {
		console.error('[sales] getMySurveys error:', error);
		return [];
	}
}

export async function submitSurvey(params: {
	surveyorName: string;
	customerName: string;
	masterCustomerId: number | null;
	prospectId?: number | null;
	lokasiProject: string;
	picLapangan: string;
	picLapanganTelp: string;
	tanggalMulaiTarget?: string | null;
	tanggalSelesaiTarget?: string | null;
	luasArea: number | null;
	kondisiPermukaan: string;
	aksesLokasi: string;
	ketersediaanListrik: string;
	ketersediaanAir: string;
	ketersediaanToilet: string;
	jamKerjaDiizinkan: string;
	shiftKerja: string;
	akomodasi: string;
	kebutuhanSafety: string;
	catatanKhusus: string;
	photoFiles: File[];
	estimasiKasarJenisJasa?: string | null;
	estimasiKasarMin?: number | null;
	estimasiKasarMax?: number | null;
	estimasiKasarPerM2Min?: number | null;
	estimasiKasarPerM2Max?: number | null;
	estimasiKasarSnapshot?: Record<string, any> | null;
}): Promise<SurveyRow> {
	const nomorSurvey = await generateNomorSurvey();
	const survey: any = await directus.request(
		createItem('sales_survey', {
			nomor_survey: nomorSurvey,
			survey_mode: 'dengan_survey',
			status: 'completed',
			customer_id: params.masterCustomerId,
			prospect_id: params.prospectId || null,
			customer_name: params.customerName || null,
			tanggal_survey: new Date().toISOString().split('T')[0],
			surveyor: params.surveyorName,
			lokasi_project: params.lokasiProject,
			pic_lapangan: params.picLapangan || null,
			pic_lapangan_telp: params.picLapanganTelp || null,
			tanggal_mulai_target: params.tanggalMulaiTarget || null,
			tanggal_selesai_target: params.tanggalSelesaiTarget || null,
			luas_area: params.luasArea,
			kondisi_permukaan: params.kondisiPermukaan || null,
			akses_lokasi: params.aksesLokasi || null,
			ketersediaan_listrik: params.ketersediaanListrik || null,
			ketersediaan_air: params.ketersediaanAir || null,
			ketersediaan_toilet: params.ketersediaanToilet || null,
			jam_kerja_diizinkan: params.jamKerjaDiizinkan || null,
			shift_kerja: params.shiftKerja || null,
			akomodasi: params.akomodasi || null,
			kebutuhan_safety: params.kebutuhanSafety || null,
			catatan_khusus: params.catatanKhusus || null,
			...(params.estimasiKasarJenisJasa
				? {
						estimasi_kasar_jenis_jasa: params.estimasiKasarJenisJasa,
						estimasi_kasar_min: params.estimasiKasarMin ?? null,
						estimasi_kasar_max: params.estimasiKasarMax ?? null,
						estimasi_kasar_per_m2_min: params.estimasiKasarPerM2Min ?? null,
						estimasi_kasar_per_m2_max: params.estimasiKasarPerM2Max ?? null,
						estimasi_kasar_snapshot: params.estimasiKasarSnapshot ?? null,
						estimasi_kasar_dihitung_at: new Date().toISOString()
					}
				: {})
		})
	);

	for (const file of params.photoFiles) {
		try {
			const formData = new FormData();
			formData.append('file', file);
			formData.append('title', `Sales Survey - ${survey.id} - ${file.name}`);
			const uploaded: any = await directus.request(uploadFiles(formData));
			if (uploaded?.id) {
				await directus.request(createItem('sales_survey_images', { sales_survey_id: survey.id, file_id: uploaded.id }));
			}
		} catch (err) {
			console.error('Gagal upload foto survey:', err);
		}
	}

	notifySales('SURVEY_COMPLETED', `${params.surveyorName} menyelesaikan survey lokasi ${params.lokasiProject} (${params.customerName || 'customer'}).`, {
		sourceCollection: 'sales_survey',
		sourceId: survey.id
	});

	// Fase 4 (Quick Estimasi Survey & Omnichannel) — survey dengan estimasi kasar di atas
	// ambang butuh validasi RAB resmi cepat oleh tim estimator (1x24 jam).
	if (params.estimasiKasarMax != null && params.estimasiKasarMax > SURVEY_HIGH_VALUE_ESTIMATE_THRESHOLD) {
		notifySales(
			'SURVEY_HIGH_VALUE_ESTIMATE',
			`Survey ${nomorSurvey} (${params.customerName || 'customer'}, ${params.lokasiProject}) estimasi kasar s/d ${new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(params.estimasiKasarMax)} — mohon validasi RAB resmi dalam 1x24 jam.`,
			{ sourceCollection: 'sales_survey', sourceId: survey.id }
		);
	}

	return survey as SurveyRow;
}

export interface SurveyDetail extends SurveyRow {
	customer_id: number | null;
	pic_lapangan: string | null;
	pic_lapangan_telp: string | null;
	tanggal_mulai_target: string | null;
	tanggal_selesai_target: string | null;
	luas_area: number | null;
	kondisi_permukaan: string | null;
	akses_lokasi: string | null;
	ketersediaan_listrik: string | null;
	ketersediaan_air: string | null;
	ketersediaan_toilet: string | null;
	jam_kerja_diizinkan: string | null;
	shift_kerja: string | null;
	akomodasi: string | null;
	kebutuhan_safety: string | null;
	catatan_khusus: string | null;
	surveyor: string | null;
	images: { id: number; file_id: string }[];
	estimasi_kasar_jenis_jasa: string | null;
	estimasi_kasar_min: number | null;
	estimasi_kasar_max: number | null;
	estimasi_kasar_per_m2_min: number | null;
	estimasi_kasar_per_m2_max: number | null;
	estimasi_kasar_snapshot: Record<string, any> | null;
}

/** Fase 4 (Quick Estimasi Survey & Omnichannel) — baca floor saja, bukan seluruh detail survey. */
export async function getSurveyEstimasiKasarMin(id: number): Promise<number | null> {
	try {
		const row = (await directus.request(readItem('sales_survey', id, { fields: ['estimasi_kasar_min'] }))) as any;
		return row?.estimasi_kasar_min != null ? Number(row.estimasi_kasar_min) : null;
	} catch {
		return null;
	}
}

export async function getSurveyById(id: number): Promise<SurveyDetail | null> {
	try {
		const row = (await directus.request(
			readItem('sales_survey', id, {
				fields: [
					'id',
					'nomor_survey',
					'tanggal_survey',
					'lokasi_project',
					'customer_name',
					'customer_id',
					'status',
					'surveyor',
					'pic_lapangan',
					'pic_lapangan_telp',
					'tanggal_mulai_target',
					'tanggal_selesai_target',
					'luas_area',
					'kondisi_permukaan',
					'akses_lokasi',
					'ketersediaan_listrik',
					'ketersediaan_air',
					'ketersediaan_toilet',
					'jam_kerja_diizinkan',
					'shift_kerja',
					'akomodasi',
					'kebutuhan_safety',
					'catatan_khusus',
					'estimasi_kasar_jenis_jasa',
					'estimasi_kasar_min',
					'estimasi_kasar_max',
					'estimasi_kasar_per_m2_min',
					'estimasi_kasar_per_m2_max',
					'estimasi_kasar_snapshot'
				]
			})
		)) as any;

		if (!row) return null;

		// Fetch relasi sales_survey_images secara terpisah sesuai aturan Directus
		let images: { id: number; file_id: string }[] = [];
		try {
			const imageRows = (await directus.request(
				readItems('sales_survey_images', {
					filter: { sales_survey_id: { _eq: id } },
					fields: ['id', 'file_id']
				})
			)) as any[];
			images = (imageRows || []).map((img) => ({
				id: img.id,
				file_id: typeof img.file_id === 'object' ? img.file_id?.id : img.file_id
			}));
		} catch (imgErr) {
			console.warn('[sales] gagal mengambil gambar survey:', imgErr);
		}

		return {
			id: row.id,
			nomor_survey: row.nomor_survey,
			tanggal_survey: row.tanggal_survey,
			lokasi_project: row.lokasi_project,
			customer_name: row.customer_name || null,
			customer_id: row.customer_id || null,
			status: row.status,
			surveyor: row.surveyor || null,
			pic_lapangan: row.pic_lapangan || null,
			pic_lapangan_telp: row.pic_lapangan_telp || null,
			tanggal_mulai_target: row.tanggal_mulai_target || null,
			tanggal_selesai_target: row.tanggal_selesai_target || null,
			luas_area: row.luas_area != null ? Number(row.luas_area) : null,
			kondisi_permukaan: row.kondisi_permukaan || null,
			akses_lokasi: row.akses_lokasi || null,
			ketersediaan_listrik: row.ketersediaan_listrik || null,
			ketersediaan_air: row.ketersediaan_air || null,
			ketersediaan_toilet: row.ketersediaan_toilet || null,
			jam_kerja_diizinkan: row.jam_kerja_diizinkan || null,
			shift_kerja: row.shift_kerja || null,
			akomodasi: row.akomodasi || null,
			kebutuhan_safety: row.kebutuhan_safety || null,
			catatan_khusus: row.catatan_khusus || null,
			estimasi_kasar_jenis_jasa: row.estimasi_kasar_jenis_jasa || null,
			estimasi_kasar_min: row.estimasi_kasar_min != null ? Number(row.estimasi_kasar_min) : null,
			estimasi_kasar_max: row.estimasi_kasar_max != null ? Number(row.estimasi_kasar_max) : null,
			estimasi_kasar_per_m2_min: row.estimasi_kasar_per_m2_min != null ? Number(row.estimasi_kasar_per_m2_min) : null,
			estimasi_kasar_per_m2_max: row.estimasi_kasar_per_m2_max != null ? Number(row.estimasi_kasar_per_m2_max) : null,
			estimasi_kasar_snapshot: row.estimasi_kasar_snapshot || null,
			images
		};
	} catch (error) {
		console.error('[sales] getSurveyById error:', error);
		return null;
	}
}

// ── FASE 2: OPS SALES BON & EXPENSES ─────────────────────────────────────────

export interface VisitExpenseItem {
	id: number;
	jenis: 'bbm' | 'tol' | 'parkir' | 'lain';
	nominal: number;
	catatan: string | null;
	foto_struk: string | null;
	waktu: string;
	mode?: string;
	site_checkin_id?: string | null;
	visit_sales_id?: number | null;
	lokasi_nama?: string | null;
}

export async function getVisitExpenses(
	visitId: number
): Promise<{ expenses: VisitExpenseItem[]; totalNominal: number; siteCheckinId: string | null }> {
	const idToken = await auth.currentUser?.getIdToken();
	if (!idToken) throw new Error('Sesi login tidak ditemukan.');

	const res = await fetch(`/api/sales/visit/${visitId}/expenses`, {
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) {
		const body = await res.json().catch(() => null);
		throw new Error(body?.message || 'Gagal memuat catatan biaya kunjungan.');
	}
	const data = await res.json();
	return {
		expenses: data.expenses || [],
		totalNominal: Number(data.totalNominal) || 0,
		siteCheckinId: data.siteCheckinId || null
	};
}

export async function addVisitExpense(visitId: number, formData: FormData): Promise<VisitExpenseItem> {
	const idToken = await auth.currentUser?.getIdToken();
	if (!idToken) throw new Error('Sesi login tidak ditemukan.');

	const res = await fetch(`/api/sales/visit/${visitId}/expenses`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` },
		body: formData
	});
	if (!res.ok) {
		const body = await res.json().catch(() => null);
		throw new Error(body?.message || 'Gagal menyimpan catatan biaya kunjungan.');
	}
	const data = await res.json();
	return data.expense;
}

export async function deleteVisitExpense(visitId: number, expenseId: number): Promise<boolean> {
	const idToken = await auth.currentUser?.getIdToken();
	if (!idToken) throw new Error('Sesi login tidak ditemukan.');

	const res = await fetch(`/api/sales/visit/${visitId}/expenses?expense_id=${expenseId}`, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) {
		const body = await res.json().catch(() => null);
		throw new Error(body?.message || 'Gagal menghapus catatan biaya.');
	}
	return true;
}

export async function getTodaySalesExpenses(
	date?: string
): Promise<{ expenses: VisitExpenseItem[]; totalNominal: number; totalCount: number }> {
	const idToken = await auth.currentUser?.getIdToken();
	if (!idToken) throw new Error('Sesi login tidak ditemukan.');

	const q = date ? `?date=${encodeURIComponent(date)}` : '';
	const res = await fetch(`/api/sales/expenses/today${q}`, {
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) {
		const body = await res.json().catch(() => null);
		throw new Error(body?.message || 'Gagal memuat rekap biaya hari ini.');
	}
	const data = await res.json();
	return {
		expenses: data.expenses || [],
		totalNominal: Number(data.totalNominal) || 0,
		totalCount: Number(data.totalCount) || 0
	};
}

export async function addDailySalesExpense(formData: FormData): Promise<VisitExpenseItem> {
	const idToken = await auth.currentUser?.getIdToken();
	if (!idToken) throw new Error('Sesi login tidak ditemukan.');

	const res = await fetch(`/api/sales/expenses/today`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}` },
		body: formData
	});
	if (!res.ok) {
		const body = await res.json().catch(() => null);
		throw new Error(body?.message || 'Gagal menyimpan biaya operasional.');
	}
	const data = await res.json();
	return data.expense;
}


