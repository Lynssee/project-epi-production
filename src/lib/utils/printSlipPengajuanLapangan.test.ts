import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildSlipPengajuanHtml, printSlipPengajuanLapangan, QR_TIMEOUT_MS } from './printSlipPengajuanLapangan';

const pa = { id: 7, nomor_pengajuan: 'PA-2610-0007', date_created: '2026-10-15T03:00:00Z', nama_pengaju: 'Budi', department: 'Project', tujuan_pengajuan: 'Beli <solar>', status: 'Approved', total_amount: 999, jumlah_disetujui: 150000, fetched_project: { name: 'Tangki A' } };
const items = [{ deskripsi: 'Solar', quantity: 10, units: 'L', harga: 15000 }];
const steps = [{ label: 'Manager', status: 'disetujui', actor_name: 'Andi', date: '2026-10-16T03:00:00Z' }, { label: 'Finance', status: 'menunggu' }];

describe('buildSlipPengajuanHtml', () => {
	it('memuat nomor, pengaju, proyek, item, total dari item (bukan total_amount), disetujui, rantai approval, dan peringatan non-resmi', () => {
		const html = buildSlipPengajuanHtml(pa, items, steps, { now: new Date('2026-10-20T03:00:00Z') });
		expect(html).toContain('PA-2610-0007');
		expect(html).toContain('Budi');
		expect(html).toContain('Tangki A');
		expect(html).toContain('Rp 150.000');
		expect(html).not.toContain('Rp 999');
		expect(html).toContain('[v] Manager — Andi');
		expect(html).toContain('[ ] Finance — menunggu');
		expect(html).toContain('BUKAN dokumen disposisi resmi');
		expect(html).toContain('size:80mm auto');
	});
	it('teks pengguna di-escape', () => {
		const html = buildSlipPengajuanHtml(pa, items, steps);
		expect(html).toContain('Beli &lt;solar&gt;');
		expect(html).not.toContain('<solar>');
	});
	it('tanpa item memakai total_amount; null/kosong aman; QR hanya bila diberikan', () => {
		const html = buildSlipPengajuanHtml({ ...pa, jumlah_disetujui: 0 }, [], null);
		expect(html).toContain('Rp 999');
		expect(html).toContain('Rincian item tidak tercatat terstruktur');
		expect(html).not.toContain('class="qr"');
		expect(buildSlipPengajuanHtml(null, null, null)).toContain('SLIP RINGKAS');
		const withQr = buildSlipPengajuanHtml(pa, items, steps, { qrDataUrl: 'data:image/png;base64,AAA', verifyUrl: 'https://x/v?s=1' });
		expect(withQr).toContain('class="qr"');
		expect(withQr).toContain('https://x/v?s=1');
	});
	it('memotong item > 40 dengan catatan', () => {
		const many = Array.from({ length: 45 }, (_, i) => ({ deskripsi: 'I' + i, quantity: 1, harga: 1 }));
		expect(buildSlipPengajuanHtml(pa, many, steps)).toContain('+5 item lain');
	});
});

describe('printSlipPengajuanLapangan', () => {
	afterEach(() => { vi.useRealTimers(); delete (globalThis as any).window; });
	const mkWin = () => ({ document: { write: vi.fn(), close: vi.fn(), open: vi.fn() }, focus: vi.fn(), print: vi.fn() });

	it('jendela dibuka sinkron; tanpa QR langsung ditulis & print', () => {
		vi.useFakeTimers();
		const win = mkWin();
		(globalThis as any).window = { open: vi.fn(() => win) };
		expect(printSlipPengajuanLapangan(pa, items, steps)).toBe(true);
		expect((globalThis as any).window.open).toHaveBeenCalledTimes(1);
		expect(win.document.write.mock.calls.at(-1)[0]).toContain('PA-2610-0007');
		vi.advanceTimersByTime(300);
		expect(win.print).toHaveBeenCalled();
	});

	it('dengan qrProvider: jendela dibuka dulu, QR menyusul; provider gagal -> slip tetap tercetak tanpa QR', async () => {
		const win = mkWin();
		(globalThis as any).window = { open: vi.fn(() => win) };
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		printSlipPengajuanLapangan(pa, items, steps, { qrProvider: async () => ({ qrDataUrl: 'data:image/png;base64,Q', verifyUrl: 'https://v' }) });
		await new Promise((r) => setTimeout(r, 0));
		expect(win.document.write.mock.calls.at(-1)[0]).toContain('class="qr"');
		const win2 = mkWin();
		(globalThis as any).window = { open: vi.fn(() => win2) };
		printSlipPengajuanLapangan(pa, items, steps, { qrProvider: async () => { throw new Error('boom'); } });
		await new Promise((r) => setTimeout(r, 0));
		expect(win2.document.write.mock.calls.at(-1)[0]).not.toContain('class="qr"');
		expect(win2.document.write.mock.calls.at(-1)[0]).toContain('SLIP RINGKAS');
	});

	it('QR lambat (> batas) -> slip tetap tercetak tanpa QR', async () => {
		vi.useFakeTimers();
		const win = mkWin();
		(globalThis as any).window = { open: vi.fn(() => win) };
		printSlipPengajuanLapangan(pa, items, steps, { qrProvider: () => new Promise(() => {}) });
		await vi.advanceTimersByTimeAsync(QR_TIMEOUT_MS + 10);
		expect(win.document.write.mock.calls.at(-1)[0]).toContain('SLIP RINGKAS');
		expect(win.document.write.mock.calls.at(-1)[0]).not.toContain('class="qr"');
	});

	it('pop-up diblokir atau tanpa data -> false', () => {
		(globalThis as any).window = { open: vi.fn(() => null) };
		expect(printSlipPengajuanLapangan(pa, items, steps)).toBe(false);
		expect(printSlipPengajuanLapangan(null, items, steps)).toBe(false);
	});
});
