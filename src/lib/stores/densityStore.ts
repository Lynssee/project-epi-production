// src/lib/stores/densityStore.ts
// Mode kepadatan (compact/comfortable) — preferensi per-perangkat (localStorage),
// meniru pola src/lib/stores/themeStore.ts.

import { writable, get } from 'svelte/store';

const DENSITY_CACHE_KEY = 'app_density';

export const density = writable<'comfortable' | 'compact'>('comfortable');

export function applyDensity(mode: 'comfortable' | 'compact') {
	if (typeof document === 'undefined') return;
	if (mode === 'compact') {
		document.documentElement.setAttribute('data-density', 'compact');
	} else {
		document.documentElement.removeAttribute('data-density');
	}
}

/** Muat preferensi density dari localStorage (sudah diterapkan lebih awal oleh script anti-flash di app.html). */
export function loadDensity(): 'comfortable' | 'compact' {
	let mode: 'comfortable' | 'compact' = 'comfortable';
	try {
		const cached = localStorage.getItem(DENSITY_CACHE_KEY);
		if (cached === 'compact') mode = 'compact';
	} catch {
		// localStorage tidak tersedia — pakai default 'comfortable'.
	}
	density.set(mode);
	applyDensity(mode);
	return mode;
}

export function setDensity(mode: 'comfortable' | 'compact') {
	density.set(mode);
	applyDensity(mode);
	try {
		localStorage.setItem(DENSITY_CACHE_KEY, mode);
	} catch {
		// localStorage tidak tersedia — preferensi tidak akan bertahan setelah reload.
	}
}

export function toggleDensity() {
	setDensity(get(density) === 'compact' ? 'comfortable' : 'compact');
}
