// src/lib/server/ess/offboarding.ts
// Fase 2 (Rencana Automasi HR Lifecycle v2) — ESS lapangan untuk offboarding_case/
// offboarding_clearance (koleksi sama dipakai HRD di erp-epi-1). Halaman /ess/offboarding HANYA
// menampilkan status (read-only) — clearance dieksekusi PIC department (IT/GA/Finance/HR) via
// HrdOffboardingDetail.svelte, bukan oleh karyawan sendiri.
//
// DEFAULT_CLEARANCE_TASKS di bawah SENGAJA diduplikasi persis dari
// erp-epi-1/src/lib/services/hrdOffboardingApi.js (dan offboardingAutoTrigger.js) — dua repo
// tidak berbagi lib. JANGAN ubah salah satu tanpa menyamakan yang lain.

import { directusServerJson } from '$lib/server/directus';

export interface OffboardingCaseRecord {
	id: number;
	karyawan_id: number;
	jenis: string;
	tanggal_pengajuan: string | null;
	tanggal_efektif: string | null;
	alasan: string | null;
	status: string;
	progress: number;
	settlement_blocked: boolean;
	settlement_block_reason: string | null;
	trigger_type: string | null;
}

export interface OffboardingClearanceRecord {
	id: number;
	kategori: string | null;
	nama_task: string;
	pic_department: string | null;
	status: 'pending' | 'cleared' | 'na';
	cleared_by: string | null;
	cleared_at: string | null;
}

const CASE_FIELDS =
	'id,karyawan_id,jenis,tanggal_pengajuan,tanggal_efektif,alasan,status,progress,settlement_blocked,settlement_block_reason,trigger_type';
const CLEARANCE_FIELDS = 'id,kategori,nama_task,pic_department,status,cleared_by,cleared_at';

const DEFAULT_CLEARANCE_TASKS = [
	{ kategori: 'Aset & Fasilitas', nama_task: 'Kembalikan Laptop & Aksesori Kerja', pic_department: 'IT' },
	{ kategori: 'Aset & Fasilitas', nama_task: 'Kembalikan ID Card & Akses Pintu', pic_department: 'GA' },
	{ kategori: 'Aset & Fasilitas', nama_task: 'Kembalikan Kendaraan Dinas (jika ada)', pic_department: 'GA' },
	{ kategori: 'Aset & Fasilitas', nama_task: 'Kembalikan Seragam & Kunci Mess (jika ada)', pic_department: 'GA' },
	{ kategori: 'Akses & Akun', nama_task: 'Nonaktifkan Email & Akun Portal Perusahaan', pic_department: 'IT' },
	{ kategori: 'Akses & Akun', nama_task: 'Cabut Akses Pintu / VPN', pic_department: 'IT' },
	{ kategori: 'Serah Terima Kerja', nama_task: 'Handover Pekerjaan & Dokumen ke Pengganti/Atasan', pic_department: 'Atasan' },
	{ kategori: 'Keuangan', nama_task: 'Pelunasan Kasbon/Pinjaman', pic_department: 'Finance' },
	{ kategori: 'Keuangan', nama_task: 'Verifikasi Sisa Cuti', pic_department: 'HR' }
];

function unwrapId(value: any): number | null {
	if (value == null) return null;
	return typeof value === 'object' ? (value.id ?? null) : value;
}

function todayJakarta(): string {
	const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' });
	return fmt.format(new Date());
}

/** Case offboarding AKTIF (bukan completed/cancelled) milik karyawan, kalau ada. */
export async function getMyActiveOffboardingCase(karyawanId: number): Promise<OffboardingCaseRecord | null> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		'filter[status][_nin]': 'completed,cancelled',
		fields: CASE_FIELDS,
		sort: '-id',
		limit: '1'
	});
	const result = await directusServerJson<{ data: OffboardingCaseRecord[] }>(`/items/offboarding_case?${query.toString()}`);
	const row = result?.data?.[0];
	if (!row) return null;
	return { ...row, karyawan_id: unwrapId(row.karyawan_id) as number };
}

export async function listClearanceForCase(offboardingId: number): Promise<OffboardingClearanceRecord[]> {
	const query = new URLSearchParams({
		'filter[offboarding_id][_eq]': String(offboardingId),
		fields: CLEARANCE_FIELDS,
		sort: 'id',
		limit: '200'
	});
	const result = await directusServerJson<{ data: OffboardingClearanceRecord[] }>(`/items/offboarding_clearance?${query.toString()}`);
	return result?.data || [];
}

/**
 * Karyawan mengajukan resign lewat ESS — langsung mulai proses clearance (status 'clearance'),
 * mirror persis createOffboardingCase manual & autoCreateOffboardingCase (erp-epi-1). Idempoten:
 * kalau karyawan sudah punya case aktif, tidak membuat case kedua.
 */
export async function submitResign(karyawanId: number, alasan: string, tanggalEfektif: string): Promise<{ skipped?: string; offboardingCaseId?: number }> {
	const existing = await getMyActiveOffboardingCase(karyawanId);
	if (existing) return { skipped: 'already_active_case' };

	const kasusRes = await directusServerJson<{ data: { id: number } }>('/items/offboarding_case', {
		method: 'POST',
		body: JSON.stringify({
			karyawan_id: karyawanId,
			jenis: 'Resign',
			tanggal_pengajuan: todayJakarta(),
			tanggal_efektif: tanggalEfektif,
			alasan,
			status: 'clearance',
			progress: 0,
			eligible_rehire: true,
			settlement_blocked: true,
			settlement_block_reason: 'Menunggu clearance selesai (checklist aset/akses/keuangan)',
			trigger_type: 'resign_ess_otomatis'
		})
	});
	const kasus = kasusRes?.data;
	if (!kasus?.id) throw new Error('Gagal mengajukan resign.');

	await directusServerJson(`/items/karyawan/${karyawanId}`, {
		method: 'PATCH',
		body: JSON.stringify({ status_kerja: 'Offboarding' })
	}).catch(() => {});

	for (const t of DEFAULT_CLEARANCE_TASKS) {
		await directusServerJson('/items/offboarding_clearance', {
			method: 'POST',
			body: JSON.stringify({ offboarding_id: kasus.id, kategori: t.kategori, nama_task: t.nama_task, pic_department: t.pic_department, status: 'pending' })
		});
	}

	await directusServerJson('/items/app_notifications', {
		method: 'POST',
		body: JSON.stringify({
			type: 'offboarding_resign_ess',
			title: 'Pengajuan Resign Baru (ESS)',
			message: `Karyawan #${karyawanId} mengajukan resign lewat ESS, efektif ${tanggalEfektif}. Alasan: ${alasan || '-'}. Tinjau di HRD > Offboarding.`,
			priority: 'high',
			department: 'hrd',
			action_url: '/hrd?tab=offboarding',
			source_collection: 'offboarding_case',
			source_id: String(kasus.id),
			read: false,
			created_at: new Date().toISOString()
		})
	}).catch(() => {});

	return { offboardingCaseId: kasus.id };
}
