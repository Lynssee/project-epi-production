// @ts-nocheck
// SALINAN KONTRAK dari erp-epi/src/lib/finance/plCoverageSettings.js (Rencana Gate Rasionalitas Packing List, Fase 4, 4 Nov 2026).
// JANGAN diedit di sini: ubah di erp-epi lalu salin ulang. Paritas isi dijaga tes kontrak lintas repo
// erp-epi/src/lib/server/gates/plCoverage.crossRepoContract.test.js (gagal bila kedua salinan menyimpang).
// '@ts-nocheck' disengaja: file ini JS murni yang identik dengan sisi admin; tipe tidak boleh membuatnya berbeda.
// src/lib/finance/plCoverageSettings.js
// Modul MURNI. Setelan gate rasionalitas Packing List (G_PKL_COVERAGE_M2, G_PKL_RAB_QUOTA,
// G_PKL_TIMELINE_RUNRATE, G_PKL_SITE_STOCK_RECON) — disimpan di `app_settings` module='project'
// dengan prefix `pkl_coverage.` (sistem app_settings, BUKAN system_settings; lihat CLAUDE.md
// "Dua sistem settings"). Sengaja TERPISAH dari `planning.*`: default Planning (loss 20%, toleransi
// 25%) adalah ambang peringatan Charter→RAP; mengubahnya diam-diam akan memengaruhi kalkulator RAP.
// Semua punya default di kode → baris yang belum ada / rusak tidak pernah mematikan gate.
// MODE gate (shadow/warn/soft/hard), enforce_from & bypass TIDAK di sini — itu `gate_definitions` /
// `gate_enforcement` (/settings/gates). Di sini hanya AMBANG angka.

export const PKL_COVERAGE_SETTING_DEFS = Object.freeze({
  'pkl_coverage.loss_factor_pct': { type: 'number', label: 'Faktor Kehilangan Material Lapangan (%)', def: 10, min: 0, max: 200 },
  'pkl_coverage.qty_tolerance_pct': { type: 'number', label: 'Toleransi Kelebihan Qty di Atas Plafon (%)', def: 10, min: 0, max: 500 },
  'pkl_coverage.layers_max': { type: 'number', label: 'Jumlah Lapis Maksimum (bila konsumsi per lapis)', def: 2, min: 1, max: 10 },
  'pkl_coverage.round_up_whole_pack': { type: 'boolean', label: 'Izinkan Pembulatan ke Atas ke 1 Kemasan Utuh', def: true },
  'pkl_coverage.min_trusted_area_m2': { type: 'number', label: 'Luasan Minimum yang Dipercaya (m²) — di bawah ini dianggap data belum valid', def: 5, min: 0, max: 100000 },
  'pkl_coverage.max_buffer_days': { type: 'number', label: 'Batas Stok Kirim Bertahap (hari kerja ke depan)', def: 7, min: 1, max: 90 },
  'pkl_coverage.full_lot_area_threshold_m2': { type: 'number', label: 'Proyek ≤ Luasan Ini Boleh Kirim 1 Lot Penuh (m²)', def: 50, min: 0, max: 100000 },
  'pkl_coverage.timeline_lead_days': { type: 'number', label: 'Tanggal Butuh Boleh Lebih Awal dari Mulai Jadwal Proyek (hari)', def: 7, min: 0, max: 365 },
  'pkl_coverage.timeline_tail_days': { type: 'number', label: 'Tanggal Butuh Boleh Melewati Akhir Jadwal Proyek (hari)', def: 14, min: 0, max: 365 },
  'pkl_coverage.site_stock_cover_days': { type: 'number', label: 'Tolak Permintaan Baru Bila Stok Site Cukup untuk (hari kerja)', def: 3, min: 0, max: 60 },
  'pkl_coverage.unreported_usage_days': { type: 'number', label: 'Pengiriman Terkirim Lebih dari (hari) Tanpa Laporan Pemakaian = Perlu Rekonsiliasi', def: 3, min: 0, max: 60 },
  'pkl_coverage.thinner_ratio_pct': { type: 'number', label: 'Maks. Thinner terhadap Volume Cat (%)', def: 10, min: 0, max: 100 },
  'pkl_coverage.extreme_alert_pct': { type: 'number', label: 'Kirim Alert n8n Bila Permintaan Melebihi Plafon (%) — 0 = nonaktif', def: 150, min: 0, max: 100000 },
  'pkl_coverage.efficiency_min_progress_pct': { type: 'number', label: 'Radar Efisiensi: Bandingkan dengan Progres Hanya Bila Progres Pelapisan ≥ (%)', def: 10, min: 0, max: 100 },
  'pkl_coverage.efficiency_warn_pct': { type: 'number', label: 'Radar Efisiensi: Peringatan Bila Pemakaian Aktual ≥ (% dari plafon teoritis proyek)', def: 80, min: 1, max: 100 },
  'pkl_coverage.alert_recipients': { type: 'json', label: 'Penerima WhatsApp Alert & Rekap Anomali (daftar nomor HP, mis. ["0812...", "0813..."])', def: [] },
  'pkl_coverage.pack_default_kg': {
    type: 'json',
    label: 'Bobot Default per Kemasan (Kg) bila master & nama barang tidak menyebut ukuran',
    def: { pail: 20, kaleng: 4, galon: 4, can: 4, drum: 200 }
  }
});

function pickRaw(rows, key) {
  const r = (rows || []).find((x) => x?.setting_key === key);
  return r ? (r.value !== undefined ? r.value : r.setting_value) : undefined;
}

/**
 * @param {Array<{setting_key:string, value?:any, setting_value?:any}>} rows baris app_settings (module project)
 * @returns {Record<string, any>} kunci tanpa prefix `pkl_coverage.`
 */
export function resolvePklCoverageSettings(rows) {
  const out = {};
  for (const [key, d] of Object.entries(PKL_COVERAGE_SETTING_DEFS)) {
    const short = key.replace('pkl_coverage.', '');
    const raw = pickRaw(rows, key);
    let v = d.def;
    if (raw !== undefined && raw !== null && raw !== '') {
      if (d.type === 'number') {
        const n = Number(raw);
        if (Number.isFinite(n) && n >= d.min && n <= d.max) v = n;
      } else if (d.type === 'boolean') {
        if (raw === true || raw === 'true' || raw === 1 || raw === '1') v = true;
        else if (raw === false || raw === 'false' || raw === 0 || raw === '0') v = false;
      } else if (d.type === 'json') {
        try {
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (Array.isArray(d.def)) {
            // setelan berbentuk daftar (mis. penerima WA): buang entri kosong, ubah ke string
            if (Array.isArray(parsed)) v = parsed.map((x) => String(x ?? '').trim()).filter(Boolean);
          } else if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            // Gabung ke default: kunci yang hilang tetap punya nilai; nilai non-positif dibuang.
            const merged = { ...d.def };
            for (const [k, val] of Object.entries(parsed)) {
              const n = Number(val);
              if (Number.isFinite(n) && n > 0) merged[String(k).toLowerCase()] = n;
            }
            v = merged;
          }
        } catch { /* JSON rusak → default */ }
      }
    }
    out[short] = v;
  }
  return out;
}

/** Baris siap-POST untuk createSetting() — dipakai skrip/UI seed setelan (izin Lead untuk apply ke prod). */
export function pklCoverageSettingSeedRows() {
  return Object.entries(PKL_COVERAGE_SETTING_DEFS).map(([setting_key, d]) => ({
    module: 'project', category: 'pkl_coverage', setting_key, setting_type: d.type, label: d.label,
    value: d.def
  }));
}
