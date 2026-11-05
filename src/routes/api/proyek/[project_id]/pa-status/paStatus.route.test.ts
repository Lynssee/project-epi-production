import { describe, it, expect, vi, beforeEach } from 'vitest';

// Query Directus dipalsukan: catat urutan mulai/selesai & concurrency untuk membuktikan paralelisasi.
const log: string[] = [];
let inFlight = 0;
let maxInFlight = 0;
let responses: Record<string, () => any> = {};

vi.mock('$lib/server/goodsReceived/guard', () => ({
	authenticateProjectLeader: vi.fn(async () => ({ projectIds: [7] }))
}));
vi.mock('$lib/server/directus', () => ({
	directusServerJson: vi.fn(async (url: string) => {
		const name = (url.match(/\/items\/([a-z_]+)/) || [])[1];
		log.push(`start:${name}`);
		inFlight++;
		maxInFlight = Math.max(maxInFlight, inFlight);
		await new Promise((r) => setTimeout(r, 20));
		inFlight--;
		log.push(`end:${name}`);
		const fn = responses[name];
		if (!fn) throw new Error(`tak ada respons untuk ${name}`);
		return fn();
	})
}));

import { GET } from './+server';

const ev = (id = '7') => ({ params: { project_id: id } }) as any;
const ok = (rows: any[] = []) => () => ({ data: rows });
const fail = (msg: string) => () => {
	throw new Error(msg);
};

beforeEach(() => {
	log.length = 0;
	inFlight = 0;
	maxInFlight = 0;
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	responses = {
		pengajuan_anggaran: ok([{ id: 1, nomor_pengajuan: 'PA-1', approval_request_id: 11, current_stage: 'x', date_created: '2026-10-01T00:00:00Z' }]),
		approval_requests: ok([{ id: 11, status: 'pending', current_step: 1, workflow_id: 5, date_created: '2026-10-01T00:00:00Z' }]),
		approval_actions: ok([]),
		approval_workflow_steps: ok([{ workflow_id: 5, step_order: 1, sla_hours: 24 }]),
		project_budgets: ok([]),
		pembelian_lokal_proyek: ok([]),
		klaim_reimbursement: ok([])
	};
});

describe('GET pa-status — paralelisasi query Directus', () => {
	it('7 query tetap terpisah per relasi, tetapi berjalan bersamaan (maks 3 tahap berurutan)', async () => {
		const res = await GET(ev());
		const body = await res.json();
		expect(body.success).toBe(true);

		const starts = log.filter((l) => l.startsWith('start:'));
		expect(starts).toHaveLength(7);
		// packing list, pembelian lokal, reimbursement dimulai tanpa menunggu PA selesai
		const endPa = log.indexOf('end:pengajuan_anggaran');
		for (const n of ['project_budgets', 'pembelian_lokal_proyek', 'klaim_reimbursement']) {
			expect(log.indexOf(`start:${n}`)).toBeLessThan(endPa);
		}
		// requests & actions bersamaan, steps baru mulai setelah requests selesai
		expect(log.indexOf('start:approval_actions')).toBeLessThan(log.indexOf('end:approval_requests'));
		expect(log.indexOf('start:approval_workflow_steps')).toBeGreaterThan(log.indexOf('end:approval_requests'));
		expect(maxInFlight).toBeGreaterThanOrEqual(4);
	});

	it('tanpa PA pending: hanya 4 query (PA + 3 sumber independen), tanpa query approval', async () => {
		responses.pengajuan_anggaran = ok([]);
		const res = await GET(ev());
		expect((await res.json()).success).toBe(true);
		expect(log.filter((l) => l.startsWith('start:')).map((l) => l.slice(6)).sort()).toEqual(
			['klaim_reimbursement', 'pembelian_lokal_proyek', 'pengajuan_anggaran', 'project_budgets']
		);
	});

	it('PA gagal -> 502, dan kegagalan sumber lain tidak menjadi unhandled rejection', async () => {
		responses.pengajuan_anggaran = fail('boom');
		responses.project_budgets = fail('pl down');
		await expect(GET(ev())).rejects.toMatchObject({ status: 502 });
		await new Promise((r) => setTimeout(r, 40)); // beri waktu query sumber lain selesai
	});

	it('sumber opsional gagal -> peringatan dalam urutan lama, respons tetap sukses', async () => {
		responses.approval_requests = fail('x');
		responses.approval_actions = fail('y');
		responses.project_budgets = fail('z');
		responses.pembelian_lokal_proyek = fail('w'); // tanpa peringatan (perilaku lama)
		const body = await (await GET(ev())).json();
		expect(body.success).toBe(true);
		expect(body.data.warnings).toEqual([
			'Status approval gagal dimuat — umur & SLA tidak dapat dihitung.',
			'Riwayat aksi approval gagal dimuat — umur dihitung sejak diajukan.',
			'Status packing list belum dapat dimuat.'
		]);
		// requests gagal -> tidak ada workflow id -> query steps tidak dijalankan
		expect(log).not.toContain('start:approval_workflow_steps');
	});

	it('steps gagal -> peringatan SLA bawaan', async () => {
		responses.approval_workflow_steps = fail('s');
		const body = await (await GET(ev())).json();
		expect(body.data.warnings).toContain('SLA tahap gagal dimuat — dipakai SLA bawaan 48 jam.');
	});

	it('project_id tidak valid -> 400; bukan leader proyek -> 403', async () => {
		await expect(GET(ev('abc'))).rejects.toMatchObject({ status: 400 });
		await expect(GET(ev('99'))).rejects.toMatchObject({ status: 403 });
		expect(log).toHaveLength(0);
	});
});
