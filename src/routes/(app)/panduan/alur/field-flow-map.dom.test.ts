// @vitest-environment jsdom
// Fase 4 — kartu Siklus: panduan cabang keputusan, Peta Alur Mini (offline), dan simulasi pra-periksa syarat gate. Render nyata (jsdom).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const loadGateInfo = vi.fn();
vi.mock('./fieldGateApi', () => ({ loadGateInfo: (id: string) => loadGateInfo(id), searchKendala: vi.fn() }));

const { default: Card } = await import('./FieldStateAndGateCard.svelte');

const INFO = {
	mode: 'hard', nama: 'Foto BA wajib', message: 'Foto BA belum ada', hint: 'Ambil dari 2 sisi', owner_role: 'Finance', bypass: null,
	checklist: [{ label: 'Foto sisi kiri', wajib: true, tips: null }, { label: 'Foto sisi kanan', wajib: true, tips: null }, { label: 'Catatan cuaca', wajib: false, tips: null }]
};
const FLOW: any = {
	id: 'so', title: 'Sales Order', description: 'd', lanes: [{ key: 'l', label: 'LAPANGAN' }],
	nodes: [
		{ id: 'mulai', type: 'start', lane: 'l', col: 0, row: 0, label: 'Mulai', desc: '' },
		{ id: 'input', type: 'task', lane: 'l', col: 1, row: 0, label: 'Input SO', desc: '', pic: 'Sales', actions: [{ label: 'Form SO', href: '/so' }], gates: [{ key: 'G_FOTO', modul: 'project_report', documentType: 'laporan_harian' }] },
		{ id: 'setuju', type: 'decision', lane: 'l', col: 2, row: 0, label: 'Disetujui?', desc: '', gates: [] },
		{ id: 'kirim', type: 'task', lane: 'l', col: 3, row: 0, label: 'Kirim', desc: '', gates: [] },
		{ id: 'akhir', type: 'end', lane: 'l', col: 4, row: 0, label: 'Selesai', desc: '' }
	],
	edges: [
		{ from: 'mulai', to: 'input' }, { from: 'input', to: 'setuju' },
		{ from: 'setuju', to: 'kirim', label: 'Ya' }, { from: 'setuju', to: 'input', label: 'Revisi' },
		{ from: 'kirim', to: 'akhir' }
	]
};

let box: HTMLElement | null, inst: any;
const settle = async () => { for (let i = 0; i < 12; i++) { await new Promise((r) => setTimeout(r, 0)); flushSync(); } };
const $ = (s: string) => box!.querySelector(s) as HTMLElement | null;
const $$ = (s: string) => [...box!.querySelectorAll(s)] as HTMLElement[];
// Elemen SVG di jsdom tidak punya .click() — kirim event klik sungguhan agar berlaku untuk HTML maupun SVG.
const click = async (el: Element | null | undefined) => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await settle(); };
async function mountIt(props: any) {
	Element.prototype.scrollIntoView = () => {};
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(Card, { target: box, props });
	await settle();
}
const openCard = async () => click($('[data-testid="gate-card-toggle"]'));

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
	loadGateInfo.mockResolvedValue({ available: true, gates: { G_FOTO: INFO } });
});
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; localStorage.clear(); });

describe('cabang keputusan di kartu Siklus', () => {
	it('langkah keputusan: lencana, blok "Cabang Keputusan" berisi kalimat Ya / Revisi; langkah biasa: "Setelah langkah ini"', async () => {
		await mountIt({ flow: FLOW, flowId: 'so' });
		await openCard();
		expect($('#gc-step-setuju')!.textContent).toContain('Keputusan');
		await click($('#gc-step-setuju > button'));
		const br = $('#gc-step-setuju [data-testid="step-branches"]')!;
		expect(br.textContent).toContain('Cabang Keputusan');
		const items = $$('#gc-step-setuju [data-testid="branch-item"]').map((b) => b.textContent!.replace(/\s+/g, ' ').trim());
		expect(items).toEqual(['Jika “Ya” → lanjut ke Langkah 3 (Kirim)', '↩ Jika “Revisi” → kembali ke Langkah 1 (Input SO)']);
		await click($('#gc-step-kirim > button'));
		expect($('#gc-step-kirim [data-testid="step-branches"]')!.textContent).toContain('Setelah langkah ini');
		expect($('#gc-step-kirim [data-testid="branch-item"]')!.textContent).toContain('Proses selesai');
		expect(($('#gc-step-kirim [data-testid="branch-item"]') as HTMLButtonElement).disabled).toBe(true);
	});

	it('ketuk cabang → loncat membuka rincian langkah tujuan', async () => {
		await mountIt({ flow: FLOW, flowId: 'so' });
		await openCard();
		await click($('#gc-step-setuju > button'));
		await click($$('#gc-step-setuju [data-testid="branch-item"]')[1]); // Revisi → Input SO
		expect($('#gc-step-input > button')!.getAttribute('aria-expanded')).toBe('true');
	});
});

