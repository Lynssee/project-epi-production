// src/lib/server/workshopKioskHandlers.test.ts
// Handler kiosk terpadu (Fase 7 Unifikasi Workshop): cek stok & potong bahan untuk kedua workshop.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ directus: vi.fn(), menu: vi.fn(), list: vi.fn(), cut: vi.fn() }));
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: any[]) => h.directus(...a) }));
vi.mock('$lib/server/kioskAuth', () => ({ requireKioskSession: () => ({ karyawanId: 42, nama: 'Operator A' }) }));
vi.mock('$lib/server/kioskMenuAccess', () => ({ requireKioskMenu: (...a: any[]) => h.menu(...a) }));
vi.mock('$lib/server/workshopKioskStock', () => ({
	listKioskStock: (...a: any[]) => h.list(...a),
	workshopKioskStockCut: (...a: any[]) => h.cut(...a)
}));

const { kioskCekStokGet, kioskPotongBahanGet, kioskPotongBahanPost } = await import('./workshopKioskHandlers');

const ev = (url = 'http://x/api', body?: any): any => ({ url: new URL(url), request: { json: async () => body } });
const body = async (r: Response) => r.json();
const httpStatus = async (p: Promise<any>) => p.then(() => 200, (e) => e?.status ?? 500);

beforeEach(() => {
	vi.clearAllMocks();
	h.menu.mockResolvedValue(undefined);
});

describe('cek stok', () => {
	for (const ws of ['ciketing', 'balaraja'] as const) {
		it(`${ws}: memeriksa menu kiosk milik workshop & mengembalikan daftar`, async () => {
			h.list.mockResolvedValue([{ id: 1, namaBarang: 'Cat', stokTersedia: 3 }]);
			const r = await kioskCekStokGet(ev(), ws);
			expect(h.menu).toHaveBeenCalledWith(42, `${ws}_cek_stok`, expect.stringContaining(ws === 'ciketing' ? 'Ciketing' : 'Balaraja'));
			expect(h.list).toHaveBeenCalledWith(ws);
			expect((await body(r)).items).toHaveLength(1);
		});
	}

	it('Directus gagal → 502 (bukan daftar kosong yang menyesatkan)', async () => {
		h.list.mockRejectedValue(new Error('403'));
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await httpStatus(kioskCekStokGet(ev(), 'balaraja'))).toBe(502);
		spy.mockRestore();
	});

	it('akses menu ditolak → error menu diteruskan, daftar tidak dimuat', async () => {
		h.menu.mockRejectedValue({ status: 403 });
		expect(await httpStatus(kioskCekStokGet(ev(), 'balaraja'))).toBe(403);
		expect(h.list).not.toHaveBeenCalled();
	});

	it('workshop tak dikenal → 404', async () => {
		expect(await httpStatus(kioskCekStokGet(ev(), 'xyz' as any))).toBe(404);
	});
});

