import { describe, it, expect } from 'vitest';
import { deriveDisputeTahap } from './legalDisputeStatus';

const pa = (o: any = {}) => ({ status: 'Approved', dynamic_fields: { customer_id: 7, jenis_perkara: 'somasi' }, ...o });

describe('deriveDisputeTahap', () => {
	it('null bila tak ada PA / PA belum disetujui / customer beda', () => {
		expect(deriveDisputeTahap([], 7)).toBeNull();
		expect(deriveDisputeTahap(null, 7)).toBeNull();
		expect(deriveDisputeTahap([pa({ status: 'Pending' }), pa({ status: 'Rejected' })], 7)).toBeNull();
		expect(deriveDisputeTahap([pa()], 8)).toBeNull();
		expect(deriveDisputeTahap([pa({ dynamic_fields: null })], 7)).toBeNull();
	});
	it('somasi untuk jenis non-litigasi', () => {
		expect(deriveDisputeTahap([pa()], 7)).toBe('somasi');
		expect(deriveDisputeTahap([pa({ dynamic_fields: { customer_id: '7', jenis_perkara: 'mediasi' } })], 7)).toBe('somasi');
	});
	it('litigasi menang atas somasi, urutan baris tak berpengaruh', () => {
		const lit = pa({ dynamic_fields: { customer_id: { id: 7 }, jenis_perkara: 'litigasi_perdata' } });
		expect(deriveDisputeTahap([pa(), lit], 7)).toBe('litigasi');
		expect(deriveDisputeTahap([lit, pa()], 7)).toBe('litigasi');
	});
});
