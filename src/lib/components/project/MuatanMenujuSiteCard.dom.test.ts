// @vitest-environment jsdom
// MuatanMenujuSiteCard — banner tim menunggu material, SJ di jalan (resi/ekspedisi/ETA), saran non-material, dan keadaan kosong/gagal.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const svc = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('$lib/services/projectFulfillment', () => ({ fetchProjectFulfillment: (...a: any[]) => svc.fetch(...a) }));

import Card from './MuatanMenujuSiteCard.svelte';

let box: HTMLElement | null, inst: any;
const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); await new Promise((r) => setTimeout(r, 0)); flushSync(); };
async function render(data: any, reject = false) {
	if (reject) svc.fetch.mockRejectedValue(new Error('Gagal memuat status kesiapan (500)'));
	else svc.fetch.mockResolvedValue(data);
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(Card, { target: box, props: { projectId: 5 } });
	await tick();
}
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = null; svc.fetch.mockReset(); });

const base = (over: any = {}) => ({
	projectId: 5, today: '2026-11-10', forecastEmpty: false, syncedAt: '',
	manpowerToday: { roles: [] },
	bySubtask: {
		a: { materials: [{ id: 1, ref_name: 'Epoxy', status: 'shipped', late: false, pl: null, sj: [{ id: 7, nomor_sj: 'SJ-007', status: 'shipped', tanggal: null, received_at: null, driver: null, eta_tiba: '2026-11-17', track_stage: 'dalam_perjalanan', no_resi: 'JNE123', ekspedisi: 'JNE Express' }] }], equipment: [], manpowerRoles: [] },
		c: { materials: [], equipment: [], manpowerRoles: [] }
	},
	subtasks: [
		{ id: 'c', name: 'Pasang scaffold', category: 'Persiapan', first: '2026-11-12', last: '2026-11-14', activeToday: false, readiness: { state: 'none', reasons: [], total: 0, ready: 0 } }
	],
	mobSync: { status: 'waiting_material', gap_days: -2, manpower_start: '2026-11-15', material_eta: '2026-11-17', projected: false },
	...over
});

describe('MuatanMenujuSiteCard', () => {
	it('waiting_material: banner merah, hitung mundur, SJ di jalan lengkap, dan saran non-material', async () => {
		await render(base());
		const t = box!.textContent!;
		expect(box!.querySelector('[role="alert"]')).toBeTruthy();
		expect(t).toContain('Tim berangkat 2026-11-15, tetapi material baru tiba 2026-11-17');
		expect(t).toContain('menunggu 2 hari');
		expect(t).toContain('Tim Menunggu Material');
		expect(t).toContain('Material tiba dalam 7 hari · Tim mulai dalam 5 hari');
		expect(t).toContain('SJ SJ-007 · JNE Express');
		expect(t).toContain('Resi JNE123');
		expect(t).toContain('Dalam perjalanan');
		expect(t).toContain('ETA 2026-11-17');
		expect(t).toContain('Saran pekerjaan sambil menunggu material');
		expect(t).toContain('Pasang scaffold');
	});

	it('synchronized: tanpa banner dan tanpa saran', async () => {
		await render(base({ mobSync: { status: 'synchronized', gap_days: 1, manpower_start: '2026-11-18', material_eta: '2026-11-17' } }));
		expect(box!.querySelector('[role="alert"]')).toBeNull();
		expect(box!.textContent).toContain('Sinkron');
		expect(box!.textContent).not.toContain('Saran pekerjaan');
	});

	it('proyeksi: banner memakai kata "perkiraan"', async () => {
		await render(base({ mobSync: { status: 'waiting_material', gap_days: -1, manpower_start: '2026-11-15', material_eta: '2026-11-16', projected: true } }));
		expect(box!.textContent).toContain('(perkiraan)');
	});

	it('unknown: tampil alasan, tanpa banner', async () => {
		await render(base({ mobSync: { status: 'unknown', reason: 'no_upcoming_spk', gap_days: null, manpower_start: null, material_eta: null } }));
		expect(box!.textContent).toContain('Belum Dinilai');
		expect(box!.textContent).toContain('Belum ada SPK manpower yang akan mulai');
		expect(box!.querySelector('[role="alert"]')).toBeNull();
	});

	it('respons lama tanpa mobSync tidak crash (Belum Dinilai)', async () => {
		await render(base({ mobSync: undefined }));
		expect(box!.textContent).toContain('Belum Dinilai');
	});

	it('forecast kosong: kartu tidak ditampilkan', async () => {
		await render(base({ forecastEmpty: true }));
		expect(box!.querySelector('[data-testid="muatan-menuju-site"]')).toBeNull();
	});

	it('gagal memuat: pesan ringan + tombol coba lagi (halaman tetap normal)', async () => {
		await render(null, true);
		expect(box!.textContent).toContain('Status muatan belum bisa dimuat');
		expect(box!.textContent).toContain('Coba lagi');
	});
});
