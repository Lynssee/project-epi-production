import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));
vi.mock('$lib/server/gateDefinitionsMode', () => ({ resolveGateMode: vi.fn(async () => 'warn') }));

const { decideKomplainLock, findKomplainLocks, evaluateKomplainLock } = await import('./komplainLockGate');
const { resolveGateMode } = await import('$lib/server/gateDefinitionsMode');

const lock = { itemId: 11, namaBarang: 'Cat Epoxy', logId: 5, jenis: 'salah_kirim', nomorSj: 'SJ-1' };

describe('decideKomplainLock', () => {
	it('tanpa kunci => pass di semua mode', () => {
		for (const m of ['shadow', 'soft', 'warn', 'hard'] as const) expect(decideKomplainLock(m, []).decision).toBe('pass');
	});
	it('warn/soft => warn (bisa lanjut), hard => block, shadow => pass tanpa pesan', () => {
		expect(decideKomplainLock('warn', [lock])).toMatchObject({ decision: 'warn' });
		expect(decideKomplainLock('soft', [lock]).decision).toBe('warn');
		const hard = decideKomplainLock('hard', [lock]);
		expect(hard.decision).toBe('block');
		expect(hard.message).toContain('Cat Epoxy');
		expect(decideKomplainLock('shadow', [lock])).toMatchObject({ decision: 'pass', message: null });
	});
});

describe('findKomplainLocks', () => {
	it('satu query terfilter proyek+barang+status aktif+penanda komplain; memetakan hasil', async () => {
		const dx = vi.fn(async () => ({ data: [{ id: 5, item_id: 11, nama_barang: 'Cat Epoxy', jenis: 'salah_kirim', batch_no: 'KOMPLAIN:SJ-1' }] }));
		const r = await findKomplainLocks(9, [11, 11, 12], dx);
		expect(dx).toHaveBeenCalledTimes(1);
		const url = decodeURIComponent((dx.mock.calls[0] as any[])[0] as string);
		expect(url).toContain('"project_id":{"_eq":9}');
		expect(url).toContain('"item_id":{"_in":[11,12]}');
		expect(url).toContain('"open","in_review"');
		expect(url).toContain('KOMPLAIN:');
		expect(r).toEqual([{ itemId: 11, namaBarang: 'Cat Epoxy', logId: 5, jenis: 'salah_kirim', nomorSj: 'SJ-1' }]);
	});
	it('tanpa barang / proyek tak valid => [] tanpa query', async () => {
		const dx = vi.fn();
		expect(await findKomplainLocks(9, [], dx)).toEqual([]);
		expect(await findKomplainLocks(NaN, [1], dx)).toEqual([]);
		expect(dx).not.toHaveBeenCalled();
	});
	it('gagal baca => null (fail-open, bukan melempar)', async () => {
		const dx = vi.fn(async () => { throw new Error('403 FORBIDDEN'); });
		expect(await findKomplainLocks(9, [11], dx)).toBeNull();
	});
});

describe('evaluateKomplainLock', () => {
	it('gagal resolusi mode => shadow (tidak pernah mengunci karena gangguan)', async () => {
		(resolveGateMode as any).mockRejectedValueOnce(new Error('x'));
		const v = await evaluateKomplainLock(9, []);
		expect(v.mode).toBe('shadow');
		expect(v.decision).toBe('pass');
	});
});
