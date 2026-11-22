import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateEss = vi.fn();
const loadPublishedFlowsForField = vi.fn();
const htmlToPdf = vi.fn();
const loadGateInfoForFlow = vi.fn();
vi.mock('$lib/server/ess/attendanceGuard', () => ({ authenticateEss: (...a: unknown[]) => authenticateEss(...a) }));
vi.mock('$lib/server/processGuidanceFlows', () => ({ loadPublishedFlowsForField: (...a: unknown[]) => loadPublishedFlowsForField(...a) }));
vi.mock('$lib/server/gotenbergClient', () => ({ htmlToPdf: (...a: unknown[]) => htmlToPdf(...a) }));
vi.mock('../../process-guidance/flows/gateInfo', () => ({ loadGateInfoForFlow: (...a: unknown[]) => loadGateInfoForFlow(...a) }));
const loadPicIndex = vi.fn();
const resolveMyPosisi = vi.fn();
vi.mock('$lib/server/processPicContext', () => ({ loadPicIndex: (...a: unknown[]) => loadPicIndex(...a), resolveMyPosisi: (...a: unknown[]) => resolveMyPosisi(...a) }));

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

describe('GET /api/panduan/buku-saku-pdf?jabatan=1 (Buku Saku Jabatan)', () => {
	const mk = (id: string, title: string, nodes: any[]) => ({ id, title, description: '', lanes: [], edges: [], approval_status: 'published', nodes });
	const task = (id: string, label: string, pic: string) => ({ id, type: 'task', lane: 'l', col: Number(id.replace(/\D/g, '')) || 0, label, pic, desc: '' });
	const flowsJab = [
		mk('f1', 'Alur Perawatan', [task('a1', 'Cek oli', 'Mekanik'), task('a2', 'Tanda tangan BA', 'Supervisor')]),
		mk('f2', 'Alur Retur', [task('b1', 'Periksa unit', 'Supervisor')]),
		mk('f3', 'Alur Gudang', [task('c1', 'Hitung stok', 'Mekanik')])
	];
	beforeEach(async () => {
		const { buildPosisiIndex } = await import('$lib/utils/processPicResolver');
		loadPublishedFlowsForField.mockResolvedValue(flowsJab);
		loadPicIndex.mockResolvedValue(buildPosisiIndex([{ id: 5, nama_posisi: 'MEKANIK' }, { id: 6, nama_posisi: 'SUPERVISOR' }]));
		resolveMyPosisi.mockReturnValue({ id: 5, nama: 'MEKANIK', via: 'jabatan_id' });
	});

	it('hanya langkah milik jabatan, dikelompokkan per alur; alur tanpa langkah jabatan tidak ikut; tanpa panggilan gate per alur', async () => {
		const res = await GET(ev('?jabatan=1'));
		expect(res.headers.get('Content-Type')).toBe('application/pdf');
		expect(res.headers.get('Content-Disposition')).toContain('Buku Saku Jabatan - MEKANIK');
		const html = htmlToPdf.mock.calls[0][0] as string;
		expect(html).toContain('BUKU SAKU JABATAN');
		expect(html).toContain('Cek oli');
		expect(html).toContain('Hitung stok');
		expect(html).not.toContain('Tanda tangan BA'); // milik Supervisor
		expect(html).not.toContain('Alur Retur'); // tak ada langkah Mekanik
		expect(html).toContain('oleh Budi');
		expect(loadGateInfoForFlow).not.toHaveBeenCalled();
		expect((html.match(/<html/g) || []).length).toBe(1); // satu dokumen, bukan dokumen bersarang
	});
	it('jabatan belum terhubung / tak ada langkah → 404 dengan pesan jelas (bukan PDF kosong)', async () => {
		resolveMyPosisi.mockReturnValueOnce(null);
		await expect(GET(ev('?jabatan=1'))).rejects.toMatchObject({ status: 404 });
		resolveMyPosisi.mockReturnValueOnce({ id: 99, nama: 'TANPA ALUR', via: 'jabatan_id' });
		await expect(GET(ev('?jabatan=1'))).rejects.toMatchObject({ status: 404 });
		expect(htmlToPdf).not.toHaveBeenCalled();
	});
	it('data gagal dimuat / Gotenberg gagal → 502; tanpa login → ditolak', async () => {
		const e = vi.spyOn(console, 'error').mockImplementation(() => {});
		loadPicIndex.mockRejectedValueOnce(new Error('directus'));
		await expect(GET(ev('?jabatan=1'))).rejects.toMatchObject({ status: 502 });
		htmlToPdf.mockRejectedValueOnce(new Error('down'));
		await expect(GET(ev('?jabatan=1'))).rejects.toMatchObject({ status: 502 });
		authenticateEss.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 401 }));
		await expect(GET(ev('?jabatan=1'))).rejects.toMatchObject({ status: 401 });
		e.mockRestore();
	});
	it('?alur tetap bekerja seperti semula (tidak terpengaruh mode jabatan)', async () => {
		loadPublishedFlowsForField.mockResolvedValue([flow]);
		const res = await GET(ev('?alur=alur_a'));
		expect(res.status).toBe(200);
		expect(htmlToPdf.mock.calls[0][0]).toContain('BUKU SAKU &amp; CHECKLIST LAPANGAN');
	});
});
