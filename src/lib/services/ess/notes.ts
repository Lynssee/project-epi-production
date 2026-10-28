// src/lib/services/ess/notes.ts
// Client-side service ESS Personal Notes & Quick Log — selalu lewat /api/ess/notes/*.

import { auth } from '$lib/firebase';

export interface PersonalNote {
	id: number;
	karyawan_id: number;
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

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

async function parseErrorMessage(res: Response): Promise<string> {
	try {
		const data = await res.json();
		return data?.message || `Gagal (${res.status})`;
	} catch {
		return `Gagal (${res.status})`;
	}
}

export async function getNotes(opts: { status?: 'active' | 'archived'; type?: string; tag?: string } = {}): Promise<PersonalNote[]> {
	const idToken = await getIdToken();
	const params = new URLSearchParams();
	if (opts.status) params.set('status', opts.status);
	if (opts.type) params.set('type', opts.type);
	if (opts.tag) params.set('tag', opts.tag);
	const res = await fetch(`/api/ess/notes?${params.toString()}`, { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	const data = await res.json();
	return data.notes;
}

export interface CreateNoteParams {
	title?: string | null;
	content: string;
	type?: 'note' | 'quick_log' | 'reminder';
	color?: string | null;
	tags?: string[] | null;
	reminder_date?: string | null;
}

export async function createNote(params: CreateNoteParams): Promise<PersonalNote> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/notes', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
		body: JSON.stringify(params)
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	const data = await res.json();
	return data.note;
}

export async function updateNote(id: number, patch: Partial<CreateNoteParams & { is_pinned: boolean; status: 'active' | 'archived' }>): Promise<PersonalNote> {
	const idToken = await getIdToken();
	const res = await fetch(`/api/ess/notes/${id}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
		body: JSON.stringify(patch)
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	const data = await res.json();
	return data.note;
}

export async function deleteNote(id: number): Promise<void> {
	const idToken = await getIdToken();
	const res = await fetch(`/api/ess/notes/${id}`, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
}

export async function togglePin(note: PersonalNote): Promise<PersonalNote> {
	return updateNote(note.id, { is_pinned: !note.is_pinned });
}

export async function archiveNote(id: number): Promise<PersonalNote> {
	return updateNote(id, { status: 'archived' });
}
