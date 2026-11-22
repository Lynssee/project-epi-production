// src/lib/services/ess/budaya.ts
// Client-side service ESS Budaya EPI — selalu lewat /api/ess/budaya.

import { auth } from '$lib/firebase';

export interface NilaiIntiItem {
	id: number;
	kode: string;
	judul: string;
	arti_singkat: string;
	perilaku: { do: string[]; dont: string[] };
	ikon: string;
	warna: string | null;
	urutan: number;
}

export interface BudayaData {
	motto: string;
	visi: string;
	misi: string[];
	manifesto_budaya: string;
	video_budaya_url: string;
	nilai: NilaiIntiItem[];
	errors: { identity?: string; nilai?: string };
}

export async function getBudaya(): Promise<BudayaData> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	const idToken = await user.getIdToken();
	const res = await fetch('/api/ess/budaya', { headers: { Authorization: `Bearer ${idToken}` } });
	if (!res.ok) {
		let msg = `Gagal (${res.status})`;
		try {
			msg = (await res.json())?.message || msg;
		} catch {
			/* non-JSON */
		}
		throw new Error(msg);
	}
	return res.json();
}

/** Embed YouTube/Vimeo → URL embed; selain itu null (tampil sebagai tautan). */
export function videoEmbedUrl(url: string): string | null {
	const u = (url || '').trim();
	const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{11})/i);
	if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
	const vm = u.match(/vimeo\.com\/(\d+)/i);
	if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
	return null;
}

// ── Konten budaya HARIAN (Fase 2) — dipilih & dinilai di server (/api/ess/budaya-harian) ──────────────
export interface BudayaHarianItem {
	id: number;
	judul: string;
	isi_pesan: string;
	tipe: string;
	core_value_id: number | null;
	poster_id?: string | null;
	pertanyaan_kuis: string | null;
	opsi_kuis: string[];
}
export interface BudayaHarianState {
	enabled: boolean;
	tbm_enabled: boolean;
	item: BudayaHarianItem | null;
	ack: { status: string; selesai: boolean } | null;
}

async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	const idToken = await user.getIdToken();
	return fetch(path, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${idToken}` } });
}

export async function getBudayaHarian(): Promise<BudayaHarianState> {
	const res = await authFetch('/api/ess/budaya-harian');
	if (!res.ok) throw new Error(`Gagal (${res.status})`);
	return res.json();
}

export async function ackBudayaHarian(
	propagandaId: number,
	aksi: 'komitmen' | 'kuis',
	jawabanIdx?: number
): Promise<{ status: string; benar: boolean; selesai: boolean }> {
	const res = await authFetch('/api/ess/budaya-harian', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ propaganda_id: propagandaId, aksi, jawaban_idx: jawabanIdx })
	});
	if (!res.ok) {
		let msg = `Gagal (${res.status})`;
		try {
			msg = (await res.json())?.message || msg;
		} catch {
			/* non-JSON */
		}
		throw new Error(msg);
	}
	return res.json();
}

// ── Popup berbasis momen + microquiz (Rencana Popup Motivasi/Tips/SOP, Fase 4) ──────────────────────
export interface BudayaPopupPayload {
	enabled: boolean;
	ymd: string | null;
	settings: Record<string, boolean | number | string>;
	items: any[];
}
/** 1 request per hari untuk semua momen (di-cache klien oleh CulturePopupHost di localStorage → tetap jalan tanpa sinyal). */
export async function getBudayaPopup(): Promise<BudayaPopupPayload> {
	const res = await authFetch('/api/ess/budaya-popup');
	if (!res.ok) throw new Error(`Gagal (${res.status})`);
	return res.json();
}
export async function ackBudayaPopup(propagandaId: number, momen: string): Promise<{ status: string | null; selesai: boolean }> {
	const res = await authFetch('/api/ess/budaya-popup', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ propaganda_id: propagandaId, momen })
	});
	if (!res.ok) throw new Error(`Gagal (${res.status})`);
	return res.json();
}
export interface MicroquizHasil {
	benar?: boolean;
	boleh_ulang?: boolean;
	sudah_dijawab?: boolean;
	status_aksi: string | null;
	kunci_idx?: number | null;
	penjelasan?: string | null;
	token?: string | null;
}
/** Jawaban microquiz dinilai SERVER; kunci hanya dikembalikan setelah benar / coba ulang habis. */
export async function jawabMicroquiz(propagandaId: number, jawabanIdx: number, momen: string, token: string | null = null): Promise<MicroquizHasil> {
	const res = await authFetch('/api/ess/budaya-microquiz', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ propaganda_id: propagandaId, jawaban_idx: jawabanIdx, momen, token })
	});
	if (!res.ok) throw new Error(`Gagal (${res.status})`);
	return res.json();
}

// ── Cek-in semangat & Wall of Belonging (Fase 3) ──────────────────────────────────────────────────
export interface MotivasiStatus {
	enabled: boolean;
	due: { tipe: string; periode_kode: string } | null;
	faktor: { value: string; label: string }[];
}
export interface WallEventItem {
	id: number;
	tipe: string;
	judul: string;
	tanggal_event: string | null;
	tahun_ke: number | null;
	jumlah_ucapan: number;
	emoji_saya: string | null;
	milik_saya: boolean;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
	if (!res.ok) {
		let msg = `Gagal (${res.status})`;
		try {
			msg = (await res.json())?.message || msg;
		} catch {
			/* non-JSON */
		}
		throw new Error(msg);
	}
	return res.json();
}

export async function getMotivasiStatus(): Promise<MotivasiStatus> {
	return jsonOrThrow(await authFetch('/api/ess/motivasi'));
}

export async function submitMotivasiCheckin(payload: Record<string, unknown>): Promise<{ ok: true }> {
	return jsonOrThrow(
		await authFetch('/api/ess/motivasi', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
	);
}

export interface SpotlightWallItem {
	id: number;
	judul: string;
	ringkasan: string;
	pemimpin_nama: string | null;
	kru_nama: string[];
	foto_id: string | null;
}

export async function getBelongingWall(): Promise<{ days: number; events: WallEventItem[]; spotlight: SpotlightWallItem[] }> {
	return jsonOrThrow(await authFetch('/api/ess/belonging'));
}

export async function kirimUcapanBelonging(eventId: number, emoji: string): Promise<{ ok: true; sudah: boolean; emoji: string }> {
	return jsonOrThrow(
		await authFetch('/api/ess/belonging', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event_id: eventId, emoji }) })
	);
}

// ── Golden Rules saat Site Check-in (Fase 5) — /api/ess/golden-rules ──────────────────────────────────
export interface GoldenRulesState {
	enabled: boolean;
	wajib: boolean;
	rules: string[];
	sudahIkrar: boolean;
}

export async function getGoldenRules(projectId: number): Promise<GoldenRulesState> {
	return jsonOrThrow(await authFetch(`/api/ess/golden-rules?project_id=${encodeURIComponent(String(projectId))}`));
}

export async function ikrarGoldenRules(projectId: number): Promise<{ ok: true; sudah: boolean }> {
	return jsonOrThrow(
		await authFetch('/api/ess/golden-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ project_id: projectId }) })
	);
}
