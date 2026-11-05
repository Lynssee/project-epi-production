// @vitest-environment jsdom
// PdfFetchSheet: GET berautentikasi → blob → penampil; gagal → pesan jelas + coba lagi (tidak diam).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const getIdToken = vi.fn(async () => 'tok-123');
const authMock: { currentUser: { getIdToken: typeof getIdToken } | null } = { currentUser: { getIdToken } };
vi.mock('$lib/firebase', () => ({ auth: authMock }));
vi.mock('$lib/components/project/PdfBlobViewer.svelte', async () => {
	// komponen minimal sebagai pengganti iframe blob (jsdom tak punya URL.createObjectURL)
	const { default: Stub } = await import('./__pdfViewerStub.svelte');
	return { default: Stub };
});

const { default: Sheet } = await import('./PdfFetchSheet.svelte');

let container: HTMLElement | null = null;
let instance: any = null;
const settle = async () => {
	for (let i = 0; i < 8; i++) {
		await Promise.resolve();
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
	}
};
async function render(props: Record<string, unknown>) {
	container = document.createElement('div');
	document.body.appendChild(container);
	instance = mount(Sheet, { target: container, props: { open: true, url: '/api/x/pdf?alur=a', title: 'Buku Saku', filename: 'Buku', onClose: vi.fn(), ...props } });
	await settle();
}
afterEach(() => {
	if (instance) unmount(instance);
	container?.remove();
	instance = null;
	authMock.currentUser = { getIdToken };
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('PdfFetchSheet', () => {
	it('sukses: memanggil URL dengan Bearer, menampilkan penampil PDF + tombol Bagikan', async () => {
		const f = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['%PDF'], { type: 'application/pdf' }) }));
		vi.stubGlobal('fetch', f);
		await render({});
		expect(f).toHaveBeenCalledTimes(1);
		expect(f.mock.calls[0][0]).toBe('/api/x/pdf?alur=a');
		expect((f.mock.calls[0][1] as any).headers.Authorization).toBe('Bearer tok-123');
		expect(container!.querySelector('[data-testid="pdf-viewer-stub"]')).not.toBeNull();
		expect(container!.textContent).toContain('Bagikan PDF');
	});
	it('server menolak → pesan server ditampilkan + Coba Lagi memuat ulang', async () => {
		const f = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ message: 'Layanan PDF sedang tidak tersedia.' }) }));
		vi.stubGlobal('fetch', f);
		await render({});
		expect(container!.querySelector('[data-testid="pdf-error"]')!.textContent).toContain('Layanan PDF sedang tidak tersedia.');
		const retry = [...container!.querySelectorAll('button')].find((b) => b.textContent!.includes('Coba Lagi'))!;
		retry.click();
		await settle();
		expect(f).toHaveBeenCalledTimes(2);
	});
	it('tanpa sesi login → pesan jelas, TIDAK memanggil server', async () => {
		authMock.currentUser = null;
		const f = vi.fn();
		vi.stubGlobal('fetch', f);
		await render({});
		expect(container!.querySelector('[data-testid="pdf-error"]')!.textContent).toContain('Sesi login tidak ditemukan');
		expect(f).not.toHaveBeenCalled();
	});
	it('jaringan putus → pesan galat; sheet tertutup (open=false) tidak memuat apa pun', async () => {
		const f = vi.fn(async () => { throw new Error('Failed to fetch'); });
		vi.stubGlobal('fetch', f);
		await render({});
		expect(container!.querySelector('[data-testid="pdf-error"]')!.textContent).toContain('Failed to fetch');
		unmount(instance);
		container!.remove();
		f.mockClear();
		await render({ open: false });
		expect(f).not.toHaveBeenCalled();
		expect(container!.querySelector('[data-testid="pdf-sheet"]')).toBeNull();
	});
});
