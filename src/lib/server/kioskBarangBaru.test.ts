import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
	directusServerJson: vi.fn(),
	bolehAdjustRak: vi.fn(),
	tambahKeRakDanHitung: vi.fn(),
	requireKioskMenu: vi.fn()
}));
vi.mock('$lib/server/kioskAuth', () => ({ requireKioskSession: () => ({ karyawanId: 5, nama: 'Agus' }) }));
vi.mock('$lib/server/kioskMenuAccess', () => ({ requireKioskMenu: m.requireKioskMenu }));
vi.mock('$lib/server/directus', () => ({ directusServerJson: m.directusServerJson }));
vi.mock('$lib/server/kioskGudang', () => ({ bolehAdjustRak: m.bolehAdjustRak }));
vi.mock('$lib/server/kioskHitungFisik', () => ({ tambahKeRakDanHitung: m.tambahKeRakDanHitung }));

import { rakitNamaBarang } from './kioskBarangBaru';
import { POST } from '../../routes/api/kiosk/stok/rak/[gudangId]/barang-baru/+server';

let rak: any;
let barangAda: any[];
let posted: { url: string; body: any }[];

function router(url: string, init?: any) {
	if (init?.method === 'POST') {
		const body = JSON.parse(init.body);
		posted.push({ url, body });
		if (url === '/items/identitas_barang') return Promise.resolve({ data: { id: 900, nama_barang_lengkap: body.nama_barang_lengkap } });
		return Promise.resolve({ data: {} });
	}
	if (url.startsWith('/items/gudang/')) return Promise.resolve({ data: rak });
	if (url.includes('system_settings')) return Promise.resolve({ data: [] });
	if (url.startsWith('/items/identitas_barang?')) return Promise.resolve({ data: barangAda });
	if (url.startsWith('/items/product_name?')) return Promise.resolve({ data: [{ id: 52, product_name: 'FOXAFLOOR SL OX-955' }] });
	if (url.startsWith('/items/warna_fg?')) return Promise.resolve({ data: [{ id: 334, nama_warna: 'PINK MUDA' }] });
	return Promise.reject(new Error('url tak terduga ' + url));
}

function call(body: any) {
	const event = {
		params: { gudangId: '51' },
		request: new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) })
	} as any;
	return (POST as any)(event) as Promise<Response>;
}
async function status(p: Promise<Response>) {
	try {
		return (await p).status;
	} catch (e: any) {
		return e.status;
	}
}
const BODY = { nama_produk: ' foxafloor  sl ox-955 ', warna: 'pink', satuan: 'kg', hitung_fisik: 321 };
const barangDibuat = () => posted.find((p) => p.url === '/items/identitas_barang')?.body;

beforeEach(() => {
	Object.values(m).forEach((f) => f.mockReset());
	rak = { id: 51, nama_gudang: 'RAK A1', parent_gudang_id: 147, pic_karyawan_ids: [5] };
	barangAda = [];
	posted = [];
	m.directusServerJson.mockImplementation(router);
	m.bolehAdjustRak.mockResolvedValue(true);
	m.tambahKeRakDanHitung.mockResolvedValue({
		ok: true,
		ditambahkan: [{ item_id: 900, placement_id: 77, nama: 'FOXAFLOOR SL OX-955 PINK' }],
		dilewati: [],
		hitung_fisik: [{ item_id: 900, nama: 'FOXAFLOOR SL OX-955 PINK', ok: true, status: 'auto_approved', di_rak_baru: 321 }]
	});
});

describe('rakitNamaBarang', () => {
	it('huruf besar & spasi dirapikan', () => {
		expect(rakitNamaBarang(' foxafloor  sl ', ' pink ')).toBe('FOXAFLOOR SL PINK');
	});
});

describe('POST daftarkan barang baru', () => {
	it('membuat barang perlu verifikasi TANPA kategori, lalu menempatkan + mencatat hitung fisik', async () => {
		const res = await call(BODY);
		expect(res.status).toBe(200);
		const b = barangDibuat();
		expect(b).toMatchObject({
			nama_barang_lengkap: 'FOXAFLOOR SL OX-955 PINK',
			satuan: 'KG',
			parent_category: null,
			perlu_verifikasi_pendaftaran: true,
			stok_tersedia: 0,
			product_name_id: 52, // cocok persis dengan master
			warna_fg_id: null // "PINK" ≠ "PINK MUDA" → tidak ditebak, dicocokkan admin
		});
		expect(b.deskripsi).toContain('Kiosk Cek Stok (RAK A1)');
		expect(m.tambahKeRakDanHitung).toHaveBeenCalledWith(
			expect.objectContaining({ gudang_id: 51, items: [{ item_id: 900, expected_qty: null, hitung_fisik: 321 }] })
		);
		const data = await res.json();
		expect(data.barang).toEqual({ identitas_barang_id: 900, nama_barang: 'FOXAFLOOR SL OX-955 PINK', satuan: 'KG' });
		expect(data.hitung_fisik[0].di_rak_baru).toBe(321);
		expect(posted.some((p) => p.url === '/items/scan_log' && p.body.notes.includes('DAFTAR-BARU'))).toBe(true);
	});

	it('nama sudah terdaftar → 409 + barang yang ada, TIDAK membuat barang', async () => {
		barangAda = [{ id: 17254, nama_barang_lengkap: 'Foxafloor SL OX-955  Pink', satuan: 'KG' }];
		const res = await call(BODY);
		expect(res.status).toBe(409);
		expect((await res.json()).existing.identitas_barang_id).toBe(17254);
		expect(barangDibuat()).toBeUndefined();
		expect(m.tambahKeRakDanHitung).not.toHaveBeenCalled();
	});

	it('mirip tapi beda (substring) bukan duplikat', async () => {
		barangAda = [{ id: 1, nama_barang_lengkap: 'FOXAFLOOR SL OX-955 PINK MUDA', satuan: 'KG' }];
		expect((await call(BODY)).status).toBe(200);
	});

	it('tidak berhak hitung fisik → 403 sebelum barang dibuat', async () => {
		m.bolehAdjustRak.mockResolvedValue(false);
		expect(await status(call(BODY))).toBe(403);
		expect(barangDibuat()).toBeUndefined();
	});

	it('tidak berhak tapi hitung fisik kosong → tetap boleh mendaftarkan', async () => {
		m.bolehAdjustRak.mockResolvedValue(false);
		expect((await call({ ...BODY, hitung_fisik: null })).status).toBe(200);
		expect(m.bolehAdjustRak).not.toHaveBeenCalled();
	});

	it('validasi: gudang level teratas, satuan tak dikenal, warna kosong → 400 tanpa membuat barang', async () => {
		rak = { ...rak, parent_gudang_id: null };
		expect(await status(call(BODY))).toBe(400);
		rak = { ...rak, parent_gudang_id: 147 };
		expect(await status(call({ ...BODY, satuan: 'ONS' }))).toBe(400);
		expect(await status(call({ ...BODY, warna: '  ' }))).toBe(400);
		expect(await status(call({ ...BODY, hitung_fisik: -2 }))).toBe(400);
		expect(barangDibuat()).toBeUndefined();
	});

	it('barang terdaftar tapi penempatan gagal → 502 dengan pesan jelas & data barang', async () => {
		m.tambahKeRakDanHitung.mockRejectedValue(new Error('directus down'));
		const res = await call(BODY);
		expect(res.status).toBe(502);
		const data = await res.json();
		expect(data.message).toContain('sudah terdaftar');
		expect(data.barang.identitas_barang_id).toBe(900);
	});
});
