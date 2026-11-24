// src/lib/server/firebaseAuth.ts
// SERVER-ONLY. Verifikasi Firebase ID token tanpa firebase-admin, memakai
// endpoint REST Google Identity Toolkit (accounts:lookup). API key Firebase
// bersifat publik, aman dipakai di server untuk validasi token.

import { error, type RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const LOOKUP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup';

export interface FirebaseVerifiedUser {
	localId: string;
	email: string;
	[key: string]: any;
}

const CACHE_TTL_MS = 60_000;
const VERIFY_TIMEOUT_MS = 8_000;
const MAX_VERIFY_CACHE = 1_000;
const verifyCache = new Map<string, { user: FirebaseVerifiedUser; exp: number }>();
const verifyInflight = new Map<string, Promise<FirebaseVerifiedUser | null>>();

/** Untuk tes: kosongkan cache verifikasi token & antrean in-flight. */
export function clearFirebaseVerifyCache() {
	verifyCache.clear();
	verifyInflight.clear();
}

function setVerifyCache(idToken: string, user: FirebaseVerifiedUser) {
	const now = Date.now();
	if (verifyCache.size >= MAX_VERIFY_CACHE) {
		for (const [k, entry] of verifyCache) {
			if (entry.exp <= now) verifyCache.delete(k);
		}
		if (verifyCache.size >= MAX_VERIFY_CACHE) {
			const oldestKey = verifyCache.keys().next().value;
			if (oldestKey !== undefined) verifyCache.delete(oldestKey);
		}
	}
	verifyCache.set(idToken, { user, exp: now + CACHE_TTL_MS });
}

function decodeFirebaseJwt(token: string): FirebaseVerifiedUser | null {
	if (!token || typeof token !== 'string') return null;
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	try {
		const base64Url = parts[1];
		const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
		const jsonStr = typeof Buffer !== 'undefined'
			? Buffer.from(base64, 'base64').toString('utf-8')
			: atob(base64);
		const payload = JSON.parse(jsonStr);

		const nowSec = Math.floor(Date.now() / 1000);
		if (payload.exp && payload.exp < nowSec) {
			console.warn('[firebaseAuth] Local JWT fallback rejected: Token expired');
			return null;
		}

		const localId = payload.user_id || payload.sub || payload.uid;
		if (!localId) return null;

		return {
			localId,
			email: payload.email || '',
			emailVerified: payload.email_verified || false,
			displayName: payload.name || payload.display_name || '',
			...payload
		};
	} catch (e) {
		console.error('[firebaseAuth] Error parsing local JWT token:', e);
		return null;
	}
}

export async function verifyFirebaseToken(idToken: string | null): Promise<FirebaseVerifiedUser | null> {
	if (!idToken) return null;

	const now = Date.now();
	const cached = verifyCache.get(idToken);
	if (cached) {
		if (cached.exp > now) return cached.user;
		verifyCache.delete(idToken);
	}

	const running = verifyInflight.get(idToken);
	if (running) return running;

	const apiKey = env.FIREBASE_API_KEY || env.VITE_FIREBASE_API_KEY;
	if (!apiKey) {
		console.error('[firebaseAuth] FIREBASE_API_KEY (atau VITE_FIREBASE_API_KEY) tidak di-set di env');
		throw error(500, 'Server auth not configured');
	}

	const pending = (async (): Promise<FirebaseVerifiedUser | null> => {
		let res: Response;
		try {
			res = await fetch(`${LOOKUP_URL}?key=${apiKey}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ idToken }),
				signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS)
			});
			if (res.status >= 500) {
				throw new Error(`Identity Toolkit HTTP ${res.status}`);
			}
		} catch (e) {
			console.error('[firebaseAuth] gagal menghubungi Identity Toolkit:', e);
			const fallbackUser = decodeFirebaseJwt(idToken);
			if (fallbackUser) {
				console.warn('[firebaseAuth] Menggunakan local JWT fallback karena Identity Toolkit tidak dapat dijangkau/timeout');
				setVerifyCache(idToken, fallbackUser);
				return fallbackUser;
			}
			throw error(503, 'Auth provider unreachable');
		}

		if (!res.ok) return null;

		const data = await res.json().catch(() => null);
		const user = data?.users?.[0] || null;
		if (user) setVerifyCache(idToken, user);
		return user;
	})().finally(() => {
		if (verifyInflight.get(idToken) === pending) verifyInflight.delete(idToken);
	});

	verifyInflight.set(idToken, pending);
	return pending;
}

/** Pastikan request membawa Bearer Firebase ID token yang valid. Lempar 401 jika tidak. */
export async function requireUser(event: RequestEvent): Promise<FirebaseVerifiedUser> {
	const header = event.request.headers.get('authorization') || '';
	const token = header.startsWith('Bearer ') ? header.slice(7) : null;
	if (!token) throw error(401, 'Sesi tidak ditemukan. Silakan login ulang.');

	const user = await verifyFirebaseToken(token);
	if (!user) throw error(401, 'Sesi tidak valid atau kedaluwarsa. Silakan login ulang.');
	return user;
}
