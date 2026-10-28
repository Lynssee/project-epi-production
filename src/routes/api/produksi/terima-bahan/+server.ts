// src/routes/api/produksi/terima-bahan/+server.ts
// Fase 3 (12 Okt 2026): Kepala Regu menerima bahan baku SPK dari akunnya sendiri + mengusulkan retur
// sisa bahan. HANYA tracking (kolom material_* di koleksi spk) — tidak menyentuh stok.
// Identitas penerima SELALU diresolve server-side dari token (bukan dari body klien).
//   GET  -> daftar SPK aktif yang bahan bakunya sedang/sudah disiapkan gudang
//   POST { spkId, action: 'receive', note? } | { spkId, action: 'return', rows: [{item_id,nama,qty_kg,note}] }

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { requirePermission } from '$lib/server/rbacServer';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { directusServerJson } from '$lib/server/directus';
import { CHAIN_STATUSES, planReceipt, planReturn, netConsumedByItem } from '$lib/server/produksi/terimaBahan';

const PERMISSION = 'input_produksi_harian';
const FIELDS =
	'id,nomor,status,jumlah_produksi,unit,total_kg,production_deadline,material_pick_status,material_pick_started_at,material_ready_at,material_handover_at,material_picked_by,material_received_by,material_received_karyawan_id,material_lot_data,material_handover_note,material_receipt_note,material_return_status,material_return_data,material_return_at';

async function authenticate(event: Parameters<RequestHandler>[0]) {
	const user = await requireUser(event);
	await requirePermission(event, user.localId, PERMISSION);
	const karyawan = await resolveKaryawanByEmail(user.email);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');
	return karyawan;
}

/**
 * Sisa terpotong per SPK per bahan dari ledger (OUT - IN), satu query untuk banyak SPK (Aturan #2: terpisah
 * dari query spk). Transaksi retur milik SPK itu sendiri dikecualikan supaya validasi tetap benar saat gudang
 * sudah memproses sebagian. Gagal baca = null (jangan menebak batas): pemanggil memutuskan.
 */
