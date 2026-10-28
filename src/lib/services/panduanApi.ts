// src/lib/services/panduanApi.ts
// Client-side wrapper — §6 Fase 1 wiring baca (implementation_plan_panduan
// pertajam.md). Shape hasil SAMA PERSIS dengan modulDokumentasi/kategoriModul
// hardcoded di panduan.ts, supaya panduan/+page.svelte cukup menukar sumber
// data. TIDAK melempar error — kegagalan/kekosongan direspons
// { success: false }, pemanggil WAJIB tetap fallback ke panduan.ts hardcoded.

import { auth } from '$lib/firebase';

export interface PanduanContentModul {
	id: string;
	nama: string;
	kategori: string;
	deskripsi: string;
	icon: string;
	href: string;
	langkah: { judul: string; isi: string; tips?: string; blocks?: any[] | null }[];
	faq: { tanya: string; jawab: string }[];
}

export interface PanduanContentKategori {
	id: string;
	label: string;
	emoji: string;
}

export interface PanduanBookmark {
	id: number;
	modul_slug: string;
}

async function authHeaders(): Promise<Record<string, string>> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	const idToken = await user.getIdToken();
	return { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` };
}

/** Bookmark/pin panduan favorit (§6 Fase 3) — daftar milik user login. */
export async function fetchPanduanBookmarks(): Promise<{ success: boolean; data?: PanduanBookmark[]; error?: string }> {
	try {
		const headers = await authHeaders();
		const res = await fetch('/api/panduan/bookmarks', { headers });
		const data = await res.json().catch(() => null);
		if (!res.ok) return { success: false, error: data?.message || `Gagal memuat bookmark (${res.status})` };
		return { success: true, data: data?.data || [] };
	} catch (e) {
		return { success: false, error: e instanceof Error ? e.message : 'Gagal memuat bookmark' };
	}
}

export async function addPanduanBookmark(modulSlug: string): Promise<{ success: boolean; error?: string }> {
	try {
		const headers = await authHeaders();
		const res = await fetch('/api/panduan/bookmarks', { method: 'POST', headers, body: JSON.stringify({ modul_slug: modulSlug }) });
		const data = await res.json().catch(() => null);
		if (!res.ok || data?.success === false) return { success: false, error: data?.message || data?.error };
		return { success: true };
	} catch (e) {
		return { success: false, error: e instanceof Error ? e.message : 'Gagal menambah bookmark' };
	}
}

export async function removePanduanBookmark(modulSlug: string): Promise<{ success: boolean; error?: string }> {
	try {
		const headers = await authHeaders();
		const res = await fetch(`/api/panduan/bookmarks?modul_slug=${encodeURIComponent(modulSlug)}`, { method: 'DELETE', headers });
		const data = await res.json().catch(() => null);
		if (!res.ok || data?.success === false) return { success: false, error: data?.message || data?.error };
		return { success: true };
	} catch (e) {
		return { success: false, error: e instanceof Error ? e.message : 'Gagal menghapus bookmark' };
	}
}

export async function fetchPanduanContent(): Promise<{
	success: boolean;
	data?: { kategoriModul: PanduanContentKategori[]; modulDokumentasi: PanduanContentModul[] };
	error?: string;
}> {
	try {
		const user = auth.currentUser;
		if (!user) return { success: false, error: 'Belum login' };
		const idToken = await user.getIdToken();
		const res = await fetch('/api/panduan/content', { headers: { Authorization: `Bearer ${idToken}` } });
		const data = await res.json().catch(() => null);
		if (!res.ok || !data?.success) return { success: false, error: data?.message || `Gagal memuat panduan (${res.status})` };
		return { success: true, data: data.data };
	} catch (e) {
		return { success: false, error: e instanceof Error ? e.message : 'Gagal memuat panduan' };
	}
}
