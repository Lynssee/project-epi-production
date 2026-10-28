#!/usr/bin/env node
/**
 * Field Contract Guard — Fase 0 dari rencana v2 audit R&D + Produksi.
 * Memindai file js/svelte di src/ untuk `fields=`/`fields:` dan `filter[<kolom>][_lt|_lte|_gt|_gte]`,
 * lalu memverifikasi terhadap skema Directus produksi (via /fields/<collection>).
 *
 * Output: docs/reports/field-contract-audit.md
 * Cache skema: .cache/directus-schema-cache.json (TTL 1 jam)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { globSync } from 'node:fs';
import path from 'node:path';
try { process.loadEnvFile('.env'); } catch { /* .env opsional, env bisa dari shell */ }

const ROOT = process.cwd();
const DIRECTUS_URL = (process.env.DIRECTUS_API_URL || process.env.VITE_DIRECTUS_API_URL || process.env.DIRECTUS_URL || '').replace(/\/$/, '');
const DIRECTUS_TOKEN = process.env.DIRECTUS_TOKEN || process.env.VITE_DIRECTUS_TOKEN;

if (!DIRECTUS_URL || !DIRECTUS_TOKEN) {
  console.error('DIRECTUS_API_URL / DIRECTUS_TOKEN tidak ditemukan di env. Cek .env');
  process.exit(1);
}

const CACHE_DIR = path.join(ROOT, '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'directus-schema-cache.json');
const CACHE_TTL_MS = 60 * 60 * 1000;

function loadCache() {
  if (!existsSync(CACHE_FILE)) return { fetchedAt: 0, collections: {} };
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return { fetchedAt: 0, collections: {} };
  }
}

function saveCache(cache) {
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

let schemaCache = loadCache();
const cacheFresh = Date.now() - schemaCache.fetchedAt < CACHE_TTL_MS;
if (!cacheFresh) schemaCache = { fetchedAt: Date.now(), collections: {} };

const fetchedThisRun = new Set();
const unreachableCollections = new Set();

async function getCollectionFields(collection) {
  if (schemaCache.collections[collection] && (cacheFresh || fetchedThisRun.has(collection))) {
    return schemaCache.collections[collection];
  }
  if (unreachableCollections.has(collection)) return null;
  try {
    const res = await fetch(`${DIRECTUS_URL}/fields/${collection}`, {
      headers: { Authorization: `Bearer ${DIRECTUS_TOKEN}` },
    });
    if (!res.ok) {
      unreachableCollections.add(collection);
      return null;
    }
    const json = await res.json();
    const fields = {};
    for (const f of json.data || []) {
      fields[f.field] = {
        type: f.type,
        relatedCollection: f.meta?.special?.includes('m2o') || f.schema?.foreign_key_table ? f.schema?.foreign_key_table : null,
      };
    }
    schemaCache.collections[collection] = fields;
    fetchedThisRun.add(collection);
    return fields;
  } catch (err) {
    unreachableCollections.add(collection);
    return null;
  }
}

// --- 1. Kumpulkan file sumber ---
const files = globSync('src/**/*.{js,ts,svelte}', { cwd: ROOT }).filter(
  (f) => !f.includes('node_modules')
);

// --- 2. Regex pola ---
const RE_ITEMS_PATH = /\/items\/([a-zA-Z_][a-zA-Z0-9_]*)/g;
const RE_SDK_COLLECTION = /(?:readItems|readItem|createItem|createItems|updateItem|updateItems|aggregate)\(\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]/g;
const RE_COLLECTION_LITERAL = /collection:\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]/g;
const RE_FIELDS_QUERY = /fields=([a-zA-Z0-9_.,*\[\]$-]+)/g;
const RE_FIELDS_PROP_STR = /fields:\s*['"]([a-zA-Z0-9_.,*\s\[\]$-]+)['"]/g;
const RE_FIELDS_PROP_ARR = /fields:\s*\[([\s\S]{0,2000}?)\]/g;
const RE_FILTER_NUMERIC = /filter\[([a-zA-Z0-9_]+)\]\[(_lt|_lte|_gt|_gte)\]/g;
const RE_FILTER_NUMERIC_DOT = /filter\.([a-zA-Z0-9_]+)\.(_lt|_lte|_gt|_gte)/g;

const WINDOW = 600; // jarak cari collection context sebelum/sesudah match

function findNearestCollection(content, idx) {
  const start = Math.max(0, idx - WINDOW);
  const end = Math.min(content.length, idx + WINDOW);
  const windowText = content.slice(start, end);

  let best = null;
  let bestDist = Infinity;

  for (const re of [RE_ITEMS_PATH, RE_COLLECTION_LITERAL, RE_SDK_COLLECTION]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(windowText))) {
      const matchIdxInFull = start + m.index;
      const dist = Math.abs(matchIdxInFull - idx);
      if (dist < bestDist) {
        bestDist = dist;
        best = m[1];
      }
    }
  }
  return best;
}

