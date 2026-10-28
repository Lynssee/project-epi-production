// src/lib/server/ess/training.ts
// Query helper server-side untuk /api/ess/training/* — modul E-Learning lapangan (reuse LMS HRD).
// Satu sumber kebenaran: koleksi training_* Directus yang sama dipakai admin & lapangan.
// Konvensi wajib: sertakan `.id` eksplisit pada subfield relasi bersarang (lihat CLAUDE nested-field gotcha)
// agar respons Directus yang di-expand tidak dianggap objek penuh saat menulis ulang.

import { directusServerJson } from '$lib/server/directus';
import {
	READ_GATE_DEFAULTS,
	PESAN_KUIS_AKHIR_SUDAH_LULUS,
	computeMinReadSeconds,
	formatCountdown,
	isFinalQuizRetakeBlocked,
	parseReadGateSettings,
	remainingReadSeconds,
	resolveEnrollmentStatusAfterRecompute,
	usesReadTime,
	type ReadGateSettings
} from '$lib/utils/trainingGuards';

/** Dilempar saat kuis akhir dikerjakan ulang padahal enrollment sudah Lulus (route → HTTP 409). */
export class QuizRetakeBlockedError extends Error {
	status = 409;
	constructor(message: string = PESAN_KUIS_AKHIR_SUDAH_LULUS) {
		super(message);
		this.name = 'QuizRetakeBlockedError';
	}
}

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
	karyawan_id: number;
	karyawan_nama: string;
	module_id: number;
	pesan: string;
	parent_id: number | null;
	pinned: boolean;
	dilaporkan: boolean;
	date_created: string;
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

export interface TrainingQuizRecord {
	id: number;
	program_id: number;
	module_id: number | null;
	judul: string;
	passing_score: number | null;
	acak_soal: boolean;
}

export interface TrainingQuizQuestionRecord {
	id: number;
	quiz_id: number;
	pertanyaan: string;
	tipe: string;
	opsi: string[] | null;
	bobot: number | null;
}

export interface TrainingQuizAttemptRecord {
	id: number;
	enrollment_id: number;
	quiz_id: number;
	skor: number | null;
	lulus: boolean | null;
	jawaban: Array<{ question_id: number; jawaban: string; benar: boolean | null }>;
	waktu_mulai: string;
	waktu_selesai: string | null;
}

const PROGRAM_FIELDS = [
	'id', 'kode', 'judul', 'kategori', 'tipe', 'level', 'durasi_menit', 'deskripsi', 'thumbnail',
	'passing_score', 'wajib', 'tenggat_hari', 'self_enroll', 'department_target', 'masa_berlaku_bulan', 'status',
	'is_onboarding', 'urutan_tampil'
].join(',');

const MODULE_FIELDS = [
	'id', 'program_id', 'judul', 'urutan', 'tipe_konten', 'konten_url', 'konten_teks',
	'durasi_menit', 'min_persen_tonton', 'youtube_id', 'chapters', 'transkrip'
].join(',');

const NOTE_FIELDS = ['id', 'karyawan_id', 'module_id', 'detik', 'catatan', 'date_created'].join(',');

const DISKUSI_FIELDS = [
	'id', 'karyawan_id.id', 'karyawan_id.nama_karyawan', 'module_id', 'pesan', 'parent_id', 'pinned', 'dilaporkan', 'date_created'
].join(',');

const ENROLLMENT_FIELDS = [
	'id', 'program_id', 'karyawan_id', 'tanggal_daftar', 'progress_persen', 'status',
	'nilai_teori', 'nilai_praktik', 'nilai_akhir', 'sertifikat_no', 'sertifikat_file',
	'sertifikat_expired', 'sumber_daftar', 'tenggat'
].join(',');

const PROGRESS_FIELDS = [
	'id', 'enrollment_id', 'module_id', 'status', 'progress_persen', 'last_position',
	'persen_ditonton', 'detik_ditonton', 'durasi_video', 'segmen_ditonton', 'waktu_selesai'
].join(',');

const QUIZ_FIELDS = ['id', 'program_id', 'module_id', 'judul', 'passing_score', 'acak_soal'].join(',');

