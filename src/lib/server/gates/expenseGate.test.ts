// src/lib/server/gates/expenseGate.test.ts
// Unit test komprehensif untuk validator gate biaya lapangan (G_BUKTI_BBM, G_BUKTI_STRUK, G_EXPENSE_BUDGET_PLAFON, failedHardGates)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	checkBuktiBbmGate,
	checkBuktiStrukGate,
	checkExpenseBudgetPlafonGate,
	failedHardGates,
	type GateResult
} from './expenseGate';

vi.mock('$lib/server/directus', () => ({
	directusServerJson: vi.fn()
}));

vi.mock('$lib/server/gateEnforcement', () => ({
	getFieldGateMode: vi.fn().mockResolvedValue('shadow')
}));

import { directusServerJson } from '$lib/server/directus';

describe('expenseGate — bukti struk & BBM', () => {
	it('checkBuktiStrukGate: jenis "lain" adalah not_applicable', () => {
		const res = checkBuktiStrukGate('lain', null);
		expect(res.status).toBe('not_applicable');
		expect(res.key).toBe('G_BUKTI_STRUK');
	});

	it('checkBuktiStrukGate: BBM tanpa foto struk -> failed', () => {
		const res = checkBuktiStrukGate('bbm', null);
		expect(res.status).toBe('failed');
		expect(res.message).toContain('belum dilampirkan');
	});

	it('checkBuktiStrukGate: BBM dengan foto struk -> passed', () => {
		const res = checkBuktiStrukGate('bbm', 'file-123');
		expect(res.status).toBe('passed');
	});

	it('checkBuktiBbmGate: jenis bukan BBM -> not_applicable', () => {
		const res = checkBuktiBbmGate('tol', 'file-1', 1000, 'file-2');
		expect(res.status).toBe('not_applicable');
	});

	it('checkBuktiBbmGate: BBM tidak lengkap odometer/foto -> failed', () => {
		const res = checkBuktiBbmGate('bbm', 'file-1', null, null);
		expect(res.status).toBe('failed');
		expect(res.message).toContain('angka odometer');
	});

	it('checkBuktiBbmGate: BBM lengkap struk + odometer + foto -> passed', () => {
		const res = checkBuktiBbmGate('bbm', 'file-1', 45200, 'file-2');
		expect(res.status).toBe('passed');
	});
});

describe('checkExpenseBudgetPlafonGate — plafon RAP operasional', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('mode talangan atau tanpa projectId -> not_applicable', async () => {
		const res1 = await checkExpenseBudgetPlafonGate(null, 50000, 'proyek');
		expect(res1.status).toBe('not_applicable');

		const res2 = await checkExpenseBudgetPlafonGate(10, 50000, 'talangan');
		expect(res2.status).toBe('not_applicable');
	});

	it('mode proyek: belum ada alokasi RAP operasional -> failed', async () => {
		vi.mocked(directusServerJson).mockResolvedValueOnce({ data: [] }); // budgets kosong
		const res = await checkExpenseBudgetPlafonGate(10, 100000, 'proyek');
		expect(res.status).toBe('failed');
		expect(res.message).toContain('belum memiliki alokasi anggaran RAP operasional');
	});

	it('mode proyek: nominal melebihi sisa plafon -> failed', async () => {
		// Budget: total 1.000.000
		vi.mocked(directusServerJson).mockResolvedValueOnce({
			data: [{ id: 1, planned_amount: 1000000 }]
		});
		// Actual: 800.000 (sisa: 200.000)
		vi.mocked(directusServerJson).mockResolvedValueOnce({
			data: [{ id: 10, nominal: 800000 }]
		});

		// Pengeluaran baru 300.000 (> 200.000)
		const res = await checkExpenseBudgetPlafonGate(10, 300000, 'proyek');
		expect(res.status).toBe('failed');
		expect(res.message).toContain('melampaui sisa plafon RAP operasional');
	});

	it('mode proyek: nominal dalam sisa plafon -> passed', async () => {
		// Budget: total 2.000.000
		vi.mocked(directusServerJson).mockResolvedValueOnce({
			data: [{ id: 1, planned_amount: 2000000 }]
		});
		// Actual: 500.000 (sisa: 1.500.000)
		vi.mocked(directusServerJson).mockResolvedValueOnce({
			data: [{ id: 10, nominal: 500000 }]
		});

		// Pengeluaran baru 200.000 (<= 1.500.000)
		const res = await checkExpenseBudgetPlafonGate(10, 200000, 'proyek');
		expect(res.status).toBe('passed');
		expect(res.message).toContain('Sisa plafon RAP operasional mencukupi');
	});
});

describe('failedHardGates', () => {
	it('hanya mengambil gate yang status="failed" dan mode="hard"', () => {
		const gates: GateResult[] = [
			{ key: 'G1', status: 'failed', mode: 'shadow', message: 'fail shadow' },
			{ key: 'G2', status: 'failed', mode: 'hard', message: 'fail hard' },
			{ key: 'G3', status: 'passed', mode: 'hard', message: 'pass hard' }
		];
		const blocked = failedHardGates(gates);
		expect(blocked).toHaveLength(1);
		expect(blocked[0].key).toBe('G2');
	});
});
