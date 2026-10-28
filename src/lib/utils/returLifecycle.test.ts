import { describe, it, expect } from 'vitest';
import { buildReturTracking } from './returLifecycle';

const NOW = '2026-10-13T00:00:00Z';
const row = (o: any) => ({ project_id: 1, qty_returned: 1, unit: 'Kg', material_name: 'Cat', return_status: 'return_requested', date_created: '2026-10-10T00:00:00Z', ...o });

describe('buildReturTracking', () => {
	it('tanpa header: diajukan; semua return_checked: selesai', () => {
		const out = buildReturTracking([row({ id: 1 }), row({ id: 2, date_created: '2026-09-01T00:00:00Z', return_status: 'return_checked' })], new Map(), NOW);
		const byId = Object.fromEntries(out.map((o) => [o.docNo, o]));
		expect(byId['Pengajuan #1']).toMatchObject({ stepKey: 'diajukan', stepIndex: 0, done: false, ageDays: 3 });
		expect(byId['Pengajuan #2']).toMatchObject({ stepKey: 'selesai', stepIndex: 5, done: true });
	});

	it('tahap dari status header & verifikasi satpam', () => {
		const rows = [row({ id: 1, retur_gudang_id: 7 }), row({ id: 2, retur_gudang_id: 8 }), row({ id: 3, retur_gudang_id: 9 })];
		const headers = new Map<number, any>([
			[7, { id: 7, nomor_retur: 'RG-7', status: 'dikirim' }],
			[8, { id: 8, nomor_retur: 'RG-8', status: 'dikirim', security_verified_at: '2026-10-11T00:00:00Z' }],
			[9, { id: 9, nomor_retur: 'RG-9', status: 'diterima_sebagian' }]
		]);
		const steps = Object.fromEntries(buildReturTracking(rows, headers, NOW).map((o) => [o.docNo, o.stepKey]));
		expect(steps).toEqual({ 'RG-7': 'dalam_perjalanan', 'RG-8': 'gerbang_gudang', 'RG-9': 'pemeriksaan_qc' });
	});

	it('RSM-02: draft tanpa jadwal = diajukan; draft + tanggal_pengambilan = dijadwalkan (membawa sopir)', () => {
		const rows = [row({ id: 1, retur_gudang_id: 7 }), row({ id: 2, retur_gudang_id: 8 })];
		const headers = new Map<number, any>([
			[7, { id: 7, nomor_retur: 'RG-7', status: 'draft' }],
			[8, { id: 8, nomor_retur: 'RG-8', status: 'draft', tanggal_pengambilan: '2026-10-25', driver_name: 'ADYOSO', driver_phone: '0812', vehicle_plate: 'B 1 X' }]
		]);
		const out = Object.fromEntries(buildReturTracking(rows, headers, NOW).map((o) => [o.docNo, o]));
		expect(out['RG-7']).toMatchObject({ stepKey: 'diajukan', stepIndex: 0, docId: 7, docStatus: 'draft', jadwal: null });
		expect(out['RG-8']).toMatchObject({ stepKey: 'dijadwalkan', stepIndex: 1, jadwal: '2026-10-25', driverName: 'ADYOSO', driverPhone: '0812' });
	});

	it('ditolak diurutkan pertama & membawa alasan; batal ditandai', () => {
		const rows = [row({ id: 1, retur_gudang_id: 7 }), row({ id: 2, retur_gudang_id: 8, date_created: '2026-08-01T00:00:00Z' }), row({ id: 3, retur_gudang_id: 9 })];
		const headers = { 7: { id: 7, nomor_retur: 'RG-7', status: 'ditolak', rejection_reason: 'Barang tidak sesuai' }, 8: { id: 8, nomor_retur: 'RG-8', status: 'dikirim' }, 9: { id: 9, status: 'batal' } } as any;
		const out = buildReturTracking(rows, headers, NOW);
		expect(out[0]).toMatchObject({ docNo: 'RG-7', rejected: true, rejectionReason: 'Barang tidak sesuai' });
		expect(out[1].docNo).toBe('RG-8');
		expect(out[2].cancelled).toBe(true);
	});

	it('input kosong/null aman', () => {
		expect(buildReturTracking([], undefined, NOW)).toEqual([]);
		expect(buildReturTracking([null as any], new Map(), NOW)).toEqual([]);
	});
});
