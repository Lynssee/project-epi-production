#!/usr/bin/env node
/**
 * SJ-01 — cek kesiapan alur gerbang satpam (HANYA BACA, tidak menulis apa pun).
 *
 *   node scripts/sj01-cek-kesiapan-gerbang.mjs           # ringkasan teks
 *   node scripts/sj01-cek-kesiapan-gerbang.mjs --json    # JSON (untuk bukti)
 *
 * Keluar kode 1 bila ada syarat WAJIB belum terpenuhi (bisa dipakai sebagai checklist rilis), 2 bila gagal jalan.
 * Secret TIDAK pernah dicetak — hanya "ada" / "KOSONG". Jalankan di tiap server (env berbeda per server).
 */
import { pathToFileURL } from 'node:url';

const AKTIF = (v) => v === true || v === 1 || v === '1' || v === 'true';
const hasAccess = (arr, kode) => Array.isArray(arr) && arr.includes(kode);

/** Murni: nilai env → 'ada' | 'KOSONG' (≥ 32 karakter dianggap layak; lebih pendek → 'terlalu-pendek'). */
export function statusSecret(v) {
  const t = String(v ?? '').trim();
  if (!t) return 'KOSONG';
  return t.length >= 32 ? 'ada' : 'terlalu-pendek';
}

/** Murni: susun temuan dari data mentah. `wajib` = syarat rilis; kurang → ok=false. */
export function susunLaporan({ secret, saklar, karyawan = [], antrean = [], dicetakBelumDimuat = 0, scanSejak = {}, jumlahSatpam = null }) {
  const aksesGerbang = karyawan.filter((k) => hasAccess(k.kiosk_menu_access, 'gerbang_sj')).length;
  const aksesMuat = karyawan.filter((k) => hasAccess(k.kiosk_menu_access, 'muat_sj')).length;
  const antreanPerKunci = {};
  for (const r of antrean) {
    const k = r.track_stage || '(kosong = alur lama)';
    antreanPerKunci[k] = (antreanPerKunci[k] || 0) + 1;
  }
  const temuan = [];
  const wajib = (ok, pesan) => { if (!ok) temuan.push({ level: 'WAJIB', pesan }); };
  const saran = (ok, pesan) => { if (!ok) temuan.push({ level: 'saran', pesan }); };

  wajib(secret === 'ada', `GERBANG_PROXY_SECRET ${secret} di server ini (isi sama persis di erp-epi & project-epi, ≥ 32 karakter).`);
  wajib(AKTIF(saklar), 'settings.suratJalanRequireSecurityCheck belum aktif (alur gerbang mati).');
  wajib(aksesGerbang > 0, 'Belum ada karyawan dengan menu kiosk gerbang_sj.');
  if (jumlahSatpam != null) wajib(aksesGerbang >= jumlahSatpam, `Akses gerbang_sj (${aksesGerbang}) < jumlah satpam (${jumlahSatpam}).`);
  wajib(aksesMuat > 0, 'Belum ada petugas dengan menu kiosk muat_sj.');
  wajib(!(antreanPerKunci['(kosong = alur lama)'] > 0), `${antreanPerKunci['(kosong = alur lama)']} SJ alur lama masih tertahan di antrean (lihat SJ-04).`);
  saran(!(antreanPerKunci.lolos_gerbang > 0), `${antreanPerKunci.lolos_gerbang} SJ lolos_gerbang masih needs_security_check (backfill, lihat GSP-07).`);
  saran(dicetakBelumDimuat === 0, `${dicetakBelumDimuat} SJ sudah dicetak tapi belum dimuat lewat kiosk.`);
  saran((scanSejak.lolosGerbangNyata ?? 0) > 0, 'Belum ada scan lolos_gerbang nyata (selain backfill) — jalankan uji end-to-end.');

  return {
    ok: !temuan.some((t) => t.level === 'WAJIB'),
    secret, saklarAktif: AKTIF(saklar), aksesGerbang, aksesMuat, jumlahSatpam,
    antreanSatpam: antreanPerKunci, dicetakBelumDimuat, scanSejak, temuan
  };
}

