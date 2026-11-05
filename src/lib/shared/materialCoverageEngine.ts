// @ts-nocheck
// SALINAN KONTRAK dari erp-epi/src/lib/utils/materialCoverageEngine.js (Rencana Gate Rasionalitas Packing List, Fase 4, 4 Nov 2026).
// JANGAN diedit di sini: ubah di erp-epi lalu salin ulang. Paritas isi dijaga tes kontrak lintas repo
// erp-epi/src/lib/server/gates/plCoverage.crossRepoContract.test.js (gagal bila kedua salinan menyimpang).
// '@ts-nocheck' disengaja: file ini JS murni yang identik dengan sisi admin; tipe tidak boleh membuatnya berbeda.
// src/lib/utils/materialCoverageEngine.js
// Modul MURNI (tanpa Directus / DOM) — dipakai server (plGates.js, outflowHubApi.js) dan, via salinan
// kontrak yang sama, form lapangan. Menghitung PLAFON kuantitas material Packing List dari
// luasan (m²) × daya sebar (kalkulator_material_rate), setelah qty dinormalkan dari kemasan
// (Pail/Kaleng/Drum) ke satuan dasar (Kg/Liter).
//
// Doktrin (CLAUDE.md aturan 3, 7, 11 + plGates D1/D2):
//   • Data tidak cukup (luasan kosong/tidak dipercaya, barang belum dipetakan ke standar, satuan tak
//     bisa dikonversi) ⇒ status 'unknown' / 'not_applicable', BUKAN 'failed' — tidak ada lockdown retroaktif.
//   • Semua ambang datang dari `settings` (resolvePklCoverageSettings) — tidak ada angka sakti di sini.
//   • Null-safe: semua input boleh null/undefined/string.

import { parseNumberID, paintLiters } from './planningMath';
import { resolvePklCoverageSettings } from './plCoverageSettings';

const EPS = 1e-9;
const num = (v) => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseNumberID(v);
  return n == null ? 0 : n;
};
const round = (n, d = 2) => {
  const f = 10 ** d;
  return Math.round((Number(n) || 0) * f) / f;
};

const KG_UNITS = new Set(['kg', 'kgs', 'kilogram', 'kilo']);
const LTR_UNITS = new Set(['l', 'ltr', 'liter', 'litre', 'lt']);
const PACK_ALIASES = { pail: 'pail', ember: 'pail', kaleng: 'kaleng', can: 'can', galon: 'galon', gallon: 'galon', drum: 'drum' };

/** 'Pail' → {kind:'pack', word:'pail'}; 'Kg' → {kind:'kg'}; 'Ltr' → {kind:'ltr'}; lain → {kind:'other'}. */
export function classifyUnit(unit) {
  const u = String(unit ?? '').trim().toLowerCase().replace(/\./g, '');
  if (!u) return { kind: 'other', word: '' };
  if (KG_UNITS.has(u)) return { kind: 'kg', word: u };
  if (LTR_UNITS.has(u)) return { kind: 'ltr', word: u };
  if (PACK_ALIASES[u]) return { kind: 'pack', word: PACK_ALIASES[u] };
  return { kind: 'other', word: u };
}

/** Ekstrak ukuran dari teks: "FOXAFLOOR 955 PAIL @ 20 KG" → {amount:20, unit:'kg'}; "5 LITER" → {5,'ltr'}. */
export function parseSizeFromText(text) {
  const s = String(text ?? '');
  const re = /(\d+(?:[.,]\d+)?)\s*(kgs?|kilogram|liter|litre|ltr|lt|l)\b/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const amount = Number(String(m[1]).replace(',', '.'));
    if (!(amount > 0)) continue;
    const unit = KG_UNITS.has(m[2].toLowerCase()) || m[2].toLowerCase().startsWith('kg') ? 'kg' : 'ltr';
    return { amount, unit };
  }
  return null;
}

/**
 * Ukuran SATU kemasan. Prioritas: master (fill_weight_kg) → pola di nama/unit barang → default settings per kata kemasan.
 * @returns {{ size:number, baseUnit:'kg'|'ltr', source:'master'|'nama'|'default' } | null}
 */
export function resolvePackSize({ unit, name, fillWeightKg } = {}, settings) {
  const cfg = settings || resolvePklCoverageSettings([]);
  const fw = num(fillWeightKg);
  if (fw > 0) return { size: fw, baseUnit: 'kg', source: 'master' };
  const fromText = parseSizeFromText(`${name ?? ''} ${unit ?? ''}`);
  if (fromText) return { size: fromText.amount, baseUnit: fromText.unit, source: 'nama' };
  const cls = classifyUnit(unit);
  if (cls.kind === 'pack') {
    const d = num((cfg.pack_default_kg || {})[cls.word]);
    if (d > 0) return { size: d, baseUnit: 'kg', source: 'default' };
  }
  return null;
}

/**
 * Qty permintaan → satuan dasar. Satuan di luar Kg/Ltr/kemasan (Set, Pcs, Roll…) ⇒ resolved:false.
 * @returns {{ resolved:boolean, base:number, baseUnit:'kg'|'ltr'|null, pack:object|null, reason?:string }}
 */
export function normalizeQtyToBase({ qty, unit, name, fillWeightKg } = {}, settings) {
  const q = num(qty);
  const cls = classifyUnit(unit);
  const pack = resolvePackSize({ unit, name, fillWeightKg }, settings);
  if (cls.kind === 'kg') return { resolved: true, base: q, baseUnit: 'kg', pack };
  if (cls.kind === 'ltr') return { resolved: true, base: q, baseUnit: 'ltr', pack };
  if (cls.kind === 'pack') {
    if (!pack) return { resolved: false, base: 0, baseUnit: null, pack: null, reason: `Ukuran 1 ${cls.word} belum diketahui (isi fill_weight_kg di master barang)` };
    return { resolved: true, base: q * pack.size, baseUnit: pack.baseUnit, pack };
  }
  return { resolved: false, base: 0, baseUnit: null, pack, reason: `Satuan "${String(unit ?? '').trim() || '-'}" tidak dapat dikonversi ke Kg/Liter` };
}

