// PC3-18 — resolusi identitas berlapis: uid → email → email_company; ambigu → 409; Off diabaikan; cache 5 menit.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));
const { resolveKaryawanForUser, activeCandidates, clearKaryawanIdentityCache } = await import('./karyawan');

const K = (o: Record<string, any> = {}) => ({ id: 1, nama_karyawan: 'A', email_company: null, email: null, divisi: 'X', divisi_id: 5, posisi: 'P', jabatan_id: { id: 9 }, status: 'On', firebase_uid: 'u1', ...o });
/** fetch tiruan: peta potongan filter → baris */
const fetcher = (m: Record<string, any[]>) =>
	vi.fn(async (f: string) => {
		for (const [needle, rows] of Object.entries(m)) if (f.includes(needle)) return rows;
		return [];
	});

beforeEach(() => clearKaryawanIdentityCache());

describe('activeCandidates', () => {
	it('membuang status Off (huruf besar/kecil/spasi) dan duplikat id', () => {
		expect(activeCandidates([K({ status: 'Off' }), K({ id: 2, status: ' off ' }), K({ id: 3 }), K({ id: 3 }), K({ id: 4, status: 'Kontrak ' })]).map((k) => k.id)).toEqual([3, 4]);
		expect(activeCandidates(null)).toEqual([]);
	});
});

describe('resolveKaryawanForUser', () => {
	it('cocok lewat firebase_uid (email login berbeda dari email_company)', async () => {
		const f = fetcher({ 'firebase_uid': [K({ id: 7 })] });
		const r = await resolveKaryawanForUser({ uid: 'u1', email: 'pribadi@gmail.com' }, f);
		expect(r?.id).toBe(7);
		expect(r?.jabatan_id).toBe(9); // relasi objek di-unwrap
		expect(f).toHaveBeenCalledTimes(1);
	});
	it('uid tak cocok → cocok lewat email pribadi (kolom email)', async () => {
		const f = fetcher({ 'filter[email][_eq]': [K({ id: 8 })] });
		expect((await resolveKaryawanForUser({ uid: 'x', email: 'Pribadi@Gmail.com' }, f))?.id).toBe(8);
		expect(f.mock.calls.map((c) => c[0]).some((q) => q.includes('pribadi%40gmail.com'))).toBe(true); // huruf kecil
	});
	it('lewat email_company (perilaku lama tetap jalan)', async () => {
		const f = fetcher({ 'email_company': [K({ id: 9 })] });
		expect((await resolveKaryawanForUser({ uid: 'x', email: 'a@eltama.com' }, f))?.id).toBe(9);
	});
	it('dua baris aktif cocok pada satu jalur → 409, bukan menebak', async () => {
		const f = fetcher({ 'firebase_uid': [K({ id: 1 }), K({ id: 2 })] });
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(resolveKaryawanForUser({ uid: 'u1', email: 'a@b.c' }, f)).rejects.toMatchObject({ status: 409 });
		err.mockRestore();
	});
	it('karyawan Off diabaikan: satu Off + satu aktif → yang aktif; hanya Off → lanjut jalur berikutnya / null', async () => {
		const f1 = fetcher({ 'firebase_uid': [K({ id: 1, status: 'Off' }), K({ id: 2 })] });
		expect((await resolveKaryawanForUser({ uid: 'u1' }, f1))?.id).toBe(2);
		clearKaryawanIdentityCache();
		const f2 = fetcher({ 'firebase_uid': [K({ id: 1, status: 'Off' })] });
		expect(await resolveKaryawanForUser({ uid: 'u1', email: null }, f2)).toBeNull();
	});
	it('tak ditemukan di semua jalur → null', async () => {
		expect(await resolveKaryawanForUser({ uid: 'u1', email: 'z@z.z' }, fetcher({}))).toBeNull();
		expect(await resolveKaryawanForUser({ uid: '', email: '' }, fetcher({}))).toBeNull();
	});
	it('panggilan ke-2 memakai cache (tanpa fetch)', async () => {
		const f = fetcher({ 'firebase_uid': [K({ id: 7 })] });
		await resolveKaryawanForUser({ uid: 'u1', email: 'a@b.c' }, f);
		await resolveKaryawanForUser({ uid: 'u1', email: 'a@b.c' }, f);
		expect(f).toHaveBeenCalledTimes(1);
	});
	it('cache kedaluwarsa setelah 5 menit', async () => {
		vi.useFakeTimers();
		const f = fetcher({ 'firebase_uid': [K({ id: 7 })] });
		await resolveKaryawanForUser({ uid: 'u1' }, f);
		vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1000);
		await resolveKaryawanForUser({ uid: 'u1' }, f);
		expect(f).toHaveBeenCalledTimes(2);
		vi.useRealTimers();
	});
});
