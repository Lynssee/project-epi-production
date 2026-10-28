// src/lib/server/opnameSesi.ts
// ⚠️ SERVER-ONLY. Lifecycle Inventory Tahap 6 — F4 (7 Okt 2026): sisi LAPANGAN Stock Opname berbasis sesi.
// Sesi dibuat/dikelola admin di erp-epi (stock_opname_session / stock_opname_line, Directus bersama). Sisi ini HANYA:
//   - melihat sesi yang sedang "counting" + barisnya (blind count disembunyikan di SERVER, bukan di klien),
//   - menyimpan hitungan fisik (+ alasan/foto) per baris, dan
//   - menerima hitungan dari Kiosk Gudang bila ada sesi aktif untuk rak/item tersebut.
// Penutupan hitung, mutasi pasca-snapshot, approval & posting stok TETAP di erp-epi (satu pemilik logika posting).

import { directusServerJson } from '$lib/server/directus';

const SESSION = 'stock_opname_session';
const LINE = 'stock_opname_line';
const TOLERANSI_DEFAULT_PCT = 2;

const idOf = (v: any) => (v && typeof v === 'object' ? v.id : v);
const chunk = <T>(arr: T[], n = 150): T[][] => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const fail = (message: string, status = 400) => Object.assign(new Error(message), { status });

async function dget<T = any>(path: string): Promise<T[]> {
	return (await directusServerJson<{ data: T[] }>(path))?.data ?? [];
}

// ── Setelan (system_settings menyimpan nilai sebagai string JSON) ───────────────────────────────────
function parseStored(v: unknown): unknown {
	if (typeof v !== 'string') return v;
	try {
		return JSON.parse(v);
	} catch {
		return v;
	}
}
let cfgCache: { at: number; value: { sessionMode: boolean; toleransiPct: number } } | null = null;
export function _resetOpnameSesiCache() {
	cfgCache = null;
}
/** sessionMode = inventory.opname.session_mode === 'session'. Gagal baca -> false (kiosk/lapangan berperilaku seperti sebelumnya). */
export async function readOpnameLapanganConfig() {
	if (cfgCache && Date.now() - cfgCache.at < 5 * 60 * 1000) return cfgCache.value;
	let sessionMode = false;
	let toleransiPct = TOLERANSI_DEFAULT_PCT;
	try {
		const rows = await dget(
			`/items/system_settings?filter[setting_key][_in]=inventory.opname.session_mode,inventory.opname.toleransi_pct&fields=setting_key,setting_value&limit=5`
		);
		for (const r of rows) {
			const v = parseStored(r.setting_value);
			if (r.setting_key === 'inventory.opname.session_mode') sessionMode = v === 'session';
			if (r.setting_key === 'inventory.opname.toleransi_pct' && Number.isFinite(Number(v))) toleransiPct = Math.max(0, Number(v));
		}
	} catch (e) {
		console.warn('[opnameSesi] setelan tak terbaca, mode legacy:', (e as Error)?.message || e);
	}
	cfgCache = { at: Date.now(), value: { sessionMode, toleransiPct } };
	return cfgCache.value;
}

/** Selisih melewati toleransi? (cermin erp-epi lib/inventory/opnameSession.js melewatiToleransi) */
export function melewatiToleransi(snapshot: number, mutasi: number, selisih: number, toleransiPct: number): boolean {
	if (!selisih) return false;
	const expected = Math.abs((Number(snapshot) || 0) + (Number(mutasi) || 0));
	if (expected === 0) return true;
	return (Math.abs(selisih) / expected) * 100 > (Number(toleransiPct) || 0);
}

// ── Daftar & detail ──────────────────────────────────────────────────────────────────────────────────
export interface SesiRingkas {
	id: number;
	kode: string;
	status: string;
	gudang_id: number | null;
	gudang_nama: string | null;
	total_lines: number;
	counted_lines: number;
	pic_hitung: string | null;
	mine: boolean;
	jadwal_tanggal: string | null;
	recount_lines: number;
}

