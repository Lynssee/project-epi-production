// src/lib/services/releaseNotesApi.ts
// Client-side wrapper untuk widget "Yang Baru" di /bantuan (Fase 3,
// implementation_plan_Help System). Pola sama dgn panduanApi.ts — TIDAK
// melempar error, kegagalan/kekosongan cukup { success: false }/[].

import { auth } from '$lib/firebase';

export interface ReleaseNoteItem {
	id: number;
	versi: string;
	judul: string;
	ringkasan: string;
	tipe: 'major' | 'minor' | 'patch' | 'hotfix';
	tanggal_rilis: string;
	breaking_changes: string | null;
	auto_generated: boolean;
}

export async function fetchReleaseNotes(limit = 5): Promise<{ success: boolean; data?: ReleaseNoteItem[]; error?: string }> {
	try {
		const user = auth.currentUser;
		if (!user) return { success: false, error: 'Belum login' };
		const idToken = await user.getIdToken();
		const res = await fetch(`/api/release-notes?limit=${limit}`, { headers: { Authorization: `Bearer ${idToken}` } });
		const data = await res.json().catch(() => null);
		if (!res.ok || !data?.success) return { success: false, error: data?.message || `Gagal memuat yang baru (${res.status})` };
		return { success: true, data: data.data || [] };
	} catch (e) {
		return { success: false, error: e instanceof Error ? e.message : 'Gagal memuat yang baru' };
	}
}
