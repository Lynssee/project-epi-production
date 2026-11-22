// @vitest-environment jsdom
// "Pakta & Aturan Saya" (dropdown header): tersembunyi bila fitur mati; badge jumlah; daftar per kategori; "Buka kegiatan" menuju rute.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

vi.mock('@tabler/icons-svelte', () => ({ IconShieldCheck: () => {} }));
const gotoMock = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (...a: any[]) => gotoMock(...a) }));
const getSaya = vi.fn();
vi.mock('$lib/services/ess/pakta', () => ({ PAKTA_REFRESH_EVENT: 'pakta:refresh', getPaktaSaya: (...a: any[]) => getSaya(...a) }));

const { authStore } = await import('$lib/stores/auth');
const { default: PaktaSayaMenu } = await import('./PaktaSayaMenu.svelte');

const SOP = { key: 'sop:10', type: 'sop', title: 'SOP Stock Opname', sop_code: 'SOP-PRJ-320', version: 2, route: '/stock-lapangan/opname', label: 'Stock Opname', baca_url: '/ess/pelatihan/sop/10', status_kendala: null };
const GATE = { key: 'gate:G_A', type: 'gate', title: 'Foto rak wajib', sop_code: null, version: 90, route: '/stock-lapangan/opname', label: 'Stock Opname', baca_url: null, status_kendala: 'menunggu' };

let box: HTMLElement | null, inst: any;
async function render() {
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(PaktaSayaMenu, { target: box });
	authStore.update((a) => ({ ...a, checked: true, karyawanId: 42 }));
	flushSync();
	for (let i = 0; i < 12; i++) await Promise.resolve();
	flushSync();
	return box;
}
beforeEach(() => { getSaya.mockReset(); gotoMock.mockReset(); });
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; authStore.update((a) => ({ ...a, checked: false, karyawanId: null })); });

describe('PaktaSayaMenu', () => {
	it('fitur mati atau gagal memuat → tidak menampilkan apa pun', async () => {
		getSaya.mockResolvedValue({ enabled: false, count: 0, prosedur: [], gate: [] });
		expect((await render()).querySelector('[data-testid="pakta-saya-btn"]')).toBeNull();
		unmount(inst); box!.remove();
		getSaya.mockRejectedValue(new Error('down'));
		expect((await render()).querySelector('[data-testid="pakta-saya-btn"]')).toBeNull();
	});

	it('badge = jumlah; dibuka → dua kategori, status kendala, tombol Buka kegiatan menuju rute', async () => {
		getSaya.mockResolvedValue({ enabled: true, count: 2, prosedur: [SOP], gate: [GATE] });
		const el = await render();
		const btn = el.querySelector('[data-testid="pakta-saya-btn"]') as HTMLButtonElement;
		expect(btn.textContent).toContain('2');
		expect(el.querySelector('[data-testid="pakta-saya-panel"]')).toBeNull();
		btn.click();
		flushSync();
		const t = el.querySelector('[data-testid="pakta-saya-panel"]')!.textContent!;
		expect(t).toContain('Prosedur Kerja (SOP)');
		expect(t).toContain('Aturan Sistem (Gate)');
		expect(t).toContain('SOP Stock Opname');
		expect(t).toContain('Foto rak wajib');
		expect(t).toContain('perubahan aturan');
		expect(t).toContain('Kendala diajukan');
		const item = [...el.querySelectorAll('[data-testid="pakta-saya-panel"] button')].find((b) => b.textContent?.includes('SOP Stock Opname')) as HTMLButtonElement;
		item.click();
		flushSync();
		expect(gotoMock).toHaveBeenCalledWith('/stock-lapangan/opname');
		expect(el.querySelector('[data-testid="pakta-saya-panel"]')).toBeNull();
	});

	it('tidak ada yang perlu disetujui → tanpa badge, pesan ramah', async () => {
		getSaya.mockResolvedValue({ enabled: true, count: 0, prosedur: [], gate: [] });
		const el = await render();
		const btn = el.querySelector('[data-testid="pakta-saya-btn"]') as HTMLButtonElement;
		expect(btn.textContent!.trim()).toBe('');
		btn.click();
		flushSync();
		expect(el.textContent).toContain('Tidak ada yang perlu Anda setujui');
	});
});
