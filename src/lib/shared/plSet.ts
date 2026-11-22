// @ts-nocheck
// SALINAN KONTRAK dari erp-epi/src/lib/utils/plSet.js (Rencana Product Pairing, sinkron 19 Nov 2026).
// JANGAN diedit di sini: ubah di erp-epi lalu salin ulang. Paritas isi dijaga tes kontrak lintas repo
// erp-epi/src/lib/server/gates/plCoverage.crossRepoContract.test.js (gagal bila kedua salinan menyimpang).
// '@ts-nocheck' disengaja: file ini JS murni yang identik dengan sisi admin; tipe tidak boleh membuatnya berbeda.
// src/lib/utils/plSet.js
// Modul MURNI (tanpa Directus / DOM). Sistem Set Packing List (Rencana Product Pairing, Fase 1):
//  (1) SET PRODUK  — pasangan Cat ↔ Thinner/Hardener/Thinner proses (barang HABIS PAKAI, kuantitas via rasio %).
//  (2) SET EQUIPMENT — alat induk ↔ aksesoris (Vakum + Belalai; barang PINJAM-KEMBALI, qty tetap per unit alat).
// Keduanya sengaja dipisah: mekanismenya berbeda (rasio & stok site vs. kelengkapan keluar/kembali).
// Aturan disimpan di app_settings (module 'project'): `pkl_set.product_rules` & `pkl_set.equipment_rules` (JSON) —
// bisa diubah superadmin di /settings/packing-list; belum ada ⇒ PRODUCT_RULE_DEFAULTS / EQUIPMENT_RULE_DEFAULTS.
// Pencocokan = KATA KUNCI pada nama barang (tak peka huruf besar/kecil), pola sama dengan plKit.js.
// Doktrin: aturan tidak berlaku / data kosong ⇒ N/A (bukan gagal). Null-safe: semua input boleh null/undefined.

export const PAIR_ROLES = Object.freeze(['mixing', 'process', 'hardener']);
export const PAIR_ROLE_LABEL = Object.freeze({ mixing: 'Thinner campuran', process: 'Thinner proses (cuci/degreasing)', hardener: 'Hardener / Part B' });
export const PAIR_REQUIREMENTS = Object.freeze(['wajib', 'opsional']);

/** Aturan Set Produk bawaan (usulan — dikonfirmasi/diubah superadmin). Kata kunci = potongan nama barang di master. */
export const PRODUCT_RULE_DEFAULTS = Object.freeze([
  {
    key: 'ox_602_604', label: 'Foxakyd (OX-602 / OX-604)', active: true,
    match: { keywords: ['OX-602', 'OX-604'], exclude: ['THINER', 'THINNER'] },
    pairs: [
      { key: 'thinner_campuran', label: 'Thinner campuran', role: 'mixing', requirement: 'wajib', ratio_pct: 10, note: 'Standar pengenceran Foxakyd.',
        options: [{ label: 'THINER 006', keywords: ['THINER 006', 'THINNER 006'], note: '' }] },
      { key: 'thinner_cuci', label: 'Thinner cuci / cleaning', role: 'process', requirement: 'opsional', ratio_pct: null, note: 'Pembersih alat setelah dipakai.',
        options: [{ label: 'THINER 014', keywords: ['THINER 014', 'THINNER 014', 'THINNER CUCI', 'THINER CUCI'], note: '' }] },
      { key: 'thinner_degreasing', label: 'Thinner degreasing / washing', role: 'process', requirement: 'opsional', ratio_pct: null, note: 'Pembersih permukaan sebelum pengecatan.',
        options: [{ label: 'THINER 012', keywords: ['THINER 012', 'THINNER 012', 'THINNER WASHING', 'THINER WASHING'], note: '' }] }
    ]
  },
  {
    key: 'ox_607', label: 'Foxakyd (OX-607)', active: true,
    match: { keywords: ['OX-607'], exclude: ['THINER', 'THINNER'] },
    pairs: [
      { key: 'thinner_campuran', label: 'Thinner campuran (pilih salah satu)', role: 'mixing', requirement: 'wajib', ratio_pct: 10, note: 'Pilih 067 untuk standar atau 068 bila butuh pengeringan lebih lambat dan hasil lebih gloss.',
        options: [
          { label: 'THINER 067 (ND — standar)', keywords: ['THINER 067', 'THINNER 067', 'FOXANNER ND', 'THINNER ND'], note: 'Standar.' },
          { label: 'THINER 068 (HG — slow & gloss)', keywords: ['THINER 068', 'THINNER 068', 'THINNER HG'], note: 'Lebih slow dan hasil lebih gloss.' }
        ] },
      { key: 'thinner_cuci', label: 'Thinner cuci / cleaning', role: 'process', requirement: 'opsional', ratio_pct: null, note: '',
        options: [{ label: 'THINER 014', keywords: ['THINER 014', 'THINNER 014', 'THINNER CUCI', 'THINER CUCI'], note: '' }] },
      { key: 'thinner_degreasing', label: 'Thinner degreasing / washing', role: 'process', requirement: 'opsional', ratio_pct: null, note: '',
        options: [{ label: 'THINER 012', keywords: ['THINER 012', 'THINNER 012', 'THINNER WASHING', 'THINER WASHING'], note: '' }] }
    ]
  }
]);

