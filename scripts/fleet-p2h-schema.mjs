/**
 * Skema Peminjaman 08 (P2H) — data konfigurasi & field baru.
 *
 *   fleet_vehicle_check.client_txn_id   string(64), nullable, UNIQUE, indexed  (idempotensi kirim P2H dari HP)
 *   fleet_vehicle_check.foto_dashboard  uuid (file → directus_files), nullable (foto KM terpisah dari foto kerusakan)
 *   fleet_settings  p2h_foto_dashboard_mode = 'soft'  (off | soft | hard)
 *   fleet_settings  p2h_toleransi_km        = 50
 *
 * WAJIB dijalankan SEBELUM deploy kode 08: kolom yang belum ada dibalas Directus sebagai 403 (Aturan #1).
 * Kode 08 sengaja tahan: bila lookup client_txn_id gagal ia jalan tanpa idempotensi & tanpa menulis foto_dashboard,
 * tetapi fitur intinya baru penuh setelah skema ini ada.
 *
 * Idempoten & aman: dry-run default; field/setting yang sudah ada TIDAK ditimpa (hanya diperiksa).
 *   node scripts/fleet-p2h-schema.mjs            (dry-run)
 *   node scripts/fleet-p2h-schema.mjs --apply    (buat yang belum ada, lalu verifikasi)
 */
import 'dotenv/config';

const API_URL = (process.env.DIRECTUS_API_URL || process.env.VITE_DIRECTUS_API_URL || '').replace(/\/$/, '');
const TOKEN = process.env.DIRECTUS_TOKEN || process.env.VITE_DIRECTUS_TOKEN;
const APPLY = process.argv.includes('--apply');
const CHECK = 'fleet_vehicle_check';

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
const must = (r, what) => {
  if (!r.ok) throw new Error(`${what}: HTTP ${r.status} ${r.json.errors?.[0]?.message || ''}`);
  return r.json;
};
const log = (msg) => console.log(`  ${APPLY ? '🧩' : '🔎 [dry-run]'} ${msg}`);
let problems = 0;

async function fieldList(collection) {
  return must(await req('GET', `/fields/${collection}`), `baca skema ${collection}`).data || [];
}

async function ensureFields() {
  const existing = await fieldList(CHECK);
  const byName = new Map(existing.map((f) => [f.field, f]));

  // --- client_txn_id
  const txn = byName.get('client_txn_id');
  if (txn) {
    const s = txn.schema || {};
    const bad = [];
    if (txn.type !== 'string') bad.push(`tipe ${txn.type}`);
    if (s.max_length !== 64) bad.push(`max_length ${s.max_length}`);
    if (s.is_nullable === false) bad.push('NOT NULL');
    if (!s.is_unique) bad.push('tidak UNIQUE');
    if (bad.length) { console.log(`⚠ ${CHECK}.client_txn_id ada tapi tidak sesuai: ${bad.join(', ')} (tidak ditimpa)`); problems++; }
    else console.log(`✔ ${CHECK}.client_txn_id sudah ada & sesuai.`);
  } else {
    log(`buat ${CHECK}.client_txn_id: string(64), nullable, UNIQUE, indexed`);
    if (APPLY) {
      must(await req('POST', `/fields/${CHECK}`, {
        field: 'client_txn_id', type: 'string',
        schema: { max_length: 64, is_nullable: true, is_unique: true, is_indexed: true, default_value: null },
        meta: { interface: 'input', readonly: true, hidden: false, width: 'half',
          note: 'Peminjaman 08: kunci idempotensi kirim P2H dari HP (UUID dari klien). NULL untuk data lama.' }
      }), 'buat client_txn_id');
    }
  }

  // --- foto_dashboard (file)
  const fd = byName.get('foto_dashboard');
  if (fd) {
    if (fd.type !== 'uuid') { console.log(`⚠ ${CHECK}.foto_dashboard ada tapi tipe ${fd.type} (harus uuid)`); problems++; }
    else console.log(`✔ ${CHECK}.foto_dashboard sudah ada.`);
  } else {
    log(`buat ${CHECK}.foto_dashboard: uuid (file → directus_files), nullable`);
    if (APPLY) {
      must(await req('POST', `/fields/${CHECK}`, {
        field: 'foto_dashboard', type: 'uuid',
        schema: { is_nullable: true, default_value: null },
        meta: { interface: 'file-image', special: ['file'], width: 'half',
          note: 'Peminjaman 08: foto dashboard (angka KM & jarum bensin) — terpisah dari foto kerusakan (foto).' }
      }), 'buat foto_dashboard');
      const rel = await req('POST', '/relations', {
        collection: CHECK, field: 'foto_dashboard', related_collection: 'directus_files',
        schema: { on_delete: 'SET NULL' }
      });
      // relasi mungkin sudah otomatis dibuat oleh special:file — anggap OK bila sudah ada
      if (!rel.ok && !/already|exists|unique/i.test(rel.json.errors?.[0]?.message || '')) must(rel, 'buat relasi foto_dashboard');
    }
  }
}

