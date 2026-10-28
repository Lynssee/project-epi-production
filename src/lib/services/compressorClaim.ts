// src/lib/services/compressorClaim.ts
// Fase 4b — Klaim Operasional Kompresor untuk Project Leader (project-epi).
//
// Lingkup lapangan: leader hanya menyusun / mengoreksi DRAFT (status 'draft').
// Verifikasi & pengajuan (draft -> diajukan, tempat Gate Kepatuhan Kompresor
// ditegakkan) dilakukan admin di dashboard admin (erp-epi). Kartu di sini menampilkan
// status prasyarat (P2H unit, penutupan pemakaian, Laporan Harian proyek) sebagai
// panduan — bukan gate yang mengunci.

import directus, { handleDirectusError } from './directus';
import { readItems, createItem, updateItem } from '@directus/sdk';
import { COMPRESSOR_CATEGORY_IDS } from './preventive';

export type P2hStatus = 'terisi' | 'bolong' | 'belum' | 'libur';

export interface CompressorUnitPrereq {
	equipment_id: string;
	code: string;
	name: string;
	p2h_status: P2hStatus;
	p2h_session_id: string | null;
	pemakaian_ditutup: boolean;
	claim: CompressorClaimRow | null;
}

export interface CompressorClaimRow {
	id: string;
	status: 'draft' | 'diajukan' | 'diverifikasi' | 'ditolak';
	tanggal: string;
	project_id: number | null;
	equipment_id: string | null;
	unit_ownership: 'milik' | 'sewa';
	unit_label: string | null;
	vendor_name: string | null;
	idle: boolean;
	jam_operasi: number | null;
	solar_liter: number | null;
	solar_rp: number | null;
	sewa_rp: number | null;
	total_klaim_rp: number | null;
	gate_status: string | null;
	catatan: string | null;
}

export interface ProjectCompressorPrereq {
	tanggal: string;
	laporan_harian_ada: boolean;
	units: CompressorUnitPrereq[];
}

function todayWib(): string {
	return new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
}
const asId = (v: any) => (v && typeof v === 'object' ? v.id : v);

/**
 * Status prasyarat klaim kompresor untuk satu proyek pada satu tanggal.
 * Fetch dipisah per relasi (hindari nested expansion yang rapuh).
 */
export async function getProjectCompressorPrereq(
	projectId: number | string,
	tanggal: string = todayWib()
): Promise<ProjectCompressorPrereq> {
	try {
		// 1) Unit + status P2H hari itu dari papan kepatuhan.
		const complianceRows = (await directus.request(
			readItems('checklist_compliance_day', {
				filter: { project_id: { _eq: projectId }, tanggal: { _eq: tanggal } },
				fields: ['equipment_id', 'status', 'p2h_session_id'],
				limit: -1
			})
		)) as any[];

		let equipmentIds = complianceRows.map((r) => String(asId(r.equipment_id))).filter(Boolean);

		// 2) Fallback: kompresor terpasang di proyek (project_equipment aktif) bila papan
		//    kepatuhan belum digenerate pagi itu.
		if (equipmentIds.length === 0) {
			const pe = (await directus.request(
				readItems('project_equipment', {
					filter: { project_id: { _eq: projectId }, deployment_status: { _eq: 'aktif' } },
					fields: ['equipment_id'],
					limit: -1
				})
			)) as any[];
			equipmentIds = pe.map((r) => String(asId(r.equipment_id))).filter(Boolean);
		}
		equipmentIds = [...new Set(equipmentIds)];

		// 3) Detail equipment — hanya kategori kompresor.
		const equipmentRows = equipmentIds.length
			? ((await directus.request(
					readItems('equipment', {
						filter: { id: { _in: equipmentIds }, category_id: { _in: COMPRESSOR_CATEGORY_IDS } },
						fields: ['id', 'code', 'name'],
						limit: -1
					})
				)) as any[])
			: [];
		const compressorIds = equipmentRows.map((e) => String(e.id));

		// 4) Sesi P2H hari itu (jam_selesai_pakai untuk status "ditutup").
		const p2hRows = compressorIds.length
			? ((await directus.request(
					readItems('p2h_session', {
						filter: { equipment_id: { _in: compressorIds }, date: { _eq: tanggal } },
						fields: ['id', 'equipment_id', 'jam_selesai_pakai', 'overall_result'],
						limit: -1
					})
				)) as any[])
			: [];
		const p2hByEq = new Map<string, any>();
		for (const r of p2hRows) p2hByEq.set(String(asId(r.equipment_id)), r);

		// 5) Klaim yang sudah ada.
		const claimRows = compressorIds.length
			? ((await directus.request(
					readItems('compressor_daily_claim', {
						filter: { project_id: { _eq: projectId }, tanggal: { _eq: tanggal }, equipment_id: { _in: compressorIds } },
						fields: [
							'id', 'status', 'tanggal', 'project_id', 'equipment_id', 'unit_ownership', 'unit_label',
							'vendor_name', 'idle', 'jam_operasi', 'solar_liter', 'solar_rp', 'sewa_rp',
							'total_klaim_rp', 'gate_status', 'catatan'
						],
						limit: -1
					})
				)) as any[])
			: [];
		const claimByEq = new Map<string, CompressorClaimRow>();
		for (const c of claimRows) claimByEq.set(String(asId(c.equipment_id)), c as CompressorClaimRow);

		// 6) Laporan Harian proyek hari itu.
		const reportRows = (await directus.request(
			readItems('reports', {
				filter: { project_id: { _eq: projectId }, date: { _eq: tanggal } },
				fields: ['id'],
				limit: 1
			})
		)) as any[];

		const complianceStatusByEq = new Map<string, string>();
		for (const r of complianceRows) complianceStatusByEq.set(String(asId(r.equipment_id)), r.status);

		const units: CompressorUnitPrereq[] = equipmentRows.map((e) => {
			const eqId = String(e.id);
			const p2h = p2hByEq.get(eqId);
			const compStatus = complianceStatusByEq.get(eqId);
			let p2h_status: P2hStatus = 'belum';
			if (compStatus === 'terisi') p2h_status = 'terisi';
			else if (compStatus === 'bolong') p2h_status = 'bolong';
			else if (compStatus === 'dikecualikan_libur') p2h_status = 'libur';
			else if (p2h?.id) p2h_status = 'terisi';
			return {
				equipment_id: eqId,
				code: e.code || '-',
				name: e.name || `Unit ${eqId}`,
				p2h_status,
				p2h_session_id: p2h?.id || null,
				pemakaian_ditutup: !!p2h?.jam_selesai_pakai,
				claim: claimByEq.get(eqId) || null
			};
		});

		return { tanggal, laporan_harian_ada: reportRows.length > 0, units };
	} catch (e) {
		handleDirectusError(e);
		return { tanggal, laporan_harian_ada: false, units: [] };
	}
}

