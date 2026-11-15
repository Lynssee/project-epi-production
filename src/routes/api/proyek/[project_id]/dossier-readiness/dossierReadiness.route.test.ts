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
// Hari ini dibekukan: Selasa 2026-11-10 (WIB)
vi.mock('$lib/server/gates/plDisiplinFieldGates', async (orig) => {
	const real: any = await orig();
	return { ...real, wibParts: () => ({ ymd: '2026-11-10', minutes: 600 }) };
});

import { GET } from './+server';

const ev = (id = '7') =>
	({ params: { project_id: id }, request: new Request('http://x', { headers: { authorization: 'Bearer t' } }) }) as any;
const ok = (rows: any = []) => () => ({ data: rows });
const fail = (m: string) => () => {
	throw new Error(m);
};

beforeEach(() => {
	scope = { unrestricted: false, projectIds: [7] };
	urls.length = 0;
	vi.spyOn(console, 'error').mockImplementation(() => {});
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	responses = {
		system_settings: ok([]),
		projects: () => ({ data: { id: 7, status: 'on progress', start_date: '2026-10-01' } }),
		manpower_absensi: ok([
			{ tanggal: '2026-11-09', verifikasi_leader_status: 'menunggu' },
			{ tanggal: '2026-11-07', verifikasi_leader_status: 'disetujui' }
		]),
		reports: ok([
			{ date: '2026-11-08T18:30:00.000Z', activity_status: 'on_progress', qc_ambient: { applicable: true, filled_today: true }, progress: [{ x: 1 }] }, // 9 Nov 01:30 WIB
			{ date: '2026-11-06T00:00:00', activity_status: 'on_progress', qc_ambient: { applicable: true, filled_today: false }, progress: [{ x: 1 }] },
			{ date: '2026-11-05T00:00:00', activity_status: 'hold', qc_ambient: { applicable: true, filled_today: false }, progress: [{ x: 1 }] },
			{ date: '2026-11-04T00:00:00', activity_status: 'on_progress', qc_ambient: { applicable: false, filled_today: false }, progress: [{ x: 1 }] },
			{ date: '2026-11-03T00:00:00', activity_status: 'on_progress', qc_ambient: { applicable: true, filled_today: false }, progress: [] }
		]),
		manpower_assignment: ok([{ id: 1 }]),
		pengajuan_anggaran: ok([
			{ id: 41, tanggal_dicairkan: '2026-10-01' },
			{ id: 42, tanggal_dicairkan: '2026-11-09' }
		])
	};
});

describe('GET dossier-readiness', () => {
	it('bukan pemegang proyek -> 403; id rusak -> 400', async () => {
		await expect(GET(ev('99'))).rejects.toMatchObject({ status: 403 });
		await expect(GET(ev('abc'))).rejects.toMatchObject({ status: 400 });
	});
	it('proyek belum on progress -> tidak berlaku, tanpa query data', async () => {
		responses.projects = () => ({ data: { id: 7, status: 'waiting', start_date: null } });
		const body = await (await GET(ev())).json();
		expect(body.data.applicable).toBe(false);
		expect(urls.some((u) => u.includes('manpower_absensi') || u.includes('/reports'))).toBe(false);
	});
	it('mengembalikan hari kerja, tanggal presensi, laporan (konversi WIB) & jumlah menunggu verifikasi', async () => {
		const { data } = await (await GET(ev())).json();
		expect(data.applicable).toBe(true);
		expect(data.days).toEqual(['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-09']);
		expect([...data.absensiDates].sort()).toEqual(['2026-11-07', '2026-11-09']);
		expect(data.absensiMenunggu).toBe(1);
		expect(data.reportDates).toEqual(['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-09']);
		expect(JSON.stringify(data)).not.toMatch(/amount|nominal|biaya/i);
	});
	it('QC ambient: hanya hari applicable + ada progres + bukan Hold yang wajib; filled_today = terpenuhi', async () => {
		const { data } = await (await GET(ev())).json();
		expect(data.qcRequiredDays).toEqual(['2026-11-06', '2026-11-09']);
		expect(data.qcDoneDays).toEqual(['2026-11-09']);
	});
	it('LPJ: hitung yang eksplisit belum; lewat masa tenggang 7 hari dari tanggal cair; tautkan id pertama yang lewat', async () => {
		const { data } = await (await GET(ev())).json();
		expect(data.lpj).toEqual({ belum: 2, overdue: 1, firstId: 41 });
	});
	it('masa tenggang LPJ dari setelan; sumber LPJ gagal -> null + warning', async () => {
		responses.system_settings = ok([{ setting_key: 'project.field_dossier.lpj_grace_days', setting_type: 'number', setting_value: '60' }]);
		expect((await (await GET(ev())).json()).data.lpj.overdue).toBe(0);
		responses.pengajuan_anggaran = fail('x');
		const { data } = await (await GET(ev())).json();
		expect(data.lpj).toBeNull();
		expect(data.warnings.join(' ')).toContain('LPJ');
	});
	it('setelan system_settings dipakai (window & ambang)', async () => {
		responses.system_settings = ok([
			{ setting_key: 'project.field_dossier.window_days', setting_type: 'number', setting_value: '3' },
			{ setting_key: 'project.field_dossier.ok_pct', setting_type: 'number', setting_value: '75' }
		]);
		const { data } = await (await GET(ev())).json();
		// 3 hari kalender terakhir = 7, 8, 9 Nov; 8 Nov Minggu (libur) dibuang
		expect(data.days).toEqual(['2026-11-07', '2026-11-09']);
		expect(data.thresholds.okPct).toBe(75);
	});
	it('dimatikan lewat setelan -> tidak berlaku', async () => {
		responses.system_settings = ok([{ setting_key: 'project.field_dossier.enabled', setting_type: 'boolean', setting_value: 'false' }]);
		expect((await (await GET(ev())).json()).data.applicable).toBe(false);
	});
	it('presensi gagal -> flag + warning, TIDAK dianggap lengkap; laporan tetap ada', async () => {
		responses.manpower_absensi = fail('boom');
		const { data } = await (await GET(ev())).json();
		expect(data.absensiFailed).toBe(true);
		expect(data.warnings.join(' ')).toContain('presensi');
		expect(data.reportDates).toContain('2026-11-09');
	});
	it('tanpa baris presensi & tanpa tim terdaftar -> presensi tidak berlaku (null)', async () => {
		responses.manpower_absensi = ok([]);
		responses.manpower_assignment = ok([]);
		expect((await (await GET(ev())).json()).data.absensiDates).toBeNull();
	});
	it('proyek gagal dibaca -> 502', async () => {
		responses.projects = fail('x');
		await expect(GET(ev())).rejects.toMatchObject({ status: 502 });
	});
});
