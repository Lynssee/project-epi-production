import { describe, it, expect } from 'vitest';
import { normKunciPaMode, cariBentrokPA, pesanKunciPA } from './paKunciAbsensi';

const rincian = [{ assignmentId: 7, dari: '2026-10-01', sampai: '2026-10-10', nomor: 'PA-2610-0001', status: 'Pending' }];

describe('paKunciAbsensi (salinan erp-epi — harus identik perilakunya)', () => {
	it('normKunciPaMode: hanya off/warn/block; nilai rusak -> warn (jangan diam-diam mengunci)', () => {
		expect(normKunciPaMode('BLOCK')).toBe('block');
		expect(normKunciPaMode('off')).toBe('off');
		expect(normKunciPaMode('keras')).toBe('warn');
		expect(normKunciPaMode(undefined)).toBe('warn');
	});
	it('cariBentrokPA: inklusif di batas periode, beda assignment/di luar periode = null', () => {
		expect(cariBentrokPA(rincian, 7, '2026-10-01')?.nomor).toBe('PA-2610-0001');
		expect(cariBentrokPA(rincian, '7', '2026-10-10T00:00:00')?.nomor).toBe('PA-2610-0001');
		expect(cariBentrokPA(rincian, 7, '2026-10-11')).toBeNull();
		expect(cariBentrokPA(rincian, 8, '2026-10-05')).toBeNull();
		expect(cariBentrokPA(null, 7, '2026-10-05')).toBeNull();
		expect(cariBentrokPA(rincian, null, '2026-10-05')).toBeNull();
	});
	it('pesan block menyebut jalan keluar; warn tidak melarang', () => {
		expect(pesanKunciPA(rincian[0], '2026-10-05', 'block')).toMatch(/ditolak\/direvisi/);
		expect(pesanKunciPA(rincian[0], '2026-10-05', 'warn')).not.toMatch(/tidak bisa diubah/);
	});
});
