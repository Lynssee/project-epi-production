// src/lib/stores/hematStore.ts
// Mode Hemat (rencana v2, Fase 5) — sakelar manual, preferensi per-perangkat (localStorage),
// meniru pola src/lib/stores/themeStore.ts. Efeknya murni lewat CSS ([data-hemat="1"] di
// layout.css): matikan backdrop-filter/bayangan/transisi, paksa kamera ke resolusi rendah,
// hentikan pembaruan otomatis panel notifikasi — tidak perlu menyentuh logika komponen mana pun.

import { writable, get } from 'svelte/store';

const HEMAT_CACHE_KEY = 'app_hemat_mode';

export const hematMode = writable<boolean>(false);

function applyHematMode(on: boolean) {
	if (typeof document === 'undefined') return;
	if (on) {
		document.documentElement.setAttribute('data-hemat', '1');
	} else {
		document.documentElement.removeAttribute('data-hemat');
	}
}

export function loadHematMode(): boolean {
	let on = false;
	try {
		on = localStorage.getItem(HEMAT_CACHE_KEY) === '1';
	} catch {
		// localStorage tidak tersedia — default mati.
	}
	hematMode.set(on);
	applyHematMode(on);
	return on;
}

export function setHematMode(on: boolean) {
	hematMode.set(on);
	applyHematMode(on);
	try {
		localStorage.setItem(HEMAT_CACHE_KEY, on ? '1' : '0');
	} catch {
		// localStorage tidak tersedia — preferensi tidak akan bertahan setelah reload.
	}
}

export function toggleHematMode() {
	setHematMode(!get(hematMode));
}

/** Kamera dianggap "lemah" bila Mode Hemat aktif, terlepas dari kemampuan perangkat asli. */
export function isHematActive(): boolean {
	if (typeof document === 'undefined') return false;
	return document.documentElement.getAttribute('data-hemat') === '1';
}