export async function listSesiAktif(karyawan: { nama_karyawan: string; email_company?: string | null }): Promise<SesiRingkas[]> {
	const rows = await dget(
		`/items/${SESSION}?filter[status][_eq]=counting&sort=-id&limit=50&fields=id,kode,status,gudang_id,rak_id,total_lines,counted_lines,pic_hitung,jadwal_tanggal`
	);
	if (!rows.length) return [];
	const gIds = [...new Set(rows.map((r) => Number(idOf(r.gudang_id) || idOf(r.rak_id))).filter(Boolean))];
	const gName = new Map<number, string>();
	if (gIds.length) {
		for (const g of await dget(`/items/gudang?filter[id][_in]=${gIds.join(',')}&fields=id,kode_gudang,nama_gudang&limit=-1`)) {
			gName.set(g.id, `${g.kode_gudang || ''} ${g.nama_gudang || ''}`.trim());
		}
	}
	// jumlah baris "hitung ulang" per sesi — 1 aggregate groupBy (bukan fetch baris)
	const recount = await dget(
		`/items/${LINE}?aggregate[count]=*&groupBy[]=session&filter[status][_eq]=recount&filter[session][_in]=${rows.map((r) => r.id).join(',')}`
	).catch((e) => {
		console.warn('[opnameSesi] hitung recount gagal:', e?.message || e);
		return [] as any[];
	});
	const recMap = new Map<number, number>(recount.map((r: any) => [Number(idOf(r.session)), Number(r.count) || 0]));
	const me = [karyawan.nama_karyawan, karyawan.email_company].filter(Boolean).map((s) => String(s).toLowerCase());
	return rows.map((r) => ({
		id: r.id,
		kode: r.kode,
		status: r.status,
		gudang_id: Number(idOf(r.gudang_id) || idOf(r.rak_id)) || null,
		gudang_nama: gName.get(Number(idOf(r.gudang_id) || idOf(r.rak_id))) || null,
		total_lines: Number(r.total_lines) || 0,
		counted_lines: Number(r.counted_lines) || 0,
		pic_hitung: r.pic_hitung || null,
		mine: !!r.pic_hitung && me.includes(String(r.pic_hitung).toLowerCase()),
		jadwal_tanggal: r.jadwal_tanggal || null,
		recount_lines: recMap.get(r.id) || 0
	}));
}

/** Detail sesi + baris. Blind count: qty sistem/mutasi/selisih TIDAK PERNAH dikirim ke klien saat sesi counting. */
export async function getSesiLapangan(id: number) {
	const header = (
		await directusServerJson<{ data: any }>(`/items/${SESSION}/${id}?fields=id,kode,status,blind_count,gudang_id,rak_id,total_lines,counted_lines,pic_hitung`)
	)?.data;
	if (!header) throw fail('Sesi tidak ditemukan.', 404);
	if (header.status !== 'counting') throw fail('Sesi ini sedang tidak dalam tahap menghitung.', 409);

	const lines = await dget(
		`/items/${LINE}?filter[session][_eq]=${id}&limit=-1&sort=id&fields=id,item_id,rak_id,status,qty_fisik,alasan_selisih,alasan_catatan,foto_bukti,qty_sistem_snapshot`
	);
	const itemIds = [...new Set(lines.map((l) => Number(idOf(l.item_id))))];
	const rakIds = [...new Set(lines.map((l) => Number(idOf(l.rak_id))).filter(Boolean))];
	const items = new Map<number, any>();
	for (const part of chunk(itemIds)) {
		for (const it of await dget(`/items/identitas_barang?filter[id][_in]=${part.join(',')}&fields=id,nama_barang_lengkap,kode_item,satuan&limit=-1`)) items.set(it.id, it);
	}
	const raks = new Map<number, any>();
	for (const part of chunk(rakIds)) {
		for (const g of await dget(`/items/gudang?filter[id][_in]=${part.join(',')}&fields=id,kode_gudang,nama_gudang&limit=-1`)) raks.set(g.id, g);
	}
	const blind = !!header.blind_count;
	return {
		session: { id: header.id, kode: header.kode, status: header.status, blind_count: blind, total_lines: header.total_lines, counted_lines: header.counted_lines },
		lines: lines.map((l) => {
			const it = items.get(Number(idOf(l.item_id)));
			const rak = raks.get(Number(idOf(l.rak_id)));
			return {
				id: l.id,
				item_id: Number(idOf(l.item_id)),
				nama: it?.nama_barang_lengkap || `#${idOf(l.item_id)}`,
				kode_item: it?.kode_item || null,
				satuan: it?.satuan || null,
				rak_id: Number(idOf(l.rak_id)) || null,
				rak_nama: rak ? `${rak.kode_gudang || ''} ${rak.nama_gudang || ''}`.trim() : null,
				status: l.status,
				qty_fisik: l.qty_fisik ?? null,
				alasan_selisih: l.alasan_selisih || null,
				// catatan hitung ulang dari admin ("Recount: …") boleh tampil; qty sistem hanya bila sesi TIDAK blind
				catatan: l.alasan_catatan || null,
				has_foto: !!l.foto_bukti,
				qty_sistem: blind ? null : Number(l.qty_sistem_snapshot) || 0
			};
		})
	};
}

