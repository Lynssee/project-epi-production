// src/lib/services/plLampiranPreview.ts
// Menu Lampiran v2 Fase 4 — klien tipis lintas-origin ke erp-epi
// (/api/packing-list/lampiran/preview-draft). Pola sama plTracking.ts/materialChain.ts: Bearer token Firebase.
// Hanya membaca; tidak membuat lampiran. Angka saldo = SALDO BUKU (catatan dari server ikut dibawa).
import { getIdToken } from './secureDirectus';

const ADMIN_APP_ORIGIN = '';

export interface PreviewDraftItem {
	item_id?: number | null;
	nama_barang: string;
	unit?: string;
	qty_required: number;
}

export interface SaldoLokasiRow {
	nama: string;
	unit: string;
	linked: boolean;
	diminta: number;
	saldoBuku?: number;
	diterima?: number;
	terpakai?: number;
	diPerjalanan?: number;
	terakhirPakaiDicatat?: string | null;
	pemakaianBasi?: boolean;
}

export interface BarangDiTanganRow {
	nama: string;
	unit: string;
	qty: number;
	nomorPl: string;
	wajibKembali: string | null;
	terlambatHari: number;
	tanpaTenggat: boolean;
}

export interface PlLampiranPreview {
	saldoLokasi:
		| { available: true; rows: SaldoLokasiRow[]; catatan: string[]; windowDays: number }
		| { available: false; reason: string };
	barangDiTangan: { pemohon: string; rows: BarangDiTanganRow[] };
	/** Menu Lampiran v2 R1: kepatuhan catat pemakaian proyek ini (pemakaian tercatat ÷ diterima); null bila belum ada penerimaan. */
	kepatuhanPemakaian?: { diterima: number; terpakai: number; rasioPct: number } | null;
}

export async function fetchPlLampiranPreview(
	projectId: number | null,
	items: PreviewDraftItem[]
): Promise<{ data?: PlLampiranPreview; error?: string }> {
	try {
		const token = await getIdToken();
		const res = await fetch(`${ADMIN_APP_ORIGIN}/api/packing-list/lampiran/preview-draft`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ project_id: projectId, items })
		});
		const parsed = await res.json().catch(() => null);
		if (!res.ok) return { error: parsed?.message || `Gagal memuat pratinjau lampiran (${res.status})` };
		return { data: parsed as PlLampiranPreview };
	} catch (err: any) {
		console.warn('[plLampiranPreview] error:', err);
		return { error: err?.message || 'Gagal menghubungi server admin.' };
	}
}
