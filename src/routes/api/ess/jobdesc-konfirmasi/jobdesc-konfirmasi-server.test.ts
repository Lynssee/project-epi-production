import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/ess/attendanceGuard', () => ({ authenticateEss: vi.fn() }));
const mockDirectus = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: any[]) => mockDirectus(...a) }));

import { GET, POST } from './+server';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';

const authMock = authenticateEss as unknown as ReturnType<typeof vi.fn>;
const ev = () => ({ getClientAddress: () => '10.0.0.1' }) as any;

interface Wire { jobdesc_aktif_id?: number | null; aktif?: boolean; versi?: number; confirm?: any | null }
function wire(o: Wire = {}) {
	mockDirectus.mockImplementation(async (endpoint: string, opt?: any) => {
		if (endpoint.startsWith('/items/posisi/')) return { data: { id: 5, jobdesc_aktif_id: o.jobdesc_aktif_id === undefined ? 9 : o.jobdesc_aktif_id } };
		if (endpoint.startsWith('/items/jabatan_jobdesc/')) return { data: { id: 9, versi: o.versi ?? 2, aktif: o.aktif ?? true } };
		if (endpoint.startsWith('/items/sop_read_confirmations/') && opt?.method === 'PATCH') return { data: {} };
		if (endpoint.startsWith('/items/sop_read_confirmations') && opt?.method === 'POST') return { data: { confirmed_at: '2026-11-18T10:00:00Z' } };
		if (endpoint.startsWith('/items/sop_read_confirmations')) return { data: o.confirm ? [o.confirm] : [] };
		return { data: [] };
	});
}
const posts = () => mockDirectus.mock.calls.filter((c) => c[1]?.method === 'POST');
const patches = () => mockDirectus.mock.calls.filter((c) => c[1]?.method === 'PATCH');

beforeEach(() => {
	mockDirectus.mockReset();
	authMock.mockResolvedValue({ karyawan: { id: 77, jabatan_id: 5 } });
});

describe('GET /api/ess/jobdesc-konfirmasi', () => {
	it('tanpa jabatan → available:false, tanpa query', async () => {
		authMock.mockResolvedValue({ karyawan: { id: 77, jabatan_id: null } });
		const body = await (await GET(ev())).json();
		expect(body.available).toBe(false);
		expect(mockDirectus).not.toHaveBeenCalled();
	});
	it('jobdesc belum terbit (jobdesc_aktif_id kosong) → available:false', async () => {
		wire({ jobdesc_aktif_id: null });
		expect((await (await GET(ev())).json()).available).toBe(false);
	});
	it('jobdesc non-aktif (draf) tidak dihitung', async () => {
		wire({ aktif: false });
		expect((await (await GET(ev())).json()).available).toBe(false);
	});
	it('belum pernah konfirmasi', async () => {
		wire();
		const b = await (await GET(ev())).json();
		expect(b).toMatchObject({ available: true, confirmed: false, needs_reconfirm: false, versi: 2 });
	});
	it('konfirmasi versi lama → perlu konfirmasi ulang', async () => {
		wire({ confirm: { id: 1, flow_version: 1, confirmed_at: 'x' } });
		expect(await (await GET(ev())).json()).toMatchObject({ confirmed: false, needs_reconfirm: true });
	});
	it('konfirmasi versi terkini → confirmed', async () => {
		wire({ confirm: { id: 1, flow_version: 2, confirmed_at: 'x' } });
		expect(await (await GET(ev())).json()).toMatchObject({ confirmed: true, needs_reconfirm: false });
	});
	it('Directus gagal → 502 terkontrol, tidak melempar', async () => {
		mockDirectus.mockRejectedValue(new Error('boom'));
		const res = await GET(ev());
		expect(res.status).toBe(502);
	});
});

describe('POST /api/ess/jobdesc-konfirmasi', () => {
	it('tanpa jobdesc terbit → 404', async () => {
		wire({ jobdesc_aktif_id: null });
		expect((await POST(ev())).status).toBe(404);
		expect(posts()).toHaveLength(0);
	});
	it('membuat baris baru dengan versi dari SERVER dan flow_key berbasis jabatan', async () => {
		wire({ versi: 3 });
		const body = await (await POST(ev())).json();
		expect(body.success).toBe(true);
		const sent = JSON.parse(posts()[0][1].body);
		expect(sent).toMatchObject({ karyawan_id: 77, flow_key: 'jobdesc:posisi:5', flow_version: 3, sop_id: null });
	});
	it('idempoten bila versi sudah dikonfirmasi', async () => {
		wire({ confirm: { id: 1, flow_version: 2, confirmed_at: 'x' } });
		const body = await (await POST(ev())).json();
		expect(body.already_confirmed).toBe(true);
		expect(posts()).toHaveLength(0);
		expect(patches()).toHaveLength(0);
	});
	it('versi baru → PATCH baris lama (bukan baris ganda)', async () => {
		wire({ versi: 3, confirm: { id: 4, flow_version: 2, confirmed_at: 'x' } });
		await POST(ev());
		expect(posts()).toHaveLength(0);
		expect(patches()).toHaveLength(1);
		expect(JSON.parse(patches()[0][1].body).flow_version).toBe(3);
	});
});
