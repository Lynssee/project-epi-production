import { describe, it, expect, vi, beforeEach } from 'vitest';

// Query Directus dipalsukan: catat urutan mulai/selesai & concurrency untuk membuktikan paralelisasi.
const log: string[] = [];
let inFlight = 0;
let maxInFlight = 0;
let responses: Record<string, () => any> = {};

let scope: any = { unrestricted: false, projectIds: [7] };
vi.mock('$lib/server/firebaseAuth', () => ({
	requireUser: vi.fn(async () => ({ localId: 'uid-1', email: 'pl@epi.test' }))
}));
vi.mock('$lib/server/fieldProjectScope', () => ({
	resolveFieldProjectScope: vi.fn(async () => scope)
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

const ev = (id = '7') =>
	({ params: { project_id: id }, request: new Request('http://x', { headers: { authorization: 'Bearer tok' } }) }) as any;
const ok = (rows: any[] = []) => () => ({ data: rows });
const fail = (msg: string) => () => {
	throw new Error(msg);
};

beforeEach(() => {
	scope = { unrestricted: false, projectIds: [7] };
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
		klaim_reimbursement: ok([]),
		system_settings: ok([])
	};
});

describe('GET pa-status — paralelisasi query Directus', () => {
	it('8 query (7 data + 1 setelan SLA) tetap terpisah per relasi, tetapi berjalan bersamaan (maks 3 tahap berurutan)', async () => {
		const res = await GET(ev());
		const body = await res.json();
		expect(body.success).toBe(true);

		const starts = log.filter((l) => l.startsWith('start:'));
		expect(starts).toHaveLength(8);
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

	it('tanpa PA pending: hanya 5 query (PA + 3 sumber independen + setelan SLA), tanpa query approval', async () => {
		responses.pengajuan_anggaran = ok([]);
		const res = await GET(ev());
		expect((await res.json()).success).toBe(true);
		expect(log.filter((l) => l.startsWith('start:')).map((l) => l.slice(6)).sort()).toEqual(
			['klaim_reimbursement', 'pembelian_lokal_proyek', 'pengajuan_anggaran', 'project_budgets', 'system_settings']
		);
	});

	it('setelan project.field_birokrasi.* mengubah lampu SLA; setelan gagal dibaca -> default lama, respons tetap sukses', async () => {
		// Pembelian lokal berumur 30 jam. Default SLA 24 jam -> merah.
		const created = new Date(Date.now() - 30 * 3_600_000).toISOString();
		responses.pengajuan_anggaran = ok([]);
		responses.pembelian_lokal_proyek = ok([{ id: 5, nomor_pembelian: 'BL-5', nama_barang: 'Kuas', status: 'Menunggu Approval', date_created: created }]);
		const level = async () => (await (await GET(ev())).json()).data.birokrasi_items.find((i: any) => i.channel === 'pembelian_lokal').level;
		const setting = (key: string, value: string) => ({ setting_key: 'project.field_birokrasi.' + key, setting_type: 'number', setting_value: value });

		expect(await level()).toBe('red');
		responses.system_settings = ok([setting('sla_local_purchase_hours', '48')]); // 30/48 = 0,63 >= 0,5 -> kuning
		expect(await level()).toBe('yellow');
		responses.system_settings = ok([setting('sla_local_purchase_hours', '72')]); // 30/72 = 0,42 < 0,5 -> hijau
		expect(await level()).toBe('green');
		responses.system_settings = ok([setting('sla_local_purchase_hours', '72'), setting('yellow_ratio', '0.4')]); // 0,42 >= 0,4 -> kuning
		expect(await level()).toBe('yellow');
		responses.system_settings = fail('settings down'); // gagal -> default lama, bukan 500
		expect(await level()).toBe('red');
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

	it('role manajemen (unrestricted) & co-leader/manpower leader yang terdaftar di scope -> lolos; tanpa nominal', async () => {
		scope = { unrestricted: true };
		const body = await (await GET(ev('99'))).json();
		expect(body.success).toBe(true);
		expect(JSON.stringify(body)).not.toMatch(/total_amount|unit_price|planned_amount/);
		scope = { unrestricted: false, projectIds: [3, 99] };
		expect((await (await GET(ev('99'))).json()).success).toBe(true);
	});
});
