import { describe, it, expect } from 'vitest';
import { computeQuota, buildPreMobChecklist, buildPersonDocMatrix } from './planningMonitor';

describe('computeQuota', () => {
	it('status per baris & total', () => {
		const r = computeQuota([
			{ id: 1, material_name: 'A', qty: 10, qty_sudah_dikirim: 0 },
			{ id: 2, material_name: 'B', qty: 10, qty_sudah_dikirim: 4, source_planning_ref: 'charter:1:spec:1' },
			{ id: 3, material_name: 'C', qty: 10, qty_sudah_dikirim: 10 },
			{ id: 4, material_name: 'D', qty: 10, qty_sudah_dikirim: 12 },
			{ id: 5, material_name: 'tanpa qty', qty: 0 },
			{ id: 6, is_category_header: true, qty: 5 }
		]);
		const by = Object.fromEntries(r.rows.map((x) => [x.id, x]));
		expect(by[1].status).toBe('belum');
		expect(by[2]).toMatchObject({ status: 'sebagian', pct: 40, remaining: 6, fromPlanning: true });
		expect(by[3].status).toBe('habis');
		expect(by[4]).toMatchObject({ status: 'lebih', remaining: 0 });
		expect(r.rows).toHaveLength(4);
		expect(r.over).toBe(1);
		expect(r.rows[0].id).toBe(4); // yang melebihi kuota di paling atas
		expect(r.totalPct).toBe(60); // (0+4+10+10)/40
	});
	it('null-safe', () => {
		expect(computeQuota(null)).toEqual({ rows: [], totalPct: 0, over: 0 });
		expect(computeQuota([{ id: 1, qty: 'abc' }]).rows).toEqual([]);
	});
});

describe('buildPreMobChecklist', () => {
	it('hanya syarat yang dipersyaratkan; APD dari baris safety', () => {
		const c = buildPreMobChecklist(
			{ syarat_mcu: true, syarat_skck: false, ijin_barang_masuk: 'ADA', alat_loading_unloading: 'TIDAK ADA' },
			[{ budget_category: 'safety', identitas_barang_id: 3 }, { budget_category: 'safety' }, { budget_category: 'supplier' }]
		);
		expect(c.items.map((i) => i.key)).toEqual(['mcu', 'izin']);
		expect(c.apd).toEqual({ total: 2, linked: 1 });
	});
	it('tanpa charter -> kosong', () => {
		expect(buildPreMobChecklist(null, null)).toEqual({ items: [], apd: { total: 0, linked: 0 } });
	});
});

describe('buildPersonDocMatrix', () => {
	const today = new Date('2026-10-12');
	it('status terbaik per jenis; kedaluwarsa & ditolak terbaca; complete hanya bila semua terverifikasi', () => {
		const m = buildPersonDocMatrix(
			['mcu', 'skck', 'sertifikat'],
			[{ manpower_id: 1, nama: 'A', jabatan: 'Blaster' }, { manpower_id: 2, nama: 'B' }, { manpower_id: 1, nama: 'dobel' }],
			[
				{ manpower_id: 1, jenis_dokumen: 'mcu', status_verifikasi: 'terverifikasi', tanggal_kedaluwarsa: '2027-01-01' },
				{ manpower_id: 1, jenis_dokumen: 'skck', status_verifikasi: 'ditolak' },
				{ manpower_id: 1, jenis_dokumen: 'skck', status_verifikasi: 'menunggu' },
				{ manpower_id: 1, jenis_dokumen: 'sertifikat_k3', status_verifikasi: 'terverifikasi', tanggal_kedaluwarsa: '2026-01-01' },
				{ manpower_id: 2, jenis_dokumen: 'mcu', status_verifikasi: 'terverifikasi' }
			],
			today
		);
		expect(m.rows).toHaveLength(2);
		expect(m.rows[0].cells).toEqual({ mcu: 'terverifikasi', skck: 'menunggu', sertifikat: 'kedaluwarsa' });
		expect(m.rows[1].cells).toEqual({ mcu: 'terverifikasi', skck: 'belum', sertifikat: 'belum' });
		expect(m.completeCount).toBe(0);
		expect(buildPersonDocMatrix(['mcu'], [{ manpower_id: 2 }], [{ manpower_id: 2, jenis_dokumen: 'mcu', status_verifikasi: 'terverifikasi' }], today).completeCount).toBe(1);
	});
	it('null-safe; kunci tak dikenal diabaikan', () => {
		expect(buildPersonDocMatrix(['izin'], null, null)).toEqual({ rows: [], completeCount: 0 });
		expect(buildPersonDocMatrix(['izin'], [{ manpower_id: 1 }], [])).toMatchObject({ rows: [{ id: 1, cells: {}, complete: true }] });
	});
});
