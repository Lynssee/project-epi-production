import { describe, it, expect, vi, beforeEach } from 'vitest';

const directusServerJson = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: unknown[]) => directusServerJson(...a) }));

const { formatWoNumber, allocateWoNumber, autoWoIdentity } = await import('./woNumber');

beforeEach(() => { directusServerJson.mockReset(); });

describe('formatWoNumber', () => {
	it('WO-YYMM-NNNN dari tanggal kejadian', () => {
		expect(formatWoNumber('2026-11-16', 7)).toBe('WO-2611-0007');
		expect(formatWoNumber('2026-01-02', 9338)).toBe('WO-2601-9338');
		expect(formatWoNumber('2026-11-16', 12345)).toBe('WO-2611-2345');
	});
	it('tanggal rusak/kosong tidak melempar', () => {
		expect(formatWoNumber('', 1)).toMatch(/^WO-\d{4}-0001$/);
	});
});

describe('allocateWoNumber', () => {
	it('mengembalikan nomor yang belum dipakai', async () => {
		directusServerJson.mockResolvedValue({ data: [] });
		expect(await allocateWoNumber('2026-11-16')).toMatch(/^WO-2611-\d{4}$/);
		expect(directusServerJson).toHaveBeenCalledTimes(1);
	});
	it('bentrok → coba nomor lain', async () => {
		directusServerJson.mockResolvedValueOnce({ data: [{ id: 'x' }] }).mockResolvedValueOnce({ data: [] });
		expect(await allocateWoNumber('2026-11-16')).toMatch(/^WO-2611-\d{4}$/);
		expect(directusServerJson).toHaveBeenCalledTimes(2);
	});
	it('cek keunikan gagal → tetap bernomor (tidak melempar)', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		directusServerJson.mockImplementation(async () => { throw new Error('403'); });
		expect(await allocateWoNumber('2026-11-16')).toMatch(/^WO-2611-\d{4}$/);
	});
});

describe('autoWoIdentity', () => {
	it('mengisi wo_number DAN created_at', async () => {
		directusServerJson.mockResolvedValue({ data: [] });
		const id = await autoWoIdentity('2026-11-16');
		expect(id.wo_number).toMatch(/^WO-2611-\d{4}$/);
		expect(id.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
	});
});