/** Aturan Set Equipment bawaan. `exclude` mencegah aksesoris (yang namanya memuat nama alat) dianggap alat induk. */
export const EQUIPMENT_RULE_DEFAULTS = Object.freeze([
  {
    key: 'vacuum_cleaner', label: 'Set Vacuum Cleaner', active: true,
    match: { keywords: ['VACUM CLEANER', 'VACUUM CLEANER'], exclude: ['BELALAI', 'SELANG', 'NOZZLE', 'FILTER', 'KANTONG'] },
    components: [
      { label: 'Belalai / selang vacuum 2,5 m', keywords: ['BELALAI', 'SELANG VACUM', 'SELANG VACUUM'], qty_per_unit: 1, mandatory_out: true, mandatory_return: true, consumable: false, identitas_barang_id: null },
      { label: 'Nozzle hisap', keywords: ['NOZZLE HISAP', 'NOZZLE VACUM', 'NOZZLE VACUUM'], qty_per_unit: 1, mandatory_out: false, mandatory_return: true, consumable: false, identitas_barang_id: null },
      { label: 'Kantong / filter vacuum', keywords: ['KANTONG VACUM', 'KANTONG VACUUM', 'FILTER VACUM', 'FILTER VACUUM'], qty_per_unit: 1, mandatory_out: false, mandatory_return: false, consumable: true, identitas_barang_id: null }
    ]
  },
  {
    key: 'airless_spray', label: 'Set Airless Spray', active: true,
    match: { keywords: ['AIRLESS'], exclude: ['SELANG', 'GUN', 'TIP', 'NOZZLE', 'FILTER'] },
    components: [
      { label: 'Selang airless', keywords: ['SELANG AIRLESS'], qty_per_unit: 1, mandatory_out: true, mandatory_return: true, consumable: false, identitas_barang_id: null },
      { label: 'Spray gun airless', keywords: ['GUN AIRLESS', 'SPRAY GUN'], qty_per_unit: 1, mandatory_out: true, mandatory_return: true, consumable: false, identitas_barang_id: null },
      { label: 'Tip / tip guard', keywords: ['TIP GUARD', 'AIRLESS TIP', 'TIP AIRLESS'], qty_per_unit: 1, mandatory_out: false, mandatory_return: true, consumable: false, identitas_barang_id: null }
    ]
  }
]);

const arr = (v) => (Array.isArray(v) ? v : []);
const norm = (s) => String(s ?? '').toUpperCase().replace(/\s*-\s*/g, '-').replace(/\s+/g, ' ').trim();
const slug = (s, max = 40) => String(s ?? '').trim().replace(/[^a-z0-9_]/gi, '_').slice(0, max);
const kws = (v, n = 12) => [...new Set(arr(v).map((x) => String(x ?? '').trim()).filter(Boolean))].slice(0, n);
const parseJson = (raw) => { if (typeof raw !== 'string') return raw; try { return JSON.parse(raw); } catch { return undefined; } };

