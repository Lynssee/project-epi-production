// src/lib/server/kioskTransfer.ts
// SERVER-ONLY. Transfer stok ANTAR GUDANG dari terminal Kiosk Gudang. F4-C, Briefing Gate Dua Tingkat &
// Eliminasi Skema Manual, Bab VI §6.3-B (21 Sep 2026).
//
// PEMBAGIAN TUGAS (sengaja): kiosk TIDAK menulis ledger stok. Semua aksi tulis (ajukan/setujui/tolak/terima/
// batal) diteruskan ke erp-epi-1 lewat jembatan server-ke-server `/api/automation/kiosk-stock-transfer`
// (pola sama kioskAndonNotify.ts: ERP_EPI1_BASE_URL + AUTOMATION_SERVER_SECRET), sehingga WAC, gate TRF,
// idempotensi & jurnal hanya hidup di SATU tempat. File ini hanya: (1) membaca daftar untuk layar kiosk
// (fetch relasi DIPISAH — Aturan #1/#2), (2) validasi ringan sisi kiosk, (3) meneruskan panggilan.
//
// Pindah rak DI DALAM satu gudang BUKAN transfer → tetap /api/kiosk/stok/pindah-rak (tanpa approval).

import { env } from '$env/dynamic/private';
import { directusServerJson } from '$lib/server/directus';
import type { KioskTransferRow } from '$lib/kiosk/transferTypes';

const NON_RAK_JENIS = ['gudang_utama', 'gudang_produksi', 'proyek'];
const idOf = (v: any) => (v && typeof v === 'object' ? v.id : v);
const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o));

export class KioskTransferError extends Error {
	status: number;
	constructor(message: string, status = 400) {
		super(message);
		this.status = status;
	}
}

interface GudangNode {
	id: number;
	nama_gudang: string;
	kode_gudang: string | null;
	jenis: string | null;
	parent_gudang_id: number | null;
	pic_karyawan_ids: number[] | null;
	qr_code_value: string | null;
}

/** Node + leluhurnya (maks 8 tingkat) dipetakan by id — satu query per tingkat, bukan nested. */
async function loadGudangChain(startIds: number[]): Promise<Map<number, GudangNode>> {
	const map = new Map<number, GudangNode>();
	let frontier = [...new Set(startIds.filter((x) => x != null))];
	for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
		const need = frontier.filter((id) => !map.has(id));
		if (need.length === 0) break;
		const res = await directusServerJson<{ data: GudangNode[] }>(
			`/items/gudang?filter=${enc({ id: { _in: need } })}&fields=id,nama_gudang,kode_gudang,jenis,parent_gudang_id,pic_karyawan_ids,qr_code_value&limit=-1`
		);
		for (const g of res?.data || []) map.set(g.id, { ...g, parent_gudang_id: idOf(g.parent_gudang_id) ?? null });
		frontier = (res?.data || []).map((g) => idOf(g.parent_gudang_id)).filter((x) => x != null && !map.has(x));
	}
	return map;
}

function rootOf(id: number, map: Map<number, GudangNode>): number {
	let cur = map.get(id);
	for (let i = 0; cur && cur.parent_gudang_id != null && i < 8; i++) {
		const next = map.get(cur.parent_gudang_id);
		if (!next) break;
		cur = next;
	}
	return cur?.id ?? id;
}

/** PIC gudang itu + seluruh leluhurnya (string id). Kosong = tak ada PIC sama sekali. */
function picChain(id: number, map: Map<number, GudangNode>): string[] {
	const out = new Set<string>();
	let cur = map.get(id);
	for (let i = 0; cur && i < 8; i++) {
		// Kolom lama gudang.pic_karyawan_id dipensiunkan (0 baris terisi per 23 Sep 2026) — hanya pic_karyawan_ids.
		for (const p of cur.pic_karyawan_ids || []) if (p != null) out.add(String(p));
		cur = cur.parent_gudang_id != null ? map.get(cur.parent_gudang_id) : undefined;
	}
	return [...out];
}

/** PIC boleh; gudang tanpa PIC = siapa pun boleh (fallback Aturan #4, sama dengan sisi ERP). */
function boleh(karyawanId: number, pics: string[]): boolean {
	return pics.length === 0 || pics.includes(String(karyawanId));
}

export type { KioskTransferRow, KioskTransferItemRow } from '$lib/kiosk/transferTypes';

