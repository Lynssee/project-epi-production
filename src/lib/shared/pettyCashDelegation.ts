// src/lib/shared/pettyCashDelegation.ts
// PC3-15 — salinan TS dari erp-epi `src/lib/server/pettyCashDelegation.js` (pemilihan delegasi cuti, logika MURNI).
// JAGA IDENTIK: tes kontrak (pettyCashDelegation.test.ts) memakai tabel harapan yang sama di kedua repo.

export const PETTY_CASH_MODULE_KEY = 'finance.petty_cash';

export interface DelegationRow {
	from_user: number | string | null;
	to_user: number | string | null;
	module_key?: string | null;
	start_date?: string | null;
	end_date?: string | null;
	is_active?: boolean | null;
}

const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));

/**
 * Pilih penerima delegasi untuk `fromId`. Delegasi ke pemohon sendiri DILEWATI (anti self-approval, Aturan #4) —
 * lanjut ke delegasi berikutnya; tak ada yang valid → null (pemanggil tetap memakai penerima semula).
 */
export function pickDelegate(
	delegations: DelegationRow[] | null | undefined,
	fromId: number | string | null | undefined,
	ctx: { requesterId?: number | string | null; todayIso: string }
): number | null {
	const from = num(fromId);
	const req = num(ctx.requesterId);
	const today = String(ctx.todayIso).slice(0, 10);
	for (const d of delegations || []) {
		if (num(d.from_user) !== from) continue;
		if (d.is_active === false) continue;
		if (d.start_date && String(d.start_date).slice(0, 10) > today) continue;
		if (d.end_date && String(d.end_date).slice(0, 10) < today) continue;
		if (d.module_key !== PETTY_CASH_MODULE_KEY && d.module_key !== '*') continue;
		const to = num(d.to_user);
		if (!to || to === from || (req != null && to === req)) continue;
		return to;
	}
	return null;
}
