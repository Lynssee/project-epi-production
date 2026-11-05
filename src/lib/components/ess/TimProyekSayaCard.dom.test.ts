// @vitest-environment jsdom
// Kartu "Performa Tim Proyek Saya": hanya untuk leader dengan tim; gagal/bukan leader => tidak tampil; buka proyek => daftar pekerja.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const svc = vi.hoisted(() => ({ getTimProyekSaya: vi.fn() }));
vi.mock('$lib/services/ess/timProyekSaya', () => svc);
const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto }));
const { default: Card } = await import('./TimProyekSayaCard.svelte');

const anggota = (id: number, o: any = {}) => ({ manpower_id: id, nama: `P${id}`, jabatan: 'Painter', composite: 70, badge: 'direkomendasikan', ratingCount: 0, kehadiranPct: 90, perluPerhatian: false, belumDinilai: true, ...o });
const DATA = {
	available: true, adalahLeader: true,
	proyek: [{ project_id: 1, nama: 'Proyek Alpha', anggota: [anggota(1, { composite: 40, perluPerhatian: true, badge: 'perlu_pembinaan' }), anggota(2)], ringkas: { total: 2, belumDinilai: 2, perluPerhatian: 1, ratingKurang: 2 } }],
	ringkas: { proyek: 1, total: 2, belumDinilai: 2, perluPerhatian: 1 }
};

let box: HTMLElement | null, inst: any;
const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); flushSync(); };
async function render() { box = document.createElement('div'); document.body.appendChild(box); inst = mount(Card, { target: box }); await tick(); }
beforeEach(() => { svc.getTimProyekSaya.mockReset(); goto.mockReset(); });
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; });

describe('TimProyekSayaCard', () => {
	it('leader dengan tim: ringkasan proyek tampil; buka proyek menampilkan pekerja + badge + peringatan belum dinilai', async () => {
		svc.getTimProyekSaya.mockResolvedValue(DATA);
		await render();
		expect(box!.querySelector('[data-testid="tim-proyek"]')).not.toBeNull();
		expect(box!.textContent).toContain('2 dari 2 belum pernah dinilai');
		expect(box!.textContent).not.toContain('P1'); // tertutup sebelum dibuka
		(box!.querySelector('button[aria-expanded]') as HTMLElement).click(); flushSync();
		expect(box!.textContent).toContain('P1');
		expect(box!.textContent).toContain('Perlu Pembinaan');
		expect(box!.textContent).toContain('0 penilaian');
	});
	it('tombol "Nilai pekerja" menuju halaman penilaian massal', async () => {
		svc.getTimProyekSaya.mockResolvedValue(DATA);
		await render();
		([...box!.querySelectorAll('button')].find((b) => b.textContent!.includes('Nilai pekerja')) as HTMLElement).click();
		expect(goto).toHaveBeenCalledWith('/manpower/rating');
	});
	it('bukan leader / tidak tersedia / tim kosong => kartu tidak tampil sama sekali', async () => {
		for (const d of [{ available: true, adalahLeader: false, proyek: [] }, { available: false, reason: 'x' }, { available: true, adalahLeader: true, proyek: [] }]) {
			svc.getTimProyekSaya.mockResolvedValue(d);
			await render();
			expect(box!.querySelector('[data-testid="tim-proyek"]')).toBeNull();
			unmount(inst); box!.remove(); inst = box = null;
		}
	});
	it('bagian internal: bawahan dengan skor rilis, urut sesuai server, penanda turun, "belum ada skor"; tombol Nilai pekerja hanya jika ada tim outsource', async () => {
		svc.getTimProyekSaya.mockResolvedValue({
			available: true, adalahLeader: false, proyek: [],
			internal: { sumber: 'atasan', ringkas: { anggota: 2, denganSkor: 1, belumAdaSkor: 1, rataSkor: 70, turun: 1 }, anggota: [
				{ karyawan_id: 1, nama: 'Budi', posisi: 'Staff', periode: 'Q3-2026', total_skor: 70, skor_general: 80, skor_spesifik: 60, delta: -15, turun: true },
				{ karyawan_id: 2, nama: 'Sari', posisi: '', periode: null, total_skor: null, skor_general: null, skor_spesifik: null, delta: null, turun: false }
			] }
		});
		await render();
		const el = box!.querySelector('[data-testid="tim-internal"]')!;
		expect(el).not.toBeNull();
		expect(el.textContent).toContain('2 bawahan langsung');
		expect(el.textContent).toContain('1 turun ≥ 10 poin');
		expect(el.textContent).toContain('Budi');
		expect(el.textContent).toContain('▼ 15');
		expect(el.textContent).toContain('belum ada skor');
		expect(el.textContent).toContain('sama dengan yang dilihat masing-masing karyawan');
		expect([...box!.querySelectorAll('button')].some((b) => b.textContent!.includes('Nilai pekerja'))).toBe(false);
	});
	it('internal null (gagal dimuat) atau kosong => bagian internal tidak tampil; tim outsource tetap', async () => {
		svc.getTimProyekSaya.mockResolvedValue({ ...DATA, internal: null });
		await render();
		expect(box!.querySelector('[data-testid="tim-internal"]')).toBeNull();
		expect(box!.querySelector('[data-testid="tim-proyek"]')).not.toBeNull();
		expect([...box!.querySelectorAll('button')].some((b) => b.textContent!.includes('Nilai pekerja'))).toBe(true);
	});
});
