import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateEss = vi.fn();
vi.mock('$lib/server/ess/attendanceGuard', () => ({
	authenticateEss: (...a: unknown[]) => authenticateEss(...a)
}));

const envState = vi.hoisted(() => ({
	ERP_EPI1_BASE_URL: 'http://localhost:9390' as string | undefined
}));
vi.mock('$env/dynamic/private', () => ({
	get env() {
		return envState;
	}
}));

const { GET } = await import('./+server');
const makeEvent = (qs = '') => ({
	url: new URL(`http://project.test/api/ess/kpi/print-url${qs}`),
	request: new Request('http://project.test')
}) as any;

beforeEach(() => {
	vi.clearAllMocks();
	envState.ERP_EPI1_BASE_URL = 'http://localhost:9390';
	authenticateEss.mockResolvedValue({
		user: { email: 'mekanik@eltamaprimaindo.com' },
		karyawan: { id: 105, nama_karyawan: 'Budi Santoso', posisi: 'Mekanik Lapangan', divisi: 'Maintenance' }
	});
});

describe('GET /api/ess/kpi/print-url', () => {
	it('menghasilkan URL pratinjau rapor individu untuk karyawan yang login', async () => {
		const res = await GET(makeEvent('?period=2026-10'));
		const data = await res.json();
		expect(data.available).toBe(true);
		expect(data.scope).toBe('individual');
		expect(data.url).toContain('/print/kpi?period=2026-10&scope=individual&entityType=karyawan&entity=105&stakeholder=ops&depth=detailed');
		expect(data.title).toContain('Budi Santoso');
		expect(data.karyawan.nama).toBe('Budi Santoso');
	});

	it('menolak akses matriks departemen untuk staf/mekanik non-pimpinan (403)', async () => {
		await expect(GET(makeEvent('?scope=department'))).rejects.toMatchObject({
			status: 403,
			body: { message: expect.stringContaining('Akses terbatas') }
		});
	});

	it('mengizinkan akses matriks departemen untuk Project Leader / Supervisor', async () => {
		authenticateEss.mockResolvedValueOnce({
			user: { email: 'leader@eltamaprimaindo.com' },
			karyawan: { id: 12, nama_karyawan: 'Ahmad Leader', posisi: 'Project Leader', divisi: 'Project' }
		});
		const res = await GET(makeEvent('?scope=department&period=2026-10'));
		const data = await res.json();
		expect(data.available).toBe(true);
		expect(data.scope).toBe('department');
		expect(data.url).toContain('/print/kpi?period=2026-10&scope=department&department=Project&stakeholder=ops&depth=detailed');
	});

	it('mengembalikan error jika belum login ESS (requireUser / authenticateEss melempar)', async () => {
		authenticateEss.mockRejectedValueOnce(Object.assign(new Error('Unauthenticated'), { status: 401 }));
		await expect(GET(makeEvent())).rejects.toMatchObject({ status: 401 });
	});
});
