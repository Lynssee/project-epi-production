// Kosakata pilihan Project Charter (PRJ-15, K12). SATU kosakata untuk ERP & lapangan: VALUE = yang sudah dominan di
// data ERP (`project_charters`), LABEL = teks ramah. ⚠️ Sinkron dengan erp-epi `src/lib/services/projectCharterApi.js`
// (WAKTU_KERJA_OPTIONS, SHIFT_KERJA_OPTIONS, YA_TIDAK_OPTIONS, BOLEH_TIDAK_OPTIONS, JENIS_MANPOWER_OPTIONS,
// PERSIAPAN_PERMUKAAN_OPTIONS) — ubah keduanya bersamaan; charterOptions.test.ts memeriksa value-nya identik.

export interface CharterOption {
	value: string;
	label: string;
}

export const WAKTU_KERJA_OPTIONS: CharterOption[] = [
	{ value: 'SENIN-JUMAT', label: '5 hari (Senin–Jumat)' },
	{ value: 'SENIN-SABTU', label: '6 hari (Senin–Sabtu)' },
	{ value: 'SENIN-MINGGU', label: '7 hari (non-stop, termasuk Minggu)' }
];
export const SHIFT_KERJA_OPTIONS: CharterOption[] = [
	{ value: 'SIANG', label: 'Siang' },
	{ value: 'MALAM', label: 'Malam' },
	{ value: 'SIANG & MALAM', label: 'Siang & Malam' }
];
export const LEMBUR_OPTIONS: CharterOption[] = [
	{ value: 'tidak', label: 'Tidak ada lembur' },
	{ value: 'boleh', label: 'Ada / sesuai kebutuhan lapangan' }
];
export const YA_TIDAK_OPTIONS: CharterOption[] = [
	{ value: 'ADA', label: 'Ada' },
	{ value: 'TIDAK ADA', label: 'Tidak ada' }
];
export const JENIS_MANPOWER_OPTIONS: CharterOption[] = [
	{ value: 'HARIAN', label: 'Harian' },
	{ value: 'BORONGAN', label: 'Borongan' },
	{ value: 'KONTRAK', label: 'Kontrak' }
];
export const VERIFIKASI_KONTRAK_OPTIONS: CharterOption[] = [
	{ value: 'BELUM', label: 'Belum diverifikasi' },
	{ value: 'SUDAH', label: 'Sudah diverifikasi' }
];
export const PERSIAPAN_PERMUKAAN_OPTIONS: CharterOption[] = [
	{ value: 'SANDBLASTING', label: 'Sandblasting' },
	{ value: 'PAINTING', label: 'Painting' },
	{ value: 'HAND TOOL', label: 'Hand tool cleaning' },
	{ value: 'POWER TOOL', label: 'Power tool cleaning' },
	{ value: 'WETBLASTING', label: 'Wet blasting' }
];

/** Pembanding lembur tunggal untuk kedua form: 'boleh' | 'ada' | 'ya' (huruf besar/kecil bebas) = ada lembur. */
export function isLembur(v: unknown): boolean {
	return ['boleh', 'ada', 'ya'].includes(String(v ?? '').trim().toLowerCase());
}

/** Pemetaan kosakata lapangan lama → kosakata resmi (dipakai saat memuat charter lama & skrip normalisasi). */
const LEGACY_MAP: Record<string, Record<string, string>> = {
	waktu_kerja: {
		'5 hari kerja (senin - jumat)': 'SENIN-JUMAT',
		'6 hari kerja (senin - sabtu)': 'SENIN-SABTU',
		'7 hari kerja (non-stop)': 'SENIN-MINGGU'
	},
	shift_kerja: { 'non shift (normal day)': 'SIANG', '2 shift (pagi & malam)': 'SIANG & MALAM' },
	ijin_barang_masuk: {},
	alat_loading_unloading: {},
	jenis_manpower: { 'harian lepas': 'HARIAN', 'borongan lapangan': 'BORONGAN', 'karyawan tetap epi': 'KONTRAK' },
	verifikasi_kontrak: {}
};

/** Normalisasi nilai lembur: apa pun yang berarti "ada" → 'boleh', selainnya (termasuk 'TIDAK', 'TIDAK ADA') → 'tidak'. */
export function normalizeLembur(v: unknown): string {
	const s = String(v ?? '').trim();
	if (!s) return 'tidak';
	return isLembur(s) || s.toLowerCase() === 'ada (terjadwal)' || s.toLowerCase() === 'sesuai kebutuhan lapangan' ? 'boleh' : 'tidak';
}

/** Petakan nilai lama ke nilai resmi bila dikenali; selain itu kembalikan apa adanya (ditampilkan sebagai "(nilai lama)"). */
export function normalizeCharterValue(field: string, v: unknown): string {
	const s = String(v ?? '').trim();
	if (!s) return '';
	if (field === 'waktu_lembur') return normalizeLembur(s);
	return LEGACY_MAP[field]?.[s.toLowerCase()] ?? s;
}

/** Daftar opsi + nilai saat ini bila tidak ada di master → muncul sebagai "(nilai lama) …" terpilih, bukan kosong. */
export function optionsWithLegacy(options: CharterOption[], current: unknown): CharterOption[] {
	const cur = String(current ?? '').trim();
	if (!cur || options.some((o) => o.value === cur)) return options;
	return [{ value: cur, label: `(nilai lama) ${cur}` }, ...options];
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Validasi form Charter lapangan: tanggal, jam, dan jam lembur (wajib bila lembur). Mengembalikan daftar pesan; kosong = lolos. */
export function validateCharterForm(f: Record<string, any>): string[] {
	const errs: string[] = [];
	if (!f.tanggal_mulai_project || !f.selesai_project_target) errs.push('Tanggal Mulai dan Target Selesai Project wajib diisi.');
	else if (String(f.selesai_project_target) < String(f.tanggal_mulai_project)) errs.push('Target Selesai tidak boleh sebelum Tanggal Mulai.');

	const mulai = f.jam_kerja_mulai;
	const selesai = f.jam_kerja_selesai;
	if (!mulai || !selesai) errs.push('Jam Kerja Mulai dan Selesai wajib diisi.');
	else if (!HHMM.test(mulai) || !HHMM.test(selesai)) errs.push('Format jam kerja harus HH:MM (contoh 08:00).');

	if (isLembur(f.waktu_lembur)) {
		if (!f.jam_lembur_mulai || !f.jam_lembur_selesai) errs.push('Jam Lembur Mulai dan Selesai wajib diisi bila ada lembur.');
		else if (!HHMM.test(f.jam_lembur_mulai) || !HHMM.test(f.jam_lembur_selesai)) errs.push('Format jam lembur harus HH:MM (contoh 17:30).');
	}
	return errs;
}