/** TIDAK PERNAH sertakan jawaban_benar di sini — kuis dikirim ke klien tanpa kunci jawaban. */
const QUESTION_FIELDS_SAFE = ['id', 'quiz_id', 'pertanyaan', 'tipe', 'opsi', 'bobot'].join(',');
const QUESTION_FIELDS_FULL = [...QUESTION_FIELDS_SAFE.split(','), 'jawaban_benar'].join(',');

function unwrapId(value: any): number | null {
	if (value == null) return null;
	return typeof value === 'object' ? (value.id ?? null) : value;
}

/**
 * Katalog kursus published yang relevan untuk divisi karyawan (kosong = semua divisi).
 *
 * Fase 4.2: filter utama sekarang relasi sebenarnya divisi_target (M2M ke hrd_divisi) via
 * divisiId, bukan lagi pencocokan substring department_target (_icontains) yang rawan
 * meleset — lihat audit "IT"/"IT & MEDIA"/"GENERAL MANAGER, IT" di dokumen perencanaan.
 * Untuk program yang BELUM diberi divisi_target (daftar kosong), atau karyawan yang
 * divisi_id-nya belum terpetakan (data lama ambigu, lihat scripts/lms-fase4-divisi-schema.mjs),
 * fallback ke department_target lama supaya tidak ada regresi akses katalog.
 */
export async function listCatalogForKaryawan(divisi: string | null, divisiId: number | null = null): Promise<TrainingProgramRecord[]> {
	const query = new URLSearchParams({
		fields: `${PROGRAM_FIELDS},divisi_target.divisi_id`,
		'filter[status][_eq]': 'published',
		sort: 'judul',
		limit: '200'
	});
	const result = await directusServerJson<{ data: any[] }>(`/items/training_program?${query.toString()}`);
	const rows = result?.data || [];

	return rows
		.filter((p) => {
			const targets: number[] = (p.divisi_target || []).map((t: any) => unwrapId(t.divisi_id)).filter((id: number | null): id is number => id != null);
			if (targets.length > 0) {
				return divisiId != null && targets.includes(divisiId);
			}
			if (!p.department_target) return true;
			if (!divisi) return false;
			return p.department_target.toLowerCase().includes(divisi.toLowerCase());
		})
		.map(({ divisi_target, ...program }) => program as TrainingProgramRecord);
}

export async function findProgramById(programId: number): Promise<TrainingProgramRecord | null> {
	try {
		const result = await directusServerJson<{ data: TrainingProgramRecord }>(`/items/training_program/${programId}?fields=${PROGRAM_FIELDS}`);
		return result?.data || null;
	} catch {
		return null;
	}
}

export async function listModulesByProgram(programId: number): Promise<TrainingModuleRecord[]> {
	const query = new URLSearchParams({
		'filter[program_id][_eq]': String(programId),
		fields: MODULE_FIELDS,
		sort: 'urutan'
	});
	const result = await directusServerJson<{ data: TrainingModuleRecord[] }>(`/items/training_module?${query.toString()}`);
	return result?.data || [];
}

export async function findModuleById(moduleId: number): Promise<TrainingModuleRecord | null> {
	try {
		const result = await directusServerJson<{ data: TrainingModuleRecord }>(`/items/training_module/${moduleId}?fields=${MODULE_FIELDS}`);
		return result?.data || null;
	} catch {
		return null;
	}
}

export async function listMyEnrollments(karyawanId: number): Promise<TrainingEnrollmentRecord[]> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		fields: ENROLLMENT_FIELDS,
		sort: '-tanggal_daftar',
		limit: '200'
	});
	const result = await directusServerJson<{ data: TrainingEnrollmentRecord[] }>(`/items/training_enrollment?${query.toString()}`);
	return (result?.data || []).map((e) => ({ ...e, program_id: unwrapId(e.program_id) as number, karyawan_id: unwrapId(e.karyawan_id) as number }));
}

/** Cari enrollment milik karyawan tertentu untuk satu program — dipakai untuk cek kepemilikan. */
export async function findMyEnrollmentForProgram(karyawanId: number, programId: number): Promise<TrainingEnrollmentRecord | null> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		'filter[program_id][_eq]': String(programId),
		fields: ENROLLMENT_FIELDS,
		limit: '1'
	});
	const result = await directusServerJson<{ data: TrainingEnrollmentRecord[] }>(`/items/training_enrollment?${query.toString()}`);
	const row = result?.data?.[0];
	if (!row) return null;
	return { ...row, program_id: unwrapId(row.program_id) as number, karyawan_id: unwrapId(row.karyawan_id) as number };
}

