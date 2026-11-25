import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDirectusJson = vi.fn();
vi.mock('$lib/server/directus', () => ({
	directusServerJson: (...args: unknown[]) => mockDirectusJson(...args),
	directusServerUpload: vi.fn()
}));

const {
	listCatalogForKaryawan,
	listOnboardingPrograms,
	listMyEnrollmentsForPrograms,
	clearTrainingCatalogCache
} = await import('./training');
const { listCalendarEvents } = await import('./calendar');
const { resolveKaryawanPolaKerja, clearPolaKerjaCache } = await import('./polaKerjaResolver');
const { getSiteCheckinSettings, clearSiteCheckinSettingsCache } = await import('$lib/server/siteCheckin');

describe('Stage 3 ESS attendance performance — caching & separated Directus relations', () => {
	beforeEach(() => {
		mockDirectusJson.mockReset();
		clearTrainingCatalogCache();
		clearPolaKerjaCache();
		clearSiteCheckinSettingsCache();
	});

	it('training catalog separates training_program_divisi M2M fetch, caches 5m, and reuses for onboarding', async () => {
		const paths: string[] = [];
		mockDirectusJson.mockImplementation(async (path: string) => {
			paths.push(path);
			if (path.startsWith('/items/training_program?')) {
				return {
					data: [
						{ id: 1, judul: 'K3 Dasar', status: 'published', is_onboarding: true, urutan_tampil: 1, department_target: null },
						{ id: 2, judul: 'Sales Pro', status: 'published', is_onboarding: false, urutan_tampil: 2, department_target: null }
					]
				};
			}
			if (path.startsWith('/items/training_program_divisi?')) {
				return {
					data: [{ training_program_id: 2, divisi_id: 10 }]
				};
			}
			if (path.startsWith('/items/training_enrollment?')) {
				return {
					data: [{ id: 50, program_id: 1, karyawan_id: 7, status: 'Lulus', progress_persen: 100 }]
				};
			}
			throw new Error(`Unexpected path: ${path}`);
		});

		const [itCatalog, salesCatalog] = await Promise.all([
			listCatalogForKaryawan('IT', 2),
			listCatalogForKaryawan('Sales', 10)
		]);
		expect(itCatalog.map((p) => p.id)).toEqual([1]);
		expect(salesCatalog.map((p) => p.id)).toEqual([1, 2]);

		// Onboarding reuses published catalog cache (0 extra queries!)
		const onboarding = await listOnboardingPrograms();
		expect(onboarding.map((p) => p.id)).toEqual([1]);
		expect(paths).toHaveLength(2);
		for (const p of paths) {
			expect(p).not.toContain('divisi_target.');
		}

		// Batch enrollment fetch (1 query instead of N+1)
		const enrMap = await listMyEnrollmentsForPrograms(7, [1, 2]);
		expect(enrMap.get(1)?.status).toBe('Lulus');
		expect(enrMap.get(2)).toBeUndefined();
		expect(paths).toHaveLength(3);
	});

	it('calendar fetches shift_roster/jadwal_kerja and training_enrollment/training_program separately (zero dot-relations)', async () => {
		const paths: string[] = [];
		mockDirectusJson.mockImplementation(async (path: string) => {
			paths.push(path);
			if (path.startsWith('/items/shift_roster?')) {
				return { data: [{ id: 's1', tanggal: '2026-11-25', status: 'aktif', jadwal_kerja_id: 'jk-1' }] };
			}
			if (path.startsWith('/items/jadwal_kerja?')) {
				return { data: [{ id: 'jk-1', nama_jadwal: 'Shift Pagi' }] };
			}
			if (path.startsWith('/items/training_enrollment?')) {
				return { data: [{ id: 10, tenggat: '2026-11-26', program_id: 99 }] };
			}
			if (path.startsWith('/items/training_program?')) {
				return { data: [{ id: 99, judul: 'Safety Induction' }] };
			}
			return { data: [] };
		});

		const events = await listCalendarEvents(7, '2026-11-25', '2026-12-01');
		expect(events.find((e) => e.id === 'shift-s1')?.title).toBe('Shift: Shift Pagi');
		expect(events.find((e) => e.id === 'training-10')?.title).toBe('Tenggat: Safety Induction');
		for (const p of paths) {
			expect(p).not.toContain('jadwal_kerja_id.');
			expect(p).not.toContain('program_id.');
		}
	});

	it('getSiteCheckinSettings caches 5m and coalesces concurrent callers', async () => {
		mockDirectusJson.mockResolvedValue({ data: { id: 1, foto_checkin_wajib: true } });
		const [a, b, c] = await Promise.all([
			getSiteCheckinSettings(),
			getSiteCheckinSettings(),
			getSiteCheckinSettings()
		]);
		expect(a.id).toBe(1);
		expect(b.id).toBe(1);
		expect(c.id).toBe(1);
		expect(mockDirectusJson).toHaveBeenCalledTimes(1);
	});

	it('resolveKaryawanPolaKerja skips karyawan/{id} when known meta provided and caches department default', async () => {
		mockDirectusJson.mockImplementation(async (path: string) => {
			if (path.startsWith('/items/karyawan/')) throw new Error(`Should not query karyawan: ${path}`);
			if (path.startsWith('/items/department?')) {
				return { data: [{ pola_kerja_default: 'mobile' }] };
			}
			throw new Error(`Unexpected path: ${path}`);
		});

		const [p1, p2] = await Promise.all([
			resolveKaryawanPolaKerja(10, { polaKerja: null, divisi: 'Sales' }),
			resolveKaryawanPolaKerja(11, { polaKerja: null, divisi: 'Sales' })
		]);
		expect(p1).toBe('mobile');
		expect(p2).toBe('mobile');
		// Both employees share 1 coalesced department lookup and 0 karyawan/{id} lookups!
		expect(mockDirectusJson).toHaveBeenCalledTimes(1);
	});
});

