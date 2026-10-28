// src/lib/server/ess/dataKelengkapan.ts
// Countdown Kelengkapan Data Karyawan Baru (26 Agu 2026) — cek onboarding_case (koleksi yang
// sama dipakai HRD di erp-epi-1, satu sumber kebenaran) + hitung kelengkapan data diri karyawan.
// Field/dokumen wajib SENGAJA diduplikasi kecil dari dataKelengkapanEngine.js erp-epi-1 (bukan
// diimpor lintas repo) — kedua app deploy terpisah, hanya berbagi skema Directus.
//
// Digabung 23 Sep 2026 (keputusan user) dengan gerbang dokumen wajib SEMUA karyawan yang
// sebelumnya cuma ada di dashboard admin (erp-epi-1: src/lib/server/gates/essDokumenGate.js,
// app_settings modul 'hrd' key 'ess_dokumen_gate' — SATU sumber deadline dipakai bersama,
// jangan duplikasi nilainya di sini). Sekarang satu fungsi ini melayani DUA konteks:
//   - Karyawan baru dengan onboarding_case aktif -> deadline tetap dari lifecycle onboarding
//     (7 hari sejak tanggal_mulai), tetap memicu draf teguran KPI via cron erp-epi-1 seperti
//     sebelumnya. TIDAK diubah.
//   - Karyawan lain (tanpa onboarding_case aktif) -> deadline dari app_settings global, sama
//     seperti dashboard admin. TIDAK memicu draf teguran (itu tetap murni mekanisme onboarding).
// `mode` menentukan apakah layout ESS mengunci akses ('block') atau cuma memperingatkan ('warn').

import { directusServerJson } from '$lib/server/directus';

const DEFAULT_DEADLINE = '2026-10-08'; // dimundurkan 7 hari (1 Okt 2026) krn KK jadi wajib — sumber utama tetap app_settings

async function getKonfigGateUniversal(): Promise<{ enabled: boolean; deadline: string }> {
	try {
		const res = await directusServerJson<{ data: any[] }>(
			`/items/app_settings?${new URLSearchParams({
				filter: JSON.stringify({ module: { _eq: 'hrd' }, setting_key: { _eq: 'ess_dokumen_gate' } }),
				limit: '1'
			}).toString()}`
		);
		const row = res?.data?.[0];
		let value: any = {};
		try {
			value = row?.setting_value ? JSON.parse(row.setting_value) : {};
		} catch {
			value = {};
		}
		return { enabled: value.enabled !== false, deadline: value.deadline || DEFAULT_DEADLINE };
	} catch {
		return { enabled: true, deadline: DEFAULT_DEADLINE };
	}
}

// Revisi: dokumen wajib = KTP (scan + alamat KTP), KK, Pas Foto.
// NPWP (nomor dan dokumen scan), BPJS, Ijazah, Kontak Darurat sepenuhnya OPSIONAL:
// ditampilkan sebagai saran dan tidak pernah mengunci akses ESS.
export const FIELD_DASAR_WAJIB = [{ key: 'alamat_ktp', label: 'Alamat KTP' }] as const;
export const DOKUMEN_WAJIB = ['ktp', 'kk', 'pas_foto'] as const;

const FIELD_OPSIONAL = [
	{ key: 'no_npwp', label: 'Nomor NPWP' },
	{ key: 'kontak_darurat', label: 'Nama Kontak Darurat' },
	{ key: 'no_telp_darurat', label: 'No. Telepon Kontak Darurat' }
] as const;
const DOKUMEN_OPSIONAL = ['npwp', 'bpjs', 'ijazah'] as const;

const LABEL_DOKUMEN: Record<string, string> = {
	ktp: 'Scan/Foto KTP',
	kk: 'Scan/Foto KK',
	npwp: 'Scan/Foto NPWP',
	pas_foto: 'Pas Foto',
	bpjs: 'Kartu BPJS',
	ijazah: 'Ijazah'
};

export interface KelengkapanMissing {
	tipe: 'field' | 'dokumen';
	key: string;
	label: string;
}

export interface DataLengkapStatus {
	berlaku: boolean;
	lengkap: boolean;
	missing: KelengkapanMissing[];
	/** Item opsional yang belum diisi — hanya saran, tidak memengaruhi lengkap/persen/mode. */
	opsional: KelengkapanMissing[];
	persen: number;
	deadline: string | null;
	sudahLewat: boolean;
	/** 'ok' = lengkap. 'warn' = belum lengkap, masih boleh akses ESS. 'block' = lewat
	 *  tenggat, ESS dikunci kecuali halaman yang mengecualikan diri (lihat ESS_GATE_ESCAPE_PATHS
	 *  di (app)/ess/+layout.svelte — absen/kehadiran harian TIDAK pernah dikunci). */
	mode: 'ok' | 'warn' | 'block';
	/** 'onboarding' = karyawan baru, deadline dari lifecycle onboarding (7 hari, bisa berujung
	 *  draf teguran KPI). 'universal' = karyawan lain, deadline dari app_settings global (sama
	 *  seperti dashboard admin). */
	sumber: 'onboarding' | 'universal';
}

const isi = (v: unknown) => !!String(v ?? '').trim();