/** Apakah nama barang memuat salah satu kata kunci. */
export function nameMatches(keywords, name) {
  const hay = norm(name);
  if (!hay) return false;
  return arr(keywords).some((kw) => { const k = norm(kw); return k && hay.includes(k); });
}

function ruleMatchesName(rule, name) {
  if (!rule || rule.active === false) return false;
  return nameMatches(rule.match?.keywords, name) && !nameMatches(rule.match?.exclude, name);
}

function sanitizeMatch(m) {
  return { keywords: kws(m?.keywords, 20), exclude: kws(m?.exclude, 20) };
}

/** Bersihkan aturan Set Produk dari klien/setelan: buang entri rusak, batasi ukuran. Tidak melempar. */
export function sanitizeProductRules(raw) {
  const list = parseJson(raw);
  const rules = [];
  for (const r of arr(list).slice(0, 60)) {
    const key = slug(r?.key); const label = String(r?.label ?? '').trim().slice(0, 100);
    const match = sanitizeMatch(r?.match);
    if (!key || !label || !match.keywords.length) continue;
    const pairs = [];
    for (const p of arr(r?.pairs).slice(0, 20)) {
      const pl = String(p?.label ?? '').trim().slice(0, 100);
      const options = [];
      for (const o of arr(p?.options).slice(0, 12)) {
        const ol = String(o?.label ?? '').trim().slice(0, 100); const k = kws(o?.keywords);
        if (ol && k.length) options.push({ label: ol, keywords: k, note: String(o?.note ?? '').trim().slice(0, 200) });
      }
      if (!pl || !options.length) continue;
      const ratio = Number(p?.ratio_pct);
      pairs.push({
        key: slug(p?.key) || slug(pl), label: pl,
        role: PAIR_ROLES.includes(p?.role) ? p.role : 'mixing',
        requirement: p?.requirement === 'wajib' ? 'wajib' : 'opsional',
        ratio_pct: p?.ratio_pct != null && p?.ratio_pct !== '' && Number.isFinite(ratio) && ratio > 0 && ratio <= 1000 ? ratio : null,
        note: String(p?.note ?? '').trim().slice(0, 300), options
      });
    }
    rules.push({ key, label, active: r?.active !== false, match, pairs });
  }
  return rules;
}

/** Bersihkan aturan Set Equipment. */
export function sanitizeEquipmentRules(raw) {
  const list = parseJson(raw);
  const rules = [];
  for (const r of arr(list).slice(0, 60)) {
    const key = slug(r?.key); const label = String(r?.label ?? '').trim().slice(0, 100);
    const match = sanitizeMatch(r?.match);
    if (!key || !label || !match.keywords.length) continue;
    const components = [];
    for (const c of arr(r?.components).slice(0, 40)) {
      const cl = String(c?.label ?? '').trim().slice(0, 100); const k = kws(c?.keywords);
      if (!cl || !k.length) continue;
      const q = Number(c?.qty_per_unit); const idb = Number(c?.identitas_barang_id);
      components.push({
        label: cl, keywords: k,
        qty_per_unit: Number.isFinite(q) && q > 0 && q <= 1000 ? q : 1,
        mandatory_out: c?.mandatory_out === true || c?.mandatory_out === 'true',
        mandatory_return: c?.mandatory_return === true || c?.mandatory_return === 'true',
        consumable: c?.consumable === true || c?.consumable === 'true',
        identitas_barang_id: Number.isFinite(idb) && idb > 0 ? idb : null
      });
    }
    rules.push({ key, label, active: r?.active !== false, match, components });
  }
  return rules;
}