export async function findEnrollmentById(enrollmentId: number): Promise<TrainingEnrollmentRecord | null> {
	try {
		const result = await directusServerJson<{ data: TrainingEnrollmentRecord }>(`/items/training_enrollment/${enrollmentId}?fields=${ENROLLMENT_FIELDS}`);
		const row = result?.data;
		if (!row) return null;
		return { ...row, program_id: unwrapId(row.program_id) as number, karyawan_id: unwrapId(row.karyawan_id) as number };
	} catch {
		return null;
	}
}

export async function listProgressByEnrollment(enrollmentId: number): Promise<TrainingProgressRecord[]> {
	const query = new URLSearchParams({
		'filter[enrollment_id][_eq]': String(enrollmentId),
		fields: PROGRESS_FIELDS,
		limit: '200'
	});
	const result = await directusServerJson<{ data: TrainingProgressRecord[] }>(`/items/training_progress?${query.toString()}`);
	return (result?.data || []).map((p) => ({ ...p, enrollment_id: unwrapId(p.enrollment_id) as number, module_id: unwrapId(p.module_id) as number }));
}

export async function findProgressRow(enrollmentId: number, moduleId: number): Promise<TrainingProgressRecord | null> {
	const query = new URLSearchParams({
		'filter[enrollment_id][_eq]': String(enrollmentId),
		'filter[module_id][_eq]': String(moduleId),
		fields: PROGRESS_FIELDS,
		limit: '1'
	});
	const result = await directusServerJson<{ data: TrainingProgressRecord[] }>(`/items/training_progress?${query.toString()}`);
	const row = result?.data?.[0];
	if (!row) return null;
	return { ...row, enrollment_id: unwrapId(row.enrollment_id) as number, module_id: unwrapId(row.module_id) as number };
}

/**
 * Self-enroll (F0/F1): hanya diizinkan untuk kursus self_enroll=true DAN wajib=false
 * (keputusan user: self-enroll dibatasi ke kursus opsional; kursus wajib hanya via auto-assign/HRD).
 */
