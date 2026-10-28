// src/lib/server/ess/workstationBinding.ts
// Rencana Absensi Istirahat v2, Fase 3 §3.1 — verifikasi Dynamic Screen QR meja desk saat
// break-in. Fail-OPEN: kegagalan verifikasi (QR salah/kedaluwarsa/meja bukan miliknya/replay)
// TIDAK PERNAH memblokir absen kembali — hanya berarti punch ini tidak terikat ke meja,
// jatuh ke jalur cadangan (foto+geofence biasa), persis §3.1 "Jalur cadangan bila PC mati".
//
// Ikatan kepemilikan: STRICT (hanya meja milik sendiri) — keputusan eksplisit user, BUKAN
// 'toleran' yang direkomendasikan draf rencana. Jangan ubah tanpa konfirmasi ulang.

import { directusServerJson } from '$lib/server/directus';
import { parseEpiQr } from '$lib/utils/qrParse';
import { verifyWorkstationToken } from '$lib/server/kioskAuth';
import { withinRadius } from '$lib/server/ess/geo';

export interface WorkstationBindingResult {
	workstationId: number;
	scanTokenJti: string;
}

interface WorkstationRecord {
	id: number;
	karyawan_id: number | null;
	secret_salt: string | null;
	lat: number | null;
	lng: number | null;
	radius_m: number | null;
	aktif: boolean;
	lokasi_absensi_id: number | string | null;
}

async function isReplay(jti: string): Promise<boolean> {
	const res = await directusServerJson<{ data: { id: string }[] }>(
		`/items/absensi_istirahat_log?filter[scan_token_jti][_eq]=${encodeURIComponent(jti)}&fields=id&limit=1`
	);
	return (res?.data?.length || 0) > 0;
}

/** Coba ikat punch break-in ke meja desk via QR yang di-scan. null = tidak terikat (fail-open). */
export async function tryBindWorkstation(params: { karyawanId: number; lat: number; lng: number; payload: string }): Promise<WorkstationBindingResult | null> {
	const parsed = parseEpiQr(params.payload);
	if (!parsed || parsed.type !== 'WSTN' || !parsed.token) return null;

	let ws: WorkstationRecord | null = null;
	try {
		const res = await directusServerJson<{ data: WorkstationRecord }>(
			`/items/master_workstation/${parsed.id}?fields=id,karyawan_id,secret_salt,lat,lng,radius_m,aktif,lokasi_absensi_id`
		);
		ws = res?.data || null;
	} catch {
		return null;
	}
	if (!ws || !ws.aktif || !ws.secret_salt) return null;

	// STRICT — hanya meja milik sendiri.
	if (!ws.karyawan_id || Number(ws.karyawan_id) !== Number(params.karyawanId)) return null;

	// File 10 §2.2 (29 Sep 2026) — verifyWorkstationToken() sekarang throw kalau
	// WORKSTATION_HMAC_SECRET belum ke-load (fallback lama sudah dihapus). Fungsi ini fail-open
	// by design (lihat komentar atas), jadi kegagalan di sini TETAP jatuh ke null, BUKAN
	// merembet jadi 500 yang memblokir absen kembali karyawan.
	let verified: { valid: boolean; matchedSlot: number | null };
	try {
		verified = verifyWorkstationToken(ws.id, ws.secret_salt, String(parsed.token));
	} catch (e) {
		console.error('[workstationBinding] verifyWorkstationToken gagal (fail-open, tidak mengikat meja):', e);
		return null;
	}
	if (!verified.valid || verified.matchedSlot == null) return null;

	let centerLat = ws.lat;
	let centerLng = ws.lng;
	let radiusM = ws.radius_m ?? 50;

	// Bila koordinat meja kosong, ambil dari lokasi_absensi terkait secara terpisah (Aturan #3)
	if ((centerLat == null || centerLng == null) && ws.lokasi_absensi_id) {
		try {
			const lokRes = await directusServerJson<{ data: { lat: number; lng: number; radius_m: number } }>(
				`/items/lokasi_absensi/${ws.lokasi_absensi_id}?fields=lat,lng,radius_m`
			);
			if (lokRes?.data) {
				centerLat = lokRes.data.lat;
				centerLng = lokRes.data.lng;
				radiusM = ws.radius_m ?? lokRes.data.radius_m ?? 50;
			}
		} catch {
			/* fallback jika lokasi_absensi tak terbaca */
		}
	}

	if (centerLat != null && centerLng != null) {
		const { valid: dalamRadius } = withinRadius(params.lat, params.lng, centerLat, centerLng, radiusM);
		if (!dalamRadius) return null; // "video-call layar dari kantin" — ditolak diam-diam, jatuh ke cadangan
	}

	const scanTokenJti = `${ws.id}|${matchedSlot}`;
	if (await isReplay(scanTokenJti)) return null;

	return { workstationId: ws.id, scanTokenJti };
}