async function main() {
  try { process.loadEnvFile('.env'); } catch { /* env bisa dari shell */ }
  const json = process.argv.includes('--json');
  const URL_ = (process.env.DIRECTUS_API_URL || process.env.VITE_DIRECTUS_API_URL || '').replace(/\/$/, '');
  const TOKEN = process.env.DIRECTUS_TOKEN || process.env.VITE_DIRECTUS_TOKEN;
  if (!URL_ || !TOKEN) { console.error('DIRECTUS_API_URL / DIRECTUS_TOKEN tidak ada di env (.env).'); process.exit(2); }

  const call = async (path) => {
    const r = await fetch(`${URL_}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) throw new Error(`GET ${path} → ${r.status} (403 = nama field/relasi salah)`);
    return r.json();
  };
  const hitung = async (path) => {
    const r = await call(`${path}${path.includes('?') ? '&' : '?'}aggregate[count]=id`);
    return Number(r?.data?.[0]?.count?.id ?? r?.data?.[0]?.count ?? 0);
  };

  const [settings, karyawanRes, antreanRes, dicetakBelumDimuat, lolosNyata, scan7h] = await Promise.all([
    call('/items/settings?fields=suratJalanRequireSecurityCheck').then((r) => r.data),
    call('/items/karyawan?fields=id,kiosk_menu_access&filter[kiosk_menu_access][_nnull]=true&limit=-1').then((r) => r.data || []),
    call('/items/surat_jalan?filter[status][_eq]=needs_security_check&fields=id,track_stage&limit=-1').then((r) => r.data || []),
    hitung('/items/surat_jalan?filter[status][_eq]=created&filter[print_count][_gt]=0&filter[track_stage][_null]=true'),
    hitung('/items/scan_log?filter[stage_to][_eq]=lolos_gerbang&filter[source][_neq]=backfill'),
    hitung(`/items/scan_log?filter[date_created][_gte]=${encodeURIComponent(new Date(Date.now() - 7 * 864e5).toISOString())}`)
  ]);

  const laporan = susunLaporan({
    secret: statusSecret(process.env.GERBANG_PROXY_SECRET),
    saklar: settings?.suratJalanRequireSecurityCheck,
    karyawan: karyawanRes,
    antrean: antreanRes,
    dicetakBelumDimuat,
    scanSejak: { lolosGerbangNyata: lolosNyata, scan7Hari: scan7h }
  });

  if (json) { console.log(JSON.stringify({ waktu: new Date().toISOString(), ...laporan }, null, 2)); }
  else {
    console.log(`\nSJ-01 — kesiapan gerbang satpam (${new Date().toISOString()})`);
    console.log(`  secret GERBANG_PROXY_SECRET : ${laporan.secret}`);
    console.log(`  saklar alur gerbang          : ${laporan.saklarAktif ? 'aktif' : 'MATI'}`);
    console.log(`  akses kiosk gerbang_sj / muat_sj : ${laporan.aksesGerbang} / ${laporan.aksesMuat}`);
    console.log(`  antrean satpam per tahap     : ${JSON.stringify(laporan.antreanSatpam)}`);
    console.log(`  dicetak belum dimuat         : ${laporan.dicetakBelumDimuat}`);
    console.log(`  scan lolos_gerbang nyata     : ${lolosNyata} · scan 7 hari: ${scan7h}`);
    console.log('');
    for (const t of laporan.temuan) console.log(`  [${t.level}] ${t.pesan}`);
    console.log(laporan.ok ? '\nSyarat wajib terpenuhi.' : '\nSyarat wajib BELUM terpenuhi.');
  }
  process.exit(laporan.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error('Gagal:', e.message); process.exit(2); });
}