function splitFieldList(raw) {
  return raw
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
    .filter((s) => s !== '*' && !s.startsWith('$'));
}

const violations = [];
const unresolved = [];
const numericFilterViolations = [];

async function checkFieldPath(collection, fieldPath, file, lineNo) {
  const segments = fieldPath.split('.').filter(Boolean);
  if (segments.length === 0) return;

  const rootFields = await getCollectionFields(collection);
  if (!rootFields) {
    unresolved.push({ file, lineNo, collection, fieldPath, reason: 'skema koleksi tidak terbaca (MCP/API 403 atau koleksi tidak ada)' });
    return;
  }

  const [first, ...rest] = segments;
  // '*' as segment (e.g. product_id.*) — skip deep check
  if (first === '*') return;

  if (!(first in rootFields)) {
    violations.push({ file, lineNo, collection, fieldPath, missingField: first, missingIn: collection });
    return;
  }

  if (rest.length === 0) return;

  // Nested — heuristik: nama field relasi == nama koleksi target (pola dominan di repo ini)
  const relatedCollection = rootFields[first].relatedCollection || first;
  const nextPath = rest.join('.');
  if (nextPath === '*') return;

  const relatedFields = await getCollectionFields(relatedCollection);
  if (!relatedFields) {
    unresolved.push({ file, lineNo, collection, fieldPath, reason: `koleksi relasi "${relatedCollection}" tidak terbaca` });
    return;
  }
  const secondSeg = rest[0];
  if (!(secondSeg in relatedFields)) {
    violations.push({ file, lineNo, collection, fieldPath, missingField: secondSeg, missingIn: relatedCollection });
  }
}

async function checkNumericFilter(collection, field, file, lineNo) {
  const rootFields = await getCollectionFields(collection);
  if (!rootFields || !(field in rootFields)) return;
  const type = rootFields[field].type;
  if (type === 'string' || type === 'text') {
    numericFilterViolations.push({ file, lineNo, collection, field, type });
  }
}

let scanned = 0;
for (const relFile of files) {
  const abs = path.join(ROOT, relFile);
  let content;
  try {
    content = readFileSync(abs, 'utf8');
  } catch {
    continue;
  }
  scanned++;

  const lineStarts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') lineStarts.push(i + 1);
  }
  function lineOf(idx) {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  }

  const tasks = [];

  for (const re of [RE_FIELDS_QUERY, RE_FIELDS_PROP_STR]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content))) {
      const collection = findNearestCollection(content, m.index);
      if (!collection) continue;
      const lineNo = lineOf(m.index);
      for (const fp of splitFieldList(m[1])) {
        tasks.push(checkFieldPath(collection, fp, relFile, lineNo));
      }
    }
  }

  RE_FIELDS_PROP_ARR.lastIndex = 0;
  {
    let m;
    while ((m = RE_FIELDS_PROP_ARR.exec(content))) {
      const collection = findNearestCollection(content, m.index);
      if (!collection) continue;
      const lineNo = lineOf(m.index);
      for (const fp of splitFieldList(m[1])) {
        if (!fp || fp.length > 100) continue;
        tasks.push(checkFieldPath(collection, fp, relFile, lineNo));
      }
    }
  }

  for (const re of [RE_FILTER_NUMERIC, RE_FILTER_NUMERIC_DOT]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(content))) {
      const collection = findNearestCollection(content, m.index);
      if (!collection) continue;
      const lineNo = lineOf(m.index);
      tasks.push(checkNumericFilter(collection, m[1], relFile, lineNo));
    }
  }

  await Promise.all(tasks);
}

