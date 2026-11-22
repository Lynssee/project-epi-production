// src/lib/server/ess/microQuiz.ts
// Micro-Quiz Harian lapangan: 1 soal/hari dari bank soal kuis program (kategori diatur di app_settings module `micro_quiz`).
// Dinilai di SERVER; hasil dicatat ke `training_micro_quiz_log` (BUKAN percobaan kuis resmi → tidak memengaruhi nilai, kuota percobaan, atau gate).
// Fetch dipisah per koleksi (CLAUDE.md #2); gagal baca = fail-soft tapi selalu dilog (#1). Cache pool/setelan 5 menit.

import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';
import {
	MICROQUIZ_MODULE, resolveMicroQuizSettings, normalizeQuestion, pickQuestion, toClientQuestion, gradeAnswer, daysBefore, hitungStreak,
	type MicroQuizSettings, type PoolQuestion, type ClientQuestion
} from './microQuizModel';

const TTL_MS = 5 * 60_000;
let settingsCache: { at: number; value: MicroQuizSettings } | null = null;
let poolCache: { at: number; key: string; value: PoolQuestion[] } | null = null;

async function loadSettings(): Promise<MicroQuizSettings> {
	if (settingsCache && Date.now() - settingsCache.at < TTL_MS) return settingsCache.value;
	let rows: any[] = [];
	try {
		const res = await directusServerJson<{ data: any[] }>(`/items/app_settings?filter[module][_eq]=${MICROQUIZ_MODULE}&fields=setting_key,setting_value&limit=-1`);
		rows = res?.data || [];
	} catch (e) {
		console.error('[microQuiz] gagal baca setelan, memakai default:', (e as Error)?.message);
	}
	const value = resolveMicroQuizSettings(rows);
	settingsCache = { at: Date.now(), value };
	return value;
}

async function loadPool(s: MicroQuizSettings): Promise<PoolQuestion[]> {
	const key = JSON.stringify([s.kategori, s.programIds]);
	if (poolCache && poolCache.key === key && Date.now() - poolCache.at < TTL_MS) return poolCache.value;
	try {
		// 1) program published (per ID bila diisi, selain itu per kategori)
		const progFilter = s.programIds.length > 0
			? `filter[id][_in]=${s.programIds.join(',')}`
			: s.kategori.length > 0 ? `filter[kategori][_in]=${s.kategori.map(encodeURIComponent).join(',')}` : '';
		if (!progFilter) return [];
		const progs = await directusServerJson<{ data: any[] }>(`/items/training_program?${progFilter}&filter[status][_eq]=published&fields=id&limit=-1`);
		const progIds = (progs?.data || []).map((p) => p.id);
		if (progIds.length === 0) { poolCache = { at: Date.now(), key, value: [] }; return []; }
		// 2) kuis program tsb (hanya peruntukan training)
		const quizzes = await directusServerJson<{ data: any[] }>(`/items/training_quiz?filter[program_id][_in]=${progIds.join(',')}&fields=id,program_id,peruntukan&limit=-1`);
		const quizRows = (quizzes?.data || []).filter((z) => !z.peruntukan || z.peruntukan === 'training');
		const quizProg = new Map<number, number>(quizRows.map((z) => [z.id, typeof z.program_id === 'object' ? z.program_id?.id : z.program_id]));
		if (quizProg.size === 0) { poolCache = { at: Date.now(), key, value: [] }; return []; }
		// 3) soal
		const qs = await directusServerJson<{ data: any[] }>(`/items/training_quiz_question?filter[quiz_id][_in]=${[...quizProg.keys()].join(',')}&fields=id,quiz_id,pertanyaan,tipe,opsi,jawaban_benar&limit=-1`);
		const value: PoolQuestion[] = [];
		for (const r of qs?.data || []) {
			const qid = typeof r.quiz_id === 'object' ? r.quiz_id?.id : r.quiz_id;
			const n = normalizeQuestion(r, quizProg.get(qid) ?? 0);
			if (n) value.push(n);
		}
		poolCache = { at: Date.now(), key, value };
		return value;
	} catch (e) {
		console.error('[microQuiz] gagal memuat bank soal:', (e as Error)?.message);
		return [];
	}
}

interface LogRow { question_id: number; tanggal: string; benar: boolean; jawaban: string | null }

