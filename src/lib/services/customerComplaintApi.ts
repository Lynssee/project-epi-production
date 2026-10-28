// src/lib/services/customerComplaintApi.ts
// Lapor Komplain Customer (Fase 7, Pertajam KPI Marketing & Manufaktur v2).
// Menulis ke customer_complaints — collection KANONIK (ditetapkan Fase 2 R&D,
// 4 Agu 2026, lihat erp-epi-1 rndKomplainApi.js), BUKAN customer_komplain (legacy
// Sales, tidak dipakai lagi untuk Complaint Tracker). Alur 8D lanjutan (investigasi,
// eskalasi R&D, dst) tetap dikerjakan di app admin (erp-epi-1 /rnd/komplain) — form
// ini hanya D0 "Diterima", titik tangkap awal dari lapangan.
//
// Offline-first: pemanggil (halaman komplain-customer) menaruh submission ke
// offlineComplaintQueue.ts saat gagal kirim, pola sama dgn offlinePunchQueue.ts.

import directus, { handleDirectusError } from './directus';
import { readItems, createItem, updateItem, uploadFiles } from '@directus/sdk';
import { auth } from '$lib/firebase';
import { bridgeComplaintToSupport } from './support';

const COLLECTION = 'customer_complaints';

// Fase 2c (Maksimalisasi Notifikasi Sales): best-effort, tidak pernah melempar error. Dipakai
// walau collection ini milik R&D (customer_complaints, alur 8D) karena D0 "Diterima" ditangkap
// dari lapangan Sales — Supervisor Sales tetap perlu tahu ada komplain baru masuk.
async function notifySales(eventCode: string, message: string, opts: { sourceCollection?: string; sourceId?: number | string } = {}): Promise<void> {
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
		console.warn('[customerComplaintApi] gagal kirim notifikasi (diabaikan):', e);
	}
}

export async function uploadComplaintPhoto(file: File | Blob, name: string): Promise<string | null> {
	try {
		const formData = new FormData();
		formData.append('file', file, name);
		const result: any = await directus.request(uploadFiles(formData));
		return result?.id || null;
	} catch (err) {
		handleDirectusError(err);
		return null;
	}
}

export interface CustomerMatch {
	id: number;
	nama_sj_fp: string;
	kode_customer?: string;
}

export async function searchCustomer(query: string): Promise<CustomerMatch[]> {
	if (!query || query.length < 2) return [];
	try {
		return (await directus.request(
			readItems('master_customer' as any, {
				filter: {
					_or: [
						{ nama_sj_fp: { _icontains: query } },
						{ kode_customer: { _icontains: query } }
					]
				} as any,
				fields: ['id', 'nama_sj_fp', 'kode_customer'],
				limit: 8
			})
		)) as any[];
	} catch {
		return [];
	}
}

export interface CustomerComplaintItem {
	id: number;
	client_txn_id?: string | null;
	customer_id?: number | null;
	customer?: CustomerMatch | null;
	tanggal: string;
	kategori: string;
	deskripsi: string;
	status: 'diterima' | 'investigasi' | 'tindakan_sementara' | 'akar_masalah' | 'solusi' | 'verifikasi' | 'tutup' | string;
	status_changed_at?: string | null;
	sla_due_at?: string | null;
	site?: string;
	foto?: string | null;
	pic?: string | null;
	sebab?: string | null;
	batch_number?: string | null;
	resolved_date?: string | null;
	retest_session_id?: number | null;
	escalated_project_id?: number | null;
	prioritas?: 'normal' | 'urgent' | 'critical' | string | null;
	kontak_pelapor?: string | null;
	catatan_internal?: string | null;
	produk_layanan?: string | null;
	volume_terdampak?: string | null;
	tuntutan_customer?: string | null;
	resolusi?: string | null;
	resolved_by?: number | null;
	resolved_by_name?: string | null;
	rating_after?: number | null;
	support_tiket_id?: number | null;
	date_created?: string | null;
}

/** Urutan fase 8D — kanonik, dipakai untuk tombol maju/mundur fase di detail. */
export const COMPLAINT_STAGE_ORDER = [
	'diterima',
	'investigasi',
	'tindakan_sementara',
	'akar_masalah',
	'solusi',
	'verifikasi',
	'tutup'
] as const;
export type ComplaintStage = (typeof COMPLAINT_STAGE_ORDER)[number];

export interface FetchComplaintsFilter {
	status?: string | null;
	site?: string | null;
	kategori?: string | null;
	prioritas?: string | null;
	search?: string | null;
	tanggalDari?: string | null;
	tanggalSampai?: string | null;
	limit?: number;
}

/**
 * Mengambil daftar komplain customer dengan relasi master_customer terpisah
 * (Sesuai aturan: Directus fetching must be separated for each relation).
 */
