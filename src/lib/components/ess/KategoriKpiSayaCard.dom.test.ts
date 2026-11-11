// @vitest-environment jsdom
// Kartu "Skor Departemen Saya per Kategori": 5 kategori (kosong = "belum dihitung", bukan 0), saran tindakan, badge Simulasi;
// tidak tersedia/gagal => kartu tidak tampil.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const svc = vi.hoisted(() => ({ getKategoriKpiSaya: vi.fn() }));
vi.mock('$lib/services/ess/kategoriKpi', async () => {
	const actual = await vi.importActual<any>('$lib/services/ess/kategoriKpi');
	return { ...actual, getKategoriKpiSaya: svc.getKategoriKpiSaya };
});
const { default: Card } = await import('./KategoriKpiSayaCard.svelte');

const DATA = {
	available: true, department: 'Project', month: '2026-11', mode: 'shadow', thresholds: { onTarget: 85, warning: 65 }, composite: 74,
	missing: ['inovasi'],
	categories: {
		general: { score: 88, status: 'on_target', effectiveWeight: 25 },
		teknis: { score: 70, status: 'warning', effectiveWeight: 50 },
		administrasi: { score: 40, status: 'critical', effectiveWeight: 25 },
		keuangan: { score: null, status: null, effectiveWeight: 0 },
		inovasi: { score: null, status: null, effectiveWeight: 0 }
	},
	nudges: [{ id: 'kpi:report_compliance', severity: 'critical', category: 'administrasi', categoryLabel: 'Administrasi', title: 'Report Compliance: capaian 40%', detail: 'Di bawah ambang Waspada — prioritaskan perbaikan indikator ini.' }]
};

let box: HTMLElement | null, inst: any;
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); flushSync(); };
async function render() { box = document.createElement('div'); document.body.appendChild(box); inst = mount(Card, { target: box }); await tick(); }
beforeEach(() => svc.getKategoriKpiSaya.mockReset());
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; });

describe('KategoriKpiSayaCard', () => {
	it('menampilkan 5 kategori, kategori kosong "belum dihitung", komposit & badge Simulasi', async () => {
		svc.getKategoriKpiSaya.mockResolvedValue(DATA);
		await render();
		const card = box!.querySelector('[data-testid="kategori-kpi-saya"]')!;
		expect(card).not.toBeNull();
		expect(card.textContent).toContain('Simulasi');
		expect(card.textContent).toContain('74%');
		expect(card.textContent).toContain('88%');
		expect(card.textContent).toContain('Kritis');
		expect([...card.querySelectorAll('ul:first-of-type li')].filter((li) => li.textContent!.includes('belum dihitung'))).toHaveLength(2);
	});

	it('saran tindakan tampil; tanpa nudge menampilkan pesan positif', async () => {
		svc.getKategoriKpiSaya.mockResolvedValue(DATA);
		await render();
		expect(box!.querySelector('[data-testid="kategori-nudges"]')!.textContent).toContain('Report Compliance: capaian 40%');
		unmount(inst); box!.remove();
		svc.getKategoriKpiSaya.mockResolvedValue({ ...DATA, mode: 'on', nudges: [] });
		await render();
		expect(box!.querySelector('[data-testid="kategori-nudges"]')).toBeNull();
		expect(box!.textContent).toContain('Pertahankan');
		expect(box!.textContent).not.toContain('Simulasi');
	});

	it('tidak tersedia / gagal => tidak tampil', async () => {
		svc.getKategoriKpiSaya.mockResolvedValue({ available: false, reason: 'Skor kategori belum diaktifkan oleh admin.' });
		await render();
		expect(box!.querySelector('[data-testid="kategori-kpi-saya"]')).toBeNull();
	});
});
