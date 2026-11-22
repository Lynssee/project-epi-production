// src/lib/services/manpowerK3.ts
// Tes K3 dasar untuk calon manpower lapangan (Integrasi Quiz ↔ Rekrutmen, Fase 5). Logika & data ada di admin erp-epi
// (/api/hrd/manpower-k3); repo ini hanya relay lewat /api/manpower-k3 (token Firebase diteruskan, pola /api/dispensasi-request).
// Pekerja mengerjakan tes dari HP lewat tautan publik /tes/[token] tanpa login — hasilnya dinilai di server admin.
import { getIdToken } from '$lib/services/secureDirectus';

export type K3Status = {
	status: 'lulus' | 'belum_lulus' | 'berjalan' | 'kedaluwarsa' | 'belum_dikirim';
	skor: number | null;
	ambang: number | null;
	attempt?: number;
	expires_at: string | null;
	token: string | null;
	memenuhi: boolean;
};
export type K3Ringkasan = { konfigurasi: boolean; quiz: { id: number; judul: string | null } | null; map: Record<string, K3Status> };
export type KirimK3Result =
	| { ok: true; url: string; reused: boolean; waDiminta: boolean; waTerkirim: boolean; waAlasan: string | null; expiresAt: string | null }
	| { ok: false; message: string };

/** Status K3 banyak pekerja sekaligus (1 permintaan). Tidak pernah melempar: gagal → null (UI tampil tanpa badge K3). */
export async function fetchStatusK3(ids: number[]): Promise<K3Ringkasan | null> {
	const uniq = [...new Set(ids.filter((n) => Number.isFinite(n) && n > 0))].slice(0, 300);
	if (!uniq.length) return { konfigurasi: false, quiz: null, map: {} };
	try {
		const token = await getIdToken();
		const res = await fetch(`/api/manpower-k3?ids=${uniq.join(',')}`, { headers: { Authorization: `Bearer ${token}` } });
		const body = await res.json().catch(() => ({}));
		if (!res.ok || body?.ok === false) {
			console.warn('[manpowerK3] status K3 tak terbaca:', body?.message || res.status);
			return null;
		}
		return (body?.data as K3Ringkasan) ?? null;
	} catch (e: any) {
		console.warn('[manpowerK3] status K3 gagal:', e?.message || e);
		return null;
	}
}

/** Buat/pakai ulang tautan tes K3 dan (opsional) kirim lewat WhatsApp pekerja. Tidak pernah melempar. */
export async function kirimTesK3(manpowerId: number, kirimWa: boolean): Promise<KirimK3Result> {
	try {
		const token = await getIdToken();
		const res = await fetch('/api/manpower-k3', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ manpower_id: manpowerId, kirim_wa: kirimWa })
		});
		const body = await res.json().catch(() => ({}));
		if (!res.ok || body?.ok === false) return { ok: false, message: body?.message || `Gagal membuat tautan tes (HTTP ${res.status})` };
		const d = body?.data || {};
		return {
			ok: true,
			url: d.url,
			reused: !!d.reused,
			waDiminta: !!d.wa?.diminta,
			waTerkirim: !!d.wa?.terkirim,
			waAlasan: d.wa?.alasan ?? null,
			expiresAt: d.expires_at ?? null
		};
	} catch (e: any) {
		return { ok: false, message: e?.message || 'Tidak dapat menghubungi server. Coba lagi.' };
	}
}
