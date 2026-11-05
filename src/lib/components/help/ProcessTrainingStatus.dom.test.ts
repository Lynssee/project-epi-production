// @vitest-environment jsdom
// ProcessTrainingStatus: training terkait satu langkah + status SAYA; gagal muat → tetap tampil tanpa status.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const loadTrainingStatus = vi.fn();
vi.mock('$lib/services/processGuidanceTrainingApi', () => ({ loadTrainingStatus: (ids: number[]) => loadTrainingStatus(ids) }));
const { default: Status } = await import('./ProcessTrainingStatus.svelte');

const item = (over: any) => ({ id: 13, kode: 'KC-P1', judul: 'Sandblasting', terbit: true, self_enroll: true, status_saya: 'belum', progress: null, tenggat: null, ...over });
const link = (id: number, over: any = {}) => ({ program_id: id, scope: 'langkah', wajib: false, catatan: '', ...over });
let box: HTMLElement | null, inst: any;
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; vi.clearAllMocks(); });
async function render(links: any[]) {
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(Status, { target: box, props: { links } });
	for (let i = 0; i < 6; i++) { await Promise.resolve(); flushSync(); }
}
const items = () => [...box!.querySelectorAll('[data-testid="training-item"]')];

describe('ProcessTrainingStatus', () => {
	it('tanpa tautan: tidak menampilkan apa pun dan TIDAK memanggil API', async () => {
		await render([]);
		expect(box!.querySelector('[data-testid="training-status"]')).toBeNull();
		expect(loadTrainingStatus).not.toHaveBeenCalled();
	});

	it('satu panggilan untuk semua program; judul + status saya + tombol sesuai status', async () => {
		loadTrainingStatus.mockResolvedValue({ ok: true, items: [item({ id: 13, status_saya: 'lulus' }), item({ id: 14, judul: 'Coating', status_saya: 'berjalan', progress: 40.4 }), item({ id: 18, judul: 'K3', status_saya: 'belum', self_enroll: false, tenggat: '2026-12-01' })] });
		await render([link(13), link(14), link(18, { wajib: true, scope: 'alur', catatan: 'Semua personel' })]);
		expect(loadTrainingStatus).toHaveBeenCalledTimes(1);
		expect(loadTrainingStatus).toHaveBeenCalledWith([13, 14, 18]);
		const rows = items().map((r) => r.textContent!.replace(/\s+/g, ' '));
		expect(rows[0]).toContain('Sandblasting');
		expect(rows[0]).toContain('✅ Lulus');
		expect(rows[0]).toContain('Buka lagi');
		expect(rows[1]).toContain('⏳ Berjalan 40%');
		expect(rows[1]).toContain('Lanjutkan');
		expect(rows[2]).toContain('Wajib');
		expect(rows[2]).toContain('○ Belum diikuti');
		expect(rows[2]).toContain('Semua personel');
		expect(rows[2]).toContain('Tenggat: 2026-12-01');
		expect(rows[2]).toContain('Lihat program'); // tidak self-enroll
		expect(box!.querySelector('a')!.getAttribute('href')).toBe('/ess/pelatihan/13');
	});

	it('belum diikuti + self-enroll → "Mulai belajar"; tenggat tidak ditampilkan bila sudah lulus', async () => {
		loadTrainingStatus.mockResolvedValue({ ok: true, items: [item({ status_saya: 'belum', self_enroll: true }), item({ id: 14, status_saya: 'lulus', tenggat: '2026-01-01' })] });
		await render([link(13), link(14)]);
		expect(items()[0].textContent).toContain('Mulai belajar');
		expect(items()[1].textContent).not.toContain('Tenggat');
	});

	it('program draf → "Belum tersedia" tanpa tautan; program tak ada di master → "tidak tersedia"', async () => {
		loadTrainingStatus.mockResolvedValue({ ok: true, items: [item({ id: 17, judul: 'Produk Cat', terbit: false })] });
		await render([link(17), link(99)]);
		expect(items()[0].textContent).toContain('Belum tersedia');
		expect(items()[0].querySelector('a')).toBeNull();
		expect(items()[1].textContent).toContain('Program #99');
		expect(items()[1].textContent).toContain('tidak tersedia');
	});

	it('gagal memuat status: daftar training tetap tampil (judul "Program #id") + catatan, tanpa tombol palsu', async () => {
		loadTrainingStatus.mockResolvedValue({ ok: false, items: [] });
		await render([link(13)]);
		expect(items()[0].textContent).toContain('Program #13');
		expect(box!.querySelector('[data-testid="status-gagal"]')).not.toBeNull();
		expect(box!.querySelector('[data-testid="status-saya"]')).toBeNull();
		expect(box!.querySelector('[data-testid="buka-training"]')).toBeNull();
	});

	it('menyebut bahwa "Wajib" hanya informasi', async () => {
		loadTrainingStatus.mockResolvedValue({ ok: true, items: [item({})] });
		await render([link(13, { wajib: true })]);
		expect(box!.textContent).toContain('hanya informasi');
	});
});
