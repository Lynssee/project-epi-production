// @vitest-environment jsdom
// Pintasan belajar kontekstual (Inspection / Field Report / Pengajuan): tampil hanya bila ada kursus relevan; gagal tidak merusak halaman.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const gotoMock = vi.fn();
vi.mock('$app/navigation', () => ({ goto: (...a: any[]) => gotoMock(...a) }));

const getPintasan = vi.fn();
vi.mock('$lib/services/ess/training', () => ({ getPintasanBelajar: (...a: any[]) => getPintasan(...a) }));
const { default: Pintasan } = await import('./PintasanBelajar.svelte');

const ITEMS = [
	{ programId: 15, judul: 'QC Coating Inspection', kode: 'KC-P3-QC', pilar: 'technical', pilarLabel: 'Technical', durasiMenit: 45, progress: 0, wajib: true, status: 'baru' },
	{ programId: 13, judul: 'Sandblasting', kode: 'KC-P1-BLAST', pilar: 'technical', pilarLabel: 'Technical', durasiMenit: null, progress: 40, wajib: false, status: 'berjalan' }
];

let box: HTMLElement | null, inst: any;
const settle = async () => { for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 0)); flushSync(); } };
async function render(konteks = 'inspection') {
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(Pintasan, { target: box, props: { konteks } });
	await settle();
}
beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; vi.clearAllMocks(); });

describe('PintasanBelajar', () => {
	it('menampilkan kursus relevan dengan pilar, durasi, wajib, dan status; klik membuka kursusnya', async () => {
		getPintasan.mockResolvedValue({ items: ITEMS });
		await render('inspection');
		expect(getPintasan).toHaveBeenCalledWith('inspection');
		const text = box!.textContent!.replace(/\s+/g, ' ');
		expect(text).toContain('Belajar cepat untuk pekerjaan ini');
		expect(text).toContain('QC Coating Inspection');
		expect(text).toContain('45 mnt');
		expect(text).toContain('Wajib');
		expect(text).toContain('Belum dimulai');
		expect(text).toContain('Lanjutkan (40%)');
		(box!.querySelectorAll('button.hover-lift')[0] as HTMLButtonElement).click();
		expect(gotoMock).toHaveBeenCalledWith('/ess/pelatihan/15');
	});

	it('tanpa kursus relevan → tidak merender apa pun', async () => {
		getPintasan.mockResolvedValue({ items: [] });
		await render('pengajuan');
		expect(box!.querySelector('aside')).toBeNull();
	});

	it('gagal memuat → halaman induk tetap normal (tidak ada kartu, tidak melempar), kegagalan dilog', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		getPintasan.mockRejectedValue(new Error('HTTP 503'));
		await render();
		expect(box!.querySelector('aside')).toBeNull();
		expect(warn).toHaveBeenCalled();
	});

	it('tombol sembunyikan menutup kartu dan mengingatnya selama sesi (tanpa panggilan API saat dibuka lagi)', async () => {
		getPintasan.mockResolvedValue({ items: ITEMS });
		await render('field_report');
		(box!.querySelector('button[aria-label="Sembunyikan pintasan belajar"]') as HTMLButtonElement).click();
		flushSync();
		expect(box!.querySelector('aside')).toBeNull();
		unmount(inst); box!.remove(); inst = null;
		getPintasan.mockClear();
		await render('field_report');
		expect(getPintasan).not.toHaveBeenCalled();
		expect(box!.querySelector('aside')).toBeNull();
	});
});