export async function enrollSelf(karyawanId: number, program: TrainingProgramRecord): Promise<TrainingEnrollmentRecord> {
	if (program.wajib) {
		throw new Error('Kursus wajib hanya bisa didaftarkan oleh HRD/otomasi, bukan mandiri.');
	}
	if (!program.self_enroll) {
		throw new Error('Kursus ini tidak mengizinkan pendaftaran mandiri.');
	}
	const existing = await findMyEnrollmentForProgram(karyawanId, program.id);
	if (existing) {
		throw new Error('Anda sudah terdaftar di kursus ini.');
	}

	const now = new Date();
	const tenggat = program.tenggat_hari
		? new Date(now.getTime() + program.tenggat_hari * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
		: null;

	const payload = {
		program_id: program.id,
		karyawan_id: karyawanId,
		tanggal_daftar: now.toISOString().slice(0, 10),
		progress_persen: 0,
		status: 'Enrolled',
		sumber_daftar: 'mandiri',
		tenggat
	};
	const result = await directusServerJson<{ data: TrainingEnrollmentRecord }>('/items/training_enrollment', {
		method: 'POST',
		body: JSON.stringify(payload)
	});
	return result?.data as TrainingEnrollmentRecord;
}

/**
 * Auto-enroll JIT (Fase 1.1, Lapis 1): dipanggil HANYA dari sisi server, bukan dari enrollSelf,
 * saat karyawan membuka program is_onboarding/wajib tanpa enrollment. Nol waktu tunggu — tak
 * bergantung pada sapuan n8n. enrollSelf() TETAP menolak kursus wajib agar karyawan tidak bisa
 * mendaftar sendiri ke kursus bersertifikat lewat jalur itu.
 */
export async function autoEnrollWajib(karyawanId: number, program: TrainingProgramRecord): Promise<TrainingEnrollmentRecord> {
	const existing = await findMyEnrollmentForProgram(karyawanId, program.id);
	if (existing) return existing;

	const now = new Date();
	const tenggat = program.tenggat_hari
		? new Date(now.getTime() + program.tenggat_hari * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
		: null;

	const payload = {
		program_id: program.id,
		karyawan_id: karyawanId,
		tanggal_daftar: now.toISOString().slice(0, 10),
		progress_persen: 0,
		status: 'Enrolled',
		sumber_daftar: 'otomatis',
		tenggat
	};
	const result = await directusServerJson<{ data: TrainingEnrollmentRecord }>('/items/training_enrollment', {
		method: 'POST',
		body: JSON.stringify(payload)
	});
	return result?.data as TrainingEnrollmentRecord;
}

/** Program onboarding yang berlaku untuk semua karyawan (department_target kosong = semua divisi). */
export async function listOnboardingPrograms(): Promise<TrainingProgramRecord[]> {
	const query = new URLSearchParams({
		fields: PROGRAM_FIELDS,
		'filter[status][_eq]': 'published',
		'filter[is_onboarding][_eq]': 'true',
		sort: 'urutan_tampil'
	});
	const result = await directusServerJson<{ data: TrainingProgramRecord[] }>(`/items/training_program?${query.toString()}`);
	return result?.data || [];
}

const READ_GATE_CACHE_TTL_MS = 300_000;
let _readGateCache: { at: number; value: ReadGateSettings } | null = null;

/**
 * Setelan waktu baca minimum modul Teks — app_settings module='training_lms'
 * (baca_min_aktif, baca_min_persen, baca_min_detik_maks), diatur admin lewat UI /settings/training_lms.
 * Default ada di kode; cache 5 menit. Gagal baca → default + log (tidak ditelan diam-diam).
 */
export async function getReadGateSettings(): Promise<ReadGateSettings> {
	if (_readGateCache && Date.now() - _readGateCache.at < READ_GATE_CACHE_TTL_MS) return _readGateCache.value;
	let value: ReadGateSettings = { ...READ_GATE_DEFAULTS, tipe: [...READ_GATE_DEFAULTS.tipe] };
	try {
		const res = await directusServerJson<{ data: Array<{ setting_key: string; setting_value: unknown }> }>(
			'/items/app_settings?filter[module][_eq]=training_lms&fields=setting_key,setting_value&limit=-1'
		);
		value = parseReadGateSettings(res?.data || []);
	} catch (err) {
		console.error('[training] gagal baca app_settings module=training_lms, pakai default:', err);
	}
	_readGateCache = { at: Date.now(), value };
	return value;
}

/** Untuk test / setelah admin mengubah setelan. */
export function clearReadGateSettingsCache(): void {
	_readGateCache = null;
}

/**
 * Simpan progress tonton (F2, throttled dari player). Anti-curang ringan: tolak detik_ditonton
 * yang melebihi durasi_video (toleransi 5%). Kunci "Selesai" hanya bila persen >= min_persen_tonton modul.
 *
 * Modul Teks/PDF/Link (dan Video yang ditandai manual): tambahan gerbang waktu baca minimum
 * (computeMinReadSeconds) — tidak bisa ditandai selesai sebelum waktu baca kumulatif cukup.
 * Status 'Selesai' bersifat lengket (tidak turun saat modul dibuka ulang).
 */
export async function upsertModuleProgress(
	enrollment: TrainingEnrollmentRecord,
	mod: TrainingModuleRecord,
	data: {
		persenDitonton: number;
		detikDitonton: number;
		durasiVideo: number | null;
		segmenDitonton: number[][];
		lastPosition: number;
		/** Video saja: selesai ditandai manual (pemutar tak terlacak) → dilacak lewat waktu baca. */
		manual?: boolean;
	}
): Promise<TrainingProgressRecord> {
	const isBaca = usesReadTime(mod.tipe_konten, !!data.manual);
	const isVideoManual = isBaca && mod.tipe_konten === 'Video';
	// Teks/PDF/Link: durasi acuan HANYA dari modul (klien tak boleh menentukan). Kelebihan waktu baca
	// (tab dibiarkan terbuka) dipotong, bukan ditolak, supaya penyelesaian tidak gagal diam-diam.
	const durasiModul = mod.durasi_menit ? mod.durasi_menit * 60 : null;
	const durasiVideo = isBaca && !isVideoManual ? durasiModul : (data.durasiVideo ?? durasiModul);
	if (!isBaca && durasiVideo && data.detikDitonton > durasiVideo * 1.05 + 3) {
		throw new Error('Data tonton tidak wajar terhadap durasi video.');
	}
	const detikBaru = Math.max(0, Math.round(data.detikDitonton));
	const detikLaporan = isBaca && durasiVideo ? Math.min(detikBaru, Math.ceil(durasiVideo * 1.05 + 3)) : detikBaru;

	const persenDitonton = Math.max(0, Math.min(100, Math.round(data.persenDitonton)));
	const ambang = mod.min_persen_tonton ?? 90;

	const existing = await findProgressRow(enrollment.id, mod.id);
	const sudahSelesai = existing?.status === 'Selesai';
	const selesai = sudahSelesai || persenDitonton >= ambang;
	// Mode baca: waktu kumulatif (naik saja, lintas sesi) — dasar gerbang waktu baca minimum.
	const detikDitonton = isBaca ? Math.max(existing?.detik_ditonton ?? 0, detikLaporan) : detikLaporan;

	// Modul mode baca yang belum selesai & baru mau ditandai selesai → cek waktu baca. Bila kurang,
	// simpan waktu baca yang terkumpul (status tetap Sedang/Belum) lalu tolak dengan pesan hitung-mundur.
	const tolakSelesai =
		isBaca && selesai && !sudahSelesai
			? remainingReadSeconds(computeMinReadSeconds(mod, await getReadGateSettings(), { manual: !!data.manual }), detikDitonton)
			: 0;
	const selesaiEfektif = selesai && tolakSelesai === 0;

	const persenSimpan = tolakSelesai > 0 ? 0 : sudahSelesai ? Math.max(persenDitonton, existing?.persen_ditonton ?? 0) : persenDitonton;
	const payload = {
		enrollment_id: enrollment.id,
		module_id: mod.id,
		status: selesaiEfektif ? 'Selesai' : persenSimpan > 0 || (isBaca && detikDitonton > 0) ? 'Sedang' : 'Belum',
		progress_persen: persenSimpan,
		persen_ditonton: persenSimpan,
		detik_ditonton: detikDitonton,
		durasi_video: durasiVideo,
		segmen_ditonton: data.segmenDitonton,
		last_position: String(Math.round(data.lastPosition)),
		waktu_selesai: selesaiEfektif && !existing?.waktu_selesai ? new Date().toISOString() : (existing?.waktu_selesai ?? null)
	};

	let saved: TrainingProgressRecord;
	if (existing) {
		const result = await directusServerJson<{ data: TrainingProgressRecord }>(`/items/training_progress/${existing.id}`, {
			method: 'PATCH',
			body: JSON.stringify(payload)
		});
		saved = result?.data as TrainingProgressRecord;
	} else {
		const result = await directusServerJson<{ data: TrainingProgressRecord }>('/items/training_progress', {
			method: 'POST',
			body: JSON.stringify(payload)
		});
		saved = result?.data as TrainingProgressRecord;
	}

	if (tolakSelesai > 0) {
		throw new Error(`Baca materi dulu — modul bisa ditandai selesai ${formatCountdown(tolakSelesai)} lagi.`);
	}

	await recomputeEnrollmentProgress(enrollment.id, enrollment.program_id, enrollment.status);
	return saved;
}

/**
 * Hitung ulang progress_persen & status enrollment dari rata-rata status modul.
 * Bila program punya kuis akhir, "Lulus" HANYA ditentukan oleh submitQuizAttemptSafe (bukan di sini) —
 * modul selesai tanpa kuis akhir tetap 'Ongoing' sampai kuis dikerjakan & lulus.
 */
export async function recomputeEnrollmentProgress(enrollmentId: number, programId: number, statusDiketahui?: string | null): Promise<void> {
	const [modules, progress, finalQuiz] = await Promise.all([
		listModulesByProgram(programId),
		listProgressByEnrollment(enrollmentId),
		findFinalQuizForProgram(programId)
	]);
	if (modules.length === 0) return;

	const selesaiCount = modules.filter((m) => progress.find((p) => p.module_id === m.id)?.status === 'Selesai').length;
	const persen = Math.round((selesaiCount / modules.length) * 100);
	const semuaSelesai = selesaiCount === modules.length;
	const jadiLulus = semuaSelesai && !finalQuiz;

	// Enrollment yang sudah 'Lulus' tidak pernah diturunkan (mis. karyawan membuka ulang modul lama):
	// gate kompetensi di erp-epi membaca 'Lulus' + sertifikat dari baris ini.
	const statusSaatIni = statusDiketahui !== undefined ? statusDiketahui : (await findEnrollmentById(enrollmentId))?.status;
	const statusBaru = resolveEnrollmentStatusAfterRecompute(statusSaatIni, jadiLulus ? 'Lulus' : persen > 0 ? 'Ongoing' : 'Enrolled');

	await directusServerJson(`/items/training_enrollment/${enrollmentId}`, {
		method: 'PATCH',
		body: JSON.stringify({ progress_persen: persen, status: statusBaru })
	});

	if (jadiLulus && statusBaru === 'Lulus') {
		const program = await findProgramById(programId);
		const enrollment = await findEnrollmentById(enrollmentId);
		if (program && enrollment) await finalizeLulusEnrollment(enrollment, program);
	}
}

/**
 * Terbitkan sertifikat + derivasi skill saat enrollment resmi Lulus (idempotent — dicek sertifikat_no
 * kosong dulu supaya tidak terbit dobel bila fungsi ini terpanggil lebih dari sekali).
 */
export async function finalizeLulusEnrollment(enrollment: TrainingEnrollmentRecord, program: TrainingProgramRecord): Promise<void> {
	if (enrollment.sertifikat_no) return;

	const { issueCertificate } = await import('$lib/server/ess/trainingCertificate');
	const { deriveSkillsFromEnrollment } = await import('$lib/server/ess/trainingSkill');

	const karyawanRes = await directusServerJson<{ data: { nama_karyawan: string } }>(`/items/karyawan/${enrollment.karyawan_id}?fields=nama_karyawan`);
	const namaKaryawan = karyawanRes?.data?.nama_karyawan || '-';

	try {
		const cert = await issueCertificate(enrollment, program, namaKaryawan);
		await directusServerJson(`/items/training_enrollment/${enrollment.id}`, {
			method: 'PATCH',
			body: JSON.stringify(cert)
		});
		await deriveSkillsFromEnrollment({
			enrollmentId: enrollment.id,
			karyawanId: enrollment.karyawan_id,
			programId: program.id,
			sertifikatExpired: cert.sertifikat_expired
		});
	} catch (e) {
		// Kegagalan terbit sertifikat tidak boleh membatalkan status Lulus karyawan — dicatat saja.
		console.error('[training] gagal terbitkan sertifikat/skill:', e);
	}
}

/** Catatan bertimestamp (Fase 2.4) — privat per karyawan, milik sendiri saja yang boleh dibaca/ditulis. */
export async function listMyNotesForModule(karyawanId: number, moduleId: number): Promise<TrainingNoteRecord[]> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		'filter[module_id][_eq]': String(moduleId),
		fields: NOTE_FIELDS,
		sort: 'detik',
		limit: '200'
	});
	const result = await directusServerJson<{ data: TrainingNoteRecord[] }>(`/items/training_note?${query.toString()}`);
	return (result?.data || []).map((n) => ({ ...n, karyawan_id: unwrapId(n.karyawan_id) as number, module_id: unwrapId(n.module_id) as number }));
}

