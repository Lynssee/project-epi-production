// src/lib/services/tutorialApi.ts
// Client-side service Tutorial per Role (Fase 2) — SELALU lewat
// /api/tutorial/*, tidak pernah akses Directus langsung dari klien.
// Pola sama dengan services/ess/cuti.ts.

import { auth } from '$lib/firebase';

export interface TutorialRoleMapRow {
	id: number;
	posisi_id: number | null;
	modul_slug: string;
	urutan: number;
	wajib: boolean;
	target_app: string;
	is_active: boolean;
}

export interface TutorialVideoRow {
	id: number;
	judul: string;
	deskripsi?: string;
	modul_slug: string;
	video_type: 'youtube' | 'self-hosted' | 'none';
	video_url: string;
	durasi_detik?: number | null;
	urutan: number;
	wajib: boolean;
	target_app: string;
}

export interface TutorialProgressRow {
	id: number;
	user_email: string;
	tutorial_ref: string;
	jenis: 'tour' | 'video' | 'panduan';
	persen: number;
	status: 'belum' | 'proses' | 'selesai';
}

export interface TutorialForMe {
	posisiId: number | null;
	roleMap: TutorialRoleMapRow[];
	videos: TutorialVideoRow[];
	progress: TutorialProgressRow[];
}

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

export async function fetchTutorialForMe(): Promise<{ success: boolean; data?: TutorialForMe; error?: string }> {
	try {
		const idToken = await getIdToken();
		const res = await fetch('/api/tutorial/for-me', { headers: { Authorization: `Bearer ${idToken}` } });
		const data = await res.json().catch(() => null);
		if (!res.ok) return { success: false, error: data?.message || `Gagal memuat tutorial (${res.status})` };
		return { success: true, data: data?.data || { posisiId: null, roleMap: [], videos: [], progress: [] } };
	} catch (e) {
		return { success: false, error: e instanceof Error ? e.message : 'Gagal memuat tutorial' };
	}
}

export interface ProjectSopNote {
	id: number;
	judul: string;
	isi: string;
	kategori: 'keselamatan' | 'akses_lokasi' | 'kontak' | 'lainnya';
	urutan: number;
}

/** Instruksi/SOP khusus proyek "aktif hari ini" milik user (§7B #3) — kosong kalau belum absen atau lokasinya tak terhubung ke proyek manapun. */
export async function fetchProjectSop(): Promise<{ success: boolean; data?: { projectId: number | null; notes: ProjectSopNote[] }; error?: string }> {
	try {
		const idToken = await getIdToken();
		const res = await fetch('/api/project-sop', { headers: { Authorization: `Bearer ${idToken}` } });
		const data = await res.json().catch(() => null);
		if (!res.ok) return { success: false, error: data?.message || `Gagal memuat SOP proyek (${res.status})` };
		return { success: true, data: data?.data || { projectId: null, notes: [] } };
	} catch (e) {
		return { success: false, error: e instanceof Error ? e.message : 'Gagal memuat SOP proyek' };
	}
}

/** Kirim feedback "Membantu/Tidak" + komentar opsional untuk satu artikel panduan (§7B #4). */
export async function sendPanduanFeedback(params: { modulSlug: string; helpful: boolean; komentar?: string }) {
	try {
		const idToken = await getIdToken();
		const res = await fetch('/api/tutorial/feedback', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
			body: JSON.stringify({ modul_slug: params.modulSlug, helpful: params.helpful, komentar: params.komentar || '' })
		});
		const data = await res.json().catch(() => null);
		if (!res.ok || data?.success === false) return { success: false, error: data?.message || data?.error || `Gagal mengirim feedback (${res.status})` };
		return { success: true, data: data?.data };
	} catch (e) {
		return { success: false, error: e instanceof Error ? e.message : 'Gagal mengirim feedback' };
	}
}

/** Catat progress (fire-and-forget aman dipanggil) — jenis: 'tour'|'video'|'panduan'. */
export async function recordTutorialProgress(params: { tutorialRef: string; jenis: 'tour' | 'video' | 'panduan'; persen?: number; status?: string }) {
	try {
		const idToken = await getIdToken();
		const res = await fetch('/api/tutorial/progress', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
			body: JSON.stringify({ tutorial_ref: params.tutorialRef, jenis: params.jenis, persen: params.persen ?? 0, status: params.status })
		});
		const data = await res.json().catch(() => null);
		if (!res.ok || data?.success === false) return { success: false, error: data?.message || data?.error };
		return { success: true, data: data?.data };
	} catch (e) {
		return { success: false, error: e instanceof Error ? e.message : 'Gagal mencatat progress' };
	}
}
