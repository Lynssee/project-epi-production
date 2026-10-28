// src/hooks.server.ts
// Fase 1 keamanan pondasi (rencana "Package & Fitur Addons" §5) — titik masuk server
// pertama untuk project-epi. Sebelumnya tidak ada hooks.server sama sekali, jadi
// rate-limiter/header keamanan tidak punya tempat dipasang secara global.
//
// CSP diatur di svelte.config.js (kit.csp) supaya SvelteKit bisa auto-nonce script/style
// yang dirender sendiri. Di sini hanya header yang TIDAK dicakup kit.csp.

import type { Handle } from '@sveltejs/kit';
import { createHash } from 'node:crypto';
import { isRateLimited } from '$lib/server/rateLimit';
import { sequence } from '@sveltejs/kit/hooks';
import * as Sentry from '@sentry/sveltekit';
import { env } from '$env/dynamic/private';

// I1 Error Tracking (rencana Personal Admin Dashboard, 25 Agu 2026): SENGAJA no-op selama
// SENTRY_DSN belum diisi di .env -- Sentry.init() TIDAK dipanggil sama sekali, jadi tidak ada
// percobaan koneksi/telemetri keluar tanpa akun Sentry yang benar-benar ada.
const sentryEnabled = Boolean(env.SENTRY_DSN);
if (sentryEnabled) {
	Sentry.init({
		dsn: env.SENTRY_DSN,
		environment: env.PUBLIC_APP_ENV || (env.NODE_ENV === 'production' ? 'production' : 'development'),
		tracesSampleRate: 0.1
	});
}

// Fase 3 — batasi endpoint yang memanggil LLM (biaya token + potensi abuse) dan
// endpoint upload internal (biaya storage + abuse). Semua sudah wajib Bearer token
// Firebase (requireUser/verifyFirebaseToken di masing-masing endpoint) — di sini
// token TIDAK diverifikasi ulang (mahal, duplikat), cukup di-hash sebagai kunci
// per-pengguna. IP dipakai hanya sebagai fallback kalau header Authorization tidak ada.
// Hanya sub-route yang benar-benar memanggil LLM — /conversations, /feedback,
// /context-suggestions, /export-pdf adalah CRUD/util (dipanggil jauh lebih sering
// oleh UI, mis. muat riwayat chat) dan TIDAK boleh ikut dibatasi.
const AI_ROUTE_PREFIXES = [
	'/api/ai-assistant/stream',
	'/api/ai-assistant/draft-maintenance-ticket',
	'/api/ai-assistant/draft-requisition'
];
const AI_ROUTE_EXACT = new Set(['/api/ai-assistant']);
const AI_RATE_WINDOW_MS = 60 * 1000;
const AI_RATE_MAX = 20;

// Endpoint upload internal — dikonfirmasi satu-satu dengan grep `formData()` di source,
// BUKAN ditebak dari nama folder (mis. `/api/ess/*` punya 80+ endpoint, mayoritas
// GET/status/CRUD biasa seperti kalender/notifikasi/bookmarks yang TIDAK boleh ikut
// dibatasi). Regex exact-path, bukan prefix, supaya tidak melebar ke route lain.
const UPLOAD_ROUTE_PATTERNS = [
	/^\/api\/ess\/dokumen$/,
	/^\/api\/ess\/onboarding$/,
	/^\/api\/ess\/face\/enroll$/,
	/^\/api\/ess\/face\/verify$/,
	/^\/api\/ess\/attendance\/clock-in$/,
	/^\/api\/ess\/attendance\/clock-out$/,
	/^\/api\/ess\/attendance\/izin-sakit$/,
	/^\/api\/ess\/lembur$/,
	/^\/api\/ess\/izin-jam\/submit$/,
	/^\/api\/ess\/sertifikasi$/,
	/^\/api\/ess\/reimburse$/,
	/^\/api\/driver\/fuel-log$/,
	/^\/api\/driver\/vehicle-check$/,
	/^\/api\/driver\/trip\/[^/]+\/expense$/,
	/^\/api\/driver\/trip\/[^/]+\/pod$/,
	/^\/api\/ga-checklist\/submit$/,
	/^\/api\/manpower-leader\/absen-regu$/,
	/^\/api\/sj-manual$/,
	/^\/api\/sj-manual\/[^/]+$/,
	/^\/api\/sji\/[^/]+\/serahkan$/,
	/^\/api\/sji\/peminjaman\/[^/]+\/kembali$/,
	/^\/api\/csr\/penerima\/submit$/,
	/^\/api\/csr\/kegiatan\/submit$/
];
const UPLOAD_RATE_WINDOW_MS = 5 * 60 * 1000;
const UPLOAD_RATE_MAX = 15;