describe('Peta Alur Mini', () => {
	it('tersembunyi dulu; tombol membuka diagram dari data alur di memori (tanpa memanggil server)', async () => {
		await mountIt({ flow: FLOW, flowId: 'so' });
		await openCard();
		loadGateInfo.mockClear();
		expect($('[data-testid="mini-map"]')).toBeNull();
		await click($('[data-testid="gate-map-toggle"]'));
		expect($('[data-testid="mini-map"]')).toBeTruthy();
		expect(loadGateInfo).not.toHaveBeenCalled();
		expect($('[data-testid="mini-map-legend"]')!.textContent).toContain('Ketuk langkah');
		const texts = [...$('[data-testid="mini-map"]')!.querySelectorAll('svg text')].map((t) => t.textContent!.trim());
		expect(texts).toEqual(expect.arrayContaining(['Mulai', 'Input SO', 'Disetujui?', 'Kirim', 'Selesai', 'Ya']));
		expect(texts.some((t) => t.includes('Revisi'))).toBe(true);
		expect($('[data-testid="mini-map"] polygon')).toBeTruthy(); // belah ketupat keputusan
		expect($$('[data-testid="mini-node"]')).toHaveLength(3); // Mulai/Selesai tidak bisa diketuk
		await click($('[data-testid="gate-map-toggle"]'));
		expect($('[data-testid="mini-map"]')).toBeNull();
	});

	it('ketuk langkah di peta → rincian langkah itu terbuka di daftar', async () => {
		await mountIt({ flow: FLOW, flowId: 'so' });
		await openCard();
		await click($('[data-testid="gate-map-toggle"]'));
		await click($('[data-testid="mini-node"][data-node="kirim"]'));
		expect($('#gc-step-kirim > button')!.getAttribute('aria-expanded')).toBe('true');
	});

	it('ganti alur → peta ditutup lagi', async () => {
		await mountIt({ flow: FLOW, flowId: 'so' });
		await openCard();
		await click($('[data-testid="gate-map-toggle"]'));
		unmount(inst);
		box!.innerHTML = '';
		inst = mount(Card, { target: box!, props: { flow: { ...FLOW, id: 'lain' }, flowId: 'lain' } });
		await settle();
		expect($('[data-testid="mini-map"]')).toBeNull();
	});
});

describe('simulasi pra-periksa syarat gate', () => {
	it('gate Wajib: checklist bisa dicentang; progres & pesan siap muncul hanya bila semua WAJIB tercentang', async () => {
		await mountIt({ flow: FLOW, flowId: 'so' });
		await openCard();
		await click($('#gc-step-input > button'));
		expect($('[data-testid="gate-prep"]')!.textContent).toContain('0/3 siap');
		const boxes = () => $$('[data-testid="gate-prep-item"]') as HTMLInputElement[];
		await click(boxes()[0]);
		expect($('[data-testid="gate-prep"]')!.textContent).toContain('1/3 siap');
		expect($('[data-testid="gate-prep"]')!.textContent).toContain('Masih 1 syarat wajib');
		expect($('[data-testid="gate-prep-ready"]')).toBeNull();
		await click(boxes()[1]);
		expect($('[data-testid="gate-prep-ready"]')!.textContent).toContain('lanjut ke formulir');
		expect($('[data-testid="gate-prep"]')!.textContent).toContain('tidak dikirim ke server');
	});

	it('tersimpan di perangkat per alur: dibuka ulang tetap tercentang; Reset mengosongkan', async () => {
		await mountIt({ flow: FLOW, flowId: 'so' });
		await openCard();
		await click($('#gc-step-input > button'));
		await click(($$('[data-testid="gate-prep-item"]') as HTMLInputElement[])[0]);
		expect(JSON.parse(localStorage.getItem('epi_gate_prep_v1_so')!)).toEqual(['G_FOTO::Foto sisi kiri']);
		unmount(inst);
		box!.innerHTML = '';
		inst = mount(Card, { target: box!, props: { flow: FLOW, flowId: 'so', fokus: 'input' } });
		await settle();
		expect(($$('[data-testid="gate-prep-item"]') as HTMLInputElement[])[0].checked).toBe(true);
		await click($('[data-testid="gate-prep-reset"]'));
		expect(($$('[data-testid="gate-prep-item"]') as HTMLInputElement[])[0].checked).toBe(false);
		expect(localStorage.getItem('epi_gate_prep_v1_so')).toBeNull();
	});

	it('gate yang bukan Wajib/Perlu alasan tetap daftar baca biasa (tanpa kotak centang)', async () => {
		loadGateInfo.mockResolvedValue({ available: true, gates: { G_FOTO: { ...INFO, mode: 'warn' } } });
		await mountIt({ flow: FLOW, flowId: 'so' });
		await openCard();
		await click($('#gc-step-input > button'));
		expect($('[data-testid="gate-prep"]')).toBeNull();
		expect($('[data-testid="gate-item"]')!.textContent).toContain('Foto sisi kiri');
	});

	it('penyimpanan perangkat tidak tersedia → kartu tetap bekerja', async () => {
		const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('penuh'); });
		await mountIt({ flow: FLOW, flowId: 'so' });
		await openCard();
		await click($('#gc-step-input > button'));
		await click(($$('[data-testid="gate-prep-item"]') as HTMLInputElement[])[0]);
		expect($('[data-testid="gate-prep"]')!.textContent).toContain('1/3 siap');
		spy.mockRestore();
	});
});
