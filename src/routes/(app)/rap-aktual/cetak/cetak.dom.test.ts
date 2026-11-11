// @vitest-environment jsdom
// Lembar Pertanggungjawaban Anggaran Lapangan: render angka, LPJ "tidak terlacak", dan perilaku cetak (lembar dipindah ke <body>
// saat beforeprint lalu dikembalikan saat afterprint — teknik yang menghindari halaman kosong tambahan; terverifikasi dgn cetak PDF headless).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

vi.mock('$app/state', () => ({ page: { url: new URL('http://localhost/rap-aktual/cetak?project=7') } }));
vi.mock('$lib/services/projectScope', () => ({ getProjectsForCurrentUser: vi.fn(async () => [{ id: 7, name: 'Tangki Gresik', lokasi: 'Gresik' }]) }));
const load = vi.fn();
vi.mock('$lib/services/siteCostStatementApi', () => ({ loadSiteCostStatement: (p: any) => load(p) }));

const { default: Page } = await import('./+page.svelte');
const { buildSiteCostStatement } = await import('$lib/shared/siteCostStatement');

const statement = buildSiteCostStatement({
	comparison: { categories: { operasional: { rab: 1000, actual: 950 } }, grand_rab: 1000, grand_actual: 950 },
	categories: [{ id: 'operasional', label: 'Operasional' }],
	pas: [{ status: 'Dibukukan', kategori: 'operasional', total_amount: 250000, status_pertanggungjawaban: null }]
});

let box: HTMLElement | null, inst: any;
const settle = async () => { for (let i = 0; i < 10; i++) { await new Promise((r) => setTimeout(r, 0)); flushSync(); } };
async function render() {
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(Page, { target: box, props: {} });
	await settle();
}
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; vi.clearAllMocks(); });

describe('/rap-aktual/cetak', () => {
	it('menampilkan lembar, total, dan celah pelacakan LPJ (bukan tunggakan)', async () => {
		load.mockResolvedValue({ statement, gagal: [] });
		await render();
		const text = box!.textContent || '';
		expect(text).toContain('Tangki Gresik');
		expect(text).toContain('Operasional');
		expect(text).toContain('Tidak ada pengajuan bertanda LPJ "belum"');
		expect(text).toContain('1 pengajuan operasional sudah cair');
		expect(text).toContain('bukan tunggakan');
		// Teks panduan sengaja menyebut "tidak memuat nilai kontrak klien maupun laba"; yang dilarang adalah ANGKA/baris komersial.
		expect(text).not.toMatch(/margin|pendapatan|revenue|nilai po|subtotal/i);
		expect(box!.querySelector('.site-cost-sheet')?.textContent).not.toMatch(/laba|kontrak/i);
	});

	it('sumber gagal dimuat → peringatan tampil, bukan angka nol diam-diam', async () => {
		load.mockResolvedValue({ statement, gagal: ['RAP', 'Pengadaan PR/PO'] });
		await render();
		expect(box!.textContent).toContain('Sebagian data gagal dimuat: RAP, Pengadaan PR/PO');
	});

	it('beforeprint memindahkan lembar ke <body>; afterprint mengembalikannya ke posisi semula', async () => {
		load.mockResolvedValue({ statement, gagal: [] });
		await render();
		const wrap = box!.querySelector('.site-cost-sheet-wrap') as HTMLElement;
		expect(wrap.parentElement).toBe(box);
		window.dispatchEvent(new Event('beforeprint'));
		expect(wrap.parentElement).toBe(document.body);
		expect(wrap.classList.contains('site-cost-print-root')).toBe(true);
		window.dispatchEvent(new Event('afterprint'));
		expect(wrap.parentElement).toBe(box);
		expect(wrap.classList.contains('site-cost-print-root')).toBe(false);
	});

	it('tombol Cetak memanggil window.print() sinkron', async () => {
		load.mockResolvedValue({ statement, gagal: [] });
		const print = vi.fn();
		vi.stubGlobal('print', print);
		await render();
		(Array.from(box!.querySelectorAll('button')).find((b) => /Cetak/.test(b.textContent || '')) as HTMLButtonElement).click();
		expect(print).toHaveBeenCalledTimes(1);
		vi.unstubAllGlobals();
	});

	it('proyek di luar cakupan akses → pesan, tanpa memuat data', async () => {
		const { getProjectsForCurrentUser } = await import('$lib/services/projectScope');
		(getProjectsForCurrentUser as any).mockResolvedValueOnce([{ id: 99, name: 'Lain' }]);
		await render();
		expect(box!.textContent).toContain('tidak ditugaskan');
		expect(load).not.toHaveBeenCalled();
	});
});
