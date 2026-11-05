// @vitest-environment jsdom
// ProcessStepPeek: kartu bantuan inline di form lapangan (checklist, penyebab tertahan, gate, SLA) — diunduh malas saat dibuka.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const FLOW = {
	id: 'sales_to_inventory', title: 'Sales ke Inventory', description: '',
	lanes: [{ key: 'a', label: 'A' }],
	nodes: [
		{ id: 'survey', type: 'task', lane: 'a', col: 0, label: 'Survey lapangan', desc: 'Kunjungi lokasi', sla_hours: 24, checklist: ['Foto lokasi', 'Ukuran area'], blockers: ['Akses ditolak'], gates: [{ key: 'G_SURVEY_REQ', modul: 'sales', documentType: 'survey' }], actions: [] },
		{ id: 'kosong', type: 'task', lane: 'a', col: 1, label: 'Langkah polos', desc: '', actions: [] }
	],
	edges: []
};
const loadFlowById = vi.fn(async (_id: string) => ({ flow: FLOW, source: 'directus' }));
vi.mock('$lib/services/processGuidanceFlowsApi', () => ({ loadFlowById: (id: string) => loadFlowById(id) }));
vi.mock('$lib/services/processGuidanceTrainingApi', () => ({
	loadTrainingStatus: vi.fn(async (ids: number[]) => ({ ok: true, items: ids.map((id) => ({ id, kode: '', judul: `Program ${id}`, terbit: true, self_enroll: true, status_saya: 'belum', progress: null, tenggat: null })) }))
}));
const { default: Peek } = await import('./ProcessStepPeek.svelte');

let box: HTMLElement | null, inst: any;
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; vi.clearAllMocks(); });
const settle = async () => { for (let i = 0; i < 6; i++) { await Promise.resolve(); flushSync(); } };
function render(props: any) {
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(Peek, { target: box, props });
	flushSync();
}
const toggle = () => box!.querySelector('button') as HTMLButtonElement;

describe('ProcessStepPeek', () => {
	it('tertutup saat halaman dimuat dan TIDAK mengunduh alur sampai diketuk', () => {
		render({ fokus: 'survey' });
		expect(loadFlowById).not.toHaveBeenCalled();
		expect(box!.querySelector('[data-testid="step-peek-body"]')).toBeNull();
		expect(toggle().getAttribute('aria-expanded')).toBe('false');
	});

	it('diketuk → checklist, penyebab tertahan, gate, SLA, dan tautan alur lengkap (alur bawaan sales_to_inventory)', async () => {
		render({ fokus: 'survey' });
		toggle().click();
		await settle();
		expect(loadFlowById).toHaveBeenCalledWith('sales_to_inventory');
		const body = box!.querySelector('[data-testid="step-peek-body"]')!;
		expect(body.textContent).toContain('Survey lapangan');
		expect(body.querySelector('[data-testid="peek-checklist"]')!.textContent).toContain('Foto lokasi');
		expect(body.querySelector('[data-testid="peek-blockers"]')!.textContent).toContain('Akses ditolak');
		expect(body.querySelector('[data-testid="peek-gates"]')!.textContent).toContain('Dijaga 1 gate sistem');
		expect(body.textContent).toContain('Target selesai 24 jam');
		expect(body.querySelector('a')!.getAttribute('href')).toBe('/panduan/alur?alur=sales_to_inventory&fokus=survey');
	});

	it('diunduh sekali saja walau dibuka-tutup berkali-kali; alur lain lewat prop alur', async () => {
		render({ fokus: 'survey', alur: 'alur_lain', label: 'Panduan' });
		expect(toggle().textContent).toContain('Panduan');
		toggle().click(); await settle();
		toggle().click(); flushSync();
		toggle().click(); await settle();
		expect(loadFlowById).toHaveBeenCalledTimes(1);
		expect(loadFlowById).toHaveBeenCalledWith('alur_lain');
		expect(box!.querySelector('a')!.getAttribute('href')).toContain('alur=alur_lain');
	});

	it('langkah tanpa checklist/gate hanya menampilkan isi yang ada; langkah tak dikenal / alur gagal → pesan + tetap ada tautan', async () => {
		render({ fokus: 'kosong' });
		toggle().click(); await settle();
		expect(box!.querySelector('[data-testid="peek-checklist"]')).toBeNull();
		expect(box!.querySelector('[data-testid="peek-gates"]')).toBeNull();
		unmount(inst); box!.remove();
		loadFlowById.mockResolvedValueOnce({ flow: null as any, source: 'local' });
		render({ fokus: 'survey' });
		toggle().click(); await settle();
		expect(box!.textContent).toContain('belum tersedia');
		expect(box!.querySelector('a')).not.toBeNull();
	});
});

// ── T5: status training di peek form ──
describe('ProcessStepPeek — training (T5)', () => {
	it('menampilkan Training terkait (langkah + alur) bila ada tautan; tidak ada bagian itu bila tidak', async () => {
		loadFlowById.mockResolvedValueOnce({ flow: { ...FLOW, training: [{ program_id: 18, wajib: true }], nodes: FLOW.nodes.map((n: any) => (n.id === 'survey' ? { ...n, training_ids: [13] } : n)) }, source: 'directus' });
		render({ fokus: 'survey' });
		toggle().click(); await settle();
		const st = box!.querySelector('[data-testid="training-status"]')!;
		expect(st.textContent).toContain('Program 13');
		expect(st.textContent).toContain('Program 18');
		unmount(inst); box!.remove();
		render({ fokus: 'kosong' });
		toggle().click(); await settle();
		expect(box!.querySelector('[data-testid="training-status"]')).toBeNull();
	});
});
