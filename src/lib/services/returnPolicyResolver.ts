// src/lib/services/returnPolicyResolver.ts
// Port TypeScript dari erp-epi-1 src/lib/config/returnPolicyResolver.js (Fase 0, Lifecycle
// Pengembalian Barang v2, 25 Sep 2026) -- dua deployment terpisah tidak bisa saling import,
// jadi logika murni ini disalin, BUKAN dipanggil lintas repo. Jaga tetap identik kalau salah
// satu diubah (lihat komentar sumber untuk rasional lengkap tiap langkah).
export const RETURN_POLICY = Object.freeze({
	WAJIB_KEMBALI: 'WAJIB_KEMBALI',
	SISA_KEMBALI: 'SISA_KEMBALI',
	HABIS_PAKAI: 'HABIS_PAKAI'
});

export const RETUR_POLICY_MAP_SETTING_KEY = 'inventory.retur.policy_map';
export const DEFAULT_BATCH_CLOSE_THRESHOLD_IDR = 50000;

export function normalizeBooleanLike(raw: unknown): boolean | null {
	if (typeof raw === 'boolean') return raw;
	if (raw == null || raw === '') return null;
	if (typeof raw === 'number') return raw !== 0;
	const s = String(raw).trim().toLowerCase();
	if (s === 'true' || s === '1') return true;
	if (s === 'false' || s === '0') return false;
	return null;
}

export function resolveReturnPolicy(
	item: { is_borrowable?: unknown; consumable?: unknown; sub_category?: number | string | null } | null | undefined,
	policyMap: Record<string, string> = {}
): { policy: string; reason: string } {
	const isBorrowable = normalizeBooleanLike(item?.is_borrowable);
	const isConsumable = normalizeBooleanLike(item?.consumable);

	if (isBorrowable === true) {
		return { policy: RETURN_POLICY.WAJIB_KEMBALI, reason: 'is_borrowable=true' };
	}
	if (isConsumable === true) {
		return { policy: RETURN_POLICY.HABIS_PAKAI, reason: 'consumable=true' };
	}

	const subCategory = item?.sub_category ?? null;
	if (subCategory != null && policyMap && Object.prototype.hasOwnProperty.call(policyMap, String(subCategory))) {
		const mapped = policyMap[String(subCategory)];
		if (Object.values(RETURN_POLICY).includes(mapped)) {
			return { policy: mapped, reason: `policy_map[${subCategory}]` };
		}
	}

	return { policy: RETURN_POLICY.SISA_KEMBALI, reason: 'fallback' };
}

export function isEligibleForBatchClose(
	policy: string,
	nilaiPerBaris: number | null | undefined,
	thresholdIdr: number = DEFAULT_BATCH_CLOSE_THRESHOLD_IDR
): boolean {
	if (policy !== RETURN_POLICY.HABIS_PAKAI) return false;
	return Number(nilaiPerBaris ?? 0) < Number(thresholdIdr ?? DEFAULT_BATCH_CLOSE_THRESHOLD_IDR);
}