saveCache(schemaCache);

// --- 3. Dedup & laporan ---
function dedupKey(v) {
  return `${v.file}:${v.collection}:${v.fieldPath || v.field}:${v.missingField || v.type || ''}`;
}
function dedup(list) {
  const seen = new Set();
  const out = [];
  for (const v of list) {
    const k = dedupKey(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

const dedupedViolations = dedup(violations);
const dedupedNumeric = dedup(numericFilterViolations);
const dedupedUnresolved = dedup(unresolved);

const lines = [];
lines.push('# Field Contract Audit');
lines.push('');
lines.push(`Dibuat: ${new Date().toISOString()}`);
lines.push(`File dipindai: ${scanned}`);
lines.push('');
lines.push(`## Kolom Diminta Tapi Tidak Ada di Skema (${dedupedViolations.length})`);
lines.push('');
if (dedupedViolations.length === 0) {
  lines.push('_Tidak ada pelanggaran._');
} else {
  lines.push('| File | Baris | Koleksi Query | Field Path | Kolom Hilang | Hilang di Koleksi |');
  lines.push('|---|---:|---|---|---|---|');
  for (const v of dedupedViolations.sort((a, b) => a.file.localeCompare(b.file) || a.lineNo - b.lineNo)) {
    lines.push(`| ${v.file} | ${v.lineNo} | ${v.collection} | \`${v.fieldPath}\` | \`${v.missingField}\` | ${v.missingIn} |`);
  }
}
lines.push('');
lines.push(`## Filter Numerik (_lt/_lte/_gt/_gte) pada Kolom string/text (${dedupedNumeric.length})`);
lines.push('');
if (dedupedNumeric.length === 0) {
  lines.push('_Tidak ada pelanggaran._');
} else {
  lines.push('| File | Baris | Koleksi | Kolom | Tipe |');
  lines.push('|---|---:|---|---|---|');
  for (const v of dedupedNumeric.sort((a, b) => a.file.localeCompare(b.file) || a.lineNo - b.lineNo)) {
    lines.push(`| ${v.file} | ${v.lineNo} | ${v.collection} | \`${v.field}\` | ${v.type} |`);
  }
}
lines.push('');
lines.push(`## Tidak Bisa Diverifikasi (${dedupedUnresolved.length})`);
lines.push('');
lines.push('_Koleksi/relasi tidak terbaca dari Directus (403/tidak ada) — perlu verifikasi manual lewat proxy aplikasi._');
lines.push('');
if (dedupedUnresolved.length > 0) {
  lines.push('| File | Baris | Koleksi | Field Path | Alasan |');
  lines.push('|---|---:|---|---|---|');
  for (const v of dedupedUnresolved.sort((a, b) => a.file.localeCompare(b.file) || a.lineNo - b.lineNo)) {
    lines.push(`| ${v.file} | ${v.lineNo} | ${v.collection} | \`${v.fieldPath}\` | ${v.reason} |`);
  }
}
lines.push('');

mkdirSync(path.join(ROOT, 'docs', 'reports'), { recursive: true });
const outPath = path.join(ROOT, 'docs', 'reports', 'field-contract-audit.md');
writeFileSync(outPath, lines.join('\n'));

console.log(`File dipindai: ${scanned}`);
console.log(`Kolom hilang: ${dedupedViolations.length}`);
console.log(`Filter numerik pada string: ${dedupedNumeric.length}`);
console.log(`Tidak terverifikasi: ${dedupedUnresolved.length}`);
console.log(`Laporan: ${path.relative(ROOT, outPath)}`);

process.exit(dedupedViolations.length > 0 || dedupedNumeric.length > 0 ? 1 : 0);
