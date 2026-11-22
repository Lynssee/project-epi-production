// @vitest-environment jsdom
// Kartu Kendali Harian Leader — kalender laporan, kasbon belum LPJ, deviasi Kurva S minggu berjalan; tanpa rupiah, gagal tidak disamarkan.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const svc = vi.hoisted(() => ({ load: vi.fn(), goto: vi.fn() }));
vi.mock('$lib/services/kendaliHarianApi', () => ({ loadKendaliHarian: (...a: any[]) => svc.load(...a) }));
vi.mock('$app/navigation', () => ({ goto: (...a: any[]) => svc.goto(...a) }));

import Card from './KendaliHarianCard.svelte';

let box: HTMLElement | null, inst: any;
const q = (id: string) => box!.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); flushSync(); };

const raw = (o: any = {}) => ({
	applicable: true,
	today: '2026-11-12',
	startYmd: '2026-10-01',
	calendarDays: 14,
	offWeekdays: [0],
	show: { calendar: true, lpj: true, scurve: true },
	reportDates: ['2026-11-09', '2026-11-11'],
	reportsFailed: false,
	lpj: [{ id: 41, nomor_pengajuan: 'PA-0041', tujuan_pengajuan: 'Uang muka material', tanggal_dicairkan: '2026-11-01' }],
	lpjFailed: false,
	lpjGraceDays: 7,
	scurve: { baseline: [{ d: '2026-11-01', p: 0 }, { d: '2026-11-15', p: 50 }, { d: '2026-11-29', p: 100 }], actual: [{ d: '2026-11-10', p: 24 }], hasSubtasks: true, tolerancePct: 5 },
	warnings: [],
	generated_at: '2026-11-12T00:00:00Z',
	...o
});

async function render() {
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(Card, { target: box, props: { projectId: 7 } });
	await tick();
}
beforeEach(() => { svc.load.mockReset(); svc.goto.mockReset(); });
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; });

describe('KendaliHarianCard', () => {
	it('menampilkan 3 bagian: kalender (hari bolong merah), LPJ lewat tenggang, Kurva S tertinggal', async () => {
		svc.load.mockResolvedValue(raw());
		await render();
		expect(q('kendali-harian-card')).toBeTruthy();
		const cells = [...box!.querySelectorAll('[data-status]')].map((c) => c.getAttribute('data-status'));
		expect(cells).toContain('missed');
		expect(cells).toContain('reported');
		expect(cells).toContain('today_pending');
		expect(q('kendali-missed')!.textContent).toContain('Bolong');
		expect(q('kendali-lpj-count')!.textContent).toContain('1 berkas');
		expect(q('kendali-lpj')!.textContent).toContain('PA-0041');
		expect(q('kendali-lpj')!.textContent).toContain('lewat tenggang');
		expect(q('kendali-scurve-tone')!.textContent).toContain('Tertinggal');
		expect(q('kendali-scurve-delta')!.textContent).toContain('-15,3');
		expect(box!.textContent).not.toMatch(/Rp\s?\d/);
	});

	it('tombol "Kumpulkan LPJ" membuka pengajuan; "Isi laporan susulan" membuka laporan proyek', async () => {
		svc.load.mockResolvedValue(raw());
		await render();
		const btns = [...box!.querySelectorAll('button')];
		btns.find((b) => b.textContent?.includes('Kumpulkan LPJ'))!.click();
		expect(svc.goto).toHaveBeenCalledWith('/anggaran/41');
		btns.find((b) => b.textContent?.includes('Isi laporan susulan'))!.click();
		expect(svc.goto).toHaveBeenCalledWith('/laporan/7');
	});

	it('tanpa baseline: dijelaskan apa yang perlu dilengkapi, bukan 0% palsu', async () => {
		svc.load.mockResolvedValue(raw({ scurve: { baseline: null, actual: [], hasSubtasks: true, tolerancePct: 5 }, lpj: [] }));
		await render();
		expect(q('kendali-scurve-na')!.textContent).toContain('baseline');
		expect(q('kendali-lpj-empty')).toBeTruthy();
	});

	it('toggle setelan menyembunyikan bagian; laporan gagal dimuat tidak tampak lengkap', async () => {
		svc.load.mockResolvedValue(raw({ show: { calendar: true, lpj: false, scurve: false }, reportDates: null, reportsFailed: true }));
		await render();
		expect(q('kendali-lpj')).toBeNull();
		expect(q('kendali-scurve')).toBeNull();
		expect(q('kendali-calendar-na')!.textContent).toContain('belum dapat dimuat');
	});

	it('tidak berlaku / 403 → tidak render apa pun; error lain → pesan + coba lagi', async () => {
		svc.load.mockResolvedValue({ applicable: false, reason: 'status', generated_at: 'x' });
		await render();
		expect(q('kendali-harian-card')).toBeNull();
		unmount(inst); box!.remove(); inst = box = null;

		svc.load.mockRejectedValue(Object.assign(new Error('HTTP 403'), { status: 403 }));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await render();
		expect(q('kendali-harian-card')).toBeNull();
		unmount(inst); box!.remove(); inst = box = null;

		svc.load.mockRejectedValue(Object.assign(new Error('HTTP 500'), { status: 500 }));
		await render();
		expect(q('kendali-harian-error')!.textContent).toContain('belum dapat dimuat');
	});
});
