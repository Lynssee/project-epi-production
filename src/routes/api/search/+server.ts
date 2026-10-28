// src/routes/api/search/+server.ts
// F1 — Endpoint inti Global Deep Search (Dashboard Lapangan), jalur A (live fan-out).
//
// GET /api/search?q=... dengan header Authorization: Bearer <firebase_id_token>.
// Server memverifikasi sesi, resolve permission (FeatureKey) user dari
// Firestore, lalu mencari hanya koleksi yang izinnya dimiliki user.

import { json, error, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getUserPermissions } from '$lib/server/rbacServer';
import { runSearch } from '$lib/server/searchService';
import { logSearchAnalytics, logSearchAuditIfSensitive } from '$lib/server/searchLogging';

// Rate-limit ringan in-memory: maks 30 pencarian/menit/user.
const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const rateMap = new Map<string, { count: number; reset: number }>();

function checkRateLimit(uid: string): boolean {
	const now = Date.now();
	const entry = rateMap.get(uid);
	if (!entry || entry.reset < now) {
		rateMap.set(uid, { count: 1, reset: now + RATE_WINDOW_MS });
		return true;
	}
	if (entry.count >= RATE_LIMIT) return false;
	entry.count++;
	return true;
}

export async function GET(event: RequestEvent) {
	const user = await requireUser(event); // 401 bila sesi tidak valid
	if (!checkRateLimit(user.localId)) {
		throw error(429, 'Terlalu banyak pencarian, coba lagi sebentar lagi.');
	}

	const q = (event.url.searchParams.get('q') || '').trim();
	if (q.length < 2) return json({ query: q, groups: [] });

	const authHeader = event.request.headers.get('authorization') || '';
	const idToken = authHeader.replace(/^Bearer\s+/i, '');

	const { roleId, permissions } = await getUserPermissions(idToken, user.localId);
	const groups = await runSearch({ q, permissions, roleId, userEmail: user.email });

	const resultCount = groups.reduce((sum, g) => sum + g.results.length, 0);
	logSearchAnalytics({ query: q, userEmail: user.email, resultCount, moduleScope: 'project-epi' });
	logSearchAuditIfSensitive({ query: q, userEmail: user.email, ip: event.getClientAddress?.() ?? null });

	return json({ query: q, groups });
}
