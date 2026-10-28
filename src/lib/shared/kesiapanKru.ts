// src/lib/shared/kesiapanKru.ts
// Aturan check-in kesiapan kru, dipakai klien (form) dan server (validasi) agar konsisten.

export type Kondisi = 'fit' | 'kurang' | 'tidak';
export type Tindakan = 'lanjut' | 'ringan' | 'istirahat';

export interface CheckinInput {
	manpower_id: number;
	kondisi_fisik: Kondisi;
	kondisi_mental: Kondisi;
	tidur_cukup?: boolean;
	tindakan?: Tindakan;
	catatan?: string;
}

const KONDISI: Kondisi[] = ['fit', 'kurang', 'tidak'];
const TINDAKAN: Tindakan[] = ['lanjut', 'ringan', 'istirahat'];

/** Saran tindakan dari kondisi: ada 'tidak' → istirahat; ada 'kurang' / kurang tidur → tugas ringan; selain itu lanjut. */
export function tindakanDisarankan(i: Pick<CheckinInput, 'kondisi_fisik' | 'kondisi_mental' | 'tidur_cukup'>): Tindakan {
	if (i.kondisi_fisik === 'tidak' || i.kondisi_mental === 'tidak') return 'istirahat';
	if (i.kondisi_fisik === 'kurang' || i.kondisi_mental === 'kurang' || i.tidur_cukup === false) return 'ringan';
	return 'lanjut';
}

/** Pesan error atau null. Kru yang tidak fit/tidak fokus tidak boleh ditetapkan "Lanjut kerja". */
export function validasiCheckin(i: Partial<CheckinInput>): string | null {
	if (!i.kondisi_fisik || !KONDISI.includes(i.kondisi_fisik)) return 'Kondisi fisik tidak valid.';
	if (!i.kondisi_mental || !KONDISI.includes(i.kondisi_mental)) return 'Kondisi mental tidak valid.';
	if (i.tindakan && !TINDAKAN.includes(i.tindakan)) return 'Tindakan tidak valid.';
	const tindakan = i.tindakan || tindakanDisarankan(i as CheckinInput);
	if (tindakan === 'lanjut' && (i.kondisi_fisik === 'tidak' || i.kondisi_mental === 'tidak')) {
		return 'Kru yang tidak fit/tidak fokus tidak boleh ditetapkan "Lanjut kerja".';
	}
	if (String(i.catatan ?? '').length > 300) return 'Catatan maksimal 300 karakter.';
	return null;
}
