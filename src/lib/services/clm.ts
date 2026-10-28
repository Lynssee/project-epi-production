// src/lib/services/clm.ts
// Component Lifecycle Management (CLM v2) — sisi lapangan (project-epi).
// Mekanik/operator HANYA melihat kondisi & identitas komponen — TIDAK ada rupiah
// (keputusan 30 Agu 2026; harga urusan admin di erp-epi-1).
//
// Master data & pencetakan label dikelola di erp-epi-1 (/maintenance/komponen).
// Di sini kita: (1) resolve QR EPI:COMP:<id>, (2) tulis component_inspection_log.

import directus, { handleDirectusError } from './directus';
import { readItem, readItems, createItem } from '@directus/sdk';

export interface ComponentUnitLite {
	id: number;
	kode_unit: string | null;
	serial_number: string | null;
	status_fisik: string;
	nama: string; // dari component_master
	kategori: string;
	merek: string | null;
	equipmentId: string | null;
	equipmentName: string | null;
	warranty_expiry: string | null;
}

/** Ambil satu unit komponen + tipe + alat tempat terpasang. null bila tak ada. */
export async function getComponentUnitById(id: number | string): Promise<ComponentUnitLite | null> {
	try {
		const u: any = await directus.request(
			readItem('component_unit', id as any, {
				fields: [
					'id',
					'kode_unit',
					'serial_number',
					'status_fisik',
					'warranty_expiry',
					'component_master_id.nama',
					'component_master_id.kategori',
					'component_master_id.merek',
					'equipment_id.id',
					'equipment_id.name'
				]
			})
		);
		if (!u) return null;
		return {
			id: Number(u.id),
			kode_unit: u.kode_unit ?? null,
			serial_number: u.serial_number ?? null,
			status_fisik: u.status_fisik,
			nama: u.component_master_id?.nama ?? `Komponen #${u.id}`,
			kategori: u.component_master_id?.kategori ?? '-',
			merek: u.component_master_id?.merek ?? null,
			equipmentId: u.equipment_id?.id ?? null,
			equipmentName: u.equipment_id?.name ?? null,
			warranty_expiry: u.warranty_expiry ?? null
		};
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

/** Cari unit terpasang pada satu equipment (untuk section verifikasi di P2H). */
export async function getComponentUnitsForEquipment(equipmentId: string): Promise<ComponentUnitLite[]> {
	try {
		const rows: any[] = (await directus.request(
			readItems('component_unit', {
				filter: {
					equipment_id: { _eq: equipmentId },
					status_fisik: { _in: ['terpasang', 'dilepas_sementara'] }
				},
				fields: [
					'id',
					'kode_unit',
					'serial_number',
					'status_fisik',
					'warranty_expiry',
					'component_master_id.nama',
					'component_master_id.kategori',
					'component_master_id.merek'
				],
				sort: ['component_master_id.kategori'],
				limit: -1
			})
		)) as any[];
		return (rows || []).map((u) => ({
			id: Number(u.id),
			kode_unit: u.kode_unit ?? null,
			serial_number: u.serial_number ?? null,
			status_fisik: u.status_fisik,
			nama: u.component_master_id?.nama ?? `Komponen #${u.id}`,
			kategori: u.component_master_id?.kategori ?? '-',
			merek: u.component_master_id?.merek ?? null,
			equipmentId,
			equipmentName: null,
			warranty_expiry: u.warranty_expiry ?? null
		}));
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export interface RecordInspectionInput {
	component_unit_id: number | null;
	equipment_id: string;
	p2h_session_id?: string | null;
	scanned_code: string;
	scan_method?: 'scan' | 'manual';
	match_status: 'match' | 'mismatch' | 'unknown_code';
	kondisi?: 'baik' | 'perlu_perhatian' | 'rusak' | null;
	foto?: string | null;
	catatan?: string | null;
	operatorName?: string | null;
}

/**
 * Tulis satu baris component_inspection_log. `inspected_by` (M2O directus_users) tidak
 * diisi dari lapangan — proxy pakai satu service account, bukan akun orang. Identitas
 * operator dititipkan di `catatan` + tertaut lewat p2h_session_id bila dari P2H.
 */
export async function recordComponentInspection(input: RecordInspectionInput) {
	const catatanParts: string[] = [];
	if (input.operatorName) catatanParts.push(`Operator: ${input.operatorName}`);
	if (input.catatan) catatanParts.push(input.catatan);

	try {
		return await directus.request(
			createItem('component_inspection_log', {
				component_unit_id: input.component_unit_id,
				equipment_id: input.equipment_id,
				p2h_session_id: input.p2h_session_id ?? null,
				scanned_code: input.scanned_code,
				scan_method: input.scan_method ?? 'scan',
				match_status: input.match_status,
				kondisi: input.kondisi ?? null,
				foto: input.foto ?? null,
				catatan: catatanParts.join(' — ') || null,
				inspected_at: new Date().toISOString()
			})
		);
	} catch (error) {
		handleDirectusError(error);
		throw error;
	}
}
