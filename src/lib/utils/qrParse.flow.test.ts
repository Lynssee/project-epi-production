import { describe, it, expect } from 'vitest';
import { parseEpiQr } from './qrParse';

describe('parseEpiQr — EPI:FLOW (stiker QR SOP, R-L3)', () => {
	it('alur saja dan alur + langkah', () => {
		expect(parseEpiQr('EPI:FLOW:maintenance_repair_lifecycle')).toEqual({ type: 'FLOW', id: 'maintenance_repair_lifecycle' });
		expect(parseEpiQr('EPI:FLOW:maintenance_repair_lifecycle:maint_wo')).toEqual({ type: 'FLOW', id: 'maintenance_repair_lifecycle', node: 'maint_wo' });
	});
	it('URL hasil cetak /scan/<kode> (kamera bawaan HP) juga terbaca; kode di-decode', () => {
		expect(parseEpiQr('https://project.eltamaprimaindo.com/scan/EPI%3AFLOW%3Aa_b%3Anode_1')).toEqual({ type: 'FLOW', id: 'a_b', node: 'node_1' });
		expect(parseEpiQr('https://x/scan/EPI:FLOW:a_b')).toEqual({ type: 'FLOW', id: 'a_b' });
	});
	it('kunci tidak valid ditolak (null), bukan dipaksa: huruf besar, spasi, karakter khusus, terlalu panjang, segmen berlebih/kosong', () => {
		for (const bad of ['EPI:FLOW:', 'EPI:FLOW:Bad_Key', 'EPI:FLOW:a b', 'EPI:FLOW:a/../b', 'EPI:FLOW:a:Node', 'EPI:FLOW:a:b:c', 'EPI:FLOW:' + 'x'.repeat(101), 'EPI:FLOW:a:' + 'y'.repeat(61), 'EPI:FLOW:a;rm', 'EPI:FLOW']) {
			expect(parseEpiQr(bad), bad).toBeNull();
		}
	});
	it('tipe lama tidak terpengaruh (format cetak fisik tetap diterima)', () => {
		expect(parseEpiQr('EPI:ITEM:12')).toEqual({ type: 'ITEM', id: 12 });
		expect(parseEpiQr('EPI:SOP:5')).toEqual({ type: 'SOP', id: 5 });
		expect(parseEpiQr('EPI:SJ:7:tok')).toEqual({ type: 'SJ', id: 7, token: 'tok' });
		expect(parseEpiQr('EPI:EQUIPMENT:AB-1')).toEqual({ type: 'EQUIPMENT', id: 'AB-1' });
	});
});
