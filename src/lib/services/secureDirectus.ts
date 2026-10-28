// src/lib/services/secureDirectus.ts
// F0 — Klien untuk mengakses Directus lewat proxy server terautentikasi,
// TANPA menaruh token Directus di bundle klien.
//
// Pemakaian: pengganti drop-in untuk pola lama
//   fetch(`${DIRECTUS_URL}/items/...`, { headers: adminHeaders() })
// menjadi
//   secureDirectusFetch('/items/...', { ...tanpa header Authorization })
//
// Mengembalikan objek Response biasa, sehingga pemanggil yang sudah memakai
// res.ok / res.json() / res.text() tidak perlu diubah.

import { auth, isLoading } from '$lib/firebase';
import { get } from 'svelte/store';

/** Tunggu sampai Firebase auth selesai inisialisasi (login/tidak diketahui). */
async function waitForAuthReady(): Promise<void> {
	if (!get(isLoading)) return;
	await new Promise<void>((resolve) => {
		let unsub: (() => void) | undefined;
		unsub = isLoading.subscribe(($loading) => {
			if (!$loading) {
				Promise.resolve().then(() => unsub?.());
				resolve();
			}
		});
	});
}

/** Ambil Firebase ID token user yang sedang login. */
export async function getIdToken(): Promise<string> {
	await waitForAuthReady();
	const user = auth?.currentUser;
	if (!user) {
		throw new Error('Belum login / sesi tidak tersedia. Tidak dapat mengakses data terproteksi.');
	}
	return user.getIdToken();
}

export async function secureDirectusFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
	const token = await getIdToken();
	const path = endpoint.replace(/^\//, '');
	const { headers = {}, ...rest } = options;

	// Untuk FormData (upload file), JANGAN set Content-Type — biarkan browser
	// menetapkan multipart + boundary sendiri.
	const isFormData = typeof FormData !== 'undefined' && rest.body instanceof FormData;
	const baseHeaders: Record<string, string> = isFormData ? {} : { 'Content-Type': 'application/json' };

	return fetch(`/api/directus/${path}`, {
		...rest,
		headers: {
			...baseHeaders,
			...(headers as Record<string, string>),
			Authorization: `Bearer ${token}` // Firebase ID token (bukan token Directus)
		}
	});
}

export async function secureDirectusJson<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
	const res = await secureDirectusFetch(endpoint, options);
	const text = await res.text();
	let parsed: any = null;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		/* non-JSON */
	}
	if (!res.ok) {
		const msg = parsed?.errors?.[0]?.message || parsed?.message || `Request gagal (${res.status})`;
		throw new Error(msg);
	}
	return parsed;
}
