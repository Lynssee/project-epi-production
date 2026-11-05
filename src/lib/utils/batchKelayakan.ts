// src/lib/utils/batchKelayakan.ts
// Murni (tanpa I/O) — status kelayakan pakai satu batch/kaleng untuk layar lapangan (Rencana Expired Date v2, Fase 5).
// Aturan yang SAMA dengan Radar/Katalog di erp-epi (zona kadaluarsa), versi ringkas: ambang "prioritas FEFO" = setelan
// inventory.shelf_life.aging_hari_default (bukan ambang per kategori seperti Radar ERP — lapangan memakai satu angka
// agar mudah dipahami; selisih ini disengaja & didokumentasikan).

export type KelayakanStatus = 'layak' | 'prioritas' | 'stop' | 'tanpa_tanggal';

export interface Kelayakan {
	status: KelayakanStatus;
	/** Judul banner singkat, mis. "LAYAK PAKAI". */
	label: string;
	/** Kalimat arahan untuk operator. */
	pesan: string;
	sisaHari: number | null;
	/** true = tampilkan tombol "Minta Uji Ulang Lab QC". */
	bisaMintaRetest: boolean;
}

const DAY_MS = 86400000;

function dateOnly(v: string | Date | null | undefined): string | null {
	if (!v) return null;
	if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
	const d = new Date(v);
	return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Selisih hari kalender (UTC) dari `now` ke tanggal expired; negatif = sudah lewat. */
export function sisaHari(tanggal: string | Date | null | undefined, now: Date = new Date()): number | null {
	const e = dateOnly(tanggal);
	const n = dateOnly(now);
	if (!e || !n) return null;
	return Math.round((Date.parse(`${e}T00:00:00Z`) - Date.parse(`${n}T00:00:00Z`)) / DAY_MS);
}

export interface KelayakanInput {
	tanggalKadaluarsa: string | null;
	/** item_batch.status: active | depleted | expired | quarantine */
	status?: string | null;
	/** Ada komplain customer terbuka untuk batch ini. */
	hold?: boolean;
	/** Re-QC lulus masih berlaku. */
	retestAktif?: boolean;
	retestBerlakuSampai?: string | null;
	/** Ambang "prioritas FEFO" dalam hari. */
	agingHari?: number;
	now?: Date;
}

export function klasifikasiKelayakan(i: KelayakanInput): Kelayakan {
	const now = i.now ?? new Date();
	const aging = Number.isFinite(Number(i.agingHari)) && Number(i.agingHari) > 0 ? Math.floor(Number(i.agingHari)) : 30;
	const sisa = sisaHari(i.tanggalKadaluarsa, now);

	if (i.hold) {
		return { status: 'stop', label: 'STOP — BATCH DITAHAN', pesan: 'Ada komplain customer terbuka. Jangan dipakai/dikirim sebelum dikonfirmasi tim QC.', sisaHari: sisa, bisaMintaRetest: false };
	}
	if (i.status === 'quarantine') {
		return { status: 'stop', label: 'STOP — KARANTINA', pesan: 'Batch dikarantina (Re-QC gagal atau ditahan QC). Jangan dipakai; tunggu keputusan QC.', sisaHari: sisa, bisaMintaRetest: false };
	}
	if (i.status === 'expired') {
		return { status: 'stop', label: 'STOP — EXPIRED', pesan: 'Batch berstatus expired. Jangan dipakai tanpa Uji Ulang Lab QC yang lulus.', sisaHari: sisa, bisaMintaRetest: true };
	}
	if (sisa == null) {
		return { status: 'tanpa_tanggal', label: 'TANGGAL KADALUARSA BELUM ADA', pesan: 'Tanggal kadaluarsa belum tercatat di sistem. Periksa label fisik kaleng/CoA, lalu laporkan ke gudang.', sisaHari: null, bisaMintaRetest: false };
	}
	if (sisa < 0) {
		if (i.retestAktif) {
			const s = dateOnly(i.retestBerlakuSampai);
			return { status: 'prioritas', label: 'LOLOS RE-QC — PAKAI SEGERA', pesan: `Sudah lewat tanggal kadaluarsa ${Math.abs(sisa)} hari, tetapi lolos Uji Ulang Lab QC${s ? ` (berlaku s/d ${s})` : ''}. Pakai paling dulu.`, sisaHari: sisa, bisaMintaRetest: false };
		}
		return { status: 'stop', label: 'STOP — EXPIRED / WAJIB RE-QC', pesan: `Lewat ${Math.abs(sisa)} hari dari tanggal kadaluarsa. Jangan dipakai; minta Uji Ulang Lab QC.`, sisaHari: sisa, bisaMintaRetest: true };
	}
	if (sisa <= aging) {
		return { status: 'prioritas', label: 'PRIORITAS FEFO', pesan: `Sisa ${sisa} hari. Pakai kaleng/batch ini DULU sebelum yang lain.`, sisaHari: sisa, bisaMintaRetest: sisa <= Math.min(aging, 7) };
	}
	return { status: 'layak', label: 'LAYAK PAKAI', pesan: `Sisa ${sisa} hari sampai kadaluarsa.`, sisaHari: sisa, bisaMintaRetest: false };
}

export interface BatchAktifRingkas {
	id: number;
	item_id: number;
	lot_number: string | null;
	batch_no_fg: string | null;
	tanggal_kadaluarsa: string | null;
	qty_tersisa: number | string | null;
	satuan?: string | null;
}

export interface ExpiryHintItem {
	itemId: number;
	/** Batch aktif berstok dengan tanggal paling dekat (FEFO). null bila tak satu pun punya tanggal. */
	terdekat: { batchId: number; lot: string | null; tanggal: string; sisaHari: number; qty: number; satuan: string } | null;
	status: KelayakanStatus | null;
	label: string | null;
	jumlahBatch: number;
	tanpaTanggal: number;
}

/** Ringkas daftar batch aktif menjadi satu petunjuk per barang (dipakai kiosk cek-stok, konsumsi, stok lapangan). */
export function ringkasExpiryPerItem(batches: BatchAktifRingkas[], agingHari: number, now: Date = new Date()): Record<number, ExpiryHintItem> {
	const out: Record<number, ExpiryHintItem> = {};
	for (const b of batches) {
		const qty = Number(b.qty_tersisa) || 0;
		if (qty <= 0) continue;
		const cur = (out[b.item_id] ||= { itemId: b.item_id, terdekat: null, status: null, label: null, jumlahBatch: 0, tanpaTanggal: 0 });
		cur.jumlahBatch += 1;
		const tgl = dateOnly(b.tanggal_kadaluarsa);
		if (!tgl) { cur.tanpaTanggal += 1; continue; }
		if (!cur.terdekat || tgl < cur.terdekat.tanggal) {
			cur.terdekat = { batchId: b.id, lot: b.batch_no_fg || b.lot_number || null, tanggal: tgl, sisaHari: sisaHari(tgl, now) ?? 0, qty, satuan: b.satuan || '' };
		}
	}
	for (const it of Object.values(out)) {
		if (!it.terdekat) continue;
		const k = klasifikasiKelayakan({ tanggalKadaluarsa: it.terdekat.tanggal, agingHari, now });
		it.status = k.status;
		it.label = k.label;
	}
	return out;
}