/** Daftar transfer untuk layar kiosk: yang aktif (draft/in_transit) + selesai/ditolak 7 hari terakhir. */
export async function listTransfersForKiosk(karyawanId: number): Promise<KioskTransferRow[]> {
	const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
	const headers = await directusServerJson<{ data: any[] }>(
		`/items/stock_transfer?filter=${enc({
			_or: [{ status: { _in: ['draft', 'in_transit'] } }, { transfer_date: { _gte: since } }]
		})}&fields=*&sort=-transfer_date&limit=60`
	);
	const rows = headers?.data || [];
	if (rows.length === 0) return [];

	const ids = rows.map((r) => r.id);
	const itemsRes = await directusServerJson<{ data: any[] }>(
		`/items/stock_transfer_items?filter=${enc({ transfer_id: { _in: ids } })}&fields=*&limit=-1`
	);
	const rawItems = itemsRes?.data || [];

	const barangIds = [...new Set(rawItems.map((i) => idOf(i.item_id)).filter((x) => x != null))];
	const barangRes = barangIds.length
		? await directusServerJson<{ data: any[] }>(
				`/items/identitas_barang?filter=${enc({ id: { _in: barangIds } })}&fields=id,nama_barang_lengkap,satuan&limit=-1`
			)
		: { data: [] };
	const barangMap = new Map((barangRes?.data || []).map((b) => [b.id, b]));

	const gudangIds = [
		...rows.flatMap((r) => [idOf(r.from_gudang_id), idOf(r.to_gudang_id)]),
		...rawItems.map((i) => idOf(i.from_rak_id))
	].filter((x) => x != null) as number[];
	const gmap = await loadGudangChain(gudangIds);

	return rows.map((r) => {
		const fromId = idOf(r.from_gudang_id) as number;
		const toId = idOf(r.to_gudang_id) as number;
		const sayaPemohon = String(r.created_by ?? '') === String(karyawanId);
		const bisaAsal = boleh(karyawanId, picChain(fromId, gmap));
		const bisaTujuan = boleh(karyawanId, picChain(toId, gmap));
		return {
			id: r.id,
			transfer_no: r.transfer_no,
			status: r.status,
			transfer_date: r.transfer_date ?? null,
			from_id: fromId,
			from_nama: gmap.get(fromId)?.nama_gudang ?? `#${fromId}`,
			to_id: toId,
			to_nama: gmap.get(toId)?.nama_gudang ?? `#${toId}`,
			notes: r.notes ?? null,
			rejected_reason: r.rejected_reason ?? null,
			saya_pemohon: sayaPemohon,
			bisa_setujui: r.status === 'draft' && bisaAsal,
			bisa_terima: r.status === 'in_transit' && bisaTujuan,
			bisa_batal: (r.status === 'draft' && (sayaPemohon || bisaAsal)) || (r.status === 'in_transit' && bisaAsal),
			items: rawItems
				.filter((i) => idOf(i.transfer_id) === r.id)
				.map((i) => {
					const b = barangMap.get(idOf(i.item_id));
					return {
						id: i.id,
						item_id: idOf(i.item_id),
						nama: b?.nama_barang_lengkap ?? `Barang #${idOf(i.item_id)}`,
						satuan: b?.satuan ?? null,
						quantity: Number(i.quantity) || 0,
						received_quantity: i.received_quantity != null ? Number(i.received_quantity) : null,
						from_rak_nama: idOf(i.from_rak_id) != null ? (gmap.get(idOf(i.from_rak_id))?.nama_gudang ?? null) : null
					};
				})
		};
	});
}

export interface KioskRakOption {
	id: number;
	nama: string;
	kode: string | null;
	qr: string | null;
	jenis: string | null;
}

/** Rak/zona/slot konkret di bawah satu gudang (maks 4 tingkat) — untuk memilih/scan rak tujuan. */
export async function listRakUnder(gudangId: number): Promise<KioskRakOption[]> {
	const out: KioskRakOption[] = [];
	let frontier = [gudangId];
	for (let depth = 0; depth < 4 && frontier.length > 0; depth++) {
		const res = await directusServerJson<{ data: GudangNode[] }>(
			`/items/gudang?filter=${enc({ parent_gudang_id: { _in: frontier }, is_active: { _eq: true } })}&fields=id,nama_gudang,kode_gudang,jenis,qr_code_value&sort=nama_gudang&limit=500`
		);
		const kids = res?.data || [];
		for (const k of kids) {
			if (!NON_RAK_JENIS.includes(String(k.jenis || '').toLowerCase())) {
				out.push({ id: k.id, nama: k.nama_gudang, kode: k.kode_gudang ?? null, qr: k.qr_code_value ?? null, jenis: k.jenis ?? null });
			}
		}
		frontier = kids.map((k) => k.id);
	}
	return out;
}

