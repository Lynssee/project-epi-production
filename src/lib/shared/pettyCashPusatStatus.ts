// src/lib/shared/pettyCashPusatStatus.ts
// PC3-10 — salinan TS dari erp-epi `src/lib/server/pettyCashPusatStatus.js` (peta status tiket → master_pengajuan).
// JAGA IDENTIK: tes kontrak (pettyCashPusatStatus.test.ts) memakai tabel harapan yang sama di kedua repo.
// Nilai hanya dari kosakata yang dikenali /api/pusat-pengajuan (pending / disetujui·selesai / ditolak / revisi).
// 'cancelled' → 'ditolak' (tak ada nilai "dibatalkan" yang dikenali), 'menunggu_kasir' → 'pending'.

export const PCR_TO_MASTER_STATUS: Record<string, string> = {
	menunggu_atasan: 'pending',
	menunggu_finance: 'pending',
	menunggu_kasir: 'pending',
	revisi: 'revisi',
	rejected: 'ditolak',
	cancelled: 'ditolak',
	posted: 'disetujui'
};

/** Uang muka yang LPJ-nya sudah diverifikasi. */
export const PCR_LPJ_SELESAI_MASTER_STATUS = 'selesai';

/** @returns status master, atau null bila tak perlu disinkron (mis. draf). */
export function masterStatusFor(
	row: { status?: string; mode?: string; advance_settlement_status?: string | null } | null | undefined
): string | null {
	if (!row) return null;
	if (row.mode === 'advance' && row.status === 'posted' && row.advance_settlement_status === 'selesai') {
		return PCR_LPJ_SELESAI_MASTER_STATUS;
	}
	return (row.status && PCR_TO_MASTER_STATUS[row.status]) || null;
}
