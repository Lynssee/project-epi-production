// src/lib/stores/previewStore.ts
// Store terpusat untuk mode preview perangkat & toolbar tampilan.

import { writable, get } from 'svelte/store';

export type PreviewMode = 'desktop' | 'tablet' | 'mobile';

const PREVIEW_CACHE_KEY = 'epi_preview_mode';
const TOOLBAR_CACHE_KEY = 'epi_show_toolbar';

export const previewMode = writable<PreviewMode>('desktop');
export const showToolbar = writable<boolean>(false);

export function loadPreviewState() {
	if (typeof window === 'undefined') return;
	const isFrame = window.self !== window.top;
	if (isFrame) {
		previewMode.set('desktop');
	} else {
		if (window.innerWidth < 1024) {
			previewMode.set('desktop');
		} else {
			const savedMode = localStorage.getItem(PREVIEW_CACHE_KEY);
			if (savedMode && (savedMode === 'desktop' || savedMode === 'tablet' || savedMode === 'mobile')) {
				previewMode.set(savedMode as PreviewMode);
			}
		}
		const savedShowToolbar = localStorage.getItem(TOOLBAR_CACHE_KEY);
		if (savedShowToolbar !== null) {
			showToolbar.set(savedShowToolbar === 'true');
		}
	}
}

export function setPreviewMode(mode: PreviewMode) {
	previewMode.set(mode);
	if (typeof localStorage !== 'undefined') {
		try {
			localStorage.setItem(PREVIEW_CACHE_KEY, mode);
		} catch {}
	}
}

export function setShowToolbar(show: boolean) {
	showToolbar.set(show);
	if (typeof localStorage !== 'undefined') {
		try {
			localStorage.setItem(TOOLBAR_CACHE_KEY, String(show));
		} catch {}
	}
}

export function toggleToolbar() {
	setShowToolbar(!get(showToolbar));
}
