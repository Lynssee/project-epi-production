// src/lib/utils/haptic.ts
// Getar halus (rencana v2, Fase 5, 5.6) — umpan balik taktil pada tombol aksi utama,
// membantu di lapangan saat layar sulit terlihat karena silau matahari.

export function vibrateTap() {
	if (typeof navigator === 'undefined' || !navigator.vibrate) return;
	try {
		navigator.vibrate(10);
	} catch {
		// beberapa browser melempar bila dipanggil di luar interaksi user — abaikan.
	}
}

export function hapticOk() {
	if (typeof navigator === 'undefined' || !navigator.vibrate) return;
	try {
		navigator.vibrate([15, 30, 15]);
	} catch {
		// abaikan bila unsupported / interaksi browser
	}
}

export function hapticError() {
	if (typeof navigator === 'undefined' || !navigator.vibrate) return;
	try {
		navigator.vibrate([50, 50, 50]);
	} catch {
		// abaikan
	}
}

export function hapticWarning() {
	if (typeof navigator === 'undefined' || !navigator.vibrate) return;
	try {
		navigator.vibrate([30, 50, 30]);
	} catch {
		// abaikan
	}
}

export const vibrateSuccess = hapticOk;
export const vibrateError = hapticError;
