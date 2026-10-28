// src/lib/services/salesPo.ts
// Fase 2 (Sales B2B PO/RAP v2): self-service unggah dokumen PO Customer dari lapangan.
// Lingkup DIBATASI ke opsi (a) rencana — sales HANYA melengkapi dokumen PO ke SO yang
// sudah dibuat admin (erp-epi-1), TIDAK membuat SO baru dari sini (gate kredit/penomoran/
// e-Faktur/termin tetap di admin).
//
// Identitas sales dipetakan lewat so_customer.karyawan_id (FK karyawan), BUKAN sales_name
// (teks bebas, terbukti 17 varian ejaan/kapital untuk ±9 orang — lihat backfill Fase 2).

import { secureDirectusFetch, secureDirectusJson, getIdToken } from './secureDirectus';

export interface SOAwaitingPO {
	id: number;
	nomor_so: string;
	customer_name: string | null;
	kode_customer: string | null;
	grand_total: number;
	status?: string;
	credit_status?: string | null;
	po_status: string;
	po_verify_note: string | null;
	tanggal_so: string | null;
	date_created: string | null;
	nomor_po_customer?: string | null;
	penawaran_id?: string | null;
	penawaran_number?: string | null;
	so_type?: string | null;
}

/** SO milik sales ini yang dokumen PO-nya belum lengkap (belum_ada) atau perlu revisi. */
export async function getMySOsAwaitingPO(karyawanId: number): Promise<SOAwaitingPO[]> {
	const fields = 'id,nomor_so,customer_name,kode_customer,grand_total,status,credit_status,po_status,po_verify_note,tanggal_so,date_created,nomor_po_customer,penawaran_id,penawaran_number,so_type';
	const filter =
		`filter[karyawan_id][_eq]=${karyawanId}` +
		`&filter[po_status][_in]=belum_ada,revisi`;
	const res = await secureDirectusJson<{ data: SOAwaitingPO[] }>(
		`/items/so_customer?fields=${fields}&${filter}&sort=-date_created&limit=100`
	);
	return res.data || [];
}

/** Seluruh SO milik sales ini untuk pemantauan status hilir (Credit Hold, Produksi, Pengiriman, Selesai). */
export async function getAllMySOs(karyawanId: number): Promise<SOAwaitingPO[]> {
	const fields = 'id,nomor_so,customer_name,kode_customer,grand_total,status,credit_status,po_status,po_verify_note,tanggal_so,date_created,nomor_po_customer,penawaran_id,penawaran_number,so_type';
	const filter = `filter[karyawan_id][_eq]=${karyawanId}`;
	const res = await secureDirectusJson<{ data: SOAwaitingPO[] }>(
		`/items/so_customer?fields=${fields}&${filter}&sort=-date_created&limit=100`
	);
	return res.data || [];
}

/** Ringkasan hitung SO per po_status milik sales ini — dipakai badge di Hub. */
export async function getMyPoStatusSummary(karyawanId: number): Promise<Record<string, number>> {
	const res = await secureDirectusJson<{ data: { po_status: string }[] }>(
		`/items/so_customer?filter[karyawan_id][_eq]=${karyawanId}&fields=po_status&limit=-1`
	);
	const summary: Record<string, number> = { belum_ada: 0, terupload: 0, terverifikasi: 0, revisi: 0 };
	for (const row of res.data || []) {
		if (row.po_status && summary[row.po_status] !== undefined) summary[row.po_status]++;
	}
	return summary;
}

/** Satu SO milik sales — dipakai halaman detail. */
export async function getSOForPO(soId: number): Promise<any | null> {
	const fields =
		'id,nomor_so,customer_name,kode_customer,grand_total,status,credit_status,catatan,po_status,po_source,po_verify_note,po_verified_by,po_verified_at,nomor_po_customer,tanggal_so,karyawan_id,penawaran_id,penawaran_number,so_type';
	const res = await secureDirectusJson<{ data: any }>(`/items/so_customer/${soId}?fields=${fields}`);
	return res.data || null;
}

export interface PODocImage {
	id: number;
	file_id: { id: string; filename_download?: string } | null;
	date_created: string | null;
}

export async function getPODocuments(soId: number): Promise<PODocImage[]> {
	const res = await secureDirectusJson<{ data: PODocImage[] }>(
		`/items/so_customer_images?filter[so_customer_id][_eq]=${soId}&filter[is_po_doc][_eq]=true&fields=id,file_id.id,file_id.filename_download,date_created&sort=-id`
	);
	return res.data || [];
}

/**
 * Upload satu foto dokumen PO ke Directus Files, tautkan ke SO, dan set
 * po_status=terupload + po_source=lapangan. Dipanggil langsung (online) atau
 * lewat offlineSalesPoQueue.ts saat sinyal mati.
 */
export async function uploadPoDocument(
	soId: number,
	file: Blob,
	fileName: string,
	uploadedBy: string
): Promise<void> {
	const formData = new FormData();
	formData.append('file', file, fileName);
	formData.append('title', `PO Image - ${fileName}`);

	const uploadRes = await secureDirectusFetch('/files', { method: 'POST', body: formData });
	if (!uploadRes.ok) throw new Error(`Gagal mengunggah foto (${uploadRes.status})`);
	const uploaded = await uploadRes.json();
	const fileId = uploaded?.data?.id;
	if (!fileId) throw new Error('Upload foto tidak mengembalikan file id.');

	await secureDirectusJson('/items/so_customer_images', {
		method: 'POST',
		body: JSON.stringify({
			so_customer_id: soId,
			file_id: fileId,
			uploaded_by: uploadedBy,
			is_po_doc: true
		})
	});

	await secureDirectusJson(`/items/so_customer/${soId}`, {
		method: 'PATCH',
		body: JSON.stringify({ po_status: 'terupload', po_source: 'lapangan' })
	});

	// Notifikasi ke admin sales — best-effort, TIDAK BOLEH menggagalkan upload yang sudah berhasil.
	try {
		const token = await getIdToken();
		const soRes = await secureDirectusJson<{ data: { nomor_so?: string; karyawan_id?: number } }>(
			`/items/so_customer/${soId}?fields=nomor_so,karyawan_id`
		);
		await fetch('/api/sales/notify-po', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({
				message: `${uploadedBy} mengunggah dokumen PO untuk SO ${soRes?.data?.nomor_so || soId} dari lapangan.`,
				karyawanId: soRes?.data?.karyawan_id ?? null,
				sourceCollection: 'so_customer',
				sourceId: soId
			})
		});
	} catch (e) {
		console.warn('[salesPo] gagal kirim notifikasi PO_UPLOADED (non-fatal):', e);
	}
}
