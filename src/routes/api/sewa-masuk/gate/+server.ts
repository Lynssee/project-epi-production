// src/routes/api/sewa-masuk/gate/+server.ts
// Fase 4, Rencana Pertajam Rental Order v2 — gerbang QR untuk sewa_masuk (kita MENYEWA alat
// dari vendor, rental_in). TERPISAH TOTAL dari api/rental-order/gate-retur (Peminjaman
// External, arah berlawanan: kita meminjamkan KELUAR) -- lihat keputusan user 17 Sep 2026.
//
// Payload QR: EPI:SWA:<id>:<token> (id = sewa_masuk.id, token = sewa_masuk.qr_token).
//
// Siklus (§5.3 dokumen rencana, disederhanakan ke 1 arah saja):
//   menunggu_datang -> di_gudang   : gate kedatangan (IN-17) -- qty 0 -> N
//   di_gudang       -> selesai     : gate retur ke vendor (OUT-13) -- qty N -> 0
//
// GET  ?code=<hasil scan>                        -> info sewa_masuk + item untuk direview satpam
// POST { code, gudangId? }                       -> proses transisi yang berlaku (aksi ditentukan status saat ini, bukan input klien)

import { error, json, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getUserPermissions, hasAnyPermission } from '$lib/server/rbacServer';
import { directusServerJson } from '$lib/server/directus';
import { parseEpiQr } from '$lib/utils/qrParse';
import { sewaMasukStockMovement, daftarkanEquipmentUntukSewaMasuk } from '$lib/server/sewaMasukStockMovement';

async function requireSatpam(event: RequestEvent) {
	const user = await requireUser(event);
	const authHeader = event.request.headers.get('authorization') || '';
	const idToken = authHeader.replace(/^Bearer\s+/i, '');
	const { permissions } = await getUserPermissions(idToken, user.localId, { email: user.email });
	if (!hasAnyPermission(permissions, 'gate_log')) throw error(403, 'Hanya Satpam yang boleh memproses gerbang sewa.');
	return user;
}

function resolveGateAction(status: string): 'kedatangan' | 'retur' | null {
	if (status === 'menunggu_datang' || status === 'booked') return 'kedatangan';
	if (status === 'di_gudang' || status === 'di_site') return 'retur';
	return null;
}

async function resolveSewaMasuk(code: string) {
	const parsed = parseEpiQr(code);
	if (!parsed || parsed.type !== 'SWA' || !parsed.token) return null;
	return { sewaMasukId: Number(parsed.id), token: parsed.token };
}

export async function GET(event: RequestEvent) {
	await requireSatpam(event);
	const code = event.url.searchParams.get('code') || '';
	const resolved = await resolveSewaMasuk(code);
	if (!resolved) throw error(400, 'Kode QR bukan Sewa Masuk yang dikenali.');

	const headerRes = await directusServerJson<{ data: any }>(
		`/items/sewa_masuk/${resolved.sewaMasukId}?fields=id,qr_token,status,vendor_contact_id.name,project_id.name`
	).catch(() => null);
	const header = headerRes?.data;
	if (!header) throw error(404, 'Sewa masuk tidak ditemukan.');
	if (!header.qr_token || header.qr_token !== resolved.token) throw error(400, 'Token QR tidak cocok.');

	const action = resolveGateAction(header.status);
	if (!action) throw error(409, `Sewa masuk ini berstatus '${header.status}' — tidak ada aksi gerbang yang berlaku.`);

	const itemsRes = await directusServerJson<{ data: any[] }>(
		`/items/sewa_masuk_items?filter[sewa_masuk_id][_eq]=${resolved.sewaMasukId}&limit=-1&fields=id,identitas_barang_id,nama_barang,qty,satuan`
	);

	return json({
		sewaMasukId: header.id,
		vendor: header.vendor_contact_id?.name || '-',
		project: header.project_id?.name || '-',
		status: header.status,
		action, // 'kedatangan' | 'retur' — klien merutekan tampilan berdasar ini
		items: itemsRes?.data || []
	});
}

