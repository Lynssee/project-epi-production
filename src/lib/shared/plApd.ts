// @ts-nocheck
// SALINAN KONTRAK dari erp-epi/src/lib/utils/plApd.js (Rencana Keyakinan Permintaan PL, sinkron 12 Nov 2026).
// JANGAN diedit di sini: ubah di erp-epi lalu salin ulang. Paritas isi dijaga tes kontrak lintas repo
// erp-epi/src/lib/server/gates/plCoverage.crossRepoContract.test.js (gagal bila kedua salinan menyimpang).
// '@ts-nocheck' disengaja: file ini JS murni yang identik dengan sisi admin; tipe tidak boleh membuatnya berbeda.
// src/lib/utils/plApd.js
// Modul MURNI (tanpa Directus / DOM). Kecukupan APD per proyek berbasis JUMLAH ORANG (Rencana Keyakinan Permintaan PL, Fase 3).
// Kebutuhan = penugasan manpower aktif proyek × aturan APD per jabatan; dibandingkan dengan APD yang sudah diminta (PL ini + PL komit
// lain) atau sudah diterima di site. Ini kecukupan JUMLAH, bukan buku distribusi per orang (itu butuh kolom manpower_id di
// hse_apd_distribution — perubahan skema menunggu izin Lead). Aturan disimpan di app_settings module 'project' key
// `pkl_apd.requirements` (JSON, diedit di /settings/packing-list); belum ada ⇒ APD_DEFAULTS.
//
// Doktrin: data kosong ⇒ N/A / 'unknown' (bukan gagal): tanpa penugasan aktif, satuan tak dikenal, atau butir tanpa kata kunci.
// Null-safe: semua input boleh null/undefined.

/** Satuan → jumlah pcs. Satuan tak dikenal (mis. Pack) = tidak dapat dihitung (resolved:false), TIDAK ditebak. */
const UNIT_PCS = Object.freeze({
  pcs: 1, pc: 1, unit: 1, buah: 1, biji: 1, set: 1, pasang: 1, psg: 1, pair: 1, lembar: 1, roll: 1,
  lusin: 12, dozen: 12, kodi: 20
});

/** Aturan bawaan (draf usulan — dikonfirmasi/diubah superadmin). Kelompok `all` berlaku untuk setiap pekerja. */
export const APD_DEFAULTS = Object.freeze({
  min_coverage_pct: 100,
  groups: [
    {
      key: 'dasar', label: 'Semua pekerja lapangan', all: true, jabatan_keywords: [],
      items: [
        { label: 'Helm safety', keywords: ['HELM'], qty_per_person: 1, mandatory: true },
        { label: 'Sepatu safety', keywords: ['SEPATU SAFETY'], qty_per_person: 1, mandatory: true },
        { label: 'Sarung tangan', keywords: ['SARUNG TANGAN'], qty_per_person: 1, mandatory: true },
        { label: 'Kacamata safety', keywords: ['KACAMATA'], qty_per_person: 1, mandatory: false },
        { label: 'Rompi / vest', keywords: ['ROMPI'], qty_per_person: 1, mandatory: false },
        { label: 'Masker', keywords: ['MASKER'], qty_per_person: 1, mandatory: false }
      ]
    },
    {
      key: 'blaster_painter', label: 'Blaster / Painter', all: false, jabatan_keywords: ['BLASTER', 'PAINTER', 'PAINTING'],
      items: [
        { label: 'Respirator', keywords: ['RESPIRATOR'], qty_per_person: 1, mandatory: true },
        { label: 'Coverall / wearpack', keywords: ['WEARPACK', 'COVERALL', 'BAJU FOXA'], qty_per_person: 1, mandatory: false },
        { label: 'Earplug', keywords: ['EARPLUG', 'EAR PLUG'], qty_per_person: 1, mandatory: false }
      ]
    }
  ]
});

const arr = (v) => (Array.isArray(v) ? v : []);
const norm = (s) => String(s ?? '').toUpperCase().replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
const nz = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export function toPieces(qty, unit) {
  const q = nz(qty);
  const f = UNIT_PCS[String(unit ?? '').trim().toLowerCase()];
  return f == null ? { pieces: 0, resolved: false } : { pieces: q * f, resolved: true };
}

/** Bersihkan konfigurasi dari setelan/klien. Tidak melempar. Mengembalikan {min_coverage_pct, groups}. */
export function sanitizeApdConfig(raw) {
  let cfg = raw;
  if (typeof raw === 'string') { try { cfg = JSON.parse(raw); } catch { return null; } }
  if (!cfg || typeof cfg !== 'object') return null;
  const groups = [];
  for (const g of arr(cfg.groups).slice(0, 20)) {
    const key = String(g?.key ?? '').trim().replace(/[^a-z0-9_]/gi, '_').slice(0, 40);
    const label = String(g?.label ?? '').trim().slice(0, 80);
    if (!key || !label) continue;
    const items = [];
    for (const it of arr(g.items).slice(0, 40)) {
      const l = String(it?.label ?? '').trim().slice(0, 80);
      const keywords = [...new Set(arr(it?.keywords).map((x) => String(x ?? '').trim()).filter(Boolean))].slice(0, 10);
      const q = nz(it?.qty_per_person);
      if (!l || !keywords.length) continue;
      items.push({ label: l, keywords, qty_per_person: q > 0 && q <= 100 ? q : 1, mandatory: it?.mandatory === true || it?.mandatory === 'true' });
    }
    groups.push({
      key, label, all: g?.all === true || g?.all === 'true',
      jabatan_keywords: [...new Set(arr(g?.jabatan_keywords).map((x) => String(x ?? '').trim()).filter(Boolean))].slice(0, 20), items
    });
  }
  const m = nz(cfg.min_coverage_pct);
  return { min_coverage_pct: m >= 1 && m <= 100 ? m : 100, groups };
}

