// src/lib/server/spjUpah.ts
// GPM-C09 (lapangan) — SPJ Upah: koordinator upah (leader) membuktikan bahwa upah yang ia terima benar-benar dibagikan ke tiap pekerja.
// Data: PA gaji `penerima_dana_type='koordinator_upah'` (dynamic_fields.koordinator_upah.manpower_id = koordinator) yang sudah cair; rincian
// `pengajuan_anggaran_manpower` (pekerja + bagian); bukti di koleksi `pengajuan_anggaran_distribusi_upah` (dibuat lewat
// erp-epi/scratch/2026-10-buat-koleksi-distribusi-upah.mjs). Finance memverifikasi tiap baris di ERP (tab "Distribusi upah"); gate
// G_UPAH_DISTRIBUSI di ERP menilai kelengkapannya saat koordinator yang sama mengajukan upah baru.
// Identitas SELALU dari token (manpower.user_email) — tidak pernah dari input klien. Bagian murni di sini diuji; I/O tipis.

import { directusServerJson } from '$lib/server/directus';

export const KOLEKSI_DISTRIBUSI = 'pengajuan_anggaran_distribusi_upah';
export const STATUS_PA_GUGUR = ['Rejected', 'Dibatalkan'];
export const UMUR_MAKS_HARI = 90;
export const BATAS_HARI_DEFAULT = 3;
export const TOLERANSI_DEFAULT = 0;
export const METODE = ['tunai', 'transfer'] as const;
export const FOTO_MAKS_BYTE = 8 * 1024 * 1024;

const idOf = (v: any) => (v && typeof v === 'object' ? v.id : v);
const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const tgl = (d: any) => String(d ?? '').slice(0, 10);

export type StatusBukti = 'belum' | 'menunggu' | 'disetujui' | 'ditolak';

export function koordinatorIdDari(dynamicFields: any): number | null {
	let df = dynamicFields;
	if (typeof df === 'string') {
		try { df = JSON.parse(df); } catch { df = null; }
	}
	const id = idOf(df?.koordinator_upah?.manpower_id);
	return id != null && Number.isFinite(Number(id)) ? Number(id) : null;
}

