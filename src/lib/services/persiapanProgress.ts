// src/lib/services/persiapanProgress.ts
// Status persiapan per lajur (Hub Persiapan 3-Lajur v2, Fase 0/2) — koleksi `persiapan_progress`.
// Menggantikan toggle in-memory di persiapan/+page.svelte lama yang reset saat reload.

import directus, { handleDirectusError } from './directus';
import { readItems, readItem, createItem, updateItem } from '@directus/sdk';
import { uploadEvidencePhoto } from './stockLapangan';

export type PersiapanSourceType = 'bahan_baku_spk' | 'finish_good' | 'packing_list';
export type PersiapanStatus = 'pending' | 'disiapkan' | 'siap';

export interface PersiapanProgressRow {
	id: number;
	sourceType: PersiapanSourceType;
	sourceId: string;
	itemId: number | null;
	qtyPrepared: number;
	status: PersiapanStatus;
	catatan: string | null;
	dateUpdated: string | null;
}

function key(sourceId: string | number, itemId: number | null) {
	return `${sourceId}:${itemId ?? ''}`;
}

/**
 * Ambil status persiapan untuk sekumpulan (sourceId, itemId) dalam satu lajur.
 * Return map keyed by `${sourceId}:${itemId}` — lookup di UI pakai fungsi key() di atas.
 */
export async function getProgressMap(
	sourceType: PersiapanSourceType,
	sourceIds: (string | number)[]
): Promise<Map<string, PersiapanProgressRow>> {
	const map = new Map<string, PersiapanProgressRow>();
	if (!sourceIds.length) return map;
	try {
		const rows = (await directus.request(
			readItems('persiapan_progress' as any, {
				filter: {
					source_type: { _eq: sourceType },
					source_id: { _in: [...new Set(sourceIds.map(String))] }
				} as any,
				fields: ['id', 'source_type', 'source_id', 'item_id', 'qty_prepared', 'status', 'catatan', 'date_updated'] as any,
				limit: -1
			})
		)) as any[];
		for (const r of rows) {
			map.set(key(r.source_id, r.item_id ?? null), {
				id: r.id,
				sourceType: r.source_type,
				sourceId: r.source_id,
				itemId: r.item_id ?? null,
				qtyPrepared: Number(r.qty_prepared) || 0,
				status: r.status || 'pending',
				catatan: r.catatan ?? null,
				dateUpdated: r.date_updated ?? null
			});
		}
	} catch (error) {
		handleDirectusError(error);
	}
	return map;
}

// Kategori parent_category di identitas_barang (lihat getCategoryName() erp-epi-1/suratJalanApi.js).
const PARENT_CATEGORY_FINISHGOOD = 142;

/**
 * Untuk tombol "Scan" di hub — tentukan barang hasil scan termasuk lajur mana (kalau ada),
 * supaya bisa langsung lompat ke halaman & item yang tepat.
 */
export async function resolveItemLajur(itemId: number): Promise<PersiapanSourceType | null> {
	try {
		const [reservations, itemRow] = await Promise.all([
			directus.request(
				readItems('stock_reservations' as any, {
					filter: { item_id: { _eq: itemId }, status: { _eq: 'active' } } as any,
					fields: ['id'] as any,
					limit: 1
				})
			),
			directus
				.request(
					readItem('identitas_barang' as any, itemId, {
						fields: ['id', 'parent_category', 'stok_tersedia', 'stok_minimum'] as any
					})
				)
				.catch(() => null)
		]);
		if ((reservations as any[]).length > 0) return 'bahan_baku_spk';

		const item: any = itemRow;
		if (item) {
			const stokTersedia = parseFloat(item.stok_tersedia) || 0;
			const stokMinimum = Number(item.stok_minimum) || 0;
			if (stokMinimum > 0 && stokTersedia < stokMinimum) return 'bahan_baku_spk';
			if (item.parent_category === PARENT_CATEGORY_FINISHGOOD && stokTersedia > 0) return 'finish_good';
		}
		return null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/**
 * Tandai status persiapan (upsert by source_type+source_id+item_id).
 * Foto bukti opsional — dikirim sebagai File, diupload dulu lalu ditautkan.
 */
export async function markPersiapanStatus(params: {
	sourceType: PersiapanSourceType;
	sourceId: string | number;
	itemId: number | null;
	qtyPrepared: number;
	status: PersiapanStatus;
	karyawanName: string;
	karyawanId?: number | null;
	photoFile?: File | null;
	/** 3 sudut [depan, label, kondisi] — dipakai lajur Finish Good. Beda dari photoFile (1 foto, lajur Bahan Baku). */
	photoFiles?: (File | null)[] | null;
}): Promise<{ ok: boolean; error?: string }> {
	try {
		let evidencePhoto: string | null = null;
		if (params.photoFile) {
			evidencePhoto = await uploadEvidencePhoto(params.photoFile, `persiapan_progress:${params.sourceType}:${params.sourceId}`);
		}

		let evidencePhotos: string[] | null = null;
		if (params.photoFiles?.length) {
			const uploaded = await Promise.all(
				params.photoFiles.map((f, idx) =>
					f ? uploadEvidencePhoto(f, `persiapan_progress:${params.sourceType}:${params.sourceId}:angle${idx}`) : Promise.resolve(null)
				)
			);
			evidencePhotos = uploaded.filter((id): id is string => !!id);
		}

		const existing = (await directus.request(
			readItems('persiapan_progress' as any, {
				filter: {
					source_type: { _eq: params.sourceType },
					source_id: { _eq: String(params.sourceId) },
					item_id: params.itemId != null ? { _eq: params.itemId } : { _null: true }
				} as any,
				fields: ['id', 'status', 'revision_count'] as any,
				limit: 1
			})
		)) as any[];

		const payload: Record<string, any> = {
			qty_prepared: params.qtyPrepared,
			status: params.status,
			catatan: params.karyawanName ? `Ditandai oleh ${params.karyawanName}` : null,
			operator_karyawan_id: params.karyawanId ?? null,
			date_updated: new Date().toISOString()
		};
		if (evidencePhoto) payload.evidence_photo = evidencePhoto;
		if (evidencePhotos) payload.evidence_photos = evidencePhotos;

		if (existing[0]) {
			// "siap" dibatalkan lagi ke "pending" — proxy akurasi (statistik petugas).
			if (existing[0].status === 'siap' && params.status === 'pending') {
				payload.revision_count = (Number(existing[0].revision_count) || 0) + 1;
			}
			await directus.request(updateItem('persiapan_progress' as any, existing[0].id, payload));
		} else {
			await directus.request(
				createItem('persiapan_progress' as any, {
					source_type: params.sourceType,
					source_id: String(params.sourceId),
					item_id: params.itemId,
					date_created: new Date().toISOString(),
					revision_count: 0,
					...payload
				})
			);
		}
		return { ok: true };
	} catch (error) {
		handleDirectusError(error);
		return { ok: false, error: (error as any)?.message || 'Gagal menyimpan status' };
	}
}
