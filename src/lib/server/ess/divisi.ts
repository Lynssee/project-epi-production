// src/lib/server/ess/divisi.ts
// Helper bersama untuk scoping approval "divisi sama" (cuti, lembur, reimbursement).
// Ini SATU-SATUNYA lapisan otorisasi (tidak ada cek role Firestore di server) —
// jangan duplikasi logika ini inline di route handler.

import { error } from '@sveltejs/kit';
import { directusServerJson } from '$lib/server/directus';

/** Fase 2 kasbon (Q3, T5): kepala divisi/unit yang berwenang menyetujui tahap-1 kasbon divisi
 * tsb, dengan delegasi (kepala cuti) dan eskalasi otomatis ke HRD bila pengajuan menggantung
 * >24 jam. Pencocokan `divisi` (teks bebas di karyawan) ke `hrd_divisi.nama_divisi` bersifat
 * best-effort — 16 label divisi masih saling duplikat (T7); akan membaik setelah HRD merapikan
 * master divisi (Q7) atau karyawan punya FK hrd_divisi_id langsung.
 */
export interface HrdDivisiRow {
	id: number;
	nama_divisi: string;
	kepala_divisi_id: number | null;
	approver_delegasi_id: number | null;
	delegasi_berlaku_sampai: string | null;
}

const HRD_DIVISI_FIELDS = 'id,nama_divisi,kepala_divisi_id,approver_delegasi_id,delegasi_berlaku_sampai';

export async function listHrdDivisi(): Promise<HrdDivisiRow[]> {
	const result = await directusServerJson<{ data: HrdDivisiRow[] }>(
		`/items/hrd_divisi?fields=${HRD_DIVISI_FIELDS}&limit=-1`
	);
	return result?.data || [];
}

/** Token divisi ternormalisasi: huruf besar, "&"/"AND"/tanda baca dibuang, spasi dipadatkan. */
function divisiTokens(text: string | null | undefined): string[] {
	return String(text || '')
		.toUpperCase()
		.replace(/[^A-Z0-9 ]+/g, ' ')
		.split(/\s+/)
		.filter((t) => t && t !== 'AND' && t !== 'DAN');
}

/**
 * Cocokkan teks `karyawan.divisi` (bebas, mis. "IT") ke `hrd_divisi.nama_divisi`
 * (mis. "IT & MEDIA"). Sebelumnya pencocokan `_eq` persis, sehingga 3 karyawan berlabel
 * "IT" tidak pernah terhubung ke kepala divisi "IT & MEDIA" dan pengajuan kasbon mereka
 * tidak masuk inbox siapa pun. Aturan: sama persis setelah normalisasi, ATAU semua token
 * label karyawan termuat di token nama master ("IT" ⊂ {IT, MEDIA}). Arah subset sengaja
 * satu arah supaya "PLANT MANAGER" tidak ikut tertarik ke divisi "PLANT".
 */
export function divisiTextMatches(karyawanDivisi: string | null | undefined, masterNama: string | null | undefined): boolean {
	const a = divisiTokens(karyawanDivisi);
	const b = divisiTokens(masterNama);
	if (a.length === 0 || b.length === 0) return false;
	if (a.join(' ') === b.join(' ')) return true;
	return a.every((t) => b.includes(t));
}

/** Approver efektif satu baris master divisi: pejabat pengganti bila delegasinya masih berlaku. */
function resolveApproverBaris(divisi: HrdDivisiRow, today: string): number | null {
	if (
		divisi.approver_delegasi_id &&
		divisi.delegasi_berlaku_sampai &&
		String(divisi.delegasi_berlaku_sampai).slice(0, 10) >= today
	) {
		return Number(divisi.approver_delegasi_id);
	}
	return divisi.kepala_divisi_id ? Number(divisi.kepala_divisi_id) : null;
}

export async function resolveKepalaDivisiApprover(divisiText: string): Promise<number | null> {
	if (!divisiText) return null;
	const rows = await listHrdDivisi();
	const today = new Date().toISOString().slice(0, 10);
	const cocok = rows.filter((d) => divisiTextMatches(divisiText, d.nama_divisi));
	for (const d of cocok) {
		const approver = resolveApproverBaris(d, today);
		if (approver) return approver;
	}
	return null;
}

/** Fase 2 kasbon (Q3, T5): otorisasi approval tahap-1 kasbon — HANYA kepala divisi/unit (atau
 * pejabat pengganti yang didelegasikan), bukan lagi "divisi sama & bukan diri sendiri" (celah
 * dua rekan sejawat saling approve). Eskalasi: bila pengajuan sudah menggantung >24 jam, HRD
 * (dikenali dari teks divisi mengandung "HRD") boleh ikut menyetujui supaya tidak macet total. */
