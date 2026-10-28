// src/lib/services/ess/training.ts
// Client-side service ESS E-Learning — SELALU lewat /api/ess/training/*, TIDAK PERNAH akses
// Directus langsung (sama prinsipnya dengan services/ess/kasbon.ts).

import { auth } from '$lib/firebase';

export interface TrainingProgramRecord {
	id: number;
	kode: string | null;
	judul: string;
	kategori: string | null;
	tipe: string | null;
	level: string | null;
	durasi_menit: number | null;
	deskripsi: string | null;
	thumbnail: string | null;
	passing_score: number | null;
	wajib: boolean;
	tenggat_hari: number | null;
	self_enroll: boolean;
	department_target: string | null;
	masa_berlaku_bulan: number | null;
	status: string;
	is_onboarding: boolean;
	urutan_tampil: number | null;
}

export interface TrainingEnrollmentRecord {
	id: number;
	program_id: number;
	karyawan_id: number;
	tanggal_daftar: string | null;
	progress_persen: number;
	status: string;
	nilai_teori: number | null;
	nilai_praktik: number | null;
	nilai_akhir: number | null;
	sertifikat_no: string | null;
	sertifikat_file: string | null;
	sertifikat_expired: string | null;
	sumber_daftar: string | null;
	tenggat: string | null;
}

export interface TrainingModuleRecord {
	id: number;
	program_id: number;
	judul: string;
	urutan: number | null;
	tipe_konten: string | null;
	konten_url: string | null;
	konten_teks: string | null;
	durasi_menit: number | null;
	min_persen_tonton: number | null;
	youtube_id: string | null;
	chapters: Array<{ detik: number; judul: string }> | null;
	transkrip: string | null;
}

export interface TrainingNoteRecord {
	id: number;
	karyawan_id: number;
	module_id: number;
	detik: number | null;
	catatan: string;
	date_created: string;
}

export interface TrainingDiskusiRecord {
	id: number;
	karyawan_id: number | null;
	karyawan_nama: string;
	module_id: number;
	pesan: string;
	parent_id: number | null;
	pinned: boolean;
	dilaporkan: boolean;
	date_created: string;
}

export interface TrainingProgressRecord {
	id: number;
	enrollment_id: number;
	module_id: number;
	status: string;
	progress_persen: number;
	last_position: string | null;
	persen_ditonton: number;
	detik_ditonton: number;
	durasi_video: number | null;
	segmen_ditonton: number[][] | null;
	waktu_selesai: string | null;
}

export interface KursusListItem {
	program: TrainingProgramRecord;
	enrollment: TrainingEnrollmentRecord | null;
	terdaftar: boolean;
	bisaSelfEnroll: boolean;
}

export interface KursusDetail {
	program: TrainingProgramRecord;
	enrollment: TrainingEnrollmentRecord | null;
	/** minBacaDetik: waktu baca minimum modul Teks (0 = tidak dikunci), dihitung server dari setelan training_lms. */
	modules: Array<{ modul: TrainingModuleRecord; progress: TrainingProgressRecord | null; minBacaDetik?: number }>;
	finalQuizId: number | null;
	bisaSelfEnroll: boolean;
}

export interface QuizQuestion {
	id: number;
	quiz_id: number;
	pertanyaan: string;
	tipe: string;
	opsi: string[] | null;
	bobot: number | null;
}

export interface QuizAttempt {
	id: number;
	enrollment_id: number;
	quiz_id: number;
	skor: number | null;
	lulus: boolean | null;
	jawaban: Array<{ question_id: number; jawaban: string; benar: boolean | null }>;
	waktu_mulai: string;
	waktu_selesai: string | null;
}

export interface QuizDetail {
	quiz: { id: number; program_id: number; module_id: number | null; judul: string; passing_score: number | null; acak_soal: boolean };
	questions: QuizQuestion[];
	attempts: QuizAttempt[];
	maxAttempts: number;
	showAnswersAfter: 'immediately' | 'after_pass' | 'never';
	sopTerkait: { id: number; title: string } | null;
	/** Kuis akhir + enrollment sudah Lulus: form disembunyikan, server menolak pengerjaan ulang (409). */
	sudahLulus?: boolean;
}

async function getIdToken(): Promise<string> {
	const user = auth.currentUser;
	if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
	return user.getIdToken();
}

async function parseErrorMessage(res: Response): Promise<string> {
	try {
		const data = await res.json();
		return data?.message || `Gagal (${res.status})`;
	} catch {
		return `Gagal (${res.status})`;
	}
}

