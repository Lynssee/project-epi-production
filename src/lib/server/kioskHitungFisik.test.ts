import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
	tambahPlacement: vi.fn(),
	bolehAdjustRak: vi.fn(),
	adjustOpnameRak: vi.fn(),
	masukkanKeSesiAktif: vi.fn(),
	directusServerJson: vi.fn(),
	requireKioskMenu: vi.fn()
}));

vi.mock('$lib/server/kioskAuth', () => ({ requireKioskSession: () => ({ karyawanId: 5, nama: 'Agus' }) }));
vi.mock('$lib/server/kioskMenuAccess', () => ({ requireKioskMenu: m.requireKioskMenu }));
vi.mock('$lib/server/directus', () => ({ directusServerJson: m.directusServerJson }));
vi.mock('$lib/server/kioskStok', () => ({ tambahPlacement: m.tambahPlacement, TAMBAH_PLACEMENT_MAX: 50 }));
vi.mock('$lib/server/kioskGudang', () => ({ bolehAdjustRak: m.bolehAdjustRak, adjustOpnameRak: m.adjustOpnameRak }));
vi.mock('$lib/server/opnameSesi', () => ({ masukkanKeSesiAktif: m.masukkanKeSesiAktif }));

import { catatHitungFisikRak } from './kioskHitungFisik';
import { POST } from '../../routes/api/kiosk/stok/rak/[gudangId]/placement/+server';

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

const ADJ_OK = (fisik: number) => ({ ok: true, status: 'auto_approved', alokasi: 0, selisih: fisik, di_rak_baru: fisik, stok_tersedia_baru: fisik, terakhir_update: 'x', reference_no: 'SL-1' });

beforeEach(() => {
	Object.values(m).forEach((f) => f.mockReset());
	m.directusServerJson.mockResolvedValue({ data: { parent_gudang_id: 147, pic_karyawan_ids: [] } });
	m.masukkanKeSesiAktif.mockResolvedValue(null);
	m.adjustOpnameRak.mockImplementation(async (i: any) => ADJ_OK(i.hitung_fisik));
	m.bolehAdjustRak.mockResolvedValue(true);
});

describe('catatHitungFisikRak', () => {
	const input = { gudang_id: 51, placement_id: 9, item_id: 7, hitung_fisik: 12, catatan: '', client_txn_id: 't', karyawan_id: 5, karyawan_nama: 'Agus' };

	it('ada sesi opname aktif → masuk sesi, TIDAK adjustment langsung', async () => {
		m.masukkanKeSesiAktif.mockResolvedValue({ kode: 'OPN-1' });
		expect(await catatHitungFisikRak(input)).toEqual({ ok: true, status: 'masuk_sesi', reference_no: 'OPN-1' });
		expect(m.adjustOpnameRak).not.toHaveBeenCalled();
	});

	it('tanpa sesi / cek sesi gagal → adjustment langsung', async () => {
		m.masukkanKeSesiAktif.mockRejectedValue(new Error('down'));
		const r = await catatHitungFisikRak(input);
		expect(r.ok && r.status).toBe('auto_approved');
		expect(m.adjustOpnameRak).toHaveBeenCalledWith(expect.objectContaining({ placement_id: 9, hitung_fisik: 12, client_txn_id: 't' }));
	});
});

describe('POST tambah item ke rak + hitung fisik', () => {
	it('tanpa hitung fisik: tidak cek izin adjustment & tidak menulis stok (perilaku lama)', async () => {
		m.tambahPlacement.mockResolvedValue({ ok: true, ditambahkan: [{ item_id: 1, placement_id: 11, nama: 'A' }], dilewati: [] });
		const res = await call({ items: [{ item_id: 1 }] });
		expect(res.status).toBe(200);
		expect((await res.json()).hitung_fisik).toEqual([]);
		expect(m.bolehAdjustRak).not.toHaveBeenCalled();
		expect(m.adjustOpnameRak).not.toHaveBeenCalled();
	});

	it('tidak berhak + ada hitung fisik → 403 SEBELUM penempatan dibuat', async () => {
		m.bolehAdjustRak.mockResolvedValue(false);
		expect(await status(call({ items: [{ item_id: 1, hitung_fisik: 5 }] }))).toBe(403);
		expect(m.tambahPlacement).not.toHaveBeenCalled();
	});

	it('hitung fisik dicatat hanya untuk barang yang baru ditempatkan; yang dilewati tidak', async () => {
		m.tambahPlacement.mockResolvedValue({
			ok: true,
			ditambahkan: [
				{ item_id: 1, placement_id: 11, nama: 'A' },
				{ item_id: 3, placement_id: 13, nama: 'C' }
			],
			dilewati: [{ item_id: 2, nama: 'B', alasan: 'Sudah ada di rak ini' }]
		});
		const res = await call({
			client_batch_id: 'b1',
			items: [
				{ item_id: 1, hitung_fisik: 12 },
				{ item_id: 2, hitung_fisik: 99 },
				{ item_id: 3, hitung_fisik: '' }
			]
		});
		const data = await res.json();
		expect(m.adjustOpnameRak).toHaveBeenCalledTimes(1);
		expect(m.adjustOpnameRak).toHaveBeenCalledWith(
			expect.objectContaining({ gudang_id: 51, placement_id: 11, hitung_fisik: 12, client_txn_id: 'tambahrak-51-b1-1', karyawan_id: 5 })
		);
		expect(data.hitung_fisik).toEqual([{ item_id: 1, nama: 'A', ok: true, status: 'auto_approved', reference_no: 'SL-1', di_rak_baru: 12 }]);
		// expected_qty tidak lagi diisi dari kolom ini
		expect(m.tambahPlacement.mock.calls[0][0].items).toEqual([
			{ item_id: 1, expected_qty: null },
			{ item_id: 2, expected_qty: null },
			{ item_id: 3, expected_qty: null }
		]);
	});

	it('satu barang gagal tidak membatalkan barang lain', async () => {
		m.tambahPlacement.mockResolvedValue({
			ok: true,
			ditambahkan: [
				{ item_id: 1, placement_id: 11, nama: 'A' },
				{ item_id: 2, placement_id: 12, nama: 'B' }
			],
			dilewati: []
		});
		m.adjustOpnameRak
			.mockResolvedValueOnce({ ok: false, error: 'Gagal menyimpan saldo rak. Coba lagi.', status: 502 })
			.mockImplementationOnce(async (i: any) => ADJ_OK(i.hitung_fisik));
		const data = await (await call({ items: [{ item_id: 1, hitung_fisik: 1 }, { item_id: 2, hitung_fisik: 2 }] })).json();
		expect(data.hitung_fisik.map((h: any) => h.ok)).toEqual([false, true]);
		expect(data.hitung_fisik[0].error).toContain('Gagal menyimpan saldo rak');
	});

	it('validasi: hitung fisik negatif → 400; lebih dari 20 baris hitung fisik → 400', async () => {
		expect(await status(call({ items: [{ item_id: 1, hitung_fisik: -1 }] }))).toBe(400);
		const banyak = Array.from({ length: 21 }, (_, i) => ({ item_id: i + 1, hitung_fisik: 1 }));
		expect(await status(call({ items: banyak }))).toBe(400);
		expect(m.tambahPlacement).not.toHaveBeenCalled();
	});
});
