// src/lib/services/finishGoodDispatch.ts
// Lajur 2 (Finish Good → Kirim), Fase 3 — Hub Persiapan 3-Lajur v2.
// Membuat DRAFT surat_jalan dari mobile lapangan (mirror pola createManualDraft di
// erp-epi-1/src/lib/services/suratJalanDraftApi.js — TIDAK memotong stok, wajib direview
// admin). Field header/item dikonfirmasi via introspeksi langsung skema Directus produksi
// (/fields/surat_jalan, /fields/surat_jalan_items) — bukan tebakan dari pola pemakaian kode,
// karena beberapa field yang dipakai kode lama (item_id, kode_barang, sg_standard di
// surat_jalan_items) ternyata TIDAK ada di skema sungguhan (didrop diam-diam oleh Directus).

import directus, { handleDirectusError } from './directus';
import { readItems, createItem } from '@directus/sdk';
import { markPersiapanStatus } from './persiapanProgress';

export interface FinishGoodDispatchItem {
	itemId: number;
	namaBarang: string;
	satuan: string;
	qty: number;
	kondisi: 'baik' | 'rusak';
}

async function generateSJNumber(): Promise<string> {
	const now = new Date();
	const yy = String(now.getFullYear()).slice(-2);
	const mm = String(now.getMonth() + 1).padStart(2, '0');
	const dd = String(now.getDate()).padStart(2, '0');
	const prefix = `SJ/${yy}${mm}${dd}/`;

	try {
		const rows = (await directus.request(
			readItems('surat_jalan' as any, {
				filter: { nomor_sj: { _starts_with: prefix } } as any,
				fields: ['nomor_sj'] as any,
				sort: ['-nomor_sj'] as any,
				limit: 1
			})
		)) as any[];
		let nextSeq = 1;
		const last = rows[0]?.nomor_sj;
		if (last) {
			const lastSeq = parseInt(String(last).split('/').pop() || '', 10);
			if (!Number.isNaN(lastSeq)) nextSeq = lastSeq + 1;
		}
		return `${prefix}${String(nextSeq).padStart(3, '0')}`;
	} catch {
		return `${prefix}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
	}
}

function generateQrToken(): string {
	return `EPI:SJ:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export async function createFinishGoodDraftSJ(params: {
	destinationType: 'proyek' | 'customer';
	destinationId: number | null;
	destinationName: string;
	items: FinishGoodDispatchItem[];
	karyawanName: string;
	karyawanId?: number | null;
	/** 3 sudut [depan, label, kondisi] — satu set foto mewakili seluruh pengiriman ini. */
	photoFiles?: (File | null)[] | null;
}): Promise<{ ok: boolean; nomorSj?: string; error?: string }> {
	try {
		const nomorSj = await generateSJNumber();

		const header: any = await directus.request(
			createItem('surat_jalan' as any, {
				so_customer_id: null,
				nomor_sj: nomorSj,
				qr_token: generateQrToken(),
				driver: null,
				status: 'active',
				draft_status: 'draft',
				completion_percentage: 0,
				total_items_required: params.items.length,
				total_items_delivered: 0,
				auto_created: true,
				type: params.destinationType,
				delivery_address: params.destinationName || null,
				notes: `Draft otomatis dari mobile lapangan (Finish Good), dibuat oleh ${params.karyawanName || 'petugas gudang'}.`,
				source_type: 'mobile_field_fg',
				dibuat_oleh_karyawan_id: params.karyawanId ?? null,
				project_id: params.destinationType === 'proyek' ? params.destinationId : null
			})
		);

		for (const item of params.items) {
			await directus.request(
				createItem('surat_jalan_items' as any, {
					surat_jalan_id: header.id,
					so_detail_id: null,
					nama_barang: item.namaBarang,
					unit: item.satuan || 'pcs',
					qty_required: item.qty,
					qty_delivered: 0,
					qty_remaining: item.qty,
					delivery_status: 'pending',
					so_type: 'mobile_field_fg',
					price: 0,
					total_price: 0,
					keterangan: item.kondisi === 'rusak' ? 'Kondisi: rusak' : null
				})
			);

			// Traceability item -> identitas_barang tetap tercatat di persiapan_progress
			// (surat_jalan_items tidak punya kolom item_id di skema produksi).
			await markPersiapanStatus({
				sourceType: 'finish_good',
				sourceId: header.id,
				itemId: item.itemId,
				qtyPrepared: item.qty,
				status: 'siap',
				karyawanName: params.karyawanName,
				karyawanId: params.karyawanId,
				photoFiles: params.photoFiles
			});
		}

		return { ok: true, nomorSj };
	} catch (error) {
		handleDirectusError(error);
		return { ok: false, error: (error as any)?.message || 'Gagal membuat draft Surat Jalan' };
	}
}
