// src/lib/server/ess/notes.ts
// Personal Notes & Quick Log (ESS Fitur Personal Fase 1) — koleksi personal_notes.
// Murni privat per karyawan: setiap query WAJIB difilter karyawan_id, jangan percaya
// karyawan_id dari klien.

import { directusServerJson } from '$lib/server/directus';

export interface PersonalNoteRecord {
	id: number;
	karyawan_id: number;
	firebase_uid: string | null;
	title: string | null;
	content: string;
	type: 'note' | 'quick_log' | 'reminder';
	is_pinned: boolean;
	color: string | null;
	tags: string[] | null;
	reminder_date: string | null;
	reminder_sent: boolean;
	status: 'active' | 'archived';
	date_created: string;
	date_updated: string | null;
}

const NOTE_FIELDS = [
	'id', 'karyawan_id', 'firebase_uid', 'title', 'content', 'type', 'is_pinned',
	'color', 'tags', 'reminder_date', 'reminder_sent', 'status', 'date_created', 'date_updated'
].join(',');

function unwrapId(value: any): number | null {
	if (value == null) return null;
	return typeof value === 'object' ? (value.id ?? null) : value;
}

function normalize(row: any): PersonalNoteRecord {
	return { ...row, karyawan_id: unwrapId(row.karyawan_id) as number, is_pinned: !!row.is_pinned, reminder_sent: !!row.reminder_sent };
}

export async function listMyNotes(
	karyawanId: number,
	opts: { status?: 'active' | 'archived'; type?: string; tag?: string } = {}
): Promise<PersonalNoteRecord[]> {
	const { status = 'active', type, tag } = opts;
	const filterAnd: any[] = [{ karyawan_id: { _eq: karyawanId } }, { status: { _eq: status } }];
	if (type) filterAnd.push({ type: { _eq: type } });
	if (tag) filterAnd.push({ tags: { _contains: tag } });

	const query = new URLSearchParams({
		filter: JSON.stringify({ _and: filterAnd }),
		fields: NOTE_FIELDS,
		sort: '-is_pinned,-date_created',
		limit: '200'
	});
	const result = await directusServerJson<{ data: any[] }>(`/items/personal_notes?${query.toString()}`);
	return (result?.data || []).map(normalize);
}

export async function createNote(
	karyawanId: number,
	firebaseUid: string | null,
	input: { title?: string | null; content: string; type?: 'note' | 'quick_log' | 'reminder'; color?: string | null; tags?: string[] | null; reminder_date?: string | null }
): Promise<PersonalNoteRecord> {
	const type = input.type || 'note';
	if (type === 'reminder' && !input.reminder_date) {
		throw new Error('reminder_date wajib diisi untuk type=reminder.');
	}
	const result = await directusServerJson<{ data: any }>('/items/personal_notes', {
		method: 'POST',
		body: JSON.stringify({
			karyawan_id: karyawanId,
			firebase_uid: firebaseUid,
			title: input.title || null,
			content: input.content,
			type,
			color: input.color || null,
			tags: input.tags || null,
			reminder_date: type === 'reminder' ? input.reminder_date : null,
			is_pinned: false,
			reminder_sent: false,
			status: 'active'
		})
	});
	return normalize(result.data);
}

async function assertOwned(karyawanId: number, noteId: number): Promise<void> {
	const query = new URLSearchParams({ 'filter[karyawan_id][_eq]': String(karyawanId), 'filter[id][_eq]': String(noteId), fields: 'id', limit: '1' });
	const owned = await directusServerJson<{ data: Array<{ id: number }> }>(`/items/personal_notes?${query.toString()}`);
	if (!owned?.data?.length) throw new Error('Catatan tidak ditemukan.');
}

export async function updateNote(
	karyawanId: number,
	noteId: number,
	patch: Partial<{ title: string | null; content: string; is_pinned: boolean; color: string | null; tags: string[] | null; status: 'active' | 'archived' }>
): Promise<PersonalNoteRecord> {
	await assertOwned(karyawanId, noteId);
	const result = await directusServerJson<{ data: any }>(`/items/personal_notes/${noteId}`, {
		method: 'PATCH',
		body: JSON.stringify(patch)
	});
	return normalize(result.data);
}

export async function deleteNote(karyawanId: number, noteId: number): Promise<void> {
	await assertOwned(karyawanId, noteId);
	await directusServerJson(`/items/personal_notes/${noteId}`, { method: 'DELETE' });
}