async function loadLogs(karyawanId: number, sejak: string): Promise<LogRow[]> {
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/training_micro_quiz_log?filter[karyawan_id][_eq]=${karyawanId}&filter[tanggal][_gte]=${sejak}&fields=question_id,tanggal,benar,jawaban&limit=-1`
		);
		return (res?.data || []).map((r) => ({ question_id: Number(r.question_id), tanggal: String(r.tanggal).slice(0, 10), benar: !!r.benar, jawaban: r.jawaban ?? null }));
	} catch (e) {
		console.error('[microQuiz] gagal baca log karyawan (koleksi training_micro_quiz_log ada?):', (e as Error)?.message);
		return [];
	}
}

export interface MicroQuizState {
	enabled: boolean;
	/** Soal hari ini (tanpa kunci). null bila bank soal kosong. */
	question: ClientQuestion | null;
	/** Terisi bila sudah dijawab hari ini. */
	answered: { benar: boolean; jawaban: string | null; jawabanBenar: string | null } | null;
	/** Ringkasan 7 hari terakhir. */
	minggu: { benar: number; total: number };
	/** Hari beruntun menjawab (benar/salah), maks. sepanjang jendela log. */
	streak: number;
}

const EMPTY: MicroQuizState = { enabled: false, question: null, answered: null, minggu: { benar: 0, total: 0 }, streak: 0 };

async function resolveToday(karyawanId: number) {
	const settings = await loadSettings();
	if (!settings.enabled) return { settings, today: '', pool: [] as PoolQuestion[], logs: [] as LogRow[], pick: null as PoolQuestion | null, seed: '', todayLog: undefined as LogRow | undefined };
	const today = todayJakarta();
	const [pool, logs] = await Promise.all([loadPool(settings), loadLogs(karyawanId, daysBefore(today, Math.max(settings.hindariHari, 7)))]);
	const todayLog = logs.find((l) => l.tanggal === today);
	const seed = `${karyawanId}:${today}`;
	const seen = new Set(logs.filter((l) => l.tanggal !== today).map((l) => l.question_id));
	const pick = todayLog ? pool.find((q) => q.id === todayLog.question_id) ?? null : pickQuestion(pool, seed, seen);
	return { settings, today, pool, logs, pick, seed, todayLog };
}

function weekStats(logs: LogRow[], today: string) {
	const from = daysBefore(today, 6);
	const w = logs.filter((l) => l.tanggal >= from);
	return { benar: w.filter((l) => l.benar).length, total: w.length };
}

export async function getMicroQuiz(karyawan: { id: number }): Promise<MicroQuizState> {
	if (karyawan?.id == null) return EMPTY;
	const r = await resolveToday(karyawan.id);
	if (!r.settings.enabled) return EMPTY;
	const minggu = weekStats(r.logs, r.today);
	const streak = hitungStreak(r.logs.map((l) => l.tanggal), r.today);
	if (r.todayLog) {
		return {
			enabled: true,
			question: r.pick ? toClientQuestion(r.pick, r.seed) : null,
			answered: { benar: r.todayLog.benar, jawaban: r.todayLog.jawaban, jawabanBenar: r.pick?.jawaban_benar ?? null },
			minggu,
			streak
		};
	}
	return { enabled: true, question: r.pick ? toClientQuestion(r.pick, r.seed) : null, answered: null, minggu, streak };
}

export class MicroQuizError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

export async function submitMicroQuiz(karyawan: { id: number }, input: { questionId: unknown; jawaban: unknown }) {
	if (karyawan?.id == null) throw new MicroQuizError('Karyawan tidak dikenali.', 400);
	const r = await resolveToday(karyawan.id);
	if (!r.settings.enabled) throw new MicroQuizError('Micro-Quiz sedang dinonaktifkan.', 409);
	if (r.todayLog) {
		// Sudah dijawab hari ini: kembalikan hasil lama, jangan tulis ulang (idempoten).
		return { benar: r.todayLog.benar, jawabanBenar: r.pick?.jawaban_benar ?? null, sudahDijawab: true };
	}
	if (!r.pick || String(r.pick.id) !== String(input.questionId)) throw new MicroQuizError('Soal hari ini sudah berganti. Muat ulang halaman.', 409);
	const jawaban = String(input.jawaban ?? '').trim();
	if (!jawaban || !r.pick.opsi.some((o) => o.toLowerCase() === jawaban.toLowerCase())) throw new MicroQuizError('Jawaban tidak valid.', 400);
	const benar = gradeAnswer(r.pick, jawaban);
	await directusServerJson('/items/training_micro_quiz_log', {
		method: 'POST',
		body: JSON.stringify({ karyawan_id: karyawan.id, tanggal: r.today, question_id: r.pick.id, program_id: r.pick.program_id || null, jawaban, benar })
	});
	return { benar, jawabanBenar: r.pick.jawaban_benar, sudahDijawab: false };
}
