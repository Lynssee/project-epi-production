import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	isValidYmd, rangeForPreset, validateRange, daysBetween, aggregateRekap, buildRekapPrintHtml,
	printRekapNotaLapangan, MAX_RANGE_DAYS, type RekapRow
} from './rekapNotaLapangan';

const row = (id: number, extra: Partial<RekapRow> = {}): RekapRow => ({
	id, waktu: '2026-10-15T03:00:00.000Z', jenis: 'bbm', nominal: 100000, mode: 'talangan', has_struk: true, ...extra
});

describe('tanggal & rentang', () => {
	it('isValidYmd menolak format salah dan tanggal fiktif', () => {
		expect(isValidYmd('2026-10-20')).toBe(true);
		expect(isValidYmd('2026-02-30')).toBe(false);
		expect(isValidYmd('20-10-2026')).toBe(false);
		expect(isValidYmd(null)).toBe(false);
	});
	it('preset: hari ini, 7 hari, bulan ini, bulan lalu (termasuk batas tahun)', () => {
		expect(rangeForPreset('hari-ini', '2026-10-20')).toEqual({ dari: '2026-10-20', sampai: '2026-10-20' });
		expect(rangeForPreset('7-hari', '2026-10-20')).toEqual({ dari: '2026-10-14', sampai: '2026-10-20' });
		expect(rangeForPreset('bulan-ini', '2026-10-20')).toEqual({ dari: '2026-10-01', sampai: '2026-10-20' });
		expect(rangeForPreset('bulan-lalu', '2026-10-20')).toEqual({ dari: '2026-09-01', sampai: '2026-09-30' });
		expect(rangeForPreset('bulan-lalu', '2026-01-05')).toEqual({ dari: '2025-12-01', sampai: '2025-12-31' });
		expect(rangeForPreset('7-hari', '2026-03-03')).toEqual({ dari: '2026-02-25', sampai: '2026-03-03' });
	});
	it('validateRange: urutan, format, dan batas hari', () => {
		expect(validateRange('2026-10-01', '2026-10-20')).toEqual({ ok: true });
		expect(validateRange('2026-10-20', '2026-10-01')).toMatchObject({ ok: false });
		expect(validateRange('x', '2026-10-01')).toMatchObject({ ok: false });
		expect(validateRange('2026-01-01', '2026-12-31')).toMatchObject({ ok: false, reason: expect.stringContaining(String(MAX_RANGE_DAYS)) });
		expect(daysBetween('2026-10-01', '2026-10-01')).toBe(1);
	});
});

describe('aggregateRekap', () => {
	it('total, per jenis (terbesar dulu), per mode, tanpa struk, menunggu approval', () => {
		const r = aggregateRekap([
			row(1, { jenis: 'bbm', nominal: 300000 }),
			row(2, { jenis: 'tol', nominal: 50000, mode: 'proyek', has_struk: false, approval_status: 'menunggu' }),
			row(3, { jenis: 'bbm', nominal: 200000 })
		]);
		expect(r.total).toBe(550000);
		expect(r.count).toBe(3);
		expect(r.perJenis.map((j) => [j.jenis, j.total, j.count])).toEqual([['bbm', 500000, 2], ['tol', 50000, 1]]);
		expect(r.perMode.map((m) => m.mode).sort()).toEqual(['proyek', 'talangan']);
		expect(r.tanpaStruk).toBe(1);
		expect(r.menunggu).toBe(1);
	});
	it('null/kosong/nominal rusak aman', () => {
		expect(aggregateRekap(null).total).toBe(0);
		expect(aggregateRekap([row(1, { nominal: NaN as any })]).total).toBe(0);
		expect(aggregateRekap([]).perJenis).toEqual([]);
	});
});

describe('buildRekapPrintHtml', () => {
	it('memuat judul, nama, total, baris, dan peringatan nota tanpa struk', () => {
		const html = buildRekapPrintHtml({
			nama: 'Budi', dari: '2026-10-01', sampai: '2026-10-20', now: new Date('2026-10-20T03:00:00Z'),
			rows: [row(1, { catatan: 'Isi solar', project_name: 'Tangki A' }), row(2, { has_struk: false, jenis: 'tol', nominal: 25000 })]
		});
		expect(html).toContain('REKAP NOTA LAPANGAN');
		expect(html).toContain('Budi');
		expect(html).toContain('Rp 125.000');
		expect(html).toContain('Tangki A');
		expect(html).toContain('1 nota belum ada foto struk');
		expect(html).toContain('2 nota');
	});
	it('di-escape; kosong menampilkan pesan', () => {
		const html = buildRekapPrintHtml({ nama: '<b>x</b>', dari: '2026-10-01', sampai: '2026-10-02', rows: [row(1, { catatan: '<script>1</script>' })] });
		expect(html).not.toContain('<script>1');
		expect(html).toContain('&lt;b&gt;x');
		expect(buildRekapPrintHtml({ nama: 'A', dari: '2026-10-01', sampai: '2026-10-02', rows: [] })).toContain('Tidak ada nota pada periode ini.');
	});
});

describe('printRekapNotaLapangan', () => {
	afterEach(() => { vi.useRealTimers(); delete (globalThis as any).window; });
	it('membuka satu jendela sinkron, menulis, lalu print; diblokir -> false', () => {
		vi.useFakeTimers();
		const win = { document: { write: vi.fn(), close: vi.fn() }, focus: vi.fn(), print: vi.fn() };
		(globalThis as any).window = { open: vi.fn(() => win) };
		expect(printRekapNotaLapangan({ nama: 'A', dari: '2026-10-01', sampai: '2026-10-02', rows: [] })).toBe(true);
		expect(win.document.write).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(300);
		expect(win.print).toHaveBeenCalled();
		(globalThis as any).window = { open: vi.fn(() => null) };
		expect(printRekapNotaLapangan({ nama: 'A', dari: '2026-10-01', sampai: '2026-10-02', rows: [] })).toBe(false);
	});
});
