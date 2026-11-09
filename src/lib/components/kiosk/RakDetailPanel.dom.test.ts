// @vitest-environment jsdom
// Kartu sub rak membuka pop-up cek & kelola tanpa pindah halaman; jumlah item di kartu
// dimuat ulang hanya bila isi pallet benar-benar berubah.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount, unmount, flushSync } from 'svelte';

const goto = vi.hoisted(() => vi.fn());
vi.mock('$app/navigation', () => ({ goto }));
vi.mock('$lib/services/expiryHint', () => ({
	fetchExpiryHints: vi.fn(async () => ({})),
	hintTampil: () => null
}));
vi.mock('./kioskNumpad', () => ({ openKioskNumpad: vi.fn(async () => '10'), isSatuanDesimal: () => false }));
const { default: RakDetailPanel } = await import('./RakDetailPanel.svelte');

let box: HTMLElement | null, inst: any;
let jumlahA1 = 1;
let bolehAdjust = true;
let stokPallet = 76.401;

const induk = () => ({
	gudang: { id: 147, kode_gudang: 'BK-A', nama_gudang: 'Rak A', parent_gudang_id: 42 },
	parent_nama: 'Gudang Finish Good',
	sub_rak: [{ id: 51, kode_gudang: 'BK-A1', nama_gudang: 'RAK A1', jenis: 'slot', jumlah_item: jumlahA1 }],
	placements: [],
	pics: [],
	denah: null
});
const pallet = () => ({
	gudang: { id: 51, kode_gudang: 'BK-A1', nama_gudang: 'RAK A1', parent_gudang_id: 147 },
	parent_nama: 'Rak A',
	sub_rak: [],
	boleh_adjust: bolehAdjust,
	placements: jumlahA1
		? [{ placement_id: 9, identitas_barang_id: 7, nama_barang: 'Cat Epoxy', kode_item: 'CE-1', satuan: 'kg', kategori: 'lainnya', expected_qty: null, min_qty: null, ledger_qty: null, stok_tersedia: stokPallet, jumlah_lokasi: 1, terakhir_update: null }]
		: [],
	pics: [],
	denah: null
});

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
	if (url.endsWith('/adjust')) {
		stokPallet = 10;
		return { ok: true, status: 200, json: async () => ({ ok: true, status: 'auto_approved', selisih: -66.401, di_rak_baru: 10, stok_tersedia_baru: 10, reference_no: 'SL-1' }) };
	}
	if (init?.method === 'DELETE') {
		jumlahA1 = 0;
		return { ok: true, status: 200, json: async () => ({ ok: true }) };
	}
	return { ok: true, status: 200, json: async () => (url.endsWith('/147') ? induk() : pallet()) };
});

async function settle() {
	flushSync();
	for (let i = 0; i < 15; i++) await Promise.resolve();
	await new Promise((r) => setTimeout(r, 20));
	flushSync();
}
async function render(boleh = true) {
	jumlahA1 = 1;
	bolehAdjust = boleh;
	stokPallet = 76.401;
	fetchMock.mockClear();
	goto.mockClear();
	vi.stubGlobal('fetch', fetchMock);
	box = document.createElement('div');
	document.body.appendChild(box);
	inst = mount(RakDetailPanel, { target: box, props: { gudangId: 147 } });
	await settle();
}
const klik = async (sel: string) => {
	(box!.querySelector(sel) as HTMLElement).click();
	await settle();
};
const dialog = () => box!.querySelector('.popup');
const panggilanInduk = () => fetchMock.mock.calls.filter(([u]) => u.endsWith('/147')).length;
const esc = async () => {
	window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
	await settle();
};

afterEach(() => {
	if (inst) unmount(inst);
	box?.remove();
	inst = box = null;
	vi.unstubAllGlobals();
	document.body.innerHTML = '';
});

describe('RakDetailPanel — pop-up sub rak', () => {
	it('kartu membuka pop-up berisi item pallet, tanpa pindah halaman', async () => {
		await render();
		await klik('.subrak-card');
		expect(dialog()!.textContent).toContain('Cat Epoxy');
		expect(goto).not.toHaveBeenCalled();
		const sel = dialog()!.querySelector('.qty-cell')!.textContent;
		expect(sel).toContain('Stok Tersedia');
		expect(sel).toContain('76.401');
	});

	it('tutup tanpa perubahan tidak memuat ulang rak induk', async () => {
		await render();
		await klik('.subrak-card');
		await klik('.popup-x');
		expect(dialog()).toBeNull();
		expect(panggilanInduk()).toBe(1);
	});

	it('Esc menutup sheet di dalam pop-up dulu, baru pop-up-nya', async () => {
		await render();
		await klik('.subrak-card');
		await klik('.popup .kelola-toggle');
		await klik('.popup .hapus-btn');
		expect(box!.querySelector('.sheet')).toBeTruthy();
		await esc();
		expect(box!.querySelector('.sheet')).toBeNull();
		expect(dialog()).toBeTruthy();
		await esc();
		expect(dialog()).toBeNull();
	});

	it('tanpa izin: tombol Input Hitung Fisik tidak tampil', async () => {
		await render(false);
		await klik('.subrak-card');
		expect(box!.querySelector('.adjust-btn')).toBeNull();
	});

	it('input hitung fisik: pratinjau, kirim angka, stok di pop-up ikut berubah', async () => {
		await render();
		await klik('.subrak-card');
		await klik('.adjust-btn');
		expect((box!.querySelector('.sheet-submit') as HTMLButtonElement).disabled).toBe(true);

		await klik('.fisik-btn');
		expect(box!.querySelector('.adjust-preview')!.textContent).toContain('76.401 → 10');

		await klik('.sheet-submit');
		const kirim = fetchMock.mock.calls.find(([u]) => u.endsWith('/placement/9/adjust'))!;
		expect(JSON.parse(String(kirim[1]!.body)).hitung_fisik).toBe(10);
		expect(box!.querySelector('.ok-title')!.textContent).toContain('Stok sistem diperbarui');
		expect(dialog()!.querySelector('.qty-cell')!.textContent).toContain('10');
	});

	it('melepas item di pop-up memperbarui jumlah di kartu saat ditutup', async () => {
		await render();
		expect(box!.querySelector('.subrak-count')!.textContent).toContain('1 item');
		await klik('.subrak-card');
		await klik('.popup .kelola-toggle');
		await klik('.popup .hapus-btn');
		await klik('.popup .sheet-btn--danger');
		expect(dialog()!.textContent).not.toContain('Cat Epoxy');
		await klik('.popup-x');
		expect(panggilanInduk()).toBe(2);
		expect(box!.querySelector('.subrak-count')!.textContent).toContain('Kosong');
	});
});
