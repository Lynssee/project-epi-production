// @vitest-environment jsdom
// Badge "sisa N jam" menjelaskan batas pembenahan; harus bisa diketuk di layar sentuh.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const DATA = {
	available: true, periode: '2026-10', berlaku: true,
	settings: { aging_jam_batas: 48, toleransi_ulang: 1, target_lolos_persen: 90, sp_ambang_penalti: 3, min_sampel: 3 },
	ringkas: { total_dokumen: 5, tertahan: 1, penalti: 0, edukasi: 1, lewat_batas: 0, berulang: 0, lolos_persen: 80, skor_kpi: 80, dinilai: true, sisa_ke_ambang_sp: 2 },
	per_kategori: [],
	tertahan: [{ id: 7, nomor: 'PA-007', sumber: 'pa', aging_jam: 10, sisa_jam: 30, gate_keys: ['G_X'], status: 'edukasi', alasan: 'edukasi', link: null }]
};
vi.mock('$lib/services/ess/gateKpiSaya', () => ({ getGateKpiSaya: vi.fn(async () => DATA) }));
const { default: GateKpiSayaCard } = await import('./GateKpiSayaCard.svelte');

let box: HTMLElement | null, inst: any;
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; });

describe('GateKpiSayaCard — penjelasan sisa waktu bisa diketuk', () => {
	it('buka daftar → ketuk badge "sisa" menampilkan batas jam; tanpa title native', async () => {
		window.matchMedia = vi.fn((q: string) => ({ matches: false, media: q })) as any;
		box = document.createElement('div');
		document.body.appendChild(box);
		inst = mount(GateKpiSayaCard, { target: box, props: {} });
		flushSync();
		for (let i = 0; i < 10; i++) await Promise.resolve();
		flushSync();
		const toggle = [...box.querySelectorAll('button')].find((b) => b.textContent!.includes('yang perlu dibenahi')) as HTMLElement;
		expect(toggle).toBeTruthy();
		toggle.click();
		flushSync();
		expect(box.querySelector('span[title^="Benahi sebelum batas"]')).toBeNull();
		const trg = box.querySelector('li [role="button"]') as HTMLElement;
		expect(trg.textContent).toContain('sisa 30 jam');
		trg.click();
		flushSync();
		expect(box.textContent).toContain('Benahi sebelum batas 48 jam');
	});
});
