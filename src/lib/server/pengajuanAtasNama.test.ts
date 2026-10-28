import { describe, it, expect } from 'vitest';
import { evaluateScopeAtasNama } from './pengajuanAtasNama';

const base = { isLeaderProyek: true, isSupervisor: false, pengisiKaryawanId: 1, pemohonKaryawanId: 2, anggotaKaryawanIds: [1, 2, 3] };

describe('evaluateScopeAtasNama', () => {
	it('leader proyek + pemohon anggota -> ok', () => expect(evaluateScopeAtasNama(base).ok).toBe(true));
	it('supervisor (izin) + pemohon anggota -> ok', () => expect(evaluateScopeAtasNama({ ...base, isLeaderProyek: false, isSupervisor: true }).ok).toBe(true));
	it('bukan leader & bukan supervisor -> 403', () => {
		const r: any = evaluateScopeAtasNama({ ...base, isLeaderProyek: false });
		expect(r.ok).toBe(false);
		expect(r.httpStatus).toBe(403);
	});
	it('pemohon = diri sendiri -> 400', () => expect((evaluateScopeAtasNama({ ...base, pemohonKaryawanId: '1' }) as any).httpStatus).toBe(400));
	it('pemohon bukan anggota proyek -> 403', () => expect((evaluateScopeAtasNama({ ...base, pemohonKaryawanId: 99 }) as any).httpStatus).toBe(403));
	it('tanpa pemohon: hanya cek hak pengisi', () => {
		expect(evaluateScopeAtasNama({ ...base, pemohonKaryawanId: null }).ok).toBe(true);
		expect(evaluateScopeAtasNama({ ...base, pemohonKaryawanId: null, isLeaderProyek: false }).ok).toBe(false);
	});
});
