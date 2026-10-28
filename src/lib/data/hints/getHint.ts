// src/lib/data/hints/getHint.ts
//
// Akses terkontrol ke data hint. Dipakai halaman alih-alih membaca objek hint langsung,
// supaya salah-ketik kunci terdeteksi saat pengembangan (bukan diam-diam hilang di produksi).
//
// Catatan bundling: helper ini SENGAJA menerima objek hint sebagai argumen, bukan nama modul.
// Kalau ia menerima nama modul, ia harus mengimpor registry berisi semua modul, dan setiap
// halaman akan menarik data hint seluruh aplikasi. Dengan pola ini tiap halaman cukup:
//
//   import { laporanHints } from '$lib/data/hints/laporan';
//   const h = (k: string) => getHint(laporanHints, k, 'laporan-harian');
//
// sehingga hanya data modul yang bersangkutan yang ikut bundle. Ini penting di lapangan,
// tempat koneksi sering lemah.

/** Bentuk satu entri hint. Semua properti opsional — halaman memakai yang relevan saja. */
export interface HintEntry {
	sectionGuide?: { title: string; steps: string[] };
	fieldHint?: string;
	helpIcon?: string;
	columnHint?: string;
	type?: 'info' | 'warning' | 'success';
	explain?: string;
	flow?: string[];
	message?: string;
	actionLabel?: string;
	actionHref?: string;
	hints?: string[];
}

export type HintModule = Record<string, HintEntry>;

/**
 * Kunci yang pernah benar-benar diminta halaman. Diisi hanya saat DEV dan dipakai
 * `reportOrphanHints()` untuk menemukan kunci data yang tak pernah tampil di layar.
 */
export const usedHintKeys = new Set<string>();

const warned = new Set<string>();

const IS_DEV = import.meta.env?.DEV ?? false;

/**
 * Ambil satu entri hint.
 * @param hints Objek hint satu modul, mis. `laporanHints`.
 * @param key Kunci `<konteks>.<detail>`, mis. `'laporan.form.foto'`.
 * @param modul Nama modul, hanya untuk pesan peringatan & pelacakan kunci yatim.
 * @returns Entri hint, atau objek kosong bila kunci tak ada (fail-soft: komponen hint
 *   merender null bila propertinya kosong).
 */
export function getHint(hints: HintModule, key: string, modul = '?'): HintEntry {
	if (IS_DEV) {
		usedHintKeys.add(`${modul}:${key}`);
		if (!hints || !(key in hints)) {
			const tag = `${modul}:${key}`;
			if (!warned.has(tag)) {
				warned.add(tag);
				console.warn(
					`[hints] Kunci tidak ditemukan: "${key}" di modul "${modul}". ` +
						`Periksa ejaan atau tambahkan kunci itu di src/lib/data/hints/${modul}.ts`
				);
			}
		}
	}
	return hints?.[key] ?? {};
}
