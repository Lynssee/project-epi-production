// @vitest-environment jsdom
// Halaman Alur Kerja (lapangan): daftar ringkas + satu alur, pencarian, "Tugas Saya", deep-link ?alur=&fokus=.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

let search = '';
vi.mock('$app/state', () => ({ page: { get url() { return new URL('http://x/panduan/alur' + search); } } }));

const IDX = Array.from({ length: 10 }, (_, i) => ({ id: `f${i}`, title: `Alur ${i}${i === 3 ? ' Gudang' : ''}`, description: `desc ${i}`, version: 1, node_count: 2, kategori_sop: 'turunan' as const }));
// Teks opsi tanpa emoji & spasi berlebih (halaman memberi awalan ikon sifat prosedur 🏗️/🚨/⚖️/📋 lalu ikon kategori SOP 📄/🌟/📘).
const optText = (o: Element) => o.textContent!.replace(/\s+/g, ' ').replace(/^(?:(?:🏗️|🚨|⚖️|📋|📄|🌟|📘)\s*)+/u, '').trim();
const mkFlow = (id: string) => ({
	id, title: `Alur ${id}`, description: `desc ${id}`, lanes: [{ key: 'a', label: 'ADMIN' }],
	nodes: [{ id: 'n1', type: 'task', lane: 'a', col: 0, label: `Langkah ${id}`, desc: 'd', actions: [] }, { id: 'n2', type: 'task', lane: 'a', col: 1, label: 'Dua', desc: 'd', actions: [] }],
	edges: [], version: 1
});
const loadFlowIndex = vi.fn();
const loadFlowById = vi.fn();
const loadMyTasks = vi.fn();
const loadFlowChain = vi.fn();
vi.mock('$lib/services/processGuidanceFlowsApi', () => ({ loadFlowIndex: () => loadFlowIndex(), loadFlowById: (id: string) => loadFlowById(id), loadFlowChain: (id: string) => loadFlowChain(id) }));
vi.mock('$lib/services/processGuidanceMineApi', () => ({ loadMyTasks: () => loadMyTasks() }));
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
const TASK = { flow_id: 'f2', flow_title: 'Alur f2', node_id: 'n2', label: 'Dua', lane_label: 'ADMIN', type: 'task', sla_hours: 8, kpi_code: '', gate_keys: [], has_actions: true };

beforeEach(() => {
	search = '';
	loadFlowIndex.mockResolvedValue({ flows: IDX, source: 'directus' });
	loadFlowById.mockImplementation(async (id: string) => ({ flow: mkFlow(id), source: 'directus' }));
	loadMyTasks.mockResolvedValue({ posisi: null, tasks: [], source: 'none' });
	loadFlowChain.mockResolvedValue({ chain: null, source: 'directus' });
});
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; vi.clearAllMocks(); });

describe('Halaman Alur Kerja — antrean baca SOP offline (R-L4)', () => {
	const realFetch = globalThis.fetch;
	afterEach(() => { globalThis.fetch = realFetch; localStorage.clear(); });
	const tandai = () => [...box!.querySelectorAll('button')].find((b) => b.textContent!.includes('Tandai Paham')) as HTMLElement;

	it('offline: konfirmasi tetap berlaku di perangkat, masuk antrean + indikator; saat online terkirim otomatis dengan waktu baca asli', async () => {
		globalThis.fetch = vi.fn(async () => { throw new TypeError('offline'); }) as any;
		await render();
		tandai().click();
		await settle();
		expect(box!.textContent).toContain('Terkonfirmasi');
		const q = JSON.parse(localStorage.getItem('sop_read_pending_sync')!);
		expect(q).toHaveLength(1);
		expect(q[0]).toMatchObject({ flow_key: 'f0', version_seq: 1 });
		expect(box!.querySelector('[data-testid="read-pending"]')!.textContent).toContain('1 konfirmasi baca');

		const sent: any[] = [];
		globalThis.fetch = vi.fn(async (_u: any, init: any) => { sent.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ success: true }) } as any; }) as any;
		window.dispatchEvent(new Event('online'));
		await settle();
		expect(sent).toEqual([{ flow_key: 'f0', version_seq: 1, queued: true, read_at: q[0].read_at }]);
		expect(localStorage.getItem('sop_read_pending_sync')).toBe('[]');
		expect(box!.querySelector('[data-testid="read-pending"]')).toBeNull();
	});
	it('online normal: terkirim langsung, tidak ada antrean maupun indikator', async () => {
		globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }) as any) as any;
		await render();
		tandai().click();
		await settle();
		expect(localStorage.getItem('sop_read_pending_sync')).toBeNull();
		expect(box!.querySelector('[data-testid="read-pending"]')).toBeNull();
	});
	it('server 5xx diperlakukan seperti offline (masuk antrean)', async () => {
		globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }) as any) as any;
		await render();
		tandai().click();
		await settle();
		expect(JSON.parse(localStorage.getItem('sop_read_pending_sync')!)).toHaveLength(1);
	});
});

