// Micro-quiz kontekstual (Pintasan Belajar): cek pemahaman 3 soal acak dari kuis MODUL sebuah program, sebelum pekerjaan dimulai.
// Latihan saja — TIDAK mencatat skor/attempt & tidak memengaruhi kelulusan. Penilaian di server; kunci jawaban hanya dibuka
// untuk soal yang baru saja disajikan (dijamin token HMAC), sehingga bank soal kuis resmi tidak bisa ditelusuri lewat endpoint ini.
import { timingSafeEqual } from 'node:crypto';
import { directusServerJson } from '$lib/server/directus';
import { signQuizPayload } from '$lib/server/ess/training';

export const DEFAULT_MICRO_QUIZ_COUNT = 3;
export const MAX_MICRO_QUIZ_COUNT = 5;
export const MICRO_TOKEN_TTL_MS = 30 * 60_000;
const ALLOWED_TYPES = new Set(['pilihan_ganda', 'benar_salah']);

export interface MicroQuestionFull {
	id: number;
	pertanyaan: string;
	tipe: string;
	opsi: string[];
	jawaban_benar: string;
}
export interface MicroQuestionPublic {
	id: number;
	pertanyaan: string;
	tipe: string;
	opsi: string[];
}

/** Jumlah soal dari konfigurasi pintasan (rule.micro_quiz): tak diatur → 3; 0 → nonaktif; dibatasi 0..5. */
export function resolveMicroCount(raw: unknown): number {
	if (raw === undefined || raw === null || raw === '') return DEFAULT_MICRO_QUIZ_COUNT;
	const n = Math.floor(Number(raw));
	if (!Number.isFinite(n) || n < 0) return DEFAULT_MICRO_QUIZ_COUNT;
	return Math.min(n, MAX_MICRO_QUIZ_COUNT);
}

/** Pilih n soal acak yang layak (tipe didukung, opsi ≥2, kunci ada dan salah satu opsi). Pure. */
export function pickMicroQuestions(all: Array<Partial<MicroQuestionFull>>, n: number, rng: () => number = Math.random): MicroQuestionFull[] {
	const ok = all.filter((q): q is MicroQuestionFull => {
		const opsi = Array.isArray(q.opsi) ? q.opsi.map(String) : [];
		const key = String(q.jawaban_benar ?? '').trim().toLowerCase();
		return !!q.id && !!q.pertanyaan && ALLOWED_TYPES.has(String(q.tipe)) && opsi.length >= 2 && !!key && opsi.some((o) => o.trim().toLowerCase() === key);
	});
	const pool = [...ok];
	for (let i = pool.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[pool[i], pool[j]] = [pool[j], pool[i]];
	}
	return pool.slice(0, Math.max(0, n));
}

export const toPublic = (q: MicroQuestionFull): MicroQuestionPublic => ({ id: q.id, pertanyaan: q.pertanyaan, tipe: q.tipe, opsi: q.opsi.map(String) });

export function makeMicroToken(karyawanId: number, programId: number, ids: number[], now = Date.now()): string {
	const exp = now + MICRO_TOKEN_TTL_MS;
	const data = `micro:${karyawanId}:${programId}:${[...ids].sort((a, b) => a - b).join(',')}:${exp}`;
	return Buffer.from(`${data}|${signQuizPayload(data)}`).toString('base64url');
}

/** @returns id soal yang sah disajikan, atau null bila token tidak valid / kedaluwarsa / bukan milik karyawan & program ini. */
export function verifyMicroToken(token: string | null | undefined, karyawanId: number, programId: number, now = Date.now()): number[] | null {
	if (!token) return null;
	try {
		const [data, sig] = Buffer.from(token, 'base64url').toString('utf8').split('|');
		if (!data || !sig) return null;
		const expected = signQuizPayload(data);
		if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
		const [tag, kid, pid, ids, exp] = data.split(':');
		if (tag !== 'micro' || Number(kid) !== karyawanId || Number(pid) !== programId || !(Number(exp) > now)) return null;
		return ids ? ids.split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
	} catch {
		return null;
	}
}

export interface MicroResult { id: number; benar: boolean; jawabanBenar: string }

/** Nilai jawaban (perbandingan sama dengan penilaian kuis resmi: trim + case-insensitive). Pure. */
export function gradeMicro(served: MicroQuestionFull[], answers: Record<string, unknown>): { results: MicroResult[]; benar: number; total: number } {
	const results = served.map((q) => {
		const a = String(answers?.[String(q.id)] ?? '').trim().toLowerCase();
		const key = String(q.jawaban_benar).trim();
		return { id: q.id, benar: a !== '' && a === key.toLowerCase(), jawabanBenar: q.opsi.find((o) => o.trim().toLowerCase() === key.toLowerCase()) ?? key };
	});
	return { results, benar: results.filter((r) => r.benar).length, total: results.length };
}

/** Soal (dengan kunci) dari kuis modul program. Query datar & terpisah: kuis modul dulu, lalu soalnya. Kuis akhir (module_id kosong) DIKECUALIKAN. */
export async function loadModuleQuestionsFull(programId: number): Promise<MicroQuestionFull[]> {
	const quizzes = await directusServerJson<{ data: Array<{ id: number }> }>(
		`/items/training_quiz?${new URLSearchParams({ 'filter[program_id][_eq]': String(programId), 'filter[module_id][_nnull]': 'true', fields: 'id', limit: '100' })}`
	);
	const ids = (quizzes?.data ?? []).map((q) => q.id);
	if (!ids.length) return [];
	const qs = await directusServerJson<{ data: any[] }>(
		`/items/training_quiz_question?${new URLSearchParams({ 'filter[quiz_id][_in]': ids.join(','), fields: 'id,pertanyaan,tipe,opsi,jawaban_benar', limit: '500' })}`
	);
	return (qs?.data ?? []) as MicroQuestionFull[];
}
