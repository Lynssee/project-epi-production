// src/lib/server/ess/silabus.ts
// Silabus training per jabatan (Fase 3 dari implementation_plan_pelatihan & jabatan.md) — sisi lapangan.
// Satu sumber kebenaran: koleksi jabatan_silabus/silabus_materi/training_completion_target
// yang sama dipakai admin (erp-epi) & lapangan.
// Konvensi wajib: sertakan `.id` eksplisit pada subfield relasi bersarang.

import { directusServerJson } from '$lib/server/directus';
import type { ServerKaryawan } from './karyawan';
import { listMyEnrollments, findProgramById, listOnboardingPrograms, type TrainingEnrollmentRecord } from './training';

const ONBOARDING_SILABUS_ID = -1; // sentinel: silabus sintetis, bukan record jabatan_silabus asli

export interface JabatanSilabusRecord {
	id: number;
	nama_silabus: string;
	deskripsi: string | null;
	kategori: string | null;
	is_wajib: boolean;
	urutan: number | null;
	status: string;
}

export interface SilabusMateriRecord {
	id: number;
	jabatan_silabus_id: number;
	training_program_id: number;
	training_module_id: number | null;
	prerequisite_materi_id: number | null;
	urutan: number | null;
	is_wajib: boolean;
	catatan: string | null;
}

export interface CompletionTargetRecord {
	id: number;
	position_id: number;
	jabatan_silabus_id: number;
	target_hari: number | null;
	passing_grade: number | null;
	auto_enroll: boolean;
	status: string;
}

export interface SilabusMateriProgress {
	id: number;
	urutan: number | null;
	isWajib: boolean;
	programId: number;
	programJudul: string;
	programKategori: string | null;
	status: 'Lulus' | 'Ongoing' | 'Enrolled' | 'Remedial' | 'Gagal' | 'Belum Terdaftar';
	progressPersen: number;
	tenggat: string | null;
	locked: boolean;
	prerequisiteProgramJudul: string | null;
}

export interface SilabusProgress {
	id: number;
	namaSilabus: string;
	deskripsi: string | null;
	kategori: string | null;
	isWajib: boolean;
	target: { targetHari: number | null; passingGrade: number | null } | null;
	materi: SilabusMateriProgress[];
	totalWajib: number;
	wajibSelesai: number;
	progressPersen: number;
	selesai: boolean;
}

function unwrapId(value: any): number | null {
	if (value == null) return null;
	return typeof value === 'object' ? (value.id ?? null) : value;
}

/**
 * Resolusi jabatan (collection `posisi`) milik karyawan.
 * Prioritas: `karyawan.jabatan_id` (FK bersih, Fase 1 payroll). Field ini masih sparse di data
 * lapangan (baru dipakai Approval Engine) — fallback ke pencocokan `posisi.nama_posisi` dari
 * field `posisi` (string bebas teks) milik karyawan bila jabatan_id kosong.
 */
export async function resolvePositionForKaryawan(karyawan: ServerKaryawan): Promise<{ id: number; nama_posisi: string } | null> {
	if (karyawan.jabatan_id) {
		const result = await directusServerJson<{ data: { id: number; nama_posisi: string } }>(
			`/items/posisi/${karyawan.jabatan_id}?fields=id,nama_posisi`
		).catch(() => null);
		if (result?.data) return result.data;
	}
	if (!karyawan.posisi) return null;
	const query = new URLSearchParams({
		'filter[nama_posisi][_eq]': karyawan.posisi.trim().toUpperCase(),
		fields: 'id,nama_posisi',
		limit: '1'
	});
	const result = await directusServerJson<{ data: Array<{ id: number; nama_posisi: string }> }>(`/items/posisi?${query.toString()}`);
	return result?.data?.[0] || null;
}

async function listSilabusRecords(positionId: number): Promise<JabatanSilabusRecord[]> {
	const query = new URLSearchParams({
		'filter[position_id][_eq]': String(positionId),
		'filter[status][_eq]': 'aktif',
		fields: 'id,nama_silabus,deskripsi,kategori,is_wajib,urutan,status',
		sort: 'urutan'
	});
	const result = await directusServerJson<{ data: JabatanSilabusRecord[] }>(`/items/jabatan_silabus?${query.toString()}`);
	return result?.data || [];
}

