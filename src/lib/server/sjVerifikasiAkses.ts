// SJ-06 / SJH-19 §4.1–4.2 — akses & kelayakan verifikasi fisik SJ proyek dari lapangan.
// Bagian murni (tanpa I/O) dipisah supaya mudah diuji; I/O (aktor, tanggal mulai) di bawahnya.

import type { RequestEvent } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getUserPermissions, hasAnyPermission } from '$lib/server/rbacServer';
import { resolveKaryawanByEmail, type ServerKaryawan } from '$lib/server/ess/karyawan';
import { directusServerJson } from '$lib/server/directus';
import { authenticateProjectLeader } from '$lib/server/goodsReceived/guard';

/** Tanggal rilis fitur (cadangan terakhir aturan tanggal mulai §4.2 no. 5c): SJ lama tidak membanjiri daftar. */
export const TANGGAL_RILIS_VERIFIKASI = '2026-10-08';

export type LacakActor = {
	karyawan: ServerKaryawan;
	/** proyek yang dipimpin / ditunjuk sebagai staf backup (kosong untuk driver murni) */
	projectIds: number[];
	/** Admin: boleh memverifikasi proyek manapun (tidak dibatasi projectIds) */
	isAdmin: boolean;
};

/**
 * Aktor layar Lacak SJ. TIDAK melempar 403 bila bukan PL/backup/admin — driver murni tetap boleh masuk
 * (regresi SJH-17). Pembatasan SJ mana yang boleh dibuka dilakukan endpoint masing-masing.
 */
export async function authenticateLacakActor(event: RequestEvent): Promise<LacakActor> {
	const { karyawan, projectIds: leaderIds } = await authenticateProjectLeader(event);

	const header = event.request.headers.get('authorization') || '';
	const idToken = header.startsWith('Bearer ') ? header.slice(7) : null;
	let isAdmin = false;
	if (idToken) {
		const user = await requireUser(event);
		const { permissions } = await getUserPermissions(idToken, user.localId);
		isAdmin = hasAnyPermission(permissions, ['admin_panel', '*']);
	}

	// Staf backup (projects.gr_backup_karyawan_ids) — query terpisah, gagal → log keras, tetap lanjut tanpa backup.
	let backupIds: number[] = [];
	try {
		const q = new URLSearchParams({
			filter: JSON.stringify({ status: { _nin: ['closed', 'cancel', 'cancelled'] } }),
			fields: 'id,gr_backup_karyawan_ids', limit: '-1'
		});
		const r = await directusServerJson<{ data: Array<{ id: number; gr_backup_karyawan_ids: number[] | null }> }>(`/items/projects?${q.toString()}`);
		backupIds = (r?.data || []).filter((p) => Array.isArray(p.gr_backup_karyawan_ids) && p.gr_backup_karyawan_ids.includes(karyawan.id)).map((p) => p.id);
	} catch (e) {
		console.error('[sjVerifikasiAkses] gagal baca staf backup proyek:', e instanceof Error ? e.message : e);
	}
	return { karyawan, projectIds: [...new Set([...leaderIds, ...backupIds])], isAdmin };
}

export const aktorBolehProyek = (a: Pick<LacakActor, 'projectIds' | 'isAdmin'>, projectId: number | null) =>
	projectId != null && (a.isAdmin || a.projectIds.includes(projectId));

// ─── Aturan kelayakan (murni) ───────────────────────────────────────────────

export type SjUntukKelayakan = {
	project_id?: unknown; status?: string | null; draft_status?: string | null;
	print_count?: number | null; reprint_status?: string | null; date_created?: string | null;
	pengaju_verification?: any;
};

/** Status yang berarti barang sudah keluar gerbang / SJ selesai. */
export const STATUS_SUDAH_KELUAR = ['shipped', 'delivered', 'received', 'complete', 'closed'];

export const sudahDiverifikasi = (sj: SjUntukKelayakan) => !!(sj.pengaju_verification && sj.pengaju_verification.verified_at);

/**
 * §4.2: verifikasi (baru ATAU ubah hasil) diizinkan bila SJ proyek, tidak batal/ditolak, belum dicetak
 * (atau cetak ulang disetujui — K2: tidak ada verifikasi susulan setelah cetak), dan dibuat >= tanggal mulai.
 * `alasan` dikembalikan untuk pesan 409 yang manusiawi.
 */
export function evaluasiKelayakan(sj: SjUntukKelayakan, mulai: string): { boleh: boolean; alasan: string | null } {
	const pid = typeof sj.project_id === 'object' && sj.project_id ? (sj.project_id as any).id : sj.project_id;
	if (pid == null || pid === '') return { boleh: false, alasan: 'Ini bukan SJ proyek.' };
	if (sj.status === 'cancelled' || sj.status === 'canceled') return { boleh: false, alasan: 'SJ ini dibatalkan.' };
	if (sj.draft_status === 'ditolak') return { boleh: false, alasan: 'SJ ini ditolak approver.' };
	// RSM-09 opsi A: boleh SETELAH cetak, selama SJ belum lewat gerbang (dulu ditolak begitu print_count > 0).
	if (STATUS_SUDAH_KELUAR.includes(String(sj.status || ''))) {
		return { boleh: false, alasan: 'SJ sudah lewat gerbang — hasil cek tidak bisa diubah. Laporkan selisih lewat Barang Bermasalah / Lapor Komplain.' };
	}
	if (sj.date_created && mulai && String(sj.date_created).slice(0, 10) < mulai) {
		return { boleh: false, alasan: 'SJ ini dibuat sebelum fitur cek muat dimulai.' };
	}
	return { boleh: true, alasan: null };
}

