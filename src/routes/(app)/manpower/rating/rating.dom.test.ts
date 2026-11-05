// @vitest-environment jsdom
// Nilai Pekerja massal: daftar tim, simpan hanya yang lengkap (1 request), kunci "sudah dinilai hari ini", mode workshop.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const svc = vi.hoisted(() => ({
	submitWorkerRatingsBulk: vi.fn(),
	fetchRecentRatings: vi.fn(),
	fetchWorkshops: vi.fn(),
	fetchWorkshopRoster: vi.fn(),
	fetchProjectRoster: vi.fn()
}));
vi.mock('$lib/services/workerRating', () => svc);
vi.mock('$lib/services/projectScope', () => ({
	getProjectsForCurrentUser: vi.fn(async () => [{ id: 7, name: 'Proyek Alpha' }]),
	getProjectScope: vi.fn(() => ({ unrestricted: false })),
	getWorkshopScope: vi.fn(() => ['ciketing'])
}));
vi.mock('$lib/services/projectSettings', () => ({ loadProjectSettings: vi.fn(async () => ({})) }));
vi.mock('$lib/stores/auth', async () => {
	const { writable } = await import('svelte/store');
	return { authStore: writable({ karyawanName: 'Budi PL' }) };
});
// Barrel @tabler/icons-svelte (ribuan modul) membuat jsdom menggantung — ikon tidak relevan utk perilaku.
vi.mock('@tabler/icons-svelte', () => ({ IconArrowLeft: () => {}, IconStar: () => {}, IconInfoCircle: () => {} }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

const { default: Page } = await import('./+page.svelte');

const today = new Date();
const p = (n: number) => String(n).padStart(2, '0');
const TODAY = `${today.getFullYear()}-${p(today.getMonth() + 1)}-${p(today.getDate())}`;

let box: HTMLElement | null, inst: any;
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); flushSync(); };
async function render() {
	window.matchMedia = window.matchMedia || (vi.fn((q: string) => ({ matches: false, media: q })) as any);
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(Page, { target: box });
	await tick();
}
const stars = (name: string, s: number, scope: ParentNode = box!) => (scope.querySelectorAll(`[aria-label="${name} ${s} bintang"]`) as NodeListOf<HTMLElement>);

beforeEach(() => {
	Object.values(svc).forEach((f) => f.mockReset());
	svc.fetchWorkshops.mockResolvedValue([{ id: 1, code: 'WS-CKT', name: 'Workshop Ciketing' }, { id: 2, code: 'MB-BLR', name: 'MB Balaraja' }]);
	svc.fetchProjectRoster.mockResolvedValue([{ manpowerId: 1, nama: 'Andi', jabatan: 'Painter' }, { manpowerId: 2, nama: 'Beni', jabatan: 'Blaster' }]);
	svc.fetchRecentRatings.mockResolvedValue([]);
	svc.submitWorkerRatingsBulk.mockResolvedValue({ success: true, count: 1 });
});
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; });

describe('Nilai Pekerja massal', () => {
	it('menampilkan seluruh tim; simpan hanya pekerja lengkap dalam SATU request', async () => {
		await render();
		expect(box!.textContent).toContain('Andi');
		expect(box!.textContent).toContain('Beni');
		const card = [...box!.querySelectorAll('div.rounded-xl.border')].find((c) => c.textContent!.includes('Andi')) as HTMLElement;
		stars('Kualitas', 5, card)[0].click(); stars('Safety', 4, card)[0].click(); stars('Ketepatan', 3, card)[0].click();
		// Beni hanya sebagian (partial) → tidak ikut
		const card2 = [...box!.querySelectorAll('div.rounded-xl.border')].find((c) => c.textContent!.includes('Beni')) as HTMLElement;
		stars('Kualitas', 2, card2)[0].click();
		flushSync();
		expect(box!.textContent).toContain('1 pekerja belum lengkap');
		const save = [...box!.querySelectorAll('button')].find((b) => b.textContent!.includes('Simpan 1 Penilaian')) as HTMLElement;
		expect(save).toBeTruthy();
		save.click();
		await tick();
		expect(svc.submitWorkerRatingsBulk).toHaveBeenCalledTimes(1);
		const payloads = svc.submitWorkerRatingsBulk.mock.calls[0][0];
		expect(payloads).toEqual([expect.objectContaining({ manpower_id: 1, project_id: 7, kualitas: 5, safety: 4, ketepatan: 3, dinilai_oleh: 'Budi PL' })]);
		expect(box!.textContent).toContain('1 penilaian tersimpan');
	});

	it('pekerja yang sudah dinilai hari ini di proyek yang sama terkunci dan tidak dikirim', async () => {
		svc.fetchRecentRatings.mockResolvedValue([{ manpower_id: 1, tanggal: TODAY, project_id: 7 }]);
		await render();
		expect(box!.textContent).toContain('Sudah dinilai hari ini');
		const fill = [...box!.querySelectorAll('button')].find((b) => b.textContent!.includes('Isi 4★ yang kosong')) as HTMLElement;
		fill.click(); flushSync();
		const save = [...box!.querySelectorAll('button')].find((b) => b.textContent!.includes('Simpan')) as HTMLElement;
		expect(save.textContent).toContain('Simpan 1 Penilaian'); // hanya Beni
		save.click(); await tick();
		expect(svc.submitWorkerRatingsBulk.mock.calls[0][0].map((x: any) => x.manpower_id)).toEqual([2]);
	});

	it('mode workshop: roster workshop_manpower, project_id null + workshop_id', async () => {
		svc.fetchWorkshopRoster.mockResolvedValue([{ id: 1, manpower_id: 705, karyawan_nama: 'Candra', jabatan: 'Painter', status: 'aktif' }]);
		await render();
		const tab = [...box!.querySelectorAll('[role="tab"]')].find((t) => t.textContent!.includes('Per Workshop')) as HTMLElement;
		tab.click(); await tick();
		expect(svc.fetchWorkshopRoster).toHaveBeenCalledWith(1);
		expect(box!.textContent).toContain('Candra');
		const fill = [...box!.querySelectorAll('button')].find((b) => b.textContent!.includes('Isi 4★ yang kosong')) as HTMLElement;
		fill.click(); flushSync();
		([...box!.querySelectorAll('button')].find((b) => b.textContent!.includes('Simpan 1 Penilaian')) as HTMLElement).click();
		await tick();
		const [pl] = svc.submitWorkerRatingsBulk.mock.calls[0][0];
		expect(pl).toMatchObject({ manpower_id: 705, project_id: null, workshop_id: 1 });
		expect(pl.catatan).toBe('');
	});

	it('pengguna tanpa cakupan workshop tidak melihat tab workshop; gagal simpan menampilkan error', async () => {
		const scope = await import('$lib/services/projectScope');
		(scope.getWorkshopScope as any).mockReturnValueOnce([]);
		svc.submitWorkerRatingsBulk.mockResolvedValue({ success: false, count: 0, error: 'Directus 403' });
		await render();
		expect([...box!.querySelectorAll('[role="tab"]')]).toHaveLength(0);
		([...box!.querySelectorAll('button')].find((b) => b.textContent!.includes('Isi 4★ yang kosong')) as HTMLElement).click(); flushSync();
		([...box!.querySelectorAll('button')].find((b) => b.textContent!.includes('Simpan 2 Penilaian')) as HTMLElement).click();
		await tick();
		expect(box!.querySelector('[role="alert"]')!.textContent).toContain('Directus 403');
	});
});
