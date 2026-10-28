// src/lib/services/customerLifecycleApi.ts
// Lifecycle Customer -> PO -> Komisi v2, Fase 6 (L1) — pengambil fakta lifecycle utk
// dashboard lapangan. SUBSET read-only dari versi admin (erp-epi
// src/lib/services/customerLifecycleApi.js): field komisi (dynamic_fields nominal/
// persentase) TIDAK diambil sama sekali di sini -- L1 "Tanpa nominal komisi (sensitif)".
// C9 dikomputasi dari jumlah PA saja (tanpa nominal), lalu disembunyikan total di UI
// lapangan (lihat resolveFieldLifecyclePhases di komponen stepper).
//
// Fetching dipisah per relasi (Aturan #2), sama seperti versi admin.

import { secureDirectusJson } from './secureDirectus';

async function fetchRows(url: string, label: string): Promise<any[]> {
	try {
		const json = await secureDirectusJson<{ data: any[] }>(url);
		return json?.data || [];
	} catch (e: any) {
		console.error(`[customerLifecycleApi] gagal fetch ${label}:`, e?.message);
		return [];
	}
}

export interface CustomerLifecycleFacts {
	prospect: any | null;
	surveys: any[];
	quotations: any[];
	kalkulatorPenawaran: any[];
	masterCustomer: any | null;
	suratJalan: any[];
	invoices: any[];
	komisiPengajuan: any[];
}

/**
 * @param so - minimal { id, kode_customer } dari so_customer
 */
export async function fetchCustomerLifecycleFacts(so: { id: number; kode_customer?: string | null }): Promise<CustomerLifecycleFacts> {
	if (!so?.id) {
		return { prospect: null, surveys: [], quotations: [], kalkulatorPenawaran: [], masterCustomer: null, suratJalan: [], invoices: [], komisiPengajuan: [] };
	}
	const soId = so.id;

	const [prospects, surveys, quotations, kalkulatorPenawaran, masterCustomerRows, suratJalan, invoices, komisiPengajuan] = await Promise.all([
		fetchRows(`/items/prospects?filter[converted_so_customer_id][_eq]=${soId}&fields=id,company,name,source_channel,date_created,converted_so_customer_id&limit=1`, 'prospects'),
		fetchRows(`/items/sales_survey?filter[so_customer_id][_eq]=${soId}&fields=id,status,so_customer_id,date_created,date_updated&limit=-1`, 'sales_survey'),
		fetchRows(`/items/quotations?filter[so_id][_eq]=${soId}&fields=id,so_id,quotation_number,status&limit=-1`, 'quotations'),
		fetchRows(`/items/kalkulator_penawaran?filter[linked_so_id][_eq]=${soId}&fields=id,linked_so_id,nomor_penawaran,margin_terkini_pct,margin_snapshot_pct&limit=-1`, 'kalkulator_penawaran'),
		so.kode_customer
			? fetchRows(`/items/master_customer?filter[kode_customer][_eq]=${encodeURIComponent(so.kode_customer)}&fields=id,kode_customer,verification_status,verification_date&limit=1`, 'master_customer')
			: Promise.resolve([]),
		fetchRows(`/items/surat_jalan?filter[so_customer_id][_eq]=${soId}&fields=id,so_customer_id,status,nomor_sj&limit=-1`, 'surat_jalan'),
		fetchRows(`/items/invoices?filter[so_customer_id][_eq]=${soId}&fields=id,so_customer_id,status,payment_status,paid_amount,outstanding_amount&limit=-1`, 'invoices'),
		// TANPA total_amount/persentase_komisi/nama_agen -- L1 sengaja tak menampilkan
		// nominal/identitas agen komisi ke lapangan (sensitif). Directus tidak konsisten
		// memfilter field JSON bersarang (dynamic_fields.so_id) lewat REST -- filter[...]
		// pada field JSON memicu 403 "field tidak ditemukan" (Aturan #1: 403 = schema
		// drift/keterbatasan query, bukan izin). Jadi ambil SEMUA PA kategori komisi
		// (volume kecil, puluhan baris) lalu saring so_id di sisi klien, sama seperti
		// versi admin (erp-epi customerLifecycleApi.js).
		fetchRows(`/items/pengajuan_anggaran?filter[kategori_belanja][_in]=komisi_external,komisi_internal&fields=id,status,dynamic_fields&limit=-1`, 'pengajuan_anggaran (komisi, tanpa nominal)'),
	]);

	return {
		prospect: prospects[0] || null,
		surveys,
		quotations,
		kalkulatorPenawaran,
		masterCustomer: masterCustomerRows[0] || null,
		suratJalan,
		invoices,
		komisiPengajuan: komisiPengajuan.filter((pa: any) => String(pa?.dynamic_fields?.so_id) === String(soId)),
	};
}

export interface CustomerSoSummary {
	id: number;
	nomor_so: string;
	status: string;
	po_status: string | null;
	grand_total: number | null;
	tanggal_so: string | null;
}

/**
 * Lifecycle Customer -> PO -> Komisi v2, Fase 6 -- daftar SO milik satu customer, utk
 * seksi Lifecycle di /sales/customer/[id]. Satu customer bisa punya banyak SO, jadi di
 * sini HANYA daftar ringkas (status SO + status PO) yang menaut ke /sales/po/[id] --
 * stepper lifecycle LENGKAP per-SO sudah ada di sana (L1), tidak diduplikasi di sini.
 */
export async function fetchSoListForCustomer(kodeCustomer: string | null | undefined): Promise<CustomerSoSummary[]> {
	if (!kodeCustomer) return [];
	return fetchRows(
		`/items/so_customer?filter[kode_customer][_eq]=${encodeURIComponent(kodeCustomer)}&fields=id,nomor_so,status,po_status,grand_total,tanggal_so&sort=-tanggal_so&limit=-1`,
		'so_customer (per customer)'
	);
}
