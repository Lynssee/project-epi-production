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
const verifyCache = new Map<string, { user: FirebaseVerifiedUser; exp: number }>();

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

	const cached = verifyCache.get(idToken);
	if (cached && cached.exp > Date.now()) return cached.user;

	const apiKey = env.FIREBASE_API_KEY || env.VITE_FIREBASE_API_KEY;
	if (!apiKey) {
		console.error('[firebaseAuth] FIREBASE_API_KEY (atau VITE_FIREBASE_API_KEY) tidak di-set di env');
		throw error(500, 'Server auth not configured');
	}

	let res: Response;
	try {
		res = await fetch(`${LOOKUP_URL}?key=${apiKey}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ idToken })
		});
	} catch (e) {
		console.error('[firebaseAuth] gagal menghubungi Identity Toolkit:', e);
		const fallbackUser = decodeFirebaseJwt(idToken);
		if (fallbackUser) {
			console.warn('[firebaseAuth] Menggunakan local JWT fallback karena Identity Toolkit tidak dapat dijangkau');
			verifyCache.set(idToken, { user: fallbackUser, exp: Date.now() + CACHE_TTL_MS });
			return fallbackUser;
		}
		throw error(503, 'Auth provider unreachable');
	}

	if (!res.ok) return null;

	const data = await res.json().catch(() => null);
	const user = data?.users?.[0] || null;
	if (user) verifyCache.set(idToken, { user, exp: Date.now() + CACHE_TTL_MS });
	return user;
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
