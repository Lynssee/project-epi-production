// src/lib/utils/sessionCleanliness.ts
// Kembaran erp-epi/src/lib/utils/sessionCleanliness.js — deteksi sesi berakhir
// tidak normal (rencana v2 §4 Anti-White-Screen, Fase 2). Lihat file itu untuk
// penjelasan lengkap mekanismenya.
import { listAllScopes } from './draftStorage';

const MARKER_KEY = 'draft:session_active';

function hasLocalStorage(): boolean {
	return typeof localStorage !== 'undefined';
}

export interface SessionCleanlinessResult {
	abnormal: boolean;
	draftCount: number;
}

export function initSessionCleanlinessTracking(): SessionCleanlinessResult {
	const wasActive = hasLocalStorage() && localStorage.getItem(MARKER_KEY) === '1';
	const draftCount = listAllScopes().length;
	const abnormal = wasActive && draftCount > 0;

	if (hasLocalStorage()) {
		try {
			localStorage.setItem(MARKER_KEY, '1');
		} catch {
			// abaikan — deteksi sesi tidak normal jadi kurang akurat, bukan fatal
		}
	}
	if (typeof window !== 'undefined') {
		window.addEventListener('pagehide', () => {
			if (!hasLocalStorage()) return;
			try {
				localStorage.removeItem(MARKER_KEY);
			} catch {
				// abaikan
			}
		});
	}

	return { abnormal, draftCount };
}
