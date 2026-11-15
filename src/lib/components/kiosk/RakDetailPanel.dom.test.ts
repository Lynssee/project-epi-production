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
let perluVerif = false;

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
		? [{ placement_id: 9, identitas_barang_id: 7, nama_barang: 'Cat Epoxy', kode_item: 'CE-1', satuan: 'kg', kategori: 'lainnya', expected_qty: null, min_qty: null, ledger_qty: null, stok_tersedia: stokPallet, jumlah_lokasi: 1, terakhir_update: null, perlu_verifikasi: perluVerif }]
		: [],
	pics: [],
	denah: null
});

let barangBaruDup = false;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
	if (url.endsWith('/51/barang-baru') && init?.method === 'POST') {
		if (barangBaruDup) {
			return { ok: false, status: 409, json: async () => ({ message: 'sudah terdaftar', existing: { identitas_barang_id: 17254, nama_barang: 'FOXAFLOOR SL OX-955 PINK', satuan: 'KG' } }) };
		}
		return {
			ok: true,
			status: 200,
			json: async () => ({
				ok: true,
				barang: { identitas_barang_id: 900, nama_barang: 'FOXAFLOOR SL OX-955 UNGU', satuan: 'KG' },
				ditambahkan: [{ item_id: 900, placement_id: 77, nama: 'FOXAFLOOR SL OX-955 UNGU' }],
				dilewati: [],
				hitung_fisik: [{ item_id: 900, nama: 'FOXAFLOOR SL OX-955 UNGU', ok: true, status: 'auto_approved', di_rak_baru: 12 }]
			})
		};
	}
	if (url.endsWith('/51/barang-baru')) return { ok: true, status: 200, json: async () => ({ satuan: ['KG', 'LITER'] }) };
	if (url.includes('/master-barang?')) return { ok: true, status: 200, json: async () => ({ hasil: [] }) };
	if (url.includes('/barang?q=ungu')) return { ok: true, status: 200, json: async () => ({ hits: [] }) };
	if (url.includes('/barang?q=')) {
		return {
			ok: true,
			status: 200,
			json: async () => ({
				hits: [{ identitas_barang_id: 88, nama_barang: 'Foxafloor Pink', kode_item: null, satuan: 'KG', kategori: 'fg', sudah_di_rak: false, rak_lain: [] }]
			})
		};
	}
	if (url.endsWith('/51/placement') && init?.method === 'POST') {
		return {
			ok: true,
			status: 200,
			json: async () => ({
				ok: true,
				ditambahkan: [{ item_id: 88, placement_id: 99, nama: 'Foxafloor Pink' }],
				dilewati: [],
				hitung_fisik: JSON.parse(String(init.body)).items[0].hitung_fisik == null
					? []
					: [{ item_id: 88, nama: 'Foxafloor Pink', ok: true, status: 'auto_approved', reference_no: 'SL-9', di_rak_baru: 321 }]
			})
		};
	}
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
	barangBaruDup = false;
	perluVerif = false;
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

	async function ketik(sel: string, nilai: string) {
		const el = box!.querySelector(sel) as HTMLInputElement;
		el.value = nilai;
		el.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
	}
	async function bukaCari(q: string) {
		await klik('.subrak-card');
		await klik('.popup .kelola-toggle');
		await klik('.popup .tambah-btn');
		await ketik('.tambah-search input', q);
		await new Promise((r) => setTimeout(r, 400)); // debounce pencarian 350 ms
		await settle();
	}
	async function bukaTinjauTambah() {
		await bukaCari('pink');
		await klik('.hit');
		await klik('.sel-footer .sheet-btn--primary');
	}
	const kirimTambah = () => {
		const c = fetchMock.mock.calls.find(([u, i]) => u.endsWith('/51/placement') && i?.method === 'POST');
		return c ? JSON.parse(String(c[1]!.body)) : null;
	};

	it('tambah item: kolom kanan = Hitung Fisik, dikirim sebagai hitung_fisik & hasilnya tampil', async () => {
		await render();
		await bukaTinjauTambah();
		expect(box!.querySelector('.sel-head')!.textContent).toContain('Hitung Fisik');
		const input = box!.querySelector('.sel-qty') as HTMLInputElement;
		input.value = '321';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		await settle();
		await klik('.sheet .sheet-btn--primary');

		const body = kirimTambah();
		expect(body.items).toEqual([{ item_id: 88, hitung_fisik: 321 }]);
		expect(body.items[0]).not.toHaveProperty('expected_qty');
		expect(body.client_batch_id).toBeTruthy();
		const hasil = box!.querySelector('.fisik-hasil')!.textContent!;
		expect(hasil).toContain('Foxafloor Pink');
		expect(hasil).toContain('Masuk stok: 321 KG');
	});

	it('tambah item: tanpa izin kolom Hitung Fisik terkunci & tidak dikirim', async () => {
		await render(false);
		await bukaTinjauTambah();
		expect(box!.querySelector('.sel-qty')).toBeNull();
		expect(box!.querySelector('.sel-lock')!.textContent).toContain('Terkunci');
		await klik('.sheet .sheet-btn--primary');
		expect(kirimTambah().items).toEqual([{ item_id: 88, hitung_fisik: null }]);
		expect(box!.querySelector('.fisik-hasil')).toBeNull();
	});

	const kirimBaru = () => {
		const c = fetchMock.mock.calls.find(([u, i]) => u.endsWith('/51/barang-baru') && i?.method === 'POST');
		return c ? JSON.parse(String(c[1]!.body)) : null;
	};

	it('barang belum terdaftar: daftarkan baru (produk, warna, satuan, hitung fisik) lalu hasil tampil', async () => {
		await render();
		await bukaCari('ungu');
		await klik('.baru-btn');
		expect((box!.querySelector('#baru-produk') as HTMLInputElement).value).toBe('UNGU');
		await ketik('#baru-produk', 'Foxafloor SL OX-955');
		await ketik('#baru-warna', 'ungu');
		expect(box!.querySelector('.baru-preview')!.textContent).toContain('FOXAFLOOR SL OX-955 UNGU');
		expect(box!.querySelector('.satuan-pilih button.on')!.textContent).toBe('KG');
		await ketik('#baru-fisik', '12');
		await klik('.baru-submit');

		expect(kirimBaru()).toMatchObject({ nama_produk: 'Foxafloor SL OX-955', warna: 'ungu', satuan: 'KG', hitung_fisik: 12 });
		expect(box!.querySelector('.ok-line')!.textContent).toContain('didaftarkan');
		expect(box!.querySelector('.fisik-hasil')!.textContent).toContain('Masuk stok: 12 KG');
	});

	it('barang baru: hitung fisik wajib diisi bila berhak', async () => {
		await render();
		await bukaCari('ungu');
		await klik('.baru-btn');
		await ketik('#baru-warna', 'ungu');
		await klik('.baru-submit');
		expect(kirimBaru()).toBeNull();
		expect(box!.querySelector('.sheet-err')!.textContent).toContain('hitung fisik');
	});

	it('barang baru tanpa izin: kolom hitung fisik terkunci, tetap bisa didaftarkan', async () => {
		await render(false);
		await bukaCari('ungu');
		await klik('.baru-btn');
		expect(box!.querySelector('#baru-fisik')).toBeNull();
		await ketik('#baru-warna', 'ungu');
		await klik('.baru-submit');
		expect(kirimBaru().hitung_fisik).toBeNull();
	});

	it('nama sudah terdaftar: tawarkan "Pakai barang ini" → masuk daftar tinjau', async () => {
		await render();
		barangBaruDup = true;
		await bukaCari('ungu');
		await klik('.baru-btn');
		await ketik('#baru-warna', 'pink');
		await ketik('#baru-fisik', '5');
		await klik('.baru-submit');
		expect(box!.querySelector('.baru-dup')!.textContent).toContain('FOXAFLOOR SL OX-955 PINK');
		await klik('.baru-dup .sheet-btn--primary');
		expect(box!.querySelector('.sel-row')!.textContent).toContain('FOXAFLOOR SL OX-955 PINK');
		expect((box!.querySelector('.sel-qty') as HTMLInputElement).value).toBe('5');
	});

	it('barang menunggu verifikasi diberi badge di kartu', async () => {
		await render();
		perluVerif = true;
		await klik('.subrak-card');
		expect(dialog()!.querySelector('.badge-verif')!.textContent).toContain('Menunggu verifikasi');
	});
});
