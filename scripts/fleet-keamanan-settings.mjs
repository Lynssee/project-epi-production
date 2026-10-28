/**
 * Data konfigurasi Peminjaman 12 — jendela waktu P2H sebelum pakai (BARIS DATA fleet_settings):
 *   p2h_jendela_jam_sebelum  3      P2H "sebelum pakai" hanya sah maksimal N jam sebelum jadwal berangkat
 *   p2h_jendela_mode         soft   off | soft | hard  (soft = diterima + tanda [P2H_TERLALU_AWAL]; hard = ditolak)
 * Tanpa skrip pun kode jalan (default 3 jam, soft). Skrip membuatnya tampil di ERP → Fleet → Pengaturan.
 * Idempoten (tidak menimpa yang ada), dry-run default.
 *   node scripts/fleet-keamanan-settings.mjs            (dry-run)
 *   node scripts/fleet-keamanan-settings.mjs --apply
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

const SETTINGS = [
  {
    key: 'p2h_jendela_jam_sebelum', value: 3, label: 'P2H: Jendela Sebelum Berangkat (jam)', category: 'operasional',
    value_type: 'number', min: 1, max: 48, editable_by: 'SuperAdmin,Admin Plant',
    description: 'Peminjaman 12: P2H "sebelum pakai" hanya sah maksimal N jam sebelum jadwal berangkat. Mencegah P2H dikirim berhari-hari sebelumnya (status langsung aktif, unit terkunci lebih awal).'
  },
  {
    key: 'p2h_jendela_mode', value: 'soft', label: 'P2H: Mode Jendela (off / soft / hard)', category: 'operasional',
    value_type: 'string', editable_by: 'SuperAdmin',
    description: "Peminjaman 12: 'off' = tidak diperiksa. 'soft' = P2H terlalu awal tetap diterima tetapi ditandai [P2H_TERLALU_AWAL] di catatan. 'hard' = ditolak dengan pesan jam jadwal. Mulai 'soft'; naikkan ke 'hard' setelah ±1 minggu tanpa keluhan."
  }
];

console.log(`\n=== Setting Peminjaman 12 (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);
for (const s of SETTINGS) {
  const r = await req('GET', `/items/fleet_settings?filter[key][_eq]=${s.key}&fields=key,value&limit=1`);
  if (!r.ok) {
    console.error(`❌ baca fleet_settings: HTTP ${r.status}`);
    process.exit(1);
  }
  if (r.json.data?.[0]) {
    console.log(`✔ ${s.key} sudah ada (${JSON.stringify(r.json.data[0].value)}), tidak ditimpa.`);
    continue;
  }
  console.log(`  ${APPLY ? '🧩' : '🔎 [dry-run]'} buat ${s.key} = ${JSON.stringify(s.value)}`);
  if (APPLY) {
    const c = await req('POST', '/items/fleet_settings', s);
    if (!c.ok) {
      console.error(`❌ buat ${s.key}: HTTP ${c.status} ${c.json.errors?.[0]?.message || ''}`);
      process.exit(1);
    }
  }
}
console.log(`\n${APPLY ? '✅  Selesai.' : 'ℹ️   Dry-run selesai. Jalankan dengan --apply untuk membuat yang belum ada.'}\n`);
