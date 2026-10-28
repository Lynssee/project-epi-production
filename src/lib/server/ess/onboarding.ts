// src/lib/server/ess/onboarding.ts
// Fase 2 (Rencana Automasi HR Lifecycle v2) — ESS lapangan untuk onboarding_case/onboarding_task
// (koleksi yang sama dipakai HRD di erp-epi-1, satu sumber kebenaran). Karyawan HANYA boleh
// submit (upload lampiran + tandai submitted_by_karyawan) — centang `completed` resmi tetap
// wewenang HR di HrdOnboarding.svelte, supaya tidak ada karyawan yang bisa self-certify checklist
// admin/aset yang seharusnya diverifikasi PIC department.

import { directusServerJson } from '$lib/server/directus';

export interface OnboardingTaskRecord {
	id: number;
	kategori: string | null;
	nama_task: string;
	pic_department: string | null;
	completed: boolean;
	completed_at: string | null;
	due_date: string | null;
	sort: number | null;
	lampiran: string | null;
	submitted_by_karyawan: boolean;
	submitted_at: string | null;
	catatan: string | null;
}

export interface OnboardingCaseRecord {
	id: number;
	karyawan_id: number;
	jenis: string;
	tanggal_pengajuan: string | null;
	tanggal_efektif: string | null;
	status: string;
	progress: number;
	mentor_id: number | null;
	mentor_nama: string | null;
	skor_mentor: number | null;
	catatan_mentor: string | null;
	mentor_dinilai_pada: string | null;
}

const CASE_FIELDS =
	'id,karyawan_id,template_used,status,progress,mentor_id.id,mentor_id.nama_karyawan,skor_mentor,catatan_mentor,mentor_dinilai_pada';
const TASK_FIELDS = 'id,kategori,nama_task,pic_department,completed,completed_at,due_date,sort,lampiran,submitted_by_karyawan,submitted_at,catatan';

function unwrapId(value: any): number | null {
	if (value == null) return null;
	return typeof value === 'object' ? (value.id ?? null) : value;
}

/** Case onboarding TERBARU milik karyawan (biasanya cuma 1 aktif, tapi ambil terbaru kalau ada histori). */
export async function getMyOnboardingCase(karyawanId: number): Promise<OnboardingCaseRecord | null> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		fields: CASE_FIELDS,
		sort: '-id',
		limit: '1'
	});
	const result = await directusServerJson<{ data: any[] }>(`/items/onboarding_case?${query.toString()}`);
	const row = result?.data?.[0];
	if (!row) return null;
	return {
		...row,
		jenis: row.template_used || 'Onboarding',
		tanggal_pengajuan: null,
		tanggal_efektif: null,
		karyawan_id: unwrapId(row.karyawan_id) as number,
		mentor_id: unwrapId(row.mentor_id),
		mentor_nama: row.mentor_id?.nama_karyawan ?? null
	};
}

/**
 * Penilaian dua arah (Fase 4.3): mentee menilai mentor-nya sendiri di akhir onboarding.
 * Hanya boleh sekali (mentor_dinilai_pada dicek) dan hanya untuk case milik karyawan ybs.
 */
export async function submitMentorRating(karyawanId: number, onboardingId: number, skorMentor: number, catatanMentor: string | null): Promise<OnboardingCaseRecord> {
	const kasus = await getMyOnboardingCase(karyawanId);
	if (!kasus || kasus.id !== onboardingId) throw new Error('Onboarding case tidak ditemukan atau bukan milik Anda.');
	if (!kasus.mentor_id) throw new Error('Case ini belum punya mentor yang ditugaskan.');
	if (kasus.mentor_dinilai_pada) throw new Error('Anda sudah menilai mentor untuk onboarding ini.');
	if (skorMentor < 1 || skorMentor > 5) throw new Error('Skor harus 1-5.');

	const result = await directusServerJson<{ data: any }>(`/items/onboarding_case/${onboardingId}`, {
		method: 'PATCH',
		body: JSON.stringify({ skor_mentor: skorMentor, catatan_mentor: catatanMentor, mentor_dinilai_pada: new Date().toISOString() })
	});
	const row = result?.data;
	return {
		...row,
		jenis: row?.template_used || 'Onboarding',
		tanggal_pengajuan: null,
		tanggal_efektif: null,
		karyawan_id: unwrapId(row?.karyawan_id) as number,
		mentor_id: unwrapId(row?.mentor_id),
		mentor_nama: null
	};
}

export async function listTasksForCase(onboardingId: number): Promise<OnboardingTaskRecord[]> {
	const query = new URLSearchParams({
		'filter[onboarding_id][_eq]': String(onboardingId),
		fields: TASK_FIELDS,
		sort: 'sort,id',
		limit: '200'
	});
	const result = await directusServerJson<{ data: OnboardingTaskRecord[] }>(`/items/onboarding_task?${query.toString()}`);
	return result?.data || [];
}

async function findTaskOwnedByCase(taskId: number, onboardingId: number): Promise<OnboardingTaskRecord | null> {
	const result = await directusServerJson<{ data: OnboardingTaskRecord & { onboarding_id: any } }>(
		`/items/onboarding_task/${taskId}?fields=${TASK_FIELDS},onboarding_id`
	).catch(() => null);
	const row = result?.data;
	if (!row) return null;
	if (unwrapId(row.onboarding_id) !== onboardingId) return null;
	return row;
}

/**
 * Karyawan submit bukti utk 1 task (upload lampiran). TIDAK PERNAH set `completed=true` — itu
 * tetap keputusan HR/PIC setelah meninjau lampiran (lihat komentar header file).
 * @throws bila task bukan milik case yang sedang aktif milik karyawan ybs (cegah IDOR).
 */
export async function submitTaskEvidence(
	karyawanId: number,
	onboardingId: number,
	taskId: number,
	fileUuid: string | null,
	catatan: string | null
): Promise<OnboardingTaskRecord> {
	const kasus = await getMyOnboardingCase(karyawanId);
	if (!kasus || kasus.id !== onboardingId) {
		throw new Error('Onboarding case tidak ditemukan atau bukan milik Anda.');
	}
	const task = await findTaskOwnedByCase(taskId, onboardingId);
	if (!task) throw new Error('Task tidak ditemukan.');

	const payload: Record<string, any> = { submitted_by_karyawan: true, submitted_at: new Date().toISOString() };
	if (fileUuid) payload.lampiran = fileUuid;
	if (catatan != null) payload.catatan = catatan;

	const result = await directusServerJson<{ data: OnboardingTaskRecord }>(`/items/onboarding_task/${taskId}`, {
		method: 'PATCH',
		body: JSON.stringify(payload)
	});
	return result?.data as OnboardingTaskRecord;
}
