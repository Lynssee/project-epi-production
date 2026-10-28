import { describe, it, expect, vi } from 'vitest';

vi.mock('./directus', () => ({
	directusServerJson: vi.fn(async (url: string) => {
		if (url.includes('/items/projects/1040')) return { data: { name: 'PT ABC - Epoxy Lantai', leader: 'IRMA' } };
		throw new Error('down');
	})
}));

import { formatPlTitle, truncateTitle, resolveProjectTitleParts, MAX_TITLE_LEN } from './approvalTitle';

describe('approvalTitle (PRJ-27)', () => {
	it('format PL: proyek · item · nilai · pengaju', () => {
		expect(formatPlTitle({ projectLabel: 'PT ABC', itemCount: 3, total: 1500000, leader: 'IRMA' })).toBe('PL — PT ABC · 3 item · Rp1.500.000 · oleh IRMA');
		expect(formatPlTitle({ projectLabel: 'PT ABC', itemCount: 2, suffix: 'di luar RAP' })).toBe('PL — PT ABC · 2 item di luar RAP');
	});
	it('judul panjang dipotong ≤ 120', () => {
		const t = truncateTitle('x'.repeat(300));
		expect(t.length).toBeLessThanOrEqual(MAX_TITLE_LEN);
		expect(t.endsWith('…')).toBe(true);
	});
	it('membaca nama proyek; gagal -> label id (tidak melempar)', async () => {
		expect(await resolveProjectTitleParts(1040)).toEqual({ label: 'PT ABC - Epoxy Lantai', leader: 'IRMA' });
		expect((await resolveProjectTitleParts(9)).label).toBe('Project #9');
		expect((await resolveProjectTitleParts(null)).label).toBe('Project -');
	});
});