describe('potong bahan GET', () => {
	it('tanpa kode: daftar SPK on-progress milik workshop (filter projects.workshop)', async () => {
		h.directus.mockResolvedValue({ data: [{ id: 5, name: 'PO-5', nomor_po: 'PO-5' }] });
		const r = await kioskPotongBahanGet(ev(), 'balaraja');
		expect(h.menu).toHaveBeenCalledWith(42, 'balaraja_potong_bahan', expect.any(String));
		expect(h.directus.mock.calls[0][0]).toContain('filter[workshop][_eq]=balaraja');
		expect((await body(r)).spkList).toHaveLength(1);
	});

	it('kode bukan EPI:ITEM → 400', async () => {
		expect(await httpStatus(kioskPotongBahanGet(ev('http://x/api?code=bukan-qr'), 'balaraja'))).toBe(400);
	});

	it('balaraja: item dicari di balaraja_item tanpa meminta stok_tersedia; saldo dari ledger', async () => {
		h.directus.mockImplementation(async (path: string) => {
			if (path.includes('identitas_barang/9')) return { data: { id: 9, nama_barang_lengkap: 'Cat Epoxy', satuan: 'L' } };
			if (path.includes('balaraja_item')) return { data: [{ id: 31, nama_barang: 'Cat Epoxy', satuan_default: 'L' }] };
			return { data: [] };
		});
		h.list.mockResolvedValue([{ id: 31, stokTersedia: 12 }]);
		const r = await kioskPotongBahanGet(ev('http://x/api?code=EPI:ITEM:9'), 'balaraja');
		const itemCall = h.directus.mock.calls.find((c) => c[0].includes('balaraja_item'))![0];
		expect(itemCall).not.toContain('stok_tersedia');
		expect(await body(r)).toEqual({ item: { itemId: 31, identitasBarangId: 9, namaBarang: 'Cat Epoxy', satuan: 'L', stokTersedia: 12 } });
	});

	it('ciketing: stok dibaca dari kolom stok_tersedia item', async () => {
		h.directus.mockImplementation(async (path: string) => {
			if (path.includes('identitas_barang/9')) return { data: { id: 9, nama_barang_lengkap: 'Pasir', satuan: 'kg' } };
			if (path.includes('ciketing_item')) return { data: [{ id: 4, nama_barang: 'Pasir', satuan_default: 'kg', stok_tersedia: '7.5' }] };
			return { data: [] };
		});
		const r = await kioskPotongBahanGet(ev('http://x/api?code=EPI:ITEM:9'), 'ciketing');
		expect((await body(r)).item.stokTersedia).toBe(7.5);
		expect(h.list).not.toHaveBeenCalled();
	});

	it('barang belum terdaftar di workshop → 404 menyebut nama workshop', async () => {
		h.directus.mockImplementation(async (path: string) => (path.includes('identitas_barang/9') ? { data: { id: 9, nama_barang_lengkap: 'Cat', satuan: 'L' } } : { data: [] }));
		await expect(kioskPotongBahanGet(ev('http://x/api?code=EPI:ITEM:9'), 'balaraja')).rejects.toMatchObject({ status: 404, body: { message: expect.stringContaining('Balaraja') } });
	});
});

describe('potong bahan POST', () => {
	const okBody = { code: 'EPI:ITEM:9', projectId: 5, projectLabel: 'PO-5', qty: 2, clientTxnId: 't1' };
	beforeEach(() => {
		h.directus.mockImplementation(async (path: string) => {
			if (path.includes('identitas_barang/9')) return { data: { id: 9, nama_barang_lengkap: 'Cat', satuan: 'L' } };
			if (path.includes('balaraja_item')) return { data: [{ id: 31, nama_barang: 'Cat', satuan_default: 'L' }] };
			return { data: [] };
		});
		h.list.mockResolvedValue([{ id: 31, stokTersedia: 12 }]);
		h.cut.mockResolvedValue({ ledgerId: 1, previousStock: 12, newStock: 10, alreadyProcessed: false });
	});

	it('balaraja: memotong dengan item Balaraja & operator sesi', async () => {
		const r = await kioskPotongBahanPost(ev('http://x/api', okBody), 'balaraja');
		expect(h.cut).toHaveBeenCalledWith('balaraja', expect.objectContaining({ itemId: 31, identitasBarangId: 9, quantity: 2, projectId: 5, operatorName: 'Operator A', clientTxnId: 't1', satuan: 'L' }));
		expect(await body(r)).toMatchObject({ success: true, previous_stock: 12, new_stock: 10, already_processed: false });
	});

	it('validasi input → 400', async () => {
		for (const bad of [{ ...okBody, code: '' }, { ...okBody, projectId: 0 }, { ...okBody, qty: 0 }, { ...okBody, clientTxnId: '' }]) {
			expect(await httpStatus(kioskPotongBahanPost(ev('http://x/api', bad), 'balaraja'))).toBe(400);
		}
		expect(h.cut).not.toHaveBeenCalled();
	});

	it('kegagalan potong (mis. stok kurang) → 400 dengan pesan', async () => {
		h.cut.mockRejectedValue(new Error('Stok "Cat" tidak cukup.'));
		await expect(kioskPotongBahanPost(ev('http://x/api', okBody), 'balaraja')).rejects.toMatchObject({ status: 400, body: { message: expect.stringContaining('tidak cukup') } });
	});
});
