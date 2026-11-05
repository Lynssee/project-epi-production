// @vitest-environment jsdom
// TugasSayaAlurCard: kartu "Tugas Saya di Alur Kerja" di ESS Kinerja — fail-soft (tak ada data = tak tampil).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const task = (i: number, over: any = {}) => ({ flow_id: `f${i % 2}`, flow_title: `Alur ${i % 2}`, node_id: `n${i}`, label: `Langkah ${i}`, lane_label: 'A', type: 'task', sla_hours: null, kpi_code: '', gate_keys: [], has_actions: false, ...over });
const loadMyTasks = vi.fn();
vi.mock('$lib/services/processGuidanceMineApi', () => ({ loadMyTasks: () => loadMyTasks() }));
const { default: Card } = await import('./TugasSayaAlurCard.svelte');

let box: HTMLElement | null, inst: any;
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; vi.clearAllMocks(); });
async function render() {
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(Card, { target: box, props: {} });
	for (let i = 0; i < 8; i++) { await Promise.resolve(); flushSync(); }
}
const POSISI = { id: 30, nama: 'PROJECT LEADER', via: 'jabatan_id' };

describe('TugasSayaAlurCard', () => {
	it('menampilkan jabatan, jumlah langkah & alur; maksimal 4 baris, yang ber-SLA lebih dulu; tautan fokus langkah', async () => {
		loadMyTasks.mockResolvedValue({ posisi: POSISI, source: 'directus', tasks: [task(1), task(2), task(3), task(4), task(5, { sla_hours: 8 }), task(6)] });
		await render();
		const card = box!.querySelector('[data-testid="tugas-saya-alur"]')!;
		expect(card.textContent).toContain('PROJECT LEADER');
		expect(card.textContent).toContain('6');
		expect(card.textContent).toContain('langkah · 2 alur');
		const rows = [...card.querySelectorAll('ul a')];
		expect(rows).toHaveLength(4);
		expect(rows[0].textContent).toContain('Langkah 5'); // ber-SLA di depan
		expect(rows[0].textContent).toContain('target 8 jam');
		expect(rows[0].getAttribute('href')).toBe('/panduan/alur?alur=f1&fokus=n5');
		expect(card.textContent).toContain('1 langkah punya target waktu');
		expect(card.querySelector('a[href="/panduan/alur"]')).not.toBeNull();
	});

	it('salinan lama (cached) diberi keterangan; tanpa SLA diberi petunjuk', async () => {
		loadMyTasks.mockResolvedValue({ posisi: POSISI, source: 'cached', tasks: [task(1)] });
		await render();
		expect(box!.textContent).toContain('salinan terakhir di perangkat');
		expect(box!.textContent).toContain('Belum ada target waktu');
	});

	it('tanpa tugas / jabatan tak terhubung / gagal → kartu tidak tampil sama sekali', async () => {
		for (const r of [
			{ posisi: POSISI, source: 'directus', tasks: [] },
			{ posisi: null, source: 'directus', tasks: [], reason: 'Hubungi HRD' },
			{ posisi: null, source: 'none', tasks: [] }
		]) {
			loadMyTasks.mockResolvedValue(r);
			await render();
			expect(box!.querySelector('[data-testid="tugas-saya-alur"]')).toBeNull();
			unmount(inst); box!.remove(); inst = box = null;
		}
	});
});

// ── T5: baris status training pada kartu ──
const loadTrainingStatus = vi.fn();
vi.mock('$lib/services/processGuidanceTrainingApi', () => ({ loadTrainingStatus: (ids: number[]) => loadTrainingStatus(ids) }));
const st = (id: number, over: any = {}) => ({ id, kode: '', judul: `P${id}`, terbit: true, self_enroll: true, status_saya: 'belum', progress: null, tenggat: null, ...over });

describe('TugasSayaAlurCard — training (T5)', () => {
	it('satu panggilan untuk gabungan program; menghitung hanya program TERBIT yang belum lulus; tautan ke Pelatihan', async () => {
		loadMyTasks.mockResolvedValue({ posisi: POSISI, source: 'directus', tasks: [task(1, { training: [{ program_id: 13, wajib: false }, { program_id: 18, wajib: true }] }), task(2, { training: [{ program_id: 13, wajib: false }, { program_id: 17, wajib: false }] })] });
		loadTrainingStatus.mockResolvedValue({ ok: true, items: [st(13, { status_saya: 'lulus' }), st(18), st(17, { terbit: false })] });
		await render();
		expect(loadTrainingStatus).toHaveBeenCalledTimes(1);
		expect(loadTrainingStatus.mock.calls[0][0].sort()).toEqual([13, 17, 18]);
		const a = box!.querySelector('[data-testid="tugas-training"]')!;
		expect(a.textContent!.replace(/\s+/g, ' ')).toContain('1 dari 2 training untuk langkah Anda belum selesai');
		expect(a.getAttribute('href')).toBe('/ess/pelatihan');
	});
	it('semua lulus → pesan hijau; gagal memuat / tanpa training → baris tidak tampil dan kartu tetap utuh', async () => {
		loadMyTasks.mockResolvedValue({ posisi: POSISI, source: 'directus', tasks: [task(1, { training: [{ program_id: 13, wajib: false }] })] });
		loadTrainingStatus.mockResolvedValue({ ok: true, items: [st(13, { status_saya: 'lulus' })] });
		await render();
		expect(box!.querySelector('[data-testid="tugas-training"]')!.textContent).toContain('sudah lulus');
		unmount(inst); box!.remove(); inst = box = null;
		loadTrainingStatus.mockResolvedValue({ ok: false, items: [] });
		await render();
		expect(box!.querySelector('[data-testid="tugas-training"]')).toBeNull();
		expect(box!.querySelector('[data-testid="tugas-saya-alur"]')).not.toBeNull();
		unmount(inst); box!.remove(); inst = box = null;
		loadTrainingStatus.mockClear();
		loadMyTasks.mockResolvedValue({ posisi: POSISI, source: 'directus', tasks: [task(1)] });
		await render();
		expect(loadTrainingStatus).not.toHaveBeenCalled();
	});
});
