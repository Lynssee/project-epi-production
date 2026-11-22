import { describe, it, expect, vi, beforeEach } from 'vitest';

const directusServerJson = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: any[]) => directusServerJson(...a) }));

const { getMyGayaKerja } = await import('./kpi');

beforeEach(() => {
	vi.clearAllMocks();
	directusServerJson.mockResolvedValue({ data: [] });
});

describe('getMyGayaKerja', () => {
	it('mengembalikan profil DISC, kekuatan, dan tip pengembangan yang valid', async () => {
		directusServerJson.mockResolvedValue({
			data: [{ profil_utama: 'C', tanggal_tes: '2026-06-01T10:00:00Z' }]
		});

		const res = await getMyGayaKerja(359);
		expect(res.available).toBe(true);
		expect(res.profil).toBe('C');
		expect(res.primaryLetter).toBe('C');
		expect(res.dimensiLabel).toContain('Conscientiousness');
		expect(res.kekuatan).toContain('checklist peralatan');
		expect(res.tipPengembangan).toContain('over-analisis');
		expect(res.tanggalTes).toBe('2026-06-01');
	});

	it('mengembalikan available=false jika belum pernah mengikuti tes', async () => {
		directusServerJson.mockResolvedValue({ data: [] });

		const res = await getMyGayaKerja(999);
		expect(res.available).toBe(false);
		expect(res.profil).toBeNull();
		expect(res.kekuatan).toBeNull();
	});

	it('mengembalikan profil bertipe D dengan kekuatan & tips yang sesuai', async () => {
		directusServerJson.mockResolvedValue({
			data: [{ profil_utama: 'D', tanggal_tes: '2026-05-10T08:00:00Z' }]
		});

		const res = await getMyGayaKerja(123);
		expect(res.available).toBe(true);
		expect(res.dimensiLabel).toContain('Dominance');
		expect(res.kekuatan).toContain('Cepat mengambil keputusan');
	});
});
