// PC3-19 — tabel harapan IDENTIK dengan erp-epi src/lib/server/pettyCashIdempotency.test.js
import { describe, it, expect } from 'vitest';
import { normalizeTxnId, isClientTxnConflict } from './pettyCashIdempotency';

describe('normalizeTxnId', () => {
	it('dirapikan, dipotong 64, kosong → null', () => {
		expect(normalizeTxnId('  abc-123  ')).toBe('abc-123');
		expect(normalizeTxnId('x'.repeat(100))).toHaveLength(64);
		expect(normalizeTxnId('')).toBeNull();
		expect(normalizeTxnId('   ')).toBeNull();
		expect(normalizeTxnId(null)).toBeNull();
		expect(normalizeTxnId(undefined)).toBeNull();
		expect(normalizeTxnId(12345)).toBe('12345');
	});
});

describe('isClientTxnConflict', () => {
	it('unik pada client_txn_id (field / pesan) → true', () => {
		expect(isClientTxnConflict({ code: 'RECORD_NOT_UNIQUE', field: 'client_txn_id', message: 'x' })).toBe(true);
		expect(isClientTxnConflict({ message: 'Value for field "client_txn_id" in collection "petty_cash_requests" has to be unique.' })).toBe(true);
	});
	it('unik pada request_number → false (retry nomor, bukan kembalikan existing)', () => {
		expect(isClientTxnConflict({ code: 'RECORD_NOT_UNIQUE', field: 'request_number', message: 'Value for field "request_number" has to be unique' })).toBe(false);
	});
	it('error lain / kosong → false', () => {
		expect(isClientTxnConflict({ message: 'timeout' })).toBe(false);
		expect(isClientTxnConflict(null)).toBe(false);
		expect(isClientTxnConflict({ message: 'client_txn_id tidak ada' })).toBe(false);
	});
});
