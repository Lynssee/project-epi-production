import { describe, it, expect, vi, beforeEach } from 'vitest';

const dx = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: any[]) => dx(...a) }));

import {
	resolveMentorConfig, buildMenteeMap, computeTeamTraining, getTeamTrainingHealth, catatPembinaan, PembinaanError, _resetTeamTrainingCacheForTest
} from './teamTraining';

const TODAY = new Date(2026, 10, 18);
const base = { sumber_daftar: 'ditugaskan' };

describe('resolveMentorConfig (salinan setia erp-epi)', () => {
	it('bawaan aman: shadow, sumber mentor_id → fungsional → langsung, bobot dinormalisasi', () => {
		const c = resolveMentorConfig({ mentor_w_kelulusan_pct: 30, mentor_w_nilai_pct: 30 });
		expect(c.mode).toBe('shadow');
		expect(c.sources).toEqual(['mentor_id', 'atasan_fungsional_id', 'atasan_id']);
		expect(c.wKelulusan).toBeCloseTo(0.5);
	});
	it('urutan sumber mengikuti setelan; nilai tak dikenal dibuang; kosong → bawaan', () => {
		expect(resolveMentorConfig({ mentor_hierarchy_sources: ['atasan_id', 'mentor_id', 'xx'] }).sources).toEqual(['atasan_id', 'mentor_id']);
		expect(resolveMentorConfig({ mentor_hierarchy_sources: '["xx"]' }).sources).toEqual(['mentor_id', 'atasan_fungsional_id', 'atasan_id']);
	});
});

describe('buildMenteeMap', () => {
	it('mentor khusus > atasan fungsional > atasan langsung, dan tak menjadikan diri sendiri atasan', () => {
		const rows = [{ id: 3, atasan_id: 1, atasan_fungsional_id: 9 }, { id: 4, atasan_id: 1, atasan_fungsional_id: 9, mentor_id: 7 }, { id: 5, atasan_id: 5 }];
		const m = buildMenteeMap(rows, ['mentor_id', 'atasan_fungsional_id', 'atasan_id']);
		expect(m.get('9')).toEqual(['3']);
		expect(m.get('7')).toEqual(['4']);
		expect(m.size).toBe(2);
	});
});

describe('computeTeamTraining', () => {
	const c = resolveMentorConfig({});
	it('baru daftar (belum lewat masa tenggang) tidak dihitung', () => {
		expect(computeTeamTraining([{ ...base, karyawan_id: 2, status: 'Enrolled', tanggal_daftar: '2026-11-17', tenggat: '2026-12-30' }], c, TODAY)).toBeNull();
	});
	it('Gagal → kritis, perMentee terurut terendah dulu, nama dari nameOf', () => {
		const r = computeTeamTraining([
			{ ...base, karyawan_id: 2, status: 'Lulus', nilai_akhir: 90 },
			{ ...base, karyawan_id: 3, status: 'Gagal', nilai_akhir: 30 }
		], c, TODAY, (id) => ({ '2': 'Ani', '3': 'Budi' } as Record<string, string>)[id]);
		expect(r!.perMentee[0]).toMatchObject({ nama: 'Budi', passRate: 0, kritis: true });
		expect(r!.raw.kritisMentees).toBe(1);
		expect(r!.value).toBe(Math.round((0.6 * 50 + 0.4 * 60) * 10) / 10);
	});
	it('rata-rata nilai hanya dari yang bernilai; tanpa nilai sama sekali → null & skor = kelulusan (tanpa hukuman ganda)', () => {
		const r1 = computeTeamTraining([
			{ ...base, karyawan_id: 2, status: 'Lulus', nilai_akhir: 80 },
			{ ...base, karyawan_id: 3, status: 'Ongoing', tanggal_daftar: '2026-10-01' }
		], resolveMentorConfig({ mentor_bonus_all_pass_pct: 0 }), TODAY);
		expect(r1!.raw.avgScore).toBe(80);
		expect(r1!.value).toBe(Math.round((0.6 * 50 + 0.4 * 80) * 10) / 10);
		const r2 = computeTeamTraining([
			{ ...base, karyawan_id: 2, status: 'Ongoing', tanggal_daftar: '2026-10-01' },
			{ ...base, karyawan_id: 4, status: 'Gagal' }
		], resolveMentorConfig({ mentor_bonus_all_pass_pct: 0 }), TODAY);
		expect(r2!.raw.avgScore).toBeNull();
		expect(r2!.value).toBe(0);
		expect(r2!.perMentee.every((p) => p.avgNilai === null)).toBe(true);
	});
	it('daftar mandiri diabaikan pada wajib_only', () => {
		expect(computeTeamTraining([{ karyawan_id: 2, status: 'Gagal', sumber_daftar: 'mandiri' }], c, TODAY)).toBeNull();
	});
});

