/**
 * Migration: populate projects.leader_id (FK to karyawan.id) from projects.leader (string name)
 *
 * Prerequisites:
 *   1. Add `leader_id` integer field on `projects` collection in Directus UI (M2O to karyawan)
 *   2. Set DIRECTUS_URL and DIRECTUS_ADMIN_TOKEN in .env or as env vars before running
 *
 * Run: node scripts/migrate-leader-to-fk.mjs [--dry-run]
 */

import 'dotenv/config';

const DIRECTUS_URL = process.env.DIRECTUS_URL || process.env.VITE_DIRECTUS_API_URL;
const ADMIN_TOKEN = process.env.DIRECTUS_ADMIN_TOKEN || process.env.VITE_DIRECTUS_TOKEN;
const DRY_RUN = process.argv.includes('--dry-run');

if (!DIRECTUS_URL || !ADMIN_TOKEN) {
  console.error('Missing DIRECTUS_URL or DIRECTUS_ADMIN_TOKEN env vars');
  process.exit(1);
}

async function directusFetch(path, options = {}) {
  const res = await fetch(`${DIRECTUS_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${ADMIN_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Directus ${options.method || 'GET'} ${path} → ${res.status}: ${body}`);
  }
  return res.json();
}

async function main() {
  console.log(DRY_RUN ? '[DRY RUN] No changes will be written.\n' : '[LIVE] Changes will be written.\n');

  // 1. Load all karyawan: id + nama_karyawan
  const karyawanResp = await directusFetch('/items/karyawan?fields=id,nama_karyawan&limit=-1');
  const karyawanList = karyawanResp.data;
  console.log(`Loaded ${karyawanList.length} karyawan records.`);

  // Build lookup: normalized name → id (lowercase, trimmed)
  const nameToId = new Map();
  for (const k of karyawanList) {
    if (k.nama_karyawan) {
      nameToId.set(k.nama_karyawan.toLowerCase().trim(), k.id);
    }
  }

  // 2. Load all projects: id + leader + leader_id
  const projectsResp = await directusFetch('/items/projects?fields=id,leader,leader_id&limit=-1');
  const projects = projectsResp.data;
  console.log(`Loaded ${projects.length} project records.\n`);

  let matched = 0;
  let skipped = 0;
  let notFound = 0;
  let alreadySet = 0;

  for (const project of projects) {
    if (project.leader_id) {
      alreadySet++;
      continue;
    }
    if (!project.leader) {
      skipped++;
      continue;
    }

    const leaderNameNorm = project.leader.toLowerCase().trim();
    const karyawanId = nameToId.get(leaderNameNorm);

    if (!karyawanId) {
      console.warn(`  [NOT FOUND] project ${project.id}: leader="${project.leader}" — no karyawan match`);
      notFound++;
      continue;
    }

    console.log(`  [PATCH] project ${project.id}: leader="${project.leader}" → leader_id=${karyawanId}`);
    matched++;

    if (!DRY_RUN) {
      await directusFetch(`/items/projects/${project.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ leader_id: karyawanId }),
      });
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`  Already had leader_id : ${alreadySet}`);
  console.log(`  Matched & updated     : ${matched}`);
  console.log(`  No leader string      : ${skipped}`);
  console.log(`  No karyawan match     : ${notFound}`);
  if (DRY_RUN) console.log('\n[DRY RUN] Rerun without --dry-run to apply changes.');
}

main().catch((e) => {
  console.error('Migration failed:', e);
  process.exit(1);
});
