import { describe, it, expect } from 'vitest';
import {
	tipeToKlaimJenis,
	normalizeSumberMasalah,
	komplainToBermasalahJenis,
	buildKomplainLogPayload,
	buildSalahSpekLogPayload,
	KOMPLAIN_BATCH_PREFIX
} from './mismatchLog';

describe('tipeToKlaimJenis', () => {
	it('wrong_item -> salah_spek (bukan kurang)', () => {
		expect(tipeToKlaimJenis('wrong_item')).toBe('salah_spek');
		expect(tipeToKlaimJenis('damaged')).toBe('rusak');
		expect(tipeToKlaimJenis('quality_issue')).toBe('rusak');
		expect(tipeToKlaimJenis('other')).toBe('kurang');
		expect(tipeToKlaimJenis('apa-saja')).toBe('kurang');
	});
});

describe('sumber masalah', () => {
	it('default aman salah_kirim_gudang; hanya nilai valid yang menjadi salah_pesan_proyek', () => {
		expect(normalizeSumberMasalah(undefined)).toBe('salah_kirim_gudang');
		expect(normalizeSumberMasalah('ngawur')).toBe('salah_kirim_gudang');
		expect(normalizeSumberMasalah('salah_pesan_proyek')).toBe('salah_pesan_proyek');
	});
	it('jenis antrean admin: salah pesan proyek dibedakan dari salah kirim', () => {
		expect(komplainToBermasalahJenis('wrong_item', 'salah_kirim_gudang')).toBe('salah_kirim');
		expect(komplainToBermasalahJenis('wrong_item', 'salah_pesan_proyek')).toBe('salah_beli_internal');
		expect(komplainToBermasalahJenis('damaged', 'salah_pesan_proyek')).toBe('rusak');
		expect(komplainToBermasalahJenis('quality_issue', 'salah_kirim_gudang')).toBe('lainnya');
	});
});

describe('payload barang_bermasalah_log', () => {
	const live = new Set(['item_id', 'nama_barang', 'batch_no', 'project_id', 'packing_list_id', 'surat_jalan_id', 'jenis', 'deskripsi', 'qty', 'severity', 'blocks_dispatch', 'status', 'reported_by']);
	it('komplain: tidak memblokir dispatch, tertaut SJ & proyek, memuat sumber + foto', () => {
		const p = buildKomplainLogPayload({ nomorSj: 'SJ-1', suratJalanId: 5, projectId: 9, reporter: 'Budi', tipe: 'wrong_item', sumber: 'salah_pesan_proyek', keterangan: 'RAL beda', evidenceFileIds: ['f1', 'f2'] });
		expect(p).toMatchObject({ surat_jalan_id: 5, project_id: 9, jenis: 'salah_beli_internal', severity: 'warning', blocks_dispatch: false, status: 'open', reported_by: 'Budi', qty: null });
		expect(p.deskripsi).toContain('Salah pesan dari Proyek');
		expect(p.deskripsi).toContain('RAL beda');
		expect(p.deskripsi).toContain('f1, f2');
		for (const k of Object.keys(p)) expect(live.has(k)).toBe(true);
	});
	it('komplain per barang: item_id terisi (dasar kunci) + penanda batch_no KOMPLAIN:<SJ>; tanpa barang item_id null', () => {
		const per = buildKomplainLogPayload({ nomorSj: 'SJ-9', suratJalanId: 5, tipe: 'damaged', sumber: 'salah_kirim_gudang', itemId: 11, namaBarang: 'Cat (komplain SJ SJ-9)', qty: 3 });
		expect(per).toMatchObject({ item_id: 11, nama_barang: 'Cat (komplain SJ SJ-9)', batch_no: `${KOMPLAIN_BATCH_PREFIX}SJ-9`, qty: 3 });
		const sjLevel = buildKomplainLogPayload({ nomorSj: 'SJ-9', suratJalanId: 5, tipe: 'other', sumber: 'salah_kirim_gudang' });
		expect(sjLevel.item_id).toBeNull();
		expect(sjLevel.batch_no).toBe('KOMPLAIN:SJ-9');
	});
	it('salah spek saat terima: backhaul tercatat di deskripsi; kolom sesuai skema', () => {
		const p = buildSalahSpekLogPayload({ nomorSj: 'SJ-2', suratJalanId: 6, projectId: 9, namaBarang: 'Cat', itemId: 11, qty: 4, backhaul: true });
		expect(p).toMatchObject({ item_id: 11, nama_barang: 'Cat', jenis: 'salah_kirim', qty: 4, blocks_dispatch: false });
		expect(p.deskripsi).toContain('TITIP BALIK');
		expect(p.batch_no).toBe('TERIMA:SJ-2'); // sumber "terima di proyek"; bukan KOMPLAIN: sehingga tidak mengunci pemakaian
		for (const k of Object.keys(p)) expect(live.has(k)).toBe(true);
		expect(buildSalahSpekLogPayload({ nomorSj: 'S', suratJalanId: 1, namaBarang: '', qty: 0 }).qty).toBeNull();
	});
});

describe('buildReturSiap', () => {
	const base = { nomorSj: 'SJ-9', projectId: 9, keterangan: 'RAL beda dari pesanan', items: [{ identitasBarangId: 11, namaBarang: 'Cat', qtySent: 10, qty: 0, unit: 'KG' }] };
	it('salah spek => condition ok; rusak => rusak; qty default = qty dikirim; catatan memuat SJ & keterangan', async () => {
		const { buildReturSiap } = await import('./mismatchLog');
		const w = buildReturSiap({ ...base, tipe: 'wrong_item' });
		expect(w).toMatchObject({ projectId: 9, nomorSj: 'SJ-9' });
		expect(w!.items[0]).toMatchObject({ item_id: 11, material_name: 'Cat', qty_returned: 10, unit: 'KG', condition: 'ok' });
		expect(w!.items[0].leader_notes).toContain('SJ-9');
		expect(w!.items[0].leader_notes).toContain('RAL beda');
		expect(buildReturSiap({ ...base, tipe: 'damaged' })!.items[0].condition).toBe('rusak');
	});
	it('qty eksplisit dipakai; tipe lain / tanpa proyek / tanpa satuan / tanpa qty => null atau dilewati', async () => {
		const { buildReturSiap } = await import('./mismatchLog');
		expect(buildReturSiap({ ...base, tipe: 'wrong_item', items: [{ ...base.items[0], qty: 4 }] })!.items[0].qty_returned).toBe(4);
		expect(buildReturSiap({ ...base, tipe: 'quality_issue' })).toBeNull();
		expect(buildReturSiap({ ...base, tipe: 'other' })).toBeNull();
		expect(buildReturSiap({ ...base, tipe: 'wrong_item', projectId: null })).toBeNull();
		expect(buildReturSiap({ ...base, tipe: 'wrong_item', items: [{ ...base.items[0], unit: null }] })).toBeNull();
		expect(buildReturSiap({ ...base, tipe: 'wrong_item', items: [{ ...base.items[0], qtySent: 0, qty: 0 }] })).toBeNull();
	});
});