/** kg↔ltr via densitas (kg/L). Satuan sama ⇒ apa adanya. Densitas hilang ⇒ null. */
export function convertBase(value, from, to, density) {
  if (from === to) return value;
  const d = num(density);
  if (!(d > 0)) return null;
  if (from === 'ltr' && to === 'kg') return value * d;
  if (from === 'kg' && to === 'ltr') return value / d;
  return null;
}

/**
 * Standar daya sebar satu baris kalkulator_material_rate.
 *  • mode 'direct' : default_consumption (kg|ltr per m²). Plafon = max_consumption (bila diisi; konsumsi bergantung ketebalan,
 *                    mis. SLW 0.45–2.21 kg/m²) ELSE default_consumption × layers_max.
 *  • mode 'dft'    : liter/m² per lapis = DFT/(10×VS%) (rumus yang sama dgn planningMaterialEngine) × layers_max.
 * @returns {{ mode:'direct'|'dft', unit:'kg'|'ltr', typicalPerM2:number, capPerM2:number, density:number|null, basis:string } | null}
 */
export function resolveRateStandard(rate, settings) {
  if (!rate) return null;
  const cfg = settings || resolvePklCoverageSettings([]);
  const layers = Math.max(1, num(cfg.layers_max) || 1);
  const density = num(rate.density) > 0 ? num(rate.density) : null;
  const rateUnit = LTR_UNITS.has(String(rate.unit ?? '').trim().toLowerCase()) ? 'ltr' : 'kg';

  const dc = num(rate.default_consumption);
  if (dc > 0) {
    const maxC = num(rate.max_consumption);
    const capPerM2 = maxC > 0 ? Math.max(maxC, dc) : dc * layers;
    return {
      mode: 'direct', unit: rateUnit, typicalPerM2: dc, capPerM2, density,
      basis: maxC > 0 ? `${dc} (tipikal) – ${capPerM2} ${rateUnit}/m² (maks master)` : `${dc} ${rateUnit}/m² × ${layers} lapis`
    };
  }
  const vs = num(rate.volume_solids);
  const dft = num(rate.default_dft);
  if (vs > 0 && dft > 0) {
    const litersPerCoat = paintLiters({ luasM2: 1, dftMicron: dft, solidPct: vs, lossPct: 0 });
    // Satuan hasil mengikuti satuan master rate; kg butuh densitas.
    let unit = 'ltr';
    let perCoat = litersPerCoat;
    if (rateUnit === 'kg') {
      if (!density) return null;
      unit = 'kg';
      perCoat = litersPerCoat * density;
    }
    return {
      mode: 'dft', unit, typicalPerM2: perCoat, capPerM2: perCoat * layers, density,
      basis: `DFT ${dft} µm, VS ${vs}% → ${round(perCoat, 3)} ${unit}/m² per lapis × ${layers} lapis`
    };
  }
  return null;
}

/**
 * Luasan acuan: sumber pertama yang ≥ min_trusted_area_m2 (nilai sampah seperti "1"/"2" m² dilewati ke sumber berikutnya).
 * Urutan: subtask → charter → proyek → objek proyek.
 * @returns {{ areaM2:number, source:string } | null}
 */
export function resolveAreaM2({ subtaskM2, charterM2, projectM2, objectsSumM2 } = {}, settings) {
  const cfg = settings || resolvePklCoverageSettings([]);
  const minArea = num(cfg.min_trusted_area_m2);
  const cands = [
    ['subtask', subtaskM2],
    ['charter', charterM2],
    ['proyek', projectM2],
    ['objek_proyek', objectsSumM2]
  ];
  for (const [source, raw] of cands) {
    const v = num(raw);
    if (v > 0 && v >= minArea) return { areaM2: v, source };
  }
  return null;
}

/** Plafon (satuan dasar standar) untuk luasan tertentu. */
export function computeCap({ areaM2, standard, settings }) {
  const cfg = settings || resolvePklCoverageSettings([]);
  const loss = 1 + num(cfg.loss_factor_pct) / 100;
  const tol = 1 + num(cfg.qty_tolerance_pct) / 100;
  const a = num(areaM2);
  if (!(a > 0) || !standard) return { typical: 0, cap: 0 };
  return {
    typical: a * standard.typicalPerM2 * loss,
    cap: a * standard.capPerM2 * loss * tol
  };
}

/**
 * Cocokkan nama barang ke baris kalkulator_material_rate lewat KODE PRODUK ("FOXAFLOOR PRIMER : OX-902 GREY" → OX-902).
 * identitas_barang dipecah per warna & ukuran kemasan (satu produk = puluhan baris), jadi tautan 1 FK per rate tidak cukup.
 * Kode terpanjang dicoba dulu dan harus berdiri sendiri (OX-925 tidak cocok pada "OX-9251"). Tidak ada cocok ⇒ null (tidak menebak).
 * @param {string} name
 * @param {Array<{code?:string}>} rates
 */
