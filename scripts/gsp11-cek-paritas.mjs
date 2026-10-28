// #!/usr/bin/env node
/**
 * GSP-11 — pembanding paritas Gerbang SJ (HANYA BACA, tidak menulis apa pun ke Directus).
 *
 *   node scripts/gsp11-cek-paritas.mjs --kiosk 801 --app 802 --erp 803 --aksi lolos|tahan [--sejak 2026-10-06T00:00:00Z]
 *
 * Untuk tiap SJ dibaca & dinormalkan: surat_jalan, scan_log, security_gate_goods_log, app_notifications,
 * process_event_log. Lalu dibandingkan per baris → SAMA/BEDA. Exit code 1 bila ada BEDA di luar pengecualian:
 *   - security_verified_by hanya dibandingkan prefix (KIOSK/ APP/ ERP/)
 *   - scan_log.source: kiosk / lapangan / admin (memang beda per layar)
 *   - nomor SJ & id SJ (identitas) tidak dibandingkan
 * Kunci security_checklist yang diabaikan: sumber, oleh_*, waktu, client_event_id, foto, gps (beda per aksi).
 *
 * Fungsi normalisasi diekspor supaya bisa diuji (lihat src/lib/server/gerbangSj/parity.test.ts bila ada).
 */
import { pathToFileURL } from 'node:url';

const IGNORE_CHECKLIST = new Set(['sumber', 'oleh_id', 'oleh_nama', 'waktu', 'client_event_id', 'foto', 'gps', 'riwayat', 'catatan']);
const NAMA = { kiosk: 'Kiosk', app: 'App', erp: 'ERP' };
const SOURCE_EXPECT = { kiosk: 'kiosk', app: 'lapangan', erp: 'admin' };
const PREFIX_EXPECT = { kiosk: 'KIOSK/', app: 'APP/', erp: 'ERP/' };

const ada = (v) => (v == null || v === '' ? 'tidak' : 'ada');
const awalan = (v, n = 12) => String(v ?? '').replace(/\[SJ [^\]]*\]\s*/, '').slice(0, n);

/** security_checklist → kunci/nilai yang boleh dibandingkan (objek v2; teks/null diringkas). */
export function normChecklist(cl) {
  if (cl == null) return { _tipe: 'null' };
  if (typeof cl !== 'object') return { _tipe: typeof cl };
  const out = {};
  for (const k of Object.keys(cl).sort()) {
    if (IGNORE_CHECKLIST.has(k)) continue;
    const v = cl[k];
    out[k] = Array.isArray(v) ? `array(${v.length})` : v && typeof v === 'object' ? 'objek' : v;
  }
  out.riwayat_n = Array.isArray(cl.riwayat) ? cl.riwayat.length : null;
  out.riwayat0 = Array.isArray(cl.riwayat) && cl.riwayat[0] ? cl.riwayat[0].hasil : null;
  return out;
}

