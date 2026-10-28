#!/usr/bin/env node
/**
 * SJ-04 — bereskan SJ alur lama yang tertahan di antrean satpam (lahir langsung needs_security_check).
 *
 *   node scripts/sj04-bereskan-sj-lama-tertahan.mjs                       # DRY-RUN (default): hanya menampilkan rencana
 *   node scripts/sj04-bereskan-sj-lama-tertahan.mjs --ekspor daftar.csv   # HANYA BACA: CSV untuk dikonfirmasi admin logistik
 *   node scripts/sj04-bereskan-sj-lama-tertahan.mjs --apply --hanya 744,745   # menulis (izin Lead); --hanya WAJIB
 *   opsi: --status shipped|delivered   (K1; default shipped)
 *
 * Filter KETAT: status = needs_security_check DAN security_verified_at kosong DAN track_stage kosong.
 *   SJ alur baru (track_stage = dimuat) dan 27 SJ backfill (punya security_verified_at → GSP-07) tidak tersentuh.
 * TIDAK membatalkan SJ (stok sudah dipotong; pembatalan lewat ERP agar stok kembali).
 * Per baris: PATCH CAS → status + security_checklist v2 {hasil:'tidak_diperiksa', sumber:'rekonsiliasi'};
 *   security_verified_at/by sengaja tetap kosong (memang tidak diperiksa satpam).
 * Per baris: 1 baris process_event_log `sj04_status_diselaraskan`. Idempoten.
 */
import { pathToFileURL } from 'node:url';
import { csvCell } from './gsp07-bereskan-backfill-gerbang.mjs';

const STATUS_BOLEH = ['shipped', 'delivered'];

/** Murni: "744, 745,abc" → [744, 745]; nilai non-angka diabaikan. */
export function parseHanya(str) {
  return [...new Set(String(str || '').split(',').map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0))];
}

/** Murni: checklist v2 untuk SJ yang tidak pernah diperiksa satpam. */
export function bentukChecklistRekonsiliasi(row, waktu = new Date().toISOString()) {
  const lama = row.security_checklist;
  return {
    versi: 2, hasil: 'tidak_diperiksa', sumber: 'rekonsiliasi', oleh_id: null, oleh_nama: 'SYSTEM/SJ-04',
    waktu, jumlah_ok: null, plat_ok: null, driver_ok: null,
    catatan: typeof lama === 'string' ? lama : lama == null ? null : JSON.stringify(lama),
    riwayat: []
  };
}

/** Murni: payload PATCH satu baris. */
export function bentukPatch(row, statusTujuan, waktu) {
  return { status: statusTujuan, security_checklist: bentukChecklistRekonsiliasi(row, waktu) };
}

const FILTER =
  'filter[status][_eq]=needs_security_check&filter[security_verified_at][_null]=true&filter[track_stage][_null]=true';

async function eksporCsv(call, semua, path) {
  const { writeFileSync } = await import('node:fs');
  const unwrap = (v) => (v && typeof v === 'object' ? v.id : v);
  const uniq = (key) => [...new Set(semua.map((r) => unwrap(r[key])).filter(Boolean))];
  const baca = async (koleksi, ids, fields) => (ids.length ? (await call(`/items/${koleksi}?filter[id][_in]=${ids.join(',')}&fields=${fields}&limit=-1`)).data || [] : []);
  const [veh, cust, proj, items] = await Promise.all([
    baca('fleet_kendaraan', uniq('vehicle_id'), 'id,nomor_polisi'),
    baca('so_customer', uniq('so_customer_id'), 'id,customer_name'),
    baca('projects', uniq('project_id'), 'id,name'),
    semua.length
      ? call(`/items/surat_jalan_items?filter[surat_jalan_id][_in]=${semua.map((r) => r.id).join(',')}&fields=id,surat_jalan_id,nama_barang&limit=-1`).then((r) => r.data || [])
      : []
  ]);
  const plat = new Map(veh.map((x) => [String(x.id), x.nomor_polisi]));
  const cu = new Map(cust.map((x) => [String(x.id), x.customer_name]));
  const pr = new Map(proj.map((x) => [String(x.id), x.name]));
  const it = new Map();
  for (const x of items) { const k = String(unwrap(x.surat_jalan_id)); it.set(k, [...(it.get(k) || []), x.nama_barang]); }

  const head = ['id', 'nomor_sj', 'tanggal_dibuat', 'sudah_dicetak', 'driver', 'plat', 'customer', 'proyek', 'tujuan', 'jumlah_barang', 'barang', 'SUDAH TERKIRIM? (Ya/Tidak)', 'bukti / catatan'];
  const lines = [head.map(csvCell).join(';')];
  for (const r of semua) {
    const b = it.get(String(r.id)) || [];
    lines.push([
      r.id, r.nomor_sj, String(r.date_created || '').slice(0, 10), Number(r.print_count) > 0 ? 'Ya' : 'Tidak', r.driver,
      plat.get(String(unwrap(r.vehicle_id))), cu.get(String(unwrap(r.so_customer_id))), pr.get(String(unwrap(r.project_id))),
      r.delivery_address, b.length, b.slice(0, 5).join(' | ') + (b.length > 5 ? ' …' : ''), '', ''
    ].map(csvCell).join(';'));
  }
  writeFileSync(path, '﻿' + lines.join('\r\n') + '\r\n', 'utf8');
  console.log(`Ekspor ${semua.length} SJ → ${path} (separator ';', buka di Excel). TIDAK ada yang ditulis ke Directus.`);
}