export async function fetchCustomerComplaints(filters: FetchComplaintsFilter = {}): Promise<CustomerComplaintItem[]> {
	try {
		const filterObj: Record<string, any> = {};
		if (filters.status && filters.status !== 'all') {
			if (filters.status === 'active') {
				filterObj.status = { _neq: 'tutup' };
			} else {
				filterObj.status = { _eq: filters.status };
			}
		}
		if (filters.site && filters.site !== 'all') {
			filterObj.site = { _eq: filters.site };
		}
		if (filters.kategori && filters.kategori !== 'all') {
			filterObj.kategori = { _eq: filters.kategori };
		}
		if (filters.prioritas && filters.prioritas !== 'all') {
			filterObj.prioritas = { _eq: filters.prioritas };
		}
		if (filters.search && filters.search.trim().length > 0) {
			const q = filters.search.trim();
			filterObj._or = [
				{ deskripsi: { _icontains: q } },
				{ batch_number: { _icontains: q } },
				{ pic: { _icontains: q } }
			];
		}
		if (filters.tanggalDari) {
			filterObj.tanggal = { ...(filterObj.tanggal || {}), _gte: filters.tanggalDari };
		}
		if (filters.tanggalSampai) {
			filterObj.tanggal = { ...(filterObj.tanggal || {}), _lte: filters.tanggalSampai };
		}

		const rows: any[] = await directus.request(
			readItems(COLLECTION as any, {
				filter: Object.keys(filterObj).length > 0 ? filterObj : undefined,
				sort: ['-tanggal', '-id'] as any,
				limit: filters.limit ?? 100
			})
		);

		if (!rows || rows.length === 0) return [];

		// Ambil data relasi master_customer secara terpisah
		const customerIds = [...new Set(rows.map((r) => r.customer_id).filter((id): id is number => typeof id === 'number' && id > 0))];

		const customerMap = new Map<number, CustomerMatch>();
		if (customerIds.length > 0) {
			try {
				const customers: any[] = await directus.request(
					readItems('master_customer' as any, {
						filter: { id: { _in: customerIds } } as any,
						fields: ['id', 'nama_sj_fp', 'kode_customer'],
						limit: customerIds.length
					})
				);
				customers.forEach((c) => {
					if (c && c.id) {
						customerMap.set(c.id, {
							id: c.id,
							nama_sj_fp: c.nama_sj_fp || '-',
							kode_customer: c.kode_customer || ''
						});
					}
				});
			} catch (custErr) {
				console.warn('[customerComplaintApi] Gagal memuat relasi master_customer:', custErr);
			}
		}

		// Resolusi relasi resolved_by -> karyawan (terpisah, sesuai aturan)
		const resolverIds = [...new Set(rows.map((r) => r.resolved_by).filter((id): id is number => typeof id === 'number' && id > 0))];
		const resolverMap = new Map<number, string>();
		if (resolverIds.length > 0) {
			try {
				const kry: any[] = await directus.request(
					readItems('karyawan' as any, {
						filter: { id: { _in: resolverIds } } as any,
						fields: ['id', 'nama_karyawan'],
						limit: resolverIds.length
					})
				);
				kry.forEach((k) => {
					if (k && k.id) resolverMap.set(k.id, k.nama_karyawan || `#${k.id}`);
				});
			} catch (kErr) {
				console.warn('[customerComplaintApi] Gagal memuat relasi resolved_by:', kErr);
			}
		}

		return rows.map((r) => ({
			...r,
			customer: r.customer_id ? customerMap.get(r.customer_id) || null : null,
			resolved_by_name: r.resolved_by ? resolverMap.get(r.resolved_by) || null : null
		}));
	} catch (err) {
		handleDirectusError(err);
		return [];
	}
}

export interface UpdateComplaintStageParams {
	/** Fase 8D tujuan. */
	status: ComplaintStage;
	/** Diisi saat masuk fase solusi/verifikasi/tutup. */
	resolusi?: string | null;
	/** karyawan.id yang menuntaskan — diisi otomatis dari sesi. */
	resolvedBy?: number | null;
	/** Rating customer 1-5 setelah resolusi. */
	ratingAfter?: number | null;
}

/**
 * Ubah fase penanganan 8D sebuah komplain (maju/mundur) dari dashboard lapangan.
 * Permission-gated di UI (`manage_komplain_8d`). Menulis `status` + `status_changed_at`.
 * Saat fase `tutup`, ikut mengisi `resolved_date` + `resolusi`/`resolved_by`/`rating_after` bila ada.
 * Catatan: `sla_due_at` sengaja tidak dihitung di sini — tetap wewenang Flow/app admin.
 */
