import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/ess/attendanceGuard', () => ({ authenticateEss: vi.fn() }));
vi.mock('$lib/server/processGuidanceTraining', async (orig) => ({ ...(await orig<typeof import('$lib/server/processGuidanceTraining')>()), loadMyTrainingStatus: vi.fn() }));
import { GET } from './+server';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { loadMyTrainingStatus } from '$lib/server/processGuidanceTraining';

const auth = authenticateEss as unknown as ReturnType<typeof vi.fn>;
const load = loadMyTrainingStatus as unknown as ReturnType<typeof vi.fn>;
const call = (qs = '') => (GET as any)({ url: new URL('http://x/api/process-guidance/training' + qs) });

beforeEach(() => {
	vi.clearAllMocks();
	auth.mockResolvedValue({ karyawan: { id: 7 } });
	load.mockResolvedValue([{ id: 13, judul: 'Sandblasting' }]);
});

describe('GET /api/process-guidance/training', () => {
	it('wajib login: auth gagal → error dilempar, tidak ada pembacaan data', async () => {
		auth.mockRejectedValue(Object.assign(new Error('x'), { status: 401 }));
		await expect(call('?ids=13')).rejects.toMatchObject({ status: 401 });
		expect(load).not.toHaveBeenCalled();
	});
	it('sukses: status milik karyawan yang login (bukan dari parameter), ids dibersihkan', async () => {
		const body = await (await call('?ids=13,x,13,14&karyawan_id=999')).json();
		expect(body).toEqual({ success: true, source: 'directus', programs: [{ id: 13, judul: 'Sandblasting' }] });
		expect(load).toHaveBeenCalledWith(7, [13, 14]); // karyawan dari sesi; parameter karyawan_id diabaikan
	});
	it('tanpa ids valid → kosong tanpa memuat', async () => {
		expect(await (await call('?ids=abc')).json()).toEqual({ success: true, source: 'directus', programs: [] });
		expect(await (await call()).json()).toMatchObject({ programs: [] });
		expect(load).not.toHaveBeenCalled();
	});
	it('Directus gagal → 200 fallback tanpa membocorkan detail (UI diam)', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		load.mockRejectedValue(new Error('403 detail-rahasia'));
		const r = await call('?ids=13');
		expect(r.status).toBe(200);
		const body = await r.json();
		expect(body).toMatchObject({ success: true, source: 'fallback', programs: [] });
		expect(JSON.stringify(body)).not.toContain('detail-rahasia');
		warn.mockRestore();
	});
});
