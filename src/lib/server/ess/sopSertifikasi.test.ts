import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDirectus = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: unknown[]) => mockDirectus(...a) }));

import { listSopSertifikasi, getSopTrainingStatus } from './sop';

describe('listSopSertifikasi — badge "Tersertifikasi SOP"', () => {
	beforeEach(() => vi.clearAllMocks());

	function wire(enrollments: any[], sops: any[]) {
		mockDirectus.mockImplementation(async (url: string) => {
			if (String(url).startsWith('/items/training_enrollment')) return { data: enrollments };
			if (String(url).startsWith('/items/sop_documents')) return { data: sops };
			return { data: [] };
		});
	}

	it('program SOP yang Lulus → badge dengan kode SOP & nomor sertifikat', async () => {
		wire([{ program_id: 7, sertifikat_no: 'CERT-1', sertifikat_expired: null }], [{ id: 3, sop_code: 'SOP-PRD-001', title: 'K3', training_program_id: 7 }]);
		const r = await listSopSertifikasi(11, '2026-11-12');
		expect(r).toEqual([{ sopId: 3, sop_code: 'SOP-PRD-001', title: 'K3', programId: 7, sertifikat_no: 'CERT-1', sertifikat_expired: null }]);
		const enrUrl = String(mockDirectus.mock.calls[0][0]);
		expect(enrUrl).toContain('filter[karyawan_id][_eq]=11');
		expect(enrUrl).toContain('filter[status][_eq]=Lulus');
		expect(String(mockDirectus.mock.calls[1][0])).toContain('filter[training_program_id][_in]=7');
	});

	it('sertifikat kedaluwarsa tidak dihitung (tanpa query SOP bila tak ada yang tersisa)', async () => {
		wire([{ program_id: 7, sertifikat_no: 'X', sertifikat_expired: '2026-01-01' }], []);
		expect(await listSopSertifikasi(11, '2026-11-12')).toEqual([]);
		expect(mockDirectus).toHaveBeenCalledTimes(1);
	});

	it('tanpa enrollment Lulus → kosong; error Directus → kosong (tidak melempar)', async () => {
		wire([], []);
		expect(await listSopSertifikasi(11)).toEqual([]);
		mockDirectus.mockRejectedValue(new Error('boom'));
		expect(await listSopSertifikasi(11)).toEqual([]);
	});

	it('enrollment berupa objek relasi {id} tetap terbaca', async () => {
		wire([{ program_id: { id: 7 }, sertifikat_no: null, sertifikat_expired: '2027-01-01' }], [{ id: 3, sop_code: null, title: 'K3', training_program_id: { id: 7 } }]);
		const r = await listSopSertifikasi(11, '2026-11-12');
		expect(r[0]).toMatchObject({ sopId: 3, programId: 7, sertifikat_expired: '2027-01-01' });
	});
});

describe('getSopTrainingStatus', () => {
	beforeEach(() => vi.clearAllMocks());

	it('SOP tanpa training wajib / tanpa program → null tanpa query', async () => {
		expect(await getSopTrainingStatus({ requires_training: false, training_program_id: 7 }, 1)).toBeNull();
		expect(await getSopTrainingStatus({ requires_training: true, training_program_id: null }, 1)).toBeNull();
		expect(mockDirectus).not.toHaveBeenCalled();
	});

	it('program masih draft (draf AI belum diterbitkan) → null: tidak tampil di lapangan', async () => {
		mockDirectus.mockResolvedValue({ data: { id: 7, judul: 'x', status: 'draft' } });
		expect(await getSopTrainingStatus({ requires_training: true, training_program_id: 7 }, 1)).toBeNull();
	});

	it('terdaftar → status enrollment; tidak terdaftar → null', async () => {
		mockDirectus.mockImplementation(async (url: string) => String(url).startsWith('/items/training_program/')
			? { data: { id: 7, judul: 'SOP: K3', status: 'published' } }
			: { data: [{ status: 'Ongoing', progress_persen: 40, tenggat: '2026-12-01' }] });
		expect(await getSopTrainingStatus({ requires_training: true, training_program_id: 7 }, 1)).toEqual({ programId: 7, judul: 'SOP: K3', status: 'Ongoing', progress: 40, tenggat: '2026-12-01' });
		mockDirectus.mockImplementation(async (url: string) => String(url).startsWith('/items/training_program/') ? { data: { id: 7, judul: 'x', status: 'published' } } : { data: [] });
		expect(await getSopTrainingStatus({ requires_training: true, training_program_id: 7 }, 1)).toBeNull();
	});
});
