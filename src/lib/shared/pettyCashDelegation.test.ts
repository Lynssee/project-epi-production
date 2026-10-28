// PC3-15 — pickDelegate: tabel harapan IDENTIK dengan erp-epi src/lib/server/pettyCashDelegation.test.js
import { describe, it, expect } from 'vitest';
import { pickDelegate, type DelegationRow } from './pettyCashDelegation';

const TODAY = '2026-09-29';
const d = (o: Partial<DelegationRow> = {}): DelegationRow => ({
	from_user: 10,
	to_user: 20,
	module_key: 'finance.petty_cash',
	start_date: '2026-09-28',
	end_date: '2026-10-05',
	is_active: true,
	...o
});

describe('pickDelegate (kontrak)', () => {
	it('delegasi aktif, modul cocok → penerima delegasi', () => {
		expect(pickDelegate([d()], 10, { todayIso: TODAY })).toBe(20);
	});
	it('module_key "*" (semua modul) berlaku', () => {
		expect(pickDelegate([d({ module_key: '*' })], 10, { todayIso: TODAY })).toBe(20);
	});
	it('modul lain tidak berlaku', () => {
		expect(pickDelegate([d({ module_key: 'hrd.cuti' })], 10, { todayIso: TODAY })).toBeNull();
	});
	it('kedaluwarsa / belum mulai / nonaktif → null', () => {
		expect(pickDelegate([d({ end_date: '2026-09-28' })], 10, { todayIso: TODAY })).toBeNull();
		expect(pickDelegate([d({ start_date: '2026-09-30' })], 10, { todayIso: TODAY })).toBeNull();
		expect(pickDelegate([d({ is_active: false })], 10, { todayIso: TODAY })).toBeNull();
	});
	it('batas tanggal inklusif (hari ini = start / end)', () => {
		expect(pickDelegate([d({ start_date: TODAY })], 10, { todayIso: TODAY })).toBe(20);
		expect(pickDelegate([d({ end_date: TODAY })], 10, { todayIso: TODAY })).toBe(20);
	});
	it('from_user lain tidak dipakai', () => {
		expect(pickDelegate([d({ from_user: 11 })], 10, { todayIso: TODAY })).toBeNull();
	});
	it('delegasi = pemohon dilewati → lanjut ke delegasi berikutnya', () => {
		expect(pickDelegate([d({ to_user: 5 }), d({ to_user: 30 })], 10, { requesterId: 5, todayIso: TODAY })).toBe(30);
		expect(pickDelegate([d({ to_user: 5 })], 10, { requesterId: 5, todayIso: TODAY })).toBeNull();
	});
	it('delegasi ke diri sendiri / to_user kosong diabaikan; id string vs number setara', () => {
		expect(pickDelegate([d({ to_user: 10 }), d({ to_user: null })], 10, { todayIso: TODAY })).toBeNull();
		expect(pickDelegate([d({ from_user: '10', to_user: '20' })], 10, { todayIso: TODAY })).toBe(20);
	});
	it('tanpa delegasi / karyawan kosong → null', () => {
		expect(pickDelegate([], 10, { todayIso: TODAY })).toBeNull();
		expect(pickDelegate(undefined, 10, { todayIso: TODAY })).toBeNull();
		expect(pickDelegate([d()], null, { todayIso: TODAY })).toBeNull();
	});
});
