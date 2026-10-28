// Round-trip aman baris `reports.progress` saat laporan DIBUKA ULANG & DISIMPAN di form lapangan.
//
// Masalah (BAST-LP-09 §4): form lapangan membangun ulang tiap baris hanya dari field yang dikenalnya.
// Laporan buatan form ADMIN menyimpan `stages.pekerjaan` = VOLUME dan `progress_value` = PERSEN
// (erp-epi AdminLaporanHarianEntry.svelte). Saat dibuka & disimpan ulang dari lapangan:
//   1. `stages` (dan field lain yang tak dikenal) HILANG;
//   2. `progress_value` yang berisi persen terbaca sebagai volume → angka laporan rusak.
//
// Perbaikan: (a) muat — tampilkan VOLUME (stages.pekerjaan bila ada) di input, simpan sisanya di `_extra`;
// (b) simpan — kembalikan field asing; untuk baris ber-`stages` tulis ulang kedua nilai sesuai konvensi admin
// (stages.pekerjaan = volume, progress_value = volume/target×100, 1 desimal).
// Baris baru / baris lapangan murni (tanpa field asing) tidak berubah sama sekali.

/** Field yang dimiliki UI form lapangan (dibangun ulang dari state); selain ini dianggap "asing" dan dipertahankan. */
export const OWNED_ROW_KEYS = new Set([
	'subtask_id', 'activity', 'progress_value', 'unit', 'notes', 'category', 'target_volume', 'service_type',
	'is_custom', 'category_only', 'category_id', 'qc_measured',
	'existing_foto_bukti', 'foto_bukti',
	'executor_type', 'executor_vendor_name', 'external_party', 'readiness_status', 'readiness_checklist',
	'_extra'
]);

type Row = Record<string, any>;

function finiteNumber(v: unknown): number | null {
	if (v === null || v === undefined || v === '') return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

/** Volume yang ditampilkan di input form lapangan: `stages.pekerjaan` (baris admin) ?? `progress_value`. */
export function rowUiVolume(p: Row | null | undefined): number {
	const fromStage = finiteNumber(p?.stages?.pekerjaan);
	if (fromStage !== null) return fromStage;
	return finiteNumber(p?.progress_value) ?? 0;
}

/** Field asing (mis. `stages`, `subtask_name`, `jam_mulai`) yang harus ikut tersimpan ulang. */
export function rowExtra(p: Row | null | undefined): Row {
	const extra: Row = {};
	if (!p || typeof p !== 'object') return extra;
	for (const k of Object.keys(p)) if (!OWNED_ROW_KEYS.has(k)) extra[k] = p[k];
	return extra;
}

/**
 * Gabungkan baris bersih (dari state UI) dengan field asing yang dipertahankan.
 * @param clean baris yang dibangun form lapangan (progress_value = VOLUME dari input)
 * @param extra hasil rowExtra() saat laporan dimuat (undefined untuk baris baru)
 */
export function applyRowExtra(clean: Row, extra: Row | null | undefined): Row {
	if (!extra || Object.keys(extra).length === 0) return clean;
	const out: Row = { ...extra, ...clean }; // field milik UI selalu menang
	const stages = extra.stages;
	if (stages && typeof stages === 'object' && !Array.isArray(stages)) {
		const volume = finiteNumber(clean.progress_value) ?? 0;
		const target = finiteNumber(clean.target_volume) ?? 0;
		out.stages = { ...stages, pekerjaan: volume };
		// Konvensi admin: progress_value = PERSEN. Target 0 → persen tak terdefinisi, pertahankan angka yang ada.
		if (target > 0) out.progress_value = Number(((volume / target) * 100).toFixed(1));
	}
	return out;
}
