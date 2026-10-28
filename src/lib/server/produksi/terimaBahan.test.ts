import { describe, it, expect } from 'vitest';
import { planReceipt, planReturn, sanitizeReturnRows } from './terimaBahan';

const NOW = '2026-10-12T10:00:00.000Z';
const spk = (o: Record<string, unknown> = {}) => ({ id: 1, status: 'worksheet_generated', material_pick_status: 'ready', ...o });

describe('planReceipt', () => {
	it('mencatat penerima dari akun sendiri', () => {
		const r = planReceipt(spk(), { karyawanId: 7, karyawanNama: 'Budi', note: ' timbangan -0.2kg ', now: NOW });
		expect(r.ok && r.patch).toMatchObject({
			material_pick_status: 'handed_over',
			material_received_by: 'Budi',
			material_received_karyawan_id: 7,
			material_receipt_note: 'timbangan -0.2kg',
			material_handover_at: NOW,
			material_ready_at: NOW
		});
	});

	it('tetap boleh terima walau gudang belum menandai siap serah (longgar)', () => {
		const r = planReceipt(spk({ material_pick_status: null }), { karyawanId: 7, karyawanNama: 'Budi' });
		expect(r.ok).toBe(true);
	});

	it('tidak menimpa material_ready_at yang sudah ada', () => {
		const r = planReceipt(spk({ material_ready_at: '2026-10-11T00:00:00Z' }), { karyawanId: 7, karyawanNama: 'Budi', now: NOW });
		expect(r.ok && 'material_ready_at' in r.patch).toBe(false);
	});

	it('idempoten untuk orang yang sama, ditolak untuk orang lain', () => {
		const done = spk({ material_pick_status: 'handed_over', material_received_karyawan_id: 7, material_received_by: 'Budi' });
		expect(planReceipt(done, { karyawanId: 7, karyawanNama: 'Budi' })).toMatchObject({ ok: true, noop: true });
		expect(planReceipt(done, { karyawanId: 8, karyawanNama: 'Ani' })).toMatchObject({ ok: false, code: 409 });
	});

	it('SPK di luar rantai ditolak', () => {
		for (const status of ['requested', 'completed', 'cancelled', 'hold']) {
			expect(planReceipt(spk({ status }), { karyawanId: 7, karyawanNama: 'Budi' })).toMatchObject({ ok: false, code: 409 });
		}
	});
});

describe('planReturn', () => {
	const rcv = (o = {}) => spk({ status: 'in_progress', material_pick_status: 'handed_over', ...o });

	it('hanya setelah bahan diterima', () => {
		expect(planReturn(spk(), { karyawanNama: 'Budi', rows: [{ qty_kg: 1 }] })).toMatchObject({ ok: false, code: 409 });
	});

	it('wajib ada baris dengan qty > 0', () => {
		expect(planReturn(rcv(), { karyawanNama: 'Budi', rows: [{ qty_kg: 0 }, { qty_kg: 'x' }] })).toMatchObject({ ok: false, code: 400 });
	});

	it('menyimpan usulan retur disanitasi', () => {
		const r = planReturn(rcv(), { karyawanNama: 'Budi', rows: [{ item_id: '5', nama: ' Xylene ', qty_kg: '12.3456' }], now: NOW });
		expect(r.ok && r.patch).toMatchObject({
			material_return_status: 'diajukan',
			material_return_at: NOW,
			material_return_by: 'Budi',
			material_return_data: [{ item_id: 5, nama: 'Xylene', qty_kg: 12.346, note: '' }]
		});
	});

	it('ditolak bila gudang sudah menerima retur', () => {
		expect(planReturn(rcv({ material_return_status: 'diterima_gudang' }), { karyawanNama: 'B', rows: [{ qty_kg: 1 }] })).toMatchObject({ ok: false, code: 409 });
	});

	it('sanitizeReturnRows: bukan array -> []', () => {
		expect(sanitizeReturnRows(null)).toEqual([]);
	});
});

import { netConsumedByItem } from './terimaBahan';

describe('retur dengan ledger SPK', () => {
	const rcv = (o = {}) => spk({ status: 'in_progress', material_pick_status: 'handed_over', ...o });
	const consumed = netConsumedByItem([
		{ item_id: 1, transaction_type: 'OUT', quantity: 20 },
		{ item_id: 1, transaction_type: 'IN', quantity: 5 },
		{ item_id: { id: 2 }, transaction_type: 'OUT', quantity: 3 }
	]);

	it('netConsumedByItem: OUT dikurangi IN, objek item didukung', () => {
		expect(consumed).toEqual({ 1: 15, 2: 3 });
	});

	it('menolak baris tanpa item, bahan tak terpotong, atau melebihi sisa', () => {
		expect(planReturn(rcv(), { karyawanNama: 'B', rows: [{ nama: 'bebas', qty_kg: 1 }], consumed })).toMatchObject({ ok: false, code: 400 });
		expect(planReturn(rcv(), { karyawanNama: 'B', rows: [{ item_id: 9, qty_kg: 1 }], consumed })).toMatchObject({ ok: false, code: 409 });
		expect(planReturn(rcv(), { karyawanNama: 'B', rows: [{ item_id: 2, qty_kg: 4 }], consumed })).toMatchObject({ ok: false, code: 409 });
	});

	it('menerima baris valid; usulan yang ditolak gudang boleh diajukan ulang', () => {
		expect(planReturn(rcv(), { karyawanNama: 'B', rows: [{ item_id: 1, qty_kg: 15 }], consumed })).toMatchObject({ ok: true });
		expect(planReturn(rcv({ material_return_status: 'ditolak' }), { karyawanNama: 'B', rows: [{ item_id: 1, qty_kg: 1 }], consumed })).toMatchObject({ ok: true });
	});
});
