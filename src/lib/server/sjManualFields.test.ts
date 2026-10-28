import { describe, it, expect } from 'vitest';
import {
	SJ_MANUAL_TYPE,
	composeManualNotes,
	parseManualNotes,
	toLegacyHeader,
	toSuratJalanItemRows,
	fromSuratJalanItemRows
} from './sjManualFields';

describe('sjManualFields — pemetaan SJ Manual ke kolom surat_jalan yang ada', () => {
	it('compose → parse bolak-balik (dengan telp & catatan)', () => {
		const raw = composeManualNotes('PT Contoh Makmur', '0812-3456', 'Kirim pagi\nHubungi satpam');
		expect(raw.startsWith('[SJ MANUAL] Tujuan: PT Contoh Makmur | Telp: 0812-3456')).toBe(true);
		expect(parseManualNotes(raw)).toEqual({ customerName: 'PT Contoh Makmur', customerPhone: '0812-3456', notes: 'Kirim pagi\nHubungi satpam' });
	});

	it('tanpa telp & tanpa catatan', () => {
		const raw = composeManualNotes('Toko A', null, '');
		expect(raw).toBe('[SJ MANUAL] Tujuan: Toko A | Telp: -');
		expect(parseManualNotes(raw)).toEqual({ customerName: 'Toko A', customerPhone: '', notes: '' });
	});

	it('notes bukan format SJ Manual → seluruhnya dianggap catatan, tanpa crash', () => {
		expect(parseManualNotes('[PENGIRIMAN URGENT] Alasan: x')).toEqual({ customerName: '', customerPhone: '', notes: '[PENGIRIMAN URGENT] Alasan: x' });
		expect(parseManualNotes(null)).toEqual({ customerName: '', customerPhone: '', notes: '' });
	});

	it('toLegacyHeader menyediakan manual_* untuk halaman lapangan', () => {
		const h = toLegacyHeader({ id: 7, type: SJ_MANUAL_TYPE, delivery_address: 'Jl. Mawar 1', notes: composeManualNotes('PT B', '021', 'ok') });
		expect(h.is_manual).toBe(true);
		expect(h.manual_customer_name).toBe('PT B');
		expect(h.manual_customer_address).toBe('Jl. Mawar 1');
		expect(h.manual_customer_phone).toBe('021');
		expect(h.manual_notes).toBe('ok');
		expect(toLegacyHeader({ id: 8, type: null }).is_manual).toBe(false);
	});

	it('item: form → surat_jalan_items hanya memakai kolom yang ada, dan kembali ke bentuk lama', () => {
		const rows = toSuratJalanItemRows(9, [{ namaBarang: 'Cat A', qty: 3, satuan: 'KG', notes: 'merah' }, { namaBarang: 'Thinner', qty: 1 }]);
		expect(rows[0]).toEqual({ surat_jalan_id: 9, nama_barang: 'Cat A', qty_required: 3, qty_remaining: 3, unit: 'KG', keterangan: 'merah', so_type: 'manual' });
		expect(rows[1].unit).toBe('PCS');
		const back = fromSuratJalanItemRows(rows);
		expect(back[0]).toEqual({ item_id: null, nama_barang: 'Cat A', qty: 3, satuan: 'KG', notes: 'merah' });
	});
});
