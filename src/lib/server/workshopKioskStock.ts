// src/lib/server/workshopKioskStock.ts
// SERVER-ONLY. Stok kiosk terpadu Ciketing & Balaraja (Fase 7 Unifikasi Workshop).
//
//   Ciketing : saldo di kolom ciketing_item.stok_tersedia, dipotong lewat CAS (ciketingKioskStock.ts, TIDAK diubah).
//   Balaraja : balaraja_item TIDAK punya kolom saldo → saldo = Σ ledger IN − Σ OUT. Tanpa CAS kolom,
//              pengamanannya "tulis lalu verifikasi": setelah baris OUT ditulis, saldo dihitung ulang;
//              bila negatif (dua potong bersamaan melewati cek awal) baris itu dihapus kembali dan
//              operator diminta mengulang. Idempoten lewat clientTxnId pada keterangan ledger.
//
// Query jalur tulis memakai dgetStrict (melempar, tidak menelan) — Aturan #1 CLAUDE.md.

import { directusServerJson } from './directus';
import { todayWib } from '$lib/utils/wibDate';
import { ciketingKioskStockCut } from './ciketingKioskStock';
import { round4, STOK_BELUM_TERCATAT_MSG } from '$lib/utils/stokKiosk';
import { requireKioskProfile, type WorkshopKey } from '$lib/kiosk/workshopKiosk';

export interface KioskStockRow {
	id: number;
	namaBarang: string;
	kode: string | null;
	satuan: string | null;
	/** null = BELUM TERCATAT (bukan 0): UI menampilkan "belum tercatat". Negatif = saldo minus (UI merah "perlu opname"). */
	stokTersedia: number | null;
	stokMin: number;
}

export interface KioskCutInput {
	itemId: number;
	identitasBarangId: number | null;
	quantity: number;
	satuan: string;
	projectId: number;
	projectLabel: string;
	operatorName: string;
	clientTxnId: string;
	catatan?: string;
}

export interface KioskCutResult {
	ledgerId: number;
	previousStock: number;
	newStock: number;
	alreadyProcessed: boolean;
}

async function dgetStrict<T = any>(path: string): Promise<T[]> {
	const res = await directusServerJson<{ data: T[] }>(path);
	return res?.data || [];
}

/** Σ IN − Σ OUT per item dari hasil agregat ledger ([{ item, tipe, sum: { qty } }]). */
export function balancesFromAggregate(rows: Array<{ item: any; tipe: string; sum?: { qty?: any } }>): Map<number, number> {
	const out = new Map<number, number>();
	for (const r of rows || []) {
		const id = Number(r?.item && typeof r.item === 'object' ? r.item.id : r?.item);
		if (!id) continue;
		const qty = Number(r?.sum?.qty) || 0;
		const delta = r.tipe === 'IN' ? qty : r.tipe === 'OUT' ? -qty : 0;
		out.set(id, (out.get(id) || 0) + delta);
	}
	return out;
}

const aggPath = (ledgerCol: string, itemId?: number) =>
	`/items/${ledgerCol}?aggregate[sum]=qty&groupBy[]=item&groupBy[]=tipe&limit=-1${itemId ? `&filter[item][_eq]=${itemId}` : ''}`;

/** Daftar stok aktif untuk Cek Stok. Tampilan: kegagalan Directus dilempar ke pemanggil (dibalas 502, bukan "kosong"). */
export async function listKioskStock(workshop: WorkshopKey): Promise<KioskStockRow[]> {
	const p = requireKioskProfile(workshop);
	if (p.stockColumn) {
		const rows = await dgetStrict<any>(
			`/items/${p.itemCollection}?limit=-1&filter[aktif][_eq]=true&fields=id,nama_barang,kode,satuan_default,stok_tersedia,stok_min&sort=nama_barang`
		);
		return rows.map((r) => ({
			id: r.id,
			namaBarang: r.nama_barang || '-',
			kode: r.kode || null,
			satuan: r.satuan_default || null,
			stokTersedia: r.stok_tersedia === null || r.stok_tersedia === undefined ? null : round4(Number(r.stok_tersedia) || 0),
			stokMin: Number(r.stok_min) || 0
		}));
	}
	// Dua query datar (Aturan #2): master item, lalu agregat ledger.
	const [items, agg] = await Promise.all([
		dgetStrict<any>(`/items/${p.itemCollection}?limit=-1&filter[aktif][_eq]=true&fields=id,nama_barang,kode,satuan_default,stok_min&sort=nama_barang`),
		dgetStrict<any>(aggPath(p.ledgerCollection))
	]);
	const bal = balancesFromAggregate(agg);
	return items.map((r) => ({
		id: r.id,
		namaBarang: r.nama_barang || '-',
		kode: r.kode || null,
		satuan: r.satuan_default || null,
		// item tanpa satu pun baris ledger = belum tercatat (null), BUKAN 0
		stokTersedia: bal.has(Number(r.id)) ? round4(bal.get(Number(r.id)) || 0) : null,
		stokMin: Number(r.stok_min) || 0
	}));
}

/** Saldo satu item (jalur tulis → strict). null = belum tercatat (kolom null / tanpa baris ledger). */
export async function getKioskItemBalance(workshop: WorkshopKey, itemId: number): Promise<number | null> {
	const p = requireKioskProfile(workshop);
	if (p.stockColumn) {
		const cur = await dgetStrict<{ stok_tersedia: number | null }>(`/items/${p.itemCollection}?filter[id][_eq]=${itemId}&fields=stok_tersedia&limit=1`);
		const raw = cur[0]?.stok_tersedia;
		return raw === null || raw === undefined ? null : round4(Number(raw) || 0);
	}
	const bal = balancesFromAggregate(await dgetStrict<any>(aggPath(p.ledgerCollection, itemId)));
	return bal.has(itemId) ? round4(bal.get(itemId) || 0) : null;
}

