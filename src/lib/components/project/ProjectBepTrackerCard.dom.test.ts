// @vitest-environment jsdom
// Kartu BEP lapangan — skenario terburuk (sisa jatah & posisi impas) hanya muncul bila ada dana tertahan; persen saja, tanpa rupiah.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const svc = vi.hoisted(() => ({ pos: vi.fn(), budget: vi.fn() }));
vi.mock('$lib/services/projectCostBehaviorApi', () => ({ getProjectCostPosition: (...a: any[]) => svc.pos(...a) }));
vi.mock('$lib/services/projectFinancePct', () => ({ fetchFieldBudgetPct: (...a: any[]) => svc.budget(...a) }));
vi.mock('$lib/services/projectSettings', () => ({ getProjectSetting: () => undefined, loadProjectSettings: () => Promise.resolve() }));

import Card from './ProjectBepTrackerCard.svelte';

let box: HTMLElement | null, inst: any;
const q = (id: string) => box!.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); flushSync(); };

const pos = (o: any = {}) => ({
	project_id: 7, variable_realized: 400, rap_plafon: 2000, remaining: 1600, used_pct: 0.2, remaining_pct: 0.8, burn_rate_per_day: 0, days_left: null, window_days: 7,
	overhead_allocated: 500, contract_billed: 1000, position_vs_bep: 1.2, show_rupiah: false, show_overhead_nominal: false, has_overhead: true, ...o
});
const pagu = (pct: number) => ({
	status: 'ok', level: 'safe', used_pct: 20, actual_pct: 20, commitment_pct: 0, remaining_pct: 80, thresholds: { warnPct: 80, dangerPct: 100 }, note: '', warnings: [],
	unrealized: { pct, birokrasi_pct: pct, pipeline_pct: 0, item_count: 1, names_enabled: false }, safe_spend: { state: 'held', projected_pct: 20 + pct }
});
async function render() {
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(Card, { target: box, props: { projectId: 7 } });
	await tick();
}
beforeEach(() => { svc.pos.mockReset(); svc.budget.mockReset(); });
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; });

describe('ProjectBepTrackerCard — skenario terburuk', () => {
	it('dana tertahan menembus impas: tampil perkiraan posisi & peringatan, tanpa rupiah', async () => {
		svc.pos.mockResolvedValue(pos());
		svc.budget.mockResolvedValue(pagu(10)); // ≈ 200 dari RAP 2000 → 1,2x → 0,8x
		await render();
		const t = q('bep-worst-position')!;
		expect(t.textContent).toContain('±80%');
		expect(t.textContent).toContain('turun ke bawah impas');
		expect(box!.textContent).not.toMatch(/Rp\s?\d/);
	});

	it('dana tertahan 0% → tidak ada baris skenario terburuk', async () => {
		svc.pos.mockResolvedValue(pos());
		svc.budget.mockResolvedValue(pagu(0));
		await render();
		expect(q('bep-worst-position')).toBeNull();
		expect(q('bep-worst-case')).toBeNull();
	});

	it('tanpa overhead teralokasi → posisi terburuk tidak dihitung (tidak menebak)', async () => {
		svc.pos.mockResolvedValue(pos({ overhead_allocated: 0, has_overhead: false, position_vs_bep: null }));
		svc.budget.mockResolvedValue(pagu(10));
		await render();
		expect(q('bep-worst-position')).toBeNull();
		expect(q('bep-worst-case')).not.toBeNull(); // sisa jatah terburuk tetap tampil
	});

	it('data dana tertahan gagal dibaca → tidak ada skenario terburuk', async () => {
		svc.pos.mockResolvedValue(pos());
		svc.budget.mockResolvedValue(null);
		await render();
		expect(q('bep-worst-position')).toBeNull();
		expect(q('bep-worst-case')).toBeNull();
	});
});
