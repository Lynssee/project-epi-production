// src/lib/data/hints/index.ts
//
// PERINGATAN BUNDLING: mengimpor dari barrel ini menarik data hint SEMUA modul.
// Halaman biasa harus mengimpor file modulnya langsung
// (`import { laporanHints } from '$lib/data/hints/laporan'`).
// Barrel ini disediakan untuk perkakas dev (validator kunci yatim).

import { laporanHints } from './laporan';
import { preventiveHints } from './preventive';
import { stockLapanganHints } from './stockLapangan';
import { essHints } from './ess';
import { procurementLapanganHints } from './procurementLapangan';
import { anggaranHints } from './anggaran';
import { usedHintKeys, type HintModule } from './getHint';

export { laporanHints, preventiveHints, stockLapanganHints, essHints, procurementLapanganHints, anggaranHints };
export { getHint, usedHintKeys } from './getHint';
export type { HintEntry, HintModule } from './getHint';

/**
 * Semua modul hint yang terdaftar. Tambahkan di sini saat menulis modul baru —
 * kalau tidak, `reportOrphanHints()` tidak akan pernah memeriksanya.
 *
 * Nama kunci di sini HARUS sama dengan argumen `modul` yang dipakai halaman saat
 * memanggil getHint(), karena pelacakan kunci yatim mencocokkan `${modul}:${key}`.
 */
// §7C (implementation_plan_panduan + video generator.md): kunci di sini
// diselaraskan dengan modulDokumentasi[].id di panduan.ts supaya "modul" yang
// sama punya SATU slug di seluruh sistem (panduan, tutorial_video, tours,
// hints) — sebelumnya 'laporan'/'preventive'/'stockLapangan' beda dari
// 'laporan-harian'/'preventive-maintenance'/'stock-lapangan' di panduan.ts.
// `procurementLapangan` SENGAJA tidak diubah — tidak ada modul "procurement"
// di panduan.ts project-epi sama sekali (gap cakupan konten, bukan slug beda).
export const hintRegistry: Record<string, HintModule> = {
	'laporan-harian': laporanHints,
	'preventive-maintenance': preventiveHints,
	'stock-lapangan': stockLapanganHints,
	ess: essHints,
	procurementLapangan: procurementLapanganHints,
	anggaran: anggaranHints
};

/**
 * Validator dev-time: laporkan kunci hint yang ada di data tapi tak pernah dipanggil
 * halaman mana pun (kunci yatim). Panggil dari konsol browser setelah menjelajahi
 * halaman modul: `import('$lib/data/hints').then(m => m.reportOrphanHints('preventive-maintenance'))`.
 *
 * @param modul Batasi ke satu modul; kosongkan untuk memeriksa semuanya.
 * @returns Daftar kunci yatim.
 */
export function reportOrphanHints(modul?: string): { modul: string; key: string }[] {
	const orphans: { modul: string; key: string }[] = [];
	const entries = modul ? [[modul, hintRegistry[modul]] as const] : Object.entries(hintRegistry);

	for (const [name, hints] of entries) {
		if (!hints) {
			console.warn(`[hints] Modul tidak dikenal: "${name}"`);
			continue;
		}
		for (const key of Object.keys(hints)) {
			if (!usedHintKeys.has(`${name}:${key}`)) {
				orphans.push({ modul: name, key });
			}
		}
	}

	if (orphans.length > 0) {
		console.warn(
			`[hints] ${orphans.length} kunci yatim (ada di data, tak dipanggil halaman mana pun):`,
			orphans.map((o) => `${o.modul}:${o.key}`)
		);
	} else {
		console.info('[hints] Tidak ada kunci yatim pada modul yang diperiksa.');
	}
	return orphans;
}
