#!/usr/bin/env node
/**
 * Nyalakan / matikan saklar gerbang SJ penjualan (SJ-09 opsi C): app_settings module=logistik,
 * key=gerbang_penjualan_aktif. Alternatif dari ERP → Setelan → Logistik. Default MATI.
 * HANYA setelah izin tertulis Lead + kode SJ-09 sudah ter-deploy di kedua repo + GERBANG_PROXY_SECRET terpasang.
 *
 *   node scripts/sj-saklar-gerbang-penjualan.mjs --set aktif                    # DRY-RUN
 *   node scripts/sj-saklar-gerbang-penjualan.mjs --set aktif --apply --lead "Nama" --izin "bukti izin"
 *   node scripts/sj-saklar-gerbang-penjualan.mjs --set mati  --apply --lead "Nama" --izin "rollback"
 *
 * Berlaku ≤ 5 menit (cache setelan). Membuat baris bila belum ada; selain itu hanya PATCH setting_value.
 */
import { pathToFileURL } from 'node:url';

export const KEY = 'gerbang_penjualan_aktif';

/** Murni: validasi argumen. */
export function validasiArgumen(a) {
  if (!['aktif', 'mati'].includes(a.set)) return { ok: false, error: '--set harus "aktif" atau "mati"' };
  if (a.apply && (!a.lead || !a.izin)) return { ok: false, error: '--apply WAJIB disertai --lead "<nama Lead>" dan --izin "<bukti izin tertulis>".' };
  return { ok: true };
}

/** Murni: nilai tersimpan (string 'true'/'false', sama dengan baris boolean lain di app_settings). */
export const nilaiTersimpan = (set) => (set === 'aktif' ? 'true' : 'false');

/** Murni: payload pembuatan baris baru. */
export function barisBaru() {
  return {
    module: 'logistik', category: 'Gerbang Penjualan', setting_key: KEY, setting_type: 'boolean',
    label: 'Gerbang untuk Pengiriman Penjualan (SJ dari SO)',
    description: 'Aktif = SJ penjualan hari ini muncul di daftar "Pengiriman Penjualan" pada kiosk, app satpam, dan ERP; satpam hanya mencatat lolos/tahan, status SJ tidak berubah.'
  };
}

export function parseArgv(argv) {
  const val = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
  return { set: val('--set'), lead: val('--lead'), izin: val('--izin'), apply: argv.includes('--apply') };
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

  const row = (await call(`/items/app_settings?filter[module][_eq]=logistik&filter[setting_key][_eq]=${KEY}&fields=id,setting_value&limit=1`)).data?.[0] || null;
  const baru = nilaiTersimpan(a.set);
  console.log(`\nSaklar ${KEY} — ${a.apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`  sekarang: ${row ? row.setting_value : '(baris belum ada → dianggap mati)'}   →   ${baru}`);
  if (row && String(row.setting_value).toLowerCase() === baru) { console.log('\nTidak ada perubahan (sudah sama).'); return; }
  if (!a.apply) { console.log('\nDry-run: TIDAK ada yang ditulis. Tambahkan --apply --lead "…" --izin "…" setelah izin tertulis Lead.'); return; }

  if (row) await call(`/items/app_settings/${row.id}`, { method: 'PATCH', body: JSON.stringify({ setting_value: baru }) });
  else await call('/items/app_settings', { method: 'POST', body: JSON.stringify({ ...barisBaru(), setting_value: baru }) });
  console.log(`\nSELESAI: ${KEY} = ${baru} (oleh ${a.lead}; izin: ${a.izin}). Berlaku ≤ 5 menit.`);
  console.log(`Rollback: node scripts/sj-saklar-gerbang-penjualan.mjs --set ${a.set === 'aktif' ? 'mati' : 'aktif'} --apply --lead "<Lead>" --izin "rollback"`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error('Gagal:', e.message); process.exit(2); });
}
