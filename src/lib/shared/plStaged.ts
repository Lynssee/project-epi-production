// @ts-nocheck
// SALINAN KONTRAK dari erp-epi/src/lib/utils/plStaged.js (Rencana Keyakinan Permintaan PL, sinkron 12 Nov 2026).
// JANGAN diedit di sini: ubah di erp-epi lalu salin ulang. Paritas isi dijaga tes kontrak lintas repo
// erp-epi/src/lib/server/gates/plCoverage.crossRepoContract.test.js (gagal bila kedua salinan menyimpang).
// '@ts-nocheck' disengaja: file ini JS murni yang identik dengan sisi admin; tipe tidak boleh membuatnya berbeda.
// src/lib/utils/plStaged.js
// Modul MURNI (tanpa Directus / DOM). Rencana KIRIM BERTAHAP untuk item yang melebihi batas run-rate (G_PKL_TIMELINE_RUNRATE):
// alih-alih hanya "turunkan qty", sistem mengusulkan jadwal — tahap 1 sebesar sisa batas window pertama (batas − stok site), tahap berikutnya
// sebesar kebutuhan satu window penuh (kebutuhan harian × hari buffer) setiap `hari buffer` hari kerja. Mengikuti baris evaluateRunRate:
// { status:'over', qty, unit, suggestedQty (window pertama), windowQty (window penuh) }. Data tak cukup (bukan 'over', saran kosong) ⇒ null —
// TIDAK ditebak. Satuan hasil = satuan baris (Pail utuh bila satuan kemasan). Null-safe.

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const DAY_MS = 86400000;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const toUtc = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? '')); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };

export const MAX_STAGES = 12;

/**
 * @param {{ status?:string, qty?:number, unit?:string, suggestedQty?:number, windowQty?:number }} row baris evaluateRunRate
 * @param {{ bufferDays?:number, neededDate?:string|null, workdaysPerWeek?:number, today?:string|null }} [opts]
 * @returns {null|{ unit:string, windowDays:number, calendarDaysPerStage:number, total:number, stages:Array<{no:number, dayOffset:number, tanggal:string|null, qty:number}>, truncated:boolean }}
 */
export function planStagedDelivery(row, opts = {}) {
  if (!row || row.status !== 'over') return null;
  const total = num(row.qty);
  const first = num(row.suggestedQty);
  const win = num(row.windowQty);
  const bufferDays = Math.max(1, Math.round(num(opts.bufferDays)) || 0);
  if (!(total > 0) || !(win > 0) || !opts.bufferDays) return null;

  const wpw = Math.min(7, Math.max(1, num(opts.workdaysPerWeek) || 6));
  const calDays = Math.max(1, Math.ceil((bufferDays * 7) / wpw)); // hari kerja → hari kalender
  const start = toUtc(opts.neededDate) ?? toUtc(opts.today);

  const stages = [];
  let left = total;
  const q1 = first > 0 ? Math.min(first, left) : 0; // tahap 1 bisa 0 bila stok site masih menutup window pertama
  if (q1 > 0) { stages.push({ no: 1, dayOffset: 0, qty: q1 }); left -= q1; }
  let k = 1; // tahap berikutnya jatuh setiap `calDays` hari; bila tahap 1 = 0 (stok site menutup window pertama) kiriman pertama baru di window ke-2
  while (left > 0.01 && stages.length < MAX_STAGES) {
    const q = Math.min(win, left);
    stages.push({ no: stages.length + 1, dayOffset: k * calDays, qty: q });
    left -= q; k += 1;
  }
  // Sisa ≤ 0,01 satuan = derau pembulatan, bukan tahap sendiri: gabungkan ke tahap terakhir.
  if (left > 1e-9 && left <= 0.01 && stages.length) { stages[stages.length - 1].qty += left; left = 0; }
  const round = (n) => Math.round(n * 100) / 100;
  return {
    unit: row.unit || '', windowDays: bufferDays, calendarDaysPerStage: calDays, total: round(total), truncated: left > 0.01,
    stages: stages.map((s) => ({ ...s, qty: round(s.qty), tanggal: start == null ? null : iso(start + s.dayOffset * DAY_MS) }))
  };
}
