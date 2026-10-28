// PC3-09 — tes KONTRAK planApprovalSync: tabel harapan IDENTIK dengan erp-epi src/lib/server/pettyCashApprovalSync.test.js
// + rekonsiliator lapangan (Directus di-mock).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockJson = vi.fn();
const mockCreate = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: unknown[]) => mockJson(...a) }));
vi.mock('$lib/server/approvalSubmit', () => ({ createApprovalRequest: (...a: unknown[]) => mockCreate(...a) }));
vi.mock('$env/dynamic/private', () => ({ env: { ERP_EPI1_BASE_URL: 'https://internal.example/' } }));

const { planApprovalSync, reconcilePcrApproval } = await import('./pettyCashApprovalSync');

const P = { id: 9, status: 'pending' };
const A = { id: 9, status: 'approved' };
const R = { id: 9, status: 'returned' };

// [nama, statusTiketSesudah, aksi, existing, hasil] — SALIN persis dari erp-epi
const CASES: Array<[string, string, string, { id: number; status: string } | null, Record<string, string>]> = [
	['submit → menunggu_atasan, belum ada item → buat', 'menunggu_atasan', 'submit', null, { op: 'create' }],
	['resubmit setelah revisi, item returned → aktifkan ulang', 'menunggu_atasan', 'submit', R, { op: 'reactivate' }],
	['menunggu_atasan, item sudah pending → tak ada', 'menunggu_atasan', 'submit', P, { op: 'none' }],
	['atasan_approve → menunggu_kasir: item pending → approved', 'menunggu_kasir', 'atasan_approve', P, { op: 'close', status: 'approved', actionType: 'approve' }],
	['atasan_approve → menunggu_finance: item pending → approved', 'menunggu_finance', 'atasan_approve', P, { op: 'close', status: 'approved', actionType: 'approve' }],
	['atasan_reject → rejected + action', 'rejected', 'atasan_reject', P, { op: 'close', status: 'rejected', actionType: 'reject' }],
	['atasan_revisi → returned + action', 'revisi', 'atasan_revisi', P, { op: 'close', status: 'returned', actionType: 'return' }],
	['cancel pemohon → item pending ditutup cancelled (bukan rejected)', 'cancelled', 'cancel', P, { op: 'close', status: 'cancelled', actionType: 'comment' }],
	['kasir_reject saat item masih pending (hantu) → cancelled', 'rejected', 'kasir_reject', P, { op: 'close', status: 'cancelled', actionType: 'comment' }],
	['submit langsung ke kasir (tanpa atasan), tak ada item → tidak membuat item', 'menunggu_kasir', 'submit', null, { op: 'none' }],
	['submit langsung ke kasir, ada item pending lama → tutup cancelled', 'menunggu_kasir', 'submit', P, { op: 'close', status: 'cancelled', actionType: 'comment' }],
	['kasir_approve (posted), item sudah approved → biarkan', 'posted', 'kasir_approve', A, { op: 'none' }],
	['kasir_reject, item sudah approved → biarkan', 'rejected', 'kasir_reject', A, { op: 'none' }],
	['finance_reject, item sudah approved → biarkan', 'rejected', 'finance_reject', A, { op: 'none' }],
	['lpj_verify tanpa item → tak ada', 'posted', 'lpj_verify', null, { op: 'none' }]
];

describe('kontrak planApprovalSync', () => {
	for (const [name, rowStatus, action, existing, want] of CASES) {
		it(name, () => expect(planApprovalSync(rowStatus, action, existing)).toEqual(want));
	}
});

describe('reconcilePcrApproval (lapangan)', () => {
	beforeEach(() => {
		mockJson.mockReset();
		mockCreate.mockReset();
	});
	const row = { id: 42, request_number: 'PCR-1', description: 'ATK', amount: 350000, mode: 'reimburse', requester_divisi: 'Teknik', requester_karyawan_id: 12, fund_id: 5, atasan_karyawan_id: 8, status: 'menunggu_atasan' };

	it('tiket lapangan menunggu_atasan tanpa item → dibuat dengan callbackUrl ke admin', async () => {
		mockJson.mockResolvedValueOnce({ data: [] });
		mockCreate.mockResolvedValueOnce({ id: 101 });
		expect(await reconcilePcrApproval(row, { action: 'submit', actorKaryawanId: 12 })).toEqual({ op: 'create' });
		expect(mockCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				moduleKey: 'finance.petty_cash',
				sourceId: '42',
				requesterId: 12,
				callbackUrl: 'https://internal.example/api/petty-cash-request/approval-callback'
			})
		);
	});
	it('batal pemohon dari HP → item pending ditutup cancelled + catatan', async () => {
		mockJson.mockResolvedValueOnce({ data: [{ ...P, current_step: 1 }] }).mockResolvedValue({ data: {} });
		await reconcilePcrApproval({ ...row, status: 'cancelled' }, { action: 'cancel', actorKaryawanId: 12 });
		expect(JSON.parse(mockJson.mock.calls[1][1].body)).toMatchObject({ request_id: 9, action: 'comment' });
		expect(JSON.parse(mockJson.mock.calls[2][1].body)).toEqual({ status: 'cancelled' });
	});
	it('atasan setuju dari HP → item Inbox approved + action approve', async () => {
		mockJson.mockResolvedValueOnce({ data: [P] }).mockResolvedValue({ data: {} });
		await reconcilePcrApproval({ ...row, status: 'menunggu_kasir' }, { action: 'atasan_approve', actorKaryawanId: 8, note: 'ok' });
		expect(JSON.parse(mockJson.mock.calls[1][1].body)).toMatchObject({ action: 'approve', actor_id: 8, note: 'ok' });
		expect(JSON.parse(mockJson.mock.calls[2][1].body)).toEqual({ status: 'approved' });
	});
	it('gagal Directus → tidak melempar (non-fatal), tercatat', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockJson.mockRejectedValue(new Error('403'));
		expect(await reconcilePcrApproval(row, { action: 'submit' })).toBeNull();
		expect(err).toHaveBeenCalled();
		err.mockRestore();
	});
	it('row tanpa id → null', async () => {
		expect(await reconcilePcrApproval(null)).toBeNull();
		expect(mockJson).not.toHaveBeenCalled();
	});
});
