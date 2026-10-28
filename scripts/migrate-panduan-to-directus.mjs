/**
 * Migrasi data — §6 (implementation_plan_panduan + video generator.md, Fase 1):
 * baca panduan.ts (project-epi) → tulis ke koleksi Directus panduan_categories/
 * panduan_modules/panduan_steps/panduan_faq (SATU Directus yang sama dengan
 * erp-epi-1, dibedakan target_app='project-epi'). Koleksi dibuat oleh
 * erp-epi-1/src/lib/scripts/setup-panduan-directus-collections.js.
 *
 * project-epi TIDAK punya alurKerja/faqGlobal (beda dari erp-epi-1) — cukup
 * kategori + modul + langkah + faq per-modul.
 *
 * panduan.ts memakai sintaks TypeScript (interface, type import) yang tak
 * bisa langsung di-`import()` dari Node polos. Datanya sendiri (isi array
 * modulDokumentasi/kategoriModul) TIDAK mengandung sintaks TS apa pun (tak
 * ada `as`/generic di dalam literal) — jadi diambil sebagai teks lalu
 * dievaluasi literalnya saja, pola sama seperti
 * tools/tutorial-video-generator/lib/loadPanduan.mjs di erp-epi-1 membaca
 * LANGKAH_HREFS dari tours.js.
 *
 * TIDAK menyentuh panduan.ts maupun kode yang membacanya — app tetap jalan
 * dari data hardcoded seperti biasa.
 *
 * Jalankan dry-run (default, TIDAK mengubah apa pun):
 *   node --env-file=.env scripts/migrate-panduan-to-directus.mjs
 * Jalankan eksekusi nyata (create-only, lewati yang sudah ada by slug):
 *   node --env-file=.env scripts/migrate-panduan-to-directus.mjs --apply
 *
 * --sync-content (Fase 4, Rencana v2 Panduan Auto-Sync — menutup celah K1 di
 * project-epi juga, sebelumnya cuma erp-epi-1 yang punya mode ini) — UPSERT:
 * modul/langkah/FAQ yang sudah ada di-PATCH mengikuti isi panduan.ts saat ini,
 * termasuk field blocks (Lapis 1, blok visual) & refs (Lapis 2, kontrak
 * konten) yang sebelumnya TIDAK PERNAH ditulis oleh skrip ini sama sekali:
 *   node --env-file=.env scripts/migrate-panduan-to-directus.mjs --sync-content --apply
 *
 * (Paket `dotenv` tidak terpasang di project-epi — pakai flag native Node
 * `--env-file` alih-alih, bukan `import 'dotenv/config'` seperti di erp-epi-1.)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PANDUAN_PATH = path.resolve(__dirname, '../src/lib/data/panduan.ts');

const API_URL = process.env.DIRECTUS_URL || process.env.VITE_DIRECTUS_API_URL;
const TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || process.env.VITE_DIRECTUS_TOKEN;
const APPLY = process.argv.includes('--apply');
const SYNC = process.argv.includes('--sync-content');
const TARGET_APP = 'project-epi';

if (!API_URL || !TOKEN) {
  console.error('❌  DIRECTUS_URL/VITE_DIRECTUS_API_URL atau token belum di-set di .env');
  process.exit(1);
}

const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function request(method, p, body) {
  const res = await fetch(`${API_URL}${p}`, { method, headers: HEADERS, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(parsed?.errors?.[0]?.message || `${method} ${p} -> ${res.status}`);
  return parsed;
}

/**
 * step_key (Fase 5, Rencana v2 Panduan Auto-Sync erp-epi-1 — menutup celah K3
 * di kedua app, kolom sudah ada di panduan_steps sejak Fase 0/backfill-step-
 * key.js): slug ASCII dari judul langkah, dibuat unik per modul. project-epi
 * TIDAK punya href per-langkah (tours.ts selalu memakai modul.href — tidak
 * ada celah index seperti tours.js erp-epi-1), tapi kolomnya tetap diisi di
 * sini untuk PARITAS & jaga-jaga andai tours.ts nanti menambah href per
 * langkah (supaya kuncinya sudah stabil sejak awal, bukan ditambal belakangan).
 */
