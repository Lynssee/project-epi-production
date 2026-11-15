// src/routes/kiosk/+layout.server.ts
// Validasi sesi kiosk (cookie epi_kiosk_session, HMAC — bukan Firebase) di server sebelum
// halaman dirender. Fase 2, rencana Optimasi Inventory & Produksi + Kiosk Produksi v2.
//
// Revisi login cepat (Nov 2026):
// - Setelan dibaca lewat readKioskSettings(): SATU query `_in` + cache 60 detik (dulu 3 query
//   terpisah per load). Aturan default tidak berubah — lihat kioskSettings.ts.
// - Load ini SENGAJA tidak menyentuh `url`. Dulu `url.pathname` dikembalikan (tidak dipakai
//   di mana pun) sehingga SvelteKit menjalankan ulang load ini di SETIAP pindah halaman kiosk.
//   Konsekuensinya: setiap jalan keluar sesi (login, logout, 401) WAJIB memanggil
//   goto(..., { invalidateAll: true }) supaya data.kioskSession segar — lihat +layout.svelte,
//   +page.svelte, gudang/transfer.
//
// File 10 §2.4 — sakelar pemeliharaan `kiosk.enabled`: fail-open, hanya berhenti bila nilainya
// eksplisit `false`.
// File 11 §1 item 3 — `kiosk.session_timeout_per_menu`: timeout lebih longgar per halaman.

import type { LayoutServerLoad } from './$types';
import { verifyKioskSession, KIOSK_COOKIE_NAME } from '$lib/server/kioskAuth';
import { readKioskSettings } from '$lib/server/kioskSettings';

export const load: LayoutServerLoad = async ({ cookies }) => {
	const session = verifyKioskSession(cookies.get(KIOSK_COOKIE_NAME));
	const { timeoutMinutes, kioskEnabled, timeoutPerMenu } = await readKioskSettings();
	return {
		kioskSession: session ? { karyawanId: session.karyawanId, nama: session.nama } : null,
		timeoutMinutes,
		kioskEnabled,
		timeoutPerMenu
	};
};
