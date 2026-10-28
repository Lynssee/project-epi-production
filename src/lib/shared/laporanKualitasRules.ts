// src/lib/shared/laporanKualitasRules.js
// R2-08 — aturan MURNI disiplin isi laporan harian (tanpa I/O): lapor mundur (K1), volume tidak wajar, pola angka datar,
// foto harian. Dipakai gerbang tulis server (reportsBatchGate) di proxy ERP & lapangan. Kembar erp-epi:
// src/lib/shared/laporanKualitasRules.js — jaga keduanya tetap sama. Semua ambang dari setelan (system_settings
// `project.laporan.disiplin`), bukan hardcode; gate-nya didaftarkan di registry dan dimulai `shadow` (Aturan #3, #11).

export interface Disiplin {
  bebas_hari: number;
  wajib_alasan_hari: number;
  pola_datar_min: number;
  toleransi_volume_pct: number;
}
export const DEFAULT_DISIPLIN: Readonly<Disiplin> = Object.freeze({
  bebas_hari: 2, // K1: <= H-2 bebas
  wajib_alasan_hari: 7, // H-3..H-7 wajib alasan; > H-7 hanya admin dengan kategori alasan
  pola_datar_min: 5, // >= 5 laporan berturut-turut bernilai identik per subtask
  toleransi_volume_pct: 0.5 // toleransi pembulatan terhadap sisa volume subtask
});

/** @param {unknown} raw nilai setelan (objek/JSON string) -> konfigurasi tervalidasi */
export function parseDisiplin(raw: unknown): Disiplin {
  let v: any = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { v = null; }
  }
  const out: Disiplin = { ...DEFAULT_DISIPLIN };
  if (v && typeof v === 'object') {
    for (const k of Object.keys(DEFAULT_DISIPLIN) as Array<keyof Disiplin>) {
      const n = Number(v[k]);
      if (v[k] !== undefined && Number.isFinite(n) && n >= 0 && n <= 365) out[k] = n;
    }
  }
  if (out.wajib_alasan_hari < out.bebas_hari) out.wajib_alasan_hari = out.bebas_hari;
  return out;
}

const dayKey = (v: unknown): string | null => {
  const k = String(v ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(k) ? k : null;
};
const utcMs = (k: string) => new Date(`${k}T00:00:00Z`).getTime();

/** Selisih hari kalender (today - date). Negatif = tanggal di masa depan. null bila tanggal tak valid. */
export function hariMundur(date: unknown, today: unknown): number | null {
  const d = dayKey(date);
  const t = dayKey(today);
  if (!d || !t) return null;
  return Math.round((utcMs(t) - utcMs(d)) / 86400000);
}

/**
 * K1 — lapor mundur. level: 'bebas' (<= bebas_hari) | 'alasan' (<= wajib_alasan_hari, wajib alasan) | 'admin' (> wajib_alasan_hari, hanya admin + kategori).
 * @returns {null | {level:'alasan'|'admin', hari:number, message:string}} null = lolos
 */
export function evaluasiMundur({ date, today, alasan, kategoriAdmin, isAdmin, cfg = DEFAULT_DISIPLIN }: {
  date: unknown; today: unknown; alasan?: unknown; kategoriAdmin?: unknown; isAdmin?: boolean; cfg?: Disiplin;
}): null | { level: 'alasan' | 'admin'; hari: number; message: string } {
  const hari = hariMundur(date, today);
  if (hari === null || hari <= cfg.bebas_hari) return null;
  const alasanOk = String(alasan ?? '').trim().length >= 10;
  if (hari <= cfg.wajib_alasan_hari) {
    if (alasanOk) return null;
    return { level: 'alasan', hari, message: `Laporan diisi ${hari} hari setelah tanggal kerja (batas bebas H-${cfg.bebas_hari}). Isi alasan keterlambatan (min. 10 karakter).` };
  }
  if (isAdmin && alasanOk && String(kategoriAdmin ?? '').trim()) return null;
  return { level: 'admin', hari, message: `Laporan diisi ${hari} hari setelah tanggal kerja (> H-${cfg.wajib_alasan_hari}). Hanya Admin Project yang boleh, dengan kategori & alasan.` };
}

function itemVolume(item: any): number {
  const cands = [item?.stages?.pekerjaan, item?.progress_value, item?.value];
  for (const c of cands) {
    if (c === null || c === undefined || c === '') continue;
    const n = parseFloat(c);
    if (Number.isFinite(n)) return n;
  }
  return 0;
}
function parseItems(raw: unknown): any[] {
  let v: any = raw;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { return []; }
  }
  return Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [];
}

/**
 * Nilai harian > sisa volume subtask (volume - realisasi di tanggal lain). Mendeteksi angka kumulatif yang diisi sebagai harian.
 * @returns {Array<{subtask_id:string, nama:string, nilai:number, sisa:number, volume:number}>}
 */
