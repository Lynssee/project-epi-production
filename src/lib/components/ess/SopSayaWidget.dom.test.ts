// @vitest-environment jsdom
// SopSayaWidget + TugasSayaAlurCard (mode ringkas): "Tugas Saya di Alur" di BERANDA & dashboard peran lapangan.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';
import { writable } from 'svelte/store';

const task = (i: number, over: any = {}) => ({ flow_id: `f${i % 2}`, flow_title: `Alur ${i % 2}`, node_id: `n${i}`, label: `Langkah ${i}`, lane_label: 'A', type: 'task', sla_hours: null, kpi_code: '', gate_keys: [], has_actions: false, ...over });
const loadMyTasks = vi.fn();
const loadTrainingStatus = vi.fn();
vi.mock('$lib/services/processGuidanceMineApi', () => ({ loadMyTasks: () => loadMyTasks() }));
vi.mock('$lib/services/processGuidanceTrainingApi', () => ({ loadTrainingStatus: (ids: number[]) => loadTrainingStatus(ids) }));
vi.mock('@tabler/icons-svelte', () => ({ IconRoute: () => {} }));
const getGateKpiSaya = vi.fn();
vi.mock('$lib/services/ess/gateKpiSaya', () => ({ getGateKpiSaya: () => getGateKpiSaya() }));
const bacaSalinanBukuSaku = vi.fn();
const simpanSalinanBukuSaku = vi.fn();
vi.mock('$lib/utils/bukuSakuOfflineCache', () => ({ bacaSalinanBukuSaku: (...a: any[]) => bacaSalinanBukuSaku(...a), simpanSalinanBukuSaku: (...a: any[]) => simpanSalinanBukuSaku(...a) }));
const sheetProps: any[] = [];
vi.mock('$lib/components/shared/PdfFetchSheet.svelte', () => ({ default: (_anchor: any, props: any) => { sheetProps.push(props); } })); // barrel ikon sangat besar → transform lambat tanpa mock
const authStore = writable<any>({ karyawanId: 12 });
vi.mock('$lib/stores/auth', () => ({ authStore }));
const { default: Widget } = await import('./SopSayaWidget.svelte');
const { default: Card } = await import('./TugasSayaAlurCard.svelte');

const POSISI = { id: 30, nama: 'MEKANIK', via: 'jabatan_id' };
let box: HTMLElement | null, inst: any;
beforeEach(() => { authStore.set({ karyawanId: 12 }); getGateKpiSaya.mockResolvedValue({ available: false }); sheetProps.length = 0; bacaSalinanBukuSaku.mockResolvedValue(null); simpanSalinanBukuSaku.mockResolvedValue(true); vi.restoreAllMocks(); });
afterEach(() => { if (inst) unmount(inst); box?.remove(); inst = box = null; document.body.innerHTML = ''; vi.clearAllMocks(); });
async function render(C: any, props: any = {}) {
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(C, { target: box, props });
	for (let i = 0; i < 8; i++) { await Promise.resolve(); flushSync(); }
}

describe('SopSayaWidget (beranda & dashboard peran)', () => {
	it('akun TANPA karyawanId: tidak memanggil server sama sekali dan tidak menampilkan apa pun', async () => {
		authStore.set({ karyawanId: null });
		await render(Widget);
		expect(loadMyTasks).not.toHaveBeenCalled();
		expect(box!.querySelector('[data-testid="tugas-saya-alur"]')).toBeNull();
	});

	it('karyawan: kartu ringkas maks. 3 langkah (ber-SLA dulu), menyebut jumlah gate, tanpa panggilan training', async () => {
		loadMyTasks.mockResolvedValue({
			posisi: POSISI, source: 'directus',
			tasks: [task(1), task(2), task(3, { gate_keys: ['G_P2H'] }), task(4), task(5, { sla_hours: 8, gate_keys: ['G_A', 'G_B'] }), task(6, { training: [{ program_id: 9, wajib: true }] })]
		});
		await render(Widget);
		const card = box!.querySelector('[data-testid="tugas-saya-alur"]')!;
		expect(card).not.toBeNull();
		expect([...card.querySelectorAll('ul a')]).toHaveLength(3);
		expect(card.querySelector('ul a')!.textContent).toContain('Langkah 5'); // ber-SLA di depan
		expect(card.textContent).toContain('🛡 2 gate');
		expect(card.textContent).toContain('memegang 3 gate'); // G_P2H, G_A, G_B
		expect(loadTrainingStatus).not.toHaveBeenCalled();
		expect(card.className).toContain('mb-4'); // margin beranda, bukan mb-8
	});

	it('jabatan belum terhubung → petunjuk "hubungi HRD" (tidak menghilang diam-diam)', async () => {
		loadMyTasks.mockResolvedValue({ posisi: null, source: 'directus', tasks: [], reason: 'Jabatan Anda belum terhubung ke master jabatan. Minta HRD mengisi jabatan.' });
		await render(Widget);
		expect(box!.querySelector('[data-testid="tugas-saya-alur-unlinked"]')!.textContent).toContain('Minta HRD');
	});

	it('gagal / offline tanpa salinan → tidak tampil sama sekali (tak ada galat di beranda)', async () => {
		loadMyTasks.mockResolvedValue({ posisi: null, source: 'none', tasks: [], warning: 'HTTP 500' });
		await render(Widget);
		expect(box!.querySelector('[data-testid="tugas-saya-alur"]')).toBeNull();
		expect(box!.querySelector('[data-testid="tugas-saya-alur-unlinked"]')).toBeNull();
	});
});

