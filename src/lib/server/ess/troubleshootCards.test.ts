import { describe, it, expect, vi } from 'vitest';
vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));
import { sanitizeCards } from './troubleshootCards';

describe('sanitizeCards', () => {
	it('hanya kartu aktif dengan judul & langkah', () => {
		const r = sanitizeCards([
			{ id: 'a', judul: 'Aktif', langkah: ['x', ' '], aktif: true, program_id: 120 },
			{ id: 'b', judul: 'Draft', langkah: ['x'], aktif: false },
			{ id: 'c', judul: 'Tanpa langkah', langkah: [], aktif: true }
		]);
		expect(r).toHaveLength(1);
		expect(r[0]).toMatchObject({ id: 'a', langkah: ['x'], programId: 120 });
	});
	it('null-safe & string JSON', () => {
		expect(sanitizeCards(null)).toEqual([]);
		expect(sanitizeCards('bukan json')).toEqual([]);
		expect(sanitizeCards(JSON.stringify([{ judul: 'J', langkah: ['z'], aktif: true }]))).toHaveLength(1);
	});
});
