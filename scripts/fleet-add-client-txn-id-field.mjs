/**
 * Skema Peminjaman 07 — tambah `fleet_bookings.client_txn_id` (kunci idempotensi submit dari HP).
 *
 * Spesifikasi (docs/(sales) fleet kendaraan/07 §4):
 *   collection : fleet_bookings
 *   field      : client_txn_id
 *   tipe       : string(64), NULLABLE, UNIQUE, indexed
 *   catatan    : baris lama tetap NULL (UNIQUE mengizinkan banyak NULL di MySQL/Postgres/SQLite).
 *
 * WAJIB dijalankan SEBELUM deploy kode 07 — server memfilter `client_txn_id`; kolom yang belum ada
 * dibalas Directus sebagai 403 (Aturan #1), sehingga POST pengajuan akan gagal total.
 *
 * Idempoten & aman: dry-run default; bila field sudah ada, hanya memeriksa spesifikasinya (tidak menimpa).
 *
 *   node scripts/fleet-add-client-txn-id-field.mjs            (dry-run: hanya cek & tampilkan rencana)
 *   node scripts/fleet-add-client-txn-id-field.mjs --apply    (buat field bila belum ada, lalu verifikasi)
 */
import 'dotenv/config';

const API_URL = (process.env.DIRECTUS_API_URL || process.env.VITE_DIRECTUS_API_URL || '').replace(/\/$/, '');
const TOKEN = process.env.DIRECTUS_TOKEN || process.env.VITE_DIRECTUS_TOKEN;
const APPLY = process.argv.includes('--apply');
const COLLECTION = 'fleet_bookings';
const FIELD = 'client_txn_id';

if (!API_URL || !TOKEN) {
  console.error('❌  DIRECTUS_API_URL / DIRECTUS_TOKEN belum di-set di .env');
  process.exit(1);
}
const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function req(method, path, body) {
  const res = await fetch(`${API_URL}${path}`, { method, headers: HEADERS, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

async function readField() {
  const r = await req('GET', `/fields/${COLLECTION}/${FIELD}`);
  if (r.ok) return r.json.data;
  // Directus membalas field yang tidak ada sebagai 403 (bukan 404) — bedakan dari masalah lain lewat daftar field.
  const all = await req('GET', `/fields/${COLLECTION}`);
  if (!all.ok) throw new Error(`Gagal membaca skema ${COLLECTION}: HTTP ${all.status} ${all.json.errors?.[0]?.message || ''}`);
  return (all.json.data || []).find((f) => f.field === FIELD) || null;
}

function checkSpec(f) {
  const s = f?.schema || {};
  const problems = [];
  if (f.type !== 'string') problems.push(`tipe ${f.type} (harus string)`);
  if (s.max_length !== 64) problems.push(`max_length ${s.max_length} (harus 64)`);
  if (s.is_nullable === false) problems.push('NOT NULL (harus nullable — baris lama NULL)');
  if (!s.is_unique) problems.push('tidak UNIQUE');
  return problems;
}

async function main() {
  console.log(`\n=== Skema ${COLLECTION}.${FIELD} (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);
  const existing = await readField();

  if (existing) {
    const problems = checkSpec(existing);
    if (!problems.length) {
      console.log('✔ Field sudah ada dan sesuai spesifikasi. Tidak ada yang dilakukan.');
    } else {
      console.log('⚠ Field sudah ada tetapi TIDAK sesuai spesifikasi:');
      problems.forEach((p) => console.log(`   - ${p}`));
      console.log('  Skrip TIDAK menimpa field yang ada. Perbaiki manual di Directus (Settings → Data Model).');
      process.exitCode = 2;
    }
    return;
  }

  console.log(`  ${APPLY ? '🧩' : '🔎 [dry-run]'} buat ${COLLECTION}.${FIELD}: string(64), nullable, UNIQUE, indexed`);
  if (!APPLY) {
    console.log('\nℹ️   Dry-run selesai. Jalankan dengan --apply untuk membuat field.\n');
    return;
  }

  const created = await req('POST', `/fields/${COLLECTION}`, {
    field: FIELD,
    type: 'string',
    schema: { max_length: 64, is_nullable: true, is_unique: true, is_indexed: true, default_value: null },
    meta: {
      interface: 'input',
      hidden: false,
      readonly: true,
      width: 'half',
      note: 'Peminjaman 07: kunci idempotensi submit dari HP (UUID dari klien). Kirim ulang dengan ID sama tidak membuat booking ganda. NULL untuk data lama.'
    }
  });
  if (!created.ok) throw new Error(`Gagal membuat field: HTTP ${created.status} ${created.json.errors?.[0]?.message || ''}`);

  // Verifikasi hasil nyata, bukan sekadar percaya respons POST.
  const after = await readField();
  if (!after) throw new Error('Field tidak ditemukan setelah dibuat — periksa Directus.');
  const problems = checkSpec(after);
  if (problems.length) {
    console.log('⚠ Field dibuat tetapi spesifikasi tidak sesuai:');
    problems.forEach((p) => console.log(`   - ${p}`));
    process.exitCode = 2;
    return;
  }

  // Uji baca: filter pada kolom baru harus dibalas 200 (bukan 403).
  const probe = await req('GET', `/items/${COLLECTION}?filter[${FIELD}][_eq]=__probe__&limit=1&fields=id`);
  if (!probe.ok) throw new Error(`Filter ${FIELD} gagal (HTTP ${probe.status}) — cek permission field untuk role token.`);
  console.log('✅  Field dibuat & terverifikasi (filter pada kolom baru → 200).\n');
}

main().catch((e) => {
  console.error('❌ ', e.message);
  process.exit(1);
});
