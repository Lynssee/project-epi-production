#!/usr/bin/env node
/**
 * GSP-07 — bereskan SJ "lolos tapi belum shipped" hasil backfill Tracking SJ v2 (9 Sep 2026).
 *
 *   node scripts/gsp07-bereskan-backfill-gerbang.mjs            # DRY-RUN (default): hanya menampilkan rencana
 *   node scripts/gsp07-bereskan-backfill-gerbang.mjs --apply    # menulis (butuh izin Lead — lihat GSP-07 K2)
 *   opsi: --status shipped        (K1: status tujuan; default shipped, alternatif delivered)
 *         --kecuali 606,607       (id SJ yang TIDAK diubah, mis. yang belum terkirim fisik; dikonfirmasi admin logistik)
 *         --ekspor daftar.csv     (HANYA BACA: tulis daftar SJ ke CSV untuk dikonfirmasi admin logistik; tidak menulis ke Directus)
 *
 * Filter KETAT: security_verified_by = 'SYSTEM/BACKFILL' DAN status = 'needs_security_check'. Baris lain tidak disentuh.
 * Per baris: PATCH status + security_checklist (objek v2, teks lama disimpan di `catatan`).
 *   security_verified_at/by, track_*, draft_status TIDAK diubah.
 * Per baris: 1 baris process_event_log `gsp07_status_diselaraskan`.
 * Idempoten: dijalankan ulang → 0 baris (filter status sudah tidak cocok; PATCH juga CAS ke status lama).
 */
import { pathToFileURL } from 'node:url';

const STATUS_BOLEH = ['shipped', 'delivered'];

/** Murni: "606, 607,abc" → [606, 607]; nilai non-angka diabaikan. */
export function parseKecuali(str) {
  return [...new Set(String(str || '').split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0))];
}

