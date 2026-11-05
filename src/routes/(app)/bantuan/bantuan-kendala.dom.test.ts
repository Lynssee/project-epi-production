// @vitest-environment jsdom
// Pusat Bantuan (/bantuan): pencarian kendala/pesan gate → membuka Alur Kerja tepat di langkah terkait (deep-link), tanpa mengganggu isi halaman.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const goto = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (...a: unknown[]) => goto(...a) }));
const searchKendala = vi.fn();
vi.mock('../panduan/alur/fieldGateApi', () => ({ searchKendala: (q: string, d: unknown, s: AbortSignal) => searchKendala(q, d, s), loadGateInfo: vi.fn() }));
vi.mock('$lib/services/tutorialApi', () => ({
	fetchTutorialForMe: vi.fn(async () => ({ success: false, error: 'offline' })),
	fetchProjectSop: vi.fn(async () => ({ success: true, data: { projectId: null, notes: [] } }))
}));
vi.mock('$lib/services/releaseNotesApi', () => ({ fetchReleaseNotes: vi.fn(async () => ({ success: true, data: [] })) }));
vi.mock('$lib/utils/offlinePanduanCache', () => ({ cacheTutorialForMe: vi.fn(), getCachedTutorialForMe: vi.fn(async () => null) }));
vi.mock('$lib/stores/tourStore.svelte', () => ({ startTour: vi.fn() }));

const { default: Page } = await import('./+page.svelte');

let box: HTMLElement | null, inst: any;
const settle = async () => { for (let i = 0; i < 12; i++) { await new Promise((r) => setTimeout(r, 0)); flushSync(); } };
const type = async (v: string) => {
	const i = box!.querySelector('#kendala-q') as HTMLInputElement;
	i.value = v;
	i.dispatchEvent(new Event('input', { bubbles: true }));
	await vi.advanceTimersByTimeAsync(450);
	await settle();
};

beforeEach(async () => {
	vi.clearAllMocks();
	vi.useFakeTimers({ shouldAdvanceTime: true });
	searchKendala.mockResolvedValue({ hits: [{ flow_id: 'laporan harian/x', flow_title: 'Laporan Harian', node_id: 'foto&ba', node_label: 'Foto BA', kind: 'kendala', snippet: 'Foto BA belum diunggah' }] });
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(Page, { target: box, props: {} });
	await settle();
});
afterEach(() => { vi.useRealTimers(); if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; });

describe('/bantuan — cari kendala', () => {
	it('kotak pencarian tampil di atas halaman bersama tautan Alur Kerja yang sudah ada', () => {
		expect(box!.querySelector('[data-testid="kendala-search"]')).toBeTruthy();
		expect(box!.querySelector('a[href="/panduan/alur"]')).toBeTruthy();
		expect(box!.textContent).toContain('Cari kendala / pesan gate');
	});

	it('hasil diketuk → goto /panduan/alur?alur=…&fokus=… dengan nilai ter-encode (aman untuk karakter khusus)', async () => {
		await type('foto ba');
		expect(searchKendala).toHaveBeenCalledTimes(1);
		(box!.querySelector('[data-testid="kendala-hit"]') as HTMLElement).click();
		await settle();
		expect(goto).toHaveBeenCalledWith('/panduan/alur?alur=laporan%20harian%2Fx&fokus=foto%26ba');
	});

	it('tidak ada hasil → saran; tidak mengarahkan ke mana pun', async () => {
		searchKendala.mockResolvedValue({ hits: [] });
		await type('zzzz');
		expect(box!.querySelector('[data-testid="kendala-empty"]')).toBeTruthy();
		expect(goto).not.toHaveBeenCalled();
	});

	it('halaman tetap berfungsi saat tutorial gagal dimuat (pesan galat lama tidak terganggu)', () => {
		expect(box!.textContent).toContain('offline');
		expect(box!.querySelector('[data-testid="kendala-search"]')).toBeTruthy();
	});
});
