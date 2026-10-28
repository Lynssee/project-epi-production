import directus, { handleDirectusError } from './directus';
import { createItem } from '@directus/sdk';

export interface PengajuanManpowerRow {
	assignment_id: number;
	manpower_id: number;
	project_id: number;
	periode_dari: string;
	periode_sampai: string;
	jumlah: number;
	catatan?: string;
	/** Fase 0 (integritas payroll ↔ PA) — tautan balik ke slip + rincian GROSS→NET. */
	payroll_id?: number | null;
	basis_gross?: number | null;
	potongan_kasbon?: number | null;
	potongan_lain?: number | null;
}

/**
 * Simpan daftar manpower yang dibayar untuk sebuah pengajuan anggaran (kategori jasa).
 * Dipanggil setelah header pengajuan_anggaran berhasil dibuat.
 */
export async function createPengajuanManpowerRows(pengajuanId: number, rows: PengajuanManpowerRow[]) {
	try {
		for (const row of rows) {
			await directus.request(
				createItem('pengajuan_anggaran_manpower', {
					pengajuan_anggaran_id: pengajuanId,
					assignment_id: row.assignment_id,
					manpower_id: row.manpower_id,
					project_id: row.project_id,
					periode_dari: row.periode_dari,
					periode_sampai: row.periode_sampai,
					jumlah: Number(row.jumlah) || 0,
					catatan: row.catatan || '',
					// Fase 0: tautan dua arah + rincian potongan (basis_gross − jumlah = kasbon + lain).
					payroll_id: row.payroll_id ?? null,
					basis_gross: row.basis_gross ?? null,
					potongan_kasbon: row.potongan_kasbon ?? null,
					potongan_lain: row.potongan_lain ?? null,
					status_bayar: 'pending'
				})
			);
		}
		return { success: true };
	} catch (error: any) {
		handleDirectusError(error);
		return { success: false, error: error?.message };
	}
}
