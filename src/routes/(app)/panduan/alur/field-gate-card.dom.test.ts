// @vitest-environment jsdom
// Kartu "Siklus Dokumen & Syarat Lolos Gate" dan pencarian kendala di /panduan/alur: render nyata (jsdom), klien API di-mock.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

let search = '';
vi.mock('$app/state', () => ({ page: { get url() { return new URL('http://x/panduan/alur' + search); } } }));

const loadGateInfo = vi.fn();
const searchKendala = vi.fn();
vi.mock('./fieldGateApi', () => ({ loadGateInfo: (id: string) => loadGateInfo(id), searchKendala: (q: string, d: unknown, s: AbortSignal) => searchKendala(q, d, s) }));

const loadFlowIndex = vi.fn();
const loadFlowById = vi.fn();
const loadMyTasks = vi.fn();
const loadFlowChain = vi.fn();
vi.mock('$lib/services/processGuidanceFlowsApi', () => ({ loadFlowIndex: () => loadFlowIndex(), loadFlowById: (id: string) => loadFlowById(id), loadFlowChain: (id: string) => loadFlowChain(id) }));
vi.mock('$lib/services/processGuidanceMineApi', () => ({ loadMyTasks: () => loadMyTasks() }));

const { default: Card } = await import('./FieldStateAndGateCard.svelte');
const { default: Search } = await import('./KendalaSearch.svelte');
const { default: Page } = await import('./+page.svelte');

const FLOW: any = {
	id: 'lh', title: 'Laporan Harian', description: 'd', lanes: [{ key: 'lap', label: 'LAPANGAN' }, { key: 'adm', label: 'ADMIN' }], edges: [],
	nodes: [
		{ id: 'mulai', type: 'start', lane: 'lap', col: 0, label: 'Mulai', desc: '' },
		{ id: 'foto', type: 'task', lane: 'lap', col: 1, label: 'Foto Berita Acara', desc: 'ambil foto', pic: 'Mandor', sla_hours: 4, actions: [{ label: 'Form Laporan', href: '/laporan' }], gates: [{ key: 'G_FOTO', modul: 'project_report', documentType: 'laporan_harian' }] },
		{ id: 'cek', type: 'task', lane: 'adm', col: 2, label: 'Verifikasi', desc: 'cek', pic: 'Finance', actions: [], gates: [] }
	]
};
const INFO = { mode: 'hard', nama: 'Foto BA wajib', message: 'Foto BA belum ada', hint: 'Ambil dari 2 sisi', owner_role: 'Finance', bypass: 'override_gm', checklist: [{ label: 'Foto sisi kiri', wajib: true, tips: 'terang' }, { label: 'Foto sisi kanan', wajib: false, tips: null }] };

let box: HTMLElement | null, inst: any;
const settle = async () => { for (let i = 0; i < 12; i++) { await new Promise((r) => setTimeout(r, 0)); flushSync(); } };
const $ = (s: string) => box!.querySelector(s) as HTMLElement | null;
const $$ = (s: string) => [...box!.querySelectorAll(s)] as HTMLElement[];
async function mountIt(Comp: any, props: any) {
	Element.prototype.scrollIntoView = () => {};
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(Comp, { target: box, props });
	await settle();
}
const click = async (el: HTMLElement | null | undefined) => { el!.click(); await settle(); };

beforeEach(() => {
	search = '';
	vi.clearAllMocks();
	loadGateInfo.mockResolvedValue({ available: true, gates: { G_FOTO: INFO } });
	searchKendala.mockResolvedValue({ hits: [] });
	loadFlowIndex.mockResolvedValue({ flows: [{ id: 'lh', title: 'Laporan Harian', description: 'd', version: 1, node_count: 3 }, { id: 'f2', title: 'Alur F2', description: 'd', version: 1, node_count: 1 }], source: 'directus' });
	loadFlowById.mockImplementation(async (id: string) => ({ flow: id === 'lh' ? FLOW : { ...FLOW, id }, source: 'directus' }));
	loadMyTasks.mockResolvedValue({ posisi: null, tasks: [], source: 'none' });
	loadFlowChain.mockResolvedValue({ chain: null, source: 'directus' });
	globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as any;
});
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; localStorage.clear(); });

