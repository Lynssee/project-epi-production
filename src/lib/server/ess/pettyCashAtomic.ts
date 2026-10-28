// src/lib/server/ess/pettyCashAtomic.ts
// SERVER-ONLY. PC3-04 — cermin minimal `patchIf` dari erp-epi (src/lib/server/pettyCashAtomic.js).
// Update bersyarat lewat Directus update-by-query: baris hanya berubah bila `condition` masih benar.

import { directusServerJson } from '$lib/server/directus';

/** @returns true bila tepat 1 baris berubah. */
export async function patchIf(
	collection: string,
	id: number | string,
	condition: Record<string, any>,
	data: Record<string, unknown>
): Promise<boolean> {
	const res = await directusServerJson<{ data?: unknown }>(`/items/${collection}?fields=id`, {
		method: 'PATCH',
		body: JSON.stringify({
			query: { filter: { _and: [{ id: { _eq: Number(id) } }, condition] }, limit: 1 },
			data
		})
	});
	const rows = Array.isArray(res?.data) ? res.data : res?.data ? [res.data] : [];
	return rows.length === 1;
}
