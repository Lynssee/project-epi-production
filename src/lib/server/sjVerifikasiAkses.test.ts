import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/firebaseAuth', () => ({ requireUser: vi.fn() }));
vi.mock('$lib/server/rbacServer', () => ({ getUserPermissions: vi.fn(), hasAnyPermission: vi.fn() }));
vi.mock('$lib/server/ess/karyawan', () => ({ resolveKaryawanByEmail: vi.fn() }));
vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));
vi.mock('$lib/server/goodsReceived/guard', () => ({ authenticateProjectLeader: vi.fn() }));

import { aktorBolehProyek, cekSelfVerify, evaluasiKelayakan, perluVerifikasi, pilihTanggalMulai, sudahDiverifikasi, TANGGAL_RILIS_VERIFIKASI, terapkanJendela } from './sjVerifikasiAkses';

const sj = (over: any = {}) => ({ project_id: 12, status: 'created', draft_status: null, print_count: 0, reprint_status: 'tidak_perlu', date_created: '2026-10-08T01:00:00Z', pengaju_verification: null, ...over });
const MULAI = '2026-10-08';

describe('SJ-06 kelayakan verifikasi (SJH-19 §4.2)', () => {
	it('SJ proyek baru belum dicetak → layak & perlu verifikasi', () => {
		expect(evaluasiKelayakan(sj(), MULAI).boleh).toBe(true);
		expect(perluVerifikasi(sj(), MULAI)).toBe(true);
	});
	it('bukan SJ proyek / dibatalkan / ditolak → tidak layak', () => {
		expect(evaluasiKelayakan(sj({ project_id: null }), MULAI).boleh).toBe(false);
		expect(evaluasiKelayakan(sj({ status: 'cancelled' }), MULAI).boleh).toBe(false);
		expect(evaluasiKelayakan(sj({ draft_status: 'ditolak' }), MULAI).boleh).toBe(false);
	});
	it('RSM-09 opsi A: sudah dicetak tapi belum lewat gerbang → tetap layak; sudah lewat gerbang → tidak layak (arahkan ke Barang Bermasalah)', () => {
		expect(evaluasiKelayakan(sj({ print_count: 1 }), MULAI).boleh).toBe(true);
		expect(perluVerifikasi(sj({ print_count: 1, status: 'needs_security_check' }), MULAI)).toBe(true);
		for (const status of ['shipped', 'delivered', 'received']) {
			const r = evaluasiKelayakan(sj({ print_count: 1, status }), MULAI);
			expect(r.boleh, status).toBe(false);
			expect(r.alasan).toMatch(/Barang Bermasalah/);
		}
	});
	it('RSM-09: jendela hari — "mulai" dimajukan ke (hari ini − N), tidak pernah mundur', () => {
		expect(terapkanJendela('2026-10-08', '2026-10-25', 3)).toBe('2026-10-22');
		expect(terapkanJendela('2026-10-24', '2026-10-25', 3)).toBe('2026-10-24');
		expect(terapkanJendela('2026-10-08', '2026-10-25', 0)).toBe('2026-10-08');
	});
	it('SJ sebelum tanggal mulai tidak membanjiri daftar', () => {
		expect(evaluasiKelayakan(sj({ date_created: '2026-10-07T23:00:00Z' }), MULAI).boleh).toBe(false);
	});
	it('sudah diverifikasi → layak untuk "Ubah hasil" tetapi tidak masuk daftar Perlu Verifikasi', () => {
		const v = sj({ pengaju_verification: { verified_at: '2026-10-08T02:00:00Z' } });
		expect(sudahDiverifikasi(v)).toBe(true);
		expect(evaluasiKelayakan(v, MULAI).boleh).toBe(true);
		expect(perluVerifikasi(v, MULAI)).toBe(false);
	});
	it('project_id berupa objek relasi dikenali', () => {
		expect(evaluasiKelayakan(sj({ project_id: { id: 5 } }), MULAI).boleh).toBe(true);
	});
});

describe('SJ-06 tanggal mulai', () => {
	it('memakai kandidat pertama yang sudah tiba; tanggal masa depan diabaikan', () => {
		expect(pilihTanggalMulai(['2026-10-01', '2026-09-01'], '2026-10-08')).toBe('2026-10-01');
		expect(pilihTanggalMulai(['2026-10-22T00:00:00Z', '2026-09-15'], '2026-10-08')).toBe('2026-09-15');
		expect(pilihTanggalMulai([null, undefined], '2026-10-08')).toBe(TANGGAL_RILIS_VERIFIKASI);
		expect(pilihTanggalMulai(['bukan-tanggal'], '2026-10-08')).toBe(TANGGAL_RILIS_VERIFIKASI);
	});
});

describe('SJ-06 akses aktor (K1)', () => {
	it('PL/backup hanya proyeknya; admin semua proyek; driver murni tidak punya proyek', () => {
		expect(aktorBolehProyek({ projectIds: [1, 2], isAdmin: false }, 2)).toBe(true);
		expect(aktorBolehProyek({ projectIds: [1, 2], isAdmin: false }, 3)).toBe(false);
		expect(aktorBolehProyek({ projectIds: [], isAdmin: true }, 99)).toBe(true);
		expect(aktorBolehProyek({ projectIds: [], isAdmin: false }, 1)).toBe(false);
		expect(aktorBolehProyek({ projectIds: [1], isAdmin: false }, null)).toBe(false);
	});
});

describe('SJ-06 self-approval lock + fallback (Aturan #4)', () => {
	it('penyiap = aktor & ada orang lain → ditolak', () => {
		expect(cekSelfVerify(7, { by: 7 }, true)).toEqual({ tolak: true, selfVerified: true });
	});
	it('penyiap = aktor & tidak ada orang lain → diizinkan, ditandai self_verified', () => {
		expect(cekSelfVerify(7, { by: '7' }, false)).toEqual({ tolak: false, selfVerified: true });
	});
	it('penyiap orang lain / belum tercatat → aman', () => {
		expect(cekSelfVerify(7, { by: 9 }, true)).toEqual({ tolak: false, selfVerified: false });
		expect(cekSelfVerify(7, null, true)).toEqual({ tolak: false, selfVerified: false });
	});
});
