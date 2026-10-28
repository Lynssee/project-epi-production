import { beforeEach, describe, expect, it, vi } from 'vitest';

const directusServerJson = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: unknown[]) => directusServerJson(...a) }));

import { bookingHasCheckin, checkinGateApplies } from './fleetCheckinGate';

beforeEach(() => {
	directusServerJson.mockReset();
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('checkinGateApplies (opsi A)', () => {
	it('booking berproyek → gate berlaku (tanpa query)', async () => {
		expect(await checkinGateApplies({ project_id: 12 })).toBe(true);
		expect(directusServerJson).not.toHaveBeenCalled();
	});
	it('tanpa proyek & tanpa kategori → gate TIDAK berlaku', async () => {
		expect(await checkinGateApplies({ project_id: null, kategori_kunjungan: null })).toBe(false);
	});
	it('tanpa proyek, kategori wajib_project=true → berlaku', async () => {
		directusServerJson.mockResolvedValue({ data: [{ wajib_project: true }] });
		expect(await checkinGateApplies({ kategori_kunjungan: 'survey' })).toBe(true);
	});
	it('tanpa proyek, kategori wajib_project=false → tidak berlaku', async () => {
		directusServerJson.mockResolvedValue({ data: [{ wajib_project: false }] });
		expect(await checkinGateApplies({ kategori_kunjungan: 'antar_dokumen' })).toBe(false);
	});
	it('gagal baca kategori → fail-safe: gate tetap berlaku (dilog)', async () => {
		directusServerJson.mockRejectedValue(new Error('403'));
		expect(await checkinGateApplies({ kategori_kunjungan: 'x' })).toBe(true);
		expect(console.error).toHaveBeenCalled();
	});
});

describe('bookingHasCheckin', () => {
	it('true bila ada baris', async () => {
		directusServerJson.mockResolvedValue({ data: [{ id: 'a' }] });
		expect(await bookingHasCheckin('b1')).toBe(true);
	});
	it('false bila kosong atau query gagal (dilog)', async () => {
		directusServerJson.mockResolvedValue({ data: [] });
		expect(await bookingHasCheckin('b1')).toBe(false);
		directusServerJson.mockRejectedValue(new Error('x'));
		expect(await bookingHasCheckin('b1')).toBe(false);
	});
});