/** Kelompok yang berlaku untuk satu jabatan (kelompok `all` selalu; lainnya bila salah satu kata kunci muncul di jabatan). */
export function groupsForJabatan(groups, jabatan) {
  const j = norm(jabatan);
  return arr(groups).filter((g) => g.all || (j && arr(g.jabatan_keywords).some((k) => { const kk = norm(k); return kk && j.includes(kk); })));
}

/** Penugasan aktif → jumlah orang UNIK (manpower_id; tanpa id dihitung per baris) dengan jabatan pertamanya. */
export function dedupePersons(assignments) {
  const seen = new Map();
  let anon = 0;
  for (const a of arr(assignments)) {
    const k = a?.manpower_id != null && a.manpower_id !== '' ? `m${a.manpower_id}` : `x${anon++}`;
    if (!seen.has(k)) seen.set(k, { key: k, jabatan: a?.jabatan || '' });
  }
  return [...seen.values()];
}

/**
 * Kebutuhan APD proyek. Butir dengan label sama di beberapa kelompok dijumlahkan.
 * @returns {{ persons:number, items:Array<{label:string, keywords:string[], mandatory:boolean, needed:number, persons:number}> }}
 */
export function computeApdNeed(assignments, config) {
  const cfg = config || APD_DEFAULTS;
  const persons = dedupePersons(assignments);
  const by = new Map();
  for (const p of persons) {
    for (const g of groupsForJabatan(cfg.groups, p.jabatan)) {
      for (const it of g.items) {
        const cur = by.get(it.label) || { label: it.label, keywords: it.keywords, mandatory: false, needed: 0, persons: 0 };
        cur.needed += nz(it.qty_per_person) || 1;
        cur.persons += 1;
        cur.mandatory = cur.mandatory || !!it.mandatory;
        by.set(it.label, cur);
      }
    }
  }
  return { persons: persons.length, items: [...by.values()] };
}

/** Kata kunci terpanjang yang cocok pada nama (0 = tak cocok) — dipakai agar satu baris sumber hanya dihitung ke SATU butir. */
function matchScore(keywords, name) {
  const hay = norm(name);
  let best = 0;
  for (const kw of arr(keywords)) { const k = norm(kw); if (k && hay.includes(k)) best = Math.max(best, k.length); }
  return best;
}

/**
 * @param {{persons:number, items:Array<object>}} need hasil computeApdNeed
 * @param {{ request?:Array<{nama_barang?:string, qty?:any, unit?:string}>, committed?:Array<object>, siteReceived?:Array<object> }} sources
 *   have = max(komit PL lain, diterima di site) + permintaan ini (item yang sudah diterima di site umumnya bagian dari yang dikomit — jangan dobel)
 * @param {{min_coverage_pct?:number}} [cfg]
 * @returns {{ status:'not_applicable'|'passed'|'failed', persons:number, items:Array<object>, short_mandatory:Array<object>, unresolved_units:number }}
 */
export function evaluateApd(need, sources, cfg) {
  const minPct = nz(cfg?.min_coverage_pct) || 100;
  const items = arr(need?.items);
  const tally = (rows) => {
    const sum = new Map(items.map((it) => [it.label, 0]));
    let unresolved = 0;
    for (const r of arr(rows)) {
      let best = null; let bestScore = 0;
      for (const it of items) { const s = matchScore(it.keywords, r?.nama_barang); if (s > bestScore) { best = it; bestScore = s; } }
      if (!best) continue;
      const { pieces, resolved } = toPieces(r?.qty, r?.unit);
      if (!resolved) { unresolved++; continue; }
      sum.set(best.label, (sum.get(best.label) || 0) + pieces);
    }
    return { sum, unresolved };
  };
  const req = tally(sources?.request);
  const com = tally(sources?.committed);
  const site = tally(sources?.siteReceived);
  const unresolved = req.unresolved + com.unresolved + site.unresolved;

  const rows = items.map((it) => {
    const have = Math.max(com.sum.get(it.label) || 0, site.sum.get(it.label) || 0) + (req.sum.get(it.label) || 0);
    const coverage = it.needed > 0 ? Math.round((have / it.needed) * 100) : 100;
    const short = Math.max(0, it.needed - have);
    const status = coverage >= minPct ? 'ok' : (have === 0 && unresolved > 0 ? 'unknown' : 'short');
    return { ...it, have, short, coverage_pct: coverage, status };
  });
  const shortMandatory = rows.filter((r) => r.mandatory && r.status === 'short');
  const evaluable = need?.persons > 0 && rows.length > 0;
  return {
    status: !evaluable ? 'not_applicable' : shortMandatory.length ? 'failed' : 'passed',
    persons: nz(need?.persons), items: rows, short_mandatory: shortMandatory, unresolved_units: unresolved
  };
}
