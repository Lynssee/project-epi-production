import { describe, it, expect } from 'vitest';
import { validateUsulan, buildProposalRecord, checkLimits, CATATAN_MIN, CATATAN_MAX, MAX_PER_DAY } from './sopUsulan';

const LONG = 'Langkah 3 menyebut cek manual padahal di lapangan memakai alat ukur.';
const SOP = { id: 7, title: 'SOP Penerimaan Barang', sop_code: 'WH-001', department: 'Warehouse', version: 'v1.2', version_seq: 12 };
const KARY = { id: 42, nama_karyawan: 'Budi', divisi: 'Warehouse' };
const NOW = Date.parse('2026-11-02T10:00:00Z');

// Kolom skema live proposed_sop (guard anti-403).
const LIVE = new Set(['id', 'title', 'justifikasi_masalah', 'content', 'data_snapshot', 'target_departments', 'target_roles', 'severity', 'incident_count', 'status', 'reviewed_by', 'review_notes', 'converted_sop_id', 'date_created', 'source', 'kebijakan_id']);

describe('validateUsulan', () => {
	it('jenis wajib dari daftar; catatan 20..2000 karakter (setelah trim)', () => {
		expect(validateUsulan({ jenis: 'kurang_jelas', catatan: LONG }).ok).toBe(true);
		expect(validateUsulan({ jenis: 'ngawur', catatan: LONG }).errors.jenis).toBeTruthy();
		expect(validateUsulan({ jenis: 'lainnya', catatan: '   pendek   ' }).errors.catatan).toMatch(String(CATATAN_MIN));
		expect(validateUsulan({ jenis: 'lainnya', catatan: 'x'.repeat(CATATAN_MAX + 1) }).errors.catatan).toMatch(String(CATATAN_MAX));
	});
	it('aman terhadap null/undefined/tipe salah', () => {
		expect(validateUsulan(null).ok).toBe(false);
		expect(validateUsulan(undefined).ok).toBe(false);
		expect(validateUsulan({ jenis: 5, catatan: {} }).ok).toBe(false);
	});
	it('catatan di-trim pada hasil', () => {
		expect(validateUsulan({ jenis: 'lainnya', catatan: `  ${LONG}  ` }).catatan).toBe(LONG);
	});
});

describe('buildProposalRecord', () => {
	const rec = buildProposalRecord({ sop: SOP, karyawan: KARY, jenis: 'tidak_sesuai', catatan: LONG });

	it('hanya kolom skema live; source lapangan, status draft, tanpa content', () => {
		for (const k of Object.keys(rec)) expect(LIVE.has(k), k).toBe(true);
		expect(rec).toMatchObject({ source: 'lapangan', status: 'draft', severity: 'medium', incident_count: 1, target_departments: ['Warehouse'] });
		expect((rec as any).content).toBeUndefined();
	});
	it('judul memuat kode SOP; justifikasi memuat jenis, penjelasan, pengusul, dan versi SOP', () => {
		expect(rec.title).toBe('Usulan perbaikan: [WH-001] SOP Penerimaan Barang');
		expect(rec.justifikasi_masalah).toContain('Langkah tidak sesuai kenyataan di lapangan');
		expect(rec.justifikasi_masalah).toContain(LONG);
		expect(rec.justifikasi_masalah).toContain('Budi (Warehouse)');
		expect(rec.justifikasi_masalah).toContain('SOP #7 versi v1.2');
	});
	it('data_snapshot membawa id untuk audit & batas kiriman', () => {
		expect(rec.data_snapshot).toEqual({ sop_id: 7, sop_version: 'v1.2', sop_version_seq: 12, karyawan_id: 42, jenis: 'tidak_sesuai' });
	});
	it('judul sangat panjang dipotong 250; SOP tanpa kode/departemen tidak melempar', () => {
		const r = buildProposalRecord({ sop: { id: 1, title: 'x'.repeat(400) }, karyawan: { id: 1 }, jenis: 'lainnya', catatan: LONG });
		expect(r.title.length).toBe(250);
		expect(r.target_departments).toEqual([]);
		expect(r.justifikasi_masalah).toContain('karyawan #1');
	});
});

describe('checkLimits', () => {
	const row = (o: any) => ({ id: 1, status: 'draft', date_created: '2026-11-02T08:00:00Z', data_snapshot: { karyawan_id: 42, sop_id: 7 }, ...o });

	it('kosong → lolos', () => {
		expect(checkLimits([], 42, 7, NOW).ok).toBe(true);
		expect(checkLimits(null as any, 42, 7, NOW).ok).toBe(true);
	});
	it('usulan terbuka (draft) untuk SOP yang sama oleh orang yang sama → ditolak', () => {
		const r = checkLimits([row({})], 42, 7, NOW);
		expect(r.ok).toBe(false);
		expect(r.reason).toMatch(/masih ditinjau/);
	});
	it('usulan sudah ditinjau (approved/rejected) tidak menghalangi usulan baru untuk SOP yang sama', () => {
		expect(checkLimits([row({ status: 'rejected' })], 42, 7, NOW).ok).toBe(true);
	});
	it('usulan orang lain / SOP lain tidak ikut dihitung', () => {
		expect(checkLimits([row({ data_snapshot: { karyawan_id: 99, sop_id: 7 } })], 42, 7, NOW).ok).toBe(true);
		expect(checkLimits([row({ data_snapshot: { karyawan_id: 42, sop_id: 8 } })], 42, 7, NOW).ok).toBe(true);
	});
	it(`batas ${MAX_PER_DAY} per 24 jam, usulan lebih lama dari 24 jam tidak dihitung`, () => {
		const today = [8, 9, 10].map((sop_id) => row({ status: 'approved', data_snapshot: { karyawan_id: 42, sop_id } }));
		expect(checkLimits(today, 42, 7, NOW).reason).toMatch(/per hari/);
		const old = today.map((r) => ({ ...r, date_created: '2026-10-30T08:00:00Z' }));
		expect(checkLimits(old, 42, 7, NOW).ok).toBe(true);
	});
	it('data_snapshot berupa string JSON atau rusak tidak melempar', () => {
		expect(checkLimits([row({ data_snapshot: JSON.stringify({ karyawan_id: 42, sop_id: 7 }) })], 42, 7, NOW).ok).toBe(false);
		expect(() => checkLimits([row({ data_snapshot: '{rusak' }), row({ data_snapshot: null })], 42, 7, NOW)).not.toThrow();
	});
});
