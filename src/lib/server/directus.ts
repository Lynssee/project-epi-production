// src/lib/server/directus.ts
// SERVER-ONLY. Memegang token Directus rahasia (tidak pernah dikirim ke klien).
// Dipakai oleh endpoint /api/ess/* — jangan import dari kode klien.

import { env } from '$env/dynamic/private';

const API_URL = env.DIRECTUS_API_URL || env.VITE_DIRECTUS_API_URL;
const TOKEN = env.DIRECTUS_TOKEN || env.VITE_DIRECTUS_TOKEN;

export function directusServerFetch(
	endpoint: string,
	options: { method?: string; body?: string | FormData; headers?: Record<string, string> } = {}
): Promise<Response> {
	if (!API_URL || !TOKEN) {
		throw new Error('[directus.server] DIRECTUS_API_URL / DIRECTUS_TOKEN belum di-set di server env');
	}
	const { method = 'GET', body, headers = {} } = options;
	const mergedHeaders: Record<string, string> = {
		'Content-Type': 'application/json',
		Authorization: `Bearer ${TOKEN}`,
		...headers
	};
	return fetch(`${API_URL}${endpoint}`, { method, headers: mergedHeaders, body });
}

/** Upload file ke Directus /files. Content-Type sengaja tidak di-set manual untuk FormData. */
export function directusServerUpload(formData: FormData): Promise<Response> {
	if (!API_URL || !TOKEN) {
		throw new Error('[directus.server] DIRECTUS_API_URL / DIRECTUS_TOKEN belum di-set di server env');
	}
	return fetch(`${API_URL}/files`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${TOKEN}` },
		body: formData
	});
}

/** Versi JSON: lempar Error berisi pesan Directus jika gagal, retry sekali untuk 502. */
export async function directusServerJson<T = any>(
	endpoint: string,
	options: { method?: string; body?: string | FormData; headers?: Record<string, string> } = {}
): Promise<T> {
	const maxRetries = 1;
	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		const res = await directusServerFetch(endpoint, options);
		const text = await res.text();
		let parsed: any = null;
		try {
			parsed = text ? JSON.parse(text) : null;
		} catch {
			/* non-JSON */
		}

		if (res.ok) return parsed;

		if (res.status === 502 && attempt < maxRetries) {
			await new Promise((r) => setTimeout(r, 1500));
			continue;
		}

		const msg = parsed?.errors?.[0]?.message || parsed?.message || `Directus ${res.status}`;
		lastError = new Error(msg);
	}

	throw lastError;
}
