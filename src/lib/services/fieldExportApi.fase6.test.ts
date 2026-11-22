import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/services/projectStockInventoryApi', () => ({ getProjectInventory: vi.fn(), getProjectInventoryLogs: vi.fn() }));
vi.mock('$lib/services/wbsApi', () => ({ fetchWbsTree: vi.fn() }));
vi.mock('$lib/services/reports', () => ({ getReports: vi.fn() }));
vi.mock('$lib/services/manpowerAbsensi', () => ({ getAbsensiForProjectsInRange: vi.fn() }));
vi.mock('$lib/services/packingList', () => ({ getPackingRequests: vi.fn() }));
vi.mock('$lib/services/projectPunchListApi', () => ({ fetchProjectPunchList: vi.fn() }));

const { mingguMulai, rekapMingguan, ringkasStatusProyek, flattenStatusProyekForField } = await import('./fieldExportApi');
const { FIELD_EXPORT_SECTIONS, FIELD_EXPORT_SECTION_KEYS } = await import('$lib/config/fieldExportRegistry');
const wbs = await import('$lib/services/wbsApi');
const reports = await import('$lib/services/reports');
const punch = await import('$lib/services/projectPunchListApi');

describe('mingguMulai', () => {
	it('Senin dari tanggal mana pun di minggu itu', () => {
		expect(mingguMulai('2026-11-17')).toBe('2026-11-16'); // Selasa
		expect(mingguMulai('2026-11-22')).toBe('2026-11-16'); // Minggu
		expect(mingguMulai('2026-11-16')).toBe('2026-11-16');
		expect(mingguMulai('bukan tanggal')).toBe('');
	});
});

describe('rekapMingguan', () => {
	const rows = [
		{ tanggal: '2026-11-16', jumlah_pekerja: 10, progress: 40, kendala: '' },
		{ tanggal: '2026-11-18', jumlah_pekerja: 20, progress: 45, kendala: 'Hujan deras' },
		{ tanggal: '2026-11-10', jumlah_pekerja: 8, progress: 30, kendala: 'Material telat' },
		{ tanggal: 'rusak', progress: 99 }
	];
	const r = rekapMingguan(rows);
	it('dikelompokkan per Senin, terbaru di atas, baris tanpa tanggal valid dibuang', () => {
		expect(r.map((x) => x.minggu_mulai)).toEqual(['2026-11-16', '2026-11-09']);
	});
	it('agregat: jumlah, rata-rata pekerja, progress laporan terakhir, hari kendala', () => {
		expect(r[0]).toMatchObject({ jumlah_laporan: 2, rata_pekerja: 15, progress_akhir: 45, hari_ada_kendala: 1, kendala_utama: 'Hujan deras' });
	});
	it('input kosong/bukan array aman (Aturan #7)', () => {
		expect(rekapMingguan([])).toEqual([]);
		expect(rekapMingguan(null as any)).toEqual([]);
	});
});

describe('ringkasStatusProyek', () => {
	const timeline = [
		{ level: 1, weight_pct: 60, completion_pct: 50, status: 'on progress' },
		{ level: 1, weight_pct: 40, completion_pct: 100, status: 'selesai' },
		{ level: 2, weight_pct: 10, completion_pct: 100, status: 'selesai' }
	];
	const out = ringkasStatusProyek({
		timeline,
		laporan: [{ tanggal: '2026-11-10', kendala: 'x' }, { tanggal: '2026-11-17', kendala: '' }],
		punch: [{ status: 'open', severity: 'critical' }, { status: 'closed', severity: 'major' }, { status: 'open', severity: 'minor' }]
	});
	const get = (k: string) => out.find((o) => o.indikator === k) as Record<string, string>;
	it('progress berbobot level 1', () => {
		expect(get('Progress keseluruhan (%)').nilai).toBe('70');
	});
	it('pekerjaan selesai, laporan terakhir, punch list terbuka & berat', () => {
		expect(get('Pekerjaan selesai').nilai).toBe('2 dari 3');
		expect(get('Laporan harian')).toMatchObject({ nilai: '2', keterangan: 'Terakhir 2026-11-17' });
		expect(get('Laporan dengan kendala').nilai).toBe('1');
		expect(get('Punch list terbuka').nilai).toBe('2 dari 3');
		expect(get('Punch list berat terbuka').nilai).toBe('1');
	});
	it('semua kosong -> n/a, tidak crash', () => {
		const e = ringkasStatusProyek({ timeline: [], laporan: [], punch: [] });
		expect(e[0].nilai).toBe('n/a');
	});
});

describe('flattenStatusProyekForField', () => {
	it('satu sumber gagal -> tetap jadi, ada catatan peringatan', async () => {
		(wbs.fetchWbsTree as any).mockResolvedValue({ flat: [{ level: 1, weight_pct: 100, completion_pct: 50 }] });
		(reports.getReports as any).mockResolvedValue([]);
		(punch.fetchProjectPunchList as any).mockRejectedValue(new Error('boom'));
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const rows = await flattenStatusProyekForField(1);
		spy.mockRestore();
		expect(rows.at(-1)?.indikator).toBe('Catatan');
	});
	it('semua sumber gagal -> melempar (bukan laporan kosong palsu)', async () => {
		(wbs.fetchWbsTree as any).mockRejectedValue(new Error('a'));
		(reports.getReports as any).mockRejectedValue(new Error('b'));
		(punch.fetchProjectPunchList as any).mockRejectedValue(new Error('c'));
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(flattenStatusProyekForField(1)).rejects.toThrow();
		spy.mockRestore();
	});
});

describe('daftar putih lapangan — tanpa data uang (§5.4 P2)', () => {
	it('section baru terdaftar dan mendukung PDF', () => {
		expect(FIELD_EXPORT_SECTION_KEYS).toEqual(expect.arrayContaining(['status-proyek', 'laporan-mingguan']));
		for (const k of ['status-proyek', 'laporan-mingguan']) expect(FIELD_EXPORT_SECTIONS[k].formats).toContain('pdf');
	});
	it('tidak ada kolom/key bernuansa uang di seluruh daftar putih', () => {
		const re = /harga|price|nilai_kontrak|margin|hpp|upah|gaji|payroll|rate_harian|termin|amount/i;
		for (const s of Object.values(FIELD_EXPORT_SECTIONS)) for (const c of s.columns) {
			expect(re.test(c.key) || re.test(c.header), `${s.key}.${c.key}`).toBe(false);
		}
	});
});
