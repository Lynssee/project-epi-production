// Grand PO (audit lapangan) — pagu pembelian lokal harus menjumlah RAB approved SEMUA PO proyek gabungan.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./directus', () => ({ directusServerJson: vi.fn() }));
vi.mock('./approvalSubmit', () => ({ createApprovalRequest: vi.fn() }));
vi.mock('./masterPengajuanSubmit', () => ({ createMasterPengajuanEntry: vi.fn() }));

import { directusServerJson } from './directus';
import { computeProjectPaguSisa } from './pembelianLokalProyekSubmit';

const dx = directusServerJson as unknown as ReturnType<typeof vi.fn>;

function wire({ siblings = [{ id: 1998 }] as any, siblingFail = false, rabs = [{ id: 11 }, { id: 12 }] as any[] } = {}) {
	const calls: string[] = [];
	dx.mockImplementation(async (path: string) => {
		calls.push(path);
		if (path.startsWith('/items/projects/')) return { data: { id: 978, name: 'PLN', so_customer_id: 2000 } };
		if (path.startsWith('/items/so_customer?filter[project_id]')) {
			if (siblingFail) throw new Error('403');
			return { data: siblings };
		}
		if (path.startsWith('/items/so_rab?')) return { data: rabs };
		if (path.startsWith('/items/so_rab_items')) return { data: [{ planned_amount: 1000 }, { planned_amount: 500 }] };
		if (path.startsWith('/items/pengajuan?')) return { data: [] };
		if (path.startsWith('/items/project_aktualisasi')) return { data: [{ actual_amount: 300 }] };
		if (path.startsWith('/items/pembelian_lokal_proyek')) return { data: [] };
		throw new Error('Path tak dikenal: ' + path);
	});
	return calls;
}

beforeEach(() => vi.clearAllMocks());

describe('computeProjectPaguSisa — multi-PO', () => {
	it('RAB approved SEMUA PO (utama + saudara) dijumlahkan; kueri memakai _in', async () => {
		const calls = wire();
		const r = await computeProjectPaguSisa(978);
		expect(calls.find((c) => c.startsWith('/items/so_rab?'))).toContain('filter[so_customer_id][_in]=2000,1998');
		expect(calls.find((c) => c.startsWith('/items/so_rab_items'))).toContain('filter[so_rab_id][_in]=11,12');
		expect(r).toMatchObject({ status: 'ok', remaining: 1500 - 300 });
	});

	it('proyek 1-PO: perilaku lama (satu SO, satu RAB)', async () => {
		const calls = wire({ siblings: [], rabs: [{ id: 11 }] });
		const r = await computeProjectPaguSisa(978);
		expect(calls.find((c) => c.startsWith('/items/so_rab?'))).toContain('filter[so_customer_id][_in]=2000');
		expect(r.status).toBe('ok');
	});

	it('gagal membaca PO saudara → N/A (BUKAN pagu dari PO utama saja yang terlalu kecil)', async () => {
		wire({ siblingFail: true });
		const r = await computeProjectPaguSisa(978);
		expect(r.status).toBe('not_applicable');
		expect(r.message).toContain('gagal membaca PO proyek');
	});

	it('tidak ada RAB approved → N/A', async () => {
		wire({ rabs: [] });
		expect((await computeProjectPaguSisa(978)).status).toBe('not_applicable');
	});
});