async function listMateriRecords(silabusId: number): Promise<SilabusMateriRecord[]> {
	const query = new URLSearchParams({
		'filter[jabatan_silabus_id][_eq]': String(silabusId),
		fields: 'id,jabatan_silabus_id,training_program_id,training_module_id,prerequisite_materi_id,urutan,is_wajib,catatan',
		sort: 'urutan'
	});
	const result = await directusServerJson<{ data: any[] }>(`/items/silabus_materi?${query.toString()}`);
	return (result?.data || []).map((m) => ({
		...m,
		jabatan_silabus_id: unwrapId(m.jabatan_silabus_id) as number,
		training_program_id: unwrapId(m.training_program_id) as number,
		training_module_id: unwrapId(m.training_module_id),
		prerequisite_materi_id: unwrapId(m.prerequisite_materi_id)
	}));
}

async function findCompletionTarget(silabusId: number): Promise<CompletionTargetRecord | null> {
	const query = new URLSearchParams({
		'filter[jabatan_silabus_id][_eq]': String(silabusId),
		'filter[status][_eq]': 'aktif',
		fields: 'id,position_id,jabatan_silabus_id,target_hari,passing_grade,auto_enroll,status',
		limit: '1'
	});
	const result = await directusServerJson<{ data: any[] }>(`/items/training_completion_target?${query.toString()}`);
	const row = result?.data?.[0];
	if (!row) return null;
	return { ...row, position_id: unwrapId(row.position_id) as number, jabatan_silabus_id: unwrapId(row.jabatan_silabus_id) as number };
}

/**
 * Silabus jabatan karyawan lengkap dengan progress per materi (gabungan enrollment training_enrollment
 * karyawan yang bersangkutan). Dipakai untuk section "Silabus Jabatan Saya" di ESS.
 */
export async function getSilabusProgressForKaryawan(karyawan: ServerKaryawan): Promise<{ position: { id: number; nama_posisi: string } | null; silabusList: SilabusProgress[] }> {
	const [position, enrollments] = await Promise.all([
		resolvePositionForKaryawan(karyawan),
		listMyEnrollments(karyawan.id)
	]);
	const enrollmentByProgram = new Map<number, TrainingEnrollmentRecord>(enrollments.map((e) => [e.program_id, e]));

	const onboardingEntry = await buildOnboardingSilabus(enrollmentByProgram);

	const silabusRecords = position ? await listSilabusRecords(position.id) : [];
	const jabatanEntries: SilabusProgress[] = silabusRecords.length === 0 ? [] : await Promise.all(
		silabusRecords.map(async (s) => {
			const [materiRecords, target] = await Promise.all([listMateriRecords(s.id), findCompletionTarget(s.id)]);

			const materiBase = await Promise.all(
				materiRecords.map(async (m) => {
					const program = await findProgramById(m.training_program_id);
					const enrollment = enrollmentByProgram.get(m.training_program_id) || null;
					return {
						id: m.id,
						urutan: m.urutan,
						isWajib: m.is_wajib !== false,
						programId: m.training_program_id,
						programJudul: program?.judul || `Program #${m.training_program_id}`,
						programKategori: program?.kategori ?? null,
						status: (enrollment?.status as SilabusMateriProgress['status']) || 'Belum Terdaftar',
						progressPersen: enrollment?.progress_persen ?? 0,
						tenggat: enrollment?.tenggat ?? null,
						prerequisiteMateriId: m.prerequisite_materi_id
					};
				})
			);
			const materiById = new Map(materiBase.map((m) => [m.id, m]));
			const materi: SilabusMateriProgress[] = materiBase.map(({ prerequisiteMateriId, ...m }) => {
				const prereq = prerequisiteMateriId != null ? materiById.get(prerequisiteMateriId) : null;
				return {
					...m,
					locked: !!prereq && prereq.status !== 'Lulus',
					prerequisiteProgramJudul: prereq?.programJudul ?? null
				};
			});

			const wajibMateri = materi.filter((m) => m.isWajib);
			const wajibSelesai = wajibMateri.filter((m) => m.status === 'Lulus').length;
			const totalWajib = wajibMateri.length;
			const progressPersen = totalWajib > 0 ? Math.round((wajibSelesai / totalWajib) * 100) : 0;

			return {
				id: s.id,
				namaSilabus: s.nama_silabus,
				deskripsi: s.deskripsi,
				kategori: s.kategori,
				isWajib: s.is_wajib !== false,
				target: target ? { targetHari: target.target_hari, passingGrade: target.passing_grade } : null,
				materi,
				totalWajib,
				wajibSelesai,
				progressPersen,
				selesai: totalWajib > 0 && wajibSelesai === totalWajib
			};
		})
	);

	const silabusList = [onboardingEntry, ...jabatanEntries].filter((s): s is SilabusProgress => s != null);
	return { position, silabusList };
}

