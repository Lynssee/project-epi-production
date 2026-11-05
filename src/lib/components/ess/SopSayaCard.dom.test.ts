// @vitest-environment jsdom
// Auto-Bridge Fase 4: kartu "Training dari SOP Saya" (ESS Pelatihan) & "Kesiapan SOP Saya" (ESS Kinerja) dari satu data.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const gotoMock = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (...a: any[]) => gotoMock(...a) }));

const DATA: any = {
	available: true, terhubung: true, jabatan: { id: 30, nama: 'PROJECT LEADER' }, grace_hari: 30,
	training: { value: 50, note: 'x' }, readiness: { value: 50, note: 'y' },
	programs: [
		{ program_id: 14, judul: 'K3 Dasar', kode: '', state: 'belum', wajib: true, alur: [{ flow_title: 'Alur Coating', node_label: 'Persiapan' }], alur_total: 1 },
		{ program_id: 16, judul: 'Safety Induction', kode: '', state: 'tidak_terdaftar', wajib: false, alur: [{ flow_title: 'Alur Coating', node_label: 'Mulai' }], alur_total: 2 },
		{ program_id: 13, judul: 'Sandblasting', kode: '', state: 'lulus', wajib: false, alur: [{ flow_title: 'Alur Coating', node_label: 'Blasting' }], alur_total: 1 }
	],
	flows: [{ flow_id: 'f1', flow_title: 'Alur Coating', langkah: 4, siap: 2, belum_siap: 1, ditunda: 1, perlu_training: [{ program_id: 14, judul: 'K3 Dasar' }, { program_id: 16, judul: 'Safety Induction' }] }],
	ringkas: { lulus: 1, belum: 1, tenggang: 0, tidak_terdaftar: 1, total: 3 }
};
let current: any = DATA;
vi.mock('$lib/services/ess/sopSaya', async () => {
	const real = await vi.importActual<any>('$lib/services/ess/sopSaya');
	return { ...real, getSopSaya: vi.fn(async () => current) };
});
const { default: SopSayaCard } = await import('./SopSayaCard.svelte');

let box: HTMLElement | null, inst: any;
async function render(variant: 'training' | 'kesiapan') {
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(SopSayaCard, { target: box, props: { variant } });
	flushSync();
	for (let i = 0; i < 10; i++) await Promise.resolve();
	flushSync();
	return box;
}
beforeEach(() => { current = DATA; gotoMock.mockClear(); });
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; });

describe('SopSayaCard variant=training', () => {
	it('daftar training: status, alur asal, tanda Wajib; yang belum terdaftar tanpa tombol Belajar', async () => {
		const el = await render('training');
		expect(el.querySelector('[data-testid="sop-saya-training"]')).toBeTruthy();
		const t = el.textContent!;
		expect(t).toContain('Training dari SOP Saya');
		expect(t).toContain('PROJECT LEADER');
		expect(t).toContain('Dibutuhkan untuk alur');
		expect(t).toContain('Alur Coating');
		expect(t).toContain('langkah Persiapan');
		expect(t).toContain('Belum selesai');
		expect(t).toContain('Belum terdaftar');
		expect(t).toContain('Wajib');
		expect(t).toContain('+1 lainnya');
		const buka = [...el.querySelectorAll('button[aria-label^="Buka training"]')];
		expect(buka).toHaveLength(1); // K3 Dasar saja
	});
	it('ketuk Belajar membuka halaman program', async () => {
		const el = await render('training');
		(el.querySelector('button[aria-label^="Buka training K3 Dasar"]') as HTMLElement).click();
		expect(gotoMock).toHaveBeenCalledWith('/ess/pelatihan/14');
	});
	it('"Lihat semua" menampilkan juga yang sudah Lulus', async () => {
		const el = await render('training');
		expect(el.textContent).not.toContain('Sandblasting');
		([...el.querySelectorAll('button')].find((b) => b.textContent!.includes('Lihat semua 3')) as HTMLElement).click();
		flushSync();
		expect(el.textContent).toContain('Sandblasting');
		expect(el.textContent).toContain('Ringkas daftar');
	});
});