/** Jumlah thinner dari qty cat × rasio %. Satu desimal; qty/rasio tak valid ⇒ 0. */
export function computeThinnerQty(catQty, ratioPct) {
  const q = Number(catQty); const r = Number(ratioPct);
  if (!Number.isFinite(q) || !Number.isFinite(r) || q <= 0 || r <= 0) return 0;
  return Math.round((q * r) / 10) / 10; // q × r / 100, dibulatkan 1 desimal
}

const names = (v) => arr(v).map((x) => (typeof x === 'string' ? x : x?.nama_barang)).filter(Boolean);
const srcOf = (s) => ({ request: names(s?.request), committed: names(s?.committed), site: names(s?.site) });
function whereFound(opt, src) {
  if (src.request.some((n) => nameMatches(opt.keywords, n))) return 'in_request';
  if (src.committed.some((n) => nameMatches(opt.keywords, n))) return 'committed';
  if (src.site.some((n) => nameMatches(opt.keywords, n))) return 'on_site';
  return null;
}

/**
 * Evaluasi Set Produk. Tiap rule yang cocok dengan salah satu barang permintaan dievaluasi sekali.
 * Pair 'wajib' terpenuhi bila SALAH SATU opsinya ada di permintaan / PL komit lain / stok site.
 * `mismatches` = barang thinner di permintaan yang dikenal aturan lain tetapi bukan pasangan cat yang diminta.
 * @param {Array<object>} rules aturan tersanitasi
 * @param {{request?:Array<string|{nama_barang:string}>, committed?:Array, site?:Array}} sources
 * @returns {{status:'not_applicable'|'passed'|'failed', rules:Array<object>, missing_mandatory:Array<object>, mismatches:Array<object>}}
 */
export function evaluateProductSets(rules, sources) {
  const src = srcOf(sources);
  const active = arr(rules).filter((r) => r && r.active !== false);
  const matched = active.filter((r) => src.request.some((n) => ruleMatchesName(r, n)));
  if (!matched.length) return { status: 'not_applicable', rules: [], missing_mandatory: [], mismatches: [] };

  const results = matched.map((r) => {
    const pairs = arr(r.pairs).map((p) => {
      const opts = arr(p.options).map((o) => ({ ...o, found: whereFound(o, src) }));
      const satisfied = opts.some((o) => o.found);
      return { ...p, options: opts, satisfied };
    });
    return { rule_key: r.key, rule_label: r.label, pairs };
  });
  const missing = results.flatMap((r) => r.pairs.filter((p) => p.requirement === 'wajib' && !p.satisfied).map((p) => ({ rule_key: r.rule_key, rule_label: r.rule_label, pair_key: p.key, label: p.label, options: p.options.map((o) => o.label) })));

  // Thinner campuran yang diminta tetapi bukan pasangan resmi cat di permintaan ini.
  const allowedOpts = results.flatMap((r) => r.pairs.filter((p) => p.role === 'mixing').flatMap((p) => p.options));
  const knownMixing = active.flatMap((r) => arr(r.pairs).filter((p) => p.role === 'mixing').flatMap((p) => arr(p.options)));
  const mismatches = [];
  for (const n of src.request) {
    if (matched.some((r) => ruleMatchesName(r, n))) continue; // cat itu sendiri
    const isKnown = knownMixing.some((o) => nameMatches(o.keywords, n));
    const isAllowed = allowedOpts.some((o) => nameMatches(o.keywords, n));
    if (isKnown && !isAllowed) mismatches.push({ nama_barang: n, expected: [...new Set(allowedOpts.map((o) => o.label))] });
  }
  const status = missing.length || mismatches.length ? 'failed' : 'passed';
  return { status, rules: results, missing_mandatory: missing, mismatches };
}

/**
 * Evaluasi Set Equipment untuk permintaan keluar. Komponen `mandatory_out` harus ada di permintaan / PL komit lain / site.
 * Komponen consumable tak pernah dianggap kurang. Hasil `return_checklist` dipakai Fase 3 (serah-terima / retur).
 */
