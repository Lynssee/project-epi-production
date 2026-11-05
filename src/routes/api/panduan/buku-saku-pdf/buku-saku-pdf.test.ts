import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateEss = vi.fn();
const loadPublishedFlowsForField = vi.fn();
const htmlToPdf = vi.fn();
const loadGateInfoForFlow = vi.fn();
vi.mock('$lib/server/ess/attendanceGuard', () => ({ authenticateEss: (...a: unknown[]) => authenticateEss(...a) }));
vi.mock('$lib/server/processGuidanceFlows', () => ({ loadPublishedFlowsForField: (...a: unknown[]) => loadPublishedFlowsForField(...a) }));
vi.mock('$lib/server/gotenbergClient', () => ({ htmlToPdf: (...a: unknown[]) => htmlToPdf(...a) }));
vi.mock('../../process-guidance/flows/gateInfo', () => ({ loadGateInfoForFlow: (...a: unknown[]) => loadGateInfoForFlow(...a) }));

const { GET } = await import('./+server');
const ev = (qs = '') => ({ url: new URL('http://x.test/api/panduan/buku-saku-pdf' + qs), request: new Request('http://x.test', { headers: { authorization: 'Bearer tok' } }) }) as any;
const flow = { id: 'alur_a', title: 'Alur A', description: '', lanes: [], edges: [], approval_status: 'published', nodes: [{ id: 'a', type: 'task', lane: 'l', col: 0, label: 'Langkah', desc: '' }] };

beforeEach(() => {
	vi.clearAllMocks();
	authenticateEss.mockResolvedValue({ karyawan: { id: 1, nama_karyawan: 'Budi' } });
	loadPublishedFlowsForField.mockResolvedValue([flow]);
	loadGateInfoForFlow.mockResolvedValue({ available: false, gates: {}, reason: 'x' });
	htmlToPdf.mockResolvedValue(Buffer.from('%PDF'));
});

describe('GET /api/panduan/buku-saku-pdf', () => {
	it('alur terbit → PDF; Bearer diteruskan ke pembaca gate; pencetak tercatat', async () => {
		const res = await GET(ev('?alur=alur_a'));
		expect(res.headers.get('Content-Type')).toBe('application/pdf');
		expect(loadGateInfoForFlow).toHaveBeenCalledWith(flow, 'Bearer tok');
		const html = htmlToPdf.mock.calls[0][0] as string;
		expect(html).toContain('Alur A');
		expect(html).toContain('oleh Budi');
		expect(htmlToPdf.mock.calls[0][1]).toMatchObject({ landscape: true });
	});
	it('parameter tidak valid → 400; alur tak terbit → 404; tanpa login → ditolak', async () => {
		await expect(GET(ev('?alur=../etc'))).rejects.toMatchObject({ status: 400 });
		await expect(GET(ev('?alur=tidak_ada'))).rejects.toMatchObject({ status: 404 });
		authenticateEss.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 401 }));
		await expect(GET(ev('?alur=alur_a'))).rejects.toMatchObject({ status: 401 });
	});
	it('detail gate gagal dibaca → PDF TETAP dibuat (best-effort, dilaporkan di dokumen)', async () => {
		loadGateInfoForFlow.mockRejectedValueOnce(new Error('admin down'));
		const w = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const res = await GET(ev('?alur=alur_a'));
		expect(res.status).toBe(200);
		w.mockRestore();
	});
	it('alur gagal dimuat / Gotenberg gagal → 502 (bukan PDF kosong)', async () => {
		const e = vi.spyOn(console, 'error').mockImplementation(() => {});
		loadPublishedFlowsForField.mockRejectedValueOnce(new Error('directus'));
		await expect(GET(ev('?alur=alur_a'))).rejects.toMatchObject({ status: 502 });
		htmlToPdf.mockRejectedValueOnce(new Error('down'));
		await expect(GET(ev('?alur=alur_a'))).rejects.toMatchObject({ status: 502 });
		e.mockRestore();
	});
});