/** Murni: satu sel CSV (dikutip bila mengandung kutip, titik koma, koma, atau baris baru). */
export const csvCell = (v) => {
  const t = v == null ? '' : String(v);
  return /[";,\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** Baca-saja: tulis CSV (UTF-8 BOM, separator ';', bisa dibuka di Excel) untuk dikonfirmasi admin logistik. */
async function eksporCsv(call, semua, path) {
  const { writeFileSync } = await import('node:fs');
  const unwrap = (v) => (v && typeof v === 'object' ? v.id : v);
  const uniq = (key) => [...new Set(semua.map((r) => unwrap(r[key])).filter(Boolean))];
  const baca = async (koleksi, ids, fields) => (ids.length ? (await call(`/items/${koleksi}?filter[id][_in]=${ids.join(',')}&fields=${fields}&limit=-1`)).data || [] : []);
  const [veh, cust, proj, items] = await Promise.all([
    baca('fleet_kendaraan', uniq('vehicle_id'), 'id,nomor_polisi'),
    baca('so_customer', uniq('so_customer_id'), 'id,customer_name'),
    baca('projects', uniq('project_id'), 'id,name'),
    call(`/items/surat_jalan_items?filter[surat_jalan_id][_in]=${semua.map((r) => r.id).join(',')}&fields=id,surat_jalan_id,nama_barang&limit=-1`).then((r) => r.data || [])
  ]);
  const plat = new Map(veh.map((x) => [String(x.id), x.nomor_polisi]));
  const cu = new Map(cust.map((x) => [String(x.id), x.customer_name]));
  const pr = new Map(proj.map((x) => [String(x.id), x.name]));
  const it = new Map();
  for (const x of items) { const k = String(unwrap(x.surat_jalan_id)); it.set(k, [...(it.get(k) || []), x.nama_barang]); }

  const head = ['id', 'nomor_sj', 'tanggal_dibuat', 'driver', 'plat', 'customer', 'proyek', 'tujuan', 'jumlah_barang', 'barang', 'SUDAH TERKIRIM? (Ya/Tidak)', 'bukti / catatan'];
  const lines = [head.map(csvCell).join(';')];
  for (const r of semua) {
    const b = it.get(String(r.id)) || [];
    lines.push([
      r.id, r.nomor_sj, String(r.date_created || '').slice(0, 10), r.driver, plat.get(String(unwrap(r.vehicle_id))),
      cu.get(String(unwrap(r.so_customer_id))), pr.get(String(unwrap(r.project_id))), r.delivery_address,
      b.length, b.slice(0, 5).join(' | ') + (b.length > 5 ? ' …' : ''), '', ''
    ].map(csvCell).join(';'));
  }
  writeFileSync(path, '﻿' + lines.join('\r\n') + '\r\n', 'utf8');
  console.log(`Ekspor ${semua.length} SJ → ${path} (separator ';', buka di Excel). TIDAK ada yang ditulis ke Directus.`);
}

/** Murni: bentuk security_checklist v2 dari baris backfill (teks lama → catatan). */
export function bentukChecklistBackfill(row) {
  const lama = row.security_checklist;
  const catatan = typeof lama === 'string' ? lama : lama == null ? null : JSON.stringify(lama);
  return {
    versi: 2, hasil: 'lolos', sumber: 'backfill', oleh_id: null, oleh_nama: 'SYSTEM/BACKFILL',
    waktu: row.security_verified_at || null,
    jumlah_ok: null, plat_ok: null, driver_ok: null,
    catatan, riwayat: []
  };
}

/** Murni: payload PATCH satu baris. */
export function bentukPatch(row, statusTujuan) {
  return { status: statusTujuan, security_checklist: bentukChecklistBackfill(row) };
}

async function main() {
  try { process.loadEnvFile('.env'); } catch { /* env bisa dari shell */ }
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const iS = argv.indexOf('--status');
  const statusTujuan = iS >= 0 ? argv[iS + 1] : 'shipped';
  if (!STATUS_BOLEH.includes(statusTujuan)) { console.error(`--status harus salah satu: ${STATUS_BOLEH.join(', ')}`); process.exit(2); }

  const iK = argv.indexOf('--kecuali');
  const kecuali = iK >= 0 ? parseKecuali(argv[iK + 1]) : [];
  if (iK >= 0 && kecuali.length === 0) { console.error('--kecuali butuh daftar id, mis. --kecuali 606,607'); process.exit(2); }
  const iE = argv.indexOf('--ekspor');
  const eksporPath = iE >= 0 ? argv[iE + 1] : null;
  if (iE >= 0 && !eksporPath) { console.error('--ekspor butuh nama berkas, mis. --ekspor daftar.csv'); process.exit(2); }

  const URL_ = (process.env.DIRECTUS_API_URL || process.env.VITE_DIRECTUS_API_URL || '').replace(/\/$/, '');
  const TOKEN = process.env.DIRECTUS_TOKEN || process.env.VITE_DIRECTUS_TOKEN;
  if (!URL_ || !TOKEN) { console.error('DIRECTUS_API_URL / DIRECTUS_TOKEN tidak ada di env (.env).'); process.exit(2); }

  const call = async (path, init = {}) => {
    const r = await fetch(`${URL_}${path}`, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } });
    const t = await r.text();
    if (!r.ok) throw new Error(`${init.method || 'GET'} ${path} → ${r.status} ${t.slice(0, 200)}`);
    return t ? JSON.parse(t) : {};
  };

  const filter = `filter[security_verified_by][_eq]=${encodeURIComponent('SYSTEM/BACKFILL')}&filter[status][_eq]=needs_security_check`;
  const semua = (await call(`/items/surat_jalan?${filter}&fields=id,nomor_sj,status,track_stage,security_verified_at,security_checklist,driver,vehicle_id,delivery_address,date_created,so_customer_id,project_id&sort=id&limit=-1`)).data || [];

  if (eksporPath) {
    await eksporCsv(call, semua, eksporPath);
    return;
  }
  const rows = semua.filter((r) => !kecuali.includes(r.id));
  const tidakDikenal = kecuali.filter((id) => !semua.some((r) => r.id === id));
  if (tidakDikenal.length) console.warn(`PERINGATAN: id berikut bukan bagian dari SJ backfill (diabaikan): ${tidakDikenal.join(', ')}`);

  console.log(`\nGSP-07 — ${apply ? 'APPLY' : 'DRY-RUN'} — status tujuan: ${statusTujuan}`);
  console.log(`Ditemukan ${semua.length} SJ (SYSTEM/BACKFILL + needs_security_check); dikecualikan ${semua.length - rows.length}; diproses ${rows.length}\n`);
  for (const r of rows) {
    console.log(`  #${String(r.id).padEnd(5)} ${String(r.nomor_sj).padEnd(34)} ${r.status} → ${statusTujuan}   track_stage=${r.track_stage ?? '-'}`);
  }
  if (!apply) {
    console.log(`\nDry-run: TIDAK ada yang ditulis. Jalankan dengan --apply (izin Lead) untuk menerapkan.`);
    return;
  }

  let diubah = 0, dilewati = 0, gagal = 0;
  for (const r of rows) {
    try {
      // CAS: hanya berlaku bila status MASIH needs_security_check (anti-balapan & idempoten).
      const res = await call(`/items/surat_jalan?filter[id][_eq]=${r.id}&filter[status][_eq]=needs_security_check&filter[security_verified_by][_eq]=${encodeURIComponent('SYSTEM/BACKFILL')}`, {
        method: 'PATCH', body: JSON.stringify(bentukPatch(r, statusTujuan))
      });
      if (!Array.isArray(res.data) || res.data.length === 0) { dilewati++; console.log(`  #${r.id} dilewati (status sudah berubah)`); continue; }
      await call('/items/process_event_log', {
        method: 'POST',
        body: JSON.stringify({
          process_code: 'SURAT_JALAN', instance_id: String(r.id), instance_ref: `surat_jalan:${r.id}`,
          stage_key: 'gsp07_status_diselaraskan', event_ts: new Date().toISOString(), source: 'live',
          meta: { dari: 'needs_security_check', ke: statusTujuan, alasan: 'backfill 9 Sep lupa status' }
        })
      }).catch((e) => console.error(`  #${r.id} status OK, process_event_log gagal:`, e.message));
      diubah++;
    } catch (e) {
      gagal++;
      console.error(`  #${r.id} GAGAL:`, e.message);
    }
  }
  console.log(`\nRingkas: diubah=${diubah} dilewati=${dilewati} gagal=${gagal}`);
  process.exit(gagal ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error('Gagal:', e.message); process.exit(2); });
}
