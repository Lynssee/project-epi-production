// src/lib/services/manpowerBorongan.ts
// Fase 4 — "Manajemen Termin Pembayaran Borongan Manpower" (dashboard LAPANGAN).
//
// Subset baca + verifikasi progres saja. Pembuatan rencana termin & pengajuan ke
// Finance TETAP di Admin ERP (keputusan user: Q1 = Admin ERP saja). Project Leader
// di sini hanya: lihat termin + verifikasi progres (foto BAP + catatan + % progres).
//
// Koleksi Directus bersama dengan admin: manpower_borongan_termin, manpower_assignment.

import directus, { handleDirectusError } from './directus';
import { readItems, readItem, updateItem } from '@directus/sdk';
import { compressPhoto } from '$lib/utils/photoCompress';
import { getIdToken } from './secureDirectus';

const asId = (v: any) => (v && typeof v === 'object' ? v.id : v);
const num = (v: any) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

export interface BoronganTermin {
	id: number;
	assignment_id: any;
	manpower_id: any;
	project_id: any;
	urutan: number;
	label: string;
	basis: string;
	persentase: number | null;
	amount: number;
	deskripsi_pekerjaan: string | null;
	status: 'draft' | 'verified' | 'submitted' | 'approved' | 'partial' | 'paid' | 'cancelled';
	tanggal_rencana: string | null;
	progress_required: number | null;
	verified_progress_pct: number | null;
	is_pelunasan: boolean;
	asset_return_confirmed: boolean;
	no_kendala_confirmed: boolean;
	denda_barang_rusak: number | null;
	verified_date: string | null;
	verified_by: string | null;
	verified_note: string | null;
	verified_photos: string[] | null;
	pengajuan_anggaran_id: any;
	paid_amount: number | null;
	paid_date: string | null;
	/** Rencana B2B Payment, Fase 2 (3 Okt 2026) — null bila termin ini bukan bagian skema B2B. */
	b2b_hold_status: 'waiting_client' | 'partial_released' | 'released' | null;
}

const TERMIN_FIELDS = [
	'id', 'assignment_id', 'manpower_id', 'project_id', 'urutan', 'label', 'basis',
	'persentase', 'amount', 'deskripsi_pekerjaan', 'status', 'tanggal_rencana',
	'progress_required', 'verified_progress_pct', 'is_pelunasan', 'asset_return_confirmed',
	'no_kendala_confirmed', 'denda_barang_rusak', 'verified_date', 'verified_by',
	'verified_note', 'verified_photos', 'pengajuan_anggaran_id', 'paid_amount', 'paid_date',
	'b2b_hold_status'
];

