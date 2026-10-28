// src/routes/api/preventive/quick-hm/+server.ts
// Fase 3 MLE (Rencana Final Material/Logistik/Equipment, 10 Agu 2026, "Lapangan" round):
// Quick Log HM — update hour meter equipment TANPA lewat P2H penuh. Sengaja tidak menyentuh
// p2h_session (itu dipakai guard idempotensi "P2H hari ini sudah diisi" di p2h/submit,
// mencatat quick-HM di sana akan salah memicu guard itu). Audit trail lewat
// maintenance_activity_log yang SUDAH ADA (dipakai getEquipmentTimeline/logActivity di
// preventive.ts) — bukan koleksi baru.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticatePreventiveOperator } from '$lib/server/preventive/preventiveGuard';
import { directusServerJson } from '$lib/server/directus';

export const POST: RequestHandler = async (event) => {
	const { karyawan, personnel } = await authenticatePreventiveOperator(event);

	const body = await event.request.json().catch(() => null);
	const equipmentId = body?.equipment_id ? String(body.equipment_id) : '';
	const hoursmeter = typeof body?.hoursmeter === 'number' ? body.hoursmeter : null;
	const notes = body?.notes ? String(body.notes).trim() : null;

	if (!equipmentId) throw error(400, 'equipment_id wajib diisi.');
	if (hoursmeter == null || !Number.isFinite(hoursmeter) || hoursmeter < 0) {
		throw error(400, 'hoursmeter wajib angka >= 0.');
	}

	const eqRes = await directusServerJson<{ data: any }>(
		`/items/equipment/${equipmentId}?fields=id,name,code,last_hoursmeter`
	).catch(() => null);
	const equipment = eqRes?.data;
	if (!equipment) throw error(404, 'Equipment tidak ditemukan.');

	const previousHM = equipment.last_hoursmeter;
	if (previousHM != null && hoursmeter < previousHM) {
		throw error(400, `HM baru (${hoursmeter}) lebih kecil dari HM terakhir (${previousHM}). Kalau ini koreksi, hubungi admin.`);
	}

	await directusServerJson(`/items/equipment/${equipmentId}`, {
		method: 'PATCH',
		body: JSON.stringify({ last_hoursmeter: hoursmeter })
	});

	await directusServerJson('/items/maintenance_activity_log', {
		method: 'POST',
		body: JSON.stringify({
			user_name: personnel.name || karyawan.nama_karyawan,
			action: 'quick_hm_log',
			entity_type: 'equipment',
			entity_id: equipmentId,
			summary: `Quick Log HM: ${equipment.name} (${equipment.code || '-'}) ${previousHM ?? '-'} → ${hoursmeter}`,
			metadata: { previous_hoursmeter: previousHM, new_hoursmeter: hoursmeter, notes }
		})
	}).catch(() => {}); // non-fatal: log gagal tidak boleh membatalkan update HM yang sudah tersimpan

	return json({ success: true, equipmentId, previousHM, newHM: hoursmeter });
};
