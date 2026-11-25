// src/lib/server/ess/istirahat.ts
// Fase 1 backend Absensi Istirahat (Foto Wajib) — satu tempat untuk semua aturan istirahat,
// dipakai oleh endpoint break-out/break-in + cron auto-close (fase lain), supaya tidak duplikat.
// Lihat implementation_plan_...Absensi Istirahat...md §3.0.1c/§FASE1 untuk rancangan penuh.

import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';
import { hitungOverrunDariTotalMenit, type KonfigurasiDisiplinIstirahat } from '$lib/server/ess/istirahatOverrunEngine';

export interface IstirahatKategori {
	id: string;
	nama: string;
	hitung_kuota: boolean;
	kuota_menit_sendiri: number | null;
	foto_wajib: boolean | null;
	urutan: number;
	aktif: boolean;
}

export interface IstirahatConfig {
	aktif: boolean;
	konfig: KonfigurasiDisiplinIstirahat & {
		istirahat_absen_mandiri_aktif?: boolean;
		istirahat_foto_masuk_wajib?: boolean;
		istirahat_foto_keluar_wajib?: boolean;
		istirahat_geofence_wajib?: boolean;
		istirahat_liveness_wajib?: boolean;
		istirahat_min_durasi_menit?: number;
		istirahat_jendela_toleransi_menit?: number;
		istirahat_auto_close_menit?: number;
		istirahat_blokir_pulang?: boolean;
		istirahat_departments?: string[];
	} | null;
	kategoriAktif: IstirahatKategori[];
}

export interface AbsensiIstirahatLogRow {
	id: string;
	absensi_harian_id: string;
	karyawan_id: string;
	tanggal: string;
	kategori_id: string | null;
	jam_keluar: string | null;
	jam_masuk: string | null;
	foto_keluar: string | null;
	foto_masuk: string | null;
	lat_keluar: number | null;
	lng_keluar: number | null;
	lat_masuk: number | null;
	lng_masuk: number | null;
	jarak_masuk_m: number | null;
	masuk_valid: boolean | null;
	face_verify_masuk_id: string | null;
	durasi_menit: number | null;
	overrun_menit: number | null;
	tier: number | null;
	sumber: string | null;
	auto_close: boolean | null;
	[key: string]: any;
}

const LOG_FIELDS = [
	'id',
	'absensi_harian_id',
	'karyawan_id',
	'tanggal',
	'kategori_id',
	'jam_keluar',
	'jam_masuk',
	'foto_keluar',
	'foto_masuk',
	'lat_keluar',
	'lng_keluar',
	'lat_masuk',
	'lng_masuk',
	'jarak_masuk_m',
	'masuk_valid',
	'face_verify_masuk_id',
	'durasi_menit',
	'overrun_menit',
	'tier',
	'sumber',
	'auto_close'
].join(',');

function parseTimeToMinutes(str: string | null | undefined): number | null {
	if (!str || typeof str !== 'string' || str === '-') return null;
	const parts = str.split(':');
	if (parts.length < 2) return null;
	const h = Number(parts[0]);
	const m = Number(parts[1]);
	if (Number.isNaN(h) || Number.isNaN(m)) return null;
	return h * 60 + m;
}

const ISTIRAHAT_CONFIG_TTL_MS = 2 * 60 * 1000;
const JADWAL_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_JADWAL_CACHE = 500;

interface IstirahatConfigCacheEntry {
	at: number;
	tahun: number;
	config: IstirahatConfig;
	kategoriById: Map<string, IstirahatKategori>;
}

interface JadwalKerjaDetail {
	jam_masuk_normal: string | null;
	toleransi_telat_menit: number | null;
	jam_istirahat_mulai: string | null;
	jam_istirahat_selesai: string | null;
	jam_keluar_normal: string | null;
}

interface KaryawanJadwalMeta {
	jadwalId: string | null;
	polaKerja: string | null;
}

let configCache: IstirahatConfigCacheEntry | null = null;
let configInflight: Promise<IstirahatConfigCacheEntry> | null = null;

const karyawanJadwalCache = new Map<string, { at: number; meta: KaryawanJadwalMeta }>();
const karyawanJadwalInflight = new Map<string, Promise<KaryawanJadwalMeta>>();
const jadwalDetailCache = new Map<string, { at: number; detail: JadwalKerjaDetail }>();
const jadwalDetailInflight = new Map<string, Promise<JadwalKerjaDetail>>();

