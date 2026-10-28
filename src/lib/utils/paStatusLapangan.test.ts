import { describe, it, expect } from 'vitest';
import { buildPaStatusLapangan, umurText, DEFAULT_SLA_HOURS } from './paStatusLapangan';

// Fixture = kondisi live proyek #1051 (Tri Daya) per 20 Okt 2026 ~03:00 UTC.
const now = new Date('2026-10-20T03:00:00Z');
const WF = 'wf-1';
const pas = [
	{ id: 976, nomor_pengajuan: 'PA-2610-0030', date_created: '2026-10-06T07:43:40Z', approval_request_id: 'r1', current_stage: 'PROJECT - PROJECT FINANCE', interlocking_status: 'incomplete', tujuan_pengajuan: 'Ops dan kontrakan', total_amount: 1500000 },
	{ id: 1075, nomor_pengajuan: 'PA-2610-0104', date_created: '2026-10-13T03:46:29Z', approval_request_id: 'r2', current_stage: 'PROJECT - PROJECT FINANCE', interlocking_status: 'incomplete' },
	{ id: 1137, nomor_pengajuan: 'PA-2610-0166', date_created: '2026-10-19T16:16:32Z', approval_request_id: 'r3', current_stage: null, interlocking_status: null }
];
const requests = [
	{ id: 'r1', status: 'pending', current_step: 2, workflow_id: WF, date_created: '2026-10-07T01:21:03Z' },
	{ id: 'r2', status: 'pending', current_step: 2, workflow_id: WF, date_created: '2026-10-13T03:46:33Z' },
	{ id: 'r3', status: 'pending', current_step: 1, workflow_id: WF, date_created: '2026-10-19T16:16:35Z' }
];
const stepsByWorkflow = { [WF]: [{ step_order: 1, sla_hours: 24 }, { step_order: 2, sla_hours: 24 }] };
const lastActionByReq = { r1: '2026-10-07T01:30:00Z', r2: '2026-10-15T09:37:52Z' };

describe('buildPaStatusLapangan — kasus Tri Daya #1051', () => {
	const r = buildPaStatusLapangan({ pas, requests, lastActionByReq, stepsByWorkflow, now });

	it('urut terlama dulu; umur dihitung sejak masuk tahap; lampu merah/hijau', () => {
		expect(r.items.map((i) => i.nomor)).toEqual(['PA-2610-0030', 'PA-2610-0104', 'PA-2610-0166']);
		expect(r.items[0]).toMatchObject({ umur_jam: 313, level: 'red', sla_jam: 24, tahap: 2, posisi: 'PROJECT - PROJECT FINANCE' });
		expect(r.items[1]).toMatchObject({ umur_jam: 113, melewati_sla_jam: 89, level: 'red' });
		expect(r.items[2]).toMatchObject({ umur_jam: 10, level: 'green' });
		expect(r.overdue_count).toBe(2);
	});

	it('TANPA nominal rupiah di keluaran (keputusan Lead 12 Okt 2026)', () => {
		const json = JSON.stringify(r);
		expect(json).not.toContain('1500000');
		expect(json).not.toContain('total_amount');
		expect(json).not.toContain('amount');
	});

	it('PA tanpa snapshot gate ditandai', () => {
		expect(r.items.find((i) => i.nomor === 'PA-2610-0166')?.gate_belum_dievaluasi).toBe(true);
		expect(r.gate_belum_dievaluasi_count).toBe(1);
	});
});

