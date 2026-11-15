import { describe, it, expect } from 'vitest';
import { nikStatus, statusKtp, petaStatusIdentitas, identitasLengkap } from './ktpStatus';

describe('nikStatus', () => {
	it('valid, kosong, tidak valid (termasuk 10 nol di belakang)', () => {
		expect(nikStatus('3201010101010001')).toBe('valid');
		expect(nikStatus('')).toBe('kosong');
		expect(nikStatus(null)).toBe('kosong');
		expect(nikStatus('12345')).toBe('tidak_valid');
		expect(nikStatus('3201010000000000')).toBe('tidak_valid');
	});
});

describe('statusKtp', () => {
	it('prioritas dan abaikan jenis lain', () => {
		expect(statusKtp([{ jenis_dokumen: 'ktp', status_verifikasi: 'ditolak' }, { jenis_dokumen: 'ktp', status_verifikasi: 'terverifikasi' }])).toBe('terverifikasi');
		expect(statusKtp([{ jenis_dokumen: 'ktp', status_verifikasi: null }])).toBe('menunggu');
		expect(statusKtp([{ jenis_dokumen: 'mcu', status_verifikasi: 'terverifikasi' }])).toBe('belum');
		expect(statusKtp(undefined)).toBe('belum');
	});
});

describe('petaStatusIdentitas', () => {
	it('menggabungkan NIK dan dokumen; manpower_id objek maupun angka', () => {
		const p = petaStatusIdentitas(
			[{ id: 1, NIK: '3201010101010001' }, { id: 2, NIK: '' }, { id: 3, NIK: '3201010101010003' }],
			[
				{ manpower_id: 1, jenis_dokumen: 'ktp', status_verifikasi: 'terverifikasi' },
				{ manpower_id: { id: 3 }, jenis_dokumen: 'ktp', status_verifikasi: 'menunggu' }
			]
		);
		expect(p[1]).toEqual({ nik: 'valid', ktp: 'terverifikasi' });
		expect(p[2]).toEqual({ nik: 'kosong', ktp: 'belum' });
		expect(p[3]).toEqual({ nik: 'valid', ktp: 'menunggu' });
		expect(identitasLengkap(p[1])).toBe(true);
		expect(identitasLengkap(p[3])).toBe(false);
		expect(identitasLengkap(undefined)).toBe(false);
	});
});

describe('alasan tolak', () => {
	it('alasan HRD ikut terbawa hanya bila KTP berstatus ditolak', () => {
		const p = petaStatusIdentitas(
			[{ id: 1, NIK: '3201010101010001' }, { id: 2, NIK: '3201010101010002' }],
			[
				{ manpower_id: 1, jenis_dokumen: 'ktp', status_verifikasi: 'ditolak', catatan_verifikasi: 'foto buram' },
				{ manpower_id: 2, jenis_dokumen: 'ktp', status_verifikasi: 'ditolak', catatan_verifikasi: 'NIK beda' },
				{ manpower_id: 2, jenis_dokumen: 'ktp', status_verifikasi: 'terverifikasi', catatan_verifikasi: null }
			]
		);
		expect(p[1]).toEqual({ nik: 'valid', ktp: 'ditolak', alasanTolak: 'foto buram' });
		expect(p[2].ktp).toBe('terverifikasi');
		expect(p[2].alasanTolak).toBeUndefined();
	});
});