describe('TugasSayaAlurCard mode penuh tetap seperti semula', () => {
	it('jabatan tak terhubung di mode penuh (Kinerja/Leader) tetap diam; margin mb-8; maks. 4 langkah', async () => {
		loadMyTasks.mockResolvedValue({ posisi: null, source: 'directus', tasks: [], reason: 'Hubungi HRD' });
		await render(Card);
		expect(box!.querySelector('[data-testid="tugas-saya-alur-unlinked"]')).toBeNull();
		unmount(inst); box!.remove(); inst = box = null;

		loadMyTasks.mockResolvedValue({ posisi: POSISI, source: 'directus', tasks: [task(1), task(2), task(3), task(4), task(5)] });
		await render(Card);
		const card = box!.querySelector('[data-testid="tugas-saya-alur"]')!;
		expect(card.className).toContain('mb-8');
		expect([...card.querySelectorAll('ul a')]).toHaveLength(4);
	});
});

const dok = (id: number, over: any = {}) => ({ id, nomor: `PA-${id}`, sumber: 'pa', aging_jam: 30, sisa_jam: 10, gate_keys: ['G_P2H'], status: 'edukasi', alasan: 'edukasi', link: `/pengajuan/${id}`, ...over });

describe('Gate tertahan pada langkah jabatan saya', () => {
	it('irisan kunci gate: hanya dokumen yang tertahan di gate milik langkah saya; paling mendesak dulu; badge di baris langkah', async () => {
		loadMyTasks.mockResolvedValue({ posisi: POSISI, source: 'directus', tasks: [task(1, { gate_keys: ['G_P2H'] }), task(2)] });
		getGateKpiSaya.mockResolvedValue({ available: true, tertahan: [dok(1, { sisa_jam: 20 }), dok(2, { sisa_jam: 3 }), dok(3, { gate_keys: ['G_LAIN'] })] });
		await render(Widget);
		const box2 = box!.querySelector('[data-testid="gate-tertahan"]')!;
		expect(box2.textContent).toContain('2 dokumen Anda tertahan');
		expect(box2.textContent).not.toContain('PA-3'); // gate lain, bukan gate langkah saya
		expect(box2.querySelector('li')!.textContent).toContain('PA-2'); // sisa 3 jam di depan
		expect(box2.querySelector('a')!.getAttribute('href')).toBe('/pengajuan/2');
		expect(box!.querySelector('[data-testid="langkah-tertahan"]')!.textContent).toContain('2 dokumen tertahan');
	});
	it('tanpa gate di langkah → TIDAK memanggil layanan gate sama sekali; layanan gagal → kartu tetap tampil tanpa peringatan', async () => {
		loadMyTasks.mockResolvedValue({ posisi: POSISI, source: 'directus', tasks: [task(1)] });
		await render(Widget);
		expect(getGateKpiSaya).not.toHaveBeenCalled();
		expect(box!.querySelector('[data-testid="gate-tertahan"]')).toBeNull();
		unmount(inst); box!.remove(); inst = box = null;
		loadMyTasks.mockResolvedValue({ posisi: POSISI, source: 'directus', tasks: [task(1, { gate_keys: ['G_P2H'] })] });
		getGateKpiSaya.mockResolvedValue({ available: false, reason: 'HTTP 500' });
		await render(Widget);
		expect(box!.querySelector('[data-testid="tugas-saya-alur"]')).not.toBeNull();
		expect(box!.querySelector('[data-testid="gate-tertahan"]')).toBeNull();
	});
});