export async function createNote(karyawanId: number, moduleId: number, detik: number | null, catatan: string): Promise<TrainingNoteRecord> {
	const result = await directusServerJson<{ data: TrainingNoteRecord }>('/items/training_note', {
		method: 'POST',
		body: JSON.stringify({ karyawan_id: karyawanId, module_id: moduleId, detik, catatan })
	});
	return result?.data as TrainingNoteRecord;
}

export async function deleteNote(karyawanId: number, noteId: number): Promise<void> {
	const query = new URLSearchParams({ 'filter[karyawan_id][_eq]': String(karyawanId), 'filter[id][_eq]': String(noteId), fields: 'id', limit: '1' });
	const owned = await directusServerJson<{ data: Array<{ id: number }> }>(`/items/training_note?${query.toString()}`);
	if (!owned?.data?.length) throw new Error('Catatan tidak ditemukan.');
	await directusServerJson(`/items/training_note/${noteId}`, { method: 'DELETE' });
}

/** Diskusi per modul (Fase 3.5) — tampil langsung ke semua peserta, moderasi via lapor + hapus HRD. */
export async function listDiskusiForModule(moduleId: number): Promise<TrainingDiskusiRecord[]> {
	const query = new URLSearchParams({
		'filter[module_id][_eq]': String(moduleId),
		fields: DISKUSI_FIELDS,
		sort: '-pinned,date_created',
		limit: '500'
	});
	const result = await directusServerJson<{ data: any[] }>(`/items/training_diskusi?${query.toString()}`);
	return (result?.data || []).map((d) => ({
		id: d.id,
		karyawan_id: unwrapId(d.karyawan_id),
		karyawan_nama: d.karyawan_id?.nama_karyawan || '-',
		module_id: unwrapId(d.module_id) as number,
		pesan: d.pesan,
		parent_id: unwrapId(d.parent_id),
		pinned: !!d.pinned,
		dilaporkan: !!d.dilaporkan,
		date_created: d.date_created
	})) as TrainingDiskusiRecord[];
}

