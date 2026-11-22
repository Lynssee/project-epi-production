// src/lib/services/ess/microQuiz.ts
// Client-side wrapper /api/ess/micro-quiz (Micro-Quiz Harian). Kunci jawaban tidak pernah ada di klien.

import { auth } from '$lib/firebase';

export interface MicroQuizQuestion {
	id: number;
	pertanyaan: string;
	tipe: 'pilihan_ganda' | 'benar_salah';
	opsi: string[];
}
export interface MicroQuizState {
	enabled: boolean;
	question: MicroQuizQuestion | null;
	answered: { benar: boolean; jawaban: string | null; jawabanBenar: string | null } | null;
	minggu: { benar: number; total: number };
	streak: number;
}
export interface MicroQuizResult {
	benar: boolean;
	jawabanBenar: string | null;
	sudahDijawab: boolean;
}

async function authFetch(init: RequestInit = {}): Promise<Response> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	const idToken = await user.getIdToken();
	const res = await fetch('/api/ess/micro-quiz', { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' } });
	if (!res.ok) {
		let msg = `Gagal (${res.status})`;
		try {
			msg = (await res.json())?.message || msg;
		} catch {
			/* non-JSON */
		}
		throw new Error(msg);
	}
	return res;
}

export async function getMicroQuiz(): Promise<MicroQuizState> {
	return (await authFetch()).json();
}

export async function submitMicroQuiz(questionId: number, jawaban: string): Promise<MicroQuizResult> {
	return (await authFetch({ method: 'POST', body: JSON.stringify({ question_id: questionId, jawaban }) })).json();
}