describe('Halaman Alur Kerja — Rantai Serah-Terima', () => {
	const CHAIN = {
		upstream: [{ code: 'H04', doc_label: 'PR Barang', handoff_type: 'dokumen', own_node_id: 'n1', own_node_label: 'Langkah f0', flow_id: 'f7', flow_title: 'Alur Hulu', node_id: 'x', node_label: 'Cek' }],
		downstream: [{ code: 'H19', doc_label: 'BAST', handoff_type: 'dokumen', own_node_id: 'n2', own_node_label: 'Dua', flow_id: 'f8', flow_title: 'Alur Hilir', node_id: '', node_label: '' }]
	};
	it('kartu hulu/hilir tampil di atas, pengingat di bawah; tombol lompat membuka alur seberang', async () => {
		loadFlowChain.mockResolvedValue({ chain: CHAIN, source: 'directus' });
		await render();
		expect(loadFlowChain).toHaveBeenCalledWith('f0');
		expect(box!.querySelector('[data-testid="handoff-chain-full"]')!.textContent).toContain('Alur Hulu');
		expect(box!.querySelector('[data-testid="handoff-chain-hilir"]')!.textContent).toContain('Alur Hilir');
		const btn = [...box!.querySelectorAll('[data-testid="handoff-chain-full"] button')].find((b) => b.textContent!.includes('Buka alur')) as HTMLElement;
		Element.prototype.scrollIntoView = () => {};
		window.scrollTo = () => {};
		btn.click();
		await settle();
		expect(loadFlowById).toHaveBeenLastCalledWith('f7');
	});
	it('rantai gagal dimuat → kartu tidak tampil, alur tetap terbaca', async () => {
		loadFlowChain.mockResolvedValue({ chain: null, source: 'local' });
		await render();
		expect(box!.querySelector('[data-testid^="handoff-chain"]')).toBeNull();
		expect(box!.querySelector('[data-testid="process-guidance-mobile"]')).not.toBeNull();
	});
});