function authRateLimitKey(event: Parameters<Handle>[0]['event'], prefix: string): string {
	const authHeader = event.request.headers.get('authorization') || '';
	const token = authHeader.replace(/^Bearer\s+/i, '').trim();
	if (token) return `${prefix}-tok:${createHash('sha256').update(token).digest('hex').slice(0, 24)}`;
	return `${prefix}-ip:${event.getClientAddress()}`;
}

const appHandle: Handle = async ({ event, resolve }) => {
	const pathname = event.url.pathname;
	const method = event.request.method;

	if (AI_ROUTE_EXACT.has(pathname) || AI_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
		if (isRateLimited(authRateLimitKey(event, 'ai'), { windowMs: AI_RATE_WINDOW_MS, max: AI_RATE_MAX })) {
			return new Response('Terlalu banyak permintaan AI dalam waktu singkat. Coba lagi sebentar.', {
				status: 429,
				headers: { 'Retry-After': '60' }
			});
		}
	}

	// Proxy Directus generik (/api/directus/[...path]) hanya dibatasi untuk sub-jalur
	// upload file-nya (POST ke 'files') — melebar ke prefix penuh akan ikut membatasi
	// SEMUA baca CRUD lewat proxy itu (dipakai di hampir setiap halaman).
	const isDirectusFileUpload = pathname === '/api/directus/files' && method === 'POST';
	if (
		method !== 'GET' &&
		method !== 'HEAD' &&
		(isDirectusFileUpload || UPLOAD_ROUTE_PATTERNS.some((re) => re.test(pathname)))
	) {
		if (isRateLimited(authRateLimitKey(event, 'upload'), { windowMs: UPLOAD_RATE_WINDOW_MS, max: UPLOAD_RATE_MAX })) {
			return new Response('Terlalu banyak unggahan dalam waktu singkat. Coba lagi sebentar.', {
				status: 429,
				headers: { 'Retry-After': '60' }
			});
		}
	}

	const response = await resolve(event, {
		transformPageChunk: ({ html }) => {
			// Cegah Cloudflare Rocket Loader merusak modul SvelteKit & CSP nonce.
			// data-cfasync="false" diletakkan sebelum atribut lain agar Rocket Loader
			// mengabaikan script sepenuhnya dan mengeksekusinya secara native dengan CSP nonce.
			return html.replace(/<script\b(?![^>]*\bdata-cfasync=)/gi, '<script data-cfasync="false"');
		}
	});

	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'SAMEORIGIN');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=()');

	if (response.headers.get('content-type')?.includes('text/html') && !response.headers.has('Cache-Control')) {
		// Cegah proxy/CDN bersama meng-cache HTML yang memuat CSP nonce spesifik per-request
		response.headers.set('Cache-Control', 'private, no-cache');
	}

	if (event.url.protocol === 'https:') {
		response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}

	return response;
};

export const handle: Handle = sentryEnabled ? sequence(Sentry.sentryHandle(), appHandle) : appHandle;
export const handleError = sentryEnabled ? Sentry.handleErrorWithSentry() : undefined;
