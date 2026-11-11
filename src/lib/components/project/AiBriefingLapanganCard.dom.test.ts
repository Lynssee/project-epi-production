// @vitest-environment jsdom
// AiBriefingLapanganCard — pasif (tanpa tombol hitung ulang), temuan + centang lokal, offline, kosong/tak terukur/error.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const svc = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('$lib/services/secureDirectus', () => ({ getIdToken: vi.fn().mockResolvedValue('tok') }));
vi.mock('$lib/services/projectAiBriefing', async (orig) => ({
	...(await orig<typeof import('$lib/services/projectAiBriefing')>()),
	fetchFieldBriefing: (...a: any[]) => svc.fetch(...a)
}));

const { default: Card } = await import('./AiBriefingLapanganCard.svelte');
import { saveOfflineBriefing, loadChecked } from '$lib/services/projectAiBriefing';

let box: HTMLElement | null, inst: any;
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); flushSync(); };
const q = (id: string) => box!.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const qa = (id: string) => [...box!.querySelectorAll(`[data-testid="${id}"]`)] as HTMLElement[];
async function render(impl: () => Promise<any>) {
	svc.fetch.mockImplementation(impl);
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(Card, { target: box, props: { projectId: 5 } });
	await tick();
}

const briefing = (over: any = {}) => ({
	available: true, project_id: 5, horizon: 'pendek', status: 'danger', coverage: 'terukur', score: 75, summary: '1 kritis, 0 perlu perhatian.',
	items: [
		{ key: 'material_terlambat', status: 'danger', title: '1 kiriman material terlambat', evidence: 'Subtask sudah mulai, material belum diterima.', action: 'Kejar pengiriman hari ini.', pic: 'Logistik + Project Leader' },
		{ key: 'info_saja', status: 'info', title: 'Info saja', evidence: 'Tanpa tindakan.', action: null, pic: null }
	],
	gaps: [], generated_at: new Date(Date.now() - 10 * 60_000).toISOString(), cached: true, ...over
});

beforeEach(() => { localStorage.clear(); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = null; svc.fetch.mockReset(); vi.restoreAllMocks(); });

describe('AiBriefingLapanganCard', () => {
	it('menampilkan status, temuan, tindakan + PIC; dimuat sekali tanpa tombol hitung ulang (pasif)', async () => {
		await render(async () => briefing());
		expect(svc.fetch).toHaveBeenCalledTimes(1);
		expect(q('ab-status')!.textContent).toBe('Mendesak');
		const items = qa('ab-item');
		expect(items).toHaveLength(2);
		expect(items[0].textContent).toContain('Kejar pengiriman hari ini.');
		expect(items[0].textContent).toContain('PIC: Logistik + Project Leader');
		// Pasif: satu-satunya tombol adalah buka/tutup kartu — tidak ada kontrol segarkan/hitung ulang/pemicu analisa.
		const buttons = [...box!.querySelectorAll('button')];
		expect(buttons).toHaveLength(1);
		expect(buttons[0].classList.contains('ab-head')).toBe(true);
		expect(buttons[0].textContent).not.toMatch(/segarkan|hitung ulang|trigger|analisa ulang/i);
	});

	it('memberi petunjuk pemakaian yang menjelaskan sifat pasif & umur data', async () => {
		await render(async () => briefing());
		expect(box!.textContent).toContain('Anda tidak perlu menekan apa pun');
		expect(box!.textContent).toContain('terakhir 10 menit lalu');
	});

	it('centang hanya untuk item bertindakan; tersimpan lokal per hari dan dipulihkan saat dibuka lagi', async () => {
		await render(async () => briefing());
		expect(qa('ab-item')[1].querySelector('input')).toBeNull(); // item tanpa tindakan tak punya centang
		const cb = qa('ab-item')[0].querySelector('input') as HTMLInputElement;
		cb.click();
		flushSync();
		expect(q('ab-progress')!.textContent).toContain('1/1');
		expect([...loadChecked(5)]).toEqual(['material_terlambat']);
		unmount(inst); box!.remove();
		await render(async () => briefing());
		expect((qa('ab-item')[0].querySelector('input') as HTMLInputElement).checked).toBe(true);
	});

	it('server gagal + ada salinan perangkat ⇒ tampil salinan dengan label "Data offline per …"', async () => {
		saveOfflineBriefing(5, briefing({ summary: 'salinan lama' }));
		await render(async () => { throw new Error('Failed to fetch'); });
		expect(q('ab-offline')!.textContent).toContain('Data offline per');
		expect(qa('ab-item')).toHaveLength(2);
		expect(q('ab-error')).toBeNull();
	});

	it('server gagal + tanpa salinan ⇒ pesan ringan + Coba lagi (memuat ulang)', async () => {
		let n = 0;
		await render(async () => { n += 1; if (n === 1) throw new Error('Gagal memuat briefing lapangan (502)'); return briefing(); });
		expect(q('ab-error')!.textContent).toContain('502');
		(q('ab-error')!.querySelector('button') as HTMLElement).click();
		await tick();
		expect(q('ab-card')).toBeTruthy();
	});

	it('terukur tanpa temuan ⇒ pesan hijau "tidak ada hal mendesak"', async () => {
		await render(async () => briefing({ status: 'ok', items: [], summary: 'Tidak ada temuan — data tersedia.' }));
		expect(q('ab-clear')!.textContent).toContain('Tidak ada temuan');
		expect(q('ab-status')!.textContent).toBe('Aman');
	});

	it('sumber data gagal dimuat server ⇒ ditampilkan sebagai "belum terukur", BUKAN aman', async () => {
		await render(async () => briefing({ status: 'unknown', coverage: 'sumber_gagal', items: [], summary: 'Sumber data lensa ini gagal dimuat — jangan dibaca sebagai "aman".' }));
		expect(q('ab-status')!.textContent).toBe('Belum terukur');
		expect(q('ab-coverage')!.textContent).toContain('gagal dimuat');
		expect(q('ab-clear')).toBeNull();
	});

	it('dinonaktifkan admin ⇒ tampil alasan; bila tanpa alasan, kartu tidak menampilkan apa pun', async () => {
		await render(async () => ({ available: false, reason: 'Analisa dinonaktifkan oleh admin.', project_id: 5, horizon: 'pendek' }));
		expect(q('ab-unavailable')!.textContent).toContain('dinonaktifkan');
		unmount(inst); box!.remove();
		await render(async () => ({ available: false, project_id: 5, horizon: 'pendek' }));
		expect(q('ab-unavailable')).toBeNull();
		expect(q('ab-card')).toBeNull();
	});

	it('tombol kepala kartu membuka/menutup isi', async () => {
		await render(async () => briefing());
		(box!.querySelector('.ab-head') as HTMLElement).click();
		flushSync();
		expect(qa('ab-item')).toHaveLength(0);
		(box!.querySelector('.ab-head') as HTMLElement).click();
		flushSync();
		expect(qa('ab-item')).toHaveLength(2);
	});
});
