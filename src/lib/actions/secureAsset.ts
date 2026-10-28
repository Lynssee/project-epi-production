// src/lib/actions/secureAsset.ts
// Svelte actions untuk memuat aset Directus (gambar/PDF) TANPA menaruh
// token admin di URL klien.
//
// Aset diambil lewat secureDirectusFetch (proxy terautentikasi Firebase),
// lalu dikonversi jadi blob: URL.

import { openPlaceholderWindow } from '$lib/utils/openWindowAsync';
import { secureDirectusFetch } from '$lib/services/secureDirectus';

const cache = new Map<string, string>();

export function normalizeAssetPath(path: any, options?: { width?: number; height?: number; fit?: string; quality?: number }): string {
	if (!path) return '';
	if (typeof path === 'object' && path.id) path = path.id;
	if (typeof path !== 'string') return '';

	if (path.startsWith('blob:') || path.startsWith('data:')) return path;

	let cleanPath = path.trim();
	if (cleanPath.startsWith('http://') || cleanPath.startsWith('https://')) {
		const match = cleanPath.match(/\/assets\/[a-zA-Z0-9_-]+(\?.*)?$/);
		if (match) {
			cleanPath = match[0];
		} else {
			return cleanPath;
		}
	}

	if (!cleanPath.startsWith('/assets/') && !cleanPath.startsWith('assets/')) {
		cleanPath = `/assets/${cleanPath}`;
	}
	if (!cleanPath.startsWith('/')) {
		cleanPath = `/${cleanPath}`;
	}

	if (options) {
		const params = new URLSearchParams();
		if (options.width) params.set('width', String(options.width));
		if (options.height) params.set('height', String(options.height));
		if (options.fit) params.set('fit', options.fit);
		if (options.quality) params.set('quality', String(options.quality));
		const qs = params.toString();
		if (qs) {
			cleanPath += (cleanPath.includes('?') ? '&' : '?') + qs;
		}
	}

	return cleanPath;
}

export async function getSecureAssetUrl(path: any): Promise<string> {
	const normalized = normalizeAssetPath(path);
	return fetchBlobUrl(normalized);
}

async function fetchBlobUrl(path: string): Promise<string> {
	if (!path) return '';
	if (path.startsWith('blob:') || path.startsWith('data:')) return path;
	if (cache.has(path)) return cache.get(path) as string;

	try {
		const res = await secureDirectusFetch(path);
		if (!res.ok) throw new Error(`Gagal memuat aset (${res.status})`);
		const blob = await res.blob();
		const url = URL.createObjectURL(blob);
		cache.set(path, url);
		return url;
	} catch (err) {
		console.warn('[secureAsset] gagal memuat aset:', path, err);
		return '';
	}
}

/** use:secureAssetSrc={photoIdOrPath} — untuk <img>. */
export function secureAssetSrc(node: HTMLImageElement, path: any) {
	let cancelled = false;
	async function load(p: any) {
		if (!p) {
			node.removeAttribute('src');
			return;
		}
		const normalized = normalizeAssetPath(p);
		if (!normalized) {
			node.removeAttribute('src');
			return;
		}
		if (normalized.startsWith('blob:') || normalized.startsWith('data:')) {
			node.src = normalized;
			return;
		}
		try {
			const url = await fetchBlobUrl(normalized);
			if (!cancelled && url) {
				node.src = url;
			}
		} catch (e) {
			console.warn('[secureAssetSrc] gagal memuat gambar:', e);
		}
	}
	load(path);
	return {
		update(newPath: any) {
			load(newPath);
		},
		destroy() {
			cancelled = true;
		}
	};
}

/** use:secureAssetHref={photoIdOrPath} — untuk <a>. */
export function secureAssetHref(node: HTMLAnchorElement, path: any) {
	let cancelled = false;
	async function load(p: any) {
		if (!p) {
			node.removeAttribute('href');
			return;
		}
		const normalized = normalizeAssetPath(p);
		if (!normalized) {
			node.removeAttribute('href');
			return;
		}
		if (normalized.startsWith('blob:') || normalized.startsWith('data:')) {
			node.href = normalized;
			return;
		}
		try {
			const url = await fetchBlobUrl(normalized);
			if (!cancelled && url) {
				node.href = url;
			}
		} catch (e) {
			console.warn('[secureAssetHref] gagal memuat aset:', e);
		}
	}
	load(path);
	return {
		update(newPath: any) {
			load(newPath);
		},
		destroy() {
			cancelled = true;
		}
	};
}

/** Untuk kasus imperatif (mis. window.open() dari handler klik). */
export async function openSecureAsset(path: any) {
	// PRJ-28 (Aturan #5): jendela dibuka SINKRON sebelum await apa pun (fetch blob di bawah async).
	const normalized = normalizeAssetPath(path);
	if (!normalized) return;
	const w = openPlaceholderWindow();
	try {
		if (normalized.startsWith('blob:') || normalized.startsWith('data:')) {
			w.navigate(normalized);
			return;
		}
		const url = await fetchBlobUrl(normalized);
		if (url) w.navigate(url);
		else w.cancel();
	} catch (e) {
		w.cancel();
		console.warn('[openSecureAsset] gagal membuka aset:', e);
	}
}
