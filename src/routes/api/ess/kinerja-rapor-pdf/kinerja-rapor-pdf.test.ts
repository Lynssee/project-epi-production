import { describe, it, expect, vi, beforeEach } from 'vitest';

const authenticateEss = vi.fn();
const listKpiKaryawan = vi.fn();
const htmlToPdf = vi.fn();
vi.mock('$lib/server/ess/attendanceGuard', () => ({ authenticateEss: (...a: unknown[]) => authenticateEss(...a) }));
vi.mock('$lib/server/ess/kpi', () => ({ listKpiKaryawan: (...a: unknown[]) => listKpiKaryawan(...a) }));
vi.mock('$lib/server/gotenbergClient', () => ({ htmlToPdf: (...a: unknown[]) => htmlToPdf(...a) }));

const { GET } = await import('./+server');
const ev = (qs = '') => ({ url: new URL('http://x.test/api/ess/kinerja-rapor-pdf' + qs), request: new Request('http://x.test') }) as any;
const rec = (id: string, periode: string) => ({ id, periode, tahun: 2026, status: 'Finalized', targets: [], total_skor: 80, skor_pelatihan: null, catatan: null });

beforeEach(() => {
	vi.clearAllMocks();
	authenticateEss.mockResolvedValue({ karyawan: { id: 7, nama_karyawan: 'Siti', posisi: 'Mekanik', divisi: 'Prod' } });
	listKpiKaryawan.mockResolvedValue([rec('a', 'Oktober'), rec('b', 'September')]);
	htmlToPdf.mockResolvedValue(Buffer.from('%PDF-1.4'));
});

describe('GET /api/ess/kinerja-rapor-pdf', () => {
	it('data HANYA milik karyawan login (listKpiKaryawan(karyawan.id)); terbaru default; riwayat dari data sama', async () => {
		const res = await GET(ev());
		expect(res.headers.get('Content-Type')).toBe('application/pdf');
		expect(res.headers.get('Cache-Control')).toBe('private, no-store');
		expect(listKpiKaryawan).toHaveBeenCalledWith(7);
		const html = htmlToPdf.mock.calls[0][0] as string;
		expect(html).toContain('Oktober');
		expect(html).toContain('Riwayat Skor Total');
		expect(html).toContain('September');
	});
	it('scorecard milik orang lain / tak ada → 404 (tidak membocorkan); id aneh → 400', async () => {
		await expect(GET(ev('?scorecard=orang-lain'))).rejects.toMatchObject({ status: 404 });
		await expect(GET(ev('?scorecard=../x'))).rejects.toMatchObject({ status: 400 });
		expect(htmlToPdf).not.toHaveBeenCalled();
	});
	it('belum ada scorecard final → 404 dengan pesan jelas', async () => {
		listKpiKaryawan.mockResolvedValue([]);
		await expect(GET(ev())).rejects.toMatchObject({ status: 404, body: { message: expect.stringContaining('Belum ada scorecard final') } });
	});
	it('tidak login → ditolak sebelum membaca data; Directus gagal → 502; Gotenberg gagal → 502', async () => {
		authenticateEss.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 401 }));
		await expect(GET(ev())).rejects.toMatchObject({ status: 401 });
		expect(listKpiKaryawan).not.toHaveBeenCalled();
		const e = vi.spyOn(console, 'error').mockImplementation(() => {});
		listKpiKaryawan.mockRejectedValueOnce(new Error('403'));
		await expect(GET(ev())).rejects.toMatchObject({ status: 502 });
		htmlToPdf.mockRejectedValueOnce(new Error('gotenberg down'));
		await expect(GET(ev())).rejects.toMatchObject({ status: 502 });
		e.mockRestore();
	});
});
