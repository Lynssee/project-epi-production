// Port test dari erp-epi-1 (parity check) — resolver Kebijakan Kembali, Fase 0/3.
import { describe, it, expect } from 'vitest';
import {
	RETURN_POLICY,
	normalizeBooleanLike,
	resolveReturnPolicy,
	isEligibleForBatchClose,
	DEFAULT_BATCH_CLOSE_THRESHOLD_IDR
} from './returnPolicyResolver';

describe('normalizeBooleanLike', () => {
	it('mengembalikan boolean asli apa adanya', () => {
		expect(normalizeBooleanLike(true)).toBe(true);
		expect(normalizeBooleanLike(false)).toBe(false);
	});

	it('menormalisasi string "FALSE"/"TRUE" (kasus nyata PROD)', () => {
		expect(normalizeBooleanLike('FALSE')).toBe(false);
		expect(normalizeBooleanLike('TRUE')).toBe(true);
	});

	it('mengembalikan null untuk nilai kosong/tak dikenal', () => {
		expect(normalizeBooleanLike(null)).toBeNull();
		expect(normalizeBooleanLike('')).toBeNull();
		expect(normalizeBooleanLike('maybe')).toBeNull();
	});
});

describe('resolveReturnPolicy', () => {
	it('is_borrowable=true -> WAJIB_KEMBALI, menang atas consumable/peta', () => {
		expect(resolveReturnPolicy({ is_borrowable: true, consumable: true }).policy).toBe(RETURN_POLICY.WAJIB_KEMBALI);
	});

	it('consumable=true -> HABIS_PAKAI', () => {
		expect(resolveReturnPolicy({ is_borrowable: false, consumable: true }).policy).toBe(RETURN_POLICY.HABIS_PAKAI);
	});

	it('memakai peta sub_category (kunci numerik FK) ketika is_borrowable/consumable tidak diketahui', () => {
		const map = { '5': RETURN_POLICY.HABIS_PAKAI };
		expect(resolveReturnPolicy({ sub_category: 5 }, map).policy).toBe(RETURN_POLICY.HABIS_PAKAI);
	});

	it('fallback ke SISA_KEMBALI untuk barang tak terklasifikasi', () => {
		const r = resolveReturnPolicy({ is_borrowable: null, consumable: null, sub_category: null });
		expect(r.policy).toBe(RETURN_POLICY.SISA_KEMBALI);
	});

	it('item null/undefined tidak melempar error', () => {
		expect(resolveReturnPolicy(undefined).policy).toBe(RETURN_POLICY.SISA_KEMBALI);
	});
});

describe('isEligibleForBatchClose', () => {
	it('hanya HABIS_PAKAI yang boleh ditutup massal', () => {
		expect(isEligibleForBatchClose(RETURN_POLICY.WAJIB_KEMBALI, 1000)).toBe(false);
	});

	it('di bawah ambang default -> boleh tutup massal', () => {
		expect(isEligibleForBatchClose(RETURN_POLICY.HABIS_PAKAI, 49999)).toBe(true);
		expect(isEligibleForBatchClose(RETURN_POLICY.HABIS_PAKAI, DEFAULT_BATCH_CLOSE_THRESHOLD_IDR)).toBe(false);
	});
});
