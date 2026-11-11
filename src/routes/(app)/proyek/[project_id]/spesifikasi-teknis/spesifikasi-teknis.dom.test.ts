// @vitest-environment jsdom
// Kartu Spesifikasi Teknis lapangan: daftar objek, rincian lapisan, dan ambil foto per tahap.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { readable } from 'svelte/store';

const h = vi.hoisted(() => ({
	addStagePhoto: vi.fn(),
	fetchPhotos: vi.fn(),
	objects: [] as any[]
}));

vi.mock('$app/stores', () => ({ page: readable({ params: { project_id: '7' } }) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));
vi.mock('$lib/stores/auth', () => ({ authStore: readable({ karyawanName: 'Budi' }) }));
vi.mock('$lib/services/projects', () => ({ getProjectById: vi.fn(async () => ({ id: 7, name: 'Tangki A' })) }));
vi.mock('$lib/services/projectSpecApi', () => ({ fetchProjectObjectSpecs: vi.fn(async () => h.objects) }));
vi.mock('$lib/services/projectObjectPhotoApi', () => ({
	fetchObjectStagePhotos: (...a: any[]) => h.fetchPhotos(...a),
	addStagePhoto: (...a: any[]) => h.addStagePhoto(...a),
	// groupPhotos murni — disalin apa adanya agar modul asli (yang menarik firebase) tidak ikut dimuat
	groupPhotos: (rows: any[]) => {
		const out: Record<number, Record<string, any[]>> = {};
		for (const r of rows || []) ((out[r.project_object_id] ||= {})[r.tahap || ''] ||= []).push(r);
		return out;
	}
}));
vi.mock('$lib/utils/photoCompress', () => ({ compressPhoto: vi.fn(async (f: File) => f) }));
vi.mock('$lib/actions/secureAsset', () => ({ secureAssetSrc: () => ({}), openSecureAsset: vi.fn() }));

const { default: Page } = await import('./+page.svelte');
let box: HTMLElement | null, inst: any;

const obj = (over: any = {}) => ({
	id: 5, tipe: 'besi', nama: 'Rangka WF', qty: 4, satuan: 'Pcs', luas: null, berat_kg: null, dimensi: null, material: null, kondisi: null, foto_identitas: null,
	spec: { surface_preparation: { standar_sa: 'Sa 2.5' }, finishing: { tingkat_kilap: 'Glossy' }, sistem_lapisan: [{ tahap: 'Primer', target_micron: 75 }] },
	pengecualian: '', layers: [{ no: 1, tahap: 'Primer', merk: 'ZRE', target: 75, min: 60, max: 90 }], totalMicron: 75, ...over
});

async function render() {
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(Page, { target: box, props: {} });
	for (let i = 0; i < 10; i++) await Promise.resolve();
	flushSync();
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); flushSync(); };

beforeEach(() => { h.addStagePhoto.mockReset(); h.fetchPhotos.mockReset(); h.fetchPhotos.mockResolvedValue([]); h.objects = [obj()]; });
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; });

describe('halaman spesifikasi teknis lapangan', () => {
	it('objek tunggal terbuka otomatis: Sa, lapisan, total, dan tahap foto', async () => {
		await render();
		expect(box!.textContent).toContain('Rangka WF');
		expect(box!.textContent).toContain('Sa 2.5');
		expect(box!.textContent).toContain('75 µm');
		const stages = [...box!.querySelectorAll('[data-testid="foto-tahap"] .text-xs.font-semibold')].map((e) => e.textContent!.replace(/\s+/g, ' ').trim());
		expect(stages[0]).toContain('Blasting / persiapan permukaan (Sa 2.5)');
		expect(stages.some((s) => s.startsWith('L1 Primer'))).toBe(true);
		expect(stages.some((s) => s.startsWith('Hasil akhir'))).toBe(true);
	});

	it('ambil foto tahap → addStagePhoto dipanggil dengan kunci tahap & penulis, hitungan bertambah', async () => {
		h.addStagePhoto.mockImplementation(async (p: any) => ({ id: 99, project_object_id: p.objectId, tahap: p.stageKey, foto: 'f1', tanggal: '2026-11-06', aktivitas: 'x', dibuat_oleh: p.author, date_created: null }));
		await render();
		const inputs = box!.querySelectorAll<HTMLInputElement>('[data-testid="foto-tahap"] input[type="file"]');
		const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
		Object.defineProperty(inputs[1], 'files', { value: [file], configurable: true });
		inputs[1].dispatchEvent(new Event('change', { bubbles: true }));
		await flush();
		expect(h.addStagePhoto).toHaveBeenCalledTimes(1);
		expect(h.addStagePhoto.mock.calls[0][0]).toMatchObject({ objectId: 5, stageKey: 'lapisan_1', stageLabel: 'L1 Primer', author: 'Budi' });
		expect(box!.textContent).toContain('Foto tersimpan: L1 Primer');
		expect(box!.textContent).toContain('L1 Primer (1)');
	});

	it('unggah gagal → pesan error tampil, hitungan tidak berubah', async () => {
		h.addStagePhoto.mockRejectedValue(new Error('Foto gagal diunggah. Periksa koneksi lalu coba lagi.'));
		await render();
		const input = box!.querySelector<HTMLInputElement>('[data-testid="foto-tahap"] input[type="file"]')!;
		Object.defineProperty(input, 'files', { value: [new File(['x'], 'a.jpg')], configurable: true });
		input.dispatchEvent(new Event('change', { bubbles: true }));
		await flush();
		expect(box!.textContent).toContain('Foto gagal diunggah');
		expect(box!.textContent).toContain('Hasil akhir (0)');
	});

	it('gagal memuat foto lama → spesifikasi tetap tampil + pesan', async () => {
		h.fetchPhotos.mockRejectedValue(new Error('boom'));
		await render();
		expect(box!.textContent).toContain('Rangka WF');
		expect(box!.textContent).toContain('Foto progres belum bisa dimuat');
	});
});
