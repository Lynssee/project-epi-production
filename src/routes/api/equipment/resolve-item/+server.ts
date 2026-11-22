// src/routes/api/equipment/resolve-item/+server.ts
// Jembatan stiker lama EPI:ITEM:<id> → equipment. Kendaraan/alat yang stikernya sudah telanjur tercetak sebagai ITEM
// tidak perlu dicetak ulang: bila master barang punya id_equipment (atau equipment.identitas_barang_id) yang cocok,
// klien dialihkan ke alur EPI:EQUIPMENT. Barang stok biasa dikembalikan dengan nama & kode lengkap (untuk prefill form stok).
// Identitas pemanggil dari token (authenticateEss). Hanya BACA.

import { error, json, type RequestEvent } from '@sveltejs/kit';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { bridgeItemToEquipment } from '$lib/server/equipmentHub';

export async function POST(event: RequestEvent) {
	await authenticateEss(event);
	const body = await event.request.json().catch(() => ({}));
	const itemId = Number(body?.itemId);
	if (!Number.isInteger(itemId) || itemId <= 0) throw error(400, 'itemId tidak valid.');

	let result;
	try {
		result = await bridgeItemToEquipment(itemId);
	} catch (e) {
		console.error('[api/equipment/resolve-item] gagal membaca master barang:', e instanceof Error ? e.message : e);
		throw error(502, 'Gagal membaca data barang. Coba lagi.');
	}
	if (result.kind === 'not_found') throw error(404, `Barang #${itemId} tidak ditemukan.`);
	if (result.kind === 'equipment') {
		return json({ kind: 'equipment', code: result.equipment.code, equipmentId: result.equipment.id, name: result.equipment.name, item: result.item });
	}
	return json({ kind: 'item', item: result.item });
}