async function loadConsumedBySpk(spkIds: number[]): Promise<Record<number, Record<number, number>> | null> {
	if (spkIds.length === 0) return {};
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/stock_transactions?filter[spk_id][_in]=${spkIds.join(',')}&filter[transaction_type][_in]=OUT,IN` +
				`&fields=spk_id,item_id,transaction_type,quantity,client_txn_id&limit=-1`
		);
		const bySpk: Record<number, any[]> = {};
		for (const r of res?.data || []) {
			const sid = Number(r.spk_id);
			if (!(sid > 0)) continue;
			if (new RegExp(`^spk-${sid}-item-\\d+-return$`).test(String(r.client_txn_id || ''))) continue;
			(bySpk[sid] ||= []).push(r);
		}
		return Object.fromEntries(spkIds.map((id) => [id, netConsumedByItem(bySpk[id] || [])]));
	} catch (e) {
		console.error('[produksi/terima-bahan] gagal membaca ledger stok:', e);
		return null;
	}
}

export const GET: RequestHandler = async (event) => {
	await authenticate(event);
	const query = new URLSearchParams({
		'filter[status][_in]': CHAIN_STATUSES.join(','),
		'filter[material_pick_status][_in]': 'picking,ready,handed_over',
		fields: FIELDS,
		sort: '-id',
		limit: '60'
	});
	let rows: any[] = [];
	try {
		const res = await directusServerJson<{ data: any[] }>(`/items/spk?${query.toString()}`);
		rows = res?.data || [];
	} catch (e: any) {
		console.error('[produksi/terima-bahan] gagal membaca spk:', e);
		throw error(502, e?.message || 'Gagal memuat daftar SPK.');
	}

	// Bahan yang bisa diretur = yang terpotong (OUT-01) untuk SPK yang sudah diterima di lantai produksi.
	const handedIds = rows.filter((r) => r.material_pick_status === 'handed_over').map((r) => Number(r.id));
	const consumedBySpk = await loadConsumedBySpk(handedIds);

	// Nama bahan (lot data gudang + bahan terpotong): SATU query terpisah (Aturan Directus #2), bukan relasi bersarang.
	const itemIds = [
		...new Set([
			...rows.flatMap((r) => (Array.isArray(r.material_lot_data) ? r.material_lot_data : [])).map((l: any) => Number(l?.item_id)),
			...Object.values(consumedBySpk || {}).flatMap((m) => Object.keys(m).map(Number))
		].filter((n) => n > 0))
	];
	const names: Record<number, string> = {};
	if (itemIds.length > 0) {
		try {
			const ib = await directusServerJson<{ data: Array<{ id: number; nama_barang_lengkap: string | null }> }>(
				`/items/identitas_barang?filter[id][_in]=${itemIds.join(',')}&fields=id,nama_barang_lengkap&limit=-1`
			);
			for (const r of ib?.data || []) names[r.id] = r.nama_barang_lengkap || `Barang #${r.id}`;
		} catch (e) {
			console.warn('[produksi/terima-bahan] gagal resolve nama bahan:', e);
		}
	}
	const spk = rows.map((r) => ({
		...r,
		// null = ledger gagal dibaca (UI menampilkan peringatan, bukan daftar kosong yang menyesatkan)
		retur_bahan:
			r.material_pick_status !== 'handed_over'
				? []
				: consumedBySpk === null
					? null
					: Object.entries(consumedBySpk[Number(r.id)] || {})
							.filter(([, net]) => net > 0)
							.map(([id, net]) => ({ item_id: Number(id), nama: names[Number(id)] || `Barang #${id}`, maks_kg: net })),
		material_lot_data: (Array.isArray(r.material_lot_data) ? r.material_lot_data : []).map((l: any) => ({
			...l,
			nama: names[Number(l?.item_id)] || (l?.item_id ? `Barang #${l.item_id}` : 'Bahan')
		}))
	}));
	return json({ spk });
};

export const POST: RequestHandler = async (event) => {
	const karyawan = await authenticate(event);
	const body = await event.request.json().catch(() => null);
	const spkId = Number(body?.spkId);
	const action = body?.action;
	if (!Number.isFinite(spkId) || spkId <= 0) throw error(400, 'spkId tidak valid.');
	if (action !== 'receive' && action !== 'return') throw error(400, 'Aksi tidak dikenal.');

	let current: any;
	try {
		current = (await directusServerJson<{ data: any }>(`/items/spk/${spkId}?fields=${FIELDS}`))?.data;
	} catch (e: any) {
		throw error(e?.status === 404 ? 404 : 502, e?.message || 'Gagal membaca SPK.');
	}
	if (!current) throw error(404, 'SPK tidak ditemukan.');

	let consumed: Record<number, number> | null = null;
	if (action === 'return') {
		const all = await loadConsumedBySpk([spkId]);
		if (all === null) throw error(502, 'Ledger stok SPK gagal dibaca; coba lagi sebentar.');
		consumed = all[spkId] || {};
	}
	const plan =
		action === 'receive'
			? planReceipt(current, { karyawanId: karyawan.id, karyawanNama: karyawan.nama_karyawan, note: body?.note })
			: planReturn(current, { karyawanNama: karyawan.nama_karyawan, rows: body?.rows, consumed });
	if (!plan.ok) throw error(plan.code, plan.message);
	if (plan.noop) return json({ spk: current, changed: false });

	try {
		const updated = await directusServerJson<{ data: any }>(`/items/spk/${spkId}?fields=${FIELDS}`, {
			method: 'PATCH',
			body: JSON.stringify(plan.patch)
		});
		return json({ spk: updated?.data ?? { ...current, ...plan.patch }, changed: true });
	} catch (e: any) {
		console.error('[produksi/terima-bahan] gagal PATCH spk', spkId, e);
		throw error(502, e?.message || 'Gagal menyimpan.');
	}
};