describe('Buku Saku Jabatan', () => {
	it('tombol membuka sheet PDF ke ?jabatan=1; saat offline tampil pesan dan sheet TIDAK dibuka', async () => {
		loadMyTasks.mockResolvedValue({ posisi: POSISI, source: 'directus', tasks: [task(1)] });
		await render(Widget);
		const props = sheetProps[0];
		expect(props.url).toBe('/api/panduan/buku-saku-pdf?jabatan=1');
		expect(props.open).toBe(false);
		(box!.querySelector('[data-testid="btn-buku-saku-jabatan"]') as HTMLButtonElement).click();
		flushSync();
		expect(props.open).toBe(true);
		props.onClose(); flushSync();
		expect(props.open).toBe(false);

		vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
		(box!.querySelector('[data-testid="btn-buku-saku-jabatan"]') as HTMLButtonElement).click();
		flushSync();
		expect(props.open).toBe(false);
		expect(box!.querySelector('[data-testid="buku-offline"]')).not.toBeNull();
	});
});

describe('Buku Saku Jabatan — salinan offline (IndexedDB)', () => {
	const PDF = new Blob(['%PDF'], { type: 'application/pdf' });
	it('PDF berhasil diunduh → disimpan per karyawan+jabatan, lalu tombol "Buka salinan offline" muncul', async () => {
		loadMyTasks.mockResolvedValue({ posisi: POSISI, source: 'directus', tasks: [task(1)] });
		await render(Widget);
		expect(box!.querySelector('[data-testid="btn-salinan-offline"]')).toBeNull();
		sheetProps[0].onLoaded(PDF);
		for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 0)); flushSync(); }
		const args = simpanSalinanBukuSaku.mock.calls[0]; // Blob dibandingkan lewat identitas: matcher dalam vitest tak aman untuk Blob jsdom
		expect([args[0], args[1], args[3]]).toEqual([12, 30, 'MEKANIK']);
		expect(args[2] === PDF).toBe(true);
		expect(box!.querySelector('[data-testid="btn-salinan-offline"]')).not.toBeNull();
		expect(box!.querySelector('[data-testid="salinan-info"]')!.textContent).toContain('tersimpan');
	});
	it('offline + ada salinan → sheet dibuka dengan salinan (tanpa unduh) dan tanpa pesan galat', async () => {
		bacaSalinanBukuSaku.mockResolvedValue({ blob: PDF, cachedAt: '2026-11-17T01:00:00Z' });
		loadMyTasks.mockResolvedValue({ posisi: POSISI, source: 'directus', tasks: [task(1)] });
		await render(Widget);
		expect(bacaSalinanBukuSaku).toHaveBeenCalledWith(12, 30);
		vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
		(box!.querySelector('[data-testid="btn-buku-saku-jabatan"]') as HTMLButtonElement).click();
		flushSync();
		expect(sheetProps[0].open).toBe(true);
		expect(sheetProps[0].initialBlob).toBe(PDF);
		expect(box!.querySelector('[data-testid="buku-offline"]')).toBeNull();
		sheetProps[0].onClose(); flushSync();
		expect(sheetProps[0].initialBlob ?? null).toBeNull(); // kembali ke mode unduh biasa setelah ditutup
	});
	it('salinan bisa dibuka juga saat online lewat tombolnya; gagal menyimpan tidak mengganggu tampilan', async () => {
		bacaSalinanBukuSaku.mockResolvedValue({ blob: PDF, cachedAt: '2026-11-17T01:00:00Z' });
		loadMyTasks.mockResolvedValue({ posisi: POSISI, source: 'directus', tasks: [task(1)] });
		await render(Widget);
		(box!.querySelector('[data-testid="btn-salinan-offline"]') as HTMLButtonElement).click();
		flushSync();
		expect(sheetProps[0].open).toBe(true);
		expect(sheetProps[0].initialBlob).toBe(PDF);
		simpanSalinanBukuSaku.mockResolvedValue(false);
		sheetProps[0].onLoaded(new Blob(['baru']));
		for (let i = 0; i < 6; i++) { await new Promise((r) => setTimeout(r, 0)); flushSync(); }
		expect(box!.querySelector('[data-testid="tugas-saya-alur"]')).not.toBeNull();
	});
});
