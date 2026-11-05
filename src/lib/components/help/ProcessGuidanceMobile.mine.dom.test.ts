// @vitest-environment jsdom
// ProcessGuidanceMobile: tanda ⭐ "Tugas Anda" per langkah & per lane, target SLA di isi langkah.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import ProcessGuidanceMobile from './ProcessGuidanceMobile.svelte';

const FLOW: any = {
	id: 'f', title: 'F', description: '',
	lanes: [{ key: 'a', label: 'ADMIN' }, { key: 'b', label: 'GUDANG' }],
	nodes: [
		{ id: 'n1', type: 'task', lane: 'a', col: 0, label: 'Cek dokumen', desc: 'd', sla_hours: 8, actions: [] },
		{ id: 'n2', type: 'task', lane: 'a', col: 1, label: 'Setujui', desc: 'd', actions: [] },
		{ id: 'n3', type: 'task', lane: 'b', col: 2, label: 'Kirim', desc: 'd', actions: [] }
	],
	edges: [{ from: 'n1', to: 'n2' }, { from: 'n2', to: 'n3' }]
};
let box: HTMLElement | null, inst: any;
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; });
function render(props: any) {
	Element.prototype.scrollIntoView = () => {};
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(ProcessGuidanceMobile, { target: box, props });
	flushSync();
}

describe('ProcessGuidanceMobile — tugas saya & SLA', () => {
	it('lane berisi tugas saya menampilkan hitungan ⭐; langkah milik saya diberi tanda; lane lain tidak', () => {
		render({ flow: FLOW, mine: ['n1', 'n2', 'n3'] });
		const lanes = [...box!.querySelectorAll('section')];
		expect(lanes[0].querySelector('[data-testid="lane-mine"]')!.textContent).toContain('2');
		expect(lanes[1].querySelector('[data-testid="lane-mine"]')!.textContent).toContain('1');
		expect(box!.querySelector('#pg-node-n1 [data-testid="node-mine"]')).not.toBeNull(); // lane pertama terbuka
	});

	it('hanya langkah yang ada di daftar mine yang bertanda; tanpa mine tidak ada tanda apa pun', () => {
		render({ flow: FLOW, mine: ['n1'] });
		expect(box!.querySelector('#pg-node-n1 [data-testid="node-mine"]')).not.toBeNull();
		expect(box!.querySelector('#pg-node-n2 [data-testid="node-mine"]')).toBeNull();
		unmount(inst); box!.remove();
		render({ flow: FLOW });
		expect(box!.querySelector('[data-testid="lane-mine"]')).toBeNull();
		expect(box!.querySelector('[data-testid="node-mine"]')).toBeNull();
	});

	it('target SLA tampil di isi langkah hanya bila ada', () => {
		render({ flow: FLOW, fokus: 'n1' });
		expect(box!.querySelector('#pg-node-n1 [data-testid="node-sla"]')!.textContent).toContain('8 jam');
		(box!.querySelector('#pg-node-n2 > button') as HTMLElement).click();
		flushSync();
		expect(box!.querySelector('#pg-node-n2 [data-testid="node-sla"]')).toBeNull();
	});
});

// ── T5: Training terkait + status saya di isi langkah ──
vi.mock('$lib/services/processGuidanceTrainingApi', () => ({
	loadTrainingStatus: vi.fn(async (ids: number[]) => ({ ok: true, items: ids.map((id) => ({ id, kode: '', judul: `Program ${id}`, terbit: true, self_enroll: true, status_saya: id === 13 ? 'lulus' : 'belum', progress: null, tenggat: null })) }))
}));
describe('ProcessGuidanceMobile — training terkait (T5)', () => {
	const FLOW_T: any = {
		...FLOW,
		training: [{ program_id: 18, wajib: true }],
		nodes: FLOW.nodes.map((n: any) => (n.id === 'n1' ? { ...n, training_ids: [13] } : n))
	};
	it('langkah dengan tautan menampilkan Training terkait + status saya (langkah + alur); langkah tanpa tautan sendiri mewarisi tautan alur', async () => {
		render({ flow: FLOW_T, fokus: 'n1' });
		for (let i = 0; i < 6; i++) { await Promise.resolve(); flushSync(); }
		const st = box!.querySelector('#pg-node-n1 [data-testid="training-status"]')!;
		expect(st.textContent).toContain('Program 13');
		expect(st.textContent).toContain('✅ Lulus');
		expect(st.textContent).toContain('Program 18');
		expect(st.textContent).toContain('○ Belum diikuti');
	});
	it('alur tanpa tautan training: tidak ada bagian Training terkait', async () => {
		render({ flow: FLOW, fokus: 'n1' });
		await Promise.resolve(); flushSync();
		expect(box!.querySelector('[data-testid="training-status"]')).toBeNull();
	});
});
