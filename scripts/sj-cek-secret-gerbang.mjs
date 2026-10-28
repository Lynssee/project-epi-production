#!/usr/bin/env node
/**
 * Cek GERBANG_PROXY_SECRET di .env erp-epi dan project-epi: terpasang? cukup panjang? SAMA persis?
 * HANYA BACA. Nilai secret TIDAK PERNAH dicetak (hanya ada/KOSONG, panjang, sama/BEDA).
 *
 *   node scripts/sj-cek-secret-gerbang.mjs
 *   node scripts/sj-cek-secret-gerbang.mjs --erp C:\Cloudflared\SvelteApps\erp-epi\.env --epi C:\Cloudflared\SvelteApps\project-epi\.env
 *
 * Keluar kode 0 bila lolos, 1 bila ada masalah, 2 bila berkas tak terbaca. Jalankan di server yang menyimpan kedua .env.
 * Membuat secret baru (jalankan sendiri, tempel ke kedua .env, JANGAN lewat chat/WA):
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const MIN_PANJANG = 32;
export const DEFAULT_ERP = 'C:\\Cloudflared\\SvelteApps\\erp-epi\\.env';
export const DEFAULT_EPI = 'C:\\Cloudflared\\SvelteApps\\project-epi\\.env';

/** Murni: ambil nilai KEY dari teks .env (abaikan komentar, kutip tunggal/ganda, spasi). */
export function ambilNilai(teksEnv, key = 'GERBANG_PROXY_SECRET') {
  let hasil = null;
  for (const baris of String(teksEnv ?? '').split(/\r?\n/)) {
    const m = baris.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || m[1] !== key) continue;
    let v = m[2].trim();
    const q = v[0];
    if ((q === '"' || q === "'") && v.indexOf(q, 1) > 0) v = v.slice(1, v.indexOf(q, 1)); // ambil sampai kutip penutup (abaikan komentar sesudahnya)
    else v = v.replace(/\s+#.*$/, '');
    hasil = v;
  }
  return hasil;
}

/** Murni: bandingkan dua nilai tanpa membocorkannya. */
export function bandingkan(erp, epi) {
  const status = (v) => (!v ? 'KOSONG' : v.length < MIN_PANJANG ? 'TERLALU-PENDEK' : 'ada');
  const masalah = [];
  const s1 = status(erp), s2 = status(epi);
  if (s1 !== 'ada') masalah.push(`erp-epi: ${s1}`);
  if (s2 !== 'ada') masalah.push(`project-epi: ${s2}`);
  const sama = !!erp && !!epi && erp === epi;
  if (erp && epi && !sama) masalah.push('nilai BEDA antara erp-epi dan project-epi');
  return { erp: { status: s1, panjang: erp?.length ?? 0 }, epi: { status: s2, panjang: epi?.length ?? 0 }, sama, masalah, ok: masalah.length === 0 };
}

function baca(path) {
  try { return readFileSync(path, 'utf8'); } catch (e) { console.error(`Tidak bisa membaca ${path}: ${e.code || e.message}`); process.exit(2); }
}

function main() {
  const argv = process.argv.slice(2);
  const val = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const pErp = val('--erp', DEFAULT_ERP), pEpi = val('--epi', DEFAULT_EPI);
  const r = bandingkan(ambilNilai(baca(pErp)), ambilNilai(baca(pEpi)));
  console.log('\nGERBANG_PROXY_SECRET (nilai tidak ditampilkan)');
  console.log(`  erp-epi     : ${r.erp.status} (panjang ${r.erp.panjang})`);
  console.log(`  project-epi : ${r.epi.status} (panjang ${r.epi.panjang})`);
  console.log(`  sama persis : ${r.sama ? 'YA' : 'TIDAK'}`);
  if (r.ok) console.log('\nLolos. Restart kedua proses bila nilai baru saja diubah.');
  else { console.log('\nMasalah:'); for (const m of r.masalah) console.log(`  - ${m}`); }
  process.exit(r.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) main();
