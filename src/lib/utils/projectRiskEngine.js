// src/lib/utils/projectRiskEngine.js
/**
 * Mesin Klasifikasi Skala, Identitas, dan Breakdown Risiko Proyek
 * Standar PT. Eltama Prima Indo (Protective Coating, Blasting, Flooring, Maintenance).
 * 
 * Mendukung perhitungan 4 pilar risiko:
 * 1. Financial Risk (Nilai kontrak, termin, retensi, risiko overspend)
 * 2. HSE / Safety Risk (Live plant, confined space/tangki, working at height, izin kerja)
 * 3. Quality & Technical Risk (Surface prep Sa 2.5/Sa 3, ketebalan DFT micron, tipe resin, garansi)
 * 4. Operational & Schedule Risk (Durasi hari, koordinasi multi-regu, logistik material)
 * 
 * Serta agregasi skor total (0-100) dan klasifikasi skala (Kecil/Sedang/Besar/Mega).
 */

export const DEFAULT_SCALE_TIERS = [
  { max: 100_000_000, scale: 'kecil', label: 'Proyek Kecil', minDays: 1, maxDays: 14 },
  { max: 750_000_000, scale: 'sedang', label: 'Proyek Sedang', minDays: 15, maxDays: 60 },
  { max: 2_500_000_000, scale: 'besar', label: 'Proyek Besar', minDays: 61, maxDays: 150 },
  { max: Infinity, scale: 'mega', label: 'Proyek Mega', minDays: 151, maxDays: Infinity }
];

export const DEFAULT_RISK_WEIGHTS = {
  financial: 0.25,
  hse: 0.30,
  quality: 0.25,
  operational: 0.20
};

export const DEFAULT_RISK_THRESHOLDS = {
  low_max: 35,     // 0 - 35: Rendah
  medium_max: 65,  // 36 - 65: Sedang
  high_max: 85     // 66 - 85: Tinggi, 86+: Kritis
};

/**
 * Normalisasi level risiko dari skor 0-100
 */
export function getRiskLevelFromScore(score, thresholds = DEFAULT_RISK_THRESHOLDS) {
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  if (s <= thresholds.low_max) return 'rendah';
  if (s <= thresholds.medium_max) return 'sedang';
  if (s <= thresholds.high_max) return 'tinggi';
  return 'kritis';
}

/**
 * Format badge warna Tailwind untuk level risiko
 */
