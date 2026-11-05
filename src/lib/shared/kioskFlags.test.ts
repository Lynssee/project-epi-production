import { describe, it, expect } from 'vitest';
import { absensiNormal, alasanAnomali, decodeFlags, encodeCatatan, mergeFlags, teksLeader } from './kioskFlags';

describe('penanda kiosk di catatan verifikasi', () => {
	it('encode/decode bolak-balik, mengabaikan penanda asing & duplikat', () => {
		const c = encodeCatatan(['jendela_jam', 'foto_ganda', 'jendela_jam', 'ngawur']);
		expect(c).toBe('[kiosk] jendela_jam,foto_ganda');
		expect(decodeFlags(c)).toEqual(['jendela_jam', 'foto_ganda']);
	});
	it('teks leader hidup berdampingan dengan penanda', () => {
		const c = encodeCatatan(['rekan_batas'], 'sudah ditanya orangnya');
		expect(c).toBe('[kiosk] rekan_batas | sudah ditanya orangnya');
		expect(decodeFlags(c)).toEqual(['rekan_batas']);
		expect(teksLeader(c)).toBe('sudah ditanya orangnya');
		expect(teksLeader('catatan biasa')).toBe('catatan biasa');
		expect(decodeFlags('catatan biasa [kiosk] jendela_jam')).toEqual([]);
	});
	it('mergeFlags menambah tanpa mengubah teks leader; null aman', () => {
		expect(mergeFlags(null, ['foto_ganda'])).toBe('[kiosk] foto_ganda');
		expect(mergeFlags('[kiosk] jendela_jam | ok', ['foto_ganda'])).toBe('[kiosk] jendela_jam,foto_ganda | ok');
		expect(mergeFlags('', [])).toBe('');
		expect(mergeFlags(undefined, [])).toBe('');
	});
});

describe('absensiNormal / alasanAnomali', () => {
	const normal = { status: 'hadir', masuk_valid: true, verifikasi_leader_status: 'menunggu', verifikasi_leader_catatan: '' };
	it('hadir di dalam radius tanpa penanda = normal', () => {
		expect(absensiNormal(normal)).toBe(true);
		expect(absensiNormal({ ...normal, masuk_valid: 1 })).toBe(true);
		expect(alasanAnomali(normal)).toEqual([]);
	});
	it('semua penyimpangan membuat baris TIDAK normal', () => {
		expect(absensiNormal({ ...normal, masuk_valid: false })).toBe(false);
		expect(absensiNormal({ ...normal, masuk_valid: null })).toBe(false); // lokasi tak dicek
		expect(absensiNormal({ ...normal, jam_pulang: '2026-10-27T10:00:00Z', pulang_valid: false })).toBe(false);
		expect(absensiNormal({ ...normal, jam_pulang: '2026-10-27T10:00:00Z', pulang_valid: true })).toBe(true);
		expect(absensiNormal({ ...normal, dobel_proyek_flag: true })).toBe(false);
		expect(absensiNormal({ ...normal, dikunci: 1 })).toBe(false);
		expect(absensiNormal({ ...normal, verifikasi_leader_status: 'disetujui' })).toBe(false);
		expect(absensiNormal({ ...normal, verifikasi_leader_catatan: '[kiosk] foto_ganda' })).toBe(false);
		expect(absensiNormal({ ...normal, status: 'izin' })).toBe(false);
		expect(absensiNormal(null)).toBe(false);
	});
	it('alasan anomali terbaca manusia', () => {
		const a = alasanAnomali({ ...normal, masuk_valid: false, verifikasi_leader_catatan: '[kiosk] jendela_jam,rekan_batas' });
		expect(a).toEqual(['Di luar radius proyek (masuk)', 'Di luar jam absen', 'Perangkat mengabsenkan banyak orang']);
		expect(alasanAnomali({ ...normal, masuk_valid: null })).toEqual(['Lokasi masuk tidak dicek']);
		expect(alasanAnomali(undefined)).toEqual([]);
	});
});

describe('penanda lupa_pulang (Fase 6)', () => {
	it('dikenali, tampil sebagai alasan anomali, dan menghalangi persetujuan massal', () => {
		const baris = { status: 'hadir', masuk_valid: true, verifikasi_leader_status: 'menunggu', verifikasi_leader_catatan: '[kiosk] lupa_pulang' };
		expect(decodeFlags(baris.verifikasi_leader_catatan)).toEqual(['lupa_pulang']);
		expect(absensiNormal(baris)).toBe(false);
		expect(alasanAnomali(baris)).toEqual(['Lupa absen pulang']);
		expect(mergeFlags('[kiosk] lupa_pulang | ok', ['lupa_pulang'])).toBe('[kiosk] lupa_pulang | ok');
	});
});
