// Paket 09 Site Visit Release §2.1 (SVR-27) — tanggal_input WIB dari waktu kunjungan, durasi_kerja_menit terisi.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockJson = vi.fn();
vi.mock('$lib/server/directus', () => ({
	directusServerJson: (...a: unknown[]) => mockJson(...a)
}));

const { bridgeToVisitMaintenance } = await import('./visitMaintenanceBridge');

const has = (u: unknown, ...n: string[]) => n.every((x) => decodeURIComponent(String(u ?? '')).includes(x));

let posted: any = null;

beforeEach(() => {
	mockJson.mockReset();
	posted = null;
	mockJson.mockImplementation((u: string, opts?: any) => {
		if (has(u, 'site_checkin_settings')) return Promise.resolve({ data: { tulis_visit_maintenance_aktif: true } });
		if (has(u, '/items/personnel')) return Promise.resolve({ data: [{ id: 'personnel-1' }] });
		if (has(u, '/items/category')) return Promise.resolve({ data: [{ id: 'cat-on-progress' }] });
		if (opts?.method === 'POST' && has(u, '/items/mekanik_activity')) {
			posted = JSON.parse(opts.body);
			return Promise.resolve({ data: { id: 'ma-1' } });
		}
		return Promise.resolve({ data: [] });
	});
});

describe('bridgeToVisitMaintenance — §2.1', () => {
	it('tanggal_input pakai WIB dari checkInAt (dini hari WIB, bukan tanggal UTC/hari sebelumnya)', async () => {
		// 2026-09-30T23:30:00+07:00 == 2026-09-30T16:30:00Z (masih tanggal 30 WIB)
		// tapi 2026-10-01T02:00:00+07:00 == 2026-09-30T19:00:00Z (UTC masih tgl 30, WIB sudah tgl 1)
		const checkInWibDiniHari = '2026-09-30T19:00:00.000Z'; // 02:00 WIB tanggal 1 Okt
		await bridgeToVisitMaintenance({
			workOrderId: 'wo-1',
			equipmentId: 'eq-1',
			karyawanId: '10',
			checkInAt: checkInWibDiniHari,
			durasiMenit: 45
		});
		expect(posted.tanggal_input).toBe('2026-10-01'); // WIB, BUKAN '2026-09-30' (slice UTC lama)
		expect(posted.durasi_kerja_menit).toBe(45);
	});

	it('tanpa checkInAt -> fallback ke tanggal server sekarang (WIB)', async () => {
		await bridgeToVisitMaintenance({ workOrderId: 'wo-1', equipmentId: 'eq-1', karyawanId: '10' });
		expect(posted.tanggal_input).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	});

	it('personnel tidak ditemukan -> gagal-lunak, reason spesifik untuk peringatan client', async () => {
		mockJson.mockImplementation((u: string) => {
			if (has(u, 'site_checkin_settings')) return Promise.resolve({ data: { tulis_visit_maintenance_aktif: true } });
			if (has(u, '/items/personnel')) return Promise.resolve({ data: [] });
			return Promise.resolve({ data: [] });
		});
		const r = await bridgeToVisitMaintenance({ workOrderId: 'wo-1', equipmentId: 'eq-1', karyawanId: '999' });
		expect(r.created).toBe(false);
		expect(r.reason).toBe('personnel tidak ditemukan untuk karyawan ini');
	});
});
