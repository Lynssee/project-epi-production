// src/lib/server/ess/bookmarks.ts
// Personal Bookmarks & Quick Access (ESS Fitur Personal Fase 2) — koleksi personal_bookmarks.
// Murni privat per karyawan: setiap query WAJIB difilter karyawan_id, jangan percaya
// karyawan_id dari klien.

import { directusServerJson } from '$lib/server/directus';

export interface PersonalBookmarkRecord {
	id: number;
	karyawan_id: number;
	label: string;
	url: string;
	icon: string | null;
	sort_order: number;
	date_created: string;
}

const BOOKMARK_FIELDS = ['id', 'karyawan_id', 'label', 'url', 'icon', 'sort_order', 'date_created'].join(',');

function unwrapId(value: any): number | null {
	if (value == null) return null;
	return typeof value === 'object' ? (value.id ?? null) : value;
}

function normalize(row: any): PersonalBookmarkRecord {
	return { ...row, karyawan_id: unwrapId(row.karyawan_id) as number, sort_order: row.sort_order ?? 0 };
}

export async function listMyBookmarks(karyawanId: number): Promise<PersonalBookmarkRecord[]> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		fields: BOOKMARK_FIELDS,
		sort: 'sort_order,date_created',
		limit: '100'
	});
	const result = await directusServerJson<{ data: any[] }>(`/items/personal_bookmarks?${query.toString()}`);
	return (result?.data || []).map(normalize);
}

export async function createBookmark(
	karyawanId: number,
	input: { label: string; url: string; icon?: string | null }
): Promise<PersonalBookmarkRecord> {
	const existing = await listMyBookmarks(karyawanId);
	const maxOrder = existing.reduce((max, b) => Math.max(max, b.sort_order), -1);
	const result = await directusServerJson<{ data: any }>('/items/personal_bookmarks', {
		method: 'POST',
		body: JSON.stringify({
			karyawan_id: karyawanId,
			label: input.label,
			url: input.url,
			icon: input.icon || null,
			sort_order: maxOrder + 1
		})
	});
	return normalize(result.data);
}

async function assertOwned(karyawanId: number, bookmarkId: number): Promise<void> {
	const query = new URLSearchParams({ 'filter[karyawan_id][_eq]': String(karyawanId), 'filter[id][_eq]': String(bookmarkId), fields: 'id', limit: '1' });
	const owned = await directusServerJson<{ data: Array<{ id: number }> }>(`/items/personal_bookmarks?${query.toString()}`);
	if (!owned?.data?.length) throw new Error('Bookmark tidak ditemukan.');
}

export async function updateBookmark(
	karyawanId: number,
	bookmarkId: number,
	patch: Partial<{ label: string; url: string; icon: string | null; sort_order: number }>
): Promise<PersonalBookmarkRecord> {
	await assertOwned(karyawanId, bookmarkId);
	const result = await directusServerJson<{ data: any }>(`/items/personal_bookmarks/${bookmarkId}`, {
		method: 'PATCH',
		body: JSON.stringify(patch)
	});
	return normalize(result.data);
}

/** Set ulang sort_order sesuai urutan array id yang dikirim klien (semua harus milik karyawan ini). */
export async function reorderBookmarks(karyawanId: number, orderedIds: number[]): Promise<void> {
	const owned = await listMyBookmarks(karyawanId);
	const ownedIds = new Set(owned.map((b) => b.id));
	for (const id of orderedIds) {
		if (!ownedIds.has(id)) throw new Error('Bookmark tidak ditemukan.');
	}
	await Promise.all(orderedIds.map((id, index) => directusServerJson(`/items/personal_bookmarks/${id}`, { method: 'PATCH', body: JSON.stringify({ sort_order: index }) })));
}

export async function deleteBookmark(karyawanId: number, bookmarkId: number): Promise<void> {
	await assertOwned(karyawanId, bookmarkId);
	await directusServerJson(`/items/personal_bookmarks/${bookmarkId}`, { method: 'DELETE' });
}
