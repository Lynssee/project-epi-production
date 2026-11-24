// src/lib/server/directus.ts
// SERVER-ONLY. Memegang token Directus rahasia (tidak pernah dikirim ke klien).
// Dipakai oleh endpoint /api/ess/* — jangan import dari kode klien.

import { env } from '$env/dynamic/private';

const API_URL = env.DIRECTUS_API_URL || env.VITE_DIRECTUS_API_URL;
const TOKEN = env.DIRECTUS_TOKEN || env.VITE_DIRECTUS_TOKEN;

const DEFAULT_FETCH_TIMEOUT_MS = 20_000;
const DEFAULT_UPLOAD_TIMEOUT_MS = 30_000;

export interface DirectusFetchOptions {
	method?: string;
	body?: string | FormData;
	headers?: Record<string, string>;
	/** Timeout request dalam ms (0 = tanpa batas). Default 20_000 ms. */
	timeoutMs?: number;
	signal?: AbortSignal;
}

function buildSignal(timeoutMs: number, externalSignal?: AbortSignal): AbortSignal | undefined {
	const timeoutSignal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined;
	if (externalSignal && timeoutSignal) return AbortSignal.any([externalSignal, timeoutSignal]);
	return externalSignal || timeoutSignal;
}

export function directusServerFetch(
	endpoint: string,
	options: DirectusFetchOptions = {}
): Promise<Response> {
	if (!API_URL || !TOKEN) {
		throw new Error('[directus.server] DIRECTUS_API_URL / DIRECTUS_TOKEN belum di-set di server env');
	}
	const {
		method = 'GET',
		body,
		headers = {},
		timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
		signal
	} = options;
	const mergedHeaders: Record<string, string> = {
		'Content-Type': 'application/json',
		Authorization: `Bearer ${TOKEN}`,
		...headers
	};
	return fetch(`${API_URL}${endpoint}`, {
		method,
		headers: mergedHeaders,
		body,
		signal: buildSignal(timeoutMs, signal)
	});
}

/** Upload file ke Directus /files. Content-Type sengaja tidak di-set manual untuk FormData. */
export function directusServerUpload(
	formData: FormData,
	options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<Response> {
	if (!API_URL || !TOKEN) {
		throw new Error('[directus.server] DIRECTUS_API_URL / DIRECTUS_TOKEN belum di-set di server env');
	}
	const { timeoutMs = DEFAULT_UPLOAD_TIMEOUT_MS, signal } = options;
	return fetch(`${API_URL}/files`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${TOKEN}` },
		body: formData,
		signal: buildSignal(timeoutMs, signal)
	});
}

/** Versi JSON: lempar Error berisi pesan Directus jika gagal; retry 502 HANYA untuk GET/HEAD (idempoten). */
export async function directusServerJson<T = any>(
	endpoint: string,
	options: DirectusFetchOptions = {}
): Promise<T> {
	const method = (options.method || 'GET').toUpperCase();
	const isIdempotent = method === 'GET' || method === 'HEAD';
	const maxRetries = isIdempotent ? 1 : 0;
	let lastError: Error | null = null;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		let res: Response;
		try {
			res = await directusServerFetch(endpoint, options);
		} catch (err: any) {
			if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
				const ms = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
				throw new Error(`Directus timeout (${ms}ms) pada ${method} ${endpoint.split('?')[0]}`);
			}
			throw err;
		}
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