function hitungKelengkapan(
	karyawan: Record<string, any>,
	dokumenList: any[]
): { lengkap: boolean; missing: KelengkapanMissing[]; opsional: KelengkapanMissing[]; persen: number } {
	const missing: KelengkapanMissing[] = [];
	const opsional: KelengkapanMissing[] = [];
	const dokAktifSet = new Set((dokumenList || []).filter((d) => d.status === 'active').map((d) => d.tipe_dokumen));

	for (const f of FIELD_DASAR_WAJIB) {
		if (!isi(karyawan?.[f.key])) missing.push({ tipe: 'field', key: f.key, label: f.label });
	}
	const dokumenWajib: readonly string[] = DOKUMEN_WAJIB;
	for (const tipe of dokumenWajib) {
		if (!dokAktifSet.has(tipe)) missing.push({ tipe: 'dokumen', key: tipe, label: LABEL_DOKUMEN[tipe] || tipe });
	}

	for (const f of FIELD_OPSIONAL) {
		if (!isi(karyawan?.[f.key])) opsional.push({ tipe: 'field', key: f.key, label: f.label });
	}
	for (const tipe of DOKUMEN_OPSIONAL) {
		if (!dokAktifSet.has(tipe)) opsional.push({ tipe: 'dokumen', key: tipe, label: LABEL_DOKUMEN[tipe] || tipe });
	}

	const totalWajib = FIELD_DASAR_WAJIB.length + dokumenWajib.length;
	const persen = Math.round(((totalWajib - missing.length) / totalWajib) * 100);
	return { lengkap: missing.length === 0, missing, opsional, persen };
}

const KARYAWAN_FIELDS = [...FIELD_DASAR_WAJIB, ...FIELD_OPSIONAL].map((f) => f.key).join(',');

/** Status kelengkapan data untuk karyawan yang sedang berjalan masa onboarding "baru". */
export async function getDataLengkapStatus(karyawanId: number): Promise<DataLengkapStatus> {
	// NB (26 Agu 2026): `jenis_onboarding` yang ditulis createCaseFromTemplate() di erp-epi-1
	// TIDAK ADA di skema Directus (diam-diam dibuang saat create) — proxy yang benar-benar
	// tersimpan untuk membedakan onboarding karyawan baru vs mutasi adalah `template_used`.
	const caseFilter = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		'filter[template_used][_neq]': 'Onboarding Mutasi Karyawan',
		'filter[status][_in]': 'draft,in_progress',
		fields: 'id,status,data_lengkap_deadline',
		sort: '-id',
		limit: '1'
	});
	const caseRes = await directusServerJson<{ data: any[] }>(`/items/onboarding_case?${caseFilter.toString()}`);
	const kasus = caseRes?.data?.[0];

	// Onboarding aktif -> deadline lifecycle onboarding (perilaku lama, tak berubah: cron
	// erp-epi-1 tetap yang membuat draf teguran, bukan gate ini). Tanpa onboarding aktif ->
	// gerbang universal (deadline app_settings global, sama seperti dashboard admin).
	const sumber: 'onboarding' | 'universal' = kasus ? 'onboarding' : 'universal';
	let deadline: string | null;
	if (kasus) {
		deadline = kasus.data_lengkap_deadline || null;
	} else {
		const konfigUniversal = await getKonfigGateUniversal();
		if (!konfigUniversal.enabled) {
			return { berlaku: false, lengkap: true, missing: [], opsional: [], persen: 100, deadline: null, sudahLewat: false, mode: 'ok', sumber };
		}
		deadline = konfigUniversal.deadline;
	}

	const [karyawanRes, dokRes] = await Promise.all([
		directusServerJson<{ data: any }>(`/items/karyawan/${karyawanId}?fields=${KARYAWAN_FIELDS}`),
		directusServerJson<{ data: any[] }>(
			`/items/karyawan_dokumen?${new URLSearchParams({ 'filter[karyawan_id][_eq]': String(karyawanId), 'filter[status][_eq]': 'active', fields: 'tipe_dokumen,status', limit: '-1' }).toString()}`
		)
	]);

	const { lengkap, missing, opsional, persen } = hitungKelengkapan(karyawanRes?.data || {}, dokRes?.data || []);
	const today = new Date().toISOString().slice(0, 10);
	const sudahLewat = Boolean(deadline && deadline < today);
	// Aturan #3 (anti-lockdown retroaktif): kasus onboarding sudah berjalan sejak 26 Agu 2026
	// TANPA pernah mengunci ESS (konsekuensinya cuma banner + cron draf teguran KPI) — sebagian
	// besar kasus yang sudah lewat tenggat SEKARANG pasti ada, dan memaksanya jadi 'block'
	// mendadak berarti mengunci retroaktif. Jadi 'block' HANYA berlaku untuk sumber 'universal'
	// (deadline 30 Sep 2026, masih ada masa tenggang ke depan sejak keputusan ini 23 Sep 2026).
	// Sumber 'onboarding' tetap 'warn' selamanya di sini — konsekuensinya tetap murni cron lama.
	const mode: 'ok' | 'warn' | 'block' = lengkap ? 'ok' : sumber === 'universal' && sudahLewat ? 'block' : 'warn';

	return { berlaku: true, lengkap, missing, opsional, persen, deadline, sudahLewat, mode, sumber };
}