describe('SopSayaCard variant=kesiapan', () => {
	it('persentase, rincian per alur, dan saran training', async () => {
		const el = await render('kesiapan');
		const t = el.textContent!;
		expect(el.querySelector('[data-testid="sop-saya-kesiapan"]')).toBeTruthy();
		expect(t).toContain('Kesiapan SOP Saya');
		expect(t).toContain('50%');
		expect(t).toContain('2/4 langkah siap');
		expect(t).toContain('1 menunggu training');
		expect(t).toContain('selesaikan training berikut untuk mencapai 100%');
		(el.querySelector('ul button') as HTMLElement).click();
		expect(gotoMock).toHaveBeenCalledWith('/ess/pelatihan/14');
	});
	it('readiness null: "belum dinilai" + penjelasan KPI tidak berkurang', async () => {
		current = { ...DATA, readiness: null };
		const t = (await render('kesiapan')).textContent!;
		expect(t).toContain('belum dinilai');
		expect(t).toContain('Tidak ada yang mengurangi KPI Anda');
	});
});

describe('R6 checklist prasyarat proyek & R10 alur dikuasai', () => {
	const PRASYARAT = [
		{ program_id: 13, judul: 'Sandblasting', kode: 'KC-P1', state: 'lulus' },
		{ program_id: 18, judul: 'K3 / HSE', kode: 'KC-P6', state: 'tidak_terdaftar' },
		{ program_id: 14, judul: 'Coating', kode: 'KC-P2', state: 'tenggang' }
	];
	it('checklist tampil di variant training: ringkasan "N dari M", status, dan tombol hanya bila sudah terdaftar', async () => {
		current = { ...DATA, prasyarat: PRASYARAT };
		const el = await render('training');
		const box2 = el.querySelector('[data-testid="sop-prasyarat-proyek"]') as HTMLElement;
		expect(box2).toBeTruthy();
		expect(box2.textContent).toContain('Checklist Siap Proyek');
		expect(box2.textContent).toContain('1 dari 3');
		expect(box2.textContent).toContain('Belum terdaftar');
		expect(box2.querySelectorAll('button[aria-label^="Buka prasyarat"]')).toHaveLength(2); // yang belum terdaftar tanpa tombol
		(box2.querySelector('button[aria-label="Buka prasyarat Coating"]') as HTMLElement).click();
		expect(gotoMock).toHaveBeenCalledWith('/ess/pelatihan/14');
		expect(el.querySelector('[data-testid="sop-saya-training"]')).toBeTruthy(); // bagian SOP jabatan tetap ada
	});
	it('berlaku juga bila jabatan belum terhubung ke Peta Alur (hanya checklist, tanpa bagian SOP)', async () => {
		current = { available: true, terhubung: false, prasyarat: PRASYARAT };
		const el = await render('training');
		expect(el.querySelector('[data-testid="sop-prasyarat-proyek"]')).toBeTruthy();
		expect(el.querySelector('[data-testid="sop-saya-training"]')).toBeNull();
	});
	it('checklist tidak tampil di variant kesiapan; tanpa prasyarat → tidak ada checklist', async () => {
		current = { ...DATA, prasyarat: PRASYARAT };
		expect((await render('kesiapan')).querySelector('[data-testid="sop-prasyarat-proyek"]')).toBeNull();
		unmount(inst); box?.remove(); inst = box = null;
		current = DATA;
		expect((await render('training')).querySelector('[data-testid="sop-prasyarat-proyek"]')).toBeNull();
	});
	it('kesiapan: "menguasai X dari Y alur" + alur yang perlu ditingkatkan', async () => {
		current = { ...DATA, flows: [
			DATA.flows[0],
			{ flow_id: 'f2', flow_title: 'Alur Mixing', langkah: 3, siap: 3, belum_siap: 0, ditunda: 0, perlu_training: [] }
		] };
		const t = (await render('kesiapan')).querySelector('[data-testid="sop-alur-dikuasai"]')!.textContent!;
		expect(t).toContain('menguasai 1 dari 2 alur');
		expect(t).toContain('Perlu ditingkatkan: Alur Coating');
	});
});

describe('fail-soft', () => {
	it.each([
		['tidak tersedia', { available: false }],
		['jabatan belum terhubung', { available: true, terhubung: false }],
		['tanpa training', { ...DATA, programs: [] }]
	])('%s: kartu tidak tampil', async (_n, d) => {
		current = d;
		for (const v of ['training', 'kesiapan'] as const) {
			const el = await render(v);
			expect(el.querySelector('[data-testid]')).toBeNull();
			unmount(inst);
			el.remove();
			inst = box = null;
		}
	});
});