/** Untuk tes / invalidasi setelah admin mengubah konfigurasi istirahat atau jadwal kerja. */
export function clearIstirahatCache() {
	configCache = null;
	configInflight = null;
	karyawanJadwalCache.clear();
	karyawanJadwalInflight.clear();
	jadwalDetailCache.clear();
	jadwalDetailInflight.clear();
}

function pruneMapIfNeeded<K, V>(map: Map<K, V>, max: number) {
	if (map.size < max) return;
	const oldest = map.keys().next().value;
	if (oldest !== undefined) map.delete(oldest);
}

async function loadIstirahatConfigInternal(): Promise<IstirahatConfigCacheEntry> {
	const tahun = Number(todayJakarta().slice(0, 4));
	const now = Date.now();
	if (configCache && configCache.tahun === tahun && now - configCache.at < ISTIRAHAT_CONFIG_TTL_MS) {
		return configCache;
	}
	if (configInflight) return configInflight;

	const pending = (async (): Promise<IstirahatConfigCacheEntry> => {
		const konfigQuery = new URLSearchParams({ sort: '-tahun_berlaku', limit: '-1' });
		const konfigRes = await directusServerJson<{ data: any[] }>(
			`/items/konfigurasi_kebijakan_disiplin?${konfigQuery.toString()}`
		);
		const semuaKonfig = konfigRes?.data || [];
		const konfig =
			semuaKonfig.find((c) => Number(c.tahun_berlaku) === tahun) ||
			semuaKonfig.filter((c) => Number(c.tahun_berlaku) < tahun)[0] ||
			semuaKonfig[semuaKonfig.length - 1] ||
			null;

		const kategoriById = new Map<string, IstirahatKategori>();
		if (!konfig || konfig.status !== 'aktif' || !konfig.istirahat_absen_mandiri_aktif) {
			const entry: IstirahatConfigCacheEntry = {
				at: Date.now(),
				tahun,
				config: { aktif: false, konfig: konfig || null, kategoriAktif: [] },
				kategoriById
			};
			configCache = entry;
			return entry;
		}

		// Ambil seluruh master istirahat_kategori (tabel sangat kecil) agar bisa dipakai
		// baik untuk daftar kategoriAktif maupun lookup terpisah tanpa nested dot-relation.
		const kategoriQuery = new URLSearchParams({
			sort: 'urutan',
			fields: 'id,nama,hitung_kuota,kuota_menit_sendiri,foto_wajib,urutan,aktif',
			limit: '-1'
		});
		const kategoriRes = await directusServerJson<{ data: IstirahatKategori[] }>(
			`/items/istirahat_kategori?${kategoriQuery.toString()}`
		);
		const semuaKategori = kategoriRes?.data || [];
		for (const k of semuaKategori) {
			kategoriById.set(String(k.id), k);
		}
		const kategoriAktif = semuaKategori.filter((k) => k.aktif);

		const entry: IstirahatConfigCacheEntry = {
			at: Date.now(),
			tahun,
			config: { aktif: true, konfig, kategoriAktif },
			kategoriById
		};
		configCache = entry;
		return entry;
	})().finally(() => {
		if (configInflight === pending) configInflight = null;
	});

	configInflight = pending;
	return pending;
}

/** Konfigurasi tahun berjalan + kategori aktif (di-cache 2 menit + coalescing). */
export async function loadIstirahatConfig(): Promise<IstirahatConfig> {
	const entry = await loadIstirahatConfigInternal();
	return entry.config;
}

/** Isi cache jadwal/pola kerja karyawan dari hasil authenticateEss agar menghindari GET karyawan/{id} ulang. */
export function seedKaryawanJadwalMeta(
	karyawanId: number,
	meta: { jadwalId?: string | null; polaKerja?: string | null }
): void {
	if (meta.jadwalId === undefined && meta.polaKerja === undefined) return;
	const key = String(karyawanId);
	const prev = karyawanJadwalCache.get(key)?.meta;
	pruneMapIfNeeded(karyawanJadwalCache, MAX_JADWAL_CACHE);
	karyawanJadwalCache.set(key, {
		at: Date.now(),
		meta: {
			jadwalId: meta.jadwalId !== undefined ? (meta.jadwalId || null) : (prev?.jadwalId ?? null),
			polaKerja: meta.polaKerja !== undefined ? (meta.polaKerja || null) : (prev?.polaKerja ?? null)
		}
	});
}

