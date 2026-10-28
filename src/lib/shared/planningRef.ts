// Penanda baris RAP hasil kalkulasi Charter (project_budgets.source_planning_ref), format `charter:<id>:<kind>[:<key>]`.
// ⚠️ Salinan dari erp-epi `src/lib/utils/planningContract.js` (parsePlanningRef/isPlanningDerived) — ubah keduanya bersamaan;
// planningRef.test.ts mengunci formatnya.

export const PLANNING_REF_KINDS = ['spec', 'manpower', 'method'] as const;

export function isPlanningDerived(row: { source_planning_ref?: string | null } | null | undefined): boolean {
	const parts = String(row?.source_planning_ref ?? '').split(':');
	if (parts.length < 3 || parts.length > 4) return false;
	const [prefix, cid, kind, key] = parts;
	const id = Number(cid);
	if (prefix !== 'charter' || !Number.isInteger(id) || id <= 0) return false;
	if (!(PLANNING_REF_KINDS as readonly string[]).includes(kind)) return false;
	return key === undefined || /^[A-Za-z0-9_-]+$/.test(key);
}

/** Urutkan stabil: baris dari Planning di depan, urutan lain dipertahankan. */
export function plannedFirst<T extends { source_planning_ref?: string | null }>(rows: T[]): T[] {
	return [...rows].sort((a, b) => Number(isPlanningDerived(b)) - Number(isPlanningDerived(a)));
}
