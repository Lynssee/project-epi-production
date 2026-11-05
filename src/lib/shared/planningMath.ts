// @ts-nocheck
// SALINAN KONTRAK dari erp-epi/src/lib/finance/planningMaterialEngine.js (parseNumberID, paintLiters) (Rencana Gate Rasionalitas Packing List, Fase 4, 4 Nov 2026).
// JANGAN diedit di sini: ubah di erp-epi lalu salin ulang. Paritas isi dijaga tes kontrak lintas repo
// erp-epi/src/lib/server/gates/plCoverage.crossRepoContract.test.js (gagal bila kedua salinan menyimpang).
// '@ts-nocheck' disengaja: file ini JS murni yang identik dengan sisi admin; tipe tidak boleh membuatnya berbeda.
/** "1.250,5" / "861" / 861 → number; tidak valid → null. */
export function parseNumberID(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Liter cat untuk satu lapis. deadVolumeMicron ditambahkan ke DFT lapisan primer bila permukaan diblast. */
export function paintLiters({ luasM2, dftMicron, solidPct, lossPct, deadVolumeMicron = 0 }) {
  if (!(luasM2 > 0) || !(dftMicron > 0) || !(solidPct > 0)) return 0;
  const effectiveDft = dftMicron + (deadVolumeMicron > 0 ? deadVolumeMicron : 0);
  return (luasM2 * effectiveDft) / (10 * solidPct) * (1 + (lossPct || 0) / 100);
}
