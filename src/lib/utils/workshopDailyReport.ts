// src/lib/utils/workshopDailyReport.ts
// SALINAN dari erp-epi `src/lib/utils/workshopDailyReport.js` (WSK-10) — repo tidak bisa impor lintas repo. UBAH DI KEDUA TEMPAT; tes: workshopDailyReport.test.ts.
/**
 * WSK-10 — aturan murni simpan Laporan Harian workshop (dipakai endpoint server + klien + tes; tanpa I/O).
 *  - validasi & penyaringan payload (hanya kolom yang ada di skema live — Aturan #1: kolom liar = 403 Directus);
 *  - `jumlah_tenaga` = jumlah ORANG UNIK yang hadir/setengah hari (bukan Σ "orang" per PO yang menghitung satu orang berkali-kali);
 *  - `jumlah_manpower` per PO = Σ porsi alokasi orang ke PO itu (desimal) bila ada pembagian (po_split);
 *  - rencana gabung ke laporan yang sudah ada di tanggal yang sama (tanpa menggandakan orang/material/progres).
 */
import { normLaporanStatus, hariNilai } from './workshopAbsensiStatus';

export const DAILY_LIMITS = Object.freeze({ absensi: 120, material: 200, poDetails: 300 });

const HEADER_FIELDS = ['tanggal', 'cuaca', 'kendala', 'catatan', 'kondisi_equipment', 'foto_absensi_masuk', 'foto_absensi_pulang'];
const ABSENSI_FIELDS = ['nama', 'jabatan', 'status_hadir', 'keterangan', 'foto_masuk', 'foto_pulang', 'manpower_id'];
const MATERIAL_FIELDS = ['kategori', 'nama_material', 'qty', 'satuan', 'no_po', 'keterangan', 'item'];
const PO_DETAIL_FIELDS = [
  'po_id', 'subtask_id', 'subtask_name', 'volume_aktual', 'satuan', 'progress_hari_ini', 'aktivitas', 'hasil', 'kendala_po',
  'jumlah_manpower', 'total_objek', 'sudah_dikerjakan', 'sandblasting', 'primer', 'second', 'topcoat', 'so_detail_id', 'foto_urls',
  'status_barang', 'surat_jalan_masuk_id', 'material_id'
];

