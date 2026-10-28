// EPI Academy Fase 5 — celah LMS: (1) kuis akhir tidak boleh diulang/menurunkan 'Lulus',
// (2) modul Teks butuh waktu baca minimum. Directus di-mock; yang diuji adalah urutan tulis ke Directus.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockJson = vi.fn();
vi.mock('$lib/server/directus', () => ({
	directusServerJson: (...a: unknown[]) => mockJson(...a),
	directusServerUpload: vi.fn()
}));
const issueCertificate = vi.fn().mockResolvedValue({ sertifikat_no: 'TRN/TEST/0001', sertifikat_expired: null });
vi.mock('$lib/server/ess/trainingCertificate', () => ({ issueCertificate: (...a: unknown[]) => issueCertificate(...a) }));
const deriveSkillsFromEnrollment = vi.fn().mockResolvedValue(undefined);
vi.mock('$lib/server/ess/trainingSkill', () => ({ deriveSkillsFromEnrollment: (...a: unknown[]) => deriveSkillsFromEnrollment(...a) }));

const {
	QuizRetakeBlockedError,
	submitQuizAttemptSafe,
	upsertModuleProgress,
	recomputeEnrollmentProgress,
	clearReadGateSettingsCache
} = await import('./training');

type Call = { url: string; method: string; body: any };
let calls: Call[] = [];
/** Baris Directus yang dikembalikan — di-set per tes. */
let db: {
	enrollment: any;
	questions: any[];
	progress: any | null;
	modules: any[];
	allProgress: any[];
	finalQuiz: any | null;
	settings: any[];
};

function resetDb() {
	db = {
		enrollment: { id: 1, program_id: 9, karyawan_id: 5, status: 'Ongoing', progress_persen: 100, nilai_akhir: null, sertifikat_no: null },
		questions: [
			{ id: 1, quiz_id: 100, pertanyaan: 'a', tipe: 'pilihan_ganda', opsi: ['x', 'y'], bobot: 1, jawaban_benar: 'x' },
			{ id: 2, quiz_id: 100, pertanyaan: 'b', tipe: 'pilihan_ganda', opsi: ['x', 'y'], bobot: 1, jawaban_benar: 'x' }
		],
		progress: null,
		modules: [{ id: 50, program_id: 9, tipe_konten: 'Teks', durasi_menit: 4, min_persen_tonton: 90 }],
		allProgress: [],
		finalQuiz: { id: 100, program_id: 9, module_id: null },
		settings: []
	};
}

beforeEach(() => {
	calls = [];
	resetDb();
	clearReadGateSettingsCache();
	issueCertificate.mockClear();
	mockJson.mockReset();
	mockJson.mockImplementation((rawUrl: string, init?: { method?: string; body?: string }) => {
		const url = decodeURIComponent(rawUrl);
		const method = init?.method || 'GET';
		const body = init?.body ? JSON.parse(init.body) : null;
		calls.push({ url, method, body });
		if (method !== 'GET') return Promise.resolve({ data: { id: 777, ...(body || {}) } });
		if (url.includes('/items/training_quiz_question')) return Promise.resolve({ data: db.questions });
		if (url.includes('/items/training_enrollment/')) return Promise.resolve({ data: db.enrollment });
		if (url.includes('/items/training_program/')) return Promise.resolve({ data: { id: 9, judul: 'Prog', passing_score: 70 } });
		if (url.includes('/items/karyawan/')) return Promise.resolve({ data: { nama_karyawan: 'Budi' } });
		if (url.includes('/items/app_settings')) return Promise.resolve({ data: db.settings });
		if (url.includes('/items/training_module')) return Promise.resolve({ data: db.modules });
		if (url.includes('/items/training_quiz?')) return Promise.resolve({ data: db.finalQuiz ? [db.finalQuiz] : [] });
		if (url.includes('/items/training_progress')) {
			// findProgressRow (limit=1 + filter module) vs listProgressByEnrollment
			return Promise.resolve({ data: url.includes('filter[module_id]') ? (db.progress ? [db.progress] : []) : db.allProgress });
		}
		return Promise.resolve({ data: [] });
	});
});

