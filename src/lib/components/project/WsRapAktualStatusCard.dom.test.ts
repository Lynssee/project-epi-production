// @vitest-environment jsdom
// Arti "lampu EV" tidak boleh hanya di title native — harus bisa diketuk di layar sentuh.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

vi.mock('$lib/services/wsTimelineStatus', () => ({
	fetchWsTimelineStatus: vi.fn(async () => ({ projectId: 5, found: true, active: true, progressPct: 40, serapanPct: 55, evFlag: 'yellow', manpowerEstimasi: false }))
}));
const { default: Card } = await import('./WsRapAktualStatusCard.svelte');

let box: HTMLElement | null, inst: any;
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; });

describe('WsRapAktualStatusCard — lampu EV bisa diketuk', () => {
	it('ketuk lampu menampilkan penjelasan; tidak ada title native', async () => {
		window.matchMedia = vi.fn((q: string) => ({ matches: false, media: q })) as any;
		box = document.createElement('div');
		document.body.appendChild(box);
		inst = mount(Card, { target: box, props: { project: { id: 5, workshop: 'ciketing' } } });
		flushSync();
		for (let i = 0; i < 12; i++) await Promise.resolve();
		await new Promise((r) => setTimeout(r, 10));
		flushSync();
		expect(box.querySelector('[title="Lampu EV (serapan vs progres)"]')).toBeNull();
		const trg = box.querySelector('[role="button"]') as HTMLElement;
		expect(trg).toBeTruthy();
		trg.click();
		flushSync();
		expect(box.textContent).toContain('Lampu EV (serapan vs progres)');
	});
});