describe('Halaman Alur Kerja', () => {
	it('mengunduh DAFTAR ringkas + SATU alur (bawaan sales_to_inventory bila ada), bukan semua alur', async () => {
		loadFlowIndex.mockResolvedValue({ flows: [{ ...IDX[0], id: 'sales_to_inventory', title: 'Sales ke Inventory' }, ...IDX.slice(1)], source: 'directus' });
		await render();
		expect(loadFlowIndex).toHaveBeenCalledTimes(1);
		expect(loadFlowById).toHaveBeenCalledTimes(1);
		expect(loadFlowById).toHaveBeenCalledWith('sales_to_inventory');
	});

	it('deep-link ?alur=f4&fokus=n2 membuka alur itu dan langkahnya', async () => {
		search = '?alur=f4&fokus=n2';
		await render();
		expect(loadFlowById).toHaveBeenCalledWith('f4');
		expect(box!.querySelector('#pg-node-n2 [aria-expanded="true"]')).not.toBeNull();
	});

	it('alur di URL tidak ada di daftar → jatuh ke alur pertama daftar', async () => {
		search = '?alur=tidak-ada';
		await render();
		expect(loadFlowById).toHaveBeenCalledWith('f0');
	});

	it('pencarian menyaring pilihan (daftar >8); alur yang sedang dibuka tetap ada', async () => {
		await render();
		const input = box!.querySelector('input[type="search"]') as HTMLInputElement;
		input.value = 'gudang'; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
		const opts = [...box!.querySelectorAll('select option')].map(optText);
		expect(opts).toContain('Alur 3 Gudang');
		expect(opts).toContain('Alur 0'); // alur aktif tidak hilang dari <select>
		expect(opts).toHaveLength(2);
	});

	it('mengganti alur lewat pilihan memuat alur itu saja', async () => {
		await render();
		const sel = box!.querySelector('select') as HTMLSelectElement;
		sel.value = 'f5'; sel.dispatchEvent(new Event('change', { bubbles: true }));
		await settle();
		expect(loadFlowById).toHaveBeenLastCalledWith('f5');
		expect(box!.textContent).toContain('Langkah f5');
	});

	it('Tugas Saya: kartu terlipat dulu; ketuk langkah membuka alurnya; filter "hanya alur saya"; ⭐ di pilihan & langkah', async () => {
		loadMyTasks.mockResolvedValue({ posisi: { id: 30, nama: 'PROJECT LEADER', via: 'jabatan_id' }, tasks: [TASK], source: 'directus' });
		await render();
		const card = box!.querySelector('[data-testid="tugas-saya"]')!;
		expect(card.textContent).toContain('PROJECT LEADER');
		expect(card.textContent).toContain('1 langkah di 1 alur');
		expect(card.querySelector('ul')).toBeNull(); // terlipat
		(card.querySelector('button') as HTMLElement).click(); flushSync();
		const row = [...card.querySelectorAll('ul button')][0] as HTMLElement;
		expect(row.textContent).toContain('target 8 jam');
		expect(row.textContent).toContain('ada formulir');
		row.click(); await settle();
		expect(loadFlowById).toHaveBeenLastCalledWith('f2');
		expect(box!.querySelector('#pg-node-n2 [data-testid="node-mine"]')).not.toBeNull();
		const cb = box!.querySelector('input[type="checkbox"]') as HTMLInputElement;
		cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
		const opts = [...box!.querySelectorAll('select option')].map(optText);
		expect(opts).toEqual(['⭐ Alur 2']);
	});

	it('jabatan tak terhubung → petunjuk (bukan galat); jabatan terhubung tapi belum ada tugas → petunjuk admin', async () => {
		loadMyTasks.mockResolvedValue({ posisi: null, tasks: [], source: 'directus', reason: 'Minta HRD mengisi jabatan.' });
		await render();
		expect(box!.querySelector('[data-testid="tugas-saya-kosong"]')!.textContent).toContain('Minta HRD');
		unmount(inst); box!.remove();
		loadMyTasks.mockResolvedValue({ posisi: { id: 1, nama: 'STAFF', via: 'jabatan_id' }, tasks: [], source: 'directus' });
		await render();
		expect(box!.querySelector('[data-testid="tugas-saya-kosong"]')!.textContent).toContain('STAFF');
	});

	it('alur tidak ditemukan → pesan, tidak crash; offline (cached) diberi keterangan', async () => {
		loadFlowById.mockResolvedValue({ flow: null, source: 'directus' });
		await render();
		expect(box!.querySelector('[role="alert"]')!.textContent).toContain('tidak ditemukan');
		unmount(inst); box!.remove();
		loadFlowIndex.mockResolvedValue({ flows: IDX, source: 'cached' });
		loadFlowById.mockImplementation(async (id: string) => ({ flow: mkFlow(id), source: 'cached' }));
		await render();
		expect(box!.textContent).toContain('salinan terakhir yang tersimpan');
	});
});