/** Assignment borongan sebuah proyek + cache ringkas. */
export async function getBoronganAssignments(projectId: number | string) {
	try {
		const rows = (await directus.request(
			readItems('manpower_assignment', {
				fields: [
					'id', 'jabatan', 'nilai_borongan', 'status',
					'manpower_id',
					'borongan_total_paid', 'borongan_outstanding', 'borongan_termin_count', 'borongan_status'
				],
				filter: { project_id: { _eq: Number(projectId) }, rate_tipe: { _eq: 'borongan' } },
				sort: ['-id'],
				limit: -1
			})
		)) as any[];

		if (!rows || rows.length === 0) return [];

		// Separated relation fetching for manpower (User Rule #3)
		const manpowerIds = [
			...new Set(
				rows
					.map((r) => (typeof r.manpower_id === 'object' ? r.manpower_id?.id : r.manpower_id))
					.filter((id): id is number => typeof id === 'number' && id > 0)
			)
		];

		const manpowerMap = new Map<number, { id: number; nama: string }>();
		if (manpowerIds.length > 0) {
			try {
				const manpowers = (await directus.request(
					readItems('manpower', {
						filter: { id: { _in: manpowerIds } },
						fields: ['id', 'nama'],
						limit: manpowerIds.length
					})
				)) as any[];
				manpowers.forEach((m) => {
					if (m && m.id) {
						manpowerMap.set(m.id, { id: m.id, nama: m.nama || '' });
					}
				});
			} catch (mErr) {
				console.warn('[manpowerBorongan] Gagal fetch relasi manpower terpisah:', mErr);
			}
		}

		return rows.map((r) => {
			const mId = typeof r.manpower_id === 'object' ? r.manpower_id?.id : r.manpower_id;
			return {
				...r,
				manpower_id: mId && manpowerMap.has(mId) ? manpowerMap.get(mId) : r.manpower_id
			};
		});
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/** Termin sebuah assignment, urut urutan. */
export async function getBoronganTermins(assignmentId: number | string): Promise<BoronganTermin[]> {
	try {
		const rows = await directus.request(
			readItems('manpower_borongan_termin', {
				fields: TERMIN_FIELDS,
				filter: { assignment_id: { _eq: Number(assignmentId) } },
				sort: ['urutan'],
				limit: -1
			})
		);
		return (rows as any[]) as BoronganTermin[];
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

/** Ringkasan (recompute dari termin). */
export async function getBoronganSummary(assignmentId: number | string) {
	try {
		const a: any = await directus.request(
			readItem('manpower_assignment', Number(assignmentId), {
				fields: ['id', 'nilai_borongan', 'rate_tipe']
			})
		);
		const termins = await getBoronganTermins(assignmentId);
		const live = termins.filter((t) => t.status !== 'cancelled');
		const nilai = num(a?.nilai_borongan);
		const paid = live
			.filter((t) => ['partial', 'paid'].includes(t.status))
			.reduce((s, t) => s + num(t.paid_amount), 0);
		return {
			nilai_borongan: nilai,
			total_paid: paid,
			outstanding: Math.max(0, nilai - paid),
			termin_count: live.length,
			status: live.length === 0 ? 'belum_ada_termin'
				: (live.every((t) => t.status === 'paid') && nilai > 0 && paid + 0.01 >= nilai ? 'lunas' : 'berjalan'),
			termins: live
		};
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/**
 * Verifikasi progres sebuah termin (BAP ringan dari HP). Hanya dari status `draft`.
 * Foto dikompres client-side sebelum diunggah (foto HP 4-8 MB → ±200-400 KB).
 *
 * @returns { success, error? }
 */
export async function verifyTermin(
	id: number | string,
	params: { note?: string; files: File[]; by?: string; progressPct?: number | null }
): Promise<{ success: boolean; error?: string }> {
	try {
		const cur: any = await directus.request(
			readItem('manpower_borongan_termin', Number(id), { fields: ['id', 'status'] })
		);
		if (!cur) return { success: false, error: 'Termin tidak ditemukan' };
		if (cur.status !== 'draft') {
			return { success: false, error: `Termin berstatus '${cur.status}' — hanya termin 'draft' yang bisa diverifikasi` };
		}
		const files = (params.files || []).filter(Boolean);
		if (files.length === 0) return { success: false, error: 'Lampirkan minimal 1 foto bukti progres' };

		const token = await getIdToken();
		const photoIds: string[] = [];
		for (const f of files) {
			const compressed = await compressPhoto(f);
			const form = new FormData();
			form.append('file', compressed, compressed.name || 'bap-borongan.jpg');
			const up = await fetch('/api/directus/files', {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}` },
				body: form
			});
			if (!up.ok) return { success: false, error: 'Gagal mengunggah foto' };
			const j = await up.json().catch(() => ({}));
			if (j?.data?.id) photoIds.push(j.data.id);
		}
		if (photoIds.length === 0) return { success: false, error: 'Foto gagal terbentuk' };

		await directus.request(
			updateItem('manpower_borongan_termin', Number(id), {
				status: 'verified',
				verified_date: new Date().toISOString().slice(0, 10),
				verified_by: params.by || null,
				verified_note: params.note || null,
				verified_photos: photoIds,
				verified_progress_pct: params.progressPct == null ? null : num(params.progressPct)
			})
		);
		return { success: true };
	} catch (error: any) {
		handleDirectusError(error);
		return { success: false, error: error?.message || 'Gagal memverifikasi' };
	}
}

export const STATUS_LABEL: Record<string, string> = {
	draft: 'Direncanakan',
	verified: 'Progres Terverifikasi',
	submitted: 'Diajukan ke Finance',
	approved: 'Disetujui, Menunggu Transfer',
	partial: 'Terbayar Sebagian',
	paid: 'Lunas',
	cancelled: 'Dibatalkan'
};
