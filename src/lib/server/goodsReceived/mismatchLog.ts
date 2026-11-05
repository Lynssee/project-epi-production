// Skema Ketidaksesuaian Pengiriman — Fase 2: pemetaan komplain/selisih penerimaan lapangan ke
// logistik_klaim.jenis dan antrean barang_bermasalah_log (dikerjakan Admin di erp-epi /inventory/barang-bermasalah).
// Murni (tanpa I/O) supaya bisa dites. Hanya memakai kolom yang ADA di skema live (Aturan #1).

export type KomplainTipe = 'wrong_item' | 'damaged' | 'quality_issue' | 'other';
export type SumberMasalah = 'salah_kirim_gudang' | 'salah_pesan_proyek';
export type KlaimJenis = 'kurang' | 'rusak' | 'hilang' | 'salah_spek';

/** Awalan batch_no pada barang_bermasalah_log hasil komplain lapangan pasca-terima (dasar filter kunci pemakaian). */
export const KOMPLAIN_BATCH_PREFIX = 'KOMPLAIN:';
/** Awalan batch_no baris salah-spek saat konfirmasi terima SJ (barang yang ditolak, bukan yang diterima — tidak mengunci pemakaian). */
export const TERIMA_BATCH_PREFIX = 'TERIMA:';

export const SUMBER_MASALAH_LABEL: Record<SumberMasalah, string> = {
	salah_kirim_gudang: 'Salah kirim dari Gudang/Vendor',
	salah_pesan_proyek: 'Salah pesan dari Proyek (spek PR/PO keliru)'
};

/** Komplain manual -> logistik_klaim.jenis. wrong_item TIDAK lagi dipetakan ke 'kurang' (laporan salah spek terbaca sebagai kurang). */
export function tipeToKlaimJenis(tipe: string): KlaimJenis {
	switch (tipe) {
		case 'wrong_item':
			return 'salah_spek';
		case 'damaged':
		case 'quality_issue':
			return 'rusak';
		default:
			return 'kurang';
	}
}

export function normalizeSumberMasalah(v: unknown): SumberMasalah {
	return v === 'salah_pesan_proyek' ? 'salah_pesan_proyek' : 'salah_kirim_gudang';
}

/** Komplain manual -> barang_bermasalah_log.jenis (varchar bebas; daftar UI admin ikut diperluas di erp-epi). */
export function komplainToBermasalahJenis(tipe: string, sumber: SumberMasalah): string {
	if (tipe === 'wrong_item') return sumber === 'salah_pesan_proyek' ? 'salah_beli_internal' : 'salah_kirim';
	if (tipe === 'damaged') return 'rusak';
	return 'lainnya';
}

const TIPE_LABEL: Record<string, string> = {
	wrong_item: 'Barang salah / tidak sesuai spek',
	damaged: 'Rusak',
	quality_issue: 'Masalah mutu',
	other: 'Lainnya'
};

interface BaseInput {
	nomorSj: string;
	suratJalanId: number;
	projectId?: number | null;
	reporter?: string | null;
	keterangan?: string;
	evidenceFileIds?: string[];
}

/**
 * Payload barang_bermasalah_log untuk komplain manual pasca-terima. severity 'warning' + blocks_dispatch=false:
 * SJ sudah diterima, jadi tidak ada dispatch yang perlu ditahan. Tautan ke SJ lewat surat_jalan_id.
 */
export function buildKomplainLogPayload(
	p: BaseInput & { tipe: string; sumber: SumberMasalah; qty?: number | null; itemId?: number | null; namaBarang?: string | null }
) {
	const parts = [
		`[Komplain Lapangan] SJ ${p.nomorSj} — ${TIPE_LABEL[p.tipe] || p.tipe}.`,
		p.tipe === 'wrong_item' ? `Sumber: ${SUMBER_MASALAH_LABEL[p.sumber]}.` : '',
		'Barang SUDAH diterima di proyek (stok & HPP proyek belum dikoreksi) — menunggu keputusan Admin/Inventory.',
		p.keterangan ? `Keterangan: ${p.keterangan}` : '',
		p.evidenceFileIds?.length ? `Foto bukti (file Directus): ${p.evidenceFileIds.join(', ')}` : ''
	].filter(Boolean);
	return {
		// item_id terisi => komplain ini MENGUNCI pemakaian barang tsb di proyek (gate G_PROYEK_KOMPLAIN_LOCK, lihat komplainLockGate.ts).
		item_id: p.itemId ?? null,
		nama_barang: p.namaBarang || `SJ ${p.nomorSj} — ${TIPE_LABEL[p.tipe] || p.tipe}`,
		// Penanda baris komplain pasca-terima (membedakan dari log GRN/salah-spek-saat-terima yang memakai batch_no lain).
		batch_no: `${KOMPLAIN_BATCH_PREFIX}${p.nomorSj}`,
		project_id: p.projectId ?? null,
		packing_list_id: null,
		surat_jalan_id: p.suratJalanId,
		jenis: komplainToBermasalahJenis(p.tipe, p.sumber),
		deskripsi: parts.join(' '),
		qty: p.qty && p.qty > 0 ? p.qty : null,
		severity: 'warning',
		blocks_dispatch: false,
		status: 'open',
		reported_by: p.reporter ?? null
	};
}

