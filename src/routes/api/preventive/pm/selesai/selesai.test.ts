import { describe, it, expect, vi, beforeEach } from 'vitest';

const dx = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: any[]) => dx(...a) }));
vi.mock('$lib/server/preventive/preventiveGuard', () => ({
	authenticatePreventiveOperator: async () => ({ karyawan: { id: 1 }, personnel: { id: 'p1', name: 'BUDI', karyawan_id: 1 } })
}));
vi.mock('$lib/server/mleSettings', () => ({ getMleSettingServer: async (_k: string, f: any) => f }));

const { POST } = await import('./+server');

const TR = '11111111-2222-3333-4444-555555555555';
const ST = { Active: 'st-a', Completed: 'st-c' };
const call = async (body: any) => (await (POST as any)({ request: { json: async () => body } })).json();
const err = async (body: any) => {
	try {
		await (POST as any)({ request: { json: async () => body } });
	} catch (e: any) {
		return e;
	}
	return null;
};

let writes: Array<{ url: string; method: string; body: any }>;
function db({ tracker, template, open = [], cats = true }: any = {}) {
	writes = [];
	dx.mockImplementation(async (url: string, opts: any = {}) => {
		if (opts.method) {
			writes.push({ url, method: opts.method, body: JSON.parse(opts.body) });
			return { data: { id: 'new-1' } };
		}
		if (url.includes('/items/category'))
			return { data: cats ? [{ id: 'st-a', name: 'Active', group: 'pm_status' }, { id: 'st-c', name: 'Completed', group: 'pm_status' }, { id: 'b', name: 'Bulan', group: 'interval_unit' }] : [] };
		if (url.includes('/items/pm_due_tracker/')) return { data: tracker };
		if (url.includes('/items/pm_task_template/')) return { data: template };
		if (url.includes('/items/pm_due_tracker?')) return { data: open };
		throw new Error('url tak terduga: ' + url);
	});
}
const tracker = (o = {}) => ({ id: TR, equipment_id: 'm1', pm_task_template_id: 't1', due_date: '2026-11-01', status_id: ST.Active, ...o });
const template = { id: 't1', task_name: 'PM Bulanan Mixer', interval_value_primary: 1, interval_unit_primary: 'b' };

beforeEach(() => {
	dx.mockReset();
});

describe('POST /api/preventive/pm/selesai', () => {
	it('tanpa temuan: menutup siklus + membuat siklus berikutnya (selesai + 1 bulan)', async () => {
		db({ tracker: tracker(), template });
		const r = await call({ tracker_id: TR });
		expect(r.ok).toBe(true);
		const patch = writes.find((w) => w.method === 'PATCH')!;
		expect(patch.body).toMatchObject({ status_id: ST.Completed, ada_temuan: false, selesai_oleh: 'BUDI' });
		const baru = writes.find((w) => w.method === 'POST')!;
		expect(baru.body).toMatchObject({ equipment_id: 'm1', pm_task_template_id: 't1', status_id: ST.Active });
		expect(baru.body.due_date).toBe(r.berikutnya);
		expect(r.berikutnya > r.selesai).toBe(true);
		expect(writes.some((w) => w.url.includes('work_order'))).toBe(false);
	});

	it('ada temuan tanpa foto atau tanpa catatan → 400, tidak menulis', async () => {
		db({ tracker: tracker(), template });
		expect((await err({ tracker_id: TR, ada_temuan: true, catatan: 'bocor' }))?.status).toBe(400);
		expect((await err({ tracker_id: TR, ada_temuan: true, foto_id: 'f1' }))?.status).toBe(400);
		expect(writes).toHaveLength(0);
	});

	it('ada temuan lengkap → siklus ditutup dan WO minor dibuat', async () => {
		db({ tracker: tracker(), template });
		const r = await call({ tracker_id: TR, ada_temuan: true, catatan: 'V-belt aus', foto_id: 'f1' });
		expect(r.workOrderId).toBe('new-1');
		expect(writes.find((w) => w.url.includes('work_order'))!.body.keluhan).toContain('V-belt aus');
		expect(writes.find((w) => w.method === 'PATCH')!.body).toMatchObject({ ada_temuan: true, foto_selesai: 'f1' });
	});

	it('sudah selesai → 409 (idempoten, tidak menulis)', async () => {
		db({ tracker: tracker({ status_id: ST.Completed }), template });
		expect((await err({ tracker_id: TR }))?.status).toBe(409);
		expect(writes).toHaveLength(0);
	});

	it('sudah ada tracker terbuka untuk pasangan yang sama → tidak membuat siklus ganda', async () => {
		db({ tracker: tracker(), template, open: [{ id: 'x' }] });
		const r = await call({ tracker_id: TR });
		expect(r.berikutnya).toBeNull();
		expect(writes.filter((w) => w.method === 'POST')).toHaveLength(0);
	});

	it('template tanpa interval kalender (mis. harian lama) → hanya menutup, tanpa siklus baru', async () => {
		db({ tracker: tracker(), template: { ...template, interval_value_primary: null, interval_unit_primary: null } });
		const r = await call({ tracker_id: TR });
		expect(r.berikutnya).toBeNull();
	});

	it('kategori status PM belum ada → 503 pesan jelas; id tak valid → 400; tracker tak ada → 404', async () => {
		db({ cats: false });
		expect((await err({ tracker_id: TR }))?.status).toBe(503);
		expect((await err({ tracker_id: 'x' }))?.status).toBe(400);
		db({ tracker: null });
		expect((await err({ tracker_id: TR }))?.status).toBe(404);
	});
});
