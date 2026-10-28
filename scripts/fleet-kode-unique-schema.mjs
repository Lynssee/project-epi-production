/**
 * Skema Peminjaman 12 §2 — jadikan `fleet_bookings.kode_booking` UNIQUE + index.
 *
 * URUTAN DEPLOY WAJIB: (1) semua generator kode diganti (project-epi + erp-epi, format BK-YYMMDD-XXXXX + retry tabrakan)
 * → (2) duplikat lama dibereskan (skrip ini MENOLAK bila masih ada kode kembar dan mencetak daftarnya) → (3) baru `--apply`.
 * Bila unique dinyalakan sebelum kode baru ter-deploy, generator lama (3 digit, tabrakan sering) akan mulai gagal.
 *
 * Idempoten & aman: dry-run default; bila sudah unique → tidak melakukan apa-apa.
 *   node scripts/fleet-kode-unique-schema.mjs            (cek duplikat + rencana)
 *   node scripts/fleet-kode-unique-schema.mjs --apply    (hanya bila 0 duplikat)
 */
import 'dotenv/config';

const API_URL = (process.env.DIRECTUS_API_URL || process.env.VITE_DIRECTUS_API_URL || '').replace(/\/$/, '');
const TOKEN = process.env.DIRECTUS_TOKEN || process.env.VITE_DIRECTUS_TOKEN;
const APPLY = process.argv.includes('--apply');
if (!API_URL || !TOKEN) {
  console.error('❌  DIRECTUS_API_URL / DIRECTUS_TOKEN belum di-set di .env');
  process.exit(1);
}
const HEADERS = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
async function req(method, path, body) {
  const res = await fetch(`${API_URL}${path}`, { method, headers: HEADERS, body: body ? JSON.stringify(body) : undefined });
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
}

console.log(`\n=== fleet_bookings.kode_booking → UNIQUE (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);
const f = await req('GET', '/fields/fleet_bookings/kode_booking');
if (!f.ok) {
  console.error(`❌ baca field: HTTP ${f.status}`);
  process.exit(1);
}
if (f.json.data?.schema?.is_unique) {
  console.log('✔ kode_booking sudah UNIQUE. Tidak ada yang dilakukan.\n');
  process.exit(0);
}

const rows = await req('GET', '/items/fleet_bookings?fields=id,kode_booking,date_created,status&sort=date_created&limit=-1');
if (!rows.ok) {
  console.error(`❌ baca booking: HTTP ${rows.status}`);
  process.exit(1);
}
const byKode = new Map();
for (const r of rows.json.data || []) {
  const k = String(r.kode_booking ?? '');
  byKode.set(k, [...(byKode.get(k) || []), r]);
}
const kembar = [...byKode.entries()].filter(([k, v]) => k && v.length > 1);
const kosong = (byKode.get('') || []).length;
console.log(`Total booking: ${(rows.json.data || []).length} | kode kembar: ${kembar.length} | kode kosong: ${kosong}`);
for (const [k, v] of kembar) {
  console.log(`  ⚠ ${k} dipakai ${v.length}x: ${v.map((x) => `${x.id} (${x.status}, ${x.date_created})`).join(' | ')}`);
  console.log('     usulan: pertahankan yang tertua; yang lebih baru diberi sufiks -2, -3 (PATCH manual/skrip pembersih)');
}
if (kembar.length || kosong) {
  console.log('\n❌ Bereskan duplikat/kode kosong dulu. Unique TIDAK diterapkan.\n');
  process.exit(2);
}
console.log(`  ${APPLY ? '🧩' : '🔎 [dry-run]'} set kode_booking UNIQUE + index`);
if (APPLY) {
  const p = await req('PATCH', '/fields/fleet_bookings/kode_booking', { schema: { is_unique: true, is_indexed: true } });
  if (!p.ok) {
    console.error(`❌ gagal: HTTP ${p.status} ${p.json.errors?.[0]?.message || ''}`);
    process.exit(1);
  }
  const v = await req('GET', '/fields/fleet_bookings/kode_booking');
  console.log(v.json.data?.schema?.is_unique ? '✅ Terverifikasi: kode_booking UNIQUE.\n' : '⚠ PATCH berhasil tetapi is_unique belum terbaca — periksa di Directus.\n');
} else {
  console.log('\nℹ️   Dry-run selesai. Jalankan dengan --apply SETELAH kode baru ter-deploy di kedua repo.\n');
}
