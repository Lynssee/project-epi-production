import { describe, it, expect } from 'vitest';
import { klasifikasiKelayakan, ringkasExpiryPerItem, sisaHari } from './batchKelayakan';

const now = new Date('2026-11-04T08:00:00Z');

describe('sisaHari', () => {
	it('selisih hari kalender, negatif = lewat, tanggal tak valid = null', () => {
		expect(sisaHari('2026-12-04', now)).toBe(30);
		expect(sisaHari('2026-11-01', now)).toBe(-3);
		expect(sisaHari(null, now)).toBeNull();
		expect(sisaHari('bukan tanggal', now)).toBeNull();
	});
});

describe('klasifikasiKelayakan', () => {
	const k = (o: any) => klasifikasiKelayakan({ now, agingHari: 30, ...o });
	it('layak bila sisa di atas ambang', () => {
		expect(k({ tanggalKadaluarsa: '2027-06-01' })).toMatchObject({ status: 'layak', label: 'LAYAK PAKAI', bisaMintaRetest: false });
	});
	it('prioritas FEFO bila sisa <= ambang; tombol Re-QC hanya saat sangat dekat (<=7 hari)', () => {
		expect(k({ tanggalKadaluarsa: '2026-11-24' })).toMatchObject({ status: 'prioritas', sisaHari: 20, bisaMintaRetest: false });
		expect(k({ tanggalKadaluarsa: '2026-11-08' })).toMatchObject({ status: 'prioritas', bisaMintaRetest: true });
	});
	it('lewat tanggal tanpa Re-QC = STOP + bisa minta Re-QC', () => {
		expect(k({ tanggalKadaluarsa: '2026-10-01' })).toMatchObject({ status: 'stop', bisaMintaRetest: true });
	});
	it('lewat tanggal tetapi lolos Re-QC berlaku = prioritas pakai segera', () => {
		const r = k({ tanggalKadaluarsa: '2026-10-01', retestAktif: true, retestBerlakuSampai: '2026-12-01' });
		expect(r).toMatchObject({ status: 'prioritas', bisaMintaRetest: false });
		expect(r.pesan).toContain('2026-12-01');
	});
	it('hold komplain & karantina & status expired selalu STOP, walau tanggal masih jauh', () => {
		expect(k({ tanggalKadaluarsa: '2028-01-01', hold: true }).status).toBe('stop');
		expect(k({ tanggalKadaluarsa: '2028-01-01', status: 'quarantine' })).toMatchObject({ status: 'stop', bisaMintaRetest: false });
		expect(k({ tanggalKadaluarsa: '2028-01-01', status: 'expired' })).toMatchObject({ status: 'stop', bisaMintaRetest: true });
	});
	it('tanpa tanggal = netral (bukan STOP, bukan layak)', () => {
		expect(k({ tanggalKadaluarsa: null })).toMatchObject({ status: 'tanpa_tanggal', sisaHari: null });
	});
	it('ambang tak valid jatuh ke 30', () => {
		expect(klasifikasiKelayakan({ now, agingHari: NaN as any, tanggalKadaluarsa: '2026-11-24' }).status).toBe('prioritas');
	});
});

describe('ringkasExpiryPerItem', () => {
	const b = (o: any) => ({ id: 1, item_id: 5, lot_number: 'L', batch_no_fg: null, tanggal_kadaluarsa: null, qty_tersisa: 1, ...o });
	it('terdekat per barang, batch tanpa stok diabaikan, batch tanpa tanggal dihitung terpisah', () => {
		const r = ringkasExpiryPerItem(
			[b({ id: 1, tanggal_kadaluarsa: '2027-06-01' }), b({ id: 2, tanggal_kadaluarsa: '2026-11-20', lot_number: 'NEAR' }), b({ id: 3, qty_tersisa: 0, tanggal_kadaluarsa: '2026-01-01' }), b({ id: 4 }), b({ id: 5, item_id: 9 })],
			30,
			now
		);
		expect(r[5].terdekat).toMatchObject({ batchId: 2, lot: 'NEAR', sisaHari: 16 });
		expect(r[5]).toMatchObject({ status: 'prioritas', jumlahBatch: 3, tanpaTanggal: 1 });
		expect(r[9]).toMatchObject({ terdekat: null, status: null, tanpaTanggal: 1 });
	});
});