// ── Simpan hitungan ──────────────────────────────────────────────────────────────────────────────────
export interface EntriHitung {
	lineId: number;
	qtyFisik: number | null;
	alasan?: string | null;
	catatan?: string | null;
	foto?: string | null;
}

async function syncHeaderCounted(sessionId: number) {
	const agg = await dget(`/items/${LINE}?aggregate[count]=qty_fisik&filter[session][_eq]=${sessionId}`);
	const counted = Number((agg?.[0] as any)?.count?.qty_fisik ?? (agg?.[0] as any)?.count) || 0;
	await directusServerJson(`/items/${SESSION}/${sessionId}`, { method: 'PATCH', body: JSON.stringify({ counted_lines: counted }) });
	return counted;
}

/**
 * Simpan hitungan. Idempoten secara alami (menimpa nilai). Hanya sesi `counting`.
 * Mengembalikan `perlu_bukti` per baris (selisih sementara > toleransi) TANPA membocorkan besarnya selisih.
 */
export async function simpanHitungan(sessionId: number, entries: EntriHitung[], karyawanNama: string) {
	const sesi = (await directusServerJson<{ data: any }>(`/items/${SESSION}/${sessionId}?fields=id,status`))?.data;
	if (!sesi) throw fail('Sesi tidak ditemukan.', 404);
	if (sesi.status !== 'counting') throw fail('Sesi ini sudah tidak menerima hitungan (bukan tahap "Menghitung").', 409);
	if (!entries?.length) throw fail('Tidak ada hitungan untuk disimpan.');
	const { toleransiPct } = await readOpnameLapanganConfig();
	const now = new Date().toISOString();
	const hasil: { lineId: number; ok: boolean; perlu_bukti?: boolean; error?: string }[] = [];

	for (const e of entries) {
		try {
			const q = e.qtyFisik === null || (e.qtyFisik as any) === '' || e.qtyFisik === undefined ? null : Number(e.qtyFisik);
			if (q !== null && (!Number.isFinite(q) || q < 0)) throw fail('Qty fisik harus angka ≥ 0.');
			const line = (await directusServerJson<{ data: any }>(`/items/${LINE}/${e.lineId}?fields=id,session,qty_sistem_snapshot,qty_mutasi_setelah_snapshot,foto_bukti`))?.data;
			if (!line || Number(idOf(line.session)) !== Number(sessionId)) throw fail('Baris bukan bagian sesi ini.', 404);
			// selisih SEMENTARA (tanpa mutasi pasca-snapshot) — final dihitung ulang erp-epi saat "Tutup Hitung"
			const sementara = q === null ? 0 : q - ((Number(line.qty_sistem_snapshot) || 0) + (Number(line.qty_mutasi_setelah_snapshot) || 0));
			const perluBukti = q !== null && melewatiToleransi(line.qty_sistem_snapshot, line.qty_mutasi_setelah_snapshot, sementara, toleransiPct);
			await directusServerJson(`/items/${LINE}/${e.lineId}`, {
				method: 'PATCH',
				body: JSON.stringify({
					qty_fisik: q,
					selisih: sementara,
					status: q === null ? 'pending' : 'counted',
					alasan_selisih: e.alasan ?? null,
					...(e.catatan !== undefined ? { alasan_catatan: e.catatan } : {}),
					...(e.foto ? { foto_bukti: e.foto } : {}),
					counted_by: q === null ? null : karyawanNama,
					counted_at: q === null ? null : now
				})
			});
			hasil.push({ lineId: e.lineId, ok: true, perlu_bukti: perluBukti && !(e.foto || line.foto_bukti) });
		} catch (err: any) {
			console.error('[opnameSesi] gagal simpan baris', e.lineId, err?.message || err);
			hasil.push({ lineId: e.lineId, ok: false, error: err?.message || 'Gagal menyimpan baris.' });
		}
	}
	const counted = await syncHeaderCounted(sessionId);
	return { hasil, counted_lines: counted };
}

