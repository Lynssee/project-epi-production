// @vitest-environment jsdom
// SpkDataHealthBanner.dom.test.ts — banner hub produksi: tampil bila ada SPK belum-QC / tanpa deadline; tersembunyi bila sehat; error transparan.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const fetchMock = vi.fn();
vi.mock('$lib/services/produksiDataHealthApi', () => ({ fetchSpkDataHealth: (...a: unknown[]) => fetchMock(...a) }));
import SpkDataHealthBanner from './SpkDataHealthBanner.svelte';

let container: HTMLElement;
let instance: ReturnType<typeof mount> | null;
async function render() {
	container = document.createElement('div');
	document.body.appendChild(container);
	instance = mount(SpkDataHealthBanner, { target: container });
	await new Promise((r) => setTimeout(r, 0));
	flushSync();
}
afterEach(() => {
	if (instance) unmount(instance);
	container?.remove();
	instance = null;
	fetchMock.mockReset();
});
const text = () => container.textContent!.replace(/\s+/g, ' ');

describe('SpkDataHealthBanner', () => {
	it('menampilkan SPK belum-QC dan tanpa deadline beserta tautan Kiosk QC', async () => {
		fetchMock.mockResolvedValue({ belumQc: { total: 3, contoh: ['SPK-A'] }, tanpaDeadline: { total: 200, contoh: ['SPK-D'] }, windowHari: 30 });
		await render();
		expect(text()).toContain('3 SPK');
		expect(text()).toContain('belum di-QC');
		expect(text()).toContain('200+ SPK');
		expect(container.querySelector('a[href="/kiosk/qc"]')).toBeTruthy();
	});
	it('data sehat: banner tidak tampil', async () => {
		fetchMock.mockResolvedValue({ belumQc: { total: 0, contoh: [] }, tanpaDeadline: { total: 0, contoh: [] }, windowHari: 30 });
		await render();
		expect(container.querySelector('[data-testid="spk-health-banner"]')).toBeNull();
	});
	it('gagal memuat: pesan kecil, bukan crash', async () => {
		fetchMock.mockRejectedValue(new Error('HTTP 502'));
		await render();
		expect(container.querySelector('[data-testid="spk-health-err"]')!.textContent).toContain('HTTP 502');
	});
});
