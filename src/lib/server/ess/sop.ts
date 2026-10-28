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
	file: Array<{ id: number; directus_files_id: { id: string; filename_download: string } }>;
}

const SOP_FIELDS = [
	'id', 'title', 'department', 'version', 'version_seq', 'last_updated', 'status',
	'keterangan', 'content', 'content_source', 'requires_training', 'target_departments',
	'target_roles', 'effective_date', 'retraining_policy',
	'file.id', 'file.directus_files_id.id', 'file.directus_files_id.filename_download'
].join(',');

/** SOP published yang boleh dibaca siapa pun (baca = semua orang, sesuai rekomendasi gerbang 2.2). */
export async function listPublishedSop(): Promise<SopDocumentRecord[]> {
	const query = new URLSearchParams({
		fields: SOP_FIELDS,
		'filter[status][_eq]': 'published',
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
