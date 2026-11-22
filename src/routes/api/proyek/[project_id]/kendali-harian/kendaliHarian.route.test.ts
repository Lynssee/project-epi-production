import { describe, it, expect, vi, beforeEach } from 'vitest';

let scope: any = { unrestricted: false, projectIds: [7] };
let responses: Record<string, () => any> = {};
const urls: string[] = [];

vi.mock('$lib/server/firebaseAuth', () => ({ requireUser: vi.fn(async () => ({ localId: 'u1', email: 'pl@epi.test' })) }));
vi.mock('$lib/server/fieldProjectScope', () => ({ resolveFieldProjectScope: vi.fn(async () => scope) }));
vi.mock('$lib/server/directus', () => ({
	directusServerJson: vi.fn(async (url: string) => {
		urls.push(url);
		const name = (url.match(/\/items\/([a-z_]+)/) || [])[1];
		const fn = responses[name];
		if (!fn) throw new Error(`tak ada respons untuk ${name}`);
		return fn();
	})
}));
// Hari ini dibekukan: Kamis 2026-11-12 (WIB)
vi.mock('$lib/server/gates/plDisiplinFieldGates', async (orig) => {
	const real: any = await orig();
	return { ...real, wibParts: () => ({ ymd: '2026-11-12', minutes: 600 }) };
});

import { GET } from './+server';

const ev = (id = '7') =>
	({ params: { project_id: id }, request: new Request('http://x', { headers: { authorization: 'Bearer t' } }) }) as any;
const ok = (rows: any = []) => () => ({ data: rows });
const fail = (m: string) => () => {
	throw new Error(m);
};
const PLANNING = { categories: [{ subtasks: [{ id: 's1', volume: 100 }] }] };

beforeEach(() => {
	scope = { unrestricted: false, projectIds: [7] };
	urls.length = 0;
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	responses = {
		system_settings: ok([]),
		projects: () => ({ data: { id: 7, status: 'on progress', start_date: '2026-10-01', so_customer_id: 55, timeline_planning: PLANNING } }),
		reports: ok([
			{ date: '2026-11-09T00:00:00', progress: [{ subtask_id: 's1', progress_value: 30 }] },
			{ date: '2026-11-10T18:30:00.000Z', progress: [{ subtask_id: 's1', progress_value: 10 }] } // 11 Nov 01:30 WIB
		]),
		so_rab: ok([{ scurve_baseline: [{ d: '2026-11-01', p: 0 }, { d: '2026-11-29', p: 100 }] }]),
		pengajuan_anggaran: ok([{ id: 41, nomor_pengajuan: 'PA-1', tujuan_pengajuan: 'Uang muka', tanggal_dicairkan: '2026-11-01' }])
	};
});

describe('GET kendali-harian', () => {
	it('403 bila bukan pemegang proyek; 400 untuk id rusak', async () => {
		scope = { unrestricted: false, projectIds: [9] };
		await expect(GET(ev())).rejects.toMatchObject({ status: 403 });
		await expect(GET(ev('abc'))).rejects.toMatchObject({ status: 400 });
	});

	it('tidak berlaku bila proyek bukan on progress, atau dimatikan setelan', async () => {
		responses.projects = () => ({ data: { id: 7, status: 'persiapan' } });
		const r = await (await GET(ev())).json();
		expect(r.data).toMatchObject({ applicable: false, reason: 'status' });

		responses.projects = () => ({ data: { id: 7, status: 'on progress' } });
		responses.system_settings = ok([{ setting_key: 'project.field_kendali.enabled', setting_type: 'boolean', setting_value: 'false' }]);
		const r2 = await (await GET(ev())).json();
		expect(r2.data).toMatchObject({ applicable: false, reason: 'disabled' });
	});

	it('mengembalikan tanggal laporan (WIB), LPJ, baseline & deret aktual; tanpa nominal', async () => {
		const r = await (await GET(ev())).json();
		expect(r.success).toBe(true);
		const d = r.data;
		expect(d).toMatchObject({ applicable: true, today: '2026-11-12', calendarDays: 28, lpjGraceDays: 7, lpjFailed: false, reportsFailed: false });
		expect(d.reportDates).toEqual(['2026-11-09', '2026-11-11']);
		expect(d.lpj).toHaveLength(1);
		expect(d.scurve.baseline).toHaveLength(2);
		expect(d.scurve.actual.map((a: any) => a.d)).toEqual(['2026-11-09', '2026-11-11']);
		expect(d.scurve.actual[1].p).toBe(40);
		expect(JSON.stringify(d)).not.toMatch(/total_amount|nominal/);
	});

	it('query dipisah per relasi: tak ada field relasi bersarang; hanya LPJ eksplisit "belum"', async () => {
		await GET(ev());
		for (const u of urls) expect(u).not.toMatch(/fields=[^&]*\./);
		const lpjUrl = urls.find((u) => u.includes('/items/pengajuan_anggaran'))!;
		expect(lpjUrl).toContain('filter[status_pertanggungjawaban][_eq]=belum');
	});

	it('proyek tanpa subtask: tidak membaca progres/baseline (hemat query), kalender tetap ada', async () => {
		responses.projects = () => ({ data: { id: 7, status: 'on progress', start_date: '2026-10-01', timeline_planning: null } });
		const r = await (await GET(ev())).json();
		expect(r.data.scurve).toMatchObject({ baseline: null, actual: [], hasSubtasks: false });
		expect(urls.some((u) => u.includes('/items/so_rab'))).toBe(false);
		expect(urls.find((u) => u.includes('/items/reports'))).not.toContain('progress');
		expect(r.data.reportDates).toEqual(['2026-11-09', '2026-11-11']);
	});

	it('sumber gagal → bagian itu null + warning, BUKAN dianggap aman', async () => {
		responses.reports = fail('boom');
		responses.pengajuan_anggaran = fail('boom2');
		const r = await (await GET(ev())).json();
		expect(r.data.reportDates).toBeNull();
		expect(r.data.reportsFailed).toBe(true);
		expect(r.data.lpj).toBeNull();
		expect(r.data.lpjFailed).toBe(true);
		expect(r.data.scurve).toBeNull();
		expect(r.data.warnings.length).toBeGreaterThanOrEqual(2);
	});

	it('toggle kartu dari setelan: show_lpj=false → tidak query LPJ', async () => {
		responses.system_settings = ok([{ setting_key: 'project.field_kendali.show_lpj', setting_type: 'boolean', setting_value: 'false' }]);
		const r = await (await GET(ev())).json();
		expect(r.data.show.lpj).toBe(false);
		expect(r.data.lpj).toBeNull();
		expect(urls.some((u) => u.includes('/items/pengajuan_anggaran'))).toBe(false);
	});
});