async function getKaryawanJadwalMeta(karyawanId: number): Promise<KaryawanJadwalMeta> {
	const key = String(karyawanId);
	const now = Date.now();
	const cached = karyawanJadwalCache.get(key);
	if (cached && now - cached.at < JADWAL_CACHE_TTL_MS) return cached.meta;
	const running = karyawanJadwalInflight.get(key);
	if (running) return running;

	const pending = (async (): Promise<KaryawanJadwalMeta> => {
		const karyawanRes = await directusServerJson<{ data: { jadwal_kerja_id?: string | null; pola_kerja?: string | null } }>(
			`/items/karyawan/${karyawanId}?fields=jadwal_kerja_id,pola_kerja`
		);
		const meta: KaryawanJadwalMeta = {
			jadwalId: karyawanRes?.data?.jadwal_kerja_id || null,
			polaKerja: karyawanRes?.data?.pola_kerja || null
		};
		pruneMapIfNeeded(karyawanJadwalCache, MAX_JADWAL_CACHE);
		karyawanJadwalCache.set(key, { at: Date.now(), meta });
		return meta;
	})().finally(() => {
		if (karyawanJadwalInflight.get(key) === pending) karyawanJadwalInflight.delete(key);
	});

	karyawanJadwalInflight.set(key, pending);
	return pending;
}

async function getKaryawanJadwalId(karyawanId: number): Promise<string | null> {
	const meta = await getKaryawanJadwalMeta(karyawanId);
	return meta.jadwalId;
}

async function getJadwalKerjaDetail(jadwalId: string): Promise<JadwalKerjaDetail> {
	const key = String(jadwalId);
	const now = Date.now();
	const cached = jadwalDetailCache.get(key);
	if (cached && now - cached.at < JADWAL_CACHE_TTL_MS) return cached.detail;
	const running = jadwalDetailInflight.get(key);
	if (running) return running;

	const pending = (async (): Promise<JadwalKerjaDetail> => {
		const jadwalRes = await directusServerJson<{
			data: {
				jam_masuk_normal?: string | null;
				toleransi_telat_menit?: number | null;
				jam_istirahat_mulai?: string | null;
				jam_istirahat_selesai?: string | null;
				jam_keluar_normal?: string | null;
			};
		}>(
			`/items/jadwal_kerja/${jadwalId}?fields=jam_masuk_normal,toleransi_telat_menit,jam_istirahat_mulai,jam_istirahat_selesai,jam_keluar_normal`
		);
		const detail: JadwalKerjaDetail = {
			jam_masuk_normal: jadwalRes?.data?.jam_masuk_normal || null,
			toleransi_telat_menit: jadwalRes?.data?.toleransi_telat_menit ?? null,
			jam_istirahat_mulai: jadwalRes?.data?.jam_istirahat_mulai || null,
			jam_istirahat_selesai: jadwalRes?.data?.jam_istirahat_selesai || null,
			jam_keluar_normal: jadwalRes?.data?.jam_keluar_normal || null
		};
		pruneMapIfNeeded(jadwalDetailCache, MAX_JADWAL_CACHE);
		jadwalDetailCache.set(key, { at: Date.now(), detail });
		return detail;
	})().finally(() => {
		if (jadwalDetailInflight.get(key) === pending) jadwalDetailInflight.delete(key);
	});

	jadwalDetailInflight.set(key, pending);
	return pending;
}

/** Jadwal kerja + pola_kerja karyawan dari cache 5 menit bersama (dipakai disiplin-status). */
export async function getKaryawanJadwalDisiplin(karyawanId: number): Promise<{
	polaKerja: string | null;
	jadwal: { jam_masuk_normal?: string | null; toleransi_telat_menit?: number | null } | null;
}> {
	const meta = await getKaryawanJadwalMeta(karyawanId);
	if (!meta.jadwalId) return { polaKerja: meta.polaKerja, jadwal: null };
	const detail = await getJadwalKerjaDetail(meta.jadwalId);
	return {
		polaKerja: meta.polaKerja,
		jadwal: {
			jam_masuk_normal: detail.jam_masuk_normal,
			toleransi_telat_menit: detail.toleransi_telat_menit
		}
	};
}

/** Jendela istirahat shift karyawan (jam_istirahat_mulai/selesai dari jadwal_kerja, di-cache 5 menit). */
export async function getJendelaIstirahat(
	karyawanId: number,
	knownJadwalId?: string | null
): Promise<{ mulai: string | null; selesai: string | null }> {
	const jadwalId = knownJadwalId !== undefined ? knownJadwalId : await getKaryawanJadwalId(karyawanId);
	if (!jadwalId) return { mulai: null, selesai: null };
	const detail = await getJadwalKerjaDetail(jadwalId);
	return {
		mulai: detail.jam_istirahat_mulai,
		selesai: detail.jam_istirahat_selesai
	};
}

