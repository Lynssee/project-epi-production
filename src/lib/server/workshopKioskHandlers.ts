// src/lib/server/workshopKioskHandlers.ts
// SERVER-ONLY. Handler kiosk terpadu Ciketing & Balaraja (Fase 7 Unifikasi Workshop):
//   - cek stok (read-only)       → GET  /api/kiosk/[workshop]/cek-stok
//   - potong bahan via scan QR   → GET/POST /api/kiosk/[workshop]/potong-bahan
// Rute lama /api/kiosk/ciketing-* memanggil handler yang sama dengan workshop 'ciketing' (kompatibel).
// kiosk_menu_access di-re-verify di server pada setiap panggilan (pola sama: kiosk/qc, kiosk/konsumsi).

import { json, error, type RequestEvent } from '@sveltejs/kit';
import { directusServerJson } from '$lib/server/directus';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { requireKioskMenu } from '$lib/server/kioskMenuAccess';
import { parseEpiQr } from '$lib/utils/qrParse';
import { listKioskStock, workshopKioskStockCut } from '$lib/server/workshopKioskStock';
import { requireKioskProfile, type WorkshopKey, type WorkshopKioskProfile } from '$lib/kiosk/workshopKiosk';

function profileOr404(workshop: unknown): WorkshopKioskProfile {
	try {
		return requireKioskProfile(workshop);
	} catch {
		throw error(404, 'Workshop tidak dikenal.');
	}
}

export async function kioskCekStokGet(event: RequestEvent, workshop: WorkshopKey) {
	const p = profileOr404(workshop);
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, p.menuCekStok, `Cek Stok ${p.label}`);
	try {
		return json({ items: await listKioskStock(p.key) });
	} catch (e: any) {
		console.error(`[kiosk/${p.key}/cek-stok] gagal memuat stok:`, e?.message || e);
		throw error(502, 'Gagal memuat stok dari server. Coba lagi.');
	}
}

async function resolveItemFromCode(p: WorkshopKioskProfile, code: string) {
	const parsed = parseEpiQr(code);
	if (!parsed || parsed.type !== 'ITEM') {
		throw error(400, 'QR ini bukan label barang Master Pusat (EPI:ITEM:...). Scan label yang tercetak dari Cetak Label Barang.');
	}
	const identitasId = Number(parsed.id);

	const identitasRes = await directusServerJson<{ data: any }>(`/items/identitas_barang/${identitasId}?fields=id,nama_barang_lengkap,satuan`).catch(() => null);
	const identitas = identitasRes?.data;
	if (!identitas) throw error(404, 'Barang tidak ditemukan di Master Pusat.');

	const itemFields = `id,nama_barang,satuan_default${p.stockColumn ? ',stok_tersedia' : ''}`;
	const itemRes = await directusServerJson<{ data: any[] }>(
		`/items/${p.itemCollection}?filter[identitas_barang][_eq]=${identitasId}&filter[aktif][_eq]=true&fields=${itemFields}&limit=1`
	).catch(() => ({ data: [] }));
	const row = itemRes?.data?.[0];
	if (!row) {
		throw error(404, `"${identitas.nama_barang_lengkap}" belum terdaftar sebagai barang aktif Workshop ${p.label}. Minta admin daftarkan dulu di Master Item WS ${p.label}.`);
	}

	// null = belum tercatat (BUKAN 0) — WSK-16
	let stokTersedia: number | null = null;
	if (p.stockColumn) stokTersedia = row.stok_tersedia === null || row.stok_tersedia === undefined ? null : parseFloat(row.stok_tersedia) || 0;
	else {
		try {
			stokTersedia = (await listKioskStock(p.key)).find((r) => r.id === row.id)?.stokTersedia ?? null;
		} catch (e) {
			console.error(`[kiosk/${p.key}/potong-bahan] gagal membaca saldo:`, e);
			throw error(502, 'Gagal memuat stok dari server. Coba lagi.');
		}
	}

	return {
		itemId: row.id,
		identitasBarangId: identitasId,
		namaBarang: row.nama_barang || identitas.nama_barang_lengkap,
		satuan: row.satuan_default || identitas.satuan || 'pcs',
		stokTersedia
	};
}

export async function kioskPotongBahanGet(event: RequestEvent, workshop: WorkshopKey) {
	const p = profileOr404(workshop);
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, p.menuPotongBahan, `Potong Bahan ${p.label}`);

	const code = event.url.searchParams.get('code');
	if (code) return json({ item: await resolveItemFromCode(p, code) });

	const spkRes = await directusServerJson<{ data: any[] }>(
		`/items/projects?filter[workshop][_eq]=${p.projectWorkshop}&filter[status][_eq]=${encodeURIComponent('on progress')}&fields=id,name,nomor_po&sort=name&limit=100`
	).catch(() => ({ data: [] }));
	return json({ spkList: spkRes?.data || [] });
}

export async function kioskPotongBahanPost(event: RequestEvent, workshop: WorkshopKey) {
	const p = profileOr404(workshop);
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, p.menuPotongBahan, `Potong Bahan ${p.label}`);

	const body = await event.request.json().catch(() => null);
	const code = String(body?.code || '').trim();
	const projectId = Number(body?.projectId);
	const projectLabel = String(body?.projectLabel || '').trim();
	const qty = Number(body?.qty);
	const catatan = body?.catatan ? String(body.catatan).trim() : undefined;
	const clientTxnId = String(body?.clientTxnId || '').trim();

	if (!code) throw error(400, 'Scan QR barang wajib.');
	if (!projectId) throw error(400, 'Pilih SPK/project dulu.');
	if (!(qty > 0)) throw error(400, 'Qty harus lebih dari 0.');
	if (!clientTxnId) throw error(400, 'clientTxnId wajib (idempotensi).');

	const item = await resolveItemFromCode(p, code);

	try {
		const result = await workshopKioskStockCut(p.key, {
			itemId: item.itemId,
			identitasBarangId: item.identitasBarangId,
			quantity: qty,
			satuan: item.satuan,
			projectId,
			projectLabel,
			operatorName: session.nama,
			clientTxnId,
			catatan
		});
		return json({
			success: true,
			nama_barang: item.namaBarang,
			satuan: item.satuan,
			qty,
			previous_stock: result.previousStock,
			new_stock: result.newStock,
			already_processed: result.alreadyProcessed
		});
	} catch (e: any) {
		throw error(400, e?.message || 'Gagal memotong stok.');
	}
}
