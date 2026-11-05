// @vitest-environment jsdom
// Banner "Syarat sebelum Simpan" (R-L1): dilipat bawaan, isi checklist/penyebab tertahan/gate, ingat pilihan, tidak tampil bila tak ada isi/gagal.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const loadFlowById = vi.fn();
vi.mock('$lib/services/processGuidanceFlowsApi', () => ({ loadFlowById: (id: string) => loadFlowById(id) }));
import StepChecklistBanner from './StepChecklistBanner.svelte';

let box: HTMLElement | null, inst: any;
const settle = async () => { for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 0)); flushSync(); } };
async function render(props: any) {
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(StepChecklistBanner, { target: box, props });
	await settle();
}
const node = (o: any = {}) => ({ id: 'prj_daily_rep', type: 'task', lane: 'a', col: 0, label: 'Laporan Harian', desc: '', checklist: ['Foto progres unik', 'Cuaca diisi'], blockers: ['Foto sama dipakai ulang'], actions: [], gates: [{ key: 'G_X' }, { key: 'G_Y' }], sla_hours: 24, ...o });
const flow = (n: any) => ({ id: 'project_field_execution', title: 'Pelaksanaan Proyek', description: '', lanes: [{ key: 'a', label: 'A' }], nodes: [n], edges: [], version: 1 });

beforeEach(() => { localStorage.clear(); loadFlowById.mockReset(); loadFlowById.mockResolvedValue({ flow: flow(node()), source: 'directus' }); });
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; });

describe('StepChecklistBanner', () => {
	it('memuat SATU alur saat tampil; dilipat bawaan dengan ringkasan jumlah butir & gate', async () => {
		await render({ alur: 'project_field_execution', fokus: 'prj_daily_rep' });
		expect(loadFlowById).toHaveBeenCalledTimes(1);
		expect(loadFlowById).toHaveBeenCalledWith('project_field_execution');
		const b = box!.querySelector('[data-testid="step-banner"]')!;
		expect(b.textContent).toContain('Syarat sebelum Simpan');
		expect(b.textContent).toContain('2 butir');
		expect(b.textContent).toContain('2 gate');
		expect(box!.querySelector('[data-testid="step-banner-body"]')).toBeNull();
	});
	it('diketuk → checklist, penyebab tertahan, catatan gate, SLA, tautan alur lengkap ber-fokus; pilihan diingat', async () => {
		await render({ alur: 'project_field_execution', fokus: 'prj_daily_rep', judul: 'Syarat Laporan Harian' });
		(box!.querySelector('button[aria-expanded]') as HTMLElement).click();
		flushSync();
		const body = box!.querySelector('[data-testid="step-banner-body"]')!;
		expect(body.textContent).toContain('Foto progres unik');
		expect(body.textContent).toContain('Foto sama dipakai ulang');
		expect(body.textContent).toContain('Dijaga 2 gate');
		expect(body.textContent).toContain('24 jam');
		expect(body.querySelector('a')!.getAttribute('href')).toBe('/panduan/alur?alur=project_field_execution&fokus=prj_daily_rep');
		expect(localStorage.getItem('epi_stepbanner_prj_daily_rep')).toBe('open');
		unmount(inst); box!.remove();
		await render({ alur: 'project_field_execution', fokus: 'prj_daily_rep' });
		expect(box!.querySelector('[data-testid="step-banner-body"]')).not.toBeNull(); // terbuka sesuai pilihan sebelumnya
	});
	it('langkah tak ditemukan / alur gagal dimuat / langkah tanpa isi → TIDAK tampil apa pun (form tak terganggu)', async () => {
		loadFlowById.mockResolvedValue({ flow: flow(node({ id: 'lain' })), source: 'directus' });
		await render({ alur: 'project_field_execution', fokus: 'prj_daily_rep' });
		expect(box!.querySelector('[data-testid="step-banner"]')).toBeNull();
		unmount(inst); box!.remove();
		loadFlowById.mockResolvedValue({ flow: null, source: 'local' });
		await render({ alur: 'x', fokus: 'y' });
		expect(box!.querySelector('[data-testid="step-banner"]')).toBeNull();
		unmount(inst); box!.remove();
		loadFlowById.mockResolvedValue({ flow: flow(node({ checklist: [], blockers: [], gates: [] })), source: 'directus' });
		await render({ alur: 'project_field_execution', fokus: 'prj_daily_rep' });
		expect(box!.querySelector('[data-testid="step-banner"]')).toBeNull();
	});
	it('hanya gate (tanpa checklist) tetap tampil; penyimpanan perangkat tidak tersedia tidak membuat crash', async () => {
		const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
		loadFlowById.mockResolvedValue({ flow: flow(node({ checklist: [], blockers: [] })), source: 'cached' });
		await render({ alur: 'project_field_execution', fokus: 'prj_daily_rep' });
		expect(box!.querySelector('[data-testid="step-banner"]')!.textContent).toContain('0 butir');
		spy.mockRestore();
	});
});