/** Jam pulang normal shift karyawan (format 'HH:mm', default '17:00', berbagi cache 5 menit dengan jadwal_kerja). */
export async function getJadwalPulangNormal(karyawanId: number, fallback = '17:00'): Promise<string> {
	try {
		const jadwalId = await getKaryawanJadwalId(karyawanId);
		if (!jadwalId) return fallback;
		const detail = await getJadwalKerjaDetail(jadwalId);
		if (detail.jam_keluar_normal) return String(detail.jam_keluar_normal).slice(0, 5);
		return fallback;
	} catch {
		return fallback;
	}
}

/** Nama kategori untuk pesan guard clock-out ("belum absen kembali dari istirahat (Sholat, ...)"). */
export async function getKategoriNama(kategoriId: string): Promise<string | null> {
	try {
		const entry = await loadIstirahatConfigInternal();
		const cached = entry.kategoriById.get(String(kategoriId));
		if (cached) return cached.nama;
	} catch {
		/* fallback ke fetch langsung */
	}
	try {
		const res = await directusServerJson<{ data: { nama: string } }>(`/items/istirahat_kategori/${kategoriId}?fields=nama`);
		return res?.data?.nama || null;
	} catch {
		return null;
	}
}

export interface JedaHariIniRow {
	id: string;
	kategori_id?: string | null;
	kategoriNama: string | null;
	jam_keluar: string | null;
	jam_masuk: string | null;
	durasi_menit: number | null;
	overrun_menit: number | null;
	tier: number | null;
	foto_masuk: string | null;
}

/** Seluruh baris mentah absensi_istirahat_log hari ini (flat fields tanpa nested relation). */
export async function listJedaHariIniRaw(
	absensiHarianId: string,
	opts?: { signal?: AbortSignal; timeoutMs?: number }
): Promise<AbsensiIstirahatLogRow[]> {
	const query = new URLSearchParams({
		'filter[absensi_harian_id][_eq]': absensiHarianId,
		fields: LOG_FIELDS,
		sort: 'tanggal_dibuat',
		limit: '-1'
	});
	const result = await directusServerJson<{ data: AbsensiIstirahatLogRow[] }>(
		`/items/absensi_istirahat_log?${query.toString()}`,
		opts ? { signal: opts.signal, timeoutMs: opts.timeoutMs } : undefined
	);
	return result?.data || [];
}

/** Seluruh jeda hari ini (untuk bottom-sheet detail di kartu beranda ESS Fase 3). */
export async function listJedaHariIni(
	absensiHarianId: string,
	kategoriAktif?: IstirahatKategori[],
	preloadedRows?: AbsensiIstirahatLogRow[]
): Promise<JedaHariIniRow[]> {
	const rows = preloadedRows ?? (await listJedaHariIniRaw(absensiHarianId));
	if (rows.length === 0) return [];

	const namaById = new Map<string, string>();
	if (kategoriAktif) {
		for (const k of kategoriAktif) namaById.set(String(k.id), k.nama);
	}
	const needCacheLookup = rows.some((r) => r.kategori_id && !namaById.has(String(r.kategori_id)));
	if (needCacheLookup) {
		try {
			const entry = await loadIstirahatConfigInternal();
			for (const [id, k] of entry.kategoriById) {
				if (!namaById.has(id)) namaById.set(id, k.nama);
			}
		} catch {
			/* biarkan null bila gagal */
		}
	}

	return rows.map((row) => ({
		id: row.id,
		kategori_id: row.kategori_id ?? null,
		kategoriNama: row.kategori_id ? namaById.get(String(row.kategori_id)) || null : null,
		jam_keluar: row.jam_keluar,
		jam_masuk: row.jam_masuk,
		durasi_menit: row.durasi_menit,
		overrun_menit: row.overrun_menit,
		tier: row.tier,
		foto_masuk: row.foto_masuk
	}));
}

