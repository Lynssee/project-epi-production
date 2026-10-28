// PC3-10 — tes KONTRAK peta status: tabel harapan IDENTIK dengan erp-epi src/lib/server/pettyCashPusatSync.test.js.
import { describe, it, expect } from 'vitest';
import { masterStatusFor } from './pettyCashPusatStatus';

const CASES: Array<[string, Record<string, any>, string | null]> = [
	['menunggu_atasan → pending', { status: 'menunggu_atasan' }, 'pending'],
	['menunggu_finance → pending', { status: 'menunggu_finance' }, 'pending'],
	['menunggu_kasir → pending (nilai "disetujui_proses" tak dikenali Pusat Pengajuan)', { status: 'menunggu_kasir' }, 'pending'],
	['revisi → revisi', { status: 'revisi' }, 'revisi'],
	['rejected → ditolak', { status: 'rejected' }, 'ditolak'],
	['cancelled → ditolak (fallback: tak ada nilai "dibatalkan" yang dikenali)', { status: 'cancelled' }, 'ditolak'],
	['posted (reimburse) → disetujui', { status: 'posted', mode: 'reimburse' }, 'disetujui'],
	['posted advance, LPJ belum → disetujui', { status: 'posted', mode: 'advance', advance_settlement_status: 'menunggu_lpj' }, 'disetujui'],
	['posted advance, LPJ diajukan → disetujui', { status: 'posted', mode: 'advance', advance_settlement_status: 'lpj_diajukan' }, 'disetujui'],
	['posted advance, LPJ selesai → selesai', { status: 'posted', mode: 'advance', advance_settlement_status: 'selesai' }, 'selesai'],
	['draft → tidak disinkron', { status: 'draft' }, null],
	['status tak dikenal → tidak disinkron', { status: 'aneh' }, null]
];

describe('kontrak peta status Pusat Pengajuan', () => {
	for (const [name, row, want] of CASES) it(name, () => expect(masterStatusFor(row)).toBe(want));
	it('null/undefined → null', () => {
		expect(masterStatusFor(null)).toBeNull();
		expect(masterStatusFor(undefined)).toBeNull();
	});
	it('semua nilai ada di kosakata /api/pusat-pengajuan', () => {
		const known = new Set(['pending', 'diajukan', 'submitted', 'menunggu', 'disetujui', 'approved', 'completed', 'selesai', 'ditolak', 'rejected', 'returned', 'revisi', 'perlu_revisi']);
		for (const [, row] of CASES) {
			const v = masterStatusFor(row);
			if (v) expect(known.has(v), v).toBe(true);
		}
	});
});