function route(opts: { mode?: string; members?: any[]; enr?: any[]; plan?: any[] } = {}) {
	dx.mockImplementation(async (path: string, init?: any) => {
		if (path.startsWith('/items/app_settings')) return { data: [{ setting_key: 'mentor_kpi_mode', setting_value: opts.mode ?? 'shadow' }] };
		if (path.startsWith('/items/karyawan')) return { data: opts.members ?? [] };
		if (path.startsWith('/items/training_enrollment')) return { data: opts.enr ?? [] };
		if (path.startsWith('/items/training_program')) return { data: [{ id: 7, judul: 'K3 Dasar' }] };
		if (path.startsWith('/items/kpi_action_plans') && init?.method === 'POST') return { data: { id: 99 } };
		if (path.startsWith('/items/kpi_action_plans/') && init?.method === 'PATCH') return { data: {} };
		if (path.startsWith('/items/kpi_action_plans?')) return { data: opts.plan ?? [] };
		throw new Error('unexpected ' + path);
	});
}
const members = [
	{ id: 2, nama_karyawan: 'Ani', status: 'on', atasan_id: 1, atasan_fungsional_id: null },
	{ id: 3, nama_karyawan: 'Budi', status: 'on', atasan_id: 1, atasan_fungsional_id: null },
	{ id: 4, nama_karyawan: 'Cici', status: 'on', atasan_id: 1, atasan_fungsional_id: 9 } // fungsional ke 9 → bukan bawahan 1
];
const enr = [
	{ id: 1, karyawan_id: 2, program_id: 7, status: 'Lulus', nilai_akhir: 90, ...base },
	{ id: 2, karyawan_id: 3, program_id: 7, status: 'Gagal', nilai_akhir: 30, tenggat: '2026-11-01', ...base }
];

describe('getTeamTrainingHealth', () => {
	beforeEach(() => { dx.mockReset(); _resetTeamTrainingCacheForTest(); });

	it('mode off → aktif:false tanpa query karyawan/enrollment', async () => {
		route({ mode: 'off' });
		const h = await getTeamTrainingHealth(1, TODAY);
		expect(h.aktif).toBe(false);
		expect(dx.mock.calls.some((c) => String(c[0]).startsWith('/items/training_enrollment'))).toBe(false);
	});

	it('hanya bawahan yang penanggung jawab pertamanya = atasan; status & estimasi terisi', async () => {
		route({ members, enr });
		const h = await getTeamTrainingHealth(1, TODAY);
		expect(h.jumlahAnggota).toBe(2);
		expect(h.anggota.map((a) => a.nama)).toEqual(['Budi', 'Ani']); // perlu dibina dulu
		expect(h.anggota[0]).toMatchObject({ status: 'perlu_dibina', kritis: true });
		expect(h.anggota[0].training[0]).toMatchObject({ judul: 'K3 Dasar', status: 'Gagal', terlambat: true });
		expect(h.perluDibina).toBe(1);
		expect(h.mode).toBe('shadow');
		expect(h.estimasiKpi).not.toBeNull();
	});

	it('atasan tanpa bawahan → kosong, tanpa query training', async () => {
		route({ members: [] });
		const h = await getTeamTrainingHealth(1, TODAY);
		expect(h.jumlahAnggota).toBe(0);
		expect(dx.mock.calls.some((c) => String(c[0]).startsWith('/items/training_enrollment'))).toBe(false);
	});
});

describe('catatPembinaan', () => {
	const mgr = { id: 1, nama_karyawan: 'Pak Atasan', divisi: 'PRODUKSI', email_company: 'a@x.id' };
	beforeEach(() => { dx.mockReset(); _resetTeamTrainingCacheForTest(); });

	it('menolak bawahan orang lain (otorisasi server)', async () => {
		route({ members });
		await expect(catatPembinaan(mgr, { memberId: 4, catatan: 'Sudah dibahas' }, TODAY)).rejects.toMatchObject({ status: 403 });
	});
	it('menolak catatan terlalu pendek', async () => {
		route({ members });
		await expect(catatPembinaan(mgr, { memberId: 2, catatan: 'ok' }, TODAY)).rejects.toBeInstanceOf(PembinaanError);
	});
	it('membuat Action Plan baru dengan kpi_code & pic yang diperiksa gate admin', async () => {
		route({ members, plan: [] });
		const r = await catatPembinaan(mgr, { memberId: 3, catatan: 'Pendampingan ulang materi K3' }, TODAY);
		expect(r).toEqual({ planId: 99, created: true });
		const post = dx.mock.calls.find((c) => c[0] === '/items/kpi_action_plans' && c[1]?.method === 'POST');
		const body = JSON.parse(post![1].body);
		expect(body).toMatchObject({ kpi_code: 'team_training_accountability', pic_karyawan_id: 1, period: '2026-11', status: 'open', department: 'PRODUKSI' });
		expect(body.description).toContain('Budi');
	});
	it('plan terbuka bulan ini → catatan ditambahkan (tidak membuat plan ganda)', async () => {
		route({ members, plan: [{ id: 50, description: '[2026-11-10] Ani: awal' }] });
		const r = await catatPembinaan(mgr, { memberId: 3, catatan: 'Pendampingan lanjutan' }, TODAY);
		expect(r).toEqual({ planId: 50, created: false });
		const patch = dx.mock.calls.find((c) => c[1]?.method === 'PATCH');
		expect(JSON.parse(patch![1].body).description).toContain('Ani: awal');
		expect(dx.mock.calls.some((c) => c[0] === '/items/kpi_action_plans' && c[1]?.method === 'POST')).toBe(false);
	});
});