/** Baris absensi_istirahat_log hari ini yang jam_masuk masih kosong (maksimal 1 boleh terbuka). */
export async function findJedaTerbuka(absensiHarianId: string): Promise<AbsensiIstirahatLogRow | null> {
	const query = new URLSearchParams({
		'filter[absensi_harian_id][_eq]': absensiHarianId,
		'filter[jam_masuk][_null]': 'true',
		fields: LOG_FIELDS,
		sort: '-tanggal_dibuat',
		limit: '1'
	});
	const result = await directusServerJson<{ data: AbsensiIstirahatLogRow[] }>(`/items/absensi_istirahat_log?${query.toString()}`);
	return result?.data?.[0] || null;
}

export interface ValidateBreakPunchParams {
	jenis: 'break-out' | 'break-in';
	absensiRecord: { jam_masuk?: string | null; jam_keluar?: string | null } | null;
	jedaTerbuka: AbsensiIstirahatLogRow | null;
	jendela: { mulai: string | null; selesai: string | null };
	config: IstirahatConfig['konfig'];
	nowHHmm: string;
	// Fase 2 (rencana v2 §3.2) — toleransi jendela per pola kerja (mis. istirahat_toleransi_bel_
	// mobile_menit). Bila diisi, MENGGANTIKAN istirahat_jendela_toleransi_menit generik untuk
	// panggilan ini saja — orang di jalan tidak bisa dituntut presisi yang sama dengan di kantor.
	toleransiJendelaMenitOverride?: number;
}

function isEmptyTime(v: string | null | undefined): boolean {
	return !v || v === '-';
}

/** Guard bersama break-out/break-in. Mengembalikan pesan error bila ditolak, null bila boleh lanjut. */
export function validateBreakPunch(params: ValidateBreakPunchParams): string | null {
	const { jenis, absensiRecord, jedaTerbuka, jendela, config, nowHHmm } = params;

	if (!absensiRecord || isEmptyTime(absensiRecord.jam_masuk)) {
		return 'Anda belum absen masuk hari ini.';
	}
	if (!isEmptyTime(absensiRecord.jam_keluar)) {
		return 'Anda sudah absen pulang hari ini — tidak bisa mencatat istirahat lagi.';
	}

	if (jenis === 'break-out') {
		if (jedaTerbuka) {
			return 'Anda masih dalam istirahat yang belum ditutup. Absen kembali dulu sebelum mulai istirahat baru.';
		}
	} else {
		if (!jedaTerbuka) {
			return 'Anda belum absen keluar istirahat. Tidak ada jeda yang sedang berjalan.';
		}
		const toleransi = Number(config?.istirahat_min_durasi_menit) || 5;
		const keluarMin = parseTimeToMinutes(jedaTerbuka.jam_keluar);
		let nowMin = parseTimeToMinutes(nowHHmm);
		if (keluarMin != null && nowMin != null) {
			if (nowMin <= keluarMin) nowMin += 1440;
			if (nowMin - keluarMin < toleransi) {
				return `Durasi istirahat terlalu singkat (minimal ${toleransi} menit). Pastikan Anda tidak salah pencet.`;
			}
		}
	}

	// Jendela shift ± toleransi — hanya dicek untuk break-out (mulai istirahat), tidak memblokir
	// break-in (kembali) karena karyawan HARUS bisa menutup jeda kapan pun terlepas dari jendela.
	if (jenis === 'break-out' && jendela.mulai && jendela.selesai) {
		const toleransiJendela = params.toleransiJendelaMenitOverride ?? (Number(config?.istirahat_jendela_toleransi_menit) || 30);
		const mulaiMin = parseTimeToMinutes(jendela.mulai);
		const selesaiMin = parseTimeToMinutes(jendela.selesai);
		const nowMin = parseTimeToMinutes(nowHHmm);
		if (mulaiMin != null && selesaiMin != null && nowMin != null) {
			const batasAwal = mulaiMin - toleransiJendela;
			const batasAkhir = selesaiMin + toleransiJendela;
			if (nowMin < batasAwal || nowMin > batasAkhir) {
				return `Di luar jendela istirahat shift Anda (${jendela.mulai}-${jendela.selesai}, toleransi ${toleransiJendela} menit). Hubungi HRD bila ini keliru.`;
			}
		}
	}

	return null;
}

export interface RollupIstirahatResult {
	record: Record<string, any> | null;
	overrunMenit: number;
	tier: number;
}

/**
 * Hitung ulang total menit, overrun, tier, jumlah jeda dari SELURUH baris absensi_istirahat_log
 * hari itu, lalu PATCH rollup ke absensi_harian. Dipanggil setiap kali sebuah jeda ditutup
 * (break-in ESS, cron auto-close, atau koreksi manual HRD).
 */