export interface TeamMemberSilabusProgress {
	karyawanId: number;
	namaKaryawan: string;
	position: { id: number; nama_posisi: string } | null;
	silabusList: SilabusProgress[];
	totalWajibKeseluruhan: number;
	selesaiKeseluruhan: number;
}

/**
 * Progress silabus seluruh anggota tim langsung (`karyawan.atasan_id` == atasanId) — Rekomendasi #5
 * dokumen plan (Project Leader view). Otorisasi: dipanggil HANYA dgn id karyawan yang sudah
 * ter-otentikasi via authenticateEss, bukan dari input klien — pola sama dgn
 * assertCanApproveLemburStep1 di server/ess/divisi.ts (atasan_id sbg sumber kebenaran atasan langsung).
 */
export async function getTeamSilabusProgress(atasanId: number): Promise<TeamMemberSilabusProgress[]> {
	const query = new URLSearchParams({
		'filter[atasan_id][_eq]': String(atasanId),
		fields: 'id,nama_karyawan,email_company,divisi,divisi_id,posisi,jabatan_id',
		sort: 'nama_karyawan',
		limit: '-1'
	});
	const result = await directusServerJson<{ data: any[] }>(`/items/karyawan?${query.toString()}`);
	const anggota = result?.data || [];
	if (anggota.length === 0) return [];

	return Promise.all(
		anggota.map(async (a): Promise<TeamMemberSilabusProgress> => {
			const member: ServerKaryawan = {
				id: a.id,
				nama_karyawan: a.nama_karyawan,
				email_company: a.email_company,
				divisi: a.divisi ?? null,
				divisi_id: typeof a.divisi_id === 'object' ? (a.divisi_id?.id ?? null) : (a.divisi_id ?? null),
				posisi: a.posisi ?? null,
				jabatan_id: typeof a.jabatan_id === 'object' ? (a.jabatan_id?.id ?? null) : (a.jabatan_id ?? null)
			};
			const { position, silabusList } = await getSilabusProgressForKaryawan(member);
			const totalWajibKeseluruhan = silabusList.reduce((sum, s) => sum + s.totalWajib, 0);
			const selesaiKeseluruhan = silabusList.reduce((sum, s) => sum + s.wajibSelesai, 0);
			return {
				karyawanId: member.id,
				namaKaryawan: member.nama_karyawan,
				position,
				silabusList,
				totalWajibKeseluruhan,
				selesaiKeseluruhan
			};
		})
	);
}

/**
 * Silabus sintetis "Onboarding Karyawan Baru" (Rekomendasi #8 dokumen plan): gabungkan program
 * `training_program.is_onboarding=true` (berlaku semua karyawan, lintas jabatan) ke dalam
 * tampilan silabus yang sama, supaya karyawan baru langsung lihat checklist onboarding +
 * silabus jabatannya dalam satu tempat tanpa admin perlu konfigurasi manual per jabatan.
 * Selalu dihitung (bukan hanya utk karyawan baru) — karyawan lama yg sudah lulus semua akan
 * otomatis tampil "Selesai", konsisten dgn cara silabus jabatan lain ditampilkan.
 */
async function buildOnboardingSilabus(enrollmentByProgram: Map<number, TrainingEnrollmentRecord>): Promise<SilabusProgress | null> {
	const programs = await listOnboardingPrograms();
	if (programs.length === 0) return null;

	const materi: SilabusMateriProgress[] = programs.map((p) => {
		const enrollment = enrollmentByProgram.get(p.id) || null;
		return {
			id: -p.id,
			urutan: p.urutan_tampil,
			isWajib: true,
			programId: p.id,
			programJudul: p.judul,
			programKategori: p.kategori,
			status: (enrollment?.status as SilabusMateriProgress['status']) || 'Belum Terdaftar',
			progressPersen: enrollment?.progress_persen ?? 0,
			tenggat: enrollment?.tenggat ?? null,
			locked: false,
			prerequisiteProgramJudul: null
		};
	});

	const selesai = materi.filter((m) => m.status === 'Lulus').length;
	const totalWajib = materi.length;

	return {
		id: ONBOARDING_SILABUS_ID,
		namaSilabus: 'Onboarding Karyawan Baru',
		deskripsi: 'Program wajib untuk seluruh karyawan baru, terlepas dari jabatan.',
		kategori: 'Onboarding',
		isWajib: true,
		target: null,
		materi,
		totalWajib,
		wajibSelesai: selesai,
		progressPersen: totalWajib > 0 ? Math.round((selesai / totalWajib) * 100) : 0,
		selesai: totalWajib > 0 && selesai === totalWajib
	};
}