describe('FieldStateAndGateCard', () => {
	it('terlipat dulu & TIDAK mengunduh gate; ringkasan jumlah langkah/gate tampil', async () => {
		await mountIt(Card, { flow: FLOW, flowId: 'lh' });
		expect($('[data-testid="gate-card"]')!.textContent).toContain('2 langkah');
		expect($('[data-testid="gate-card"]')!.textContent).toContain('1 langkah dijaga 1 gate');
		expect(loadGateInfo).not.toHaveBeenCalled();
		expect($$('ol li')).toHaveLength(0);
	});

	it('dibuka → memuat gate SEKALI; langkah berurutan tanpa Mulai; ketuk langkah → PIC, formulir, syarat & cara lolos', async () => {
		await mountIt(Card, { flow: FLOW, flowId: 'lh' });
		await click($('[data-testid="gate-card-toggle"]'));
		expect(loadGateInfo).toHaveBeenCalledTimes(1);
		expect(loadGateInfo).toHaveBeenCalledWith('lh');
		expect($$('ol > li').map((l) => l.textContent!.replace(/\s+/g, ' '))[0]).toContain('Foto Berita Acara');
		expect($$('ol > li')).toHaveLength(2);
		await click($('#gc-step-foto button'));
		const item = $('[data-testid="gate-item"]')!;
		expect(item.textContent).toContain('Foto BA wajib');
		expect(item.textContent).toContain('Wajib lolos');
		expect(item.textContent).toContain('Foto BA belum ada');
		expect(item.textContent).toContain('Cara lolos: Ambil dari 2 sisi');
		expect(item.textContent).toContain('Foto sisi kiri');
		expect(item.textContent).toContain('(opsional)');
		expect(item.textContent).toContain('Finance');
		expect(item.textContent).toContain('persetujuan manajemen');
		expect(($('#gc-step-foto a') as HTMLAnchorElement).getAttribute('href')).toBe('/laporan');
		expect($('#gc-step-foto')!.textContent).toContain('4 jam');
	});

	it('tutup-buka kartu tidak memuat ulang; langkah tanpa gate dijelaskan', async () => {
		await mountIt(Card, { flow: FLOW, flowId: 'lh' });
		const t = $('[data-testid="gate-card-toggle"]');
		await click(t); await click(t); await click(t);
		expect(loadGateInfo).toHaveBeenCalledTimes(1);
		await click($('#gc-step-cek button'));
		expect($('#gc-step-cek')!.textContent).toContain('tidak dijaga gate');
	});

	it('deep-link fokus pada langkah ber-gate → kartu langsung terbuka dan langkah itu terbuka', async () => {
		await mountIt(Card, { flow: FLOW, flowId: 'lh', fokus: 'foto' });
		expect($('[data-testid="gate-card-toggle"]')!.getAttribute('aria-expanded')).toBe('true');
		expect($('[data-testid="gate-item"]')).toBeTruthy();
		expect(loadGateInfo).toHaveBeenCalledTimes(1);
	});

	it('fokus pada langkah tanpa gate → kartu tetap terlipat (tidak memboroskan kuota)', async () => {
		await mountIt(Card, { flow: FLOW, flowId: 'lh', fokus: 'cek' });
		expect($('[data-testid="gate-card-toggle"]')!.getAttribute('aria-expanded')).toBe('false');
		expect(loadGateInfo).not.toHaveBeenCalled();
	});

	it('offline: daftar gate tetap tampil dengan catatan; salinan lama diberi penanda', async () => {
		loadGateInfo.mockResolvedValue({ available: false, gates: {}, reason: 'offline' });
		await mountIt(Card, { flow: FLOW, flowId: 'lh' });
		await click($('[data-testid="gate-card-toggle"]'));
		expect($('[data-testid="gate-unavailable"]')).toBeTruthy();
		await click($('#gc-step-foto button'));
		expect($('[data-testid="gate-item"]')!.textContent).toContain('G_FOTO');
		expect($('[data-testid="gate-item"]')!.textContent).toContain('belum tersedia');
		unmount(inst); box!.remove();
		loadGateInfo.mockResolvedValue({ available: true, gates: { G_FOTO: INFO }, stale: true });
		await mountIt(Card, { flow: FLOW, flowId: 'lh' });
		await click($('[data-testid="gate-card-toggle"]'));
		expect($('[data-testid="gate-stale"]')).toBeTruthy();
	});

	it('alur tanpa langkah tugas → kartu tidak tampil', async () => {
		await mountIt(Card, { flow: { ...FLOW, nodes: [FLOW.nodes[0]] }, flowId: 'lh' });
		expect($('[data-testid="gate-card"]')).toBeNull();
	});
});