const writes = () => calls.filter((c) => c.method !== 'GET');
const enrollmentWrites = () => writes().filter((c) => c.url.includes('/items/training_enrollment/'));
const finalQuiz = { id: 100, program_id: 9, module_id: null, judul: 'Ujian Akhir', passing_score: 70, acak_soal: false };
const formatif = { ...finalQuiz, id: 101, module_id: 50, judul: 'Kuis Modul' };
const semuaBenar = [{ question_id: 1, jawaban: 'x' }, { question_id: 2, jawaban: 'x' }];
const semuaSalah = [{ question_id: 1, jawaban: 'y' }, { question_id: 2, jawaban: 'y' }];

describe('Celah 1 — kuis akhir pada enrollment Lulus', () => {
	it('ditolak (QuizRetakeBlockedError, 409) tanpa menulis apa pun ke Directus', async () => {
		db.enrollment = { ...db.enrollment, status: 'Lulus', nilai_akhir: 90, sertifikat_no: 'TRN/1' };
		const enr = { ...db.enrollment };
		await expect(submitQuizAttemptSafe(enr, finalQuiz, semuaSalah)).rejects.toBeInstanceOf(QuizRetakeBlockedError);
		await expect(submitQuizAttemptSafe(enr, finalQuiz, semuaSalah)).rejects.toMatchObject({ status: 409 });
		expect(writes()).toHaveLength(0);
	});

	it('status dibaca ulang dari Directus: objek enrollment basi (Ongoing) tapi DB sudah Lulus → tetap ditolak', async () => {
		db.enrollment = { ...db.enrollment, status: 'Lulus', nilai_akhir: 90 };
		const basi = { ...db.enrollment, status: 'Ongoing' };
		await expect(submitQuizAttemptSafe(basi, finalQuiz, semuaSalah)).rejects.toBeInstanceOf(QuizRetakeBlockedError);
		expect(writes()).toHaveLength(0);
	});

	it('regresi: kuis akhir pertama yang gagal tetap → Remedial, lulus → Lulus + sertifikat', async () => {
		await submitQuizAttemptSafe({ ...db.enrollment }, finalQuiz, semuaSalah);
		let e = enrollmentWrites().at(-1)!;
		expect(e.body).toMatchObject({ nilai_akhir: 0, status: 'Remedial' });

		calls = [];
		db.enrollment = { ...db.enrollment, status: 'Remedial' };
		await submitQuizAttemptSafe({ ...db.enrollment }, finalQuiz, semuaBenar);
		e = enrollmentWrites()[0];
		expect(e.body).toMatchObject({ nilai_akhir: 100, status: 'Lulus' });
		expect(issueCertificate).toHaveBeenCalledTimes(1);
	});

	it('kuis formatif per modul tetap boleh diulang pada enrollment Lulus, tanpa menyentuh enrollment', async () => {
		db.enrollment = { ...db.enrollment, status: 'Lulus', nilai_akhir: 90, sertifikat_no: 'TRN/1' };
		const attempt = await submitQuizAttemptSafe({ ...db.enrollment }, formatif, semuaSalah);
		expect(attempt).toBeTruthy();
		expect(writes().map((w) => w.url)).toEqual(['/items/training_quiz_attempt']);
		expect(enrollmentWrites()).toHaveLength(0);
	});
});

describe('Celah 1b — progres modul tidak menurunkan Lulus', () => {
	it('recompute pada enrollment Lulus (ada kuis akhir) mempertahankan status Lulus', async () => {
		db.modules = [{ id: 50, program_id: 9, tipe_konten: 'Teks', durasi_menit: 4 }, { id: 51, program_id: 9, tipe_konten: 'Teks', durasi_menit: 4 }];
		db.allProgress = [{ id: 1, enrollment_id: 1, module_id: 50, status: 'Selesai' }]; // 51 belum
		await recomputeEnrollmentProgress(1, 9, 'Lulus');
		expect(enrollmentWrites()[0].body.status).toBe('Lulus');
		expect(issueCertificate).not.toHaveBeenCalled(); // bukan jalur kuis → tidak menerbitkan ulang
	});

	it('enrollment non-Lulus tetap mengikuti hitungan (Ongoing)', async () => {
		db.allProgress = [];
		db.modules = [{ id: 50, program_id: 9 }, { id: 51, program_id: 9 }];
		db.allProgress = [{ id: 1, enrollment_id: 1, module_id: 50, status: 'Selesai' }];
		await recomputeEnrollmentProgress(1, 9, 'Enrolled');
		expect(enrollmentWrites()[0].body).toMatchObject({ status: 'Ongoing', progress_persen: 50 });
	});
});

