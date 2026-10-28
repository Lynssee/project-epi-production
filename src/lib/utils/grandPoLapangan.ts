// src/lib/utils/grandPoLapangan.ts
import { findUnit } from '$lib/shared/unitMaster';
// Grand PO Fase 5 (lapangan) — logika MURNI untuk kartu "Paket Grand PO" dan "Material dari Customer"
// di ringkasan proyek. SENGAJA tidak memuat satu pun field Rupiah (harga/total/nilai) — dashboard lapangan
// hanya perlu progres & kuantitas. Read-only: tidak ada fungsi yang menulis data.

const num = (v: unknown): number => {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
};
const lc = (s: unknown) => String(s ?? '').toLowerCase();
export const idOf = (v: any): number | null => {
	const x = v && typeof v === 'object' ? v.id : v;
	const n = Number(x);
	return Number.isFinite(n) && x !== null && x !== '' ? n : null;
};

export type PeranPaket = 'jasa' | 'material' | 'manpower_supply' | 'sewa_alat' | 'lainnya' | string;

export interface AnggotaPaket {
	so_id: number;
	nomor_po: string;
	peran: PeranPaket;
	proyek_ini: boolean;
	/** Persen progres — HANYA untuk PO jasa yang punya proyek; selain itu null. */
	progres_pct: number | null;
	proyek_id: number | null;
}

/** Progres proyek → 0..100 (dibulatkan 1 desimal); tak valid → null (bukan 0 palsu). */
export function normalizeProgress(v: unknown): number | null {
	if (v === null || v === undefined || v === '') return null;
	const n = Number(v);
	if (!Number.isFinite(n)) return null;
	return Math.round(Math.min(Math.max(n, 0), 100) * 10) / 10;
}

/**
 * Susun daftar anggota paket untuk ditampilkan.
 * @param members  grand_po_members aktif  { so_customer_id, peran }
 * @param soById   so_customer { id, nomor_po_customer, nomor_so, project_id }
 * @param projectById projects { id, total_progress, status }
 * @param thisProjectId proyek yang sedang dibuka
 * @param thisProjectSoIds semua SO milik proyek ini (PO utama + saudara)
 */
export function buildPaketMembers(args: {
	members: Array<{ so_customer_id: any; peran: string }>;
	soById: Map<number, any>;
	projectById: Map<number, any>;
	thisProjectId: number;
	thisProjectSoIds: Set<number>;
}): AnggotaPaket[] {
	const out: AnggotaPaket[] = [];
	for (const m of args.members || []) {
		const soId = idOf(m.so_customer_id);
		if (soId == null) continue;
		const so = args.soById.get(soId);
		const isThis = args.thisProjectSoIds.has(soId);
		const proyekId = isThis ? args.thisProjectId : idOf(so?.project_id);
		const project = proyekId != null ? args.projectById.get(proyekId) : null;
		out.push({
			so_id: soId,
			nomor_po: String(so?.nomor_po_customer || so?.nomor_so || `SO #${soId}`),
			peran: m.peran,
			proyek_ini: isThis,
			progres_pct: m.peran === 'jasa' && project ? normalizeProgress(project.total_progress) : null,
			proyek_id: proyekId
		});
	}
	// PO proyek ini dulu, lalu jasa, lalu lainnya.
	const rank = (a: AnggotaPaket) => (a.proyek_ini ? 0 : a.peran === 'jasa' ? 1 : 2);
	return out.sort((a, b) => rank(a) - rank(b) || a.nomor_po.localeCompare(b.nomor_po));
}

/** Volume yang dipesan pada baris SO: qty × jumlah_pcs (konvensi sama dengan invoice ERP; 16 × 20 kg = 320 kg). */
export function orderedQty(detail: { qty?: unknown; jumlah_pcs?: unknown }): number {
	const qty = num(detail?.qty);
	const pcs = num(detail?.jumlah_pcs);
	return pcs > 0 ? qty * pcs : qty;
}

