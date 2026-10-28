// src/lib/services/sjTerimaApi.ts
// Fase 2 Pengiriman Ekspedisi (15 Okt 2026) — Layar "Terima Barang" terpadu
// (wizard 3 langkah: foto barang+GPS, cek per item, foto SJ fisik bertanda tangan).
//
// TIDAK ada logika jurnal/stok baru di sini — murni memanggil ulang modul yang sudah
// ada dan battle-tested di alur GR lama (stock-lapangan/masuk mode GR):
//   compressPhoto -> watermarkPhoto -> uploadEvidencePhoto -> confirmGoodsReceived
// Offline: antrean SAMA dengan alur lama (offlineGRQueue.ts, IndexedDB 'epi_gr_queue') —
// satu antrean dipakai bersama oleh layar lama & wizard baru ini, jadi flush dari
// halaman manapun yang kebuka berikutnya tetap mengirim entri dari halaman yang lain.

import { compressPhoto } from '$lib/utils/photoCompress';
import { watermarkPhoto } from '$lib/utils/photoWatermark';
import { uploadEvidencePhoto } from './stockLapangan';
import { confirmGoodsReceived, fetchInTransitShipments, type ConfirmGRItem, type GREvidence, type GRShipment } from './goodsReceived';
import { enqueueGRSubmission, registerGRAutoFlush, type QueuedGRItem, type QueuedGRSubmission } from '$lib/utils/offlineGRQueue';

export type { GRShipment, GRItem } from './goodsReceived';

/** GET /api/goods-received/list yang sudah ada, difilter ke satu SJ. */
export async function fetchShipmentForSj(sjId: number | string): Promise<GRShipment | null> {
	const shipments = await fetchInTransitShipments();
	return shipments.find((s) => String(s.suratJalanId) === String(sjId)) || null;
}

export interface TerimaItemInput {
	itemType: 'rab' | 'generic';
	projectExpenseId?: number;
	suratJalanItemId?: number;
	materialName: string;
	identitasBarangId?: number | null;
	qtyReceived: number;
	condition: ConfirmGRItem['condition'];
}

async function prepareAndUpload(file: File, gps: { lat: number; lng: number; accuracy: number } | null, description: string): Promise<string> {
	const compressed = await compressPhoto(file);
	const watermarked = await watermarkPhoto(compressed, gps);
	const fileId = await uploadEvidencePhoto(watermarked, description);
	if (!fileId) throw new Error(`Gagal mengunggah ${description}.`);
	return fileId;
}

/**
 * Kirim ulang satu entri antrean offline (dipakai oleh registerAutoFlushTerima di
 * bawah, generik terhadap asal entri — bisa dari wizard ini ATAU dari layar lama
 * stock-lapangan/masuk, karena keduanya menulis ke antrean 'epi_gr_queue' yang sama).
 */
async function sendQueuedGRSubmission(entry: QueuedGRSubmission): Promise<void> {
	const fotoTerimaFileId = await uploadEvidencePhoto(entry.blobs.fotoTerima as File, 'goods-received:foto-terima (antrean)');
	if (!fotoTerimaFileId) throw new Error('Gagal mengunggah foto bukti terima dari antrean.');
	const evidence: GREvidence = { gps: entry.gps };
	if (entry.blobs.scanSj) evidence.scanSjFileId = await uploadEvidencePhoto(entry.blobs.scanSj as File, 'goods-received:scan-sj-fisik (antrean)');
	if (entry.blobs.ttdPenerima) evidence.ttdPenerimaFileId = await uploadEvidencePhoto(entry.blobs.ttdPenerima as File, 'goods-received:ttd-penerima (antrean)');
	if (entry.blobs.ttdDriver) evidence.ttdDriverFileId = await uploadEvidencePhoto(entry.blobs.ttdDriver as File, 'goods-received:ttd-driver (antrean)');
	await confirmGoodsReceived(
		entry.suratJalanId,
		entry.items.map((it) => ({ project_expense_id: it.project_expense_id, qty_received: it.qty_received, condition: it.condition })),
		fotoTerimaFileId,
		evidence
	);
}

/** Panggil sekali di onMount halaman wizard — sama dgn registerGRAutoFlush layar lama. */
export function registerAutoFlushTerima(): () => void {
	return registerGRAutoFlush(sendQueuedGRSubmission);
}

/**
 * Satu aksi "Serahkan": upload foto barang (wajib) + GPS, per-item, foto SJ fisik
 * (opsional). Gagal jaringan (TypeError) -> antre offline (sama seperti layar lama),
 * BUKAN gagal total — wizard menampilkan "tersimpan, akan terkirim otomatis".
 */
export async function submitTerimaBarang(params: {
	suratJalanId: number;
	nomorSJ: string;
	items: TerimaItemInput[];
	fotoTerimaFile: File;
	scanSjFisikFile?: File | null;
	gps: { lat: number; lng: number; accuracy: number } | null;
}): Promise<{ queued: boolean; hasVariance?: boolean }> {
	const confirmItems: ConfirmGRItem[] = params.items.map((it) => ({
		project_expense_id: it.itemType === 'rab' ? it.projectExpenseId : undefined,
		surat_jalan_item_id: it.itemType === 'generic' ? it.suratJalanItemId : undefined,
		qty_received: it.qtyReceived,
		condition: it.condition
	}));

	try {
		const fotoTerimaFileId = await prepareAndUpload(params.fotoTerimaFile, params.gps, 'goods-received:foto-terima');
		const evidence: GREvidence = { gps: params.gps };
		if (params.scanSjFisikFile) {
			evidence.scanSjFileId = await prepareAndUpload(params.scanSjFisikFile, params.gps, 'goods-received:scan-sj-fisik');
		}
		const out = await confirmGoodsReceived(params.suratJalanId, confirmItems, fotoTerimaFileId, evidence);
		return { queued: false, hasVariance: out.hasVariance };
	} catch (e) {
		if (!(e instanceof TypeError)) throw e; // bukan masalah jaringan -> tampilkan error, jangan antre diam-diam
		// Antrean offline (QueuedGRItem) hanya mendukung item RAB (project_expense_id) —
		// keterbatasan yang sudah ada sebelum wizard ini (offlineGRQueue.ts tidak punya
		// surat_jalan_item_id). Jangan antre sebagian diam-diam (Aturan #1/#7): SJ barang
		// internal/non-RAB wajib sinyal online saat terima.
		if (params.items.some((it) => it.itemType === 'generic')) {
			throw new Error('Tidak ada sinyal internet, dan SJ ini punya barang non-RAB yang belum didukung antrean offline. Coba lagi saat sinyal ada.');
		}
		const queuedItems: QueuedGRItem[] = params.items
			.filter((it) => it.itemType === 'rab' && it.projectExpenseId != null)
			.map((it) => ({
				project_expense_id: it.projectExpenseId as number,
				qty_received: it.qtyReceived,
				condition: it.condition,
				identitas_barang_id: it.identitasBarangId ?? null,
				material_name: it.materialName
			}));
		await enqueueGRSubmission({
			client_txn_id: `terima-${params.suratJalanId}-${crypto.randomUUID()}`,
			suratJalanId: params.suratJalanId,
			nomorSJ: params.nomorSJ,
			items: queuedItems,
			gps: params.gps,
			blobs: {
				fotoTerima: params.fotoTerimaFile,
				...(params.scanSjFisikFile ? { scanSj: params.scanSjFisikFile } : {})
			},
			createdAt: new Date().toISOString()
		});
		return { queued: true };
	}
}