function slugifyStepKey(judul) {
  return String(judul || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'langkah';
}
function uniqueStepKey(judul, used) {
  const base = slugifyStepKey(judul);
  let key = base;
  let n = 2;
  while (used.has(key)) key = `${base}-${n++}`;
  used.add(key);
  return key;
}

/**
 * Cari index kurung penutup yang cocok dengan kurung pembuka di `openIndex`,
 * SADAR-STRING — melompati isi string/template literal (yang bisa saja
 * mengandung karakter `[`/`]` sebagai teks biasa, mis. instruksi langkah
 * "klik [Simpan]") supaya tidak salah hitung kedalaman kurung.
 */
function findMatchingBracket(src, openIndex) {
  const openChar = src[openIndex];
  const closeChar = openChar === '[' ? ']' : '}';
  let depth = 0;
  for (let i = openIndex; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++;
        i++;
      }
      continue;
    }
    if (c === openChar) depth++;
    else if (c === closeChar) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Ambil literal array top-level dari panduan.ts tanpa perlu compiler TS. */
async function extractArrayLiteral(varName) {
  const src = await fs.readFile(PANDUAN_PATH, 'utf8');
  const tanda = `${varName} = [`;
  const mulai = src.indexOf(tanda);
  if (mulai === -1) throw new Error(`Tidak menemukan "${tanda}" di panduan.ts`);
  // Mulai cari '[' pembuka SETELAH tanda, bukan dari `mulai` — varName sendiri
  // bisa mengandung '[' (mis. tipe "ModulPanduan[]"), yang salah tertangkap
  // sebagai kurung buka literal array kalau dicari dari `mulai`.
  const kb = mulai + tanda.length - 1;
  const akhir = findMatchingBracket(src, kb);
  if (akhir === -1) throw new Error(`Literal array "${varName}" tidak utuh`);
  return new Function(`return ${src.slice(kb, akhir + 1)};`)();
}

async function fetchAll(collection, fields, filterApp = true) {
  const q = filterApp ? `&filter[target_app][_eq]=${TARGET_APP}` : '';
  const res = await request('GET', `/items/${collection}?limit=-1&fields=${fields}${q}`);
  return res?.data || [];
}

async function main() {
  console.log(APPLY ? '🚨 MODE: APPLY (akan menulis ke Directus)' : 'ℹ️  MODE: DRY-RUN (tidak ada perubahan)');
  console.log(`Target app: ${TARGET_APP}${SYNC ? ' | --sync-content: yang sudah ada akan di-UPSERT' : ''}\n`);

  const kategoriModul = await extractArrayLiteral('export const kategoriModul');
  const modulDokumentasi = await extractArrayLiteral('export const modulDokumentasi: ModulPanduan[]');
  console.log(`Terbaca dari panduan.ts: ${kategoriModul.length} kategori, ${modulDokumentasi.length} modul\n`);

  // --- Categories ---
  const existingCats = await fetchAll('panduan_categories', 'id,slug,nama,emoji,urutan');
  const catBySlug = new Map(existingCats.map((c) => [c.slug, c]));
  let catCreated = 0, catSynced = 0;
  for (const [i, kat] of kategoriModul.entries()) {
    const existing = catBySlug.get(kat.id);
    if (existing) {
      if (SYNC) {
        catSynced++;
        if (APPLY) await request('PATCH', `/items/panduan_categories/${existing.id}`, { nama: kat.label, emoji: kat.emoji, urutan: i });
      }
      continue;
    }
    catCreated++;
    if (!APPLY) continue;
    await request('POST', '/items/panduan_categories', {
      slug: kat.id, nama: kat.label, emoji: kat.emoji, urutan: i, target_app: TARGET_APP, is_active: true
    });
  }
  console.log(`Kategori: ${catCreated} baru dari ${kategoriModul.length} (${existingCats.length} sudah ada)${SYNC ? `, ${catSynced} disinkron` : ''}`);

  // --- Modules + steps + faq ---
  const existingModules = await fetchAll('panduan_modules', 'id,slug,nama,kategori_slug,deskripsi,icon,href');
  const modBySlug = new Map(existingModules.map((m) => [m.slug, m]));
  const existingModuleIds = existingModules.map((m) => m.id);

  const existingSteps = existingModuleIds.length
    ? await request('GET', `/items/panduan_steps?limit=-1&fields=id,module_id,urutan,judul,isi,tips,blocks,step_key&filter[module_id][_in]=${existingModuleIds.join(',')}`).then((r) => r?.data || [])
    : [];
  const key = (moduleId, urutan) => `${moduleId}:${urutan}`;
  const stepByKey = new Map(existingSteps.map((s) => [key(s.module_id, s.urutan), s]));
  // step_key sudah dipakai per modul (termasuk yang di-backfill sebelumnya) — jaga keunikan saat generate baru.
  const usedStepKeyByModule = new Map();
  for (const s of existingSteps) {
    if (!s.step_key) continue;
    if (!usedStepKeyByModule.has(s.module_id)) usedStepKeyByModule.set(s.module_id, new Set());
    usedStepKeyByModule.get(s.module_id).add(s.step_key);
  }

  const existingFaq = existingModuleIds.length
    ? await request('GET', `/items/panduan_faq?limit=-1&fields=id,module_id,urutan,tanya,jawab&filter[module_id][_in]=${existingModuleIds.join(',')}`).then((r) => r?.data || [])
    : [];
  const faqByKey = new Map(existingFaq.map((f) => [key(f.module_id, f.urutan), f]));

  let modCreated = 0, modSynced = 0, stepCreated = 0, stepSynced = 0, faqCreated = 0, faqSynced = 0;
  for (const [i, m] of modulDokumentasi.entries()) {
    const existingModule = modBySlug.get(m.id);
    let moduleId = existingModule?.id;
    if (moduleId) {
      if (SYNC) {
        modSynced++;
        if (APPLY) {
          await request('PATCH', `/items/panduan_modules/${moduleId}`, {
            nama: m.nama, kategori_slug: m.kategori, deskripsi: m.deskripsi || '',
            icon: m.icon || '', href: m.href || '', urutan: i, refs: m.refs || null
          });
        }
      }
    } else {
      modCreated++;
      if (APPLY) {
        const created = await request('POST', '/items/panduan_modules', {
          slug: m.id, nama: m.nama, kategori_slug: m.kategori, deskripsi: m.deskripsi || '',
          icon: m.icon || '', href: m.href || '', target_app: TARGET_APP, urutan: i, status: 'published', refs: m.refs || null
        });
        moduleId = created?.data?.id;
      }
    }
    if (!moduleId) continue;

    for (const [si, langkah] of (m.langkah || []).entries()) {
      const existingStep = stepByKey.get(key(moduleId, si));
      if (existingStep) {
        if (SYNC) {
          stepSynced++;
          const patchBody = { judul: langkah.judul, isi: langkah.isi || '', tips: langkah.tips || '', blocks: langkah.blocks || null };
          // step_key tidak pernah ditimpa null — hanya diisi kalau baris Directusnya masih kosong.
          if (!existingStep.step_key) {
            const used = usedStepKeyByModule.get(moduleId) || new Set();
            patchBody.step_key = uniqueStepKey(langkah.judul, used);
            usedStepKeyByModule.set(moduleId, used);
          }
          if (APPLY) await request('PATCH', `/items/panduan_steps/${existingStep.id}`, patchBody);
        }
        continue;
      }
      stepCreated++;
      if (!APPLY) continue;
      const usedNew = usedStepKeyByModule.get(moduleId) || new Set();
      const stepKeyNew = uniqueStepKey(langkah.judul, usedNew);
      usedStepKeyByModule.set(moduleId, usedNew);
      await request('POST', '/items/panduan_steps', {
        module_id: moduleId, urutan: si, judul: langkah.judul, isi: langkah.isi || '', tips: langkah.tips || '', blocks: langkah.blocks || null,
        step_key: stepKeyNew
      });
    }
    for (const [fi, faq] of (m.faq || []).entries()) {
      const existingFaqRow = faqByKey.get(key(moduleId, fi));
      if (existingFaqRow) {
        if (SYNC) {
          faqSynced++;
          if (APPLY) await request('PATCH', `/items/panduan_faq/${existingFaqRow.id}`, { tanya: faq.tanya, jawab: faq.jawab || '' });
        }
        continue;
      }
      faqCreated++;
      if (!APPLY) continue;
      await request('POST', '/items/panduan_faq', {
        module_id: moduleId, urutan: fi, tanya: faq.tanya, jawab: faq.jawab || '', target_app: TARGET_APP
      });
    }
  }
  console.log(`Modul: ${modCreated} baru dari ${modulDokumentasi.length} (${existingModules.length} sudah ada)${SYNC ? `, ${modSynced} disinkron` : ''}`);
  if (!APPLY && modCreated > 0) {
    console.log(`  ⚠️  Dry-run: langkah & FAQ modul BARU tidak bisa dihitung akurat — jalankan --apply untuk angka pasti.`);
  }
  console.log(`Langkah: ${stepCreated} baru${SYNC ? `, ${stepSynced} disinkron` : ''}`);
  console.log(`FAQ per-modul: ${faqCreated} baru${SYNC ? `, ${faqSynced} disinkron` : ''}`);

  if (!APPLY) console.log('\nℹ️  Dry-run selesai. Jalankan ulang dengan --apply untuk eksekusi nyata.');
  else console.log('\n✅ Migrasi selesai.');
}

main().catch((err) => {
  console.error('\n❌ Error:', err.message);
  process.exit(1);
});