export function evaluasiVolumeWajar(progress: unknown, timeline: unknown, tanggal: unknown, cfg: Disiplin = DEFAULT_DISIPLIN): Array<{ subtask_id: string; nama: string; nilai: number; sisa: number; volume: number }> {
  let tl: any = timeline;
  if (typeof tl === 'string') {
    try { tl = JSON.parse(tl); } catch { tl = null; }
  }
  const out: Array<{ subtask_id: string; nama: string; nilai: number; sisa: number; volume: number }> = [];
  if (!tl || !Array.isArray(tl.categories)) return out;
  const subs = new Map<string, any>();
  for (const c of tl.categories) for (const s of c?.subtasks || []) if (s && s.id != null) subs.set(String(s.id), s);
  const day = dayKey(tanggal);
  const peta = tl.metadata?.peta_subtask_laporan || {};
  for (const it of parseItems(progress)) {
    const rawId = it.subtask_id ? String(it.subtask_id) : '';
    const sub = subs.get(peta[rawId] ? String(peta[rawId]) : rawId);
    const volume = parseFloat(sub?.volume);
    if (!sub || !(volume > 0)) continue;
    const nilai = itemVolume(it);
    if (!(nilai > 0)) continue;
    let terpakai = 0;
    for (const [d, v] of Object.entries(sub.daily_actual || {})) {
      if (day && dayKey(d) === day) continue; // realisasi tanggal laporan ini sendiri (hasil sinkron lama) tidak dihitung dobel
      const n = parseFloat(String(v));
      if (Number.isFinite(n)) terpakai += n;
    }
    const sisa = Math.max(0, volume - terpakai);
    const toleransi = volume * (cfg.toleransi_volume_pct / 100);
    if (nilai > sisa + toleransi) out.push({ subtask_id: rawId, nama: String(it.activity || it.name || sub.name || ''), nilai, sisa: Math.round(sisa * 100) / 100, volume });
  }
  return out;
}

/**
 * Pola datar: nilai subtask yang SAMA dengan >= (min-1) laporan sebelumnya berturut-turut (termasuk laporan ini).
 * @param {unknown} progress progress laporan ini
 * @param {Array<{progress:unknown}>} sebelumnya laporan sebelumnya, TERBARU dulu
 */
export function evaluasiPolaDatar(progress: unknown, sebelumnya: Array<{ progress?: unknown }>, min: number = DEFAULT_DISIPLIN.pola_datar_min): Array<{ subtask_id: string; nilai: number; run: number }> {
  const out: Array<{ subtask_id: string; nilai: number; run: number }> = [];
  if (!(min >= 2)) return out;
  const prev = (sebelumnya || []).map((r) => {
    const m = new Map<string, number>();
    for (const it of parseItems(r?.progress)) if (it.subtask_id) m.set(String(it.subtask_id), itemVolume(it));
    return m;
  });
  for (const it of parseItems(progress)) {
    const id = it.subtask_id ? String(it.subtask_id) : '';
    const nilai = itemVolume(it);
    if (!id || !(nilai > 0)) continue;
    let run = 1;
    for (const m of prev) {
      if (m.has(id) && Math.abs((m.get(id) as number) - nilai) < 1e-9) run++;
      else break;
    }
    if (run >= min) out.push({ subtask_id: id, nilai, run });
  }
  return out;
}

/** Foto harian: total foto (absensi + progress + kendala + area kerja + toolbox) nol. */
export function evaluasiFotoHarian(el: any, { isCreate = false }: { isCreate?: boolean } = {}): { message: string } | null {
  const count = (v: unknown): number => {
    let x: any = v;
    if (typeof x === 'string') {
      try { x = JSON.parse(x); } catch { return 0; }
    }
    return Array.isArray(x) ? x.length : 0;
  };
  const total = ['attendance_photos', 'progress_photos', 'issue_photos', 'area_kerja_photos', 'toolbox_photos'].reduce((n, k) => n + count(el?.[k]), 0);
  if (total > 0) return null;
  // Laporan BARU tanpa foto = pelanggaran (termasuk bila kolom foto tidak dikirim sama sekali — jalur tulis langsung). PATCH hanya dinilai
  // bila payload memang membawa kolom foto (mis. edit foto); PATCH status tidak dinilai.
  if (isCreate) return { message: 'Laporan tanpa satu pun foto. Lampirkan foto absensi, progres, atau kondisi area kerja.' };
  const membawaKolom = ['attendance_photos', 'progress_photos', 'issue_photos', 'area_kerja_photos', 'toolbox_photos'].some((k) => el?.[k] !== undefined);
  return membawaKolom ? { message: 'Laporan tanpa satu pun foto. Lampirkan foto absensi, progres, atau kondisi area kerja.' } : null;
}