// ── Kiosk Gudang ─────────────────────────────────────────────────────────────────────────────────────
/**
 * Kiosk opname per item: bila ada sesi `counting` yang memuat (rak,item) ini, hitungan MASUK SESI (bukan langsung memposting
 * penyesuaian). Null = tidak ada sesi / mode legacy -> kiosk berperilaku persis seperti sebelumnya.
 */
export async function masukkanKeSesiAktif(p: { itemId: number; rakId: number | null; hitungFisik: number; karyawanNama: string }) {
	const cfg = await readOpnameLapanganConfig();
	if (!cfg.sessionMode) return null;
	const sesi = await dget(`/items/${SESSION}?filter[status][_eq]=counting&sort=-id&limit=50&fields=id,kode`);
	if (!sesi.length) return null;
	const rakFilter = p.rakId ? `&filter[rak_id][_eq]=${p.rakId}` : `&filter[rak_id][_null]=true`;
	const lines = await dget(
		`/items/${LINE}?filter[session][_in]=${sesi.map((s) => s.id).join(',')}&filter[item_id][_eq]=${p.itemId}${rakFilter}&limit=5&fields=id,session`
	);
	const line = lines[0];
	if (!line) return null;
	const hit = sesi.find((s) => s.id === Number(idOf(line.session)));
	const res = await simpanHitungan(hit.id, [{ lineId: line.id, qtyFisik: p.hitungFisik, catatan: undefined }], p.karyawanNama);
	if (!res.hasil[0]?.ok) throw fail(res.hasil[0]?.error || 'Gagal memasukkan hitungan ke sesi.', 500);
	return { kode: hit.kode as string, lineId: line.id as number, perlu_bukti: !!res.hasil[0].perlu_bukti };
}

/**
 * Kiosk blind count (server-side): item yang punya baris di sesi `counting` ber-blind_count untuk (rak) ini TIDAK boleh
 * menerima stok sistem di layar kiosk. Mengembalikan set item_id yang harus di-blind. Mode legacy / tak ada sesi / gagal baca -> kosong.
 */
export async function itemBlindKiosk(itemIds: number[], rakId: number | null): Promise<Set<number>> {
	const out = new Set<number>();
	if (!itemIds.length) return out;
	try {
		const cfg = await readOpnameLapanganConfig();
		if (!cfg.sessionMode) return out;
		const sesi = await dget(`/items/${SESSION}?filter[status][_eq]=counting&filter[blind_count][_eq]=true&limit=50&fields=id`);
		if (!sesi.length) return out;
		const rakFilter = rakId ? `&filter[rak_id][_eq]=${rakId}` : `&filter[rak_id][_null]=true`;
		for (const part of chunk([...new Set(itemIds)])) {
			const rows = await dget(
				`/items/${LINE}?filter[session][_in]=${sesi.map((s) => s.id).join(',')}&filter[item_id][_in]=${part.join(',')}${rakFilter}&limit=-1&fields=item_id`
			);
			for (const r of rows) out.add(Number(idOf(r.item_id)));
		}
	} catch (e) {
		console.warn('[opnameSesi] cek blind kiosk gagal, stok ditampilkan seperti biasa:', (e as Error)?.message || e);
	}
	return out;
}

/** Salin item kiosk; yang blind: stok_sistem dikosongkan + penanda `blind_sesi`. */
export async function anotasiBlindKiosk<T extends { item_id: number; stok_sistem: number | null }>(items: T[], rakId: number | null) {
	const blind = await itemBlindKiosk(items.map((i) => i.item_id), rakId);
	if (!blind.size) return items;
	return items.map((i) => (blind.has(i.item_id) ? { ...i, stok_sistem: null, blind_sesi: true } : i));
}