export async function postDiskusi(karyawanId: number, moduleId: number, pesan: string, parentId: number | null): Promise<void> {
	await directusServerJson('/items/training_diskusi', {
		method: 'POST',
		body: JSON.stringify({ karyawan_id: karyawanId, module_id: moduleId, pesan, parent_id: parentId })
	});
}

/** Menandai pesan dilaporkan — siapa pun peserta boleh melapor, tanpa syarat pemilik. */
export async function reportDiskusi(diskusiId: number): Promise<void> {
	await directusServerJson(`/items/training_diskusi/${diskusiId}`, {
		method: 'PATCH',
		body: JSON.stringify({ dilaporkan: true })
	});
}

export async function findQuizForModule(moduleId: number): Promise<TrainingQuizRecord | null> {
	const query = new URLSearchParams({ 'filter[module_id][_eq]': String(moduleId), fields: QUIZ_FIELDS, limit: '1' });
	const result = await directusServerJson<{ data: TrainingQuizRecord[] }>(`/items/training_quiz?${query.toString()}`);
	return result?.data?.[0] || null;
}

/** Kuis akhir program = training_quiz dengan module_id kosong. */
export async function findFinalQuizForProgram(programId: number): Promise<TrainingQuizRecord | null> {
	const query = new URLSearchParams({
		'filter[program_id][_eq]': String(programId),
		'filter[module_id][_null]': 'true',
		fields: QUIZ_FIELDS,
		limit: '1'
	});
	const result = await directusServerJson<{ data: TrainingQuizRecord[] }>(`/items/training_quiz?${query.toString()}`);
	return result?.data?.[0] || null;
}