export async function assertCanApproveKasbonTahap1(
	approverKaryawanId: number,
	approverDivisi: string | null,
	targetKaryawanId: string | number,
	tanggalPengajuan: string,
	selfMessage: string
): Promise<void> {
	if (String(targetKaryawanId) === String(approverKaryawanId)) {
		throw error(400, selfMessage);
	}

	const query = new URLSearchParams({ fields: 'id,divisi,divisi_id,atasan_id' });
	const pemohon = await directusServerJson<{ data: { id: number; divisi: string | null; divisi_id: number | null; atasan_id: number | null } }>(
		`/items/karyawan/${targetKaryawanId}?${query.toString()}`
	);
	if (!pemohon?.data) {
		throw error(404, 'Data karyawan pemohon tidak ditemukan.');
	}
	// Atasan langsung selalu berwenang, meski master divisi belum rapi.
	if (pemohon.data.atasan_id != null && Number(pemohon.data.atasan_id) === Number(approverKaryawanId)) return;
	if (!pemohon.data.divisi && pemohon.data.divisi_id == null) {
		throw error(403, 'Divisi pemohon belum diisi HRD — tidak bisa menentukan kepala divisi penyetuju.');
	}

	// Pemohon bisa cocok ke >1 baris master (label divisi masih duplikat, T7) — approver sah
	// bila dia kepala/pengganti di SALAH SATU baris yang cocok, bukan hanya yang pertama.
	// Pencocokan: FK `divisi_id` bila ada, plus teks toleran (lihat `divisiTextMatches`).
	const today = new Date().toISOString().slice(0, 10);
	const rows = await listHrdDivisi();
	const cocok = rows.filter(
		(d) =>
			(pemohon.data.divisi_id != null && Number(d.id) === Number(pemohon.data.divisi_id)) ||
			divisiTextMatches(pemohon.data.divisi, d.nama_divisi)
	);
	const kepalaIds = cocok.map((d) => resolveApproverBaris(d, today)).filter((id): id is number => !!id);
	if (kepalaIds.some((id) => id === Number(approverKaryawanId))) return;
	const kepalaId = kepalaIds[0] ?? null;

	const pengajuanJamKe = (Date.now() - new Date(tanggalPengajuan).getTime()) / 3600000;
	const isEskalasiHrd = pengajuanJamKe > 24 && (approverDivisi || '').toUpperCase().includes('HRD');
	if (isEskalasiHrd) return;

	if (kepalaId) {
		throw error(403, 'Hanya kepala divisi/unit (atau pejabat pengganti) yang bisa menyetujui pengajuan ini.');
	}
	throw error(403, 'Kepala divisi belum ditentukan HRD di master Divisi — hubungi HRD.');
}

export async function listKaryawanIdsByDivisi(divisi: string): Promise<number[]> {
	if (!divisi) return [];
	const query = new URLSearchParams({
		'filter[divisi][_eq]': divisi,
		fields: 'id',
		limit: '-1'
	});
	const result = await directusServerJson<{ data: { id: number }[] }>(`/items/karyawan?${query.toString()}`);
	return (result?.data || []).map((k) => k.id);
}

/**
 * Fase 2 kasbon (Q3, T5) — versi diperbaiki: semua karyawan yang berada di bawah
 * `approverKaryawanId` sebagai kepala divisi/unit (atau pejabat pengganti aktif).
 * Keanggotaan divisi dinilai dari `karyawan.divisi_id` (FK, sumber paling tepat) ATAU
 * pencocokan teks `karyawan.divisi` yang toleran (lihat `divisiTextMatches`), ditambah
 * bawahan langsung lewat `karyawan.atasan_id`. Sebelumnya hanya `divisi _eq nama_divisi`,
 * sehingga label pendek ("IT" vs master "IT & MEDIA") membuat inbox kepala kosong.
 */
export async function listKaryawanIdsUnderKepala(
	approverKaryawanId: number,
	excludeKaryawanId: number
): Promise<number[]> {
	const today = new Date().toISOString().slice(0, 10);
	const rows = await listHrdDivisi();
	const dipimpin = rows.filter((d) => resolveApproverBaris(d, today) === Number(approverKaryawanId));

	const result = await directusServerJson<{ data: { id: number; divisi: string | null; divisi_id: number | null; atasan_id: number | null }[] }>(
		`/items/karyawan?fields=id,divisi,divisi_id,atasan_id&limit=-1`
	);
	const semua = result?.data || [];
	const divisiIds = new Set(dipimpin.map((d) => Number(d.id)));

	const ids = new Set<number>();
	for (const k of semua) {
		if (Number(k.id) === Number(excludeKaryawanId)) continue;
		const viaFk = k.divisi_id != null && divisiIds.has(Number(k.divisi_id));
		const viaTeks = dipimpin.some((d) => divisiTextMatches(k.divisi, d.nama_divisi));
		const viaAtasan = k.atasan_id != null && Number(k.atasan_id) === Number(approverKaryawanId);
		if (viaFk || viaTeks || viaAtasan) ids.add(Number(k.id));
	}
	return [...ids];
}

