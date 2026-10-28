// src/lib/server/kioskMenuAccess.ts
// SERVER-ONLY. Helper tunggal untuk memverifikasi kiosk_menu_access di server — menggantikan
// fungsi require*MenuAccess yang dulu disalin ulang per endpoint (qc, flag-rework, konsumsi,
// fg-request, ciketing-*), empat di antaranya menelan error Directus dan membalas 403 yang
// salah (harusnya 503) saat Directus sendiri yang bermasalah.
//
// File 07, Perbaikan Kiosk × Produksi & Inventory (29 Sep 2026), §2.2-2.3.
//
// Mode shadow/enforce (Aturan #3 anti-lockdown retroaktif): menu gudang & SJ SAAT INI terbuka
// untuk semua orang. Mengunci langsung akan mengunci tim gudang yang belum dicentang aksesnya.
// Default `shadow`: TIDAK menolak, hanya log + alert. Admin mencentang akses berdasarkan alert
// itu, baru ubah ke `enforce` lewat system_settings (tanpa deploy).

import { error } from '@sveltejs/kit';
import { directusServerJson } from '$lib/server/directus';
import type { KioskMenuKey } from '$lib/kiosk/kioskMenus';

const MODE_CACHE_TTL_MS = 300_000;
let modeCache: { at: number; mode: 'shadow' | 'enforce' } | null = null;

async function menuAccessMode(): Promise<'shadow' | 'enforce'> {
	if (modeCache && Date.now() - modeCache.at < MODE_CACHE_TTL_MS) return modeCache.mode;
	let mode: 'shadow' | 'enforce' = 'shadow';
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/system_settings?filter[setting_key][_eq]=kiosk.menu_access_mode&limit=1`
		);
		const raw = res?.data?.[0]?.setting_value;
		if (raw === 'enforce') mode = 'enforce';
	} catch (e) {
		console.error('[kioskMenuAccess] gagal baca kiosk.menu_access_mode, default shadow:', e);
	}
	modeCache = { at: Date.now(), mode };
	return mode;
}

// Dedup alert shadow per karyawan+menu per hari — supaya admin tidak dibanjiri baris yang sama
// tiap kali operator yang sama memakai endpoint yang sama berulang kali dalam sehari.
const shadowAlertedToday = new Set<string>();
let shadowAlertedDate = '';

async function logShadowAccess(karyawanId: number, key: string, label: string): Promise<void> {
	const today = new Date().toISOString().slice(0, 10);
	if (shadowAlertedDate !== today) {
		shadowAlertedDate = today;
		shadowAlertedToday.clear();
	}
	const dedupKey = `${karyawanId}:${key}`;
	console.warn(`[kioskMenuAccess] (shadow) karyawan #${karyawanId} memakai menu "${label}" (${key}) tanpa akses tercentang.`);
	if (shadowAlertedToday.has(dedupKey)) return;
	shadowAlertedToday.add(dedupKey);
	await directusServerJson('/items/automation_alerts', {
		method: 'POST',
		body: JSON.stringify({
			source: 'kiosk_menu_access_shadow',
			severity: 'warning',
			is_resolved: false,
			message: `Karyawan #${karyawanId} memakai menu kiosk "${label}" (${key}) tanpa akses tercentang di Akses Kiosk. Centang aksesnya sebelum mode dipindah ke enforce.`
		})
	}).catch((e) => console.warn('[kioskMenuAccess] gagal mencatat alert shadow:', e));
}

async function fetchMenuAccess(karyawanId: number): Promise<string[]> {
	let res: { data: any[] };
	try {
		res = await directusServerJson<{ data: any[] }>(
			`/items/karyawan?filter[id][_eq]=${karyawanId}&fields=kiosk_menu_access&limit=1`
		);
	} catch (e) {
		console.error('[kioskMenuAccess] gagal cek akses menu — koneksi Directus bermasalah', e);
		throw error(503, 'Gagal memeriksa hak akses — koneksi server bermasalah. Coba lagi.');
	}
	const akses = res?.data?.[0]?.kiosk_menu_access;
	return Array.isArray(akses) ? akses : [];
}

/** Wajib punya SATU menu tertentu. Mode shadow: tidak pernah melempar 403, hanya log+alert. */
export async function requireKioskMenu(karyawanId: number, key: KioskMenuKey, label: string): Promise<void> {
	const akses = await fetchMenuAccess(karyawanId);
	if (akses.includes(key)) return;

	const mode = await menuAccessMode();
	if (mode === 'enforce') {
		throw error(403, `Anda belum diberi akses menu "${label}". Minta admin menambahkannya di Akses Kiosk.`);
	}
	await logShadowAccess(karyawanId, key, label);
}

/** Wajib punya SALAH SATU dari beberapa menu (dipakai endpoint GET read-only yang dibagi
 *  beberapa menu, mis. `stok/cari` dipakai Transfer maupun Cek Stok). */
export async function requireKioskMenuAny(karyawanId: number, keys: KioskMenuKey[], label: string): Promise<void> {
	const akses = await fetchMenuAccess(karyawanId);
	if (keys.some((k) => akses.includes(k))) return;

	const mode = await menuAccessMode();
	if (mode === 'enforce') {
		throw error(403, `Anda belum diberi akses menu "${label}". Minta admin menambahkannya di Akses Kiosk.`);
	}
	await logShadowAccess(karyawanId, keys.join('|'), label);
}