export async function findQuizById(quizId: number): Promise<TrainingQuizRecord | null> {
	try {
		const result = await directusServerJson<{ data: TrainingQuizRecord }>(`/items/training_quiz/${quizId}?fields=${QUIZ_FIELDS}`);
		return result?.data || null;
	} catch {
		return null;
	}
}

/** Soal TANPA kunci jawaban — aman dikirim ke klien. */
export async function listQuestionsSafe(quizId: number): Promise<TrainingQuizQuestionRecord[]> {
	const query = new URLSearchParams({ 'filter[quiz_id][_eq]': String(quizId), fields: QUESTION_FIELDS_SAFE, limit: '200' });
	const result = await directusServerJson<{ data: TrainingQuizQuestionRecord[] }>(`/items/training_quiz_question?${query.toString()}`);
	return result?.data || [];
}

async function listQuestionsWithAnswers(quizId: number): Promise<Array<TrainingQuizQuestionRecord & { jawaban_benar: string }>> {
	const query = new URLSearchParams({ 'filter[quiz_id][_eq]': String(quizId), fields: QUESTION_FIELDS_FULL, limit: '200' });
	const result = await directusServerJson<{ data: any[] }>(`/items/training_quiz_question?${query.toString()}`);
	return result?.data || [];
}

/** max_quiz_attempts dari training_settings (satu sumber kebenaran dengan admin HRD). Default 3 bila belum diatur. */
export async function fetchMaxQuizAttempts(): Promise<number> {
	const data = await directusServerJson<{ data: { max_quiz_attempts?: number } }>('/items/training_settings').catch(() => null);
	return data?.data?.max_quiz_attempts ?? 3;
}

export interface QuizDisplaySettings {
	maxAttempts: number;
	showAnswersAfter: 'immediately' | 'after_pass' | 'never';
}

