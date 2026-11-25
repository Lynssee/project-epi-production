// PC3-18 + Stage 3 perf — resolusi identitas 1-query `_or` dengan prioritas ketat:
// firebase_uid → email → email_company; ambigu → 409; Off diabaikan; cache 5 menit; bawa jadwal_kerja_id & pola_kerja.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));
const { resolveKaryawanForUser, activeCandidates, clearKaryawanIdentityCache } = await import('./karyawan');

const K = (o: Record<string, any> = {}) => ({
	id: 1,
	nama_karyawan: 'A',
	email_company: null,
	email: null,
	divisi: 'X',
	divisi_id: 5,
	posisi: 'P',
	jabatan_id: { id: 9 },
	jadwal_kerja_id: 'shift-pagi',
	pola_kerja: null,
	status: 'On',
	firebase_uid: 'u1',
	...o
});

beforeEach(() => clearKaryawanIdentityCache());

describe('activeCandidates', () => {
	it('membuang status Off (huruf besar/kecil/spasi) dan duplikat id', () => {
		expect(
			activeCandidates([K({ status: 'Off' }), K({ id: 2, status: ' off ' }), K({ id: 3 }), K({ id: 3 }), K({ id: 4, status: 'Kontrak ' })]).map((k) => k.id)
		).toEqual([3, 4]);
		expect(activeCandidates(null)).toEqual([]);
	});
});

describe('resolveKaryawanForUser (1-query _or + prioritas)', () => {
	it('cocok lewat firebase_uid (menang atas email/email_company) dalam 1 query dan unwrap relasi', async () => {
		const f = vi.fn(async (_filterQuery: string) => [
			K({ id: 7, firebase_uid: 'u1', email: 'lain@gmail.com', jadwal_kerja_id: { id: 'shift-1' }, pola_kerja: 'mobile' }),
			K({ id: 99, firebase_uid: null, email: 'pribadi@gmail.com' })
		]);
		const r = await resolveKaryawanForUser({ uid: 'u1', email: 'pribadi@gmail.com' }, f);
		expect(r?.id).toBe(7);
		expect(r?.jabatan_id).toBe(9);
		expect(r?.jadwal_kerja_id).toBe('shift-1');
		expect(r?.pola_kerja).toBe('mobile');
		expect(f).toHaveBeenCalledTimes(1);
		expect(f.mock.calls[0][0]).toContain('filter[_or][0][firebase_uid][_eq]=u1');
	});

	it('uid tak cocok → cocok lewat email pribadi (case-insensitive) tetap 1 query', async () => {
		const f = vi.fn(async (_filterQuery: string) => [K({ id: 8, firebase_uid: null, email: 'Pribadi@Gmail.com' })]);
		const r = await resolveKaryawanForUser({ uid: 'x', email: 'Pribadi@Gmail.com' }, f);
		expect(r?.id).toBe(8);
		expect(f).toHaveBeenCalledTimes(1);
		expect(f.mock.calls[0][0]).toContain('pribadi%40gmail.com');
	});

	it('karyawan tanpa firebase_uid (email_company saja) → tepat 1 query (bukan 3 sekuensial)', async () => {
		const f = vi.fn(async () => [K({ id: 9, firebase_uid: null, email: null, email_company: 'a@eltama.com' })]);
		const r = await resolveKaryawanForUser({ uid: 'fb-new', email: 'a@eltama.com' }, f);
		expect(r?.id).toBe(9);
		expect(f).toHaveBeenCalledTimes(1);
	});

	it('dua baris aktif cocok pada satu jalur → 409, bukan menebak', async () => {
		const f = vi.fn(async () => [K({ id: 1, firebase_uid: 'u1' }), K({ id: 2, firebase_uid: 'u1' })]);
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(resolveKaryawanForUser({ uid: 'u1', email: 'a@b.c' }, f)).rejects.toMatchObject({ status: 409 });
		err.mockRestore();
	});

	it('karyawan Off diabaikan: satu Off + satu aktif → yang aktif; hanya Off → lanjut jalur berikutnya / null', async () => {
		const f1 = vi.fn(async () => [K({ id: 1, firebase_uid: 'u1', status: 'Off' }), K({ id: 2, firebase_uid: 'u1' })]);
		expect((await resolveKaryawanForUser({ uid: 'u1' }, f1))?.id).toBe(2);

		clearKaryawanIdentityCache();
		const f2 = vi.fn(async () => [K({ id: 1, firebase_uid: 'u1', status: 'Off' })]);
		expect(await resolveKaryawanForUser({ uid: 'u1', email: null }, f2)).toBeNull();
	});

	it('tak ditemukan di semua jalur → null', async () => {
		expect(await resolveKaryawanForUser({ uid: 'u1', email: 'z@z.z' }, vi.fn(async () => []))).toBeNull();
		expect(await resolveKaryawanForUser({ uid: '', email: '' }, vi.fn(async () => []))).toBeNull();
	});

	it('panggilan ke-2 memakai cache (tanpa fetch)', async () => {
		const f = vi.fn(async () => [K({ id: 7, firebase_uid: 'u1' })]);
		await resolveKaryawanForUser({ uid: 'u1', email: 'a@b.c' }, f);
		await resolveKaryawanForUser({ uid: 'u1', email: 'a@b.c' }, f);
		expect(f).toHaveBeenCalledTimes(1);
	});

	it('cache kedaluwarsa setelah 5 menit', async () => {
		vi.useFakeTimers();
		const f = vi.fn(async () => [K({ id: 7, firebase_uid: 'u1' })]);
		await resolveKaryawanForUser({ uid: 'u1' }, f);
		vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1000);
		await resolveKaryawanForUser({ uid: 'u1' }, f);
		expect(f).toHaveBeenCalledTimes(2);
		vi.useRealTimers();
	});

	it('panggilan paralel (in-flight coalescing) hanya memicu 1 fetch ke Directus', async () => {
		let resolveFetch!: (rows: any[]) => void;
		const f = vi.fn(
			() =>
				new Promise<any[]>((res) => {
					resolveFetch = res;
				})
		);
		const p1 = resolveKaryawanForUser({ uid: 'u-burst', email: 'burst@eltama.com' }, f);
		const p2 = resolveKaryawanForUser({ uid: 'u-burst', email: 'burst@eltama.com' }, f);
		const p3 = resolveKaryawanForUser({ uid: 'u-burst', email: 'burst@eltama.com' }, f);
		expect(f).toHaveBeenCalledTimes(1);
		resolveFetch([K({ id: 42, firebase_uid: 'u-burst' })]);
		const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
		expect(r1?.id).toBe(42);
		expect(r2?.id).toBe(42);
		expect(r3?.id).toBe(42);
	});

	it('tanpa uid tetapi ada email → tetap di-cache berdasarkan email dalam 1 fetch', async () => {
		const f = vi.fn(async () => [K({ id: 15, firebase_uid: null, email: null, email_company: 'staff@eltama.com' })]);
		const r1 = await resolveKaryawanForUser({ uid: null, email: 'Staff@Eltama.com' }, f);
		const r2 = await resolveKaryawanForUser({ uid: null, email: 'staff@eltama.com' }, f);
		expect(r1?.id).toBe(15);
		expect(r2?.id).toBe(15);
		expect(f).toHaveBeenCalledTimes(1);
	});
});
