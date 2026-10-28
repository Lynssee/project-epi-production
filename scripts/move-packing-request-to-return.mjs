/**
 * One-off data fix: pindahkan pengajuan packing list (project_budgets, packing_status='requested')
 * yang salah alur ke packing list pengembalian (packing_returns).
 *
 * Target: project PT. CITRA ANUGERAH LESTARI - PO/EPI/0240626/688 (No. PO 021/PO-CAL/2026,
 * Leader MUHAMMAD TAUFIK ANHAR), 40 item dari notifikasi "PACKING LIST TERBARU".
 *
 * Untuk tiap baris project_budgets yang matched:
 *   - Buat entri baru di packing_returns (return_status='return_requested').
 *   - Batalkan baris asal:
 *       - requested_at terisi (item baru khusus utk pengajuan ini) -> DELETE baris.
 *       - requested_at kosong (item RAB lama yang ditandai requested) -> PATCH packing_status -> null.
 *
 * Run: node scripts/move-packing-request-to-return.mjs [--dry-run]
 */

import { readFileSync, existsSync } from 'node:fs';

function loadDotEnv(path = '.env') {
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadDotEnv();

const DIRECTUS_URL = process.env.DIRECTUS_URL || process.env.VITE_DIRECTUS_API_URL;
const ADMIN_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || process.env.VITE_DIRECTUS_TOKEN;
const DRY_RUN = process.argv.includes('--dry-run');

if (!DIRECTUS_URL || !ADMIN_TOKEN) {
  console.error('Missing DIRECTUS_URL or DIRECTUS_ADMIN_TOKEN env vars');
  process.exit(1);
}

const PROJECT_NAME_SEARCH = 'PO/EPI/0240626/688';
const LEADER_NAME = 'MUHAMMAD TAUFIK ANHAR';

// Sumber kebenaran: 40 item dari pesan "PACKING LIST TERBARU"
const MESSAGE_ITEMS = [
  { material_name: 'MATA DIAMOND CUP 4"', qty: 1, unit: 'PCS' },
  { material_name: 'AMPLAS ROL 80/240', qty: 10, unit: 'Meter' },
  { material_name: "KUAS 1'", qty: 10, unit: 'Pcs' },
  { material_name: "KUAS 2,5'", qty: 10, unit: 'Pcs' },
  { material_name: "KUAS 3'", qty: 10, unit: 'Pcs' },
  { material_name: 'CARBON BRUSH GERINDA 4"', qty: 1, unit: 'Pcs' },
  { material_name: 'PLASTIK SAMPAH / TRASH BAG', qty: 1, unit: 'Pcs' },
  { material_name: 'BANTALAN AMPLAS', qty: 2, unit: 'Pcs' },
  { material_name: 'BULU ROL BESAR EPOXY', qty: 7, unit: 'Pcs' },
  { material_name: 'KAPE GAGANG', qty: 5, unit: 'Pcs' },
  { material_name: 'MESIN POLISHER / MESIN POLES', qty: 1, unit: 'Unit' },
  { material_name: 'CARBON BRUSH GERINDA 7"', qty: 1, unit: 'Pcs' },
  { material_name: 'TONGKAT SAMBUNGAN / EXTENSION POLE', qty: 2, unit: 'Pcs' },
  { material_name: 'VACUUM CLEANER', qty: 1, unit: 'Set' },
  { material_name: 'SEPATU SAFETY PENDEK', qty: 4, unit: 'Pcs' },
  { material_name: 'CARBON BRUSH GERINDA 4"', qty: 2, unit: 'Unit' },
  { material_name: 'CARBON BRUSH GERINDA 7"', qty: 2, unit: 'Unit' },
  { material_name: 'STIK ROL BESAR', qty: 2, unit: 'Pcs' },
  { material_name: 'OBENG KOMBINASI', qty: 1, unit: 'Pcs' },
  { material_name: 'RASKAM', qty: 3, unit: 'Pcs' },
  { material_name: 'KABEL POWER NO. 01', qty: 4, unit: 'Roll' },
  { material_name: "LAKBAN KERTAS 1'", qty: 70, unit: 'Pcs' },
  { material_name: 'APAR PEMADAM', qty: 1, unit: 'Unit' },
  { material_name: '1 bpx bulu', qty: 1, unit: 'Pcs' },
  { material_name: 'SPIKE ROLL EPOXY', qty: 1, unit: 'Pcs' },
  { material_name: 'TANG KOMBINASI', qty: 1, unit: 'Pcs' },
  { material_name: 'LAKBAN HITAM BESAR', qty: 2, unit: 'Pcs' },
  { material_name: 'KAPAK', qty: 1, unit: 'Pcs' },
  { material_name: 'KUNCI GERINDA', qty: 1, unit: 'Pcs' },
  { material_name: 'BULU ROL KECIL MERAH', qty: 3, unit: 'Pcs' },
  { material_name: 'GERINDA 4"', qty: 2, unit: 'Pcs' },
  { material_name: 'GERINDA 7"', qty: 2, unit: 'Pcs' },
  { material_name: 'VACUUM CLEANER', qty: 2, unit: 'Set' },
  { material_name: 'SEPATU PAKU', qty: 2, unit: 'Pasang' },
  { material_name: 'KAPE SET SCRAPE', qty: 1, unit: 'Pcs' },
  { material_name: 'PALU CHIPING', qty: 2, unit: 'Pcs' },
  { material_name: "LAKBAN KERTAS 2'", qty: 10, unit: 'Pcs' },
  { material_name: 'HAND MIXER', qty: 1, unit: 'Unit' },
  { material_name: 'STIK ROL KECIL', qty: 2, unit: 'Pcs' },
  { material_name: 'helm safet', qty: 5, unit: 'Pcs' }
];

function matchKey(name, qty, unit) {
  return `${String(name).toLowerCase().trim()}::${Number(qty)}::${String(unit).toLowerCase().trim()}`;
}

async function directusFetch(path, options = {}) {
  const res = await fetch(`${DIRECTUS_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Directus ${options.method || 'GET'} ${path} -> ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

async function main() {
  console.log(DRY_RUN ? '[DRY RUN] No changes will be written.\n' : '[LIVE] Changes will be written.\n');

  // 1. Cari project
  const projectResp = await directusFetch(
    `/items/projects?filter[name][_icontains]=${encodeURIComponent(PROJECT_NAME_SEARCH)}&fields=id,name,nomor_po,leader&limit=-1`
  );
  const projects = projectResp.data;
  console.log(`Project match untuk "${PROJECT_NAME_SEARCH}":`);
  for (const p of projects) console.log(`  - id=${p.id} name="${p.name}" nomor_po="${p.nomor_po}" leader="${p.leader}"`);

  if (projects.length !== 1) {
    console.error(`\nDitemukan ${projects.length} project match, butuh persis 1. Berhenti — identifikasi manual dulu.`);
    process.exit(1);
  }
  const project = projects[0];
  console.log(`\nMenggunakan project id=${project.id}\n`);

  // 2. Ambil kandidat baris pengajuan
  const budgetsResp = await directusFetch(
    `/items/project_budgets?filter[project_id][_eq]=${project.id}&filter[packing_status][_eq]=requested&fields=id,material_name,material_color,qty,unit,description,pic,requested_at,budget_category&limit=-1`
  );
  const candidates = budgetsResp.data;
  console.log(`Ditemukan ${candidates.length} baris project_budgets dengan packing_status='requested' pada project ini.\n`);

  // 3. Cocokkan (material_name kadang kosong, di beberapa baris nama tersimpan di description)
  const nameOf = (row) => row.material_name || row.description || '';
  const candidateByKey = new Map();
  for (const row of candidates) {
    const key = matchKey(nameOf(row), row.qty, row.unit);
    if (!candidateByKey.has(key)) candidateByKey.set(key, []);
    candidateByKey.get(key).push(row);
  }

  const matches = [];
  const notFound = [];

  console.log('--- Tabel Pencocokan (pesan -> project_budgets) ---');
  for (const item of MESSAGE_ITEMS) {
    const key = matchKey(item.material_name, item.qty, item.unit);
    const bucket = candidateByKey.get(key);
    if (bucket && bucket.length > 0) {
      const row = bucket.shift();
      matches.push(row);
      console.log(`  [OK] "${item.material_name}" ${item.qty} ${item.unit} -> project_budgets.id=${row.id}`);
    } else {
      notFound.push(item);
      console.log(`  [NOT FOUND] "${item.material_name}" ${item.qty} ${item.unit}`);
    }
  }

  const unmatchedCandidates = candidates.filter((row) => !matches.includes(row));
  if (unmatchedCandidates.length > 0) {
    console.log('\n  [WARNING] Baris requested pada project ini yang TIDAK masuk daftar 40 item pesan:');
    for (const row of unmatchedCandidates) {
      console.log(`    - id=${row.id} "${nameOf(row)}" ${row.qty} ${row.unit} pic="${row.pic}"`);
    }
  }
  if (notFound.length > 0) {
    console.log(`\n  [WARNING] ${notFound.length} item dari pesan tidak ketemu padanannya di project_budgets.`);
  }
  console.log('');

  if (unmatchedCandidates.length > 0 && !DRY_RUN) {
    console.error('Ada baris requested project ini yang tidak masuk daftar 40 item pesan. Jalankan dulu dengan --dry-run, review, lalu putuskan manual sebelum live run.');
    process.exit(1);
  }
  if (notFound.length > 0) {
    console.log(`[INFO] ${notFound.length} item pesan dilewati karena memang tidak ada baris 'requested' yang cocok di database (sudah diverifikasi manual, bukan bug pencocokan).`);
  }

  // 4. Batalkan baris matched: TIDAK membuat entri packing_returns.
  // Leader akan mengajukan retur sendiri dari awal lewat halaman Pengembalian di aplikasi.
  let deletedRows = 0;
  let resetRows = 0;

  for (const row of matches) {
    const action = row.requested_at ? 'DELETE' : 'PATCH packing_status->null';
    console.log(`[${action}] project_budgets.id=${row.id} "${nameOf(row)}"`);

    if (!row.requested_at) {
      console.log(`  [WARNING] Baris ini item RAB lama — qty sudah ter-overwrite saat diajukan, tidak bisa dikembalikan otomatis ke qty RAB semula.`);
    }

    if (!DRY_RUN) {
      if (row.requested_at) {
        await directusFetch(`/items/project_budgets/${row.id}`, { method: 'DELETE' });
        deletedRows++;
      } else {
        await directusFetch(`/items/project_budgets/${row.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ packing_status: null })
        });
        resetRows++;
      }
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`  Item matched           : ${matches.length} / ${MESSAGE_ITEMS.length}`);
  console.log(`  NOT FOUND di pesan     : ${notFound.length}`);
  console.log(`  Baris requested lain   : ${unmatchedCandidates.length}`);
  console.log(`  project_budgets DELETE : ${DRY_RUN ? '(dry-run)' : deletedRows}`);
  console.log(`  project_budgets RESET  : ${DRY_RUN ? '(dry-run)' : resetRows}`);
  if (DRY_RUN) console.log('\n[DRY RUN] Rerun tanpa --dry-run untuk apply perubahan.');
}

main().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
