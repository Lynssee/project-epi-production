// src/lib/server/kioskAuth.ts
// Verifikasi PIN kiosk & sesi kiosk yang ditandatangani (Fase 2, rencana Optimasi Inventory &
// Produksi + Deposit HP + Kiosk Produksi v2, 24 Agu 2026). Format hash HARUS sama persis dengan
// erp-epi-1 src/lib/server/kioskAuth.js (yang men-generate PIN) — JANGAN ubah salah satu sisi saja.

import { scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { error, type RequestEvent } from '@sveltejs/kit';

const KEY_LEN = 64;
export const KIOSK_COOKIE_NAME = 'epi_kiosk_session';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 jam — safety net; auto-logout idle ditangani client-side

export function verifyPin(pin: string, storedHash: string | null | undefined): boolean {
	if (!storedHash) return false;
	const parts = storedHash.split(':');
	if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
	const [, saltHex, hashHex] = parts;
	try {
		const salt = Buffer.from(saltHex, 'hex');
		const expected = Buffer.from(hashHex, 'hex');
		const actual = scryptSync(String(pin), salt, KEY_LEN);
		if (actual.length !== expected.length) return false;
		return timingSafeEqual(actual, expected);
	} catch {
		return false;
	}
}

// File 10 §2.2 (29 Sep 2026) — fallback ke DIRECTUS_TOKEN/AUTOMATION_SERVER_SECRET/literal
// dihapus setelah env KIOSK_SESSION_SECRET dikonfirmasi terisi di server (Lead, 29 Sep 2026).
// Sebelum ini, source code yang bocor = sesi kiosk bisa dipalsukan mengaku jadi karyawan mana
// pun. Error dilempar SAAT DIPAKAI (bukan saat modul di-import), supaya `vite build` di CI
// yang tidak punya env tidak ikut gagal.
function sessionSecret(): string {
	if (!env.KIOSK_SESSION_SECRET) {
		// 503 (bukan 500 generik) — konsisten dengan .env.example: "Kosong di produksi = 503
		// 'Kiosk belum dikonfigurasi dengan benar', bukan jatuh ke fallback rahasia hardcode".
		throw error(503, 'KIOSK_SESSION_SECRET belum dikonfigurasi di server — sesi kiosk tidak bisa diproses.');
	}
	return env.KIOSK_SESSION_SECRET;
}

export interface KioskSessionPayload {
	karyawanId: number;
	nama: string;
	exp: number;
}

export function signKioskSession(payload: Omit<KioskSessionPayload, 'exp'>): string {
	const full: KioskSessionPayload = { ...payload, exp: Date.now() + SESSION_TTL_MS };
	const body = Buffer.from(JSON.stringify(full)).toString('base64url');
	const sig = createHmac('sha256', sessionSecret()).update(body).digest('base64url');
	return `${body}.${sig}`;
}

export function verifyKioskSession(token: string | undefined | null): KioskSessionPayload | null {
	if (!token) return null;
	const [body, sig] = token.split('.');
	if (!body || !sig) return null;
	try {
		const expectedSig = createHmac('sha256', sessionSecret()).update(body).digest('base64url');
		if (sig.length !== expectedSig.length) return null;
		if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
		const payload: KioskSessionPayload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
		if (!payload.exp || payload.exp < Date.now()) return null;
		return payload;
	} catch {
		return null;
	}
}

/** Guard untuk endpoint /api/kiosk/* — lempar 401 kalau sesi kiosk tidak valid/kedaluwarsa. */
export function requireKioskSession(event: RequestEvent): KioskSessionPayload {
	const token = event.cookies.get(KIOSK_COOKIE_NAME);
	const session = verifyKioskSession(token);
	if (!session) throw error(401, 'Sesi kiosk berakhir. Silakan login ulang.');
	return session;
}

// File 10 §2.2 — sama alasan dengan sessionSecret(). WORKSTATION_HMAC_SECRET WAJIB byte-identik
// dengan erp-epi (dihitung saat cetak QR badge/meja, diverifikasi di sini saat scan) — kalau
// salah satu server masih pakai fallback lama sementara yang lain sudah env asli, semua QR
// dianggap tidak valid (lihat catatan di file 10 dokumen).
function workstationSecret(): string {
	if (!env.WORKSTATION_HMAC_SECRET) {
		throw error(503, 'WORKSTATION_HMAC_SECRET belum dikonfigurasi di server — token badge/meja tidak bisa diverifikasi.');
	}
	return env.WORKSTATION_HMAC_SECRET;
}

// Verifikasi token Dynamic Screen QR meja desk (rencana absensi istirahat v2 Fase 3, §3.1).
// Cermin dari computeWorkstationToken() di erp-epi-1/src/lib/server/kioskAuth.js — JANGAN
// ubah salah satu sisi saja. Toleransi ±1 slot (30 detik) untuk jam perangkat yang meleset.
const WORKSTATION_QR_SLOT_SECONDS = 30;

export function currentWorkstationSlot(): number {
	return Math.floor(Date.now() / 1000 / WORKSTATION_QR_SLOT_SECONDS);
}

function computeWorkstationTokenLocal(workstationId: number | string, secretSalt: string, slot: number): string {
	const secret = workstationSecret();
	return createHmac('sha256', secret)
		.update(`${workstationId}:${secretSalt}:${slot}`)
		.digest('base64url')
		.slice(0, 10);
}

/** Cocokkan token terhadap slot sekarang ATAU ±1 slot (toleransi jam perangkat meleset). */
export function verifyWorkstationToken(workstationId: number | string, secretSalt: string, token: string): { valid: boolean; matchedSlot: number | null } {
	const nowSlot = currentWorkstationSlot();
	for (const slot of [nowSlot, nowSlot - 1, nowSlot + 1]) {
		const expected = computeWorkstationTokenLocal(workstationId, secretSalt, slot);
		if (expected.length === token.length) {
			try {
				if (timingSafeEqual(Buffer.from(expected), Buffer.from(token))) return { valid: true, matchedSlot: slot };
			} catch {
				/* panjang buffer beda — lanjut coba slot lain */
			}
		}
	}
	return { valid: false, matchedSlot: null };
}

// Verifikasi token kartu badge fisik (EPI:BADGE:<no_badge>:<token>) — rencana absensi istirahat
// v2 Fase 1. Cermin dari computeBadgeToken() di erp-epi-1/src/lib/server/kioskAuth.js — JANGAN
// ubah salah satu sisi saja. Statis selama badge_qr_rev tidak berubah.
export function verifyBadgeToken(noBadge: string, badgeQrRev: number | null | undefined, token: string): boolean {
	const secret = workstationSecret();
	const expected = createHmac('sha256', secret)
		.update(`${noBadge}:${badgeQrRev ?? 1}`)
		.digest('base64url')
		.slice(0, 16);
	if (expected.length !== token.length) return false;
	try {
		return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
	} catch {
		return false;
	}
}
