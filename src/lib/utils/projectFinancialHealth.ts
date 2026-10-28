// src/lib/utils/projectFinancialHealth.ts
// R6 (Forecast Keuangan Global, rekomendasi laporan) — kartu "Kesehatan Keuangan Proyek"
// untuk Project Leader: traffic light 🟢🟡🔴 sederhana, digabung dari DUA sinyal yang SUDAH
// dihitung terpisah (bukan sumber ketiga baru):
//   1. Posisi RAP (ProjectCostPosition.remaining_pct — sama yang dipakai ProjectBepTrackerCard)
//   2. Status penagihan termin (PenagihanTerminRow.billing_overdue — Fase 4/Gap G6)
// Modul MURNI (tanpa I/O) — supaya mudah dites & tidak menambah panggilan Directus baru.

export type HealthLevel = 'green' | 'yellow' | 'red';

export interface ProjectFinancialHealth {
  level: HealthLevel;
  label: string;
  icon: string;
  reasons: string[]; // penjelasan singkat, bisa >1 (mis. RAP kritis + ada termin belum ditagih)
}

const LEVEL_META: Record<HealthLevel, { label: string; icon: string }> = {
  green: { label: 'Sehat', icon: '🟢' },
  yellow: { label: 'Perlu Perhatian', icon: '🟡' },
  red: { label: 'Kritis', icon: '🔴' }
};

function worse(a: HealthLevel, b: HealthLevel): HealthLevel {
  const rank: Record<HealthLevel, number> = { green: 0, yellow: 1, red: 2 };
  return rank[b] > rank[a] ? b : a;
}

/**
 * @param costPosition dari getProjectCostPosition() — boleh null bila RAP belum diisi.
 * @param billingRows dari fetchPenagihanStatusForProjects() — hanya termin proyek INI.
 * @param opts.warnAtRemainingPct ambang KUNING sisa RAP (default 0.15, selaras
 *   ProjectBepTrackerCard tone='warn').
 */
export function computeProjectFinancialHealth(
  costPosition: { remaining_pct: number | null } | null,
  billingRows: Array<{ billing_overdue: boolean }>,
  opts: { warnAtRemainingPct?: number } = {}
): ProjectFinancialHealth {
  const warnAt = opts.warnAtRemainingPct ?? 0.15;
  let level: HealthLevel = 'green';
  const reasons: string[] = [];

  const remainingPct = costPosition?.remaining_pct ?? null;
  if (remainingPct != null) {
    if (remainingPct < 0) {
      level = worse(level, 'red');
      reasons.push('Realisasi biaya sudah melewati plafon RAP');
    } else if (remainingPct < warnAt) {
      level = worse(level, 'yellow');
      reasons.push(`Sisa jatah RAP tinggal ${Math.round(remainingPct * 100)}%`);
    }
  }

  const overdueCount = billingRows.filter((r) => r.billing_overdue).length;
  if (overdueCount > 0) {
    level = worse(level, 'yellow');
    reasons.push(`${overdueCount} termin sudah lewat ambang progres tapi belum ditagih`);
  }

  if (reasons.length === 0) reasons.push('RAP terkendali, penagihan berjalan normal');

  return { level, ...LEVEL_META[level], reasons };
}
