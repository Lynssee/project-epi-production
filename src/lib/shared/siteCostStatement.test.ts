import { describe, it, expect } from 'vitest';
import { buildSiteCostStatement, costLevel } from './siteCostStatement';

const cats = [
	{ id: 'operasional', label: 'Operasional' },
	{ id: 'supplier', label: 'Material' },
	{ id: 'safety', label: 'Safety' }
];
const comparison = {
	categories: { operasional: { rab: 1000, actual: 950 }, supplier: { rab: 2000, actual: 500 } },
	grand_rab: 3000,
	grand_actual: 1450
};

describe('siteCostStatement', () => {
	it('costLevel memakai ambang serapan', () => {
		expect(costLevel(100, 50)).toBe('aman');
		expect(costLevel(100, 70)).toBe('waspada');
		expect(costLevel(100, 95)).toBe('peringatan');
		expect(costLevel(100, 101)).toBe('lebih');
		expect(costLevel(0, 10)).toBe('tanpa_pagu');
		expect(costLevel(0, 0)).toBe('aman');
	});

	it('baris kategori, total, dan kategori kosong disembunyikan', () => {
		const s = buildSiteCostStatement({ comparison, categories: cats });
		expect(s.rows.map((r) => r.id)).toEqual(['operasional', 'supplier']);
		expect(s.rows[0]).toMatchObject({ sisa: 50, serapanPct: 95, level: 'peringatan' });
		expect(s.total).toMatchObject({ rap: 3000, actual: 1450, sisa: 1550 });
	});

	it('komitmen: menunggu, disetujui, sebagian, ditolak diabaikan', () => {
		const s = buildSiteCostStatement({
			comparison,
			categories: cats,
			pas: [
				{ status: 'Pending', total_amount: 100 },
				{ status: 'Approved', total_amount: 200 },
				{ status: 'Partial', total_amount: 300, paid_amount_total: 100 },
				{ status: 'Rejected', total_amount: 999 },
				{ status: 'Dibukukan', total_amount: 777, status_pertanggungjawaban: 'belum', nomor_pengajuan: 'PA-1' }
			],
			procurement: [{ status: 'Approved', total_amount: 400, received_amount: 150 }, { status: 'Ditolak', total_amount: 50, received_amount: 0 }]
		});
		expect(s.komitmen.menunggu).toEqual({ count: 1, amount: 100 });
		expect(s.komitmen.disetujuiBelumCair.amount).toBe(200);
		expect(s.komitmen.sebagian.amount).toBe(200);
		expect(s.komitmen.prBelumDiterima).toEqual({ count: 1, amount: 250 });
		expect(s.komitmen.total).toBe(750);
		expect(s.sisaJatahAman).toBe(3000 - 1450 - 750);
		expect(s.lpj).toMatchObject({ count: 1, amount: 777 });
	});

	it('LPJ null tidak dihitung, data kosong tidak crash', () => {
		const s = buildSiteCostStatement({ comparison: null, categories: cats, pas: [{ status: 'Dibukukan', total_amount: 5, status_pertanggungjawaban: null }] });
		expect(s.lpj.count).toBe(0);
		expect(s.rows).toEqual([]);
		expect(s.total.rap).toBe(0);
	});

	it('LPJ: menunggu verifikasi dan celah pelacakan (hanya operasional yang sudah cair)', () => {
		const s = buildSiteCostStatement({
			comparison,
			categories: cats,
			pas: [
				{ status: 'Dibukukan', kategori: 'operasional', total_amount: 100, status_pertanggungjawaban: null },
				{ status: 'Completed', kategori: 'operasional', total_amount: 50, status_pertanggungjawaban: '' },
				{ status: 'Dibukukan', kategori: 'jasa', total_amount: 999, status_pertanggungjawaban: null },
				{ status: 'Pending', kategori: 'operasional', total_amount: 777, status_pertanggungjawaban: null },
				{ status: 'Approved', kategori: 'operasional', total_amount: 555, status_pertanggungjawaban: null },
				{ status: 'Dibukukan', kategori: 'operasional', total_amount: 30, status_pertanggungjawaban: 'menunggu_verifikasi' },
				{ status: 'Dibukukan', kategori: 'operasional', total_amount: 20, status_pertanggungjawaban: 'tidak_perlu' }
			]
		});
		expect(s.lpj.tidakTerlacak).toEqual({ count: 2, amount: 150 });
		expect(s.lpj.menungguVerifikasi).toEqual({ count: 1, amount: 30 });
		expect(s.lpj.count).toBe(0);
	});

	it('ambang undefined dari setelan tidak menimpa default', () => {
		const s = buildSiteCostStatement({ comparison, categories: cats, thresholds: { watch: undefined, warning: undefined, critical: undefined } });
		expect(s.rows[0].level).toBe('peringatan');
	});

	it('tidak membocorkan field komersial', () => {
		const s = JSON.stringify(buildSiteCostStatement({ comparison, categories: cats }));
		expect(s).not.toMatch(/margin|laba|revenue|pendapatan|nilai_po|subtotal/i);
	});
});