export async function POST(event: RequestEvent) {
	const user = await requireSatpam(event);
	const body = await event.request.json().catch(() => ({}));
	const code = String(body?.code || '');
	const gudangId: number | null = body?.gudangId ? Number(body.gudangId) : null;
	// Fase 6, Rencana Pertajam Rental Order v2 §9.2 L5 — foto kondisi WAJIB saat datang & kembali
	// (bukti kondisi alat = pertahanan kalau vendor kelak mengklaim kerusakan sebelum ada di
	// tangan kita, atau sebaliknya). Kolom foto_datang/foto_kembali sudah ada di skema sejak
	// Fase 1, baru dipakai sekarang. Data nol di seluruh sewa_masuk saat ini -- aman diwajibkan
	// keras sejak awal (nol transaksi lama yang bisa terlumpuhkan).
	const photoIds: string[] = Array.isArray(body?.photoIds) ? body.photoIds.filter((id: unknown) => typeof id === 'string' && id) : [];
	const kondisi: string = typeof body?.kondisi === 'string' ? body.kondisi.trim() : '';
	if (photoIds.length === 0) throw error(400, 'Foto kondisi alat wajib diunggah sebelum konfirmasi gerbang.');

	const resolved = await resolveSewaMasuk(code);
	if (!resolved) throw error(400, 'Kode QR bukan Sewa Masuk yang dikenali.');

	const headerRes = await directusServerJson<{ data: any }>(
		`/items/sewa_masuk/${resolved.sewaMasukId}?fields=id,qr_token,status,vendor_contact_id.name,project_id.id,project_id.name`
	).catch(() => null);
	const header = headerRes?.data;
	if (!header) throw error(404, 'Sewa masuk tidak ditemukan.');
	if (!header.qr_token || header.qr_token !== resolved.token) throw error(400, 'Token QR tidak cocok.');

	const action = resolveGateAction(header.status);
	if (!action) throw error(409, `Sewa masuk ini berstatus '${header.status}' — tidak ada aksi gerbang yang berlaku.`);

	const itemsRes = await directusServerJson<{ data: any[] }>(
		`/items/sewa_masuk_items?filter[sewa_masuk_id][_eq]=${resolved.sewaMasukId}&limit=-1&fields=id,identitas_barang_id,qty,nama_barang`
	);
	const items = itemsRes?.data || [];
	if (items.length === 0) throw error(409, 'Sewa masuk ini belum punya baris item.');

	const refNo = `SWA-${header.id}`;
	const results: Array<{ sewaMasukItemId: number; identitasBarangId: number; newStock: number }> = [];

	if (action === 'kedatangan') {
		for (const it of items) {
			if (!it.identitas_barang_id) continue;
			const mv = await sewaMasukStockMovement({
				itemId: it.identitas_barang_id,
				type: 'IN',
				quantity: parseFloat(it.qty) || 0,
				categoryTransaction: 'IN-17',
				referenceNo: refNo,
				notes: `Kedatangan alat sewa vendor — discan ${user.email || ''}`,
				gudangId
			});
			results.push({ sewaMasukItemId: it.id, identitasBarangId: it.identitas_barang_id, newStock: mv.new_stock });
			await directusServerJson(`/items/sewa_masuk_items/${it.id}`, {
				method: 'PATCH',
				body: JSON.stringify({ foto_datang: photoIds, kondisi_datang: kondisi || null })
			}).catch((e) => console.warn('[sewa-masuk/gate] gagal simpan foto/kondisi datang:', e.message));
			// Fase 8 (A5) — daftarkan sbg equipment supaya lapangan bisa isi P2H (hour-meter)
			// utk alat sewa ini, prasyarat deteksi "sewa menganggur". Gagal-lembut (lihat
			// dokumentasi fungsi) -- kegagalan di sini TIDAK BOLEH menggagalkan gate kedatangan.
			await daftarkanEquipmentUntukSewaMasuk({
				identitasBarangId: it.identitas_barang_id,
				namaBarang: it.nama_barang || `SWA-${header.id}`,
				kodeItem: `SWA-${String(header.id).padStart(6, '0')}`,
				vendorName: header.vendor_contact_id?.nama,
				projectId: header.project_id?.id ?? null,
				projectName: header.project_id?.nama_project ?? null
			});
		}
		await directusServerJson(`/items/sewa_masuk/${resolved.sewaMasukId}`, {
			method: 'PATCH',
			body: JSON.stringify({ status: 'di_gudang', gudang_id: gudangId })
		});
		return json({ success: true, sewaMasukId: resolved.sewaMasukId, newStatus: 'di_gudang', action, items: results });
	}

	// action === 'retur' — barang dikembalikan ke vendor, tutup item (qty -> 0).
	for (const it of items) {
		if (!it.identitas_barang_id) continue;
		const mv = await sewaMasukStockMovement({
			itemId: it.identitas_barang_id,
			type: 'OUT',
			quantity: parseFloat(it.qty) || 0,
			categoryTransaction: 'OUT-13',
			referenceNo: refNo,
			notes: `Retur alat sewa ke vendor — discan ${user.email || ''}`
		});
		results.push({ sewaMasukItemId: it.id, identitasBarangId: it.identitas_barang_id, newStock: mv.new_stock });
		await directusServerJson(`/items/sewa_masuk_items/${it.id}`, {
			method: 'PATCH',
			body: JSON.stringify({ foto_kembali: photoIds, kondisi_kembali: kondisi || null })
		}).catch((e) => console.warn('[sewa-masuk/gate] gagal simpan foto/kondisi kembali:', e.message));
	}
	await directusServerJson(`/items/sewa_masuk/${resolved.sewaMasukId}`, {
		method: 'PATCH',
		body: JSON.stringify({ status: 'selesai', actual_return_date: new Date().toISOString().split('T')[0] })
	});
	return json({ success: true, sewaMasukId: resolved.sewaMasukId, newStatus: 'selesai', action, items: results });
}