const SJ_CANCELLED = ['cancelled', 'canceled', 'dibatalkan', 'void'];
const SJ_IN_TRANSIT = ['dalam_perjalanan', 'tiba_lokasi'];

export interface BarisMaterial {
	so_detail_id: number;
	product_id: number | null;
	nama_barang: string;
	unit: string;
	qty_pesan: number;
	qty_kirim: number;
	qty_terima: number;
	qty_belum: number;
}

/**
 * Item material per PO: dipesan vs dikirim vs diterima vs belum dikirim.
 * Baris SJ yang dibatalkan (item.cancelled_at ATAU SJ dibatalkan) tidak dihitung.
 */
export function buildMaterialItems(args: {
	details: Array<{ id: number; product_id?: any; nama_barang?: string; qty?: unknown; jumlah_pcs?: unknown; packing?: string; input_unit?: string }>;
	sjItems: Array<{ so_detail_id: any; surat_jalan_id: any; qty_delivered?: unknown; qty_gr_received?: unknown; cancelled_at?: unknown }>;
	sjById: Map<number, { status?: string }>;
}): BarisMaterial[] {
	const shipped = new Map<number, { kirim: number; terima: number }>();
	for (const it of args.sjItems || []) {
		if (it.cancelled_at) continue;
		const sj = args.sjById.get(idOf(it.surat_jalan_id) as number);
		if (sj && SJ_CANCELLED.includes(lc(sj.status))) continue;
		const detailId = idOf(it.so_detail_id);
		if (detailId == null) continue;
		const cur = shipped.get(detailId) || { kirim: 0, terima: 0 };
		cur.kirim += num(it.qty_delivered);
		cur.terima += num(it.qty_gr_received);
		shipped.set(detailId, cur);
	}
	return (args.details || []).map((d) => {
		const pesan = orderedQty(d);
		const s = shipped.get(d.id) || { kirim: 0, terima: 0 };
		return {
			so_detail_id: d.id,
			product_id: idOf(d.product_id),
			nama_barang: d.nama_barang || `Item #${d.id}`,
			// input_unit = satuan volume (kg); packing bisa label kemasan ("5kg") sehingga hanya cadangan.
			unit: d.input_unit || d.packing || '',
			qty_pesan: pesan,
			qty_kirim: s.kirim,
			qty_terima: s.terima,
			qty_belum: Math.max(pesan - s.kirim, 0)
		};
	});
}

export type StatusSj = 'dalam_perjalanan' | 'terkirim' | 'diterima' | 'belum_dikirim' | 'dibatalkan';

export interface RingkasSj {
	id: number;
	nomor_sj: string;
	status: StatusSj;
	tanggal: string | null;
}

/** Status SJ ramah-lapangan dari track_stage/status. */
export function sjStatus(sj: { status?: string; track_stage?: string | null; received_at?: unknown }): StatusSj {
	if (SJ_CANCELLED.includes(lc(sj.status))) return 'dibatalkan';
	if (['diterima', 'diarsip', 'discan'].includes(lc(sj.track_stage)) || ['delivered', 'received', 'completed'].includes(lc(sj.status)) || sj.received_at) return 'diterima';
	if (SJ_IN_TRANSIT.includes(lc(sj.track_stage))) return 'dalam_perjalanan';
	if (['shipped', 'in_transit', 'terkirim'].includes(lc(sj.status))) return 'terkirim';
	return 'belum_dikirim';
}

/**
 * Perkiraan tiba. TIDAK mengarang tanggal: hanya "sedang dalam perjalanan" bila ada SJ di jalan,
 * "sudah tiba semua" bila semua diterima, selain itu "belum ada jadwal kirim".
 */
