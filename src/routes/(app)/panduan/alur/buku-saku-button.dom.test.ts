// @vitest-environment jsdom
// Tombol "Buku Saku & Checklist (PDF)" di /panduan/alur (Penyatuan Engine Cetak, Fase 4).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

vi.mock('$app/state', () => ({ page: { get url() { return new URL('http://x/panduan/alur?alur=f1'); } } }));
vi.mock('$lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'tok' } } }));
vi.mock('$lib/components/project/PdfBlobViewer.svelte', async () => ({ default: (await import('$lib/components/shared/__pdfViewerStub.svelte')).default }));

const mkFlow = (id: string, nodes = 2) => ({
	id, title: `Alur ${id}`, description: `desc ${id}`, lanes: [{ key: 'a', label: 'ADMIN' }],
	nodes: Array.from({ length: nodes }, (_, i) => ({ id: `n${i}`, type: 'task', lane: 'a', col: i, label: `L${i}`, desc: 'd', actions: [] })),
	edges: [], version: 1
});
const loadFlowIndex = vi.fn();
const loadFlowById = vi.fn();
vi.mock('$lib/services/processGuidanceFlowsApi', () => ({
	loadFlowIndex: () => loadFlowIndex(), loadFlowById: (id: string) => loadFlowById(id), loadFlowChain: async () => ({ chain: null, source: 'directus' })
}));
vi.mock('$lib/services/processGuidanceMineApi', () => ({ loadMyTasks: async () => ({ posisi: null, tasks: [], source: 'none' }) }));
const { default: Page } = await import('./+page.svelte');

let box: HTMLElement | null, inst: any;
const settle = async () => { for (let i = 0; i < 10; i++) { await new Promise((r) => setTimeout(r, 0)); flushSync(); } };
async function render() {
	Element.prototype.scrollIntoView = () => {};
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(Page, { target: box, props: {} });
	await settle();
}
const btn = () => box!.querySelector('[data-testid="btn-buku-saku"]') as HTMLButtonElement | null;

beforeEach(() => {
	loadFlowIndex.mockResolvedValue({ flows: [{ id: 'f1', title: 'Alur f1', description: 'd', version: 1, node_count: 2 }], source: 'directus' });
	loadFlowById.mockImplementation(async (id: string) => ({ flow: mkFlow(id), source: 'directus' }));
});
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('/panduan/alur — Buku Saku PDF', () => {
	it('tombol muncul untuk alur yang punya langkah; klik memanggil endpoint dengan id alur & Bearer', async () => {
		const f = vi.fn(async () => ({ ok: true, blob: async () => new Blob(['%PDF']) }));
		vi.stubGlobal('fetch', f);
		await render();
		expect(btn()).not.toBeNull();
		expect(box!.textContent).toContain('Butuh internet');
		btn()!.click();
		await settle();
		const call = (f.mock.calls as any[]).find((c) => String(c[0]).includes('/api/panduan/buku-saku-pdf'));
		expect(call[0]).toBe('/api/panduan/buku-saku-pdf?alur=f1');
		expect(call[1].headers.Authorization).toBe('Bearer tok');
	});
	it('alur tanpa langkah → tombol tidak ditampilkan (tidak ada PDF kosong)', async () => {
		loadFlowById.mockImplementation(async (id: string) => ({ flow: mkFlow(id, 0), source: 'directus' }));
		await render();
		expect(btn()).toBeNull();
	});
	it('offline: tidak memanggil server; pesan jelas bahwa isi alur tetap bisa dibaca', async () => {
		const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
		vi.stubGlobal('fetch', f);
		Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
		await render();
		btn()!.click();
		await settle();
		expect(box!.textContent).toContain('sedang offline');
		expect(f.mock.calls.some((c) => String(c[0]).includes('buku-saku-pdf'))).toBe(false);
		Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
	});
});