export async function rollupIstirahat(absensiHarianId: string): Promise<RollupIstirahatResult> {
	const [rows, configEntry] = await Promise.all([
		listJedaHariIniRaw(absensiHarianId),
		loadIstirahatConfigInternal()
	]);
	const konfig = configEntry.config.konfig || {};

	// Pisahkan fetch relasi istirahat_kategori bila belum ada di cache (mis. fitur nonaktif saat koreksi).
	let kategoriById = configEntry.kategoriById;
	if (kategoriById.size === 0 && rows.some((r) => r.kategori_id)) {
		const katRes = await directusServerJson<{ data: Array<{ id: string; hitung_kuota: boolean }> }>(
			'/items/istirahat_kategori?fields=id,hitung_kuota&limit=-1'
		).catch(() => null);
		kategoriById = new Map();
		for (const k of katRes?.data || []) {
			kategoriById.set(String(k.id), k as IstirahatKategori);
		}
	}

	const closed = rows.filter((r) => !isEmptyTime(r.jam_keluar) && !isEmptyTime(r.jam_masuk));

	let totalMenitHitungKuota = 0;
	let earliestKeluar: string | null = null;
	let latestMasuk: string | null = null;
	let latestFotoKeluar: string | null = null;
	let latestFotoMasuk: string | null = null;
	let latestLat: { keluar: number | null; lng: number | null; masukLat: number | null; masukLng: number | null } = {
		keluar: null,
		lng: null,
		masukLat: null,
		masukLng: null
	};
	let latestJarak: number | null = null;
	let latestValid: boolean | null = null;
	let latestFaceVerifyId: string | null = null;
	let latestSumber: string | null = null;
	let anyAutoClose = false;

	for (const row of closed) {
		const kat = row.kategori_id ? kategoriById.get(String(row.kategori_id)) : undefined;
		const hitungKuota = kat?.hitung_kuota !== false;
		if (hitungKuota) {
			const keluarMin = parseTimeToMinutes(row.jam_keluar);
			let masukMin = parseTimeToMinutes(row.jam_masuk);
			if (keluarMin != null && masukMin != null) {
				if (masukMin <= keluarMin) masukMin += 1440;
				totalMenitHitungKuota += masukMin - keluarMin;
			}
			if (earliestKeluar == null || (row.jam_keluar && row.jam_keluar < earliestKeluar)) {
				earliestKeluar = row.jam_keluar;
			}
		}
		if (latestMasuk == null || (row.jam_masuk && row.jam_masuk >= latestMasuk)) {
			latestMasuk = row.jam_masuk;
			latestFotoKeluar = row.foto_keluar;
			latestFotoMasuk = row.foto_masuk;
			latestLat = { keluar: row.lat_keluar, lng: row.lng_keluar, masukLat: row.lat_masuk, masukLng: row.lng_masuk };
			latestJarak = row.jarak_masuk_m;
			latestValid = row.masuk_valid;
			latestFaceVerifyId = row.face_verify_masuk_id;
			latestSumber = row.sumber;
		}
		if (row.auto_close) anyAutoClose = true;
	}

	const overrun = hitungOverrunDariTotalMenit(totalMenitHitungKuota, konfig);

	const payload = {
		jam_istirahat_keluar: earliestKeluar || '-',
		jam_istirahat_masuk: latestMasuk || '-',
		foto_istirahat_keluar: latestFotoKeluar,
		foto_istirahat_masuk: latestFotoMasuk,
		lat_istirahat_keluar: latestLat.keluar,
		lng_istirahat_keluar: latestLat.lng,
		lat_istirahat_masuk: latestLat.masukLat,
		lng_istirahat_masuk: latestLat.masukLng,
		jarak_istirahat_masuk_m: latestJarak,
		istirahat_masuk_valid: latestValid,
		face_verify_istirahat_masuk_id: latestFaceVerifyId,
		istirahat_overrun_menit: overrun.menitOverrun,
		istirahat_tier: overrun.tier,
		istirahat_sumber: latestSumber,
		istirahat_auto_close: anyAutoClose,
		istirahat_jumlah_jeda: rows.length
	};

	const patched = await directusServerJson<{ data?: Record<string, any> }>(`/items/absensi_harian/${absensiHarianId}`, {
		method: 'PATCH',
		body: JSON.stringify(payload)
	});

	return {
		record: patched?.data ?? null,
		overrunMenit: overrun.menitOverrun,
		tier: overrun.tier
	};
}