/** Daftar "Perlu Verifikasi": layak DAN belum pernah diverifikasi. */
export const perluVerifikasi = (sj: SjUntukKelayakan, mulai: string) =>
	evaluasiKelayakan(sj, mulai).boleh && !sudahDiverifikasi(sj);

/**
 * Self-approval lock + fallback (Aturan #4): pembuat SJ tak tercatat, jadi bandingkan aktor dengan penanda tangan
 * "Disiapkan" (pracetak_gudang.by). Sama + masih ada aktor lain yang berhak → tolak; tidak ada lain → izinkan & catat.
 */
export function cekSelfVerify(
	aktorId: number, pracetak: { by?: unknown } | null | undefined, adaAktorLain: boolean
): { tolak: boolean; selfVerified: boolean } {
	const penyiap = pracetak?.by != null ? Number(pracetak.by) : null;
	if (penyiap == null || penyiap !== Number(aktorId)) return { tolak: false, selfVerified: false };
	return adaAktorLain ? { tolak: true, selfVerified: true } : { tolak: false, selfVerified: true };
}

// ─── Tanggal mulai (I/O, cache 5 menit) ─────────────────────────────────────

let cache: { at: number; v: string } | null = null;

/** Jendela hari verifikasi (app_settings logistik.verifikasi_muat_jendela_hari, default 3): SJ lebih tua tidak lagi "Perlu saya cek". */
export const JENDELA_HARI_DEFAULT = 3;

/** Murni: tanggal terbaru antara "mulai" konfigurasi dan (hari ini − jendela). jendela <= 0 = tanpa jendela. */
export function terapkanJendela(mulai: string, hariIni: string, jendelaHari: number): string {
	if (!(jendelaHari > 0)) return mulai;
	const d = new Date(`${hariIni}T00:00:00Z`);
	d.setUTCDate(d.getUTCDate() - jendelaHari);
	const batas = d.toISOString().slice(0, 10);
	return batas > mulai ? batas : mulai;
}

/** Murni: pilih tanggal mulai dari kandidat berurutan; tanggal MASA DEPAN diabaikan (enforce_from yang belum tiba tidak boleh mengosongkan daftar). */
export function pilihTanggalMulai(kandidat: unknown[], hariIni: string): string {
	for (const k of kandidat) {
		const t = k ? String(k).slice(0, 10) : '';
		if (/^\d{4}-\d{2}-\d{2}$/.test(t) && t <= hariIni) return t;
	}
	return TANGGAL_RILIS_VERIFIKASI;
}

/** §4.2 no. 5: gate_enforcement.enforce_from (G_SJ_VERIF_FISIK) → app_settings logistik.verifikasi_muat_mulai → tanggal rilis. */
export async function tanggalMulaiVerifikasi(): Promise<string> {
	if (cache && Date.now() - cache.at < 300_000) return cache.v;
	let v = TANGGAL_RILIS_VERIFIKASI;
	try {
		const hariIni = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
		const [ge, st, jw] = await Promise.all([
			directusServerJson<{ data: any[] }>(`/items/gate_enforcement?filter[gate_key][_eq]=G_SJ_VERIF_FISIK&filter[jenis_pengajuan][_eq]=SJ&fields=enforce_from&limit=1`),
			directusServerJson<{ data: any[] }>(`/items/app_settings?filter[module][_eq]=logistik&filter[setting_key][_eq]=verifikasi_muat_mulai&fields=setting_value&limit=1`),
			directusServerJson<{ data: any[] }>(`/items/app_settings?filter[module][_eq]=logistik&filter[setting_key][_eq]=verifikasi_muat_jendela_hari&fields=setting_value&limit=1`)
		]);
		const jendela = Number(jw?.data?.[0]?.setting_value);
		v = terapkanJendela(
			pilihTanggalMulai([ge?.data?.[0]?.enforce_from, st?.data?.[0]?.setting_value], hariIni),
			hariIni,
			Number.isFinite(jendela) ? jendela : JENDELA_HARI_DEFAULT
		);
	} catch (e) {
		console.error('[sjVerifikasiAkses] gagal baca tanggal mulai verifikasi, pakai tanggal rilis:', e instanceof Error ? e.message : e);
	}
	cache = { at: Date.now(), v };
	return v;
}

export function tolakBukanAktor(): never {
	throw error(403, 'SJ ini tidak berkaitan dengan Anda.');
}
