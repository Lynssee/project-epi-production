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
	/** UUID file Directus (video kecil/MP4 yang diunggah admin). Video besar tetap lewat konten_url. */
	file?: string | null;
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
	/** Kode pilar Knowledge (product | technical | management | general | administrative). */
	pilar?: string;
	/** Asal materi (Inventory 360°, SOP, TDS/MSDS, dst.) — label & ikon mengikuti setelan admin. */
	sumber?: SumberPelatihan;
}

export interface SumberPelatihan {
	key: string;
	label: string;
	icon: string;
}

export interface PilarKnowledge {
	code: string;
	label: string;
	short: string;
	icon: string;
	hint: string;
	/** Jumlah kursus karyawan ini di pilar tsb. */
	jumlah: number;
}

export interface KursusDetail {
	program: TrainingProgramRecord;
	enrollment: TrainingEnrollmentRecord | null;
	/** minBacaDetik: waktu baca minimum modul Teks (0 = tidak dikunci), dihitung server dari setelan training_lms. */
	modules: Array<{ modul: TrainingModuleRecord; progress: TrainingProgressRecord | null; minBacaDetik?: number }>;
	finalQuizId: number | null;
	bisaSelfEnroll: boolean;
	sumber?: SumberPelatihan;
	/** Barang Inventory 360° di balik modul (hanya program bersumber Inventory 360°). */
	kartu360?: Array<{ moduleId: number; itemId: number }>;
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
	periode_ke?: number | null;
	durasi_detik?: number | null;
	tab_switch_count?: number | null;
	status_integritas?: string | null;
}

