// src/lib/server/ess/sop.ts
// Query helper server-side untuk /api/ess/sop/* — reader SOP lapangan (Fase 2C).
// Satu sumber kebenaran: sop_documents Directus yang sama dipakai admin (HrdSopManager)
// & lapangan. Hanya status=published yang ditampilkan — status=active berarti "disetujui
// tapi belum disosialisasi" (keputusan gerbang 0.4), belum layak dibaca karyawan lapangan.

import { directusServerJson } from '$lib/server/directus';

export interface SopDocumentRecord {
	id: number;
	title: string;
	department: string | null;
	version: string;
	version_seq: number;
	last_updated: string | null;
	status: string;
	keterangan: string | null;
	content: string | null;
	content_source: 'file' | 'richtext' | 'hybrid';
	requires_training: boolean;
	target_departments: string[];
	target_roles: string[];
	effective_date: string | null;
	retraining_policy: string;
	approval_status?: string | null;
	sop_code?: string | null;
	training_program_id?: number | null;
	file: Array<{ id: number; directus_files_id: { id: string; filename_download: string } }>;
}

const SOP_FIELDS = [
	'id', 'title', 'department', 'version', 'version_seq', 'last_updated', 'status',
	'keterangan', 'content', 'content_source', 'requires_training', 'target_departments',
	'target_roles', 'effective_date', 'retraining_policy', 'approval_status', 'sop_code', 'training_program_id',
	'file.id', 'file.directus_files_id.id', 'file.directus_files_id.filename_download'
].join(',');

/**
 * SOP yang boleh dibaca & dikonfirmasi lapangan: sudah published, ATAU sedang masa sosialisasi
 * (approval_status 'butuh_sosialisasi') — karena konfirmasi paham (G_FLD_SOP_READ_CONFIRMATION) justru diminta
 * pada masa itu. Tanpa ini SOP sosialisasi tak bisa dibaca → gate tak mungkin dipenuhi.
 */
export function isReadableSop(sop: { status?: string | null; approval_status?: string | null } | null | undefined): boolean {
	return Boolean(sop) && (sop!.status === 'published' || sop!.approval_status === 'butuh_sosialisasi');
}

/** SOP yang boleh dibaca siapa pun (baca = semua orang, sesuai rekomendasi gerbang 2.2). */
export async function listPublishedSop(): Promise<SopDocumentRecord[]> {
	const query = new URLSearchParams({
		fields: SOP_FIELDS,
		filter: JSON.stringify({ _or: [{ status: { _eq: 'published' } }, { approval_status: { _eq: 'butuh_sosialisasi' } }] }),
		sort: '-last_updated',
		limit: '200'
	});
	const result = await directusServerJson<{ data: SopDocumentRecord[] }>(`/items/sop_documents?${query.toString()}`);
	return result?.data || [];
}

/** SOP yang men-generate training_program tertentu (Fase 4: tautan remediasi saat kuis gagal). */
export async function findSopByProgramId(programId: number): Promise<{ id: number; title: string } | null> {
	const query = new URLSearchParams({
		fields: 'id,title',
		'filter[training_program_id][_eq]': String(programId),
		'filter[status][_eq]': 'published',
		limit: '1'
	});
	const result = await directusServerJson<{ data: Array<{ id: number; title: string }> }>(`/items/sop_documents?${query.toString()}`).catch(() => null);
	return result?.data?.[0] || null;
}

export async function getSopById(id: number): Promise<SopDocumentRecord | null> {
	const query = new URLSearchParams({ fields: SOP_FIELDS });
	try {
		const result = await directusServerJson<{ data: SopDocumentRecord }>(`/items/sop_documents/${id}?${query.toString()}`);
		return result?.data || null;
	} catch {
		return null;
	}
}

export interface SopReadConfirmationRecord {
	id: number;
	sop_id: number;
	karyawan_id: number;
	sop_version_seq: number;
	confirmed_at: string;
}

/** Kepatuhan SOP pribadi (Fase 6A, lapangan): berapa dari SOP published yang sudah dikonfirmasi baca versi berjalan. */
export async function fetchComplianceSummary(karyawanId: number, sopList: SopDocumentRecord[]): Promise<{ confirmed: number; total: number }> {
	if (sopList.length === 0) return { confirmed: 0, total: 0 };
	const filter = encodeURIComponent(JSON.stringify({
		karyawan_id: { _eq: karyawanId },
		sop_id: { _in: sopList.map((s) => s.id) }
	}));
	const result = await directusServerJson<{ data: SopReadConfirmationRecord[] }>(
		`/items/sop_read_confirmations?filter=${filter}&fields=sop_id,sop_version_seq&limit=-1`
	).catch(() => null);
	const confirmations = result?.data || [];
	const currentVersionBySop = new Map(sopList.map((s) => [s.id, s.version_seq]));
	const confirmedIds = new Set(
		confirmations.filter((c) => c.sop_version_seq === currentVersionBySop.get(c.sop_id)).map((c) => c.sop_id)
	);
	return { confirmed: confirmedIds.size, total: sopList.length };
}

