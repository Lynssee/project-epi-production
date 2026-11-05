// @vitest-environment jsdom
// Kartu "Tren Kinerja Saya": matriks skor final pribadi, ganti periode, rincian indikator, unduh PDF; gagal/kosong => tidak tampil.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const svc = vi.hoisted(() => ({ getKinerjaTren: vi.fn(), toneClass: (s: number | null) => (s == null ? 'tone-none' : s >= 85 ? 'tone-ok' : s >= 65 ? 'tone-warn' : 'tone-bad') }));
vi.mock('$lib/services/ess/kinerjaTren', () => svc);
const pdf = vi.hoisted(() => ({ unduhRaporKinerjaSaya: vi.fn(async () => ({ success: true })) }));
vi.mock('$lib/utils/raporKinerjaSayaPdf', () => pdf);
const { default: Card } = await import('./KinerjaTrenCard.svelte');

const BUCKETS = [{ key: '2026-06', label: 'Jun', fullLabel: 'Juni 2026' }, { key: '2026-07', label: 'Jul', fullLabel: 'Juli 2026' }];
const DATA = {
	available: true, nama: 'Desi', cadence: 'bulanan', year: 2026, buckets: BUCKETS, thresholds: { onTarget: 85, warning: 65 },
	cells: { '2026-06': { score: null, status: 'no_data', notes: null }, '2026-07': { score: 72, status: 'warning', notes: 'Q3-2026 (Finalized)' } },
	summary: { avgScore: 72, scoreCount: 1, delta: -4, trend: 'stable' },
	indicators: [{ key: 'k1', name: 'Kehadiran', weight: 15, cells: { '2026-07': { value: 93, achievement: 93, status: 'on_target' } }, avgAchievement: 93 }]
};

let box: HTMLElement | null, inst: any;
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); flushSync(); };
async function render() { box = document.createElement('div'); document.body.appendChild(box); inst = mount(Card, { target: box }); await tick(); }
beforeEach(() => { svc.getKinerjaTren.mockReset(); pdf.unduhRaporKinerjaSaya.mockClear(); });
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; });

describe('KinerjaTrenCard', () => {
	it('menampilkan skor total per periode; kosong "–" bukan 0', async () => {
		svc.getKinerjaTren.mockResolvedValue(DATA);
		await render();
		const card = box!.querySelector('[data-testid="kinerja-tren"]')!;
		expect(card).not.toBeNull();
		const cells = [...card.querySelectorAll('tbody tr:first-child td')].map((td) => td.textContent!.trim());
		expect(cells).toEqual(['Skor total', '–', '72']);
		expect(card.textContent).toContain('4 poin');
	});

	it('rincian indikator tersembunyi sampai dibuka', async () => {
		svc.getKinerjaTren.mockResolvedValue(DATA);
		await render();
		expect(box!.textContent).not.toContain('Kehadiran');
		([...box!.querySelectorAll('button')].find((b) => b.textContent!.includes('Lihat rincian 1 indikator')) as HTMLElement).click();
		flushSync();
		expect(box!.textContent).toContain('Kehadiran');
		expect(box!.textContent).toContain('93');
	});

	it('ganti periode memuat ulang dengan cadence baru', async () => {
		svc.getKinerjaTren.mockResolvedValue(DATA);
		await render();
		([...box!.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Triwulan') as HTMLElement).click();
		await tick();
		expect(svc.getKinerjaTren).toHaveBeenLastCalledWith('triwulan', expect.any(Number));
	});

	it('unduh PDF memakai data & nama dari server', async () => {
		svc.getKinerjaTren.mockResolvedValue(DATA);
		await render();
		([...box!.querySelectorAll('button')].find((b) => b.textContent!.includes('Unduh Rapor')) as HTMLElement).click();
		await tick();
		expect(pdf.unduhRaporKinerjaSaya).toHaveBeenCalledWith(expect.objectContaining({ nama: 'Desi' }), 'Desi');
	});

	it('gagal / belum pernah ada skor => kartu tidak tampil', async () => {
		for (const d of [{ available: false, reason: 'x' }, { ...DATA, cells: { '2026-07': { score: null, status: 'no_data', notes: null } } }]) {
			svc.getKinerjaTren.mockResolvedValue(d);
			await render();
			expect(box!.querySelector('[data-testid="kinerja-tren"]')).toBeNull();
			unmount(inst); box!.remove(); inst = box = null;
		}
	});
});
