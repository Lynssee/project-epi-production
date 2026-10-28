import { describe, expect, it } from 'vitest';
import { evaluateGatePersonGate } from './gatePersonGate';

const options = { jamKerjaMulai: 8, jamKerjaSelesai: 17, wajibIzinPribadi: true };
const base = { arah: 'out' as const, tipe: 'tetap', keperluan: 'pribadi', jamWib: 10, izinAktif: false, openOutAda: false, options };

describe('evaluateGatePersonGate (G_SEC2)', () => {
	it('keluar pribadi jam kerja tanpa izin → melanggar', () => {
		const r = evaluateGatePersonGate(base);
		expect(r.violations.map((v) => v.code)).toEqual(['KELUAR_TANPA_IZIN']);
	});
	it('dengan izin aktif → lolos', () => {
		expect(evaluateGatePersonGate({ ...base, izinAktif: true }).passed).toBe(true);
	});
	it('di luar jam kerja → lolos', () => {
		expect(evaluateGatePersonGate({ ...base, jamWib: 17 }).passed).toBe(true);
		expect(evaluateGatePersonGate({ ...base, jamWib: 7 }).passed).toBe(true);
	});
	it('batas jam mulai inklusif', () => {
		expect(evaluateGatePersonGate({ ...base, jamWib: 8 }).passed).toBe(false);
	});
	it('keperluan dinas/istirahat tidak butuh izin', () => {
		expect(evaluateGatePersonGate({ ...base, keperluan: 'dinas' }).passed).toBe(true);
		expect(evaluateGatePersonGate({ ...base, keperluan: 'istirahat' }).passed).toBe(true);
	});
	it('tamu dan manpower tidak butuh izin jam-jaman', () => {
		expect(evaluateGatePersonGate({ ...base, tipe: 'tamu' }).passed).toBe(true);
		expect(evaluateGatePersonGate({ ...base, tipe: 'manpower' }).passed).toBe(true);
	});
	it('izin tidak diketahui (gagal baca) → aturan izin dilewati', () => {
		expect(evaluateGatePersonGate({ ...base, izinAktif: null }).passed).toBe(true);
	});
	it('keluar lagi padahal belum tercatat kembali → melanggar', () => {
		const r = evaluateGatePersonGate({ ...base, keperluan: 'dinas', openOutAda: true });
		expect(r.violations.map((v) => v.code)).toEqual(['KELUAR_SEBELUMNYA_BELUM_KEMBALI']);
	});
	it('arah masuk tidak dievaluasi', () => {
		expect(evaluateGatePersonGate({ ...base, arah: 'in', openOutAda: true }).passed).toBe(true);
	});
	it('saklar wajibIzinPribadi dimatikan → aturan izin tidak jalan', () => {
		expect(evaluateGatePersonGate({ ...base, options: { ...options, wajibIzinPribadi: false } }).passed).toBe(true);
	});
	it('dua pelanggaran digabung', () => {
		const r = evaluateGatePersonGate({ ...base, openOutAda: true });
		expect(r.violations).toHaveLength(2);
	});
});
