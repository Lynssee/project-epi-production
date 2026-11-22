// src/lib/services/ess/quizGate.ts
// Client-side wrapper /api/ess/training/quiz-gate — status App-Blocking Gate kuis periodik (G_TRN_QUIZ_PERIODIC_WAJIB).
// Dipanggil SEKALI per sesi aplikasi + setelah submit kuis (event QUIZ_GATE_REFRESH_EVENT) — bukan di tiap navigasi.

import { auth } from '$lib/firebase';

export const QUIZ_GATE_REFRESH_EVENT = 'quizgate:refresh';

export interface QuizGateClientItem {
	quizId: number;
	programId: number;
	judul: string;
	periodeKe: number;
	state: 'pending' | 'remedial' | 'done' | 'dispensed';
	attemptsUsed: number;
	maxAttempts: number;
	tanggalSelesai: string | null;
	durasiMenit: number | null;
	ringkasanPoin: string[];
}

export interface QuizGateClientStatus {
	mode: 'shadow' | 'warn' | 'soft' | 'hard';
	blocking: boolean;
	showBanner: boolean;
	canSnooze: boolean;
	snoozeMinutes: number;
	snoozedUntil: string | null;
	pendingCount: number;
	escapePaths: string[];
	items: QuizGateClientItem[];
	upcoming: Array<{ quizId: number; programId: number; judul: string; tanggalMulai: string; hariLagi: number }>;
}

async function authHeader(): Promise<Record<string, string>> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return { Authorization: `Bearer ${await user.getIdToken()}` };
}

export async function getQuizGateStatus(): Promise<QuizGateClientStatus> {
	const res = await fetch('/api/ess/training/quiz-gate', { headers: await authHeader() });
	if (!res.ok) throw new Error(`Gagal (${res.status})`);
	return res.json();
}

export async function snoozeQuizGate(alasan: string): Promise<{ snoozedUntil: string }> {
	const res = await fetch('/api/ess/training/quiz-gate', {
		method: 'POST',
		headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
		body: JSON.stringify({ alasan })
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(data?.message || `Gagal (${res.status})`);
	return data;
}

/** Minta layout memuat ulang status gate (mis. setelah submit kuis). */
export function requestQuizGateRefresh(): void {
	if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(QUIZ_GATE_REFRESH_EVENT));
}
