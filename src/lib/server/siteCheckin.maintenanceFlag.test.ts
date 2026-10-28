// Paket 09 Site Visit Release §0 — tipe maintenance ditolak server selama flag OFF (default).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockJson = vi.fn();
const mockUpload = vi.fn();
vi.mock('$lib/server/directus', () => ({
	directusServerJson: (...a: unknown[]) => mockJson(...a),
	directusServerUpload: (...a: unknown[]) => mockUpload(...a)
}));
vi.mock('$lib/server/visitLeaderBridge', () => ({ bridgeToVisitLeader: vi.fn() }));
vi.mock('$lib/server/visitMarketingBridge', () => ({ bridgeToVisitMarketing: vi.fn() }));
vi.mock('$lib/server/visitMaintenanceBridge', () => ({
	bridgeToVisitMaintenance: vi.fn(),
	resolvePersonnelId: vi.fn(() => Promise.resolve(null))
}));
vi.mock('$lib/server/projectNotify', () => ({
	notifyProjectSiteCheckin: vi.fn(() => Promise.resolve()),
	notifyProjectSiteCheckout: vi.fn(() => Promise.resolve())
}));

const { createCheckin, TipeMaintenanceNonaktifError } = await import('./siteCheckin');

const has = (u: unknown, ...n: string[]) => n.every((x) => decodeURIComponent(String(u ?? '')).includes(x));

function fakeFile(): File {
	return new File([new Uint8Array([1])], 'foto.jpg', { type: 'image/jpeg' });
}

beforeEach(() => {
	mockJson.mockReset();
	mockUpload.mockReset();
});

describe('createCheckin — §0 gate tipe_maintenance_aktif', () => {
	it('flag OFF (default) -> menolak dengan TipeMaintenanceNonaktifError, tidak sampai upload foto', async () => {
		mockJson.mockImplementation((u: string) => {
			if (has(u, 'site_checkin_settings')) return Promise.resolve({ data: { tipe_maintenance_aktif: false } });
			throw new Error('tidak boleh lanjut ke query lain setelah gate menolak: ' + u);
		});
		await expect(
			createCheckin({ karyawanId: '10', referensiId: 'wo-1', lat: -6.2, lng: 106.8, akurasi: 10, foto: fakeFile(), tipeKeperluan: 'maintenance' })
		).rejects.toBeInstanceOf(TipeMaintenanceNonaktifError);
		expect(mockUpload).not.toHaveBeenCalled();
	});

	it('flag ON -> tidak menolak di gate (lanjut ke logika WO, akan gagal di sini karena WO mock tidak lengkap, tapi bukan karena gate)', async () => {
		mockJson.mockImplementation((u: string) => {
			if (has(u, 'site_checkin_settings')) return Promise.resolve({ data: { tipe_maintenance_aktif: true } });
			if (has(u, '/items/work_order/wo-1')) return Promise.resolve({ data: null }); // WO tidak ditemukan -> error lain
			return Promise.resolve({ data: [] });
		});
		await expect(
			createCheckin({ karyawanId: '10', referensiId: 'wo-1', lat: -6.2, lng: 106.8, akurasi: 10, foto: fakeFile(), tipeKeperluan: 'maintenance' })
		).rejects.not.toBeInstanceOf(TipeMaintenanceNonaktifError);
	});
});
