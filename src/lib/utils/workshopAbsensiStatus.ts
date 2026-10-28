// src/lib/utils/workshopAbsensiStatus.ts
// SALINAN (subset) dari erp-epi `src/lib/config/absensiStatus.js` — UBAH DI KEDUA TEMPAT. Hanya normLaporanStatus & hariNilai (dipakai laporan harian).
// WSK-28 §4e — SATU sumber kebenaran untuk status kehadiran manpower workshop (murni, tanpa import).
// Laporan harian memakai: hadir / setengah_hari / izin(ijin) / sakit / absen. HR (manpower_absensi) memakai: hadir / setengah_hari / izin / sakit / alpha.
// Dipakai: rekap upah, utilisasi, sinkron ke HR, (WSK-09 monitoring & WSK-13 HP boleh ikut mengimpor).
// Menambah status baru = SATU tempat ini.

export const LAPORAN_STATUS: Record<string, { label: string; hari: number; hr: string }> = {
  hadir: { label: 'Hadir', hari: 1, hr: 'hadir' },
  setengah_hari: { label: '½ Hari', hari: 0.5, hr: 'setengah_hari' },
  izin: { label: 'Izin', hari: 0, hr: 'izin' },
  sakit: { label: 'Sakit', hari: 0, hr: 'sakit' },
  absen: { label: 'Alpha', hari: 0, hr: 'alpha' }
};

/** Sinonim penulisan lama/liar → kunci baku laporan. */
const ALIAS: Record<string, string> = { ijin: 'izin', alpha: 'absen', hadir: 'hadir', 'setengah hari': 'setengah_hari', setengahhari: 'setengah_hari' };

/** Kunci baku laporan, atau null bila tidak dikenal (JANGAN menebak → pemanggil memutuskan). */
export function normLaporanStatus(s: unknown): string | null {
  const k = String(s ?? '').trim().toLowerCase();
  if (!k) return null;
  if (LAPORAN_STATUS[k]) return k;
  return ALIAS[k] && LAPORAN_STATUS[ALIAS[k]] ? ALIAS[k] : null;
}

/** Nilai hari kerja yang dibayar: hadir 1, setengah_hari 0,5, lainnya 0 (juga untuk status tak dikenal). */
export function hariNilai(status: unknown): number {
  const k = normLaporanStatus(status);
  return k ? LAPORAN_STATUS[k].hari : 0;
}
