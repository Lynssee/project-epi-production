// Salinan setia dari erp-epi/src/lib/utils/ojtAssessment.js (logika murni penilaian OJT). Ubah di KEDUA repo sekaligus.
// Penilaian OJT (On-the-Job Training) — logika murni. Disimpan di koleksi `training_review`
// (peran_reviewer atasan/mentor, skor_dimensi JSON) — TANPA koleksi baru. Hasilnya menyuplai `nilai_praktik` enrollment.

export const OJT_MARKER = 'ojt';

/** Skala penilaian per butir. Nilai = bobot kemandirian. */
export const OJT_RATINGS = [
  { value: 0, label: 'Belum bisa', hint: 'Belum mampu meski diarahkan', color: 'red' },
  { value: 1, label: 'Dengan arahan', hint: 'Mampu bila dipandu/diawasi', color: 'amber' },
  { value: 2, label: 'Mandiri', hint: 'Mampu sendiri sesuai standar', color: 'green' }
];
export const OJT_MAX = 2;

export const OJT_TINDAK_LANJUT = [
  { value: 'none', label: 'Tidak ada' },
  { value: 'coaching', label: 'Coaching' },
  { value: 'remedial', label: 'Remedial' },
  { value: 'ulang', label: 'Ulang OJT' }
];

const clean = (v) => String(v ?? '').trim();

/** Daftar butir awal dari modul program (satu modul = satu kompetensi yang didemonstrasikan). */
export function buildChecklistFromModules(modules = []) {
  return (Array.isArray(modules) ? modules : [])
    .filter((m) => clean(m?.judul))
    .map((m, i) => ({
      key: `m${m.id ?? i + 1}`,
      label: clean(m.judul),
      rating: null,
      catatan: ''
    }));
}

export function addCustomItem(items, label) {
  const l = clean(label);
  const list = Array.isArray(items) ? items : [];
  if (!l) return list;
  return [...list, { key: `c${Date.now().toString(36)}${list.length}`, label: l, rating: null, catatan: '' }];
}

/** Gabungkan hasil tersimpan ke daftar butir terkini (butir baru muncul, butir tersimpan yang sudah tak ada modulnya tetap dipertahankan). */
export function mergeSavedItems(fresh = [], saved = []) {
  const savedList = Array.isArray(saved) ? saved : [];
  const byKey = new Map(savedList.map((s) => [s.key, s]));
  const merged = (fresh || []).map((f) => {
    const s = byKey.get(f.key);
    byKey.delete(f.key);
    return s ? { ...f, rating: s.rating ?? null, catatan: s.catatan ?? '' } : f;
  });
  for (const s of byKey.values()) merged.push({ key: s.key, label: clean(s.label), rating: s.rating ?? null, catatan: s.catatan ?? '' });
  return merged;
}

/** Skor: persen = total poin / (butir terisi × 2). Butir kosong tidak dihitung; `lengkap` true bila semua terisi. */
export function scoreChecklist(items = []) {
  const list = Array.isArray(items) ? items : [];
  const rated = list.filter((i) => i && i.rating !== null && i.rating !== undefined && i.rating !== '');
  const poin = rated.reduce((s, i) => s + (Number(i.rating) || 0), 0);
  const persen = rated.length ? Math.round((poin / (rated.length * OJT_MAX)) * 1000) / 10 : null;
  return {
    total: list.length,
    terisi: rated.length,
    lengkap: list.length > 0 && rated.length === list.length,
    belumBisa: rated.filter((i) => Number(i.rating) === 0).length,
    persen
  };
}

/** Saran tindak lanjut: di bawah passing → remedial; ada butir "Belum bisa" meski lulus → coaching. */
export function suggestTindakLanjut(score, passing = 70) {
  if (!score || score.persen == null) return 'none';
  if (score.persen < Number(passing || 70)) return 'remedial';
  if (score.belumBisa > 0) return 'coaching';
  return 'none';
}

export function toSkorDimensi(items) {
  return { tipe: OJT_MARKER, items: (items || []).map((i) => ({ key: i.key, label: i.label, rating: i.rating ?? null, catatan: i.catatan || '' })), skala_max: OJT_MAX };
}

/** Baca skor_dimensi; null bila bukan penilaian OJT. */
export function parseSkorDimensi(raw) {
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return null; } }
  if (!v || v.tipe !== OJT_MARKER || !Array.isArray(v.items)) return null;
  return v.items;
}