// ── T5: chip training pada Tugas Saya ──
const loadTrainingStatus = vi.fn();
vi.mock('$lib/services/processGuidanceTrainingApi', () => ({ loadTrainingStatus: (ids: number[]) => loadTrainingStatus(ids) }));
describe('Halaman Alur Kerja — training pada Tugas Saya (T5)', () => {
	const stt = (id: number, over: any = {}) => ({ id, kode: '', judul: `P${id}`, terbit: true, self_enroll: true, status_saya: 'belum', progress: null, tenggat: null, ...over });
	it('chip "🎓 n training · m belum selesai" per tugas dari satu panggilan status; program draf tidak dihitung', async () => {
		loadMyTasks.mockResolvedValue({ posisi: { id: 30, nama: 'PL', via: 'jabatan_id' }, source: 'directus', tasks: [{ ...TASK, training: [{ program_id: 13, wajib: false }, { program_id: 17, wajib: false }] }] });
		loadTrainingStatus.mockResolvedValue({ ok: true, items: [stt(13), stt(17, { terbit: false })] });
		await render();
		expect(loadTrainingStatus).toHaveBeenCalledTimes(1);
		(box!.querySelector('[data-testid="tugas-saya"] button') as HTMLElement).click(); flushSync();
		const chip = box!.querySelector('[data-testid="task-training"]')!;
		expect(chip.textContent!.replace(/\s+/g, ' ')).toContain('🎓 1 training · 1 belum selesai');
	});
	it('semua lulus → "semua lulus"; status gagal / tugas tanpa training → tanpa chip dan tanpa galat', async () => {
		loadMyTasks.mockResolvedValue({ posisi: { id: 30, nama: 'PL', via: 'jabatan_id' }, source: 'directus', tasks: [{ ...TASK, training: [{ program_id: 13, wajib: false }] }] });
		loadTrainingStatus.mockResolvedValue({ ok: true, items: [stt(13, { status_saya: 'lulus' })] });
		await render();
		(box!.querySelector('[data-testid="tugas-saya"] button') as HTMLElement).click(); flushSync();
		expect(box!.querySelector('[data-testid="task-training"]')!.textContent).toContain('semua lulus');
		unmount(inst); box!.remove();
		loadTrainingStatus.mockResolvedValue({ ok: false, items: [] });
		await render();
		(box!.querySelector('[data-testid="tugas-saya"] button') as HTMLElement).click(); flushSync();
		expect(box!.querySelector('[data-testid="task-training"]')).toBeNull();
		expect(box!.querySelector('[data-testid="tugas-saya"]')).not.toBeNull();
	});
});

describe('Halaman Alur Kerja — indikator gate pada Tugas Saya', () => {
	it('tugas ber-gate menampilkan jumlah gate (tanpa panggilan API tambahan); tugas tanpa gate tidak', async () => {
		loadTrainingStatus.mockResolvedValue({ ok: true, items: [] });
		loadMyTasks.mockResolvedValue({
			posisi: { id: 30, nama: 'PL', via: 'jabatan_id' },
			source: 'directus',
			tasks: [{ ...TASK, gate_keys: ['G_A', 'G_B'] }, { ...TASK, node_id: 'n9', label: 'Tanpa gate', gate_keys: [] }]
		});
		await render();
		(box!.querySelector('[data-testid="tugas-saya"] button') as HTMLElement).click(); flushSync();
		const chips = box!.querySelectorAll('[data-testid="task-gates"]');
		expect(chips).toHaveLength(1);
		expect(chips[0].textContent!.replace(/\s+/g, ' ')).toContain('2 gate menjaga langkah ini');
	});
});

describe('Halaman Alur Kerja — Kontak Approver pada Tugas Saya', () => {
	const contacts = {
		58: { nama: 'PROJECT MANAGER', total: 6, people: [{ id: 9, nama: 'Pak PM', wa: '6281234567890' }, { id: 10, nama: 'Bu Tanpa HP', wa: '' }] },
		70: { nama: 'FINANCE', total: 0, people: [] }
	};
	it('nama penerima serah-terima menjadi tautan WhatsApp (wa.me + pesan awal); tanpa nomor → teks biasa; jabatan kosong → keterangan', async () => {
		loadTrainingStatus.mockResolvedValue({ ok: true, items: [] });
		loadMyTasks.mockResolvedValue({ posisi: { id: 30, nama: 'PL', via: 'jabatan_id' }, source: 'directus', tasks: [{ ...TASK, handoff_to: [58, 70] }], contacts });
		await render();
		(box!.querySelector('[data-testid="tugas-saya"] button') as HTMLElement).click(); flushSync();
		const card = box!.querySelector('[data-testid="task-handoff"]')!;
		const a = card.querySelector('a') as HTMLAnchorElement;
		expect(a.href).toMatch(/^https:\/\/wa\.me\/6281234567890\?text=/);
		expect(a.rel).toContain('noopener');
		expect(card.querySelectorAll('a')).toHaveLength(1);
		const txt = card.textContent!.replace(/\s+/g, ' ');
		expect(txt).toContain('Serah-terima ke PROJECT MANAGER');
		expect(txt).toContain('Bu Tanpa HP (no. HP kosong)');
		expect(txt).toContain('+4 lainnya');
		expect(txt).toContain('belum ada karyawan aktif');
	});
	it('tanpa handoff_to / tanpa contacts (mis. salinan perangkat) → tidak ada bagian kontak dan tidak error', async () => {
		loadTrainingStatus.mockResolvedValue({ ok: true, items: [] });
		loadMyTasks.mockResolvedValue({ posisi: { id: 30, nama: 'PL', via: 'jabatan_id' }, source: 'cached', tasks: [{ ...TASK, handoff_to: [58] }] });
		await render();
		(box!.querySelector('[data-testid="tugas-saya"] button') as HTMLElement).click(); flushSync();
		expect(box!.querySelector('[data-testid="task-handoff"]')).toBeNull();
	});
});

