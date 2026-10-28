/**
 * Data konfigurasi Peminjaman 05 — 3 key baru di fleet_settings (BARIS DATA, bukan kolom):
 *   kuota_dept_mode           'soft'  (off | soft | hard)
 *   auto_expire_diajukan_jam  6
 *   auto_expire_disetujui_jam 12
 *
 * Tidak wajib untuk menjalankan kode (semua punya default di kode), tetapi diperlukan supaya ketiganya muncul di
 * ERP → Fleet → Pengaturan (UI menampilkan baris dari DB) dan bisa diubah admin tanpa deploy.
 *
 * Idempoten: key yang sudah ada TIDAK ditimpa. Dry-run default.
 *   node scripts/fleet-kuota-settings.mjs            (dry-run)
 *   node scripts/fleet-kuota-settings.mjs --apply
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
  {
    key: 'kuota_dept_mode', value: 'soft', label: 'Kuota Departemen: Mode (off / soft / hard)',
    category: 'approval', value_type: 'string', editable_by: 'SuperAdmin',
    description: "Peminjaman 05: kuota dihitung per IRISAN JADWAL (unit yang dipakai divisi pada jam yang sama), bukan total antrean. 'off' = tidak dicek. 'soft' = pengajuan tetap diterima + peringatan + GA melihat badge \"Melebihi kuota dept\". 'hard' = ditolak (409) dengan menyebut booking penyebabnya. Mulai 'soft'; naikkan ke 'hard' setelah ±1 minggu tanpa keluhan. Batasnya = 'maks_peminjaman_bersamaan_per_dept'."
  },
  {
    key: 'auto_expire_diajukan_jam', value: 6, label: 'Auto-Batal: Diajukan Lewat Jadwal (jam)',
    category: 'approval', value_type: 'number', min: 1, editable_by: 'SuperAdmin',
    description: "Peminjaman 05: booking berstatus 'diajukan' yang jadwal berangkatnya sudah lewat lebih dari X jam otomatis dibatalkan (permintaan approval ikut dibatalkan). Otomasi baru aktif bila n8n memanggil /api/automation/fleet-scheduled-checks?type=auto_expire&dry=0 — awalnya dry-run."
  },
  {
    key: 'auto_expire_disetujui_jam', value: 12, label: 'Auto-Batal: Disetujui Tidak Dipakai (jam)',
    category: 'approval', value_type: 'number', min: 1, editable_by: 'SuperAdmin',
    description: "Peminjaman 05: booking 'disetujui' yang rencana selesainya sudah lewat lebih dari X jam DAN belum ada P2H 'sebelum' / check-in otomatis dibatalkan (dianggap tidak dipakai). Booking 'aktif' tidak pernah diubah otomatis."
  }
];

async function main() {
  console.log(`\n=== Setting Peminjaman 05 (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);
  for (const s of SETTINGS) {
    const r = await req('GET', `/items/fleet_settings?filter[key][_eq]=${s.key}&fields=key,value&limit=1`);
    if (!r.ok) throw new Error(`baca fleet_settings: HTTP ${r.status}`);
    if (r.json.data?.[0]) { console.log(`✔ ${s.key} sudah ada (nilai ${JSON.stringify(r.json.data[0].value)}), tidak ditimpa.`); continue; }
    console.log(`  ${APPLY ? '🧩' : '🔎 [dry-run]'} buat ${s.key} = ${JSON.stringify(s.value)}`);
    if (APPLY) {
      const c = await req('POST', '/items/fleet_settings', s);
      if (!c.ok) throw new Error(`buat ${s.key}: HTTP ${c.status} ${c.json.errors?.[0]?.message || ''}`);
    }
  }
  console.log(`\n${APPLY ? '✅  Selesai.' : 'ℹ️   Dry-run selesai. Jalankan dengan --apply untuk membuat yang belum ada.'}\n`);
}
main().catch((e) => { console.error('❌ ', e.message); process.exit(1); });