const pick = (obj: any, fields: string[]): Record<string, any> => {
  const out: Record<string, any> = {};
  for (const f of fields) if (obj && obj[f] !== undefined) out[f] = obj[f];
  return out;
};
const norm = (s: unknown): string => String(s ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
const idOf = (v: any): any => (v && typeof v === 'object' ? v.id : v);
const round = (n: unknown, d = 4): number => Math.round((Number(n) + Number.EPSILON) * 10 ** d) / 10 ** d;

/** Kunci identitas orang: manpower_id bila ada, kalau tidak tipe+nama (huruf besar, spasi dirapikan). */
export function personKey(row: any, tipe: string): string {
  const mid = idOf(row?.manpower_id);
  return mid != null && mid !== '' ? `m:${mid}` : `n:${tipe}:${norm(row?.nama)}`;
}

/** Jumlah orang UNIK yang hadir / setengah hari di leader + manpower. */
export function countUniqueHadir(absensi: any[] = [], absensiLeader: any[] = []): number {
  const seen = new Set<string>();
  for (const [list, tipe] of [[absensi, 'manpower'], [absensiLeader, 'leader']] as [any[], string][]) {
    for (const r of list || []) if (hariNilai(r?.status_hadir) > 0) seen.add(personKey(r, tipe));
  }
  return seen.size;
}

/**
 * Σ porsi alokasi per PO (desimal) dari po_split tiap orang yang hadir. persentase 0–100 → porsi 0–1.
 * Orang tanpa po_split tidak dihitung ke PO mana pun (tidak ditebak).
 * @returns {Map<number, number>} po_id → porsi
 */
export function computePoManpower(absensi: any[] = [], absensiLeader: any[] = []): Map<number, number> {
  const out = new Map<number, number>();
  for (const r of [...(absensi || []), ...(absensiLeader || [])]) {
    if (!(hariNilai(r?.status_hadir) > 0)) continue;
    for (const s of r?.po_split || []) {
      const po = Number(s?.po_id);
      if (!Number.isFinite(po)) continue;
      out.set(po, round((out.get(po) || 0) + (Number(s?.persentase) || 0) / 100, 4));
    }
  }
  return out;
}

/**
 * Validasi + penyaringan payload simpan laporan. Tidak melempar.
 * @returns {{ ok: true, value: { header, absensi, absensiLeader, material, poDetails } } | { ok: false, errors: string[] }}
 */
export type DailyReportNormalized = { header: Record<string, any>; absensi: any[]; absensiLeader: any[]; material: any[]; poDetails: any[] };
export function normalizeDailyReportInput(body: unknown): { ok: true; value: DailyReportNormalized } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const b: any = body && typeof body === 'object' ? body : {};
  const header = pick(b.header || {}, HEADER_FIELDS);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(header.tanggal || ''))) errors.push('Tanggal laporan wajib (format YYYY-MM-DD).');
  if (header.kondisi_equipment !== undefined && typeof header.kondisi_equipment !== 'string' && !Array.isArray(header.kondisi_equipment)) {
    errors.push('kondisi_equipment tidak valid.');
  }

  const lists = { absensi: b.absensi, absensi_leader: b.absensi_leader, material: b.material, po_details: b.po_details };
  for (const [k, v] of Object.entries(lists)) if (v !== undefined && !Array.isArray(v)) errors.push(`${k} harus berupa daftar.`);
  const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
  if (arr(lists.absensi).length + arr(lists.absensi_leader).length > DAILY_LIMITS.absensi) errors.push(`Maksimal ${DAILY_LIMITS.absensi} baris absensi.`);
  if (arr(lists.material).length > DAILY_LIMITS.material) errors.push(`Maksimal ${DAILY_LIMITS.material} baris material.`);
  if (arr(lists.po_details).length > DAILY_LIMITS.poDetails) errors.push(`Maksimal ${DAILY_LIMITS.poDetails} baris progres PO.`);

  const absensi: any[] = []; const absensiLeader: any[] = []; const seen = new Set<string>();
  for (const [src, dst, tipe] of [[arr(lists.absensi), absensi, 'manpower'], [arr(lists.absensi_leader), absensiLeader, 'leader']] as [any[], any[], string][]) {
    for (const raw of src) {
      const row: Record<string, any> = pick(raw, ABSENSI_FIELDS);
      if (!String(row.nama || '').trim()) { errors.push('Setiap baris absensi wajib punya nama.'); continue; }
      row.nama = String(row.nama).trim();
      if (normLaporanStatus(row.status_hadir) === null) { errors.push(`Status kehadiran "${row.status_hadir ?? ''}" untuk ${row.nama} tidak dikenal (hadir / setengah_hari / izin / sakit / absen).`); continue; }
      // Orang yang sama = manpower_id sama ATAU (tipe + nama) sama — baris tanpa manpower_id tetap terdeteksi ganda dengan baris ber-id
      const keys = [personKey(row, tipe), `n:${tipe}:${norm(row.nama)}`];
      if (keys.some((k) => seen.has(k))) { errors.push(`${row.nama} tercatat dua kali di laporan ini.`); continue; }
      keys.forEach((k) => seen.add(k));
      const split = Array.isArray(raw?.po_split) ? raw.po_split.filter((s: any) => s && s.po_id != null && s.po_id !== '') : [];
      if (split.length) {
        const total = split.reduce((a: number, s: any) => a + (Number(s.persentase) || 0), 0);
        if (Math.abs(total - 100) > 0.5) errors.push(`Pembagian PO untuk ${row.nama} harus berjumlah 100% (sekarang ${round(total, 2)}%).`);
        row.po_split = split.map((s: any) => ({ po_id: Number(s.po_id), persentase: round(Number(s.persentase) || 0, 2) }));
      }
      dst.push(row);
    }
  }

  const material = arr(lists.material).map((m) => pick(m, MATERIAL_FIELDS)).filter((m) => String(m.nama_material || '').trim());
  const poDetails = arr(lists.po_details).map((d) => pick(d, PO_DETAIL_FIELDS)).filter((d) => d.po_id != null && d.po_id !== '');
  if (arr(lists.po_details).length && poDetails.length !== arr(lists.po_details).length) errors.push('Setiap baris progres PO wajib punya po_id.');

  if (errors.length) return { ok: false, errors: [...new Set(errors)] };
  return { ok: true, value: { header, absensi, absensiLeader, material, poDetails } };
}