/** Baris Salah Spek saat konfirmasi terima SJ -> barang_bermasalah_log (barang master bila ada). */
export function buildSalahSpekLogPayload(
	p: BaseInput & { namaBarang: string; itemId?: number | null; qty: number; backhaul?: boolean }
) {
	const parts = [
		`[Salah Spek saat Terima] SJ ${p.nomorSj} — ${p.qty} unit tidak sesuai spek, tidak diterima.`,
		p.backhaul ? 'Ditandai TITIP BALIK ke supir — Admin gudang perlu menyiapkan dokumen retur agar tidak tertahan di Pos Satpam.' : 'Menunggu keputusan Admin/Inventory (retur / kirim pengganti).',
		p.keterangan ? `Keterangan: ${p.keterangan}` : ''
	].filter(Boolean);
	return {
		item_id: p.itemId ?? null,
		nama_barang: p.namaBarang || 'Item',
		// Penanda sumber "terima di proyek" untuk tab Barang Bermasalah di admin (BUKAN penanda kunci pemakaian — lihat KOMPLAIN_BATCH_PREFIX).
		batch_no: `${TERIMA_BATCH_PREFIX}${p.nomorSj}`,
		project_id: p.projectId ?? null,
		packing_list_id: null,
		surat_jalan_id: p.suratJalanId,
		jenis: 'salah_kirim',
		deskripsi: parts.join(' '),
		qty: p.qty > 0 ? p.qty : null,
		severity: 'warning',
		blocks_dispatch: false,
		status: 'open',
		reported_by: p.reporter ?? null
	};
}

export interface ReturSiapItem {
	item_id: number;
	material_name: string;
	qty_returned: number;
	unit: string;
	condition: 'ok' | 'rusak';
	leader_notes: string;
}

/**
 * Item retur yang SIAP diajukan Project Leader dari layar sukses komplain (barang salah/rusak yang dikomplain).
 * Memakai alur retur lapangan yang ada (/api/retur-gudang): gate G_RTN_DOBEL, cek saldo & kunci mutasi tetap berlaku — di sini
 * hanya mengisi awal. Tanpa proyek / barang master / satuan => null (tidak bisa diajukan otomatis, PL memakai halaman retur biasa).
 * condition: salah spek = barang utuh ('ok'), rusak = 'rusak'.
 */
export function buildReturSiap(p: {
	tipe: string;
	nomorSj: string;
	projectId: number | null;
	keterangan: string;
	items: Array<{ identitasBarangId: number; namaBarang: string; qtySent: number; qty: number; unit?: string | null }>;
}): { projectId: number; nomorSj: string; items: ReturSiapItem[] } | null {
	if (!p.projectId || (p.tipe !== 'wrong_item' && p.tipe !== 'damaged')) return null;
	const note = `Komplain SJ ${p.nomorSj}: ${String(p.keterangan || '').trim()}`.slice(0, 500);
	const items: ReturSiapItem[] = [];
	for (const it of p.items) {
		const qty = it.qty > 0 ? it.qty : it.qtySent;
		const unit = String(it.unit || '').trim();
		if (!(qty > 0) || !unit) continue;
		items.push({
			item_id: it.identitasBarangId,
			material_name: it.namaBarang,
			qty_returned: qty,
			unit,
			condition: p.tipe === 'damaged' ? 'rusak' : 'ok',
			leader_notes: note
		});
	}
	return items.length ? { projectId: p.projectId, nomorSj: p.nomorSj, items } : null;
}