async function main() {
  try { process.loadEnvFile('.env'); } catch { /* env bisa dari shell */ }
  const argv = process.argv.slice(2);
  const apply = argv.includes('--apply');
  const iS = argv.indexOf('--status');
  const statusTujuan = iS >= 0 ? argv[iS + 1] : 'shipped';
  if (!STATUS_BOLEH.includes(statusTujuan)) { console.error(`--status harus salah satu: ${STATUS_BOLEH.join(', ')}`); process.exit(2); }

  const iH = argv.indexOf('--hanya');
  const hanya = iH >= 0 ? parseHanya(argv[iH + 1]) : [];
  if (iH >= 0 && hanya.length === 0) { console.error('--hanya butuh daftar id, mis. --hanya 744,745'); process.exit(2); }
  if (apply && hanya.length === 0) { console.error('--apply WAJIB disertai --hanya <id,id> (hanya id yang dikonfirmasi "Ya"). Tidak ada apply massal.'); process.exit(2); }
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

  const semua = (await call(`/items/surat_jalan?${FILTER}&fields=id,nomor_sj,status,track_stage,security_verified_at,security_checklist,print_count,driver,vehicle_id,delivery_address,date_created,so_customer_id,project_id&sort=id&limit=-1`)).data || [];

  if (eksporPath) { await eksporCsv(call, semua, eksporPath); return; }

  const rows = hanya.length ? semua.filter((r) => hanya.includes(r.id)) : semua;
  const asing = hanya.filter((id) => !semua.some((r) => r.id === id));
  if (asing.length) console.warn(`PERINGATAN: id berikut bukan SJ alur lama tertahan (diabaikan): ${asing.join(', ')}`);

  const dicetak = semua.filter((r) => Number(r.print_count) > 0).length;
  console.log(`\nSJ-04 — ${apply ? 'APPLY' : 'DRY-RUN'} — status tujuan: ${statusTujuan}`);
  console.log(`Ditemukan ${semua.length} SJ (sudah dicetak: ${dicetak}, belum dicetak: ${semua.length - dicetak}); diproses ${apply ? rows.length : `${rows.length} (rencana)`}\n`);
  for (const r of rows) {
    console.log(`  #${String(r.id).padEnd(5)} ${String(r.nomor_sj).padEnd(34)} ${r.status} → ${statusTujuan}   dicetak=${Number(r.print_count) > 0 ? 'ya' : 'tidak'}`);
  }
  if (!apply) {
    console.log('\nDry-run: TIDAK ada yang ditulis. Ekspor CSV → konfirmasi admin logistik → --apply --hanya <id> (izin Lead).');
    return;
  }

  let diubah = 0, dilewati = 0, gagal = 0;
  for (const r of rows) {
    try {
      // CAS: hanya berlaku bila SJ MASIH tertahan persis seperti filter (anti-balapan & idempoten).
      const res = await call(`/items/surat_jalan?filter[id][_eq]=${r.id}&${FILTER}`, {
        method: 'PATCH', body: JSON.stringify(bentukPatch(r, statusTujuan))
      });
      if (!Array.isArray(res.data) || res.data.length === 0) { dilewati++; console.log(`  #${r.id} dilewati (status sudah berubah)`); continue; }
      await call('/items/process_event_log', {
        method: 'POST',
        body: JSON.stringify({
          process_code: 'SURAT_JALAN', instance_id: String(r.id), instance_ref: `surat_jalan:${r.id}`,
          stage_key: 'sj04_status_diselaraskan', event_ts: new Date().toISOString(), source: 'live',
          meta: { dari: 'needs_security_check', ke: statusTujuan, alasan: 'alur lama: status langsung needs_security_check, tak pernah lewat satpam' }
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
