import { describe, it, expect, vi, beforeEach } from 'vitest';

// Directus palsu dalam memori dengan latensi, supaya rebuild yang tumpang-tindih benar-benar bisa berlomba.
const directus = vi.fn();
vi.mock('./directus', () => ({ directusServerJson: (...a: any[]) => (directus as any)(...a) }));
const { rebuildProjectStockBalance, splitBalanceDuplicates } = await import('./projectLedger');

const tick = () => new Promise((r) => setTimeout(r, 5));

let ledger: any[];
let balance: any[];
let nextId: number;
let ledgerReads: number;

function setup({ ledgerRows, balanceRows = [] }: { ledgerRows: any[]; balanceRows?: any[] }) {
  ledger = ledgerRows;
  balance = balanceRows.map((b: any) => ({ ...b }));
  nextId = Math.max(1000, ...balance.map((b: any) => b.id)) + 1;
  ledgerReads = 0;
  directus.mockReset().mockImplementation(async (url: string, opt: any = {}) => {
    await tick();
    const method = opt.method || 'GET';
    if (url.startsWith('/items/project_stock_ledger?')) {
      ledgerReads++;
      return { data: ledger };
    }
    if (url.startsWith('/items/project_budgets?')) return { data: [] };
    if (url === '/items/project_stock_balance' && method === 'POST') {
      const row = { id: nextId++, ...JSON.parse(opt.body) };
      balance.push(row);
      return { data: row };
    }
    if (url === '/items/project_stock_balance' && method === 'DELETE') {
      const { keys } = JSON.parse(opt.body) as { keys: number[] };
      balance = balance.filter((b: any) => !keys.includes(b.id));
      return null;
    }
    if (url.startsWith('/items/project_stock_balance/') && method === 'PATCH') {
      const id = Number(url.split('/').pop());
      Object.assign(balance.find((b: any) => b.id === id)!, JSON.parse(opt.body));
      return { data: {} };
    }
    if (url.startsWith('/items/project_stock_balance?')) return { data: balance.filter((b: any) => b.project_id === 972) };
    throw new Error(`url tak terduga: ${method} ${url}`);
  });
}

const ledgerRow = (item_id: number, quantity: number, i = 0) => ({
  project_id: 972, item_id, transaction_type: 'IN-RECEIPT', quantity, date_created: `2026-10-26T03:00:0${i}Z`
});

describe('splitBalanceDuplicates', () => {
  it('mempertahankan id terkecil per kunci dan mengembalikan sisanya', () => {
    const rows = [{ id: 3369, item_id: 145 }, { id: 3365, item_id: 145 }, { id: 3366, item_id: 145 }, { id: 3375, item_id: 21786 }];
    const { keep, extraIds } = splitBalanceDuplicates(rows, (r: any) => r.item_id);
    expect(keep.get(145)).toBe(3365);
    expect(keep.get(21786)).toBe(3375);
    expect(extraIds.sort()).toEqual([3366, 3369]);
  });
  it('mengabaikan baris tanpa kunci dan toleran terhadap input kosong', () => {
    expect(splitBalanceDuplicates(null, (r: any) => r.item_id)).toEqual({ keep: new Map(), extraIds: [] });
    expect(splitBalanceDuplicates([{ id: 1, item_id: null }], (r: any) => r.item_id).extraIds).toEqual([]);
  });
});

describe('rebuildProjectStockBalance — scope proyek', () => {
  beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}));

  it('panggilan bersamaan tidak membuat baris saldo kembar (kasus SJ 0059 proyek #972)', async () => {
    setup({ ledgerRows: [ledgerRow(145, 1), ledgerRow(91, 10, 1), ledgerRow(21931, 20, 2)] });
    await Promise.all(Array.from({ length: 6 }, () => rebuildProjectStockBalance({ projectId: 972 })));
    expect(balance).toHaveLength(3);
    expect(new Set(balance.map((b: any) => b.item_id)).size).toBe(3);
    // satu putaran berjalan + satu putaran lanjutan bersama, bukan 6 putaran
    expect(ledgerReads).toBeLessThanOrEqual(2);
  });

  it('putaran lanjutan membaca ledger yang ditulis saat rebuild pertama berjalan', async () => {
    setup({ ledgerRows: [ledgerRow(145, 1)] });
    const first = rebuildProjectStockBalance({ projectId: 972 });
    await tick();
    ledger = [...ledger, ledgerRow(145, 2, 1)]; // masuk setelah rebuild pertama mulai
    await Promise.all([first, rebuildProjectStockBalance({ projectId: 972 })]);
    expect(balance.find((b: any) => b.item_id === 145).qty_on_hand).toBe(3);
  });

  it('menghapus baris kembar yang sudah ada dan hanya memperbarui yang dipertahankan', async () => {
    setup({
      ledgerRows: [ledgerRow(145, 1)],
      balanceRows: [
        { id: 3365, project_id: 972, item_id: 145, qty_on_hand: 1 },
        { id: 3366, project_id: 972, item_id: 145, qty_on_hand: 1 },
        { id: 3369, project_id: 972, item_id: 145, qty_on_hand: 1 }
      ]
    });
    const res = await rebuildProjectStockBalance({ projectId: 972 });
    expect(res.duplicatesRemoved).toBe(2);
    expect(balance.map((b: any) => b.id)).toEqual([3365]);
    expect(balance[0].qty_on_hand).toBe(1);
  });

  it('kegagalan hapus duplikat tidak menggagalkan rebuild', async () => {
    setup({ ledgerRows: [ledgerRow(145, 1)], balanceRows: [{ id: 1, project_id: 972, item_id: 145 }, { id: 2, project_id: 972, item_id: 145 }] });
    const base = directus.getMockImplementation();
    directus.mockImplementation(async (url: string, opt: any = {}) => {
      if (opt.method === 'DELETE') throw new Error('boom');
      return base(url, opt);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await rebuildProjectStockBalance({ projectId: 972 });
    expect(res.duplicatesRemoved).toBe(0);
    expect(res.groupsProcessed).toBe(1);
  });

  it('error rebuild tidak membekukan antrean: panggilan berikutnya tetap jalan', async () => {
    setup({ ledgerRows: [ledgerRow(145, 1)] });
    const base = directus.getMockImplementation();
    let fail = true;
    directus.mockImplementation(async (url: string, opt: any = {}) => {
      if (fail && url.startsWith('/items/project_stock_ledger?')) throw new Error('timeout');
      return base(url, opt);
    });
    await expect(rebuildProjectStockBalance({ projectId: 972 })).rejects.toThrow('timeout');
    fail = false;
    await expect(rebuildProjectStockBalance({ projectId: 972 })).resolves.toMatchObject({ groupsProcessed: 1 });
  });
});
