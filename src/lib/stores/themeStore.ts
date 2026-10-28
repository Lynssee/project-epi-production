// src/lib/stores/themeStore.ts
// Mode terang/gelap Aplikasi Lapangan — preferensi per-perangkat (localStorage),
// meniru pola src/lib/stores/themeStore.js di erp-epi-1 (Dashboard Admin).

import { writable, get } from 'svelte/store';

const MODE_CACHE_KEY = 'app_theme_mode';

export const themeMode = writable<'light' | 'dark'>('light');

export function applyThemeMode(mode: 'light' | 'dark') {
	if (typeof document === 'undefined') return;
	if (document.documentElement.classList.contains('print-mode') || window?.location?.pathname?.startsWith('/print')) {
		document.documentElement.setAttribute('data-theme', 'light');
		document.documentElement.classList.remove('dark');
		const metaTag = document.getElementById('theme-color-meta');
		if (metaTag) metaTag.setAttribute('content', '#1F6592');
		return;
	}
	const isDark = mode === 'dark';
	document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
	document.documentElement.classList.toggle('dark', isDark);
	const metaTag = document.getElementById('theme-color-meta');
	if (metaTag) metaTag.setAttribute('content', isDark ? '#121A22' : '#1F6592');
}

/** Muat preferensi mode dari localStorage (sudah diterapkan lebih awal oleh script anti-flash di app.html). */
export function loadThemeMode(): 'light' | 'dark' {
	let mode: 'light' | 'dark' = 'light';
	try {
		const cached = localStorage.getItem(MODE_CACHE_KEY);
		if (cached === 'dark' || cached === 'light') {
			mode = cached;
		}
	} catch {
		// localStorage tidak tersedia — pakai default 'light'.
	}
	themeMode.set(mode);
	applyThemeMode(mode);
	return mode;
}

export function setThemeMode(mode: 'light' | 'dark') {
	const next = mode === 'dark' ? 'dark' : 'light';
	themeMode.set(next);
	applyThemeMode(next);
	try {
		localStorage.setItem(MODE_CACHE_KEY, next);
	} catch {
		// localStorage tidak tersedia — preferensi tidak akan bertahan setelah reload.
	}
}

export function toggleThemeMode() {
	setThemeMode(get(themeMode) === 'dark' ? 'light' : 'dark');
}