describe('Halaman Alur Kerja — breadcrumb Master › Induk › IK & filter "Belum Saya Baca" (Fase 8b/8c)', () => {
	const realFetch = globalThis.fetch;
	afterEach(() => { globalThis.fetch = realFetch; localStorage.clear(); });
	const HIER = [
		{ id: 'm1', title: 'Master Proyek', description: '', version: 1, node_count: 2, kategori_sop: 'master' as const, row_id: 1 },
		{ id: 'i1', title: 'SOP Induk Scaffolding', description: '', version: 1, node_count: 2, kategori_sop: 'induk' as const, row_id: 2, parent_row_id: 1 },
		{ id: 't1', title: 'IK Pasang Perancah', description: '', version: 1, node_count: 2, kategori_sop: 'turunan' as const, row_id: 3, parent_row_id: 2 }
	];
	const mineFetch = (keys: string[]) => (globalThis.fetch = vi.fn(async (u: any) => ({ ok: true, status: 200, json: async () => (String(u).includes('mine=1') ? { success: true, confirmed_keys: keys } : { success: true }) }) as any) as any);

	it('IK menampilkan jejak Master › Induk › IK; mengetuk induk membuka alur induk', async () => {
		search = '?alur=t1';
		loadFlowIndex.mockResolvedValue({ flows: HIER, source: 'directus' });
		mineFetch([]);
		await render();
		const nav = box!.querySelector('nav[aria-label="Posisi alur"]')!;
		expect(nav).not.toBeNull();
		expect(nav.textContent).toContain('Master Proyek');
		expect(nav.textContent).toContain('SOP Induk Scaffolding');
		expect(nav.textContent).toContain('IK Pasang Perancah');
		loadFlowById.mockClear();
		([...nav.querySelectorAll('button')].find((b) => b.textContent!.includes('SOP Induk')) as HTMLElement).click();
		await settle();
		expect(loadFlowById).toHaveBeenCalledWith('i1');
	});

	it('alur tanpa induk terbit: tidak ada breadcrumb (bukan galat)', async () => {
		search = '?alur=m1';
		loadFlowIndex.mockResolvedValue({ flows: HIER, source: 'directus' });
		mineFetch([]);
		await render();
		expect(box!.querySelector('nav[aria-label="Posisi alur"]')).toBeNull();
	});

	it('filter "Hanya yang belum saya baca": menyembunyikan alur yang sudah saya konfirmasi (server + catatan lokal), alur terbuka tetap ada', async () => {
		search = '?alur=f1';
		localStorage.setItem('sop_read_f2', '1 Nov 2026');
		mineFetch(['f0']);
		await render();
		const cb = [...box!.querySelectorAll('label')].find((l) => l.textContent!.includes('belum saya baca'))!;
		expect(cb.textContent).toContain('(8)'); // 10 alur - f0 (server) - f2 (lokal)
		const optIds = () => [...box!.querySelectorAll('select option')].map((o) => (o as HTMLOptionElement).value);
		expect(optIds()).toHaveLength(10);
		(cb.querySelector('input') as HTMLInputElement).click();
		await settle();
		expect(optIds()).not.toContain('f0');
		expect(optIds()).not.toContain('f2');
		expect(optIds()).toContain('f1');
		expect(optIds()).toHaveLength(8);
	});

	it('server tidak terjangkau: filter tetap bekerja dari catatan lokal perangkat', async () => {
		localStorage.setItem('sop_read_f0', '1 Nov 2026');
		globalThis.fetch = vi.fn(async () => { throw new TypeError('offline'); }) as any;
		await render();
		const cb = [...box!.querySelectorAll('label')].find((l) => l.textContent!.includes('belum saya baca'))!;
		expect(cb.textContent).toContain('(9)');
	});
});
