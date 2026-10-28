// src/routes/api/picking/scan/+server.ts
// Fase 3 — Mobile Picking. Resolve kode QR/manual terhadap baris project_budgets milik
// project ini, kunci baris (locked_by/locked_at) supaya picker lain tidak rebutan, lalu
// buat reservasi stock_reservations. Kode tak dikenali DITOLAK (keputusan 4 Agu 2026),
// tidak ada pembuatan item baru di tempat.
import { error, json, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';
import { parseEpiQr } from '$lib/utils/qrParse';
import { logScanServer } from '$lib/server/scanLog';

const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

interface ProjectBudgetRow {
	id: number;
	project_id: number;
	identitas_barang_id: number | null;
	material_name: string | null;
	qty: number;
	unit: string | null;
	qty_picked: number | null;
	pick_status: string | null;
	locked_by: string | null;
	locked_at: string | null;
}

export async function POST(event: RequestEvent) {
	const user = await requireUser(event);
	const body = await event.request.json().catch(() => ({}));
	const rawCode = String(body?.code || '').trim();
	const projectId = Number(body?.projectId);
	if (!rawCode || !projectId) throw error(400, 'code dan projectId wajib diisi.');

	// Terima QR internal EPI:ITEM:<id> ATAU kode_item/kode_singkat_item manual —
	// resolusi identitas_barang_id dulu, baru dicocokkan ke baris project_budgets.
	let itemId: number | null = null;
	const parsed = parseEpiQr(rawCode);
	if (parsed?.type === 'ITEM') {
		itemId = parsed.id;
	} else {
		const found = await directusServerJson<{ data: Array<{ id: number }> }>(
			`/items/identitas_barang?filter[_or][0][kode_item][_eq]=${encodeURIComponent(rawCode)}&filter[_or][1][kode_singkat_item][_eq]=${encodeURIComponent(rawCode)}&fields=id&limit=1`
		).catch(() => null);
		itemId = found?.data?.[0]?.id ?? null;
	}

	if (!itemId) throw error(404, `Kode tidak dikenali: ${rawCode}`);

	const rowsRes = await directusServerJson<{ data: ProjectBudgetRow[] }>(
		`/items/project_budgets?filter[project_id][_eq]=${projectId}&filter[identitas_barang_id][_eq]=${itemId}&filter[packing_status][_nnull]=true&fields=id,project_id,identitas_barang_id,material_name,qty,unit,qty_picked,pick_status,locked_by,locked_at&limit=100`
	);
	const budgetRows = rowsRes.data || [];
	if (budgetRows.length === 0) {
		throw error(404, 'Barang ini tidak ada di daftar packing project ini.');
	}

	const now = Date.now();

	// 1. Cari baris yang saat ini dikunci oleh user sendiri
	let row = budgetRows.find(
		(r) =>
			r.locked_by === user.email &&
			r.locked_at &&
			now - new Date(r.locked_at).getTime() < LOCK_TIMEOUT_MS
	);

	// 2. Jika tidak ada, cari baris yang belum dikunci (atau kunci kedaluwarsa) dan masih butuh dipicking
	if (!row) {
		row = budgetRows.find((r) => {
			const isLocked =
				r.locked_by &&
				r.locked_at &&
				now - new Date(r.locked_at).getTime() < LOCK_TIMEOUT_MS;
			return !isLocked && (r.qty_picked || 0) < r.qty;
		});
	}

	// 3. Jika tidak ada juga, cari baris yang belum diverifikasi
	if (!row) {
		row = budgetRows.find((r) => {
			const isLocked =
				r.locked_by &&
				r.locked_at &&
				now - new Date(r.locked_at).getTime() < LOCK_TIMEOUT_MS;
			return !isLocked && r.pick_status !== 'verified';
		});
	}

	// 4. Jika masih belum ada, cek apakah semuanya terkunci oleh picker lain
	if (!row) {
		const lockedByOthers = budgetRows.filter(
			(r) =>
				r.locked_by &&
				now - new Date(r.locked_at!).getTime() < LOCK_TIMEOUT_MS
		);
		if (lockedByOthers.length === budgetRows.length) {
			const otherEmails = Array.from(
				new Set(lockedByOthers.map((r) => r.locked_by))
			).join(', ');
			throw error(
				409,
				`Sedang dipegang picker lain (${otherEmails}). Coba lagi sebentar.`
			);
		}

		// Jika semuanya sudah selesai dipicking dan diverifikasi
		const allVerified = budgetRows.every((r) => r.pick_status === 'verified');
		if (allVerified) {
			throw error(400, 'Barang ini sudah selesai dipicking dan diverifikasi.');
		}

		// Fallback ke baris pertama yang tidak terkunci oleh orang lain
		row = budgetRows.find((r) => {
			const isLockedByOther =
				r.locked_by &&
				r.locked_by !== user.email &&
				r.locked_at &&
				now - new Date(r.locked_at).getTime() < LOCK_TIMEOUT_MS;
			return !isLockedByOther;
		});
	}

	if (!row) {
		throw error(409, 'Barang ini sedang dipegang picker lain. Coba lagi sebentar.');
	}

	await directusServerJson(`/items/project_budgets/${row.id}`, {
		method: 'PATCH',
		body: JSON.stringify({ locked_by: user.email, locked_at: new Date().toISOString() })
	});

	const qtyRemaining = Math.max(0, (row.qty || 0) - (row.qty_picked || 0));
	const reservationRes = await directusServerJson<{ data: { id: number } }>('/items/stock_reservations', {
		method: 'POST',
		body: JSON.stringify({
			packing_project_id: projectId,
			item_id: itemId,
			quantity: qtyRemaining,
			status: 'active',
			created_at: new Date().toISOString()
		})
	});

	logScanServer({
		refCollection: 'project_budgets',
		refId: row.id,
		scanType: 'mobile_pick',
		uid: user.localId,
		email: user.email,
		notes: `project_id=${projectId} item_id=${itemId}`
	});

	return json({
		projectBudgetId: row.id,
		itemId,
		namaBarang: row.material_name || `Item #${itemId}`,
		unit: row.unit,
		qtyRequired: row.qty,
		qtyPicked: row.qty_picked || 0,
		qtyRemaining,
		reservationId: reservationRes.data.id
	});
}