/**
 * Pastikan approver boleh memproses pengajuan `targetKaryawanId`: atasan langsung SELALU
 * berwenang (dicek lebih dulu, lintas divisi) -- pola yang sama dengan
 * `assertCanApproveLemburStep1`/`assertCanApproveKasbonTahap1` di bawah. Kalau bukan atasan,
 * fallback ke aturan lama: divisi sama DAN keduanya benar-benar terisi (divisi kosong/null
 * tidak dianggap "sama"), serta bukan pengajuan diri sendiri. Lempar 400/403 kalau gagal.
 *
 * T4 (Department Management versi tajam, 19 Agu 2026): sebelum ini, assertCanApprove HANYA
 * mengecek "divisi sama" -- artinya siapa pun rekan sedivisi (bukan cuma atasan/pejabat
 * berwenang) bisa saling approve cuti/reimburse satu sama lain, tanpa memandang jabatan.
 * Menambahkan cek atasan_id lebih dulu menutup celah itu tanpa mengubah rute cuti/reimburse
 * yang memanggilnya (assertCanApprove tetap satu-satunya lapisan otorisasi, sesuai komentar
 * modul ini) dan tanpa perlu redirect lintas-app ke erp-epi-1 (yang akan kehilangan logic
 * bisnis lokal seperti cek sisa cuti tahunan & generate absensi_harian saat approve).
 */
export async function assertCanApprove(
	approverKaryawanId: number,
	approverDivisi: string | null,
	targetKaryawanId: string | number,
	selfMessage: string
): Promise<void> {
	if (String(targetKaryawanId) === String(approverKaryawanId)) {
		throw error(400, selfMessage);
	}

	const query = new URLSearchParams({ fields: 'id,divisi,atasan_id' });
	const pemohon = await directusServerJson<{ data: { id: number; divisi: string | null; atasan_id: number | null } }>(
		`/items/karyawan/${targetKaryawanId}?${query.toString()}`
	);

	const atasanId = pemohon?.data?.atasan_id;
	if (atasanId != null && Number(atasanId) === Number(approverKaryawanId)) return;

	if (!approverDivisi) {
		throw error(403, 'Anda hanya bisa memproses pengajuan dari divisi yang sama.');
	}
	if (!pemohon?.data?.divisi || pemohon.data.divisi !== approverDivisi) {
		throw error(403, 'Anda hanya bisa memproses pengajuan dari divisi yang sama.');
	}
}

/** P4: deteksi staf HRD dari teks divisi (konvensi ad hoc yang sama dipakai eskalasi kasbon
 * di atas) — dipakai untuk mengizinkan approval step-2 (eskalasi) lembur >4 jam/hari libur. */
export function isHrdDivisi(divisiText: string | null | undefined): boolean {
	return (divisiText || '').toUpperCase().includes('HRD');
}

/**
 * P4: otorisasi approval STEP 1 lembur — atasan langsung (`karyawan.atasan_id`) sebagai jalur
 * utama (boleh lintas divisi, karena atasan tidak selalu sedivisi teks yang sama). Bila
 * `atasan_id` kosong/tidak match approver, fallback ke aturan lama `assertCanApprove`
 * (rekan sedivisi) — supaya karyawan yang atasan_id-nya belum diisi HRD tidak macet
 * dibanding perilaku sebelum P4.
 */
export async function assertCanApproveLemburStep1(
	approverKaryawanId: number,
	approverDivisi: string | null,
	targetKaryawanId: string | number,
	selfMessage: string
): Promise<void> {
	if (String(targetKaryawanId) === String(approverKaryawanId)) {
		throw error(400, selfMessage);
	}

	const query = new URLSearchParams({ fields: 'id,divisi,atasan_id' });
	const pemohon = await directusServerJson<{ data: { id: number; divisi: string | null; atasan_id: number | null } }>(
		`/items/karyawan/${targetKaryawanId}?${query.toString()}`
	);
	const atasanId = pemohon?.data?.atasan_id;
	if (atasanId != null && Number(atasanId) === Number(approverKaryawanId)) return;

	await assertCanApprove(approverKaryawanId, approverDivisi, targetKaryawanId, selfMessage);
}
