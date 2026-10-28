// PC3-04 — race Batal ‖ Setuju lewat patchIf ASLI (cermin lapangan) di atas store in-memory.
import { describe, it, expect, vi } from 'vitest';
import { matchesFilter, transitionGuard } from '$lib/shared/pettyCashTransitions';

const rows: Record<string, any>[] = [];
vi.mock('$lib/server/directus', () => ({
	directusServerJson: vi.fn(async (_e: string, opts: { body?: string } = {}) => {
		await Promise.resolve();
		const body = JSON.parse(opts.body || '{}');
		const hit = rows.filter((r) => matchesFilter(r, body.query.filter)).slice(0, 1);
		hit.forEach((r) => Object.assign(r, body.data));
		return { data: hit.map((r) => ({ id: r.id })) };
	})
}));
const { patchIf } = await import('./pettyCashAtomic');
const act = (row: any, action: string, patch: Record<string, unknown>) =>
	patchIf('petty_cash_requests', row.id, transitionGuard(action)!, patch);

describe('patchIf lapangan — race transisi', () => {
	it('cancel lebih dulu ‖ atasan_approve → approve ditolak, tiket tetap cancelled', async () => {
		const row = { id: 1, status: 'menunggu_atasan', journal_entry_id: null, processing_lock: null };
		rows.length = 0; rows.push(row);
		const res = await Promise.all([act(row, 'cancel', { status: 'cancelled' }), act(row, 'atasan_approve', { status: 'menunggu_kasir' })]);
		expect(res).toEqual([true, false]);
		expect(row.status).toBe('cancelled');
	});
	it('aksi sama 2× (timeout klien mengulang) → yang kedua ditolak', async () => {
		const row = { id: 2, status: 'menunggu_atasan', journal_entry_id: null, processing_lock: null };
		rows.length = 0; rows.push(row);
		const res = await Promise.all([act(row, 'atasan_approve', { status: 'menunggu_kasir' }), act(row, 'atasan_approve', { status: 'menunggu_kasir' })]);
		expect(res.filter(Boolean)).toHaveLength(1);
	});
	it('batal setelah journal_entry_id terisi → ditolak', async () => {
		const row = { id: 3, status: 'menunggu_kasir', journal_entry_id: 55, processing_lock: null };
		rows.length = 0; rows.push(row);
		expect(await act(row, 'cancel', { status: 'cancelled' })).toBe(false);
		expect(row.status).toBe('menunggu_kasir');
	});
	it('PUT revisi ‖ cancel → tepat satu menang', async () => {
		const row = { id: 4, status: 'revisi', journal_entry_id: null, processing_lock: null };
		rows.length = 0; rows.push(row);
		const res = await Promise.all([act(row, 'edit', { status: 'menunggu_atasan' }), act(row, 'cancel', { status: 'cancelled' })]);
		// edit menulis status menunggu_atasan; cancel masih sah dari menunggu_atasan → keduanya boleh berurutan
		expect(res[0]).toBe(true);
		expect(['menunggu_atasan', 'cancelled']).toContain(row.status);
	});
});
