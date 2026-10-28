// PRJ-06/PRJ-10 — getRABvsAktualisasi: alias kategori, packing_* di luar Total RAP, kategori tak dikenal tidak dibuang.
import { describe, it, expect, vi } from 'vitest';

vi.mock('./secureDirectus', () => ({
  secureDirectusJson: vi.fn(async (url: string) => {
    if (url.includes('project_aktualisasi_category')) return { data: [] };
    if (url.includes('/items/project_expenses')) {
      return { data: [
        { id: 1, expense_type: 'jasa', expense_amount: 300, project_id: 1 },
        { id: 2, expense_type: 'reimbursement', expense_amount: 50, project_id: 1 },
        { id: 3, expense_type: 'aneh_banget', expense_amount: 7, project_id: 1 },
        { id: 4, expense_type: 'jasa', expense_amount: 100, project_id: 1, is_accrual: true }
      ] };
    }
    return { data: [] };
  }),
  secureDirectusFetch: vi.fn(),
  getIdToken: vi.fn()
}));
vi.mock('$lib/utils/offlineQueue', () => ({ enqueue: vi.fn(), flushQueue: vi.fn(), registerAutoFlush: vi.fn(), getQueue: vi.fn(() => []) }));

import { getRABvsAktualisasi } from './projectAktualisasiApi';

describe('getRABvsAktualisasi (PRJ-06/10)', () => {
  it('man_power→jasa, reimbursement→operasional, packing_* terpisah, header diabaikan, tak dikenal→lain_lain', async () => {
    const rab = [
      { budget_category: 'man_power', planned_amount: 1000 },
      { budget_category: 'supplier', planned_amount: 500 },
      { budget_category: 'packing_supplier', planned_amount: 400 },
      { budget_category: 'jasa', planned_amount: 999, is_category_header: true },
      { budget_category: 'zzz', planned_amount: 20 }
    ];
    const r: any = await getRABvsAktualisasi(1, rab as any);
    expect(r.success).toBe(true);
    expect(r.data.categories.jasa).toMatchObject({ rab: 1000, actual: 400 });
    expect(r.data.akrual_belum_final).toBe(100);
    expect(r.data.categories.operasional.actual).toBe(50);
    expect(r.data.categories.lain_lain).toMatchObject({ rab: 20, actual: 7 });
    expect(r.data.grand_rab).toBe(1520);
    expect(r.data.packing_outside_rap).toBe(400);
    expect(r.data.unknown_categories).toEqual({ zzz: 1, aneh_banget: 1 });
  });
});
