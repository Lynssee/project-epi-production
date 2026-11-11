// src/lib/utils/projectRiskEngine.test.js
import { describe, it, expect } from 'vitest';
import {
  calculateProjectScale,
  calculateFinancialRisk,
  calculateHseRisk,
  evaluateProjectComprehensiveRisk
} from './projectRiskEngine.js';

describe('projectRiskEngine', () => {
  it('menghitung skala proyek dari nilai nominal & durasi secara akurat', () => {
    // Proyek kecil
    const s1 = calculateProjectScale(50_000_000, 7);
    expect(s1.scale).toBe('kecil');

    // Proyek sedang
    const s2 = calculateProjectScale(350_000_000, 30);
    expect(s2.scale).toBe('sedang');

    // Proyek besar (Fuchs: 1.61 Miliar, 102 Hari)
    const s3 = calculateProjectScale(1_612_754_250, 102);
    expect(s3.scale).toBe('besar');

    // Eskalasi durasi: nilai sedang tapi durasi > 90 hari naik ke besar
    const s4 = calculateProjectScale(200_000_000, 100);
    expect(s4.scale).toBe('besar');
  });

  it('menghitung breakdown financial risk', () => {
    const fin = calculateFinancialRisk({
      nilaiKontrak: 1_612_754_250,
      jumlahSo: 5,
      retensiPct: 5,
      hasOverspendHistory: false
    });
    // 15 (base) + 35 (>1M) + 15 (>3 SO) + 8 (5% retensi) = 73
    expect(fin.score).toBe(73);
    expect(fin.level).toBe('tinggi');
    expect(fin.factors.length).toBeGreaterThanOrEqual(3);
  });

  it('menghitung breakdown HSE risk untuk lingkungan pabrik & tangki', () => {
    const hse = calculateHseRisk({
      isLivePlant: true,
      isConfinedSpace: true,
      isWorkingAtHeight: true,
      isHotWorkOrBlasting: true,
      isChemicalHazard: true
    });
    // 10 + 30 + 20 + 12 + 12 + 10 = 94
    expect(hse.score).toBe(94);
    expect(hse.level).toBe('kritis');

    // HSE moderat: hanya ketinggian & blasting tanpa tangki
    const hseMod = calculateHseRisk({
      isLivePlant: false,
      isConfinedSpace: false,
      isWorkingAtHeight: true,
      isHotWorkOrBlasting: true,
      isChemicalHazard: false
    });
    // 10 + 12 + 10 = 32
    expect(hseMod.score).toBe(32);
    expect(hseMod.level).toBe('rendah');
  });

  it('menghitung evaluasi proyek komprehensif kasus riil PT Fuchs Fase 3', () => {
    const mockFuchsProject = {
      id: 962,
      name: 'PT. FUCHS INDONESIA - PO/EPI/0210826/1894 (Flooring)',
      start_date: '2026-08-21',
      end_date: '2026-11-30',
      jenis_project: 'Epoxy / Floor Coating',
      retensi_percentage: 5
    };

    const mockGrandPo = {
      id: 2,
      nomor_gpo: 'GPO-2610-2',
      nama: 'Proyek Fuchs Fase 3— PT. FUCHS INDONESIA (2026)',
      end_user_name: 'PT. FUCHS INDONESIA',
      site_alamat: 'JL. Jababeka VI SFB Blok J 6 KL, Harja Mekar, Cikarang Utara',
      catatan: 'Pekerjaan Epoxy Lantai, Pengecatan Dinding & Blasting Tangki'
    };

    const mockSoList = [
      { id: 1870, nomor_so: 'PO/EPI/0180826/1870', grand_total: 271_680_000, notes: 'Wall & Electric' },
      { id: 1894, nomor_so: 'PO/EPI/0210826/1894', grand_total: 338_305_800, notes: 'Flooring Area 1' },
      { id: 1895, nomor_so: 'PO/EPI/0210826/1895', grand_total: 349_477_950, notes: 'Flooring Area 2' },
      { id: 1896, nomor_so: 'PO/EPI/0210826/1896', grand_total: 304_184_400, notes: 'Tangki Sandblasting & Coating' },
      { id: 1897, nomor_so: 'PO/EPI/0210826/1897', grand_total: 349_106_100, notes: 'General Painting' }
    ];

    const result = evaluateProjectComprehensiveRisk({
      project: mockFuchsProject,
      grandPo: mockGrandPo,
      soList: mockSoList
    });

    // 1. Skala harus BESAR
    expect(result.scale).toBe('besar');
    expect(result.nilaiKontrak).toBe(1_612_754_250);
    expect(result.durasiHari).toBe(101); // 21 Ags ke 30 Nov

    // 2. Breakdown Skor per Kategori
    expect(result.breakdown.financial.score).toBe(73);
    expect(result.breakdown.financial.level).toBe('tinggi');

    expect(result.breakdown.hse.score).toBe(94);
    expect(result.breakdown.hse.level).toBe('kritis');

    expect(result.breakdown.quality.score).toBe(85);
    expect(result.breakdown.quality.level).toBe('tinggi');

    expect(result.breakdown.operational.score).toBe(76);
    expect(result.breakdown.operational.level).toBe('tinggi');

    // 3. Total Risk Score & Level
    // (73 * 0.25) + (94 * 0.3) + (85 * 0.25) + (76 * 0.2) = 18.25 + 28.2 + 21.25 + 15.2 = 82.9 -> 83
    expect(result.totalScore).toBe(83);
    expect(result.totalLevel).toBe('tinggi');
    expect(result.suggestedGateMode).toBe('enforced');

    // 4. DNA Tags harus mendeteksi tag krusial
    const tagKeys = result.tags.map(t => t.key);
    expect(tagKeys).toContain('LIVE_PLANT');
    expect(tagKeys).toContain('CONFINED_SPACE');
    expect(tagKeys).toContain('WORKING_AT_HEIGHT');
    expect(tagKeys).toContain('MULTI_SO');
  });
});
