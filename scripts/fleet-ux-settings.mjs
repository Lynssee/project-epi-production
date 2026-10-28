/**
 * Data konfigurasi Peminjaman 11 — label zona dari konfigurasi (BARIS DATA fleet_settings, bukan kolom):
 *   label_zona_dalam_kota  "Dalam Kota (Jabodetabek)"
 *   label_zona_luar_kota   "Luar Kota"
 * Kode zona di data tetap `dalam_kota` / `luar_kota`; hanya tulisan di form yang bisa diubah admin.
 * Tanpa skrip pun kode jalan (default di kode); skrip membuat baris supaya tampil di ERP → Fleet → Pengaturan.
 * Idempoten (tidak menimpa yang ada), dry-run default.
 *   node scripts/fleet-ux-settings.mjs            (dry-run)
 *   node scripts/fleet-ux-settings.mjs --apply
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
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

const SETTINGS = [
  { key: 'label_zona_dalam_kota', value: 'Dalam Kota (Jabodetabek)', label: 'Label Zona: Dalam Kota', category: 'operasional', value_type: 'string', editable_by: 'SuperAdmin,Admin Plant',
    description: 'Peminjaman 11: tulisan pilihan zona "dalam kota" di form pengajuan lapangan. Kode di data tetap dalam_kota.' },
  { key: 'label_zona_luar_kota', value: 'Luar Kota', label: 'Label Zona: Luar Kota', category: 'operasional', value_type: 'string', editable_by: 'SuperAdmin,Admin Plant',
    description: 'Peminjaman 11: tulisan pilihan zona "luar kota" di form pengajuan lapangan. Kode di data tetap luar_kota.' }
];

console.log(`\n=== Setting Peminjaman 11 (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);
for (const s of SETTINGS) {
  const r = await req('GET', `/items/fleet_settings?filter[key][_eq]=${s.key}&fields=key,value&limit=1`);
  if (!r.ok) { console.error(`❌ baca fleet_settings: HTTP ${r.status}`); process.exit(1); }
  if (r.json.data?.[0]) { console.log(`✔ ${s.key} sudah ada (${JSON.stringify(r.json.data[0].value)}), tidak ditimpa.`); continue; }
  console.log(`  ${APPLY ? '🧩' : '🔎 [dry-run]'} buat ${s.key} = ${JSON.stringify(s.value)}`);
  if (APPLY) {
    const c = await req('POST', '/items/fleet_settings', s);
    if (!c.ok) { console.error(`❌ buat ${s.key}: HTTP ${c.status} ${c.json.errors?.[0]?.message || ''}`); process.exit(1); }
  }
}
console.log(`\n${APPLY ? '✅  Selesai.' : 'ℹ️   Dry-run selesai. Jalankan dengan --apply untuk membuat yang belum ada.'}\n`);
