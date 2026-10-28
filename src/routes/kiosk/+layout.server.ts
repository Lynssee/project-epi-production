// src/routes/kiosk/+layout.server.ts
// Validasi sesi kiosk (cookie epi_kiosk_session, HMAC — bukan Firebase) di server sebelum
// halaman dirender. Fase 2, rencana Optimasi Inventory & Produksi + Kiosk Produksi v2.

import type { LayoutServerLoad } from './$types';
import { verifyKioskSession, KIOSK_COOKIE_NAME } from '$lib/server/kioskAuth';
import { directusServerJson } from '$lib/server/directus';

async function readTimeoutMinutes(): Promise<number> {
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/system_settings?filter[setting_key][_eq]=kiosk.session_timeout_minutes&limit=1`
		);
		const raw = res?.data?.[0]?.setting_value;
		const parsed = raw ? Number(JSON.parse(raw)) : NaN;
		return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
	} catch {
		return 5;
	}
}

// File 10 §2.4 — sakelar pemeliharaan `kiosk.enabled` sudah ada di system_settings tapi TIDAK
// DIBACA kode mana pun; admin bisa mengira kiosk sudah dimatikan padahal masih menerima
// transaksi. Default `true` (fail-open) kalau baris belum ada / gagal dibaca — hanya berhenti
// bila NILAINYA eksplisit `false`. ⚠️ Nilai live saat ini `false` — WAJIB diubah ke `true` dulu
// oleh admin sebelum kode ini di-deploy, atau kiosk langsung tampil pesan pemeliharaan total.
async function readKioskEnabled(): Promise<boolean> {
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/system_settings?filter[setting_key][_eq]=kiosk.enabled&limit=1`
		);
		const raw = res?.data?.[0]?.setting_value;
		if (raw === undefined || raw === null || raw === '') return true;
		return JSON.parse(raw) !== false;
	} catch {
		return true;
	}
}

// File 11 §1 item 3 — beberapa halaman (mis. QC, Opname) butuh timeout lebih longgar karena
// operator sering diam lama memotret/menghitung tanpa menyentuh layar. Default ke
// timeoutMinutes global kalau path ini tidak disebut di setelan.
async function readTimeoutPerMenu(): Promise<Record<string, number>> {
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/system_settings?filter[setting_key][_eq]=kiosk.session_timeout_per_menu&limit=1`
		);
		const raw = res?.data?.[0]?.setting_value;
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch {
		return {};
	}
}

export const load: LayoutServerLoad = async ({ cookies, url }) => {
	const token = cookies.get(KIOSK_COOKIE_NAME);
	const session = verifyKioskSession(token);
	const [timeoutMinutes, kioskEnabled, timeoutPerMenu] = await Promise.all([
		readTimeoutMinutes(),
		readKioskEnabled(),
		readTimeoutPerMenu()
	]);
	return {
		kioskSession: session ? { karyawanId: session.karyawanId, nama: session.nama } : null,
		pathname: url.pathname,
		timeoutMinutes,
		kioskEnabled,
		timeoutPerMenu
	};
};
