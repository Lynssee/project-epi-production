// PC3-04 — tes KONTRAK: tabel harapan IDENTIK dengan erp-epi src/lib/server/pettyCashTransitions.test.js.
import { describe, it, expect } from 'vitest';
import { guardAllows, matchesFilter, transitionGuard, conflictMessage } from './pettyCashTransitions';

const NOW = '2026-09-29T05:00:00.000Z';
const ALL = ['draft', 'revisi', 'menunggu_atasan', 'menunggu_finance', 'menunggu_kasir', 'posted', 'rejected', 'cancelled'];

const EXPECT: Record<string, string[]> = {
	submit: ['draft', 'revisi'],
	edit: ['draft', 'revisi'],
	atasan_approve: ['menunggu_atasan'],
	atasan_reject: ['menunggu_atasan'],
	atasan_revisi: ['menunggu_atasan'],
	finance_approve: ['menunggu_finance'],
	finance_reject: ['menunggu_finance'],
	finance_revisi: ['menunggu_finance'],
	kasir_reject: ['menunggu_kasir'],
	kasir_revisi: ['menunggu_kasir'],
	cancel: ['draft', 'revisi', 'menunggu_atasan', 'menunggu_finance', 'menunggu_kasir']
};

describe('kontrak TRANSITION_GUARD', () => {
	for (const [action, allowed] of Object.entries(EXPECT)) {
		it(`${action}: hanya dari [${allowed.join(', ')}]`, () => {
			for (const status of ALL) {
				expect(guardAllows(action, { status, processing_lock: null, journal_entry_id: null }, NOW), `${action} dari ${status}`).toBe(
					allowed.includes(status)
				);
			}
		});
	}

	it('lpj_submit: hanya posted + advance + settlement null/menunggu_lpj/revisi', () => {
		const ok = (o: Record<string, any>) =>
			guardAllows('lpj_submit', { status: 'posted', mode: 'advance', advance_settlement_status: null, ...o }, NOW);
		expect(ok({})).toBe(true);
		expect(ok({ advance_settlement_status: 'menunggu_lpj' })).toBe(true);
		expect(ok({ advance_settlement_status: 'revisi' })).toBe(true);
		expect(ok({ advance_settlement_status: 'lpj_diajukan' })).toBe(false);
		expect(ok({ advance_settlement_status: 'selesai' })).toBe(false);
		expect(ok({ mode: 'reimburse' })).toBe(false);
		expect(ok({ status: 'menunggu_kasir' })).toBe(false);
	});

	it('cancel / kasir_reject / kasir_revisi ditolak bila journal_entry_id terisi', () => {
		for (const a of ['cancel', 'kasir_reject', 'kasir_revisi']) {
			expect(guardAllows(a, { status: 'menunggu_kasir', journal_entry_id: 7 }, NOW)).toBe(false);
		}
	});

	it('kunci proses aktif memblokir cancel/submit/edit/kasir_*; kunci basi tidak', () => {
		const active = { status: 'menunggu_kasir', processing_lock: 'x', processing_lock_until: '2026-09-29T05:03:00.000Z' };
		const stale = { ...active, processing_lock_until: '2026-09-29T04:00:00.000Z' };
		for (const a of ['cancel', 'kasir_reject', 'kasir_revisi']) {
			expect(guardAllows(a, active, NOW)).toBe(false);
			expect(guardAllows(a, stale, NOW)).toBe(true);
		}
		expect(guardAllows('submit', { ...active, status: 'draft' }, NOW)).toBe(false);
		expect(guardAllows('edit', { ...active, status: 'revisi' }, NOW)).toBe(false);
	});

	it('aksi tanpa guard (kasir_approve, lpj_verify, tak dikenal) → null / tidak diizinkan', () => {
		expect(transitionGuard('kasir_approve')).toBeNull();
		expect(transitionGuard('lpj_verify')).toBeNull();
		expect(guardAllows('ngawur', { status: 'draft' })).toBe(false);
	});

	it('matchesFilter menolak operator tak dikenal', () => {
		expect(() => matchesFilter({ a: 1 }, { a: { _gt: 0 } })).toThrow();
	});

	it('pesan 409 ramah per peran', () => {
		expect(conflictMessage('cancel')).toMatch(/kasir/);
		expect(conflictMessage('atasan_approve')).toMatch(/tidak perlu tindakan/);
		expect(conflictMessage('edit')).toMatch(/Muat ulang/);
	});
});

describe('siklus LPJ dengan pengembalian (PC3-13, kontrak identik dengan admin)', () => {
	const base = { status: 'posted', mode: 'advance', processing_lock: null, journal_entry_id: 1 };
	it('lpj_diajukan → lpj_reject → revisi → lpj_submit → lpj_diajukan', () => {
		let row: Record<string, any> = { ...base, advance_settlement_status: 'lpj_diajukan' };
		expect(guardAllows('lpj_reject', row, NOW)).toBe(true);
		row = { ...row, advance_settlement_status: 'revisi' };
		expect(guardAllows('lpj_submit', row, NOW)).toBe(true);
		row = { ...row, advance_settlement_status: 'lpj_diajukan' };
		expect(guardAllows('lpj_reject', row, NOW)).toBe(true);
	});
	it('lpj_reject hanya dari lpj_diajukan', () => {
		for (const st of ['menunggu_lpj', 'revisi', 'selesai', 'lpj_diverifikasi', null]) {
			expect(guardAllows('lpj_reject', { ...base, advance_settlement_status: st }, NOW), String(st)).toBe(false);
		}
	});
	it('lpj_reject hanya untuk tiket posted; kunci proses aktif memblokir', () => {
		expect(guardAllows('lpj_reject', { ...base, status: 'menunggu_kasir', advance_settlement_status: 'lpj_diajukan' }, NOW)).toBe(false);
		expect(
			guardAllows('lpj_reject', { ...base, advance_settlement_status: 'lpj_diajukan', processing_lock: 'lpj:1', processing_lock_until: '2026-09-29T05:03:00.000Z' }, NOW)
		).toBe(false);
	});
});