export async function updateComplaintStage(id: number, params: UpdateComplaintStageParams) {
	const now = new Date().toISOString();
	const payload: Record<string, any> = {
		status: params.status,
		status_changed_at: now
	};
	if (params.resolusi != null && params.resolusi.trim()) payload.resolusi = params.resolusi.trim();
	if (params.resolvedBy) payload.resolved_by = params.resolvedBy;
	if (params.ratingAfter != null) payload.rating_after = params.ratingAfter;
	if (params.status === 'tutup') {
		payload.resolved_date = now.slice(0, 10);
	}
	try {
		const row: any = await directus.request(updateItem(COLLECTION as any, id, payload as any));
		notifySales(
			'COMPLAINT_STAGE_CHANGED',
			`Komplain #${id} pindah ke fase ${params.status}${params.status === 'tutup' ? ' (selesai)' : ''}.`,
			{ sourceCollection: COLLECTION, sourceId: id }
		);
		return row;
	} catch (err) {
		handleDirectusError(err);
		throw err;
	}
}

export interface CreateComplaintParams {
	clientTxnId: string;
	customerId?: number | null;
	customerName?: string | null;
	kategori: string;
	deskripsi: string;
	site?: string;
	fotoFileId?: string | null;
	pic?: string | null;
	batchNumber?: string | null;
	prioritas?: string | null;
	kontakPelapor?: string | null;
	produkLayanan?: string | null;
	volumeTerdampak?: string | null;
	tuntutanCustomer?: string | null;
}

/** D0 "Diterima" — tahap 8D lanjutan dikerjakan di app admin. */
export async function createComplaintReport(params: CreateComplaintParams) {
	const {
		clientTxnId,
		customerId,
		customerName,
		kategori,
		deskripsi,
		site,
		fotoFileId,
		pic,
		batchNumber,
		prioritas,
		kontakPelapor,
		produkLayanan,
		volumeTerdampak,
		tuntutanCustomer
	} = params;
	const now = new Date().toISOString();
	try {
		// Format deskripsi terstruktur jika terdapat metadata tambahan agar selalu tersimpan lengkap
		let formattedDeskripsi = deskripsi.trim();
		const extraParts: string[] = [];
		if (produkLayanan?.trim()) extraParts.push(`[Produk/Layanan: ${produkLayanan.trim()}]`);
		if (volumeTerdampak?.trim()) extraParts.push(`[Volume Terdampak: ${volumeTerdampak.trim()}]`);
		if (tuntutanCustomer?.trim()) extraParts.push(`[Harapan/Tuntutan: ${tuntutanCustomer.trim()}]`);

		if (extraParts.length > 0 && !formattedDeskripsi.includes(extraParts[0])) {
			formattedDeskripsi = `${extraParts.join(' ')}\n\n${formattedDeskripsi}`;
		}

		const payload: Record<string, any> = {
			client_txn_id: clientTxnId,
			customer_id: customerId || null,
			tanggal: now.slice(0, 10),
			kategori,
			deskripsi: formattedDeskripsi,
			status: 'diterima',
			status_changed_at: now,
			site: site || 'pusat',
			foto: fotoFileId || null,
			pic: pic || null,
			batch_number: batchNumber?.trim() || null
		};
		if (prioritas) payload.prioritas = prioritas;
		if (kontakPelapor) payload.kontak_pelapor = kontakPelapor.trim();

		const row: any = await directus.request(
			createItem(COLLECTION as any, payload as any)
		);
		notifySales('COMPLAINT_RECEIVED', `Komplain baru dari customer (${kategori}) dilaporkan ${pic || 'sales'}: ${formattedDeskripsi.slice(0, 120)}`, {
			sourceCollection: COLLECTION,
			sourceId: row?.id
		});

		// Auto-bridge ke Support Center (support_tiket) supaya komplain tetap "masuk"
		// ke /support seperti sebelum pindah ke koleksi 8D. Best-effort — kegagalan
		// di sini tidak boleh membatalkan komplain yang sudah tersimpan.
		if (row?.id) {
			try {
				const tiketId = await bridgeComplaintToSupport({
					complaintId: row.id,
					kategori,
					deskripsi: formattedDeskripsi,
					customerId: customerId || null,
					customerName: customerName || null,
					kontak: kontakPelapor?.trim() || null,
					site: site || 'pusat',
					prioritas: prioritas || 'normal',
					pelaporNama: pic || null,
					fotoFileId: fotoFileId || null
				});
				if (tiketId) {
					await directus.request(updateItem(COLLECTION as any, row.id, { support_tiket_id: tiketId } as any));
					row.support_tiket_id = tiketId;
				}
			} catch (bridgeErr) {
				console.warn('[customerComplaintApi] auto-bridge ke support gagal (diabaikan):', bridgeErr);
			}
		}
		return row;
	} catch (err) {
		handleDirectusError(err);
		throw err;
	}
}