describe('KendalaSearch', () => {
	beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
	afterEach(() => vi.useRealTimers());
	const type = async (v: string) => {
		const i = $('#kendala-q') as HTMLInputElement;
		i.value = v;
		i.dispatchEvent(new Event('input', { bubbles: true }));
		await vi.advanceTimersByTimeAsync(450);
		await settle();
	};

	it('ketikan <2 huruf tidak memanggil server; jeda ketik (debounce) → satu panggilan', async () => {
		await mountIt(Search, { onjump: vi.fn() });
		await type('k');
		expect(searchKendala).not.toHaveBeenCalled();
		const i = $('#kendala-q') as HTMLInputElement;
		for (const v of ['ku', 'kur', 'kurv']) { i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); await vi.advanceTimersByTimeAsync(100); }
		await vi.advanceTimersByTimeAsync(450);
		await settle();
		expect(searchKendala).toHaveBeenCalledTimes(1);
		expect(searchKendala.mock.calls[0][0]).toBe('kurv');
	});

	it('hasil ditampilkan dengan jenis & alur; ketuk → loncat ke alur/langkah dan kotak dibersihkan', async () => {
		searchKendala.mockResolvedValue({ hits: [{ flow_id: 'lh', flow_title: 'Laporan Harian', node_id: 'foto', node_label: 'Foto Berita Acara', kind: 'kendala', snippet: 'Foto BA belum diunggah' }] });
		const onjump = vi.fn();
		await mountIt(Search, { onjump });
		await type('foto ba');
		const hit = $('[data-testid="kendala-hit"]')!;
		expect(hit.textContent).toContain('Kendala');
		expect(hit.textContent).toContain('Foto BA belum diunggah');
		expect(hit.textContent).toContain('Laporan Harian');
		await click(hit);
		expect(onjump).toHaveBeenCalledWith('lh', 'foto');
		expect(($('#kendala-q') as HTMLInputElement).value).toBe('');
		expect($('[data-testid="kendala-hit"]')).toBeNull();
	});

	it('tidak ada hasil → saran; galat jaringan → pesan, tidak crash', async () => {
		await mountIt(Search, { onjump: vi.fn() });
		await type('zzzz');
		expect($('[data-testid="kendala-empty"]')!.textContent).toContain('zzzz');
		searchKendala.mockResolvedValue({ hits: [], error: 'Tidak bisa terhubung. Pencarian butuh sinyal.' });
		await type('kurva');
		expect($('[data-testid="kendala-error"]')!.textContent).toContain('sinyal');
	});
});

describe('Halaman: integrasi', () => {
	it('memuat pencarian & kartu; hasil pencarian membuka alur target pada langkahnya (deep-link in-page)', async () => {
		searchKendala.mockResolvedValue({ hits: [{ flow_id: 'f2', flow_title: 'Alur F2', node_id: 'foto', node_label: 'Foto Berita Acara', kind: 'gate', snippet: 'G_FOTO' }] });
		vi.useFakeTimers({ shouldAdvanceTime: true });
		try {
			await mountIt(Page, {});
			expect($('[data-testid="kendala-search"]')).toBeTruthy();
			expect($('[data-testid="gate-card"]')).toBeTruthy();
			expect(loadGateInfo).not.toHaveBeenCalled(); // kartu terlipat: nol panggilan gate saat halaman dibuka
			const i = $('#kendala-q') as HTMLInputElement;
			i.value = 'g foto';
			i.dispatchEvent(new Event('input', { bubbles: true }));
			await vi.advanceTimersByTimeAsync(450);
			await settle();
			await click($('[data-testid="kendala-hit"]'));
			expect(loadFlowById).toHaveBeenLastCalledWith('f2');
			await settle();
			expect($('[data-testid="gate-card-toggle"]')!.getAttribute('aria-expanded')).toBe('true'); // fokus ke langkah ber-gate membuka kartu
		} finally {
			vi.useRealTimers();
		}
	});

	it('deep-link ?alur=lh&fokus=foto membuka kartu di langkah ber-gate', async () => {
		search = '?alur=lh&fokus=foto';
		await mountIt(Page, {});
		expect($('[data-testid="gate-card-toggle"]')!.getAttribute('aria-expanded')).toBe('true');
		expect(loadGateInfo).toHaveBeenCalledWith('lh');
	});
});