export function evaluateEquipmentSets(rules, sources) {
  const src = srcOf(sources);
  const active = arr(rules).filter((r) => r && r.active !== false);
  const matched = active.filter((r) => src.request.some((n) => ruleMatchesName(r, n)));
  if (!matched.length) return { status: 'not_applicable', rules: [], missing_mandatory: [], return_checklist: [] };

  const results = matched.map((r) => {
    const components = arr(r.components).map((c) => ({ ...c, found: whereFound(c, src) }));
    return { rule_key: r.key, rule_label: r.label, components };
  });
  const missing = results.flatMap((r) => r.components.filter((c) => c.mandatory_out && !c.consumable && !c.found).map((c) => ({ rule_key: r.rule_key, rule_label: r.rule_label, label: c.label, qty_per_unit: c.qty_per_unit })));
  const returns = results.flatMap((r) => r.components.filter((c) => c.mandatory_return && !c.consumable).map((c) => ({ rule_key: r.rule_key, label: c.label, qty_per_unit: c.qty_per_unit })));
  const hasMandatory = results.some((r) => r.components.some((c) => c.mandatory_out && !c.consumable));
  return { status: !hasMandatory ? 'not_applicable' : missing.length ? 'failed' : 'passed', rules: results, missing_mandatory: missing, return_checklist: returns };
}

/**
 * Parse tempelan dari Excel (TSV) menjadi aturan Set Produk. Kolom (urutan tetap, header opsional):
 *   Kode cat (pisah koma) | Peran (mixing/process/hardener) | Label thinner | Kata kunci (pisah koma) | Rasio % | Sifat (wajib/opsional) | Catatan
 * Baris dengan (kode cat + peran) yang sama menjadi OPSI dari satu pair (mis. 067 ND dan 068 HG untuk OX-607).
 * @returns {{rules:Array<object>, errors:string[]}}
 */
export function parseProductRulesTsv(text) {
  const errors = []; const byKey = new Map();
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  lines.forEach((line, idx) => {
    const c = line.split('\t').map((x) => x.trim());
    if (idx === 0 && /^kode/i.test(c[0] || '')) return; // header
    const [codes, role, label, kw, ratio, req, note] = c;
    const codeList = kws(String(codes || '').split(/[,;]/));
    const kwList = kws(String(kw || '').split(/[,;]/));
    if (!codeList.length || !label || !kwList.length) { errors.push(`Baris ${idx + 1}: kode cat, label, dan kata kunci wajib diisi.`); return; }
    const r = PAIR_ROLES.includes(String(role || '').toLowerCase()) ? String(role).toLowerCase() : 'mixing';
    const rk = slug(codeList.join('_').toLowerCase());
    if (!byKey.has(rk)) byKey.set(rk, { key: rk, label: `Cat ${codeList.join(' / ')}`, active: true, match: { keywords: codeList, exclude: ['THINER', 'THINNER'] }, pairs: [] });
    const rule = byKey.get(rk);
    let pair = rule.pairs.find((p) => p.role === r);
    if (!pair) {
      pair = { key: r, label: PAIR_ROLE_LABEL[r], role: r, requirement: /^wajib/i.test(req || '') ? 'wajib' : 'opsional', ratio_pct: Number(ratio) > 0 ? Number(ratio) : null, note: '', options: [] };
      rule.pairs.push(pair);
    }
    pair.options.push({ label, keywords: kwList, note: String(note || '') });
  });
  return { rules: sanitizeProductRules([...byKey.values()]), errors };
}

/**
 * Aturan Set Produk yang berlaku untuk sebuah produk (dikenali dari nama kode FG / nama varian). Dipakai kartu
 * "Pasangan Thinner Resmi" di detail produk. Mengembalikan [] bila tak ada aturan cocok.
 * @param {Array<object>} rules aturan tersanitasi
 * @param {Array<string>} names nama_kode, kode_singkat, nama varian
 */
export function rulesForProduct(rules, names) {
  const list = arr(names).filter(Boolean);
  return arr(rules).filter((r) => list.some((n) => ruleMatchesName(r, n)));
}