const SETTINGS = [
  {
    key: 'p2h_foto_dashboard_mode', value: 'soft', label: 'P2H: Foto Dashboard (off / soft / hard)',
    category: 'operasional', value_type: 'string', editable_by: 'SuperAdmin',
    description: "Peminjaman 08: 'off' = tidak diperiksa. 'soft' = tanpa foto dashboard tetap lolos tetapi ditandai [TANPA_FOTO_DASHBOARD] di catatan P2H & rekonsiliasi. 'hard' = ditolak bila tanpa foto. Mulai 'soft'; naikkan ke 'hard' setelah ±1 minggu tanpa keluhan."
  },
  {
    key: 'p2h_toleransi_km', value: 50, label: 'P2H: Toleransi Selisih KM Sebelum Pakai (km)',
    category: 'operasional', value_type: 'number', min: 0, editable_by: 'SuperAdmin',
    description: 'Peminjaman 08: bila KM yang diketik peminjam lebih kecil dari KM terakhir unit dikurangi toleransi ini, P2H TIDAK diblokir — hanya ditandai [KM_ANOMALI] di catatan untuk rekonsiliasi.'
  }
];

async function ensureSettings() {
  for (const s of SETTINGS) {
    const r = await req('GET', `/items/fleet_settings?filter[key][_eq]=${s.key}&fields=key,value&limit=1`);
    if (!r.ok) throw new Error(`baca fleet_settings: HTTP ${r.status}`);
    if (r.json.data?.[0]) { console.log(`✔ fleet_settings.${s.key} sudah ada (nilai ${JSON.stringify(r.json.data[0].value)}), tidak ditimpa.`); continue; }
    log(`buat fleet_settings.${s.key} = ${JSON.stringify(s.value)}`);
    if (APPLY) must(await req('POST', '/items/fleet_settings', s), `buat setting ${s.key}`);
  }
}

async function verify() {
  const list = await fieldList(CHECK);
  for (const f of ['client_txn_id', 'foto_dashboard']) {
    if (!list.some((x) => x.field === f)) { console.log(`❌ ${CHECK}.${f} TIDAK ditemukan setelah apply`); problems++; }
  }
  const probe = await req('GET', `/items/${CHECK}?filter[client_txn_id][_eq]=__probe__&fields=id,foto_dashboard&limit=1`);
  if (!probe.ok) { console.log(`❌ probe filter/field baru gagal (HTTP ${probe.status}) — cek permission field role token`); problems++; }
  else console.log('✔ probe kolom baru → 200.');
}

async function main() {
  console.log(`\n=== Skema P2H Peminjaman 08 (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);
  await ensureFields();
  await ensureSettings();
  if (APPLY) await verify();
  if (problems) { console.log(`\n⚠ ${problems} masalah — periksa manual.\n`); process.exitCode = 2; return; }
  console.log(`\n${APPLY ? '✅  Selesai & terverifikasi.' : 'ℹ️   Dry-run selesai. Jalankan dengan --apply untuk membuat yang belum ada.'}\n`);
}
main().catch((e) => { console.error('❌ ', e.message); process.exit(1); });
