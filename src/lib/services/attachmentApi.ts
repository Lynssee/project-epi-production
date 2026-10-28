// src/lib/services/attachmentApi.ts
// Rencana Lampiran Otomatis PR v2 (27 Agu 2026, Fase 5 — Dashboard Lapangan).
// Semua lewat endpoint server (token admin) — koleksi attachment_type_registry /
// purchase_category_attachment / pengajuan_lampiran dibuat oleh erp-epi-1 dan belum
// tentu punya izin baca/tulis untuk peran lapangan.
//
// Lapangan HANYA jalur manual: unggah foto (dikompres) untuk jenis lampiran yang
// diminta kategori. Tidak ada "Tarik Data" (admin saja) & tidak ada pengecualian.

import { getIdToken } from './secureDirectus';
import { compressPhoto } from '$lib/utils/photoCompress';

export interface LampiranRule {
	rule_id: number | null;
	attachment_type_id: number;
	key: string | null;
	label: string | null;
	deskripsi: string | null;
	puller_key: string | null;
	is_required: boolean;
	stage: string | null;
}

export interface LampiranChecklistItem extends LampiranRule {
	lampiran: {
		id: number;
		status: string;
		source_type: string;
		file_id: string | null;
		generated_by?: string | null;
		exception_by?: string | null;
		exception_note?: string | null;
	} | null;
	fulfilled: boolean;
}

async function authFetch(path: string, options: RequestInit = {}) {
	const token = await getIdToken();
	const res = await fetch(path, {
		...options,
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
			...(options.headers || {})
		}
	});
	const text = await res.text();
	let parsed: any = null;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		/* non-JSON */
	}
	if (!res.ok) throw new Error(parsed?.message || parsed?.error?.message || `Request gagal (${res.status})`);
	return parsed;
}

/** Pratinjau aturan lampiran satu kategori (Langkah 3, PR belum dibuat). */
export async function getLampiranRules(kategoriKode: string): Promise<LampiranRule[]> {
	const res = await authFetch(`/api/procurement/lampiran-rules?kode=${encodeURIComponent(kategoriKode)}`);
	return res?.rules || [];
}

/** Ceklist lampiran satu PR (setelah PR dibuat). */
export async function getPengajuanLampiran(pengajuanId: number | string): Promise<LampiranChecklistItem[]> {
	const res = await authFetch(`/api/procurement/pengajuan/${pengajuanId}/lampiran`);
	return res?.checklist || [];
}

/**
 * Unggah foto sebagai lampiran manual: kompres -> /files -> daftarkan baris
 * pengajuan_lampiran lewat endpoint server.
 */
export async function uploadLampiranFoto(
	pengajuanId: number | string,
	attachmentTypeId: number,
	file: File
): Promise<any> {
	const compressed = await compressPhoto(file);
	const token = await getIdToken();

	const form = new FormData();
	form.append('file', compressed, compressed.name || 'lampiran.jpg');
	const upRes = await fetch('/api/directus/files', {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}` },
		body: form
	});
	if (!upRes.ok) throw new Error('Gagal mengunggah foto');
	const upJson = await upRes.json().catch(() => ({}));
	const fileId = upJson?.data?.id;
	if (!fileId) throw new Error('Berkas tidak terbentuk');

	return authFetch(`/api/procurement/pengajuan/${pengajuanId}/lampiran`, {
		method: 'POST',
		body: JSON.stringify({ action: 'attach', attachment_type_id: attachmentTypeId, file_id: fileId })
	});
}
