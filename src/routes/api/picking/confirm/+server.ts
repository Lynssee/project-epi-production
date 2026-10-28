// src/routes/api/picking/confirm/+server.ts
// Fase 3 — Mobile Picking. Konfirmasi qty hasil scan: kurangi stok lewat
// sjiStockMovement (port fail-closed yang sudah ada, gudangId wajib), update baris
// project_budgets, lepas kunci & konsumsi reservasi. Gagal stok = seluruh transisi
// dibatalkan (fail-closed), bukan ditelan.
import { error, json, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';
import { sjiStockMovement } from '$lib/server/sjiStockMovement';

interface ProjectBudgetRow {
	id: number;
	project_id: number;
	identitas_barang_id: number | null;
	qty: number;
	qty_picked: number | null;
	locked_by: string | null;
}

export async function POST(event: RequestEvent) {
	const user = await requireUser(event);
	const body = await event.request.json().catch(() => ({}));
	const projectBudgetId = Number(body?.projectBudgetId);
	const reservationId = Number(body?.reservationId);
	const qty = parseFloat(body?.qty);
	if (!projectBudgetId || !qty || qty <= 0) throw error(400, 'projectBudgetId dan qty (>0) wajib diisi.');

	const rowRes = await directusServerJson<{ data: ProjectBudgetRow }>(
		`/items/project_budgets/${projectBudgetId}?fields=id,project_id,identitas_barang_id,qty,qty_picked,locked_by`
	).catch(() => null);
	const row = rowRes?.data;
	if (!row) throw error(404, 'Baris packing tidak ditemukan.');
	if (row.locked_by !== user.email) {
		throw error(403, 'Kunci baris ini sudah lepas atau direbut orang lain — scan ulang.');
	}
	if (!row.identitas_barang_id) throw error(400, 'Baris ini tidak tertaut ke item identitas_barang.');

	const projectRes = await directusServerJson<{ data: { gudang_id: number | null } }>(
		`/items/projects/${row.project_id}?fields=gudang_id`
	);
	const gudangId = projectRes?.data?.gudang_id;
	if (!gudangId) throw error(400, 'Gudang sumber belum diset untuk project ini — hubungi admin.');

	// Fail-closed: kalau ini throw, TIDAK ADA perubahan project_budgets/reservasi di bawah.
	await sjiStockMovement({
		itemId: row.identitas_barang_id,
		type: 'OUT',
		quantity: qty,
		referenceNo: `PICK-${projectBudgetId}-${Date.now()}`,
		notes: `Picking Fase 3 oleh ${user.email}`,
		category: 'FIELD_PICKING',
		gudangId
	});

	const newQtyPicked = (row.qty_picked || 0) + qty;
	await directusServerJson(`/items/project_budgets/${projectBudgetId}`, {
		method: 'PATCH',
		body: JSON.stringify({
			qty_picked: newQtyPicked,
			picked_at: new Date().toISOString(),
			picked_by: user.email,
			locked_by: null,
			locked_at: null,
			pick_status: 'picked'
		})
	});

	if (reservationId) {
		await directusServerJson(`/items/stock_reservations/${reservationId}`, {
			method: 'PATCH',
			body: JSON.stringify({ status: 'consumed', released_at: new Date().toISOString() })
		}).catch((e) => console.warn('[picking/confirm] gagal konsumsi reservasi (non-fatal):', e));
	}

	return json({ ok: true, qtyPicked: newQtyPicked, qtyRequired: row.qty });
}
