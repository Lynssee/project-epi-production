// @vitest-environment jsdom
// Halaman Alur Kerja (lapangan) — keterangan kedudukan Master/Induk/IK & drill-down anak kerja naungan (Fase 4).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

let search = '?alur=m1';
vi.mock('$app/state', () => ({ page: { get url() { return new URL('http://x/panduan/alur' + search); } } }));

const HIER_INDEX = [
	{
		id: 'm1',
		title: 'Alur Stock Opname',
		description: 'Master Stock Opname',
		version: 1,
		node_count: 5,
		kategori_sop: 'master' as const,
		sop_code: 'SOP-LOG-002',
		approval_status: 'published',
		row_id: 12
	},
	{
		id: 'i1',
		title: 'Stock Opname Bulanan',
		description: 'Induk Bulanan',
		version: 1,
		node_count: 4,
		kategori_sop: 'induk' as const,
		sop_code: 'SOP-PRJ-320',
		approval_status: 'published',
		row_id: 749,
		parent_row_id: 12
	},
	{
		id: 't1',
		title: 'IK Blind Count Lapangan',
		description: 'IK Blind Count',
		version: 1,
		node_count: 3,
		kategori_sop: 'turunan' as const,
		sop_code: 'IK-LOG-001',
		approval_status: 'draft',
		row_id: 904,
		parent_row_id: 749
	}
];

const mkFlow = (id: string) => {
	const meta = HIER_INDEX.find((f) => f.id === id)!;
	return {
		id: meta.id,
		title: meta.title,
		description: meta.description,
		kategori_sop: meta.kategori_sop,
		sop_code: meta.sop_code,
		approval_status: meta.approval_status,
		lanes: [{ key: 'a', label: 'CHECKER' }],
		nodes: [
			{ id: 'n1', type: 'task', lane: 'a', col: 0, label: `Langkah ${meta.id}`, desc: 'Detail langkah', actions: [] }
		],
		edges: [],
		version: 1
	};
};

const loadFlowIndex = vi.fn();
const loadFlowById = vi.fn();
const loadMyTasks = vi.fn();
const loadFlowChain = vi.fn();

vi.mock('$lib/services/processGuidanceFlowsApi', () => ({
	loadFlowIndex: () => loadFlowIndex(),
	loadFlowById: (id: string) => loadFlowById(id),
	loadFlowChain: (id: string) => loadFlowChain(id)
}));
vi.mock('$lib/services/processGuidanceMineApi', () => ({ loadMyTasks: () => loadMyTasks() }));

const { default: Page } = await import('./+page.svelte');

let box: HTMLElement | null = null;
let inst: any = null;
const settle = async () => {
	for (let i = 0; i < 10; i++) {
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
	}
};

async function render() {
	Element.prototype.scrollIntoView = () => {};
	window.scrollTo = () => {};
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(Page, { target: box, props: {} });
	await settle();
}

beforeEach(() => {
	search = '?alur=m1';
	loadFlowIndex.mockResolvedValue({ flows: HIER_INDEX, source: 'directus' });
	loadFlowById.mockImplementation(async (id: string) => ({ flow: mkFlow(id), source: 'directus' }));
	loadMyTasks.mockResolvedValue({ posisi: null, tasks: [], source: 'none' });
	loadFlowChain.mockResolvedValue({ chain: null, source: 'directus' });
});

afterEach(() => {
	if (inst) unmount(inst);
	box?.remove();
	inst = null;
	box = null;
	document.body.innerHTML = '';
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('Halaman Alur Kerja — keterangan peran & drill-down Induk / IK (Fase 4)', () => {
	it('Master menampilkan keterangan tegas + kartu daftar Induk & IK (termasuk Menunggu Pengesahan) serta navigasi ketuk 1x', async () => {
		const fetchMock = vi.fn(async (url: any) => {
			if (String(url).includes('hierarchy_config=1')) {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						success: true,
						config: {
							labelMaster: 'MASTER SOP',
							labelInduk: 'SOP INDUK',
							labelTurunan: 'ANAK KERJA / IK',
							defaultIncludeDraftApproval: true
						}
					})
				} as any;
			}
			return { ok: true, status: 200, json: async () => ({ success: true }) } as any;
		});
		vi.stubGlobal('fetch', fetchMock);

		await render();

		const banner = box!.querySelector('[data-testid="field-hierarchy-statement"]')!;
		expect(banner.textContent).toContain('Ini adalah MASTER SOP');
		expect(banner.textContent).toContain('1 SOP INDUK');
		expect(banner.textContent).toContain('1 ANAK KERJA / IK');

		const card = box!.querySelector('[data-testid="field-hierarchy-card"]')!;
		const cardTxt = card.textContent!.replace(/\s+/g, ' ');
		expect(cardTxt).toContain('SOP-PRJ-320');
		expect(cardTxt).toContain('Stock Opname Bulanan');
		expect(cardTxt).toContain('IK-LOG-001');
		expect(cardTxt).toContain('IK Blind Count Lapangan');
		expect(cardTxt).toContain('Menunggu Pengesahan');

		// Toggle sembunyikan anak yang masih Menunggu Pengesahan
		const draftToggle = box!.querySelector('[data-testid="toggle-field-draft"]') as HTMLButtonElement;
		draftToggle.click();
		await settle();
		expect(box!.querySelector('[data-testid="field-hierarchy-card"]')!.textContent).not.toContain('IK-LOG-001');
		draftToggle.click();
		await settle();
		expect(box!.querySelector('[data-testid="field-hierarchy-card"]')!.textContent).toContain('IK-LOG-001');

		// Ketuk kartu IK Blind Count Lapangan -> langsung buka IK t1
		const ikBtn = [...box!.querySelectorAll('[data-testid="field-hierarchy-item"]')].find((b) =>
			b.textContent!.includes('IK-LOG-001')
		) as HTMLButtonElement;
		ikBtn.click();
		await settle();

		expect(loadFlowById).toHaveBeenLastCalledWith('t1');
		const nextBanner = box!.querySelector('[data-testid="field-hierarchy-statement"]')!.textContent!;
		expect(nextBanner).toContain('Ini adalah ANAK KERJA / IK');
		expect(nextBanner).toContain('[SOP-PRJ-320]');
		expect(nextBanner).toContain('Master: [SOP-LOG-002]');
	});

	it('menghormati label kustom app_settings & tetap jalan tanpa crash saat offline', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }) as any);
		search = '?alur=i1';
		await render();

		const banner = box!.querySelector('[data-testid="field-hierarchy-statement"]')!.textContent!;
		expect(banner).toContain('Ini adalah SOP INDUK');
		expect(banner).toContain('[SOP-LOG-002]');
		const items = box!.querySelectorAll('[data-testid="field-hierarchy-item"]');
		expect(items).toHaveLength(1);
		expect(items[0].textContent).toContain('IK-LOG-001');
	});
});