export interface CompressorClaimDraftInput {
	id?: string;
	project_id: number | string;
	equipment_id: string;
	tanggal: string;
	unit_ownership?: 'milik' | 'sewa';
	unit_label?: string | null;
	vendor_name?: string | null;
	idle?: boolean;
	jam_operasi?: number | null;
	solar_liter?: number | null;
	solar_rp?: number | null;
	sewa_rp?: number | null;
	catatan?: string | null;
}

/** Simpan DRAFT klaim (create/patch). Tidak pernah mengubah status ke 'diajukan'. */
export async function saveCompressorClaimDraft(input: CompressorClaimDraftInput): Promise<CompressorClaimRow> {
	const idle = input.idle === true;
	const solarRp = idle ? 0 : Number(input.solar_rp ?? 0) || 0;
	const sewaRp = idle ? 0 : Number(input.sewa_rp ?? 0) || 0;
	const payload: Record<string, any> = {
		project_id: input.project_id,
		equipment_id: input.equipment_id,
		tanggal: input.tanggal,
		unit_ownership: input.unit_ownership === 'sewa' ? 'sewa' : 'milik',
		unit_label: input.unit_label?.trim() || null,
		vendor_name: input.vendor_name?.trim() || null,
		idle,
		jam_operasi: idle ? null : input.jam_operasi ?? null,
		solar_liter: idle ? null : input.solar_liter ?? null,
		solar_rp: solarRp,
		sewa_rp: sewaRp,
		total_klaim_rp: idle ? 0 : solarRp + sewaRp,
		catatan: input.catatan?.trim() || null
	};

	try {
		if (input.id) {
			const existing = (await directus.request(
				readItems('compressor_daily_claim', { filter: { id: { _eq: input.id } }, fields: ['status'], limit: 1 })
			)) as any[];
			if (existing[0] && existing[0].status !== 'draft') {
				throw new Error(`Klaim berstatus "${existing[0].status}" tidak bisa diubah dari lapangan. Hubungi admin.`);
			}
			return (await directus.request(updateItem('compressor_daily_claim', input.id, payload))) as CompressorClaimRow;
		}
		return (await directus.request(
			createItem('compressor_daily_claim', { ...payload, status: 'draft' })
		)) as CompressorClaimRow;
	} catch (e) {
		handleDirectusError(e);
		throw e;
	}
}