export async function hasConfirmedRead(sopId: number, karyawanId: number, versionSeq: number): Promise<boolean> {
	const filter = encodeURIComponent(JSON.stringify({
		_and: [
			{ sop_id: { _eq: sopId } },
			{ karyawan_id: { _eq: karyawanId } },
			{ sop_version_seq: { _eq: versionSeq } }
		]
	}));
	const result = await directusServerJson<{ data: SopReadConfirmationRecord[] }>(
		`/items/sop_read_confirmations?filter=${filter}&fields=id&limit=1`
	);
	return (result?.data || []).length > 0;
}

export async function confirmRead(sopId: number, karyawanId: number, versionSeq: number, ip: string | null): Promise<void> {
	await directusServerJson('/items/sop_read_confirmations', {
		method: 'POST',
		body: JSON.stringify({ sop_id: sopId, karyawan_id: karyawanId, sop_version_seq: versionSeq, ip_address: ip })
	});
}

export interface SopTrainingStatus {
	programId: number;
	judul: string;
	status: string; // status enrollment: Enrolled | Ongoing | Lulus | Gagal | Remedial …
	progress: number;
	tenggat: string | null;
}

/**
 * Status training SOP milik karyawan (Integrasi SOP ↔ Training). Hanya bila SOP mewajibkan training, programnya sudah DITERBITKAN
 * HRD (draf AI tidak tampil di lapangan) dan karyawan terdaftar. Relasi diambil terpisah; gagal baca → null (SOP tetap terbaca).
 */
export async function getSopTrainingStatus(sop: Pick<SopDocumentRecord, 'requires_training'> & { training_program_id?: number | null }, karyawanId: number): Promise<SopTrainingStatus | null> {
	const programId = Number(sop.training_program_id);
	if (!sop.requires_training || !Number.isInteger(programId) || programId <= 0) return null;
	try {
		const prog = await directusServerJson<{ data: { id: number; judul: string; status: string } }>(`/items/training_program/${programId}?fields=id,judul,status`);
		if (!prog?.data || prog.data.status !== 'published') return null;
		const enr = await directusServerJson<{ data: Array<{ status: string; progress_persen: number | null; tenggat: string | null }> }>(
			`/items/training_enrollment?filter[program_id][_eq]=${programId}&filter[karyawan_id][_eq]=${karyawanId}&fields=status,progress_persen,tenggat&limit=1`
		);
		const e = enr?.data?.[0];
		if (!e) return null;
		return { programId, judul: prog.data.judul, status: e.status, progress: Number(e.progress_persen ?? 0), tenggat: e.tenggat ?? null };
	} catch {
		return null;
	}
}

export interface SopSertifikat {
	sopId: number;
	sop_code: string | null;
	title: string;
	programId: number;
	sertifikat_no: string | null;
	sertifikat_expired: string | null;
}

/**
 * Badge "Tersertifikasi SOP": SOP terbit ber-"Training Wajib" yang program training-nya sudah LULUS oleh karyawan ini.
 * Dua query ringan (enrollment Lulus, lalu SOP yang tertaut ke program itu — relasi tidak di-nest). Sertifikat kedaluwarsa tidak dihitung
 * (sama dengan gate onboarding). wajib_ulang saat SOP naik versi mereset Lulus → badge otomatis hilang sampai lulus lagi. Gagal baca → [].
 */
export async function listSopSertifikasi(karyawanId: number, today: string = new Date().toISOString().slice(0, 10)): Promise<SopSertifikat[]> {
	try {
		const enr = await directusServerJson<{ data: Array<{ program_id: number | { id: number }; sertifikat_no: string | null; sertifikat_expired: string | null }> }>(
			`/items/training_enrollment?filter[karyawan_id][_eq]=${karyawanId}&filter[status][_eq]=Lulus&fields=program_id,sertifikat_no,sertifikat_expired&limit=-1`
		);
		const lulus = new Map<number, { sertifikat_no: string | null; sertifikat_expired: string | null }>();
		for (const e of enr?.data || []) {
			const pid = Number(typeof e.program_id === 'object' ? e.program_id?.id : e.program_id);
			if (!Number.isInteger(pid) || pid <= 0) continue;
			const exp = String(e.sertifikat_expired ?? '').slice(0, 10);
			if (exp && exp < today) continue;
			lulus.set(pid, { sertifikat_no: e.sertifikat_no ?? null, sertifikat_expired: exp || null });
		}
		if (lulus.size === 0) return [];
		const sops = await directusServerJson<{ data: Array<{ id: number; sop_code: string | null; title: string; training_program_id: number | { id: number } }> }>(
			`/items/sop_documents?filter[training_program_id][_in]=${[...lulus.keys()].join(',')}&filter[requires_training][_eq]=true&filter[status][_eq]=published&fields=id,sop_code,title,training_program_id&limit=-1`
		);
		return (sops?.data || []).map((s) => {
			const programId = Number(typeof s.training_program_id === 'object' ? s.training_program_id?.id : s.training_program_id);
			const c = lulus.get(programId);
			return { sopId: s.id, sop_code: s.sop_code ?? null, title: s.title, programId, sertifikat_no: c?.sertifikat_no ?? null, sertifikat_expired: c?.sertifikat_expired ?? null };
		}).filter((x) => lulus.has(x.programId));
	} catch {
		return [];
	}
}