async function authedFetch(url: string, options: RequestInit = {}): Promise<Response> {
	const idToken = await getIdToken();
	return fetch(url, {
		...options,
		headers: {
			...(options.body ? { 'Content-Type': 'application/json' } : {}),
			Authorization: `Bearer ${idToken}`,
			...(options.headers || {})
		}
	});
}

export async function getKursusList(): Promise<{ kursus: KursusListItem[] }> {
	const res = await authedFetch('/api/ess/training');
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function getKursusDetail(programId: number | string): Promise<KursusDetail> {
	const res = await authedFetch(`/api/ess/training/${programId}`);
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function selfEnrollKursus(programId: number | string): Promise<{ enrollment: TrainingEnrollmentRecord }> {
	const res = await authedFetch(`/api/ess/training/${programId}/enroll`, { method: 'POST' });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export interface SaveProgressParams {
	moduleId: number;
	persenDitonton: number;
	detikDitonton: number;
	durasiVideo: number | null;
	segmenDitonton: number[][];
	lastPosition: number;
	/** Video saja: pemutar tak terlacak (fallback) → server menegakkan waktu baca minimum. */
	manual?: boolean;
}

export async function saveModuleProgress(params: SaveProgressParams): Promise<{ progress: TrainingProgressRecord }> {
	const res = await authedFetch('/api/ess/training/progress', {
		method: 'POST',
		body: JSON.stringify(params)
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function getQuiz(quizId: number | string): Promise<QuizDetail> {
	const res = await authedFetch(`/api/ess/training/quiz/${quizId}`);
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export interface MySkillRecord {
	id: number;
	skill_id: number;
	skill_nama: string;
	skill_kategori: string | null;
	level: string;
	expired: string | null;
}

export async function getMySkills(): Promise<{ skills: MySkillRecord[] }> {
	const res = await authedFetch('/api/ess/training/skills');
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export interface OnboardingStatus {
	selesai: boolean;
	totalProgram: number;
	totalSelesai: number;
	tenggatTerdekat: string | null;
	programBerikutnya: TrainingProgramRecord | null;
}

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
	const res = await authedFetch('/api/ess/training/onboarding');
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function getModuleNotes(moduleId: number | string): Promise<{ notes: TrainingNoteRecord[] }> {
	const res = await authedFetch(`/api/ess/training/notes?moduleId=${moduleId}`);
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function createModuleNote(moduleId: number, detik: number | null, catatan: string): Promise<{ note: TrainingNoteRecord }> {
	const res = await authedFetch('/api/ess/training/notes', {
		method: 'POST',
		body: JSON.stringify({ moduleId, detik, catatan })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function deleteModuleNote(noteId: number): Promise<{ ok: true }> {
	const res = await authedFetch(`/api/ess/training/notes/${noteId}`, { method: 'DELETE' });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function getModuleDiscussion(moduleId: number | string): Promise<{ diskusi: TrainingDiskusiRecord[] }> {
	const res = await authedFetch(`/api/ess/training/discussion?moduleId=${moduleId}`);
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function postModuleDiscussion(moduleId: number, pesan: string, parentId: number | null): Promise<{ diskusi: TrainingDiskusiRecord[] }> {
	const res = await authedFetch('/api/ess/training/discussion', {
		method: 'POST',
		body: JSON.stringify({ moduleId, pesan, parentId })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function reportModuleDiscussion(diskusiId: number): Promise<{ ok: true }> {
	const res = await authedFetch(`/api/ess/training/discussion/${diskusiId}/report`, { method: 'POST' });
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function downloadKursusSertifikatInfo(
	programId: number | string
): Promise<{ blob: Blob; berQr: boolean }> {
	const res = await authedFetch(`/api/ess/training/${programId}/sertifikat`);
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	const berQr = res.headers.get('X-Sertifikat-Berqr') === '1';
	const blob = await res.blob();
	return { blob, berQr };
}

export async function downloadKursusSertifikat(programId: number | string): Promise<Blob> {
	const { blob } = await downloadKursusSertifikatInfo(programId);
	return blob;
}

export async function submitQuizAttempt(
	quizId: number | string,
	jawaban: Array<{ question_id: number; jawaban: string }>
): Promise<{ attempt: QuizAttempt }> {
	const res = await authedFetch(`/api/ess/training/quiz/${quizId}`, {
		method: 'POST',
		body: JSON.stringify({ jawaban })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}
