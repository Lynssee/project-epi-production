// RSM-01 §4.1 — markReturBerangkat: draft → dikirim, idempoten, foto wajib.
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Call = { path: string; method: string; body: any };
const calls: Call[] = [];
let header: any;

vi.mock('$lib/server/directus', () => ({
	directusServerJson: vi.fn(async (path: string, opts: any = {}) => {
		const method = opts?.method || 'GET';
		const body = opts?.body ? JSON.parse(opts.body) : null;
		calls.push({ path, method, body });
		if (method === 'GET' && path.startsWith('/items/retur_gudang/')) return { data: header };
		return { data: {} };
	})
}));
vi.mock('$lib/server/gateEnforcement', () => ({ getFieldGateMode: vi.fn(async () => 'shadow') }));

const { markReturBerangkat } = await import('./returGudangServer');
const actor = { actorName: 'Budi', actorUid: 'uid1' };

beforeEach(() => {
	calls.length = 0;
	header = { id: 3, nomor_retur: 'RTN/261023/001', status: 'draft', shipped_at: null, notes: null, project_id: 575 };
});

describe('markReturBerangkat', () => {
	it('draft + foto -> PATCH dikirim dengan shipped_at, foto_kirim, jejak activity_log', async () => {
		const r = await markReturBerangkat(3, { ...actor, fotoKirim: ['file-1'], driverName: 'ADYOSO', gps: { lat: -6.2, lng: 106.8 } });
		expect(r).toMatchObject({ status: 'dikirim', already: false });
		const patch = calls.find((c) => c.method === 'PATCH')!;
		expect(patch.body).toMatchObject({ status: 'dikirim', foto_kirim: ['file-1'], driver_name: 'ADYOSO' });
		expect(patch.body.shipped_at).toBeTruthy();
		expect(patch.body.notes).toContain('GPS berangkat -6.20000,106.80000');
		const log = calls.find((c) => c.path === '/items/activity_log')!;
		expect(log.body).toMatchObject({ module: 'retur_gudang', action: 'kirim', record_id: '3' });
	});

	it('idempoten: sudah dikirim -> tidak ada PATCH, shipped_at lama dipertahankan', async () => {
		header = { ...header, status: 'dikirim', shipped_at: '2026-10-23T01:00:00.000Z' };
		const r = await markReturBerangkat(3, { ...actor, fotoKirim: ['file-1'] });
		expect(r).toMatchObject({ already: true, shipped_at: '2026-10-23T01:00:00.000Z' });
		expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
	});

	it('tanpa foto ditolak dengan pesan jelas', async () => {
		await expect(markReturBerangkat(3, { ...actor, fotoKirim: [] })).rejects.toThrow(/Foto barang/);
		expect(calls.some((c) => c.method === 'PATCH')).toBe(false);
	});

	it('dokumen batal tidak bisa ditandai berangkat', async () => {
		header = { ...header, status: 'batal' };
		await expect(markReturBerangkat(3, { ...actor, fotoKirim: ['f'] })).rejects.toThrow(/tidak bisa ditandai berangkat/);
	});

	it('dokumen tak ditemukan', async () => {
		header = null;
		await expect(markReturBerangkat(3, { ...actor, fotoKirim: ['f'] })).rejects.toThrow(/tidak ditemukan/);
	});
});