/**
 * Terapkan hasil hitungan server ke baris progres PO: jumlah_manpower = Σ porsi bila ADA pembagian untuk PO itu; kalau tidak,
 * nilai kiriman klien dipertahankan (tidak ditebak). Mengembalikan salinan.
 */
export function applyPoManpower(poDetails: any[], absensi: any[], absensiLeader: any[]): any[] {
  const portions = computePoManpower(absensi, absensiLeader);
  return (poDetails || []).map((d) => (portions.has(Number(d.po_id)) ? { ...d, jumlah_manpower: portions.get(Number(d.po_id)) } : { ...d }));
}

/**
 * Rencana gabung ke laporan yang SUDAH ada di tanggal yang sama:
 *  - absensi: orang yang sudah ada dilewati (tidak digandakan);
 *  - material: baris identik (kategori+nama+no_po+qty+satuan) dilewati;
 *  - progres PO: baris identik (po_id+subtask+volume/progres) dilewati.
 * @param {{ absensi?: any[], material?: any[], poDetails?: any[] }} existing  baris anak yang sudah tersimpan
 */
export function planMerge(existing: { absensi?: any[]; material?: any[]; poDetails?: any[] }, incoming: DailyReportNormalized) {
  // orang yang sudah ada dikenali lewat manpower_id ATAU (tipe + nama) — baris lama tanpa manpower_id tetap terdeteksi
  const exAbs = new Set<string>();
  for (const r of existing?.absensi || []) {
    const t = r.tipe === 'leader' ? 'leader' : 'manpower';
    exAbs.add(personKey(r, t));
    exAbs.add(`n:${t}:${norm(r.nama)}`);
  }
  const skipped: { absensi: string[]; material: number; poDetails: number } = { absensi: [], material: 0, poDetails: 0 };
  const keepAbs = (list: any[], tipe: string) => (list || []).filter((r) => {
    if (exAbs.has(personKey(r, tipe)) || exAbs.has(`n:${tipe}:${norm(r.nama)}`)) { skipped.absensi.push(r.nama); return false; }
    return true;
  });
  const matKey = (m: any): string => [norm(m.kategori), norm(m.nama_material), norm(m.no_po), Number(m.qty) || 0, norm(m.satuan)].join('|');
  const exMat = new Set((existing?.material || []).map(matKey));
  const material = (incoming.material || []).filter((m) => { if (exMat.has(matKey(m))) { skipped.material++; return false; } return true; });
  const poKey = (d: any): string => [Number(d.po_id), idOf(d.subtask_id) ?? '', norm(d.subtask_name), Number(d.volume_aktual) || 0, Number(d.progress_hari_ini) || 0].join('|');
  const exPo = new Set((existing?.poDetails || []).map(poKey));
  const poDetails = (incoming.poDetails || []).filter((d) => { if (exPo.has(poKey(d))) { skipped.poDetails++; return false; } return true; });
  return {
    absensi: keepAbs(incoming.absensi, 'manpower'),
    absensiLeader: keepAbs(incoming.absensiLeader, 'leader'),
    material,
    poDetails,
    skipped
  };
}

/** Teks catatan setelah digabung: tambahkan tanpa menghapus yang lama; abaikan bila sama / kosong. */
export function mergeText(oldText: unknown, addText: unknown): string {
  const o = String(oldText ?? '').trim(); const a = String(addText ?? '').trim();
  if (!a || o.includes(a)) return o;
  return o ? `${o} | ${a}` : a;
}

export const LAPORAN_TANGGAL_GANDA_MODES = Object.freeze(['tolak', 'gabung']);
export const DEFAULT_TANGGAL_GANDA_MODE = 'tolak';
export const normalizeTanggalGandaMode = (v: unknown): string => ((LAPORAN_TANGGAL_GANDA_MODES as readonly unknown[]).includes(v) ? (v as string) : DEFAULT_TANGGAL_GANDA_MODE);