export function getRiskLevelBadge(level) {
  const norm = String(level || '').toLowerCase();
  switch (norm) {
    case 'kritis':
      return { bg: 'bg-rose-100', text: 'text-rose-800', border: 'border-rose-300', dot: 'bg-rose-500', label: 'Kritis' };
    case 'tinggi':
      return { bg: 'bg-amber-100', text: 'text-amber-800', border: 'border-amber-300', dot: 'bg-amber-500', label: 'Tinggi' };
    case 'sedang':
      return { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-300', dot: 'bg-blue-500', label: 'Sedang' };
    case 'rendah':
    default:
      return { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300', dot: 'bg-emerald-500', label: 'Rendah' };
  }
}

/**
 * Menghitung skala proyek dari nilai nominal & durasi
 */
export function calculateProjectScale(nilaiKontrak, durasiHari = 0, scaleTiers = DEFAULT_SCALE_TIERS) {
  const val = Math.max(0, Number(nilaiKontrak) || 0);
  const days = Math.max(0, Number(durasiHari) || 0);

  let match = scaleTiers.find(t => val <= t.max);
  if (!match) match = scaleTiers[scaleTiers.length - 1];

  let scale = match.scale;
  let label = match.label;
  if (scale === 'sedang' && days > 90) {
    scale = 'besar';
    label = 'Proyek Besar (Eskalasi Durasi)';
  } else if (scale === 'kecil' && days > 30) {
    scale = 'sedang';
    label = 'Proyek Sedang (Eskalasi Durasi)';
  }

  return { scale, label, nilaiKontrak: val, durasiHari: days };
}

/**
 * Hitung Financial Risk (0-100)
 */
export function calculateFinancialRisk({ nilaiKontrak, jumlahSo = 1, retensiPct = 0, hasOverspendHistory = false }) {
  let score = 15; // baseline
  const factors = [];

  // Nilai nominal
  if (nilaiKontrak >= 2_500_000_000) {
    score += 45;
    factors.push('Nilai kontrak mega (> Rp 2.5 Miliar)');
  } else if (nilaiKontrak >= 1_000_000_000) {
    score += 35;
    factors.push('Nilai kontrak major (> Rp 1 Miliar)');
  } else if (nilaiKontrak >= 500_000_000) {
    score += 25;
    factors.push('Nilai kontrak menengah-tinggi (> Rp 500 Juta)');
  } else if (nilaiKontrak >= 100_000_000) {
    score += 15;
    factors.push('Nilai kontrak menengah (Rp 100 - 500 Juta)');
  } else {
    factors.push('Nilai kontrak kecil (< Rp 100 Juta)');
  }

  // Kompleksitas Multi-SO / Grand PO
  if (jumlahSo > 3) {
    score += 15;
    factors.push(`Konsolidasi ${jumlahSo} Sales Order (risiko alokasi biaya silang)`);
  } else if (jumlahSo > 1) {
    score += 8;
    factors.push(`Multi-SO (${jumlahSo} Sales Order)`);
  }

  // Retensi
  if (retensiPct >= 10) {
    score += 12;
    factors.push(`Retensi pembayaran tinggi (${retensiPct}%)`);
  } else if (retensiPct >= 5) {
    score += 8;
    factors.push(`Retensi pembayaran standar (${retensiPct}%)`);
  }

  if (hasOverspendHistory) {
    score += 10;
    factors.push('Riwayat pengajuan pengeluaran mendekati pagu RAP');
  }

  const bounded = Math.min(100, Math.max(0, score));
  return {
    score: bounded,
    level: getRiskLevelFromScore(bounded),
    factors
  };
}

/**
 * Hitung HSE / Safety Risk (0-100)
 */
export function calculateHseRisk({
  isLivePlant = false,
  isConfinedSpace = false,
  isWorkingAtHeight = false,
  isHotWorkOrBlasting = false,
  isChemicalHazard = false
}) {
  let score = 10; // baseline
  const factors = [];

  if (isConfinedSpace) {
    score += 30;
    factors.push('Pekerjaan Ruang Terbatas / Confined Space (Tangki / Bejana)');
  }
  if (isLivePlant) {
    score += 20;
    factors.push('Pabrik Manufaktur Aktif / Live Operating Plant');
  }
  if (isChemicalHazard) {
    score += 12;
    factors.push('Area Paparan Bahan Kimia / Uap Hidrokarbon');
  }
  if (isWorkingAtHeight) {
    score += 12;
    factors.push('Bekerja di Ketinggian / Working at Height (> 2m, Perancah)');
  }
  if (isHotWorkOrBlasting) {
    score += 10;
    factors.push('Abrasive Sandblasting Tekanan Tinggi / Hot Work Permit');
  }

  if (factors.length === 0) {
    factors.push('Pekerjaan lingkungan terbuka non-hazardous standar');
  }

  const bounded = Math.min(100, Math.max(0, score));
  return {
    score: bounded,
    level: getRiskLevelFromScore(bounded),
    factors
  };
}

/**
 * Hitung Quality / Technical Risk (0-100)
 */
export function calculateQualityRisk({
  requiresSa25OrHigher = false,
  highDftMicron = false,
  isChemicalResistanceFloor = false,
  warrantyYears = 1,
  ambientSensitive = false
}) {
  let score = 15; // baseline
  const factors = [];

  if (requiresSa25OrHigher) {
    score += 22;
    factors.push('Preparasi permukaan abrasive Sa 2.5 / Sa 3 (profil 40-75µ)');
  }
  if (highDftMicron) {
    score += 16;
    factors.push('Sistem multi-layer ketebalan cat tinggi (DFT > 250µm)');
  }
  if (isChemicalResistanceFloor) {
    score += 14;
    factors.push('Lapisan heavy duty ketahanan kimia/oli industri');
  }
  if (warrantyYears >= 3) {
    score += 15;
    factors.push(`Komitmen garansi panjang (${warrantyYears} tahun)`);
  } else if (warrantyYears >= 2) {
    score += 8;
    factors.push(`Komitmen garansi ${warrantyYears} tahun`);
  }
  if (ambientSensitive) {
    score += 10;
    factors.push('Sangat sensitif kelembaban udara (RH < 85%) & Dew Point');
  }

  if (factors.length === 0) {
    factors.push('Pengecatan arsitektural / proteksi standar');
  }

  const bounded = Math.min(100, Math.max(0, score));
  return {
    score: bounded,
    level: getRiskLevelFromScore(bounded),
    factors
  };
}

/**
 * Hitung Operational & Schedule Risk (0-100)
 */
export function calculateOperationalRisk({
  durasiHari = 0,
  isMultiCrew = false,
  isFactoryShiftConstrained = false,
  largeVolumeSandOrScaffold = false
}) {
  let score = 15; // baseline
  const factors = [];

  if (durasiHari > 90) {
    score += 25;
    factors.push(`Durasi panjang (${durasiHari} hari) lintas kuartal`);
  } else if (durasiHari > 45) {
    score += 16;
    factors.push(`Durasi menengah (${durasiHari} hari)`);
  } else if (durasiHari > 14) {
    score += 8;
    factors.push(`Durasi standar (${durasiHari} hari)`);
  }

  if (isMultiCrew) {
    score += 16;
    factors.push('Koordinasi multi-regu kerja paralel (lantai, dinding, tangki)');
  }
  if (isFactoryShiftConstrained) {
    score += 12;
    factors.push('Jadwal kerja terbatas jendela waktu shift pabrik klien');
  }
  if (largeVolumeSandOrScaffold) {
    score += 8;
    factors.push('Logistik material masif (pasir blasting puluhan ton & unit perancah)');
  }

  if (factors.length === 0) {
    factors.push('Pelaksanaan operasional regu tunggal sederhana');
  }

  const bounded = Math.min(100, Math.max(0, score));
  return {
    score: bounded,
    level: getRiskLevelFromScore(bounded),
    factors
  };
}

/**
 * Mesin utama evaluasi risiko proyek komprehensif
 */
export function evaluateProjectComprehensiveRisk({
  project = {},
  grandPo = null,
  soList = [],
  weights = DEFAULT_RISK_WEIGHTS,
  scaleTiers = DEFAULT_SCALE_TIERS,
  thresholds = DEFAULT_RISK_THRESHOLDS
}) {
  // 1. Ekstraksi Finansial & Durasi
  let totalNilai = 0;
  if (soList && soList.length > 0) {
    totalNilai = soList.reduce((acc, so) => acc + (Number(so.grand_total) || Number(so.subtotal) || 0), 0);
  } else if (project.so_customer) {
    totalNilai = Number(project.so_customer.grand_total) || Number(project.so_customer.subtotal) || 0;
  }

  const startDateStr = project.start_date || (soList[0]?.tanggal_so) || null;
  const endDateStr = project.end_date || null;
  let durasiHari = 0;
  if (startDateStr && endDateStr) {
    const diff = new Date(endDateStr) - new Date(startDateStr);
    durasiHari = Math.max(0, Math.round(diff / (1000 * 60 * 60 * 24)));
  } else if (durasiHari === 0 && grandPo?.id === 2) {
    durasiHari = 102; // fallback data live Fuchs
  }

  // 2. Evaluasi Karakteristik / DNA Proyek dari nama & data teks
  const fullText = [
    project.name || '',
    project.description || '',
    project.jenis_project || '',
    grandPo?.nama || '',
    grandPo?.end_user_name || '',
    grandPo?.catatan || '',
    ...(soList.map(s => `${s.nomor_po_customer || ''} ${s.notes || ''}`))
  ].join(' ').toLowerCase();

  const isLivePlant = /fuchs|plant|pabrik|refinery|kilang|petro|chemical|industri/i.test(fullText);
  const isConfinedSpace = /tangki|tank|bejana|confined|silo|pipa dalam/i.test(fullText);
  const isWorkingAtHeight = /ketinggian|scaffolding|wall|dinding|facade|atap|struktur baja/i.test(fullText);
  const isHotWorkOrBlasting = /blasting|sandblast|pasir|kompresor/i.test(fullText);
  const isChemicalHazard = /fuchs|oli|lubricant|pelumas|kimia|thinner|solvent|acid|basa/i.test(fullText);
  const requiresSa25OrHigher = /sa 2\.5|sa 3|sandblast|abrasive/i.test(fullText);
  const isChemicalResistanceFloor = /epoxy|floor coating|flooring|polyurethane|pu concrete/i.test(fullText);
  const isMultiCrew = (soList.length >= 3) || (/multi|tangki.*lantai|flooring.*painting/i.test(fullText));

  // 3. Hitung breakdown per kategori
  const financial = calculateFinancialRisk({
    nilaiKontrak: totalNilai,
    jumlahSo: Math.max(1, soList.length),
    retensiPct: Number(project.retensi_percentage) || 5,
    hasOverspendHistory: false
  });

  const hse = calculateHseRisk({
    isLivePlant,
    isConfinedSpace,
    isWorkingAtHeight,
    isHotWorkOrBlasting,
    isChemicalHazard
  });

  const quality = calculateQualityRisk({
    requiresSa25OrHigher,
    highDftMicron: true,
    isChemicalResistanceFloor,
    warrantyYears: 2,
    ambientSensitive: requiresSa25OrHigher || isChemicalResistanceFloor
  });

  const operational = calculateOperationalRisk({
    durasiHari,
    isMultiCrew,
    isFactoryShiftConstrained: isLivePlant,
    largeVolumeSandOrScaffold: requiresSa25OrHigher || isWorkingAtHeight
  });

  // 4. Hitung Skor Total Terbobot
  const w = { ...DEFAULT_RISK_WEIGHTS, ...weights };
  const totalScore = Math.round(
    (financial.score * w.financial) +
    (hse.score * w.hse) +
    (quality.score * w.quality) +
    (operational.score * w.operational)
  );

  const totalLevel = getRiskLevelFromScore(totalScore, thresholds);
  const scaleInfo = calculateProjectScale(totalNilai, durasiHari, scaleTiers);

  // 5. Kumpulkan DNA Tags
  const tags = [];
  if (isLivePlant) tags.push({ key: 'LIVE_PLANT', label: 'Live Operating Plant', color: 'bg-red-50 text-red-700 border-red-200' });
  if (isConfinedSpace) tags.push({ key: 'CONFINED_SPACE', label: 'Confined Space (Tangki)', color: 'bg-purple-50 text-purple-700 border-purple-200' });
  if (isWorkingAtHeight) tags.push({ key: 'WORKING_AT_HEIGHT', label: 'Working at Height', color: 'bg-amber-50 text-amber-700 border-amber-200' });
  if (requiresSa25OrHigher) tags.push({ key: 'ABRASIVE_BLASTING', label: 'Sandblasting Sa 2.5', color: 'bg-stone-100 text-stone-700 border-stone-300' });
  if (isChemicalResistanceFloor) tags.push({ key: 'FLOOR_COATING', label: 'Heavy Duty Floor Coating', color: 'bg-blue-50 text-blue-700 border-blue-200' });
  if (soList.length > 1) tags.push({ key: 'MULTI_SO', label: `Grand PO (${soList.length} SO)`, color: 'bg-indigo-50 text-indigo-700 border-indigo-200' });

  // 6. Mode Tata Kelola Gate yang Disarankan
  let suggestedGateMode = 'standard';
  if (totalLevel === 'kritis') suggestedGateMode = 'strict';
  else if (totalLevel === 'tinggi') suggestedGateMode = 'enforced';
  else if (totalLevel === 'rendah' && scaleInfo.scale === 'kecil') suggestedGateMode = 'streamline';

  return {
    scale: scaleInfo.scale,
    scaleLabel: scaleInfo.label,
    nilaiKontrak: totalNilai,
    durasiHari,
    totalScore,
    totalLevel,
    badge: getRiskLevelBadge(totalLevel),
    suggestedGateMode,
    weights: w,
    breakdown: {
      financial,
      hse,
      quality,
      operational
    },
    tags
  };
}