/** Tanggal + n hari (YYYY-MM-DD, UTC). */
export function tambahHari(ymd: string, n: number): string {
	const [y, m, d] = tgl(ymd).split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Status satu pekerja dari barisnya: ada yang disetujui → disetujui; semua ditolak → ditolak; ada menunggu → menunggu; kosong → belum. */
export function statusPekerja(baris: Array<{ status_verifikasi?: string | null; bukti_file_id?: any }>): StatusBukti {
	const aktif = baris.filter((b) => idOf(b.bukti_file_id) != null);
	if (!aktif.length) return 'belum';
	const st = aktif.map((b) => String(b.status_verifikasi || 'menunggu').toLowerCase());
	if (st.every((s) => s === 'ditolak')) return 'ditolak';
	if (st.some((s) => s !== 'ditolak' && s !== 'disetujui')) return 'menunggu';
	return st.some((s) => s === 'disetujui') ? 'disetujui' : 'menunggu';
}

export interface RingkasPekerja {
	manpower_id: number;
	nama: string;
	jumlah_rincian: number;
	jumlah_diterima: number;
	status: StatusBukti;
	baris: Array<{ id: number; jumlah_diterima: number; metode: string; diterima_at: string | null; bukti_file_id: string | null; status_verifikasi: string; catatan_verifikasi: string | null }>;
}

/**
 * Ringkasan satu PA untuk layar SPJ. "Lengkap" = setiap pekerja punya bukti yang tidak ditolak DAN Σ diterima = nominal (± toleransi) —
 * sama dengan aturan gate G_UPAH_DISTRIBUSI di ERP (baris ditolak tidak dihitung).
 */
export function ringkasPA(p: {
	pa: any; rincian: any[]; distribusi: any[]; nama: Map<string, string>; hariIni: string; batasHari?: number; toleransi?: number;
}) {
	const { pa, rincian, distribusi, nama, hariIni } = p;
	const batasHari = p.batasHari ?? BATAS_HARI_DEFAULT;
	const toleransi = p.toleransi ?? TOLERANSI_DEFAULT;
	const ids = [...new Set(rincian.map((r) => idOf(r.manpower_id)).filter((x) => x != null).map(Number))];
	const pekerja: RingkasPekerja[] = ids.map((m) => {
		const baris = distribusi.filter((d) => Number(idOf(d.manpower_id)) === m);
		return {
			manpower_id: m,
			nama: nama.get(String(m)) || `Manpower #${m}`,
			jumlah_rincian: rincian.filter((r) => Number(idOf(r.manpower_id)) === m).reduce((s, r) => s + num(r.jumlah), 0),
			jumlah_diterima: baris.filter((b) => String(b.status_verifikasi || '').toLowerCase() !== 'ditolak').reduce((s, b) => s + num(b.jumlah_diterima), 0),
			status: statusPekerja(baris),
			baris: baris.map((b) => ({
				id: Number(b.id), jumlah_diterima: num(b.jumlah_diterima), metode: b.metode || 'tunai', diterima_at: b.diterima_at || null,
				bukti_file_id: idOf(b.bukti_file_id) ?? null, status_verifikasi: String(b.status_verifikasi || 'menunggu'), catatan_verifikasi: b.catatan_verifikasi || null
			}))
		};
	});
	const nominal = num(pa.total_amount);
	const totalDiterima = pekerja.reduce((s, x) => s + x.jumlah_diterima, 0);
	const belumBukti = pekerja.filter((x) => x.status === 'belum' || x.status === 'ditolak').length;
	const selisih = Math.round((totalDiterima - nominal) * 100) / 100;
	const batasTanggal = tambahHari(pa.tanggal_dicairkan, batasHari);
	const lengkap = pekerja.length > 0 && belumBukti === 0 && Math.abs(selisih) <= Math.max(0, toleransi) + 1e-9;
	return {
		id: Number(pa.id), nomor_pengajuan: pa.nomor_pengajuan || `PA #${pa.id}`, total_amount: nominal, tanggal_dicairkan: tgl(pa.tanggal_dicairkan),
		batas_tanggal: batasTanggal, terlambat: !lengkap && hariIni > batasTanggal, lengkap, total_diterima: totalDiterima, selisih, pekerja_belum_bukti: belumBukti, pekerja
	};
}

export interface MasukanBukti {
	manpowerId: number;
	jumlah: number;
	metode: string;
	fotoByte: number;
	fotoTipe: string;
}

/**
 * Validasi satu bukti baru. Mengembalikan pesan kesalahan (kosong = sah). Murni.
 * Total diterima (selain baris ditolak) + bukti baru tidak boleh melebihi nominal dicairkan + toleransi.
 */
export function validasiBukti(p: { pa: any; manpowerKoordinator: number; rincian: any[]; distribusi: any[]; masukan: MasukanBukti; toleransi?: number; hariIni: string }): string[] {
	const { pa, rincian, distribusi, masukan, hariIni } = p;
	const err: string[] = [];
	if (!pa) return ['Pengajuan tidak ditemukan.'];
	if (String(pa.penerima_dana_type) !== 'koordinator_upah') err.push('Pengajuan ini bukan jalur koordinator upah.');
	if (koordinatorIdDari(pa.dynamic_fields) !== p.manpowerKoordinator) err.push('Anda bukan koordinator upah pada pengajuan ini.');
	if (!pa.tanggal_dicairkan) err.push('Dana belum dicairkan — bukti pembagian baru dicatat setelah dana cair.');
	if (STATUS_PA_GUGUR.includes(String(pa.status))) err.push('Pengajuan ini ditolak/dibatalkan.');
	const pekerja = new Set(rincian.map((r) => Number(idOf(r.manpower_id))));
	if (!pekerja.has(masukan.manpowerId)) err.push('Pekerja tidak ada di rincian pengajuan ini.');
	if (!(masukan.jumlah > 0)) err.push('Jumlah diterima harus lebih dari 0.');
	if (!(METODE as readonly string[]).includes(masukan.metode)) err.push("Metode harus 'tunai' atau 'transfer'.");
	if (!masukan.fotoByte) err.push('Foto bukti wajib (pekerja memegang uang atau tanda terima bertanda tangan).');
	else if (!/^image\//i.test(masukan.fotoTipe)) err.push('Bukti harus berupa foto.');
	else if (masukan.fotoByte > FOTO_MAKS_BYTE) err.push('Ukuran foto terlalu besar (maksimal 8 MB).');
	if (hariIni < tgl(pa.tanggal_dicairkan)) err.push('Tanggal pencairan di masa depan.');
	const sudah = distribusi.filter((d) => String(d.status_verifikasi || '').toLowerCase() !== 'ditolak').reduce((s, d) => s + num(d.jumlah_diterima), 0);
	const batas = num(pa.total_amount) + Math.max(0, p.toleransi ?? TOLERANSI_DEFAULT);
	if (masukan.jumlah > 0 && sudah + masukan.jumlah > batas + 1e-9) {
		err.push(`Total diterima melebihi nominal yang dicairkan (sudah Rp ${Math.round(sudah).toLocaleString('id-ID')} + Rp ${Math.round(masukan.jumlah).toLocaleString('id-ID')} > Rp ${Math.round(batas).toLocaleString('id-ID')}).`);
	}
	return err;
}

// ───────────────────────────── I/O (tipis) ─────────────────────────────

/** Setelan bersama dengan ERP (app_settings global). Gagal baca → default + peringatan. */
export async function bacaSetelan(): Promise<{ batasHari: number; toleransi: number }> {
	try {
		const res = await directusServerJson<{ data: any[] }>('/items/app_settings?filter[module][_eq]=global&fields=setting_key,setting_value&limit=-1');
		const m = new Map((res?.data || []).map((r) => [r.setting_key, r.setting_value]));
		const n = (k: string, d: number) => { const v = Number(m.get(k)); return m.get(k) != null && m.get(k) !== '' && Number.isFinite(v) ? v : d; };
		return { batasHari: n('pa.distribusi.batas_hari', BATAS_HARI_DEFAULT), toleransi: n('pa.distribusi.toleransi', TOLERANSI_DEFAULT) };
	} catch (e) {
		console.warn('[spjUpah] gagal membaca setelan distribusi (pakai default):', (e as any)?.message || e);
		return { batasHari: BATAS_HARI_DEFAULT, toleransi: TOLERANSI_DEFAULT };
	}
}

/** PA koordinator yang sudah cair (≤ UMUR_MAKS_HARI) milik koordinator ini. Error DILEMPAR. */
export async function muatPAKoordinator(manpowerId: number, hariIni: string): Promise<any[]> {
	const filter = {
		_and: [
			{ kategori_belanja: { _eq: 'gaji_manpower' } }, { penerima_dana_type: { _eq: 'koordinator_upah' } },
			{ tanggal_dicairkan: { _nnull: true } }, { tanggal_dicairkan: { _gte: tambahHari(hariIni, -UMUR_MAKS_HARI) } },
			{ status: { _nin: STATUS_PA_GUGUR } }
		]
	};
	const q = new URLSearchParams({ filter: JSON.stringify(filter), fields: 'id,nomor_pengajuan,status,total_amount,tanggal_dicairkan,penerima_dana_type,dynamic_fields', sort: '-tanggal_dicairkan', limit: '-1' });
	const res = await directusServerJson<{ data: any[] }>(`/items/pengajuan_anggaran?${q.toString()}`);
	// dynamic_fields (JSON) tidak bisa difilter andal di semua DB → cocokkan koordinator di sini.
	return (res?.data || []).filter((pa) => koordinatorIdDari(pa.dynamic_fields) === manpowerId);
}

/** Rincian + bukti + nama pekerja untuk sekumpulan PA (3 query terpisah, Aturan #2). */
export async function muatDetailPA(paIds: number[]) {
	if (!paIds.length) return { rincian: [] as any[], distribusi: [] as any[], nama: new Map<string, string>() };
	const ids = paIds.join(',');
	const [rincianRes, distribusiRes] = await Promise.all([
		directusServerJson<{ data: any[] }>(`/items/pengajuan_anggaran_manpower?filter[pengajuan_anggaran_id][_in]=${ids}&fields=id,pengajuan_anggaran_id,manpower_id,jumlah&limit=-1`),
		directusServerJson<{ data: any[] }>(`/items/${KOLEKSI_DISTRIBUSI}?filter[pengajuan_anggaran_id][_in]=${ids}&fields=id,pengajuan_anggaran_id,manpower_id,jumlah_diterima,metode,bukti_file_id,diterima_at,status_verifikasi,catatan_verifikasi&sort=id&limit=-1`)
	]);
	const rincian = rincianRes?.data || [];
	const mIds = [...new Set(rincian.map((r) => idOf(r.manpower_id)).filter((x) => x != null))];
	const namaRes = mIds.length ? await directusServerJson<{ data: any[] }>(`/items/manpower?filter[id][_in]=${mIds.join(',')}&fields=id,nama&limit=-1`) : { data: [] };
	return { rincian, distribusi: distribusiRes?.data || [], nama: new Map((namaRes?.data || []).map((m) => [String(m.id), m.nama])) };
}
