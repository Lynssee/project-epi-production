// Util jam kerja & lembur Project Charter (Fase 4). Murni (tanpa I/O) supaya mudah dites.
// ⚠️ Salinan dari erp-epi `src/lib/utils/charterWorkHours.js` — ubah keduanya bersamaan.
// Format waktu selalu 'HH:MM'. Jam selesai <= jam mulai dianggap melewati tengah malam (shift malam).

export const WORK_PRESETS: { label: string; mulai: string; selesai: string }[] = [
  { label: 'Normal 8 Jam', mulai: '08:00', selesai: '17:00' },
  { label: 'Site Pagi', mulai: '07:00', selesai: '16:00' },
  { label: 'Kantor/Pabrik', mulai: '08:30', selesai: '17:30' },
  { label: 'Shift Malam', mulai: '19:00', selesai: '04:00' }
];

export const LEMBUR_PRESETS: { label: string; mulai: string; selesai: string }[] = [
  { label: '3 Jam', mulai: '17:00', selesai: '20:00' },
  { label: '4 Jam', mulai: '17:00', selesai: '21:00' },
  { label: '5 Jam', mulai: '17:00', selesai: '22:00' }
];

/** Slot waktu per `step` menit: ['00:00','00:15',...]. */
export function timeSlots(step = 15): string[] {
  const out: string[] = [];
  for (let m = 0; m < 1440; m += step) out.push(minutesToHHMM(m));
  return out;
}

export function minutesToHHMM(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 'HH:MM' atau 'HH:MM:SS' → 'HH:MM'; selain itu ''. */
export function toHHMM(v: unknown): string {
  const s = String(v ?? '').trim();
  const m = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(s);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : '';
}

export function toMinutes(v: unknown): number | null {
  const t = toHHMM(v);
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/** Durasi menit mulai→selesai; selesai <= mulai = melewati tengah malam. null bila salah satu tidak valid. */
export function durationMinutes(mulai: unknown, selesai: unknown): number | null {
  const a = toMinutes(mulai);
  const b = toMinutes(selesai);
  if (a === null || b === null) return null;
  return b > a ? b - a : b + 1440 - a;
}

export function formatDuration(min: number | null | undefined): string {
  const total = Math.max(0, Math.round(min ?? 0));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} menit`;
  return m === 0 ? `${h} jam` : `${h} jam ${m} menit`;
}

/** Ringkasan + peringatan jam kerja. Peringatan bersifat saran (tidak memblokir simpan). */
export function analyzeWorkHours(
  { mulai, selesai, lemburOn = false, lemburMulai, lemburSelesai }: {
    mulai?: unknown; selesai?: unknown; lemburOn?: boolean; lemburMulai?: unknown; lemburSelesai?: unknown;
  } = {}
): { normalMin: number; lemburMin: number; totalMin: number; warnings: string[] } {
  const warnings: string[] = [];
  const filledNormal = !!(mulai || selesai);
  const normalMin = durationMinutes(mulai, selesai);
  if (filledNormal && normalMin === null) warnings.push('Format jam kerja tidak valid (gunakan HH:MM).');
  if (normalMin === 0) warnings.push('Jam kerja mulai dan selesai sama — durasi 0.');
  if (normalMin !== null && normalMin > 12 * 60) warnings.push('Jam kerja normal lebih dari 12 jam — periksa kembali.');

  let lemburMin = 0;
  if (lemburOn) {
    const l = durationMinutes(lemburMulai, lemburSelesai);
    if ((lemburMulai || lemburSelesai) && l === null) warnings.push('Format jam lembur tidak valid (gunakan HH:MM).');
    if (l === 0) warnings.push('Jam lembur mulai dan selesai sama — durasi 0.');
    lemburMin = l ?? 0;

    const ns = toMinutes(mulai);
    const ls = toMinutes(lemburMulai);
    if (normalMin && ns !== null && ls !== null) {
      const normalEnd = ns + normalMin;
      const lemburStart = ls < ns ? ls + 1440 : ls;
      if (lemburStart < normalEnd) warnings.push('Jam lembur mulai sebelum jam kerja normal selesai (bertabrakan).');
    }
  }

  const totalMin = (normalMin ?? 0) + lemburMin;
  if (totalMin > 16 * 60) warnings.push('Total jam kerja + lembur melebihi 16 jam per hari.');
  return { normalMin: normalMin ?? 0, lemburMin, totalMin, warnings };
}
