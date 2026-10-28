/**
 * Skema Peminjaman 09 §3.6 (opsional, disarankan) — permintaan dispensasi check-in TERCATAT di booking.
 *   fleet_bookings.dispensasi_diminta_at      timestamp, nullable
 *   fleet_bookings.dispensasi_diminta_alasan  text, nullable
 *
 * Tanpa kolom ini kode 09 tetap jalan: endpoint request-checkin-dispensation melog error keras dan tetap kirim WA
 * (respons `tercatat:false`), tetapi badge "Minta dispensasi" di board ERP tidak akan muncul.
 *
 * Idempoten & aman: dry-run default; field yang sudah ada TIDAK ditimpa.
 *   node scripts/fleet-dispensasi-schema.mjs            (dry-run)
 *   node scripts/fleet-dispensasi-schema.mjs --apply    (buat yang belum ada, lalu verifikasi)
 */
import 'dotenv/config';

const API_URL = (process.env.DIRECTUS_API_URL || process.env.VITE_DIRECTUS_API_URL || '').replace(/\/$/, '');
const TOKEN = process.env.DIRECTUS_TOKEN || process.env.VITE_DIRECTUS_TOKEN;
const APPLY = process.argv.includes('--apply');
const COLLECTION = 'fleet_bookings';

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

const FIELDS = [
  {
    field: 'dispensasi_diminta_at', type: 'timestamp',
    meta: { interface: 'datetime', readonly: true, width: 'half', special: ['cast-timestamp'], note: 'Peminjaman 09: kapan peminjam meminta dispensasi check-in ke GA.' }
  },
  {
    field: 'dispensasi_diminta_alasan', type: 'text',
    meta: { interface: 'input-multiline', readonly: true, width: 'full', note: 'Peminjaman 09: alasan peminjam meminta dispensasi check-in.' }
  }
];

async function main() {
  console.log(`\n=== Skema ${COLLECTION} dispensasi (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);
  const list = await req('GET', `/fields/${COLLECTION}`);
  if (!list.ok) throw new Error(`baca skema ${COLLECTION}: HTTP ${list.status}`);
  const have = new Map((list.json.data || []).map((f) => [f.field, f]));
  let problems = 0;
  for (const f of FIELDS) {
    const ex = have.get(f.field);
    if (ex) {
      if (ex.type !== f.type) { console.log(`⚠ ${COLLECTION}.${f.field} ada tapi tipe ${ex.type} (harus ${f.type}) — tidak ditimpa`); problems++; }
      else console.log(`✔ ${COLLECTION}.${f.field} sudah ada.`);
      continue;
    }
    console.log(`  ${APPLY ? '🧩' : '🔎 [dry-run]'} buat ${COLLECTION}.${f.field}: ${f.type}, nullable`);
    if (APPLY) {
      const r = await req('POST', `/fields/${COLLECTION}`, { field: f.field, type: f.type, schema: { is_nullable: true, default_value: null }, meta: f.meta });
      if (!r.ok) throw new Error(`buat ${f.field}: HTTP ${r.status} ${r.json.errors?.[0]?.message || ''}`);
    }
  }
  if (APPLY) {
    const probe = await req('GET', `/items/${COLLECTION}?fields=id,dispensasi_diminta_at,dispensasi_diminta_alasan&limit=1`);
    if (!probe.ok) { console.log(`❌ probe kolom baru gagal (HTTP ${probe.status}) — cek permission field role token`); problems++; }
    else console.log('✔ probe kolom baru → 200.');
  }
  if (problems) { console.log(`\n⚠ ${problems} masalah — periksa manual.\n`); process.exitCode = 2; return; }
  console.log(`\n${APPLY ? '✅  Selesai & terverifikasi.' : 'ℹ️   Dry-run selesai. Jalankan dengan --apply untuk membuat yang belum ada.'}\n`);
}
main().catch((e) => { console.error('❌ ', e.message); process.exit(1); });
