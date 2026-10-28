// src/lib/utils/offlineReportDraft.ts
// Draft LENGKAP (termasuk foto) untuk form Laporan Harian, tersimpan di
// IndexedDB per project+tanggal — supaya form terpanjang di modul ini bisa
// diisi total tanpa sinyal di lapangan.
//
// SENGAJA BUKAN antrian auto-submit (beda dari offlineComplaintQueue.ts dkk).
// Submit sesungguhnya alur ini membuat invoice reimbursement (project_expenses
// + purchase_invoices) dan menghitung delta stok material terhadap RAB Actual
// -- kalau di-replay otomatis nanti saat online, snapshot stok/anggaran yang
// dipakai saat submit sudah basi (bisa salah hitung sisa stok / nominal
// reimbursement). Jadi: isi & simpan draft boleh offline, tombol submit tetap
// wajib online (lihat komentar terkait di +page.svelte).
//
// Pola penyimpanan foto {blob, name} terpisah (bukan mengandalkan File object
// utuh) meniru offlineComplaintQueue.ts -- lebih aman lintas-browser untuk
// structured clone di IndexedDB.

import { openDB, type IDBPDatabase } from 'idb';

export interface ReportDraftPhoto {
	name: string;
	blob: Blob;
	uploadedId?: string | null;
}

export interface ReportDraftRecord {
	key: string;
	savedAt: number;
	fields: Record<string, unknown>;
	photos: {
		attendance_photos: ReportDraftPhoto[];
		progress_photos: ReportDraftPhoto[];
		issue_photos: ReportDraftPhoto[];
		toolbox_photos: ReportDraftPhoto[];
		area_kerja_photos: ReportDraftPhoto[];
		weekend_photos: ReportDraftPhoto[];
		budget_receipt: ReportDraftPhoto | null;
		budget_item_receipts: (ReportDraftPhoto | null)[];
	};
}

const DB_NAME = 'epi_report_draft';
const STORE_NAME = 'drafts';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
	if (typeof indexedDB === 'undefined') {
		throw new Error('IndexedDB tidak tersedia di perangkat ini');
	}
	if (!dbPromise) {
		dbPromise = openDB(DB_NAME, 1, {
			upgrade(db) {
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME, { keyPath: 'key' });
				}
			}
		});
	}
	return dbPromise;
}

export async function saveReportDraft(record: ReportDraftRecord): Promise<void> {
	const db = await getDb();
	await db.put(STORE_NAME, record);
}

export async function loadReportDraft(key: string): Promise<ReportDraftRecord | null> {
	try {
		const db = await getDb();
		return (await db.get(STORE_NAME, key)) || null;
	} catch {
		return null;
	}
}

export async function clearReportDraft(key: string): Promise<void> {
	try {
		const db = await getDb();
		await db.delete(STORE_NAME, key);
	} catch {
		// abaikan -- kegagalan hapus draft lama tidak fatal
	}
}

export function hasAnyPhoto(photos: ReportDraftRecord['photos']): boolean {
	return (
		photos.attendance_photos.length > 0 ||
		photos.progress_photos.length > 0 ||
		photos.issue_photos.length > 0 ||
		photos.toolbox_photos.length > 0 ||
		photos.area_kerja_photos.length > 0 ||
		photos.weekend_photos.length > 0 ||
		!!photos.budget_receipt ||
		photos.budget_item_receipts.some(Boolean)
	);
}
