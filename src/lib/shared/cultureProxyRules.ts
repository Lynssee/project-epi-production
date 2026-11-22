// src/lib/shared/cultureProxyRules.ts
// Penjaga proxy Directus untuk koleksi Budaya & Motivasi (kembar erp-epi src/lib/server/cultureProxyGuard.js — ubah keduanya bersamaan).
// Proxy /api/directus/* meneruskan semua permintaan dengan token admin bersama, jadi izin role Directus tidak berlaku bagi aplikasi;
// tanpa guard ini karyawan yang login bisa MEMBACA employee_motivation_log (jawaban pribadi) atau MENULIS ack/ikrar atas nama orang lain
// lewat DevTools. Fitur sah memakai route server (/api/ess/*) yang memanggil Directus langsung, bukan lewat proxy.

const WRITE_METHODS = ['POST', 'PATCH', 'PUT', 'DELETE'];
const ALL_BLOCKED = /^items\/employee_motivation_log(\/|$)/i;
const WRITE_BLOCKED = /^items\/(culture_propaganda_ack|culture_golden_pledge)(\/|$)/i;

export const CULTURE_PROXY_BLOCK_MESSAGE =
	'Data ini hanya dapat diakses lewat fitur resminya (ESS / Monitor Motivasi), bukan langsung ke database.';

export function isCultureProxyBlocked(path: string, method: string): boolean {
	const p = String(path || '').replace(/^\/+/, '');
	if (ALL_BLOCKED.test(p)) return true; // baca & tulis
	if (WRITE_BLOCKED.test(p)) return WRITE_METHODS.includes(String(method || '').toUpperCase());
	return false;
}

// ── Jalur samping yang melewati pagar koleksi (kembar erp-epi) ──────────────────────────────────────────────
// /graphql, /utils/export, /utils/import meneruskan dengan token admin ke koleksi mana pun dan melewati semua guard berbasis path items/*.
// Tidak ada klien yang memakainya lewat proxy (git grep 14 Nov 2026) → ditolak mutlak, tidak bergantung mode gate.
const HARD_DENIED = /^(graphql|utils\/export|utils\/import)(\/|$)/i;

export const PROXY_HARD_DENY_MESSAGE = 'Jalur ini tidak tersedia lewat proxy aplikasi.';

export function isProxyPathHardDenied(path: string): boolean {
	return HARD_DENIED.test(String(path || '').replace(/^\/+/, ''));
}
