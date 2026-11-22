// @vitest-environment jsdom
// Kartu "Dampak KPI Saya" (Leader): arah ↑/↓ + rantai penyebab; angka Rp hanya bila server mengirimnya (mode rp);
// tidak tersedia/gagal/kosong => kartu tidak tampil.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const svc = vi.hoisted(() => ({ getKpiDampakSaya: vi.fn() }));
vi.mock('$lib/services/ess/kpiDampak', async () => {
	const actual = await vi.importActual<any>('$lib/services/ess/kpiDampak');
	return { ...actual, getKpiDampakSaya: svc.getKpiDampakSaya };
});
const { default: Card } = await import('./LeaderKpiDampakCard.svelte');

const ITEMS = [
	{ kpi_code: 'on_time_delivery', name: 'On Time Delivery', arah: 'perlu_perhatian', label: 'Estimasi', penjelasan: 'Proyek telat → Denda keterlambatan' },
	{ kpi_code: 'budget_variance', name: 'Budget Variance', arah: 'lebih_baik', label: 'Estimasi', penjelasan: '' }
];
const DATA = { available: true, department: 'Project', month: '2026-11', mode: 'arah', items: ITEMS, terhitung: 2 };

let box: HTMLElement | null, inst: any;
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); flushSync(); };
async function render() { box = document.createElement('div'); document.body.appendChild(box); inst = mount(Card, { target: box }); await tick(); }
beforeEach(() => svc.getKpiDampakSaya.mockReset());
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; });

describe('LeaderKpiDampakCard', () => {
	it('mode arah: menampilkan indikator + arah + penjelasan, TANPA angka Rp', async () => {
		svc.getKpiDampakSaya.mockResolvedValue(DATA);
		await render();
		const card = box!.querySelector('[data-testid="leader-kpi-dampak"]')!;
		expect(card).not.toBeNull();
		expect(card.textContent).toContain('Dampak KPI Saya');
		expect(card.textContent).toContain('Departemen Project');
		expect(card.textContent).toContain('Estimasi');
		expect(card.textContent).toContain('Proyek telat → Denda keterlambatan');
		const rows = card.querySelectorAll('[data-testid="dampak-item"]');
		expect(rows).toHaveLength(2);
		expect(rows[0].textContent).toContain('↓');
		expect(rows[1].textContent).toContain('↑');
		expect(card.querySelector('[data-testid="dampak-rp"]')).toBeNull();
		expect(card.textContent).not.toContain('Rp');
	});

	it('mode rp: angka Rp ikut tampil', async () => {
		svc.getKpiDampakSaya.mockResolvedValue({ ...DATA, mode: 'rp', items: [{ ...ITEMS[0], rp: -5000000 }, { ...ITEMS[1], rp: 2000000 }] });
		await render();
		const rp = [...box!.querySelectorAll('[data-testid="dampak-rp"]')].map((e) => e.textContent);
		expect(rp).toEqual(['−Rp5.000.000', '+Rp2.000.000']);
	});

	it('tidak tersedia / kosong / gagal => kartu tidak tampil', async () => {
		for (const v of [{ available: false, reason: 'nonaktif' }, { available: true, items: [] }, { available: false, reason: 'HTTP 500' }]) {
			svc.getKpiDampakSaya.mockResolvedValue(v);
			await render();
			expect(box!.querySelector('[data-testid="leader-kpi-dampak"]')).toBeNull();
			unmount(inst); box!.remove(); inst = box = null;
		}
	});
});
