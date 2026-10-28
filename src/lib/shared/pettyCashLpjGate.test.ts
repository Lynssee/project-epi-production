// PC3-16 — kontrak evaluateEmployeeLpj: tabel harapan IDENTIK dengan erp-epi src/lib/server/pettyCashLpjGate.test.js
import { describe, it, expect } from 'vitest';
import { evaluateEmployeeLpj, type LpjTicket } from './pettyCashLpjGate';

const NOW = new Date('2026-09-29T05:00:00Z');
const ago = (d: number) => new Date(NOW.getTime() - d * 86400000).toISOString();
const adv = (o: Partial<LpjTicket> = {}): LpjTicket => ({
	request_number: 'PCR-1',
	mode: 'advance',
	status: 'posted',
	advance_settlement_status: 'menunggu_lpj',
	posted_at: ago(10),
	approved_amount: 800000,
	...o
});

describe('evaluateEmployeeLpj (kontrak)', () => {
	it('pemohon tanpa tunggakan → lolos', () => {
		expect(evaluateEmployeeLpj({ tickets: [], batasHari: 7, now: NOW })).toEqual({ overdue: [], message: null });
		expect(evaluateEmployeeLpj({ tickets: [adv({ posted_at: ago(5) })], batasHari: 7, now: NOW }).overdue).toEqual([]);
	});
	it('tunggakan lewat batas → pelanggaran dengan nomor, nominal, telat hari', () => {
		const r = evaluateEmployeeLpj({ tickets: [adv()], batasHari: 7, now: NOW });
		expect(r.overdue).toEqual([{ request_number: 'PCR-1', amount: 800000, lateDays: 3 }]);
		expect(r.message).toMatch(/PCR-1 \(Rp 800\.000, telat 3 hari\).*Reimburse.*tetap bisa/);
	});
	it('tunggakan SEBELUM enforce_from tidak dihitung; sesudah → dihitung', () => {
		const old = adv({ posted_at: ago(20) });
		expect(evaluateEmployeeLpj({ tickets: [old], batasHari: 7, enforceFrom: '2026-09-15', now: NOW }).overdue).toEqual([]);
		expect(evaluateEmployeeLpj({ tickets: [old], batasHari: 7, enforceFrom: '2026-09-01', now: NOW }).overdue).toHaveLength(1);
		expect(evaluateEmployeeLpj({ tickets: [old], batasHari: 7, enforceFrom: null, now: NOW }).overdue).toHaveLength(1);
	});
	it('revisi & tanpa status settlement ikut menunggak; diajukan/selesai tidak', () => {
		const mk = (st: string | null) => evaluateEmployeeLpj({ tickets: [adv({ advance_settlement_status: st })], batasHari: 7, now: NOW }).overdue.length;
		expect(mk('revisi')).toBe(1);
		expect(mk(null)).toBe(1);
		expect(mk('menunggu_lpj')).toBe(1);
		expect(mk('lpj_diajukan')).toBe(0);
		expect(mk('selesai')).toBe(0);
	});
	it('reimburse / bukan posted tidak pernah dihitung', () => {
		expect(evaluateEmployeeLpj({ tickets: [adv({ mode: 'reimburse' })], batasHari: 7, now: NOW }).overdue).toEqual([]);
		expect(evaluateEmployeeLpj({ tickets: [adv({ status: 'menunggu_kasir' })], batasHari: 7, now: NOW }).overdue).toEqual([]);
		expect(evaluateEmployeeLpj({ tickets: [adv({ posted_at: null })], batasHari: 7, now: NOW }).overdue).toEqual([]);
	});
	it('batas hari tak valid → default 7; urut paling telat dulu, pesan maks 3', () => {
		const t = [1, 2, 3, 4].map((i) => adv({ request_number: `PCR-${i}`, posted_at: ago(7 + i * 2) }));
		const r = evaluateEmployeeLpj({ tickets: t, batasHari: null, now: NOW });
		expect(r.overdue[0].request_number).toBe('PCR-4');
		expect((r.message!.match(/PCR-/g) || []).length).toBe(3);
	});
});