// ── jembatan ke ERP ─────────────────────────────────────────────────────────────

type Aksi = 'submit' | 'approve' | 'reject' | 'receive' | 'cancel';

async function callErp(aksi: Aksi, karyawanId: number, payload: Record<string, unknown>): Promise<any> {
	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.AUTOMATION_SERVER_SECRET;
	if (!baseUrl || !secret) {
		throw new KioskTransferError('Transfer belum aktif: ERP_EPI1_BASE_URL/AUTOMATION_SERVER_SECRET belum dikonfigurasi di server kiosk. Hubungi admin.', 503);
	}
	let res: Response;
	try {
		res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/automation/kiosk-stock-transfer`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ secret, action: aksi, karyawanId, ...payload })
		});
	} catch (e) {
		console.error('[kioskTransfer] ERP tak terjangkau:', e);
		throw new KioskTransferError('Server ERP tidak terjangkau. Coba lagi sebentar lagi.', 502);
	}
	const body: any = await res.json().catch(() => ({}));
	if (!res.ok || body?.success === false) {
		throw new KioskTransferError(body?.alasan || body?.message || `Gagal memproses transfer (${res.status})`, res.status >= 400 && res.status < 600 ? res.status : 502);
	}
	return body?.data;
}

export interface AjukanInput {
	toGudangId: number;
	notes?: string | null;
	items: Array<{ item_id: number; quantity: number; from_rak_id: number }>;
}

/** Ajukan transfer dari kiosk. Semua item harus berasal dari satu gudang utama yang BERBEDA dari tujuan. */
export async function ajukanTransfer(karyawanId: number, input: AjukanInput) {
	const items = (input.items || []).filter((i) => i.item_id > 0 && i.quantity > 0 && i.from_rak_id > 0);
	if (items.length === 0) throw new KioskTransferError('Pilih minimal satu barang beserta jumlahnya.');
	if (!(input.toGudangId > 0)) throw new KioskTransferError('Pilih gudang tujuan.');

	const gmap = await loadGudangChain([input.toGudangId, ...items.map((i) => i.from_rak_id)]);
	if (!gmap.has(input.toGudangId)) throw new KioskTransferError('Gudang tujuan tidak ditemukan.');
	const toRoot = rootOf(input.toGudangId, gmap);
	const fromRoots = new Set<number>();
	for (const it of items) {
		if (!gmap.has(it.from_rak_id)) throw new KioskTransferError(`Rak asal #${it.from_rak_id} tidak ditemukan.`);
		fromRoots.add(rootOf(it.from_rak_id, gmap));
	}
	if (fromRoots.size > 1) throw new KioskTransferError('Satu transfer hanya boleh dari satu gudang asal. Buat transfer terpisah per gudang.');
	const [fromRoot] = [...fromRoots];
	if (fromRoot === toRoot) {
		throw new KioskTransferError('Asal dan tujuan ada di gudang yang sama — untuk pindah rak dalam satu gudang pakai menu "Cek Stok Rak → Pindah Rak" (tanpa persetujuan).');
	}
	// Barang yang sama dari dua rak → gabung (ERP menolak barang dobel dalam satu transfer).
	const merged = new Map<number, { item_id: number; quantity: number; from_rak_id: number }>();
	for (const it of items) {
		const cur = merged.get(it.item_id);
		if (cur && cur.from_rak_id !== it.from_rak_id) {
			throw new KioskTransferError('Barang yang sama dari dua rak berbeda — buat transfer terpisah agar asal stok jelas.');
		}
		merged.set(it.item_id, { item_id: it.item_id, quantity: (cur?.quantity ?? 0) + it.quantity, from_rak_id: it.from_rak_id });
	}
	return callErp('submit', karyawanId, {
		fromGudangId: fromRoot,
		toGudangId: input.toGudangId,
		notes: input.notes?.trim() || null,
		items: [...merged.values()]
	});
}

export const setujuiTransfer = (karyawanId: number, transferId: number) => callErp('approve', karyawanId, { transferId });
export const tolakTransfer = (karyawanId: number, transferId: number, reason: string) => callErp('reject', karyawanId, { transferId, reason });
export const batalkanTransfer = (karyawanId: number, transferId: number) => callErp('cancel', karyawanId, { transferId });
export const terimaTransfer = (
	karyawanId: number,
	transferId: number,
	lines: Array<{ id: number; received_quantity: number; to_rak_id?: number | null; selisih_alasan?: string | null }>
) => callErp('receive', karyawanId, { transferId, lines });