describe('buildPaStatusLapangan — kasus tepi', () => {
	it('SLA tahap tak terbaca → bawaan 48 jam; request sudah diputuskan tidak masuk; input kosong aman', () => {
		const a = buildPaStatusLapangan({ pas: [pas[1]], requests: [requests[1]], lastActionByReq, now });
		expect(a.items[0]).toMatchObject({ sla_jam: DEFAULT_SLA_HOURS, sla_default: true });
		expect(buildPaStatusLapangan({ pas: [pas[0]], requests: [{ ...requests[0], status: 'approved' }], now }).total_count).toBe(0);
		expect(buildPaStatusLapangan().total_count).toBe(0);
		expect(buildPaStatusLapangan({ pas: null, requests: null }).items).toEqual([]);
	});

	it('tanpa approval_request ditandai; tanggal rusak → level unknown', () => {
		const a = buildPaStatusLapangan({ pas: [{ id: 5, nomor_pengajuan: 'PA-X', date_created: '2026-10-19T00:00:00Z', interlocking_status: 'passed' }], requests: [], now });
		expect(a.items[0]).toMatchObject({ tanpa_approval_request: true, request_id: null });
		const b = buildPaStatusLapangan({ pas: [{ id: 6, date_created: 'rusak', approval_request_id: 'r', interlocking_status: 'x' }], requests: [{ id: 'r', status: 'pending', date_created: 'rusak' }], now });
		expect(b.items[0]).toMatchObject({ level: 'unknown', umur_jam: null });
	});

	it('umurText', () => {
		expect(umurText(10)).toBe('10 jam');
		expect(umurText(313)).toBe('13 hari 1 jam');
		expect(umurText(null)).toBe('—');
	});
});

describe('buildPaStatusLapangan — multi-channel birokrasi & komitmen tertahan (Fase 5)', () => {
	it('mengagregasi packing list draft, in-flight, pembelian lokal, dan reimburse tanpa nominal rupiah', () => {
		const packingListItems = [
			{ id: 101, packing_status: 'draft', material_name: 'Epoxy Primer', qty: 10, unit: 'pail', date_created: '2026-10-18T00:00:00Z', harga: 500000 },
			{ id: 102, packing_status: 'requested', material_name: 'Thinner PU', qty: 5, unit: 'gal', date_created: '2026-10-19T12:00:00Z', harga: 200000 },
			{ id: 103, packing_status: 'complete', material_name: 'Roll Cat', qty: 20, unit: 'pcs', date_created: '2026-10-10T00:00:00Z' }
		];
		const localPurchases = [
			{ id: 201, nomor_pembelian: 'BL-01', nama_barang: 'Kuas Cat', status: 'Menunggu Approval', date_created: '2026-10-19T00:00:00Z', nominal: 150000 }
		];
		const reimbursements = [
			{ id: 301, nomor_klaim: 'KB-01', keterangan: 'BBM Operasional', status: 'Diajukan', date_created: '2026-10-19T06:00:00Z', nominal: 250000 }
		];

		const res = buildPaStatusLapangan({
			pas: [pas[2]],
			requests: [requests[2]],
			packingListItems,
			localPurchases,
			reimbursements,
			now
		});

		expect(res.birokrasi_items.length).toBe(5); // 1 PA, 2 PL (draft + requested), 1 BL, 1 Reimb (complete diabaikan)
		expect(res.summary.draft_pl_count).toBe(1);
		expect(res.summary.draft_pl_stale_count).toBe(1); // 2026-10-18 sampai 2026-10-20 = 51 jam (> 24 jam)
		expect(res.summary.in_flight_pl_count).toBe(1);
		expect(res.summary.pembelian_lokal_count).toBe(1);
		expect(res.summary.reimbursement_count).toBe(1);

		// Verifikasi draft stale flag
		const draftItem = res.birokrasi_items.find((i) => i.id === 'pl_101');
		expect(draftItem?.is_stale_draft).toBe(true);
		expect(draftItem?.channel).toBe('packing_list_draft');

		// Verifikasi bahwa sama sekali tidak ada angka nominal rupiah yang bocor
		const json = JSON.stringify(res);
		expect(json).not.toContain('500000');
		expect(json).not.toContain('200000');
		expect(json).not.toContain('150000');
		expect(json).not.toContain('250000');
		expect(json).not.toContain('nominal');
		expect(json).not.toContain('harga');
	});
});
