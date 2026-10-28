// src/lib/server/ess/istirahatOverrunEngine.ts
// Port 1:1 dari erp-epi-1/src/lib/services/istirahatOverrunEngine.js (fungsi murni, tanpa I/O)
// supaya angka overrun identik di kedua dashboard. Jangan tulis ulang logikanya — termasuk
// penanganan lintas tengah malam (H-14 fix) — kalau rumus di erp-epi-1 berubah, samakan di sini.
//
// Tambahan Fase 1 Absensi Istirahat (Foto Wajib, §0.1): rollup multi-jeda TIDAK BOLEH menghitung
// overrun dari selisih jam_istirahat_keluar/jam_istirahat_masuk (itu bisa salah kalau ada >1 jeda
// terpisah) — overrun harus dihitung dari TOTAL menit seluruh jeda hitung_kuota hari itu, karena
// itu hitungOverrunDariTotalMenit() di bawah dipakai rollupIstirahat(), bukan hitungOverrunIstirahat().

export interface KonfigurasiDisiplinIstirahat {
	istirahat_makan_siang_menit?: number | string | null;
	istirahat_telat_teguran_lisan_menit?: number | string | null;
	istirahat_telat_teguran_tertulis_menit?: number | string | null;
	[key: string]: any;
}

export interface OverrunResult {
	tercatat: boolean;
	menitIstirahat: number | null;
	menitOverrun: number;
	tier: 0 | 1 | 2 | 3;
	tierLabel: string | null;
}

function parseTimeToMinutes(str: string | null | undefined): number | null {
	if (!str || typeof str !== 'string' || str === '-') return null;
	const parts = str.split(':');
	if (parts.length < 2) return null;
	const h = Number(parts[0]);
	const m = Number(parts[1]);
	if (Number.isNaN(h) || Number.isNaN(m)) return null;
	return h * 60 + m;
}

function tierFromOverrun(menitOverrun: number, konfigDisiplin: KonfigurasiDisiplinIstirahat): { tier: 0 | 1 | 2 | 3; tierLabel: string | null } {
	const ambangLisan = Number(konfigDisiplin?.istirahat_telat_teguran_lisan_menit) || 10;
	const ambangTertulis = Number(konfigDisiplin?.istirahat_telat_teguran_tertulis_menit) || 30;

	if (menitOverrun > ambangTertulis) return { tier: 3, tierLabel: 'SP1' };
	if (menitOverrun > ambangLisan) return { tier: 2, tierLabel: 'Teguran Tertulis' };
	if (menitOverrun >= 1) return { tier: 1, tierLabel: 'Teguran Lisan' };
	return { tier: 0, tierLabel: null };
}

/**
 * Hitung overrun istirahat 1 hari dari jam_istirahat_keluar/jam_istirahat_masuk (2 kolom rollup)
 * vs durasi istirahat yang diizinkan. Dipakai untuk parity check terhadap sisi admin — BUKAN
 * dipakai rollupIstirahat() untuk menulis snapshot (lihat hitungOverrunDariTotalMenit di bawah).
 */
export function hitungOverrunIstirahat(
	record: { jam_istirahat_keluar?: string | null; jam_istirahat_masuk?: string | null },
	konfigDisiplin: KonfigurasiDisiplinIstirahat
): OverrunResult {
	const keluar = parseTimeToMinutes(record?.jam_istirahat_keluar);
	let masuk = parseTimeToMinutes(record?.jam_istirahat_masuk);
	if (keluar == null || masuk == null) {
		return { tercatat: false, menitIstirahat: null, menitOverrun: 0, tier: 0, tierLabel: null };
	}
	if (masuk <= keluar) masuk += 1440;

	const durasiIzin = Number(konfigDisiplin?.istirahat_makan_siang_menit) || 60;
	const menitIstirahat = masuk - keluar;
	const menitOverrun = Math.max(0, menitIstirahat - durasiIzin);
	const { tier, tierLabel } = tierFromOverrun(menitOverrun, konfigDisiplin);

	return { tercatat: true, menitIstirahat, menitOverrun, tier, tierLabel };
}

/**
 * Hitung overrun dari TOTAL menit jeda berkategori hitung_kuota=true hari itu (jumlah durasi
 * seluruh jeda, bukan selisih jam pertama-ke-terakhir). Ini yang dipakai rollupIstirahat().
 */
export function hitungOverrunDariTotalMenit(totalMenitHitungKuota: number, konfigDisiplin: KonfigurasiDisiplinIstirahat): OverrunResult {
	const durasiIzin = Number(konfigDisiplin?.istirahat_makan_siang_menit) || 60;
	const menitOverrun = Math.max(0, totalMenitHitungKuota - durasiIzin);
	const { tier, tierLabel } = tierFromOverrun(menitOverrun, konfigDisiplin);
	return { tercatat: totalMenitHitungKuota > 0, menitIstirahat: totalMenitHitungKuota, menitOverrun, tier, tierLabel };
}