/** Gabungan max_quiz_attempts + show_answers_after dalam satu fetch (dipakai bersamaan di GET kuis). */
export async function fetchQuizDisplaySettings(): Promise<QuizDisplaySettings> {
	const data = (await directusServerJson<{ data: { max_quiz_attempts?: number; show_answers_after?: string } }>('/items/training_settings').catch(() => null))?.data;
	return {
		maxAttempts: data?.max_quiz_attempts ?? 3,
		showAnswersAfter: (data?.show_answers_after as QuizDisplaySettings['showAnswersAfter']) || 'after_pass'
	};
}

export async function listMyAttempts(enrollmentId: number, quizId: number): Promise<TrainingQuizAttemptRecord[]> {
	const query = new URLSearchParams({
		'filter[enrollment_id][_eq]': String(enrollmentId),
		'filter[quiz_id][_eq]': String(quizId),
		fields: ['id', 'enrollment_id', 'quiz_id', 'skor', 'lulus', 'jawaban', 'waktu_mulai', 'waktu_selesai'].join(','),
		sort: '-waktu_mulai',
		limit: '20'
	});
	const result = await directusServerJson<{ data: TrainingQuizAttemptRecord[] }>(`/items/training_quiz_attempt?${query.toString()}`);
	return result?.data || [];
}

/**
 * Grading SELALU di server (jawaban_benar tidak pernah dikirim ke klien).
 * Replika logika auto-grade admin (hrdTrainingLmsApi.js submitQuizAttempt).
 */
export async function submitQuizAttemptSafe(
	enrollment: TrainingEnrollmentRecord,
	quiz: TrainingQuizRecord,
	jawabanKaryawan: Array<{ question_id: number; jawaban: string }>
): Promise<TrainingQuizAttemptRecord> {
	// Kuis akhir pada enrollment 'Lulus' ditolak SEBELUM menilai/menyimpan apa pun: status Lulus,
	// nilai_akhir & sertifikat adalah catatan resmi (dibaca gate G_PRJ_MANPOWER_COMPETENCY di erp-epi)
	// dan tidak boleh diturunkan ke 'Remedial'. Status dibaca ulang agar tahan terhadap submit ganda.
	if (!quiz.module_id) {
		const terkini = await findEnrollmentById(enrollment.id);
		if (isFinalQuizRetakeBlocked(quiz, terkini?.status ?? enrollment.status)) throw new QuizRetakeBlockedError();
	}

	const questions = await listQuestionsWithAnswers(quiz.id);
	const gradable = questions.filter((q) => q.tipe !== 'essay');
	const totalBobot = gradable.reduce((sum, q) => sum + (Number(q.bobot) || 1), 0) || 1;

	let bobotBenar = 0;
	const jawabanDenganHasil = questions.map((q) => {
		const jb = jawabanKaryawan.find((j) => j.question_id === q.id);
		const jawabanText = jb?.jawaban ?? '';
		let benar: boolean | null = null;
		if (q.tipe !== 'essay') {
			benar = jawabanText.trim().toLowerCase() === String(q.jawaban_benar ?? '').trim().toLowerCase();
			if (benar) bobotBenar += Number(q.bobot) || 1;
		}
		return { question_id: q.id, jawaban: jawabanText, benar };
	});

	const skor = Math.round((bobotBenar / totalBobot) * 100);
	const passingScore = quiz.passing_score || 70;
	const lulus = skor >= passingScore;

	const payload = {
		enrollment_id: enrollment.id,
		quiz_id: quiz.id,
		skor,
		lulus,
		jawaban: jawabanDenganHasil,
		waktu_mulai: new Date().toISOString(),
		waktu_selesai: new Date().toISOString()
	};
	const result = await directusServerJson<{ data: TrainingQuizAttemptRecord }>('/items/training_quiz_attempt', {
		method: 'POST',
		body: JSON.stringify(payload)
	});

	// Propagasi skor kuis akhir ke nilai_teori enrollment (pola sama seperti admin).
	if (!quiz.module_id) {
		await directusServerJson(`/items/training_enrollment/${enrollment.id}`, {
			method: 'PATCH',
			body: JSON.stringify({ nilai_teori: skor, nilai_akhir: skor, status: lulus ? 'Lulus' : 'Remedial' })
		});

		if (lulus) {
			const program = await findProgramById(quiz.program_id);
			const updatedEnrollment = await findEnrollmentById(enrollment.id);
			if (program && updatedEnrollment) await finalizeLulusEnrollment(updatedEnrollment, program);
		}
	}

	return result?.data as TrainingQuizAttemptRecord;
}
