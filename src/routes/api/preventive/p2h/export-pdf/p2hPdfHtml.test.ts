// src/routes/api/preventive/p2h/export-pdf/p2hPdfHtml.test.ts
import { describe, it, expect } from 'vitest';
import { buildP2hUnitPdfHtml } from './p2hPdfHtml.js';

describe('p2hPdfHtml', () => {
  it('merender HTML PDF P2H unit lengkap dengan item, foto base64, WO, dan TTD digital', () => {
    const html = buildP2hUnitPdfHtml({
      equipment: { name: 'MOBIL Daihatsu Luxio', code: 'ASET/EPI/KDR/MOB/0006' },
      categoryName: 'Kendaraan Roda 4',
      locationName: 'Bengkel Internal',
      operatorName: 'YOSO',
      overallResult: 'No-Go',
      workOrder: { id: 'wo-1', wo_number: 'WO-2026-009' },
      session: {
        id: 'sess-1',
        date: '2026-11-19',
        hoursmeter: 193825,
        scan_method: 'scan',
        keterangan_tambahan: 'Radiator kering'
      },
      checklistItems: [
        {
          itemName: 'Level Air Radiator',
          isCritical: true,
          wajibFoto: true,
          result: 'No-Go',
          numericValue: null,
          notes: 'Tabung reservoir kosong',
          hasPhoto: true
        }
      ],
      photos: [
        { label: 'Level Air Radiator', result: 'No-Go', notes: 'Tabung kosong', dataUrl: 'data:image/jpeg;base64,AAA' }
      ],
      startSigSrc: 'data:image/png;base64,BBB',
      endSigSrc: null,
      printedBy: 'yoso@eltama.id'
    });

    expect(html).toContain('MOBIL Daihatsu Luxio');
    expect(html).toContain('NO-GO — TEMUAN / PERLU TINDAK LANJUT');
    expect(html).toContain('Level Air Radiator');
    expect(html).toContain('WO-2026-009');
    expect(html).toContain('data:image/jpeg;base64,AAA');
    expect(html).toContain('data:image/png;base64,BBB');
  });
});
