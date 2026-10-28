// src/lib/services/ess/bookmarks.ts
// Client-side service ESS Personal Bookmarks — selalu lewat /api/ess/bookmarks/*.

import { auth } from '$lib/firebase';

export interface PersonalBookmark {
	id: number;
	karyawan_id: number;
	label: string;
	url: string;
	icon: string | null;
	sort_order: number;
	date_created: string;
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

export async function getBookmarks(): Promise<PersonalBookmark[]> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/bookmarks', { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	const data = await res.json();
	return data.bookmarks;
}

export async function createBookmark(params: { label: string; url: string; icon?: string | null }): Promise<PersonalBookmark> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/bookmarks', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
		body: JSON.stringify(params)
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	const data = await res.json();
	return data.bookmark;
}

export async function updateBookmark(id: number, patch: Partial<{ label: string; url: string; icon: string | null }>): Promise<PersonalBookmark> {
	const idToken = await getIdToken();
	const res = await fetch(`/api/ess/bookmarks/${id}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
		body: JSON.stringify(patch)
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	const data = await res.json();
	return data.bookmark;
}

export async function deleteBookmark(id: number): Promise<void> {
	const idToken = await getIdToken();
	const res = await fetch(`/api/ess/bookmarks/${id}`, {
		method: 'DELETE',
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
}

export async function reorderBookmarks(orderedIds: number[]): Promise<void> {
	const idToken = await getIdToken();
	const res = await fetch('/api/ess/bookmarks', {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
		body: JSON.stringify({ orderedIds })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
}
