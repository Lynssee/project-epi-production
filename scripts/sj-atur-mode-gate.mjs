#!/usr/bin/env node
/**
 * Ubah MODE gate Surat Jalan (gate_enforcement) — SJ-02 (G_SJ_ALAMAT) dan SJ-03 (G_SJ_BARANG_BERMASALAH).
 * HANYA dijalankan setelah IZIN TERTULIS LEAD (@Lynssee / @joeeltama-oss). AI tidak boleh menjalankan --apply.
 *
 *   node scripts/sj-atur-mode-gate.mjs --gate G_SJ_BARANG_BERMASALAH --mode soft                      # DRY-RUN (default)
 *   node scripts/sj-atur-mode-gate.mjs --gate G_SJ_BARANG_BERMASALAH --mode hard --enforce-from 2026-10-22
 *   node scripts/sj-atur-mode-gate.mjs --gate G_SJ_ALAMAT --mode soft --apply --lead "Nama Lead" --izin "WA 8 Okt 2026 14:05"
 *
 * Aman: allow-list 2 gate; dry-run default; --apply WAJIB --lead dan --izin (tercatat di kolom note);
 *   mode `hard` tanpa --enforce-from butuh --tanpa-tenggang (Aturan #3: anti-lockdown retroaktif);
 *   nilai lama disimpan ke scratch/sj-gate-backup-<waktu>.json (untuk rollback); PATCH hanya satu baris.
 * Rollback: jalankan lagi dengan --mode <nilai lama> (lihat berkas backup). Cache server 5 menit.
 */
import { pathToFileURL } from 'node:url';

export const GATE_BOLEH = ['G_SJ_ALAMAT', 'G_SJ_BARANG_BERMASALAH'];
export const MODE_BOLEH = ['shadow', 'soft', 'hard'];

/** Murni: validasi argumen → { ok, error?, rencana? }. */
export function validasiArgumen(a, hariIni = new Date().toISOString().slice(0, 10)) {
  if (!GATE_BOLEH.includes(a.gate)) return { ok: false, error: `--gate harus salah satu: ${GATE_BOLEH.join(', ')}` };
  if (!MODE_BOLEH.includes(a.mode)) return { ok: false, error: `--mode harus salah satu: ${MODE_BOLEH.join(', ')}` };
  if (a.enforceFrom != null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.enforceFrom)) return { ok: false, error: '--enforce-from harus berformat YYYY-MM-DD' };
    if (a.mode !== 'hard') return { ok: false, error: '--enforce-from hanya bermakna untuk --mode hard (masa tenggang efektif shadow).' };
    if (a.enforceFrom <= hariIni) return { ok: false, error: `--enforce-from harus di MASA DEPAN (> ${hariIni}); tanggal lewat berarti langsung hard.` };
  }
  if (a.mode === 'hard' && !a.enforceFrom && !a.tanpaTenggang) {
    return { ok: false, error: 'Mode hard tanpa masa tenggang mengunci retroaktif (Aturan #3). Beri --enforce-from <tanggal ≥ 14 hari lagi>, atau --tanpa-tenggang bila Lead memang memutuskannya.' };
  }
  if (a.apply && (!a.lead || !a.izin)) return { ok: false, error: '--apply WAJIB disertai --lead "<nama Lead>" dan --izin "<bukti izin tertulis>".' };
  return { ok: true };
}

/** Murni: payload PATCH + catatan audit. */
export function bentukPatch(a, tanggal = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' })) {
  const note = `SJ mode-gate ${tanggal}: ${a.mode}${a.enforceFrom ? ` (efektif ${a.enforceFrom})` : ''} — disetujui ${a.lead || '<nama Lead>'}; izin: ${a.izin || '<bukti izin>'}`.slice(0, 500);
  return { mode: a.mode, enforce_from: a.mode === 'hard' ? a.enforceFrom || null : null, note };
}

export function parseArgv(argv) {
  const val = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  return {
    gate: val('--gate'), mode: val('--mode'), enforceFrom: val('--enforce-from'),
    lead: val('--lead'), izin: val('--izin'), apply: argv.includes('--apply'), tanpaTenggang: argv.includes('--tanpa-tenggang')
  };
}

async function main() {
  try { process.loadEnvFile('.env'); } catch { /* env bisa dari shell */ }
  const a = parseArgv(process.argv.slice(2));
  const v = validasiArgumen(a);
  if (!v.ok) { console.error(v.error); process.exit(2); }

  const URL_ = (process.env.DIRECTUS_API_URL || process.env.VITE_DIRECTUS_API_URL || '').replace(/\/$/, '');
  const TOKEN = process.env.DIRECTUS_TOKEN || process.env.VITE_DIRECTUS_TOKEN;
  if (!URL_ || !TOKEN) { console.error('DIRECTUS_API_URL / DIRECTUS_TOKEN tidak ada di env (.env).'); process.exit(2); }
  const call = async (path, init = {}) => {
    const r = await fetch(`${URL_}${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (!r.ok) throw new Error(`${init.method || 'GET'} ${path} → ${r.status} ${t.slice(0, 200)}`);
    return t ? JSON.parse(t) : {};
  };

  const rows = (await call(`/items/gate_enforcement?filter[gate_key][_eq]=${a.gate}&filter[jenis_pengajuan][_eq]=SJ&fields=id,gate_key,jenis_pengajuan,mode,enforce_from,note&limit=2`)).data || [];
  if (rows.length !== 1) { console.error(`Harus tepat 1 baris untuk ${a.gate}/SJ, ditemukan ${rows.length}. Dibatalkan.`); process.exit(2); }
  const row = rows[0];
  const patch = bentukPatch(a);

  console.log(`\nMode gate — ${a.apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`  ${a.gate} (id ${row.id})`);
  console.log(`  mode        : ${row.mode} → ${patch.mode}`);
  console.log(`  enforce_from: ${row.enforce_from ?? '-'} → ${patch.enforce_from ?? '-'}`);
  console.log(`  note        : ${patch.note}`);
  if (row.mode === patch.mode && (row.enforce_from ?? null) === patch.enforce_from) { console.log('\nTidak ada perubahan (sudah sama).'); return; }
  if (!a.apply) { console.log('\nDry-run: TIDAK ada yang ditulis. Tambahkan --apply --lead "…" --izin "…" setelah izin tertulis Lead.'); return; }

  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync('scratch', { recursive: true });
  const backup = `scratch/sj-gate-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(backup, JSON.stringify({ sebelum: row, patch }, null, 2));
  console.log(`  cadangan nilai lama → ${backup}`);

  await call(`/items/gate_enforcement/${row.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  const after = (await call(`/items/gate_enforcement/${row.id}?fields=mode,enforce_from`)).data;
  console.log(`\nSELESAI: ${a.gate} sekarang mode=${after.mode} enforce_from=${after.enforce_from ?? '-'} (berlaku ≤ 5 menit karena cache).`);
  console.log(`Rollback: node scripts/sj-atur-mode-gate.mjs --gate ${a.gate} --mode ${row.mode}${row.enforce_from ? ` --enforce-from ${row.enforce_from}` : row.mode === 'hard' ? ' --tanpa-tenggang' : ''} --apply --lead "<Lead>" --izin "rollback"`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error('Gagal:', e.message); process.exit(2); });
}