export function findRateByProductCode(name, rates) {
  // "OX - 9251" / "ox -902" ditulis bebas di master & laporan ⇒ samakan spasi di sekitar tanda hubung sebelum mencocokkan.
  const hay = String(name ?? '').toUpperCase().replace(/\s*-\s*/g, '-');
  if (!hay || !Array.isArray(rates)) return null;
  const sorted = rates
    .filter((r) => String(r?.code ?? '').trim().length >= 3)
    .sort((a, b) => String(b.code).length - String(a.code).length);
  for (const r of sorted) {
    const code = String(r.code).trim().toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^A-Z0-9])${code}(?![A-Z0-9])`).test(hay)) return r;
  }
  return null;
}

/**
 * Evaluasi rasionalitas qty vs luasan untuk sekumpulan baris PL.
 *
 * @param {{
 *   areaM2: number|null,            // hasil resolveAreaM2().areaM2 (null ⇒ semua 'unknown')
 *   items: Array<{ key?:string|number, item_id?:any, nama_barang?:string, qty_required?:any, unit?:string, fill_weight_kg?:any }>,
 *   rateByItemId?: Map<string, object>|Record<string, object>,  // String(item_id) → baris kalkulator_material_rate (pemetaan eksplisit)
 *   rates?: Array<object>,                                      // semua baris kalkulator_material_rate (cocok via kode produk di nama barang)
 *   priorByRateId?: Map<string, {base:number, unit:'kg'|'ltr'}>|Record<string, {base:number, unit:string}>, // qty terkirim sebelumnya (kumulatif)
 *   settings?: object
 * }} p
 * @returns {{ status:'passed'|'failed'|'not_applicable', items:Array<object>, overCount:number, evaluatedCount:number, maxOverPct:number }}
 */
export function evaluateCoverage({ areaM2, items, rateByItemId, rates, priorByRateId, settings } = {}) {
  const cfg = settings || resolvePklCoverageSettings([]);
  const get = (m, k) => (m instanceof Map ? m.get(k) : m ? m[k] : undefined);
  const list = Array.isArray(items) ? items : [];
  const area = num(areaM2);

  const rows = list.map((it, idx) => {
    const base = {
      key: it?.key ?? it?.id ?? idx, nama_barang: it?.nama_barang ?? '', unit: it?.unit ?? '', qty: num(it?.qty_required),
      status: 'unknown', reason: ''
    };
    if (!(area > 0)) return { ...base, reason: 'Luasan proyek belum terisi / belum dipercaya' };
    if (!(base.qty > 0)) return { ...base, reason: 'Qty kosong' };
    const itemKey = it?.item_id == null ? null : String(typeof it.item_id === 'object' ? it.item_id?.id : it.item_id);
    // Prioritas: pemetaan eksplisit per item (rateByItemId) → kode produk di nama barang (rates).
    const rate = (itemKey ? get(rateByItemId, itemKey) : null) || findRateByProductCode(it?.nama_barang, rates);
    if (!rate) return { ...base, reason: 'Barang belum dipetakan ke standar daya sebar (kalkulator material)' };
    const standard = resolveRateStandard(rate, cfg);
    if (!standard) return { ...base, reason: `Standar daya sebar "${rate.code || rate.name || ''}" belum lengkap (konsumsi / DFT+VS)` };
    const norm = normalizeQtyToBase({ qty: it?.qty_required, unit: it?.unit, name: it?.nama_barang, fillWeightKg: it?.fill_weight_kg }, cfg);
    if (!norm.resolved) return { ...base, reason: norm.reason };
    const inStd = convertBase(norm.base, norm.baseUnit, standard.unit, standard.density);
    if (inStd == null) return { ...base, reason: 'Konversi Kg↔Liter butuh densitas barang (kalkulator material)' };
    let packStd = null;
    if (norm.pack) packStd = convertBase(norm.pack.size, norm.pack.baseUnit, standard.unit, standard.density);
    return {
      ...base, rateId: String(rate.id ?? rate.code), rateCode: rate.code || '', standard, requestedStd: inStd, packStd,
      packSource: norm.pack?.source || null, _it: it
    };
  });

  // Kelompokkan per rate: plafon dihitung SEKALI per standar, permintaan seluruh baris sejenis dijumlah + kumulatif sebelumnya.
  const groups = new Map();
  for (const r of rows) {
    if (!r.rateId) continue;
    const g = groups.get(r.rateId) || { standard: r.standard, requested: 0, packStd: null, rows: [] };
    g.requested += r.requestedStd;
    if (r.packStd > 0 && (g.packStd == null || r.packStd < g.packStd)) g.packStd = r.packStd; // kemasan terkecil
    g.rows.push(r);
    groups.set(r.rateId, g);
  }

  let overCount = 0;
  let evaluatedCount = 0;
  let maxOverPct = 0;
  for (const [rateId, g] of groups) {
    const prior = get(priorByRateId, rateId);
    let priorStd = 0;
    if (prior && num(prior.base) > 0) {
      const p = convertBase(num(prior.base), prior.unit === 'ltr' ? 'ltr' : 'kg', g.standard.unit, g.standard.density);
      priorStd = p == null ? 0 : p;
    }
    const { typical, cap: rawCap } = computeCap({ areaM2: area, standard: g.standard, settings: cfg });
    // 1 kemasan utuh selalu diizinkan (proyek kecil < 1 pail) bila setelan aktif.
    const cap = cfg.round_up_whole_pack && g.packStd > 0 ? Math.max(rawCap, g.packStd) : rawCap;
    const total = priorStd + g.requested;
    const over = total > cap + EPS;
    const overPct = cap > 0 ? (total / cap - 1) * 100 : 0;
    const remaining = Math.max(0, cap - priorStd);
    for (const r of g.rows) {
      evaluatedCount++;
      r.status = over ? 'over' : 'ok';
      r.capStd = round(cap, 2);
      r.typicalStd = round(typical, 2);
      r.priorStd = round(priorStd, 2);
      r.totalStd = round(total, 2);
      r.stdUnit = g.standard.unit;
      r.overPct = over ? round(overPct, 0) : 0;
      r.basis = g.standard.basis;
      // Saran qty maksimal dalam satuan baris (kemasan utuh bila satuan baris = kemasan).
      const cls = classifyUnit(r.unit);
      if (cls.kind === 'pack' && r.packStd > 0) r.suggestedQty = Math.max(0, Math.floor(remaining / r.packStd + EPS));
      else r.suggestedQty = round(remaining, 2);
      r.reason = over
        ? `Diminta ${round(total, 2)} ${r.stdUnit} (termasuk ${round(priorStd, 2)} terkirim) melebihi plafon ${round(cap, 2)} ${r.stdUnit} untuk ${round(area, 1)} m² (${g.standard.basis}).`
        : `Wajar: ${round(total, 2)} ≤ ${round(cap, 2)} ${r.stdUnit} untuk ${round(area, 1)} m².`;
      delete r._it;
    }
    if (over) { overCount += g.rows.length; maxOverPct = Math.max(maxOverPct, overPct); }
  }

  const status = overCount > 0 ? 'failed' : evaluatedCount > 0 ? 'passed' : 'not_applicable';
  return { status, items: rows, overCount, evaluatedCount, maxOverPct: round(maxOverPct, 0) };
}

/** Thinner: maks. persen dari total volume cat (liter). */
export function computeThinnerCap({ paintLitersTotal, settings }) {
  const cfg = settings || resolvePklCoverageSettings([]);
  return round(num(paintLitersTotal) * num(cfg.thinner_ratio_pct) / 100, 2);
}

// ─────────────── Run-rate harian (dipakai G_PKL_TIMELINE_RUNRATE, Fase 2) ───────────────

/**
 * Laju luasan harian (m²/hari). Prioritas: rata-rata daily_plan → luas/durasi → tukang × produktivitas.
 * @returns {{ rate:number, source:'timeline'|'durasi'|'tukang' } | null}
 */
export function resolveDailyRate({ planAvgM2PerDay, areaM2, durationDays, workers, productivityM2PerDay } = {}) {
  const p = num(planAvgM2PerDay);
  if (p > 0) return { rate: p, source: 'timeline' };
  const a = num(areaM2);
  const d = num(durationDays);
  if (a > 0 && d > 0) return { rate: a / d, source: 'durasi' };
  const w = num(workers);
  const pr = num(productivityM2PerDay);
  if (w > 0 && pr > 0) return { rate: w * pr, source: 'tukang' };
  return null;
}

/** Kebutuhan harian (satuan standar/hari) = laju m²/hari × konsumsi tipikal × (1+loss). */
export function computeDailyBurn({ dailyRateM2, typicalPerM2, settings }) {
  const cfg = settings || resolvePklCoverageSettings([]);
  return num(dailyRateM2) * num(typicalPerM2) * (1 + num(cfg.loss_factor_pct) / 100);
}

/**
 * Batas kirim per window = DailyBurn × hari_buffer − stok site. Proyek kecil (luas ≤ full_lot_area_threshold_m2)
 * tidak dibatasi window (return null = tak dibatasi; plafon m² tetap berlaku).
 */
export function maxQtyWindow({ dailyBurn, areaM2, onHand, settings }) {
  const cfg = settings || resolvePklCoverageSettings([]);
  if (num(areaM2) > 0 && num(areaM2) <= num(cfg.full_lot_area_threshold_m2)) return null;
  return Math.max(0, num(dailyBurn) * num(cfg.max_buffer_days) - num(onHand));
}

/** Stok site masih cukup untuk N hari kerja ke depan ⇒ permintaan baru patut ditahan (G_PKL_SITE_STOCK_RECON). */
export function siteStockCoversDays({ onHand, dailyBurn, settings }) {
  const cfg = settings || resolvePklCoverageSettings([]);
  const days = num(cfg.site_stock_cover_days);
  const burn = num(dailyBurn);
  if (!(days > 0) || !(burn > 0)) return false;
  return num(onHand) >= burn * days;
}

// ─────────────── Jadwal, run-rate & stok site (G_PKL_TIMELINE_RUNRATE, G_PKL_SITE_STOCK_RECON — Fase 2b) ───────────────

const M2_UNIT = /^(m2|m²|m\^2|m 2|meter ?persegi)$/i;
const DAY_MS = 86400000;
const isoToUtc = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s ?? ''));
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};
const utcToIso = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Jadwal proyek dari projects.timeline_planning (categories[].subtasks[].daily_plan = { 'YYYY-MM-DD': volume }).
 *  • first/last = rentang SEMUA tanggal daily_plan (apa pun satuannya);
 *  • planM2ByDate = jumlah volume harian subtask bersatuan m² (dasar laju m²/hari). Struktur rusak/kosong ⇒ semua null/kosong.
 * @returns {{ first:string|null, last:string|null, planM2ByDate:Record<string,number>, dayCount:number }}
 */
export function extractAreaSchedule(timelinePlanning) {
  const cats = Array.isArray(timelinePlanning?.categories) ? timelinePlanning.categories : [];
  const dates = new Set();
  const planM2ByDate = {};
  for (const c of cats) {
    for (const s of Array.isArray(c?.subtasks) ? c.subtasks : []) {
      const plan = s?.daily_plan && typeof s.daily_plan === 'object' ? s.daily_plan : {};
      const unit = String(s?.unit ?? s?.satuan ?? c?.unit ?? c?.satuan ?? '').trim();
      for (const [d, v] of Object.entries(plan)) {
        if (isoToUtc(d) == null) continue;
        const day = d.slice(0, 10);
        dates.add(day);
        if (M2_UNIT.test(unit) && num(v) > 0) planM2ByDate[day] = (planM2ByDate[day] || 0) + num(v);
      }
    }
  }
  const sorted = [...dates].sort();
  return { first: sorted[0] ?? null, last: sorted[sorted.length - 1] ?? null, planM2ByDate, dayCount: sorted.length };
}

/** Rata-rata m²/hari dari rencana pada jendela [from, from+days) — hanya hari yang punya rencana. null bila kosong. */
export function avgPlannedM2PerDay(planM2ByDate, fromIso, days) {
  const start = isoToUtc(fromIso);
  if (start == null || !(days > 0)) return null;
  let sum = 0;
  let n = 0;
  for (const [d, v] of Object.entries(planM2ByDate || {})) {
    const t = isoToUtc(d);
    if (t != null && t >= start && t < start + days * DAY_MS && num(v) > 0) { sum += num(v); n++; }
  }
  return n > 0 ? sum / n : null;
}

/**
 * needed_date harus berada di dalam jendela jadwal proyek: [first − timeline_lead_days, last + timeline_tail_days].
 * Jadwal/tanggal tidak ada ⇒ 'unknown' (tidak dihukum).
 */
export function checkNeededDateWindow({ neededDate, schedule, settings }) {
  const cfg = settings || resolvePklCoverageSettings([]);
  const nd = isoToUtc(neededDate);
  const first = isoToUtc(schedule?.first);
  const last = isoToUtc(schedule?.last);
  if (nd == null || first == null || last == null) return { status: 'unknown', reason: 'Tanggal butuh atau jadwal timeline proyek belum tersedia' };
  const lead = Math.max(0, num(cfg.timeline_lead_days));
  const tail = Math.max(0, num(cfg.timeline_tail_days));
  if (nd < first - lead * DAY_MS) {
    return { status: 'too_early', reason: `Tanggal butuh ${utcToIso(nd)} terlalu awal: jadwal proyek mulai ${utcToIso(first)} (batas H-${lead}).` };
  }
  if (nd > last + tail * DAY_MS) {
    return { status: 'too_late', reason: `Tanggal butuh ${utcToIso(nd)} melewati akhir jadwal proyek ${utcToIso(last)} (+${tail} hari). Perbarui timeline bila pekerjaan memang mundur.` };
  }
  return { status: 'ok', reason: `Tanggal butuh dalam jadwal proyek (${utcToIso(first)} s/d ${utcToIso(last)}).` };
}

function mapItemToRate(it, rateByItemId, rates) {
  const get = (m, k) => (m instanceof Map ? m.get(k) : m ? m[k] : undefined);
  const itemKey = it?.item_id == null ? null : String(typeof it.item_id === 'object' ? it.item_id?.id : it.item_id);
  return (itemKey ? get(rateByItemId, itemKey) : null) || findRateByProductCode(it?.nama_barang, rates);
}

/**
 * Qty sekali kirim vs kebutuhan beberapa hari ke depan: requested ≤ DailyBurn × max_buffer_days − stok site
 * (min. 1 kemasan utuh bila round_up_whole_pack). Proyek ≤ full_lot_area_threshold_m2 tidak dibatasi window (plafon m² tetap berlaku di G_PKL_COVERAGE_M2).
 * Laju harian/luasan/standar tidak ada ⇒ 'unknown' (N/A), bukan gagal.
 *
 * @param {{ areaM2:number|null, dailyRate:{rate:number,source:string}|null, items:Array<object>, rates?:Array<object>, rateByItemId?:any,
 *           siteStockByRateId?: Map<string,{onHandStd:number}>|Record<string,{onHandStd:number}>, settings?:object }} p
 */
export function evaluateRunRate({ areaM2, dailyRate, items, rates, rateByItemId, siteStockByRateId, settings } = {}) {
  const cfg = settings || resolvePklCoverageSettings([]);
  const get = (m, k) => (m instanceof Map ? m.get(k) : m ? m[k] : undefined);
  const list = Array.isArray(items) ? items : [];
  const area = num(areaM2);
  const groups = new Map();
  const rows = list.map((it, idx) => {
    const base = { key: it?.key ?? it?.id ?? idx, nama_barang: it?.nama_barang ?? '', unit: it?.unit ?? '', qty: num(it?.qty_required), status: 'unknown', reason: '' };
    if (!(area > 0)) return { ...base, reason: 'Luasan proyek belum terisi / belum dipercaya' };
    if (!dailyRate || !(dailyRate.rate > 0)) return { ...base, reason: 'Laju pekerjaan harian belum dapat ditentukan (timeline / durasi / jumlah tukang)' };
    if (!(base.qty > 0)) return { ...base, reason: 'Qty kosong' };
    const rate = mapItemToRate(it, rateByItemId, rates);
    if (!rate) return { ...base, reason: 'Barang belum dipetakan ke standar daya sebar' };
    const standard = resolveRateStandard(rate, cfg);
    if (!standard) return { ...base, reason: 'Standar daya sebar belum lengkap' };
    const norm = normalizeQtyToBase({ qty: it?.qty_required, unit: it?.unit, name: it?.nama_barang, fillWeightKg: it?.fill_weight_kg }, cfg);
    if (!norm.resolved) return { ...base, reason: norm.reason };
    const inStd = convertBase(norm.base, norm.baseUnit, standard.unit, standard.density);
    if (inStd == null) return { ...base, reason: 'Konversi Kg↔Liter butuh densitas barang' };
    const packStd = norm.pack ? convertBase(norm.pack.size, norm.pack.baseUnit, standard.unit, standard.density) : null;
    const rateId = String(rate.id ?? rate.code);
    const row = { ...base, rateId, requestedStd: inStd };
    const g = groups.get(rateId) || { standard, requested: 0, packStd: null, rows: [] };
    g.requested += inStd;
    if (packStd > 0 && (g.packStd == null || packStd < g.packStd)) g.packStd = packStd;
    g.rows.push(row);
    groups.set(rateId, g);
    return row;
  });

  let overCount = 0;
  let evaluatedCount = 0;
  let maxOverPct = 0;
  for (const [rateId, g] of groups) {
    const onHand = num(get(siteStockByRateId, rateId)?.onHandStd);
    const burn = computeDailyBurn({ dailyRateM2: dailyRate.rate, typicalPerM2: g.standard.typicalPerM2, settings: cfg });
    const win = maxQtyWindow({ dailyBurn: burn, areaM2: area, onHand, settings: cfg });
    const cap = win == null ? null : (cfg.round_up_whole_pack && g.packStd > 0 ? Math.max(win, g.packStd) : win);
    const over = cap != null && g.requested > cap + EPS;
    const overPct = over ? (cap > 0 ? (g.requested / cap - 1) * 100 : 999) : 0;
    for (const r of g.rows) {
      evaluatedCount++;
      r.stdUnit = g.standard.unit;
      r.dailyBurnStd = round(burn, 2);
      r.onHandStd = round(onHand, 2);
      if (cap == null) {
        r.status = 'ok';
        r.reason = `Proyek kecil (≤ ${num(cfg.full_lot_area_threshold_m2)} m²): 1 lot penuh diizinkan, dibatasi plafon m².`;
        continue;
      }
      r.capStd = round(cap, 2);
      r.status = over ? 'over' : 'ok';
      r.overPct = round(overPct, 0);
      const cls = classifyUnit(r.unit);
      r.suggestedQty = cls.kind === 'pack' && g.packStd > 0 ? Math.max(0, Math.floor(cap / g.packStd + EPS)) : round(cap, 2);
      r.reason = over
        ? `Diminta ${round(g.requested, 2)} ${r.stdUnit}, melebihi kebutuhan ${num(cfg.max_buffer_days)} hari kerja (${round(burn, 2)} ${r.stdUnit}/hari × ${num(cfg.max_buffer_days)} − stok site ${round(onHand, 2)} = ${round(cap, 2)}). Laju ${round(dailyRate.rate, 1)} m²/hari (${dailyRate.source}).`
        : `Wajar untuk ${num(cfg.max_buffer_days)} hari kerja: ${round(g.requested, 2)} ≤ ${round(cap, 2)} ${r.stdUnit}.`;
    }
    if (over) { overCount += g.rows.length; maxOverPct = Math.max(maxOverPct, overPct); }
  }
  const status = overCount > 0 ? 'failed' : evaluatedCount > 0 ? 'passed' : 'not_applicable';
  return { status, items: rows, overCount, evaluatedCount, maxOverPct: round(maxOverPct, 0) };
}

/**
 * Rekonsiliasi stok site. Permintaan baru ditahan per grup standar bila:
 *  (a) stok site masih cukup ≥ site_stock_cover_days × kebutuhan harian, ATAU
 *  (b) barang sudah diterima di site > unreported_usage_days hari lalu tetapi pemakaiannya tak pernah tercatat (qty_used = 0).
 * Tidak ada catatan stok site (pengiriman pertama) ⇒ tidak ada yang ditahan.
 *
 * @param {{ items:Array<object>, rates?:Array<object>, rateByItemId?:any, dailyRate?:{rate:number}|null,
 *           siteStockByRateId?: Map<string,{onHandStd:number,receivedStd:number,usedStd:number,lastMovement:string|null}>|object,
 *           now?:Date, settings?:object }} p
 */
export function evaluateSiteStockRecon({ items, rates, rateByItemId, dailyRate, siteStockByRateId, now = new Date(), settings } = {}) {
  const cfg = settings || resolvePklCoverageSettings([]);
  const get = (m, k) => (m instanceof Map ? m.get(k) : m ? m[k] : undefined);
  const list = Array.isArray(items) ? items : [];
  const rows = list.map((it, idx) => {
    const base = { key: it?.key ?? it?.id ?? idx, nama_barang: it?.nama_barang ?? '', status: 'unknown', reason: '' };
    if (!(num(it?.qty_required) > 0)) return { ...base, reason: 'Qty kosong' };
    const rate = mapItemToRate(it, rateByItemId, rates);
    if (!rate) return { ...base, reason: 'Barang belum dipetakan ke standar daya sebar' };
    const standard = resolveRateStandard(rate, cfg);
    if (!standard) return { ...base, reason: 'Standar daya sebar belum lengkap' };
    const rateId = String(rate.id ?? rate.code);
    const st = get(siteStockByRateId, rateId);
    if (!st) return { ...base, rateId, status: 'ok', reason: 'Belum ada catatan stok site untuk produk ini (pengiriman pertama).' };
    const flags = [];
    const onHand = num(st.onHandStd);
    const burn = dailyRate?.rate > 0 ? computeDailyBurn({ dailyRateM2: dailyRate.rate, typicalPerM2: standard.typicalPerM2, settings: cfg }) : 0;
    if (siteStockCoversDays({ onHand, dailyBurn: burn, settings: cfg })) {
      flags.push(`stok site ${round(onHand, 2)} ${standard.unit} masih cukup ±${round(onHand / burn, 1)} hari kerja (batas ${num(cfg.site_stock_cover_days)} hari)`);
    }
    const days = num(cfg.unreported_usage_days);
    const lastMs = isoToUtc(st.lastMovement);
    if (days > 0 && num(st.receivedStd) > 0 && num(st.usedStd) <= 0 && lastMs != null && now.getTime() - lastMs > days * DAY_MS) {
      flags.push(`${round(num(st.receivedStd), 2)} ${standard.unit} diterima di site sejak ${utcToIso(lastMs)} (> ${days} hari) tetapi belum ada pemakaian dilaporkan`);
    }
    return {
      ...base, rateId, stdUnit: standard.unit, onHandStd: round(onHand, 2), status: flags.length ? 'hold' : 'ok',
      reason: flags.length ? `Tahan: ${flags.join('; ')}.` : `Saldo site ${round(onHand, 2)} ${standard.unit} wajar.`
    };
  });
  const evaluatedCount = rows.filter((r) => r.status === 'ok' || r.status === 'hold').length;
  const holdCount = rows.filter((r) => r.status === 'hold').length;
  const status = holdCount > 0 ? 'failed' : evaluatedCount > 0 ? 'passed' : 'not_applicable';
  return { status, items: rows, holdCount, evaluatedCount };
}

// ─────────────── Radar efisiensi pemakaian aktual (Fase 5) ───────────────

/**
 * Pemakaian AKTUAL material (laporan harian: reports.material_used[] {type, amount, unit}) vs kebutuhan teoritis TOTAL proyek
 * (luas × daya sebar × (1+loss) [tipikal] dan × (1+toleransi) [plafon]). Progres m² harian tidak terstruktur di laporan
 * (hanya teks bebas), jadi pembandingnya = kebutuhan keseluruhan proyek, bukan per hari/per m² selesai.
 *  • status per produk: 'over' (≥ plafon) · 'near' (≥ efficiency_warn_pct % plafon) · 'ok'
 *  • baris tak terpetakan ke standar / satuan tak bisa dikonversi dikembalikan di `unmatched` (tidak dinilai, tidak ditebak).
 *
 * @param {{ areaM2:number|null, usedRows:Array<{type?:string, amount?:any, unit?:string}>, rates:Array<object>, settings?:object }} p
 * @returns {{ status:'over'|'near'|'ok'|'not_applicable', products:Array<object>, unmatched:Array<{type:string, amount:number, unit:string, reason:string}>, matchedCount:number }}
 */
export function evaluateUsageEfficiency({ areaM2, usedRows, rates, settings } = {}) {
  const cfg = settings || resolvePklCoverageSettings([]);
  const area = num(areaM2);
  const list = Array.isArray(usedRows) ? usedRows : [];
  const groups = new Map();
  const unmatched = [];
  for (const u of list) {
    const type = String(u?.type ?? '').trim();
    const amount = num(u?.amount);
    if (!type || !(amount > 0)) continue;
    const rate = findRateByProductCode(type, rates);
    if (!rate) { unmatched.push({ type, amount, unit: u?.unit ?? '', reason: 'Belum dipetakan ke standar daya sebar' }); continue; }
    const std = resolveRateStandard(rate, cfg);
    if (!std) { unmatched.push({ type, amount, unit: u?.unit ?? '', reason: 'Standar daya sebar belum lengkap' }); continue; }
    const norm = normalizeQtyToBase({ qty: amount, unit: u?.unit, name: type }, cfg);
    if (!norm.resolved) { unmatched.push({ type, amount, unit: u?.unit ?? '', reason: norm.reason || 'Satuan tak dapat dikonversi' }); continue; }
    const inStd = convertBase(norm.base, norm.baseUnit, std.unit, std.density);
    if (inStd == null) { unmatched.push({ type, amount, unit: u?.unit ?? '', reason: 'Konversi Kg↔Liter butuh densitas barang' }); continue; }
    const k = String(rate.id ?? rate.code);
    const g = groups.get(k) || { rate, std, usedStd: 0, reports: 0 };
    g.usedStd += inStd;
    g.reports += 1;
    groups.set(k, g);
  }
  if (!(area > 0)) return { status: 'not_applicable', products: [], unmatched, matchedCount: groups.size };

  const warn = Math.min(100, Math.max(1, num(cfg.efficiency_warn_pct) || 80));
  const products = [];
  for (const g of groups.values()) {
    const { typical, cap } = computeCap({ areaM2: area, standard: g.std, settings: cfg });
    const pctOfCap = cap > 0 ? (g.usedStd / cap) * 100 : 0;
    products.push({
      rateCode: g.rate.code || '', name: g.rate.name || '', unit: g.std.unit, usedStd: round(g.usedStd, 2),
      typicalStd: round(typical, 2), capStd: round(cap, 2), pctOfCap: round(pctOfCap, 0),
      pctOfTypical: typical > 0 ? round((g.usedStd / typical) * 100, 0) : 0,
      reports: g.reports, basis: g.std.basis,
      status: g.usedStd > cap + EPS ? 'over' : pctOfCap >= warn ? 'near' : 'ok'
    });
  }
  products.sort((a, b) => b.pctOfCap - a.pctOfCap);
  const status = products.some((p) => p.status === 'over') ? 'over' : products.some((p) => p.status === 'near') ? 'near' : products.length ? 'ok' : 'not_applicable';
  return { status, products, unmatched, matchedCount: products.length };
}

// ─────────────── Kuota RAB (G_PKL_RAB_QUOTA, Fase 2) ───────────────

/**
 * Qty kumulatif (terkirim/komit sebelumnya + diminta) per baris RAB tidak boleh melewati qty RAB × (1+toleransi).
 * Baris tanpa project_budget_id, RAB tanpa qty, atau satuan yang tak bisa disamakan (Kg vs Liter tanpa densitas, Set, Pcs…) ⇒ 'unknown'
 * (tidak dievaluasi). Satuan yang sama persis (mis. "Pcs" vs "pcs") dibandingkan apa adanya.
 *
 * @param {{
 *   items: Array<{ key?:any, project_budget_id?:any, nama_barang?:string, qty_required?:any, unit?:string, fill_weight_kg?:any }>,
 *   budgetById: Map<string, {id:any, material_name?:string, qty?:any, unit?:string}>|Record<string, object>,
 *   priorByBudgetId?: Map<string, {qty:number, unit:string}>|Record<string, {qty:number, unit:string}>, // qty komit sebelumnya dalam SATUAN ITEM RAB (bukan base)
 *   settings?: object
 * }} p
 */
export function evaluateRabQuota({ items, budgetById, priorByBudgetId, settings } = {}) {
  const cfg = settings || resolvePklCoverageSettings([]);
  const get = (m, k) => (m instanceof Map ? m.get(k) : m ? m[k] : undefined);
  const list = Array.isArray(items) ? items : [];
  const tol = 1 + num(cfg.qty_tolerance_pct) / 100;

  // Bawa semua qty ke satuan dasar bila bisa; jika tidak, ke "satuan mentah" yang sama.
  const toComparable = (qty, unit, name, fill) => {
    const n = normalizeQtyToBase({ qty, unit, name, fillWeightKg: fill }, cfg);
    if (n.resolved) return { value: n.base, unit: n.baseUnit };
    const raw = String(unit ?? '').trim().toLowerCase();
    return raw ? { value: num(qty), unit: `raw:${raw}` } : null;
  };

  const groups = new Map();
  const rows = list.map((it, idx) => {
    const base = { key: it?.key ?? it?.id ?? idx, nama_barang: it?.nama_barang ?? '', unit: it?.unit ?? '', qty: num(it?.qty_required), status: 'unknown', reason: '' };
    const bid = it?.project_budget_id == null ? null : String(typeof it.project_budget_id === 'object' ? it.project_budget_id?.id : it.project_budget_id);
    if (!bid) return { ...base, reason: 'Baris tidak bertaut ke item RAB' };
    if (!(base.qty > 0)) return { ...base, reason: 'Qty kosong' };
    const b = get(budgetById, bid);
    if (!b || !(num(b.qty) > 0)) return { ...base, reason: 'Item RAB tidak ditemukan / qty RAB kosong' };
    const budget = toComparable(b.qty, b.unit, b.material_name, null);
    const req = toComparable(it.qty_required, it.unit, it.nama_barang, it.fill_weight_kg);
    if (!budget || !req || budget.unit !== req.unit) return { ...base, reason: `Satuan RAB ("${b.unit || '-'}") dan permintaan ("${it.unit || '-'}") tidak dapat disamakan` };
    const row = { ...base, budgetId: bid, requested: req.value, cmpUnit: req.unit, budgetQty: budget.value, budgetUnit: b.unit || '' };
    const g = groups.get(bid) || { budget, requested: 0, rows: [] };
    g.requested += req.value;
    g.rows.push(row);
    groups.set(bid, g);
    return row;
  });

  let overCount = 0;
  let evaluatedCount = 0;
  let maxOverPct = 0;
  for (const [bid, g] of groups) {
    const prior = get(priorByBudgetId, bid);
    const priorC = prior ? toComparable(prior.qty, prior.unit, '', null) : null;
    const priorVal = priorC && priorC.unit === g.budget.unit ? priorC.value : 0;
    const cap = g.budget.value * tol;
    const total = priorVal + g.requested;
    const over = total > cap + EPS;
    const overPct = cap > 0 ? (total / cap - 1) * 100 : 0;
    for (const r of g.rows) {
      evaluatedCount++;
      r.status = over ? 'over' : 'ok';
      r.capStd = round(cap, 2);
      r.priorStd = round(priorVal, 2);
      r.totalStd = round(total, 2);
      r.stdUnit = r.cmpUnit.startsWith('raw:') ? r.cmpUnit.slice(4) : r.cmpUnit;
      r.overPct = over ? round(overPct, 0) : 0;
      r.suggestedQty = round(Math.max(0, cap - priorVal), 2);
      r.reason = over
        ? `Kumulatif ${round(total, 2)} ${r.stdUnit} (termasuk ${round(priorVal, 2)} terkomit) melebihi kuota RAB ${round(g.budget.value, 2)} ${r.stdUnit} (+${num(cfg.qty_tolerance_pct)}% toleransi).`
        : `Dalam kuota RAB: ${round(total, 2)} ≤ ${round(cap, 2)} ${r.stdUnit}.`;
    }
    if (over) { overCount += g.rows.length; maxOverPct = Math.max(maxOverPct, overPct); }
  }
  const status = overCount > 0 ? 'failed' : evaluatedCount > 0 ? 'passed' : 'not_applicable';
  return { status, items: rows, overCount, evaluatedCount, maxOverPct: round(maxOverPct, 0) };
}

// ─────────────── Material utama di luar RAB (bagian G_PKL_RAB_QUOTA, Fase 5+) ───────────────

/**
 * Item manual (tanpa taut baris RAB) bermaterial utama (cat/coating yang terpetakan ke standar daya sebar) yang PRODUKNYA tidak ada
 * sama sekali di RAB proyek ⇒ 'unregistered'. Dasar penilaian = himpunan produk (rate) yang muncul di baris RAB proyek:
 * RAB kosong / tak ada satu pun baris RAB yang terpetakan ke produk ⇒ 'not_applicable' (tidak bisa menilai, tidak dihukum).
 *
 * @param {{ items:Array<object>, rates?:Array<object>, rateByItemId?:any, registeredRateIds?: Set<string>|Array<string>|null, settings?:object }} p
 * @returns {{ status:'passed'|'failed'|'not_applicable', items:Array<object>, flaggedCount:number }}
 */
export function evaluateUnregisteredMaterial({ items, rates, rateByItemId, registeredRateIds, settings } = {}) {
  const cfg = settings || resolvePklCoverageSettings([]);
  const reg = registeredRateIds instanceof Set ? registeredRateIds : new Set(Array.isArray(registeredRateIds) ? registeredRateIds.map(String) : []);
  const list = Array.isArray(items) ? items : [];
  const rows = list.map((it, idx) => {
    const base = { key: it?.key ?? it?.id ?? idx, nama_barang: it?.nama_barang ?? '', status: 'unknown', reason: '' };
    if (it?.project_budget_id != null && String(typeof it.project_budget_id === 'object' ? it.project_budget_id?.id : it.project_budget_id) !== '') {
      return { ...base, reason: 'Bertaut ke baris RAB' };
    }
    if (!(num(it?.qty_required) > 0)) return { ...base, reason: 'Qty kosong' };
    const rate = mapItemToRate(it, rateByItemId, rates);
    if (!rate) return { ...base, reason: 'Bukan material utama terpetakan' };
    if (!resolveRateStandard(rate, cfg)) return { ...base, reason: 'Standar daya sebar belum lengkap' };
    const rateId = String(rate.id ?? rate.code);
    return reg.has(rateId)
      ? { ...base, rateId, rateCode: rate.code || '', status: 'ok', reason: `Produk ${rate.code} terdaftar di RAB proyek.` }
      : { ...base, rateId, rateCode: rate.code || '', status: 'unregistered', reason: `Produk ${rate.code || rate.name} tidak ada di RAB proyek — ajukan penambahan RAB (Addendum) atau pakai produk yang sudah di RAB.` };
  });
  if (reg.size === 0) return { status: 'not_applicable', items: rows.map((r) => ({ ...r, status: r.status === 'unregistered' ? 'unknown' : r.status })), flaggedCount: 0 };
  const flaggedCount = rows.filter((r) => r.status === 'unregistered').length;
  const evaluated = rows.filter((r) => r.status === 'ok' || r.status === 'unregistered').length;
  return { status: flaggedCount > 0 ? 'failed' : evaluated > 0 ? 'passed' : 'not_applicable', items: rows, flaggedCount };
}