export function estimasiTiba(sjs: RingkasSj[], sisaBelumKirim: number): string {
	const live = sjs.filter((s) => s.status !== 'dibatalkan');
	if (live.some((s) => s.status === 'dalam_perjalanan')) return 'Sedang dalam perjalanan ke lokasi';
	if (live.length > 0 && live.every((s) => s.status === 'diterima') && sisaBelumKirim <= 0) return 'Semua kiriman sudah diterima';
	if (live.some((s) => s.status === 'terkirim')) return 'Sudah dikirim, menunggu tiba';
	if (live.length > 0 && sisaBelumKirim > 0) return 'Sebagian sudah diterima, sisanya belum dijadwalkan';
	return 'Belum ada jadwal kirim';
}

// ─── Fase 6: rekonsiliasi Dikirim vs Dipakai vs Sisa ────────────────────────────

export interface PilihanProduk {
	product_id: number;
	nama_barang: string;
	unit: string;
}

/** Produk unik dari item PO material (untuk dropdown coating log). Item tanpa product_id tidak bisa direkonsiliasi → dilewati. */
export function buildPilihanProduk(items: BarisMaterial[]): PilihanProduk[] {
	const seen = new Map<number, PilihanProduk>();
	for (const it of items || []) {
		if (it.product_id == null || seen.has(it.product_id)) continue;
		seen.set(it.product_id, { product_id: it.product_id, nama_barang: it.nama_barang, unit: it.unit });
	}
	return [...seen.values()].sort((a, b) => a.nama_barang.localeCompare(b.nama_barang));
}

export type LevelRekon = 'ok' | 'perhatian' | 'melebihi_po';

export interface BarisRekon {
	product_id: number;
	nama_barang: string;
	unit: string;
	qty_pesan: number;
	qty_kirim: number;
	qty_dipakai: number;
	/** Sisa di site = dikirim − dipakai. Negatif = pemakaian melebihi kiriman. */
	qty_sisa: number;
	level: LevelRekon;
	catatan: string;
}

// PRJ-26: bandingkan lewat KODE master satuan (Lbr = Lembar, Meter = M); satuan tak dikenal dibandingkan huruf kecil tanpa spasi.
// (Versi lama memakai /s+/ — huruf 's', bukan spasi — sehingga 'Ls' dan 'L' dianggap sama.)
const normUnit = (u: unknown) => findUnit(u)?.code ?? lc(u).replace(/\s+/g, '');
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Bandingkan kiriman PO material dengan pemakaian di coating log, per produk.
 *  - Baris PO dengan produk sama dijumlahkan (mis. HARDENER muncul di 3 baris).
 *  - Log dihitung hanya bila product_id cocok DAN satuan sama dengan satuan PO (atau kosong). Log ber-satuan
 *    beda TIDAK dijumlahkan (tidak mengarang konversi) — dilaporkan lewat `satuanBeda`.
 *  - Level: 'melebihi_po' bila dipakai > dipesan (+toleransi) → perlu PO tambahan/klaim; 'perhatian' bila
 *    dipakai > dikirim (+toleransi) → kiriman belum cukup mengejar pemakaian; selain itu 'ok'.
 * @param toleransiPct persen kelonggaran (default 5) — dibaca dari setelan admin bila ada.
 */
