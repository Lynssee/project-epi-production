// src/routes/api/inventory-360/inspeksi-terima/+server.ts
// Inventory 360° Fase C — penerimaan MANUAL di lapangan (stock-lapangan/masuk tanpa PO/SJ): merekam checklist terima dengan
// rujukan dokumen bertoken [stx:<id transaksi stok>] lalu me-relay gate G_INV_SPEC_RECEIVE (mode SHADOW di erp-epi).
// Dipanggil klien SETELAH transaksi stok tersimpan; best-effort — kegagalan tidak memengaruhi penerimaan fisik.
// Rujukan dokumen disusun SERVER dari id transaksi; klien hanya boleh menyebut koleksi yang diizinkan.

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { recordInspectionsForDocument } from '$lib/server/inventoryInspectionRecorder';
import { reportInventorySpecShadow } from '$lib/server/inventorySpecShadow';

/** Hanya dokumen penerimaan manual — koleksi lain tidak boleh dipalsukan lewat endpoint ini. */
const ALLOWED_COLLECTIONS = new Set(['items/stock_transactions']);

export async function POST(event: RequestEvent) {
	const user = await requireUser(event);
	const body = await event.request.json().catch(() => null);
	const collection = String(body?.collection ?? '');
	const recordId = String(body?.recordId ?? '').trim().slice(0, 64);
	if (!ALLOWED_COLLECTIONS.has(collection) || !recordId) throw error(400, 'Dokumen tidak valid.');

	const itemIds = (Array.isArray(body?.identitasBarangIds) ? body.identitasBarangIds : []).slice(0, 200);
	const email = user.email ?? null;
	const rec = await recordInspectionsForDocument({
		inspeksi: body?.inspeksi ?? null,
		collection,
		recordId,
		label: String(body?.label ?? '').slice(0, 80),
		userEmail: email
	});
	reportInventorySpecShadow({ kind: 'receive', collection, recordId, itemIds, userEmail: email });
	return json({ ok: true, saved: rec.saved });
}

export async function GET() {
	throw error(405, 'Gunakan POST');
}