export function normSj(sj) {
  return {
    status: sj.status ?? null,
    draft_status: sj.draft_status ?? null,
    approval_status: sj.approval_status ?? null,
    security_verified_at: ada(sj.security_verified_at),
    security_verified_by_prefix: (String(sj.security_verified_by ?? '').match(/^[A-Z]+\//) || [null])[0],
    security_checklist: normChecklist(sj.security_checklist),
    foto_kirim: ada(sj.foto_kirim),
    gr_gps_lat: sj.gr_gps_lat == null ? 'null' : 'TERISI', // harus null (GSP-05: GPS gerbang bukan GPS terima)
    track_stage: sj.track_stage ?? null
  };
}

export const normScan = (rows) => ({
  jumlah: rows.length,
  baris: rows.map((r) => ({ stage_to: r.stage_to ?? null, actor_role: r.actor_role ?? null, notes: awalan(r.notes, 10) })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  source: rows.map((r) => r.source).sort()
});
export const normGateLog = (rows) => ({
  jumlah: rows.length,
  baris: rows.map((r) => ({ arah: r.arah, jenis: r.jenis, deskripsi: awalan(r.deskripsi, 10), satpam_pencatat_id: ada(r.satpam_pencatat_id) }))
});
export const normNotif = (rows) => ({ jumlah: rows.length, baris: rows.map((r) => ({ priority: r.priority, department: r.department })) });
export const normProc = (rows) => ({ jumlah: rows.length, stage_key: rows.map((r) => r.stage_key).sort() });

/** Bandingkan tiga objek hasil normalisasi → daftar baris {bagian, kunci, nilai:{kiosk,app,erp}, sama}. */
export function bandingkan(hasil) {
  const rows = [];
  const flat = (o, p = '') =>
    Object.entries(o || {}).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? flat(v, `${p}${k}.`) : [[`${p}${k}`, JSON.stringify(v)]]));
  const layar = Object.keys(hasil);
  for (const bagian of ['surat_jalan', 'scan_log', 'gate_log', 'notif', 'process_log']) {
    const peta = Object.fromEntries(layar.map((l) => [l, Object.fromEntries(flat(hasil[l][bagian]))]));
    const kunci = [...new Set(layar.flatMap((l) => Object.keys(peta[l])))].sort();
    for (const k of kunci) {
      if (bagian === 'scan_log' && k.startsWith('source')) continue; // pengecualian: dicek terpisah
      if (k === 'security_verified_by_prefix') continue; // pengecualian: dicek terpisah
      const nilai = Object.fromEntries(layar.map((l) => [l, peta[l][k] ?? '—']));
      rows.push({ bagian, kunci: k, nilai, sama: new Set(Object.values(nilai)).size === 1 });
    }
  }
  // pengecualian yang HARUS sesuai harapan per layar
  for (const l of layar) {
    const pre = hasil[l].surat_jalan.security_verified_by_prefix;
    const okPre = hasil[l].aksi === 'lolos' ? pre === PREFIX_EXPECT[l] : true;
    rows.push({ bagian: 'pengecualian', kunci: `verified_by prefix (${l})`, nilai: { [l]: `${pre} (harap ${PREFIX_EXPECT[l]})` }, sama: okPre });
    const srcs = hasil[l].scan_log.source;
    rows.push({ bagian: 'pengecualian', kunci: `scan_log.source (${l})`, nilai: { [l]: srcs.join(',') || '—' }, sama: srcs.every((s) => s === SOURCE_EXPECT[l]) });
  }
  for (const l of layar) rows.push({ bagian: 'pengecualian', kunci: `gr_gps_lat harus null (${l})`, nilai: { [l]: hasil[l].surat_jalan.gr_gps_lat }, sama: hasil[l].surat_jalan.gr_gps_lat === 'null' });
  return rows;
}

// ───────────────────────── I/O (hanya GET) ─────────────────────────
async function main() {
  try { process.loadEnvFile('.env'); } catch { /* env bisa dari shell */ }
  const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, arr) => (x.startsWith('--') ? [...a, [x.slice(2), arr[i + 1]]] : a), []));
  const URL_ = (process.env.DIRECTUS_API_URL || process.env.VITE_DIRECTUS_API_URL || '').replace(/\/$/, '');
  const TOKEN = process.env.DIRECTUS_TOKEN || process.env.VITE_DIRECTUS_TOKEN;
  const aksi = args.aksi;
  const ids = { kiosk: args.kiosk, app: args.app, erp: args.erp };
  if (!URL_ || !TOKEN) { console.error('DIRECTUS_API_URL / DIRECTUS_TOKEN tidak ada di env (.env).'); process.exit(2); }
  if (!['lolos', 'tahan'].includes(aksi) || Object.values(ids).some((v) => !Number(v))) {
    console.error('Pemakaian: node scripts/gsp11-cek-paritas.mjs --kiosk <id> --app <id> --erp <id> --aksi lolos|tahan [--sejak ISO]');
    process.exit(2);
  }
  const sejak = args.sejak || new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const get = async (p) => {
    const r = await fetch(`${URL_}${p}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) throw new Error(`GET ${p} → ${r.status} ${(await r.text()).slice(0, 200)}`);
    return (await r.json()).data;
  };

  const hasil = {};
  for (const [layar, id] of Object.entries(ids)) {
    const sj = await get(`/items/surat_jalan/${id}?fields=id,nomor_sj,status,draft_status,approval_status,security_verified_at,security_verified_by,security_checklist,foto_kirim,gr_gps_lat,track_stage`);
    const enc = encodeURIComponent(sj.nomor_sj);
    const [scan, gate, notif, proc] = await Promise.all([
      get(`/items/scan_log?filter[ref_collection][_eq]=surat_jalan&filter[ref_id][_eq]=${id}&filter[timestamp][_gte]=${encodeURIComponent(sejak)}&fields=stage_to,actor_role,source,notes&limit=-1`),
      get(`/items/security_gate_goods_log?filter[no_sj_manual][_eq]=${enc}&filter[date_created][_gte]=${encodeURIComponent(sejak)}&fields=arah,jenis,deskripsi,satpam_pencatat_id&limit=-1`),
      get(`/items/app_notifications?filter[type][_eq]=surat_jalan&filter[title][_contains]=${enc}&filter[created_at][_gte]=${encodeURIComponent(sejak)}&fields=priority,department&limit=-1`),
      get(`/items/process_event_log?filter[instance_id][_eq]=${id}&filter[process_code][_eq]=SURAT_JALAN&filter[event_ts][_gte]=${encodeURIComponent(sejak)}&fields=stage_key&limit=-1`)
    ]);
    hasil[layar] = { aksi, surat_jalan: normSj(sj), scan_log: normScan(scan), gate_log: normGateLog(gate), notif: normNotif(notif), process_log: normProc(proc) };
  }

  const rows = bandingkan(hasil);
  const lebar = Math.max(...rows.map((r) => `${r.bagian}.${r.kunci}`.length));
  console.log(`\nGSP-11 paritas — aksi: ${aksi} — sejak ${sejak}`);
  console.log(`SJ: Kiosk #${ids.kiosk} · App #${ids.app} · ERP #${ids.erp}\n`);
  for (const r of rows) {
    const nilai = Object.entries(r.nilai).map(([l, v]) => `${NAMA[l]}=${v}`).join('  ');
    console.log(`${r.sama ? 'SAMA' : 'BEDA'}  ${`${r.bagian}.${r.kunci}`.padEnd(lebar)}  ${nilai}`);
  }
  const beda = rows.filter((r) => !r.sama);
  console.log(`\n${beda.length === 0 ? '✅ SEMUA SAMA' : `❌ ${beda.length} BEDA`} (${rows.length} pemeriksaan)`);
  process.exit(beda.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error('Gagal:', e.message); process.exit(2); });
}