describe('Celah 2 — waktu baca minimum modul Teks', () => {
	const enr = () => ({ ...db.enrollment, status: 'Ongoing' });
	const mod = () => db.modules[0];
	const kirim = (detik: number, persen = 100) =>
		upsertModuleProgress(enr(), mod(), { persenDitonton: persen, detikDitonton: detik, durasiVideo: null, segmenDitonton: [], lastPosition: 0 });

	it('selesai seketika ditolak; waktu baca tetap disimpan; pesan memuat sisa waktu', async () => {
		// durasi 4 menit → default 50% = 120 detik; baru 30 detik → sisa 1:30
		await expect(kirim(30)).rejects.toThrow(/1:30/);
		const w = writes().find((c) => c.url.startsWith('/items/training_progress'))!;
		expect(w.body).toMatchObject({ status: 'Sedang', detik_ditonton: 30, persen_ditonton: 0 });
		expect(enrollmentWrites()).toHaveLength(0); // tidak ada recompute
	});

	it('selesai bila waktu baca cukup; progres Selesai + recompute', async () => {
		const saved = await kirim(120);
		const w = writes().find((c) => c.url.startsWith('/items/training_progress'))!;
		expect(w.body).toMatchObject({ status: 'Selesai', detik_ditonton: 120 });
		expect(saved).toBeTruthy();
		expect(enrollmentWrites()).toHaveLength(1);
	});

	it('waktu baca kumulatif lintas sesi: klien kirim total 125 (100 tersimpan + 25 sesi ini) = cukup', async () => {
		db.progress = { id: 9, enrollment_id: 1, module_id: 50, status: 'Sedang', detik_ditonton: 100, persen_ditonton: 0, waktu_selesai: null };
		await kirim(125);
		expect(writes().find((c) => c.url.startsWith('/items/training_progress'))!.body.status).toBe('Selesai');
	});

	it('waktu baca tersimpan tidak bisa turun: kiriman lebih kecil dari yang tersimpan tidak mengurangi', async () => {
		db.progress = { id: 9, enrollment_id: 1, module_id: 50, status: 'Sedang', detik_ditonton: 100, persen_ditonton: 0, waktu_selesai: null };
		await expect(kirim(25)).rejects.toThrow(/0:20/); // sisa dihitung dari 100 tersimpan
		expect(writes().find((c) => c.url.startsWith('/items/training_progress'))!.body.detik_ditonton).toBe(100);
	});

	it('klien tak bisa memperbesar durasi: durasiVideo kiriman klien diabaikan untuk Teks', async () => {
		await expect(
			upsertModuleProgress(enr(), mod(), { persenDitonton: 100, detikDitonton: 1, durasiVideo: 1, segmenDitonton: [], lastPosition: 0 })
		).rejects.toThrow(/Baca materi dulu/);
		expect(writes().find((c) => c.url.startsWith('/items/training_progress'))!.body.durasi_video).toBe(240);
	});

	it('kelebihan waktu baca (tab dibiarkan terbuka) dipotong, bukan ditolak', async () => {
		await kirim(99999);
		expect(writes().find((c) => c.url.startsWith('/items/training_progress'))!.body).toMatchObject({ status: 'Selesai', detik_ditonton: 255 }); // ceil(240*1.05+3)
	});

	it('modul lama tanpa durasi_menit: tetap bisa ditandai selesai seketika', async () => {
		db.modules[0] = { ...db.modules[0], durasi_menit: null };
		await kirim(0);
		expect(writes().find((c) => c.url.startsWith('/items/training_progress'))!.body.status).toBe('Selesai');
	});

	it('modul yang sudah Selesai tidak terkunci mendadak & tidak turun saat dibuka ulang', async () => {
		db.progress = { id: 9, enrollment_id: 1, module_id: 50, status: 'Selesai', detik_ditonton: 0, persen_ditonton: 100, waktu_selesai: '2026-10-01T00:00:00.000Z' };
		await kirim(0, 0);
		const body = writes().find((c) => c.url.startsWith('/items/training_progress'))!.body;
		expect(body).toMatchObject({ status: 'Selesai', persen_ditonton: 100, waktu_selesai: '2026-10-01T00:00:00.000Z' });
	});

	it('ambang diatur lewat app_settings training_lms (persen 100 → 240 detik; maks 600)', async () => {
		db.settings = [
			{ setting_key: 'baca_min_persen', setting_value: '100' },
			{ setting_key: 'baca_min_detik_maks', setting_value: '600' }
		];
		await expect(kirim(200)).rejects.toThrow(/0:40/);
		clearReadGateSettingsCache();
		await expect(kirim(240)).resolves.toBeTruthy();
	});

	it('saklar baca_min_aktif=false mengembalikan perilaku lama', async () => {
		db.settings = [{ setting_key: 'baca_min_aktif', setting_value: 'false' }];
		await kirim(0);
		expect(writes().find((c) => c.url.startsWith('/items/training_progress'))!.body.status).toBe('Selesai');
	});

	it('gagal baca setelan → default + log error (tidak ditelan diam-diam)', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const asli = mockJson.getMockImplementation()!;
		mockJson.mockImplementation((url: string, init?: any) => (String(url).includes('app_settings') ? Promise.reject(new Error('403')) : asli(url, init)));
		await expect(kirim(10)).rejects.toThrow(/Baca materi dulu/); // default tetap aktif
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});

	it('PDF dan Link ikut dikunci oleh waktu baca (durasi 4 menit → 120 detik)', async () => {
		for (const tipe of ['PDF', 'Link']) {
			calls = [];
			db.modules[0] = { id: 50, program_id: 9, tipe_konten: tipe, durasi_menit: 4, min_persen_tonton: 90 };
			await expect(kirim(10)).rejects.toThrow(/Baca materi dulu/);
			await expect(kirim(120)).resolves.toBeTruthy();
		}
	});

	it('Video terlacak (manual tak diset) TIDAK dikenai waktu baca; Video manual dikenai', async () => {
		db.modules[0] = { id: 50, program_id: 9, tipe_konten: 'Video', durasi_menit: 10, min_persen_tonton: 90 };
		const base = { persenDitonton: 100, detikDitonton: 580, durasiVideo: 600, segmenDitonton: [[0, 580]], lastPosition: 580 };
		await expect(upsertModuleProgress(enr(), db.modules[0], base)).resolves.toBeTruthy(); // terlacak
		calls = [];
		// manual: 5 detik saja → ditolak; 300 detik (50% dari 600) → lolos
		await expect(upsertModuleProgress(enr(), db.modules[0], { ...base, detikDitonton: 5, manual: true })).rejects.toThrow(/Tonton video dulu|Baca materi dulu/);
		await expect(upsertModuleProgress(enr(), db.modules[0], { ...base, detikDitonton: 300, manual: true })).resolves.toBeTruthy();
	});

	it('Video manual: kelebihan detik dipotong (tidak melempar "tidak wajar")', async () => {
		db.modules[0] = { id: 50, program_id: 9, tipe_konten: 'Video', durasi_menit: 10, min_persen_tonton: 90 };
		await expect(
			upsertModuleProgress(enr(), db.modules[0], { persenDitonton: 100, detikDitonton: 99999, durasiVideo: 600, segmenDitonton: [], lastPosition: 0, manual: true })
		).resolves.toBeTruthy();
	});

	it('jenis konten dipilih lewat baca_min_tipe: PDF tidak dikunci bila hanya Teks yang dipilih', async () => {
		db.settings = [{ setting_key: 'baca_min_tipe', setting_value: '["Teks"]' }];
		db.modules[0] = { id: 50, program_id: 9, tipe_konten: 'PDF', durasi_menit: 4, min_persen_tonton: 90 };
		await expect(kirim(0)).resolves.toBeTruthy();
	});

	it('regresi Video: aturan durasi lama tetap (tolak detik tak wajar, selesai di ambang)', async () => {
		db.modules[0] = { id: 50, program_id: 9, tipe_konten: 'Video', durasi_menit: 10, min_persen_tonton: 90 };
		await expect(
			upsertModuleProgress(enr(), db.modules[0], { persenDitonton: 100, detikDitonton: 5000, durasiVideo: 600, segmenDitonton: [], lastPosition: 0 })
		).rejects.toThrow(/tidak wajar/);
		await upsertModuleProgress(enr(), db.modules[0], { persenDitonton: 95, detikDitonton: 570, durasiVideo: 600, segmenDitonton: [[0, 570]], lastPosition: 570 });
		expect(writes().find((c) => c.url.startsWith('/items/training_progress'))!.body.status).toBe('Selesai');
	});
});
