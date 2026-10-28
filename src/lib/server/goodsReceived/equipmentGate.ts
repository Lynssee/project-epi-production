// src/lib/server/goodsReceived/equipmentGate.ts
// Fase 8 (Revamp Project Management v2 tambahan, 3 Agu 2026): gate wajib checklist equipment
// sebelum Goods Received (surat_jalan) bisa dikonfirmasi. Gated di belakang system_settings
// 'project.feature.sj_equipment_gate_enabled' (default false) — sengaja dibuat sekecil & sesempit
// mungkin karena endpoint /api/goods-received/confirm menangani GR untuk SEMUA SJ perusahaan:
// gate ini hanya aktif bila flag ON *dan* SJ yang dikonfirmasi punya baris equipment_id.
//
// Reuse penuh pipeline checklist P2H yang sudah ada (equipment_loan_checklist), tidak menulis
// sistem checklist baru. Lihat erp-epi-1/src/lib/services/packingListApi.js::
// syncEquipmentInventoryFromDelivery untuk sisi yang membuat checklist ini saat SJ delivered.

import { error } from '@sveltejs/kit';
import { directusServerJson } from '$lib/server/directus';

let flagCache: { value: boolean; at: number } | null = null;
const FLAG_TTL_MS = 60 * 1000; // cache pendek — cukup untuk satu burst request, tidak butuh 5 menit di server

async function isGateEnabled(): Promise<boolean> {
	if (flagCache && Date.now() - flagCache.at < FLAG_TTL_MS) return flagCache.value;
	try {
		const res = await directusServerJson<{ data: Array<{ setting_value: string }> }>(
			`/items/system_settings?filter[setting_key][_eq]=project.feature.sj_equipment_gate_enabled&limit=1`
		);
		const raw = res?.data?.[0]?.setting_value;
		const value = raw != null ? Boolean(JSON.parse(raw)) : false;
		flagCache = { value, at: Date.now() };
		return value;
	} catch {
		return false; // gagal-lunak: Directus tak terjangkau -> gate tidak menghalangi GR
	}
}

/**
 * Lempar error 409 bila SJ ini punya baris equipment_id yang belum punya checklist
 * serah-terima terisi (equipment_loan_checklist.status masih null = belum diisi PIC).
 * No-op bila flag mati atau SJ tidak punya baris equipment sama sekali.
 */
export async function assertEquipmentChecklistGate(suratJalanId: number, projectId: number | null): Promise<void> {
	if (!(await isGateEnabled())) return;

	const itemsRes = await directusServerJson<{ data: Array<{ id: number; equipment_id: string | null; nama_barang: string }> }>(
		`/items/surat_jalan_items?filter[surat_jalan_id][_eq]=${suratJalanId}&filter[equipment_id][_nnull]=true&fields=id,equipment_id,nama_barang&limit=-1`
	).catch(() => null);
	const equipmentLines = itemsRes?.data || [];
	if (equipmentLines.length === 0) return;

	if (!projectId) {
		// Equipment tanpa proyek (mis. dispatch bengkel) — di luar lingkup gate packing-list ini.
		return;
	}

	const missing: string[] = [];
	for (const line of equipmentLines) {
		if (!line.equipment_id) continue;
		const checklistRes = await directusServerJson<{ data: Array<{ id: number; status: string | null }> }>(
			`/items/equipment_loan_checklist?filter[equipment_id][_eq]=${line.equipment_id}&filter[project_id][_eq]=${projectId}` +
				`&filter[jenis][_eq]=serah_terima&sort=-date_created&limit=1&fields=id,status`
		).catch(() => null);
		const checklist = checklistRes?.data?.[0];
		if (!checklist || checklist.status == null) {
			missing.push(line.nama_barang || line.equipment_id);
		}
	}

	if (missing.length > 0) {
		throw error(
			409,
			`Checklist serah-terima belum diisi untuk equipment: ${missing.join(', ')}. ` +
				`Lengkapi checklist P2H equipment tersebut sebelum Goods Received bisa dikonfirmasi.`
		);
	}
}