async function balarajaKioskStockCut(input: KioskCutInput): Promise<KioskCutResult> {
	const p = requireKioskProfile('balaraja');
	const { itemId, quantity, satuan, projectId, projectLabel, operatorName, clientTxnId, catatan } = input;
	const qty = parseFloat(String(quantity)) || 0;
	if (qty <= 0) throw new Error('Kuantitas harus lebih dari 0.');
	if (!itemId) throw new Error('Item Balaraja wajib diisi.');
	if (!projectId) throw new Error('SPK/Project wajib dipilih.');
	if (!clientTxnId) throw new Error('clientTxnId wajib diisi (idempotensi).');

	const baseKeterangan = `Kiosk Potong Bahan #${clientTxnId}${projectLabel ? ` - SPK ${projectLabel}` : ''}`;
	const keterangan = catatan ? `${baseKeterangan} - ${catatan}` : baseKeterangan;

	// Idempoten: transaksi dengan clientTxnId ini sudah pernah ditulis (retry setelah sukses tapi respons hilang).
	const dup = await dgetStrict<any>(`/items/${p.ledgerCollection}?filter[keterangan][_eq]=${encodeURIComponent(keterangan)}&fields=id&limit=1`);
	if (dup.length) {
		const stok = (await getKioskItemBalance('balaraja', itemId)) ?? 0;
		return { ledgerId: dup[0].id, previousStock: round4(stok + qty), newStock: stok, alreadyProcessed: true };
	}

	const before = await getKioskItemBalance('balaraja', itemId);
	if (before === null || before < qty) {
		const nama = (await dgetStrict<any>(`/items/${p.itemCollection}?filter[id][_eq]=${itemId}&fields=nama_barang&limit=1`))[0]?.nama_barang || String(itemId);
		if (before === null) throw new Error(STOK_BELUM_TERCATAT_MSG(nama));
		throw new Error(`Stok "${nama}" tidak cukup. Tersedia: ${before} ${satuan}, diminta: ${qty} ${satuan}.`);
	}

	const ledgerRes = await directusServerJson<{ data: { id: number } }>(`/items/${p.ledgerCollection}`, {
		method: 'POST',
		body: JSON.stringify({
			tanggal: todayWib(),
			item: itemId,
			tipe: 'OUT',
			qty,
			satuan,
			asal: 'Kiosk Potong Bahan',
			project: projectId,
			pic: operatorName,
			keterangan
		})
	});
	const ledgerId = ledgerRes.data.id;

	// Verifikasi pasca-tulis: dua potong bersamaan yang sama-sama lolos cek awal membuat saldo negatif.
	let after: number;
	try {
		after = (await getKioskItemBalance('balaraja', itemId)) ?? 0; // baris OUT baru saja ditulis → saldo pasti tercatat
	} catch (e) {
		// Tidak bisa memverifikasi → biarkan baris (jejak audit utuh), tandai agar direkonsiliasi manusia.
		await directusServerJson('/items/automation_alerts', {
			method: 'POST',
			body: JSON.stringify({
				source: 'kiosk_balaraja_stock_write',
				severity: 'warning',
				is_resolved: false,
				message: `Potong bahan Balaraja item #${itemId} (txn ${clientTxnId}) tertulis di ledger #${ledgerId} tetapi saldo pasca-tulis gagal diverifikasi. Cek saldo item.`
			})
		}).catch(() => {});
		throw e;
	}
	if (after < 0) {
		const undone = await directusServerJson(`/items/${p.ledgerCollection}/${ledgerId}`, { method: 'DELETE' }).then(() => true).catch(() => false);
		if (!undone) {
			console.error('[workshopKioskStock] KRITIS: saldo Balaraja negatif & penghapusan baris ledger gagal', { itemId, ledgerId, clientTxnId });
			await directusServerJson('/items/automation_alerts', {
				method: 'POST',
				body: JSON.stringify({
					source: 'kiosk_balaraja_stock_write',
					severity: 'critical',
					is_resolved: false,
					message: `Saldo Balaraja item #${itemId} negatif (${after}) akibat potong bahan bersamaan (ledger #${ledgerId}, txn ${clientTxnId}) dan baris gagal dibatalkan. Rekonsiliasi manual.`
				})
			}).catch(() => {});
		}
		throw new Error('Stok berubah karena transaksi bersamaan pada barang ini — coba lagi.');
	}

	return { ledgerId, previousStock: before, newStock: after, alreadyProcessed: false };
}

/** Potong bahan lewat kiosk untuk workshop mana pun. */
export async function workshopKioskStockCut(workshop: WorkshopKey, input: KioskCutInput): Promise<KioskCutResult> {
	if (workshop === 'ciketing') {
		return ciketingKioskStockCut({
			ciketingItemId: input.itemId,
			identitasBarangId: input.identitasBarangId,
			quantity: input.quantity,
			satuan: input.satuan,
			projectId: input.projectId,
			projectLabel: input.projectLabel,
			operatorName: input.operatorName,
			clientTxnId: input.clientTxnId,
			catatan: input.catatan
		});
	}
	return balarajaKioskStockCut(input);
}
