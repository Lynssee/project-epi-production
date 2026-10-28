import { describe, expect, it } from 'vitest';
import { evaluateSecurityHandoverGate } from './securityHandoverGate';

const opts = { minCatatanChars: 20, wajibRondaTercatat: true };
const ok = 'Pos aman, kunci master lengkap, tidak ada tamu di dalam.';

describe('evaluateSecurityHandoverGate (G_SEC7)', () => {
	it('catatan cukup dan ada ronda → lolos', () => {
		expect(evaluateSecurityHandoverGate({ catatan: ok, rondaSelesaiCount: 2, options: opts }).passed).toBe(true);
	});

	it('catatan pendek → melanggar (trim dihitung)', () => {
		const r = evaluateSecurityHandoverGate({ catatan: '   aman   ', rondaSelesaiCount: 1, options: opts });
		expect(r.violations.map((v) => v.code)).toEqual(['CATATAN_TERLALU_PENDEK']);
	});

	it('null/undefined catatan dianggap kosong, tidak crash', () => {
		expect(evaluateSecurityHandoverGate({ catatan: null, rondaSelesaiCount: 1, options: opts }).passed).toBe(false);
		expect(evaluateSecurityHandoverGate({ catatan: undefined, rondaSelesaiCount: 1, options: opts }).passed).toBe(false);
	});

	it('tidak ada ronda → melanggar', () => {
		const r = evaluateSecurityHandoverGate({ catatan: ok, rondaSelesaiCount: 0, options: opts });
		expect(r.violations.map((v) => v.code)).toEqual(['TIDAK_ADA_RONDA_TERCATAT']);
	});

	it('jumlah ronda tak diketahui (gagal baca) → aturan ronda dilewati', () => {
		expect(evaluateSecurityHandoverGate({ catatan: ok, rondaSelesaiCount: null, options: opts }).passed).toBe(true);
	});

	it('aturan dimatikan → tidak dievaluasi', () => {
		const r = evaluateSecurityHandoverGate({ catatan: '', rondaSelesaiCount: 0, options: { minCatatanChars: 0, wajibRondaTercatat: false } });
		expect(r.passed).toBe(true);
	});

	it('dua pelanggaran dilaporkan bersama', () => {
		const r = evaluateSecurityHandoverGate({ catatan: 'x', rondaSelesaiCount: 0, options: opts });
		expect(r.violations).toHaveLength(2);
		expect(r.summary).toContain(';');
	});
});