export interface QuizDetail {
	quiz: {
		id: number;
		program_id: number;
		module_id: number | null;
		judul: string;
		passing_score: number | null;
		acak_soal: boolean;
		durasi_menit?: number | null;
		durasi_per_soal_detik?: number | null;
		acak_opsi?: boolean | null;
		mode_navigasi?: string | null;
		anti_cheat_tab_limit?: number | null;
		cegah_copy_paste?: boolean | null;
	};
	questions: QuizQuestion[];
	attempts: QuizAttempt[];
	sessionToken?: string;
	serverTime?: string;
	maxAttempts: number;
	/** Batas percobaan tercapai & belum lulus: atasan/mentor yang dapat menyetujui percobaan ulang (gate G_TRN_MENTOR_SIGNOFF). */
	perluPembinaan?: { mentorNama: string | null } | null;
	showAnswersAfter: 'immediately' | 'after_pass' | 'never';
	sopTerkait: { id: number; title: string } | null;
	/** Kuis akhir + enrollment sudah Lulus: form disembunyikan, server menolak pengerjaan ulang (409). */
	sudahLulus?: boolean;
	/** Flashcard persiapan 1 menit: 3-5 poin kunci dari admin (kosong = tidak ada). */
	ringkasanPoin?: string[];
	/** Kuis periodik (asynchronous terjadwal): info periode berjalan; null untuk kuis biasa. */
	periodik?: {
		periodeKe: number;
		state: 'pending' | 'remedial' | 'done' | 'dispensed';
		tanggalMulai: string | null;
		tanggalSelesai: string | null;
		durasiMenit: number | null;
		jumlahSoal: number;
		bankSoal: number;
	} | null;
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

export async function getKursusList(): Promise<{ kursus: KursusListItem[]; pilar?: PilarKnowledge[]; panduan?: string[] }> {
	const res = await authedFetch('/api/ess/training');
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export interface PintasanItem {
	programId: number;
	judul: string;
	kode: string | null;
	pilar: string;
	pilarLabel: string;
	durasiMenit: number | null;
	progress: number;
	wajib: boolean;
	status: 'baru' | 'berjalan';
	/** Jumlah soal micro-quiz latihan yang ditawarkan (0 = tidak ada tombol). */
	microQuiz?: number;
}

export interface MicroQuizQuestion {
	id: number;
	pertanyaan: string;
	tipe: string;
	opsi: string[];
}
export interface MicroQuizResult {
	results: Array<{ id: number; benar: boolean; jawabanBenar: string }>;
	benar: number;
	total: number;
}

export async function getMicroQuiz(programId: number, konteks: string): Promise<{ questions: MicroQuizQuestion[]; token: string | null }> {
	const res = await authedFetch(`/api/ess/training/pintasan/micro-quiz?program=${programId}&konteks=${encodeURIComponent(konteks)}`);
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

export async function submitMicroQuiz(programId: number, token: string, answers: Record<string, string>): Promise<MicroQuizResult> {
	const res = await authedFetch('/api/ess/training/pintasan/micro-quiz', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ program: programId, token, answers })
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

// Cache per sesi (1 panggilan API per konteks) — kartu pintasan muncul di banyak halaman; hemat request.
const pintasanCache = new Map<string, Promise<{ items: PintasanItem[] }>>();

export function getPintasanBelajar(konteks: string): Promise<{ items: PintasanItem[] }> {
	const hit = pintasanCache.get(konteks);
	if (hit) return hit;
	const p = (async () => {
		const res = await authedFetch(`/api/ess/training/pintasan?konteks=${encodeURIComponent(konteks)}`);
		if (!res.ok) throw new Error(await parseErrorMessage(res));
		return (await res.json()) as { items: PintasanItem[] };
	})();
	pintasanCache.set(konteks, p);
	p.catch(() => pintasanCache.delete(konteks)); // gagal tidak di-cache
	return p;
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
	jawaban: Array<{ question_id: number; jawaban: string }>,
	meta?: { session_token?: string; tab_switch_count?: number; client_started_at?: number }
): Promise<{ attempt: QuizAttempt; remedial?: boolean }> {
	const res = await authedFetch(`/api/ess/training/quiz/${quizId}`, {
		method: 'POST',
		body: JSON.stringify({
			jawaban,
			session_token: meta?.session_token,
			tab_switch_count: meta?.tab_switch_count ?? 0,
			client_started_at: meta?.client_started_at
		})
	});
	if (!res.ok) throw new Error(await parseErrorMessage(res));
	return res.json();
}

// Status kelulusan saya per program (Kartu 360° lapangan). Cache per sesi per program: 1 panggilan untuk banyak kartu.
const statusSayaCache = new Map<number, Promise<string | null>>();
export function getStatusSayaProgram(programId: number | string): Promise<string | null> {
	const id = Number(programId);
	if (!Number.isFinite(id) || id <= 0) return Promise.resolve(null);
	const hit = statusSayaCache.get(id);
	if (hit) return hit;
	const p = authedFetch(`/api/ess/training/status?ids=${id}`)
		.then(async (res) => (res.ok ? ((await res.json())?.status?.[String(id)] ?? null) : null))
		.catch(() => null);
	statusSayaCache.set(id, p);
	return p;
}

// ─── Referensi cepat Buku Saku (profil 360° terverifikasi + bahaya material R&D) ──────────────────
export interface ReferensiSakuData {
	barang: Array<{ itemId: number; nama: string; kritis: boolean; ringkasan: string; interval: string; tandaGanti: string; tandaPalsu: string; apd: string[]; bahaya: string; spesifikasi?: Array<{ label: string; nilai: string }> }>;
	material: Array<{ materialId: number; nama: string; fungsi: string; bahaya: string }>;
	dibuat: string;
}
const REFERENSI_KEY = 'epi_referensi_saku_v2';
const REFERENSI_TTL_MS = 24 * 3600 * 1000;

/** Salinan lokal 24 jam (hemat kuota; tetap tampil offline). Gagal jaringan → pakai salinan lama bila ada. */
export async function getReferensiSaku(): Promise<{ data: ReferensiSakuData | null; dariCache: boolean }> {
	let cached: { at: number; data: ReferensiSakuData } | null = null;
	try {
		const raw = localStorage.getItem(REFERENSI_KEY);
		cached = raw ? JSON.parse(raw) : null;
	} catch { cached = null; }
	if (cached && Date.now() - cached.at < REFERENSI_TTL_MS) return { data: cached.data, dariCache: true };
	try {
		const res = await authedFetch('/api/ess/referensi-saku');
		if (!res.ok) throw new Error(await parseErrorMessage(res));
		const data = (await res.json()) as ReferensiSakuData;
		try { localStorage.setItem(REFERENSI_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* penyimpanan penuh/diblokir: abaikan */ }
		return { data, dariCache: false };
	} catch (e) {
		if (cached) return { data: cached.data, dariCache: true };
		throw e;
	}
}

// ── Kartu Troubleshoot Quick Reference (Buku Saku). Salinan lokal 24 jam; saat offline memakai salinan terakhir berapa pun umurnya. ──
export interface KartuTroubleshoot { id: string; judul: string; alat: string; gejala: string; keselamatan: string; langkah: string[]; programId: number | null }
const TROUBLESHOOT_KEY = 'epi_troubleshoot_v1';
export async function getKartuTroubleshoot(): Promise<{ cards: KartuTroubleshoot[]; dariCache: boolean }> {
	let cached: { at: number; cards: KartuTroubleshoot[] } | null = null;
	try {
		const raw = localStorage.getItem(TROUBLESHOOT_KEY);
		cached = raw ? JSON.parse(raw) : null;
	} catch { cached = null; }
	if (cached && Date.now() - cached.at < REFERENSI_TTL_MS) return { cards: cached.cards, dariCache: true };
	try {
		const res = await authedFetch('/api/ess/training/troubleshoot');
		if (!res.ok) throw new Error(await parseErrorMessage(res));
		const cards = ((await res.json()) as { cards: KartuTroubleshoot[] }).cards || [];
		try { localStorage.setItem(TROUBLESHOOT_KEY, JSON.stringify({ at: Date.now(), cards })); } catch { /* penyimpanan penuh/diblokir: abaikan */ }
		return { cards, dariCache: false };
	} catch (e) {
		if (cached) return { cards: cached.cards, dariCache: true };
		throw e;
	}
}

// --- Kartu Sertifikat Digital (dompet sertifikat di HP) ---
export interface KartuSertifikatClient {
	enrollmentId: number;
	programId: number;
	judul: string;
	kode: string | null;
	sertifikatNo: string;
	nilaiAkhir: number | null;
	expired: string | null;
	status: 'aktif' | 'segera_habis' | 'kedaluwarsa' | 'tanpa_batas';
	sisaHari: number | null;
	verifyUrl: string | null;
}
export interface SertifikatSayaData {
	kartu: KartuSertifikatClient[];
	ringkasan: { total: number; aktif: number; segeraHabis: number; kedaluwarsa: number };
	warnDays: number;
}

const SERTIFIKAT_KEY = 'epi_sertifikat_saya_v1';

/** Ambil sertifikat saya. Gagal karena offline → pakai salinan terakhir (QR dibuat di HP, jadi tetap bisa ditunjukkan). */
export async function getSertifikatSaya(): Promise<{ data: SertifikatSayaData; dariCache: boolean; cachedAt: string | null }> {
	try {
		const res = await authedFetch('/api/ess/training/sertifikat-saya');
		if (!res.ok) throw new Error(await parseErrorMessage(res));
		const data = (await res.json()) as SertifikatSayaData;
		try { localStorage.setItem(SERTIFIKAT_KEY, JSON.stringify({ at: new Date().toISOString(), data })); } catch { /* penyimpanan penuh/diblokir: abaikan */ }
		return { data, dariCache: false, cachedAt: null };
	} catch (err: any) {
		const offline = err instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
		if (offline) {
			try {
				const raw = localStorage.getItem(SERTIFIKAT_KEY);
				const c = raw ? JSON.parse(raw) : null;
				if (c?.data?.kartu) return { data: c.data as SertifikatSayaData, dariCache: true, cachedAt: String(c.at) };
			} catch { /* salinan rusak: lanjut error */ }
		}
		throw err;
	}
}
