// Paket 10 Site Visit Release §2.3 (SVR-29) — laporan harian proyek A tidak boleh menutup
// kunjungan aktif proyek B.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockAuth = vi.fn();
const mockFindActive = vi.fn();
const mockClose = vi.fn();
vi.mock('$lib/server/ess/attendanceGuard', () => ({ authenticateEss: (...a: unknown[]) => mockAuth(...a) }));
vi.mock('$lib/server/siteCheckin', () => ({
	findActiveCheckin: (...a: unknown[]) => mockFindActive(...a),
	closeCheckin: (...a: unknown[]) => mockClose(...a)
}));
vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn(() => Promise.resolve({ data: {} })) }));

const { POST } = await import('./+server');

function req(body: any) {
	return { request: { json: () => Promise.resolve(body) } } as any;
}

beforeEach(() => {
	mockAuth.mockReset();
	mockFindActive.mockReset();
	mockClose.mockReset();
	mockAuth.mockResolvedValue({ karyawan: { id: 10, nama_karyawan: 'Budi' } });
});

describe('POST /api/site-checkin/auto-checkout — §2.3 cek proyek', () => {
	it('kunjungan aktif proyek LAIN (referensi_id beda) -> tidak ditutup, reason proyek_berbeda', async () => {
		mockFindActive.mockResolvedValue({ id: 'chk-1', tipe_checkin: 'proyek', referensi_id: 99 });
		const res = await POST(req({ reportId: 5, projectId: 5 }));
		const json = await res.json();
		expect(json).toEqual({ closed: false, reason: 'proyek_berbeda' });
		expect(mockClose).not.toHaveBeenCalled();
	});

	it('kunjungan aktif tipe marketing (bukan proyek) -> tidak ditutup meski projectId dikirim', async () => {
		mockFindActive.mockResolvedValue({ id: 'chk-1', tipe_checkin: 'marketing', referensi_id: 5 });
		const res = await POST(req({ reportId: 5, projectId: 5 }));
		const json = await res.json();
		expect(json.closed).toBe(false);
		expect(json.reason).toBe('proyek_berbeda');
	});

	it('kunjungan aktif proyek SAMA -> ditutup seperti biasa', async () => {
		mockFindActive.mockResolvedValue({ id: 'chk-1', tipe_checkin: 'proyek', referensi_id: 5 });
		mockClose.mockResolvedValue({ id: 'chk-1', status: 'completed' });
		const res = await POST(req({ reportId: 5, projectId: 5 }));
		const json = await res.json();
		expect(json.closed).toBe(true);
		expect(mockClose).toHaveBeenCalled();
	});

	it('tanpa projectId (kompatibilitas lama) -> perilaku lama, tetap ditutup', async () => {
		mockFindActive.mockResolvedValue({ id: 'chk-1', tipe_checkin: 'proyek', referensi_id: 99 });
		mockClose.mockResolvedValue({ id: 'chk-1', status: 'completed' });
		const res = await POST(req({ reportId: 5 }));
		const json = await res.json();
		expect(json.closed).toBe(true);
	});
});