export function buildRekonsiliasi(args: {
	items: BarisMaterial[];
	logs: Array<{ product_id?: any; qty_used?: unknown; satuan?: string | null }>;
	toleransiPct?: number;
}): { baris: BarisRekon[]; tanpaProduk: number; satuanBeda: number } {
	const tol = 1 + Math.max(num(args.toleransiPct ?? 5), 0) / 100;
	const byProduct = new Map<number, { nama: string; unit: string; pesan: number; kirim: number }>();
	for (const it of args.items || []) {
		if (it.product_id == null) continue;
		const cur = byProduct.get(it.product_id) || { nama: it.nama_barang, unit: it.unit, pesan: 0, kirim: 0 };
		cur.pesan += it.qty_pesan;
		cur.kirim += it.qty_kirim;
		byProduct.set(it.product_id, cur);
	}
	const dipakai = new Map<number, number>();
	let tanpaProduk = 0;
	let satuanBeda = 0;
	for (const lg of args.logs || []) {
		const pid = idOf(lg.product_id);
		if (pid == null) {
			tanpaProduk += 1;
			continue;
		}
		const prod = byProduct.get(pid);
		if (!prod) continue; // produk bukan dari PO material paket ini
		if (lg.satuan && normUnit(lg.satuan) !== normUnit(prod.unit)) {
			satuanBeda += 1;
			continue;
		}
		dipakai.set(pid, (dipakai.get(pid) || 0) + num(lg.qty_used));
	}
	const baris: BarisRekon[] = [...byProduct.entries()].map(([pid, p]) => {
		const used = dipakai.get(pid) || 0;
		let level: LevelRekon = 'ok';
		let catatan = '';
		if (used > p.pesan * tol && p.pesan > 0) {
			level = 'melebihi_po';
			catatan = 'Pemakaian melebihi total PO — ajukan PO tambahan ke customer atau catat kelebihan.';
		} else if (used > p.kirim * tol) {
			level = 'perhatian';
			catatan = 'Pemakaian melebihi yang sudah dikirim — cek kiriman/kekurangan.';
		}
		return { product_id: pid, nama_barang: p.nama, unit: p.unit, qty_pesan: round2(p.pesan), qty_kirim: round2(p.kirim), qty_dipakai: round2(used), qty_sisa: round2(p.kirim - used), level, catatan };
	});
	const rank: Record<LevelRekon, number> = { melebihi_po: 0, perhatian: 1, ok: 2 };
	return { baris: baris.sort((a, b) => rank[a.level] - rank[b.level] || a.nama_barang.localeCompare(b.nama_barang)), tanpaProduk, satuanBeda };
}

/** Pemetaan kunci JSON yang boleh keluar ke lapangan — dipakai tes untuk menjamin tanpa Rupiah. */
export const MONEY_KEY_PATTERN = /(harga|price|nilai|amount|grand_?total|subtotal|(^|_)total(_|$)|ppn|pajak|(^|_)tax|biaya|cost|hpp)/i;

/** Telusuri objek; kembalikan jalur kunci yang terlihat seperti Rupiah (untuk tes & pengaman defensif). */
export function findMoneyKeys(obj: unknown, path = ''): string[] {
	if (obj === null || typeof obj !== 'object') return [];
	const hits: string[] = [];
	for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
		const p = path ? `${path}.${k}` : k;
		if (MONEY_KEY_PATTERN.test(k)) hits.push(p);
		if (v && typeof v === 'object') hits.push(...findMoneyKeys(v, p));
	}
	return hits;
}

// ─── Fase 6: hint PL proyek yang memuat produk dari PO material customer (mode SHADOW) ───────────────────

const normName = (s: unknown) => lc(s).replace(/[^a-z0-9]+/g, '');

export interface HitMaterialCustomer {
	material_name: string;
	produk_po: string;
	unit: string;
}

/**
 * Cocokkan nama barang PL proyek dengan produk PO material customer (nama dinormalisasi; sama persis, atau salah satu
 * memuat yang lain dengan panjang ≥ 6 agar "cat" tidak cocok ke mana-mana). Hanya HINT — tidak pernah memblokir.
 */
export function matchCustomerMaterial(names: string[], produkPo: Array<{ nama_barang: string; unit: string }>): HitMaterialCustomer[] {
	const hits: HitMaterialCustomer[] = [];
	const seen = new Set<string>();
	for (const raw of names || []) {
		const n = normName(raw);
		if (n.length < 6) continue;
		for (const p of produkPo || []) {
			const pn = normName(p.nama_barang);
			if (pn.length < 6) continue;
			if (n === pn || n.includes(pn) || pn.includes(n)) {
				const key = `${n}|${pn}`;
				if (seen.has(key)) continue;
				seen.add(key);
				hits.push({ material_name: String(raw), produk_po: p.nama_barang, unit: p.unit });
			}
		}
	}
	return hits;
}
