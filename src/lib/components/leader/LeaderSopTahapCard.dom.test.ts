// @vitest-environment jsdom
// Kartu "Panduan SOP Tahap Ini": hanya SOP bertahap yang cocok tahap aktif proyek; diam tanpa alur bertahap (dan tanpa query proyek); fail-soft.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { DEFAULT_PROJECT_STAGES } from '$lib/data/processProjectStageDefaults';

const svc = vi.hoisted(() => ({ loadStageFlows: vi.fn(), getProjectStageSignals: vi.fn(), loadMyTasks: vi.fn() }));
vi.mock('$lib/services/processGuidanceStageApi', () => ({ loadStageFlows: svc.loadStageFlows }));
vi.mock('$lib/services/projectStageSignals', () => ({ getProjectStageSignals: svc.getProjectStageSignals }));
vi.mock('$lib/services/processGuidanceMineApi', () => ({ loadMyTasks: svc.loadMyTasks }));
vi.mock('$lib/utils/wibDate', () => ({ todayWib: () => '2026-11-10' }));
const { default: Card } = await import('./LeaderSopTahapCard.svelte');

const flow = (id: string, title: string, tahap: string[], extra: any = {}) => ({ id, title, tahap_proyek: tahap, kategori_sop: 'induk', ...extra });
const DATA = {
	source: 'directus',
	stages: DEFAULT_PROJECT_STAGES,
	flows: [flow('mob_1', 'Angkut Alat ke Site', ['mobilisasi'], { sop_code: 'SOP-MOB-1' }), flow('mob_2', 'Cek Kendaraan', ['mobilisasi']), flow('eks_1', 'Pengecatan Lapangan', ['eksekusi']), flow('close_1', 'Serah Terima', ['closing'])]
};
const plan = (key: string, day: string) => ({ categories: [{ subtasks: [{ wajib_key: key, daily_plan: { [day]: 1 } }] }] });

let box: HTMLElement | null, inst: any;
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); flushSync(); };
async function render(projects = [{ id: 1, name: 'Proyek A' }, { id: 2, name: 'Proyek B' }]) { box = document.createElement('div'); document.body.appendChild(box); inst = mount(Card, { target: box, props: { projects } }); await tick(); }

beforeEach(() => {
	vi.clearAllMocks();
	svc.loadStageFlows.mockResolvedValue(DATA);
	svc.loadMyTasks.mockResolvedValue({ posisi: null, tasks: [], source: 'none' });
});
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = null; box = null; });

describe('LeaderSopTahapCard', () => {
	it('tahap dari subtask wajib hari ini + status; SOP hanya yang bertahap itu; proyek se-tahap digabung', async () => {
		svc.getProjectStageSignals.mockResolvedValue([
			{ id: 1, name: 'Proyek A', status: 'on progress', timeline_planning: plan('mobilisasi', '2026-11-10') },
			{ id: 2, name: 'Proyek B', status: 'on progress', timeline_planning: plan('mobilisasi', '2026-11-10') }
		]);
		await render();
		const groups = box!.querySelectorAll('[data-testid="sop-tahap-group"]');
		expect(groups).toHaveLength(1);
		expect(groups[0].textContent).toMatch(/Mobilisasi/);
		expect(groups[0].textContent).toMatch(/Proyek A, Proyek B/);
		expect([...groups[0].querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/panduan/alur?alur=mob_1', '/panduan/alur?alur=mob_2']);
		expect(box!.textContent).not.toMatch(/Pengecatan Lapangan/);
	});
	it('proyek di tahap berbeda → dua kelompok terurut tahap; alur milik jabatan saya didahulukan', async () => {
		svc.loadMyTasks.mockResolvedValue({ posisi: null, tasks: [{ flow_id: 'mob_2', node_id: 'n' }], source: 'directus' });
		svc.getProjectStageSignals.mockResolvedValue([
			{ id: 1, name: 'Proyek A', status: 'on progress', timeline_planning: null },
			{ id: 2, name: 'Proyek B', status: 'x', timeline_planning: plan('mobilisasi', '2026-11-10') }
		]);
		await render();
		const groups = [...box!.querySelectorAll('[data-testid="sop-tahap-group"]')];
		expect(groups.map((g) => /Mobilisasi|Eksekusi/.exec(g.textContent || '')?.[0])).toEqual(['Mobilisasi', 'Eksekusi']);
		expect(groups[0].querySelector('a')!.getAttribute('href')).toBe('/panduan/alur?alur=mob_2');
	});
	it('tak ada alur bertahap → kartu diam dan data proyek TIDAK dibaca', async () => {
		svc.loadStageFlows.mockResolvedValue({ source: 'directus', stages: [], flows: [] });
		await render();
		expect(box!.querySelector('[data-testid="sop-tahap-card"]')).toBeNull();
		expect(svc.getProjectStageSignals).not.toHaveBeenCalled();
	});
	it('tahap proyek tidak punya SOP / tanpa sinyal → kartu diam (tidak menebak)', async () => {
		svc.getProjectStageSignals.mockResolvedValue([
			{ id: 1, name: 'Proyek A', status: 'hold', timeline_planning: null },
			{ id: 2, name: 'Proyek B', status: 'waiting', timeline_planning: null } // persiapan: tak ada SOP bertahap itu
		]);
		await render();
		expect(box!.querySelector('[data-testid="sop-tahap-card"]')).toBeNull();
	});
	it('layanan gagal → kartu diam, tidak melempar', async () => {
		svc.loadStageFlows.mockRejectedValue(new Error('boom'));
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		await render();
		expect(box!.querySelector('[data-testid="sop-tahap-card"]')).toBeNull();
		warn.mockRestore();
	});
	it('tanpa proyek → tidak memanggil apa pun', async () => {
		await render([]);
		expect(svc.loadStageFlows).not.toHaveBeenCalled();
	});
});
