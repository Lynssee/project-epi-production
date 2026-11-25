import { describe, it, expect, vi, beforeEach } from 'vitest';

const requireUserMock = vi.fn();
const directusServerJsonMock = vi.fn();

vi.mock('$lib/server/firebaseAuth', () => ({ requireUser: requireUserMock }));
vi.mock('$lib/server/directus', () => ({ directusServerJson: directusServerJsonMock }));

const { authenticateEss } = await import('./attendanceGuard');
const { clearKaryawanIdentityCache } = await import('./karyawan');

beforeEach(() => {
	vi.clearAllMocks();
	clearKaryawanIdentityCache();
});

describe('authenticateEss (localId → firebase_uid + cache)', () => {
	it('meneruskan user.localId sebagai uid sehingga langsung query firebase_uid dan cache HIT pada request berikutnya', async () => {
		requireUserMock.mockResolvedValue({ localId: 'fb-uid-371', email: 'irma@eltamaprimaindo.com' });
		directusServerJsonMock.mockResolvedValueOnce({
			data: [
				{
					id: 371,
					nama_karyawan: 'IRMA INDRIYANI',
					email_company: 'irma@eltamaprimaindo.com',
					divisi: 'Finance',
					divisi_id: 2,
					posisi: 'Staff',
					jabatan_id: 5,
					jadwal_kerja_id: 'shift-pagi',
					pola_kerja: 'mobile',
					status: 'On',
					firebase_uid: 'fb-uid-371'
				}
			]
		});

		const event = {} as any;
		const r1 = await authenticateEss(event);
		const r2 = await authenticateEss(event);

		expect(r1.karyawan.id).toBe(371);
		expect(r1.karyawan.jadwal_kerja_id).toBe('shift-pagi');
		expect(r1.karyawan.pola_kerja).toBe('mobile');
		expect(r2.karyawan.id).toBe(371);
		expect(directusServerJsonMock).toHaveBeenCalledTimes(1);
		expect(directusServerJsonMock.mock.calls[0][0]).toContain('filter[_or][0][firebase_uid][_eq]=fb-uid-371');
	});

	it('melempar 403 dengan pesan jelas jika akun belum tertaut karyawan', async () => {
		requireUserMock.mockResolvedValue({ localId: 'fb-unlinked', email: 'baru@eltama.com' });
		directusServerJsonMock.mockResolvedValue({ data: [] });

		await expect(authenticateEss({} as any)).rejects.toMatchObject({ status: 403 });
	});
});

