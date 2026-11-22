import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_GOLDEN_RULES } from './cultureModel';

const h = vi.hoisted(() => ({
	settings: {} as Record<string, unknown>,
	pledge: null as any,
	failRead: false,
	posts: [] as any[]
}));

vi.mock('$lib/server/directus', () => ({
	directusServerJson: vi.fn(async (url: string, opts: any = {}) => {
		if (opts.method === 'POST') {
			h.posts.push(JSON.parse(opts.body));
			return { data: {} };
		}
		if (h.failRead) throw new Error('403 FORBIDDEN');
		return { data: h.pledge ? [h.pledge] : [] };
	})
}));
vi.mock('$lib/server/ess/time', () => ({ todayJakarta: () => '2026-11-13' }));
vi.mock('$lib/server/ess/budayaHarian', () => ({ loadCultureSettings: vi.fn(async () => ({ 'culture.golden_rules_enabled': true, 'culture.golden_rules_wajib': false, 'culture.golden_rules_teks': DEFAULT_GOLDEN_RULES, ...h.settings })) }));

const { parseGoldenRules, getGoldenRulesStatus, submitGoldenPledge } = await import('./goldenRules');

beforeEach(() => {
	h.settings = {};
	h.pledge = null;
	h.failRead = false;
	h.posts.length = 0;
});

describe('parseGoldenRules', () => {
	it('bersihkan bullet/baris kosong, batasi 5 butir & 160 karakter', () => {
		expect(parseGoldenRules('- A\n\n2) B\n• C')).toEqual(['A', 'B', 'C']);
		expect(parseGoldenRules(Array.from({ length: 9 }, (_, i) => `r${i}`).join('\n'))).toHaveLength(5);
		expect(parseGoldenRules('x'.repeat(300))[0]).toHaveLength(160);
		expect(parseGoldenRules(null)).toEqual([]);
	});
	it('bawaan = 3 butir', () => {
		expect(parseGoldenRules(DEFAULT_GOLDEN_RULES)).toHaveLength(3);
	});
});

describe('getGoldenRulesStatus', () => {
	const k = { id: 7 };
	it('aktif, belum berikrar → tampil; sudah → sudahIkrar', async () => {
		const a = await getGoldenRulesStatus(k, 12);
		expect(a).toMatchObject({ enabled: true, wajib: false, sudahIkrar: false });
		expect(a.rules).toHaveLength(3);
		h.pledge = { id: 1 };
		expect((await getGoldenRulesStatus(k, '12')).sudahIkrar).toBe(true);
	});
	it('dimatikan / tanpa butir / project_id tidak valid → mati', async () => {
		h.settings = { 'culture.golden_rules_enabled': false };
		expect((await getGoldenRulesStatus(k, 12)).enabled).toBe(false);
		h.settings = { 'culture.golden_rules_teks': '   ' };
		expect((await getGoldenRulesStatus(k, 12)).enabled).toBe(false);
		h.settings = {};
		expect((await getGoldenRulesStatus(k, 'abc')).enabled).toBe(false);
	});
	it('ANTI-LOCKDOWN: skema belum ada → fitur mati & dilog (tidak pernah wajib/memblokir)', async () => {
		h.settings = { 'culture.golden_rules_wajib': true };
		h.failRead = true;
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const r = await getGoldenRulesStatus(k, 12);
		expect(r).toEqual({ enabled: false, wajib: false, rules: [], sudahIkrar: false });
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});
	it('wajib dari setelan', async () => {
		h.settings = { 'culture.golden_rules_wajib': true };
		expect((await getGoldenRulesStatus(k, 12)).wajib).toBe(true);
	});
});

describe('submitGoldenPledge', () => {
	const k = { id: 7 };
	it('mencatat sekali (identitas dari server); panggilan ulang idempoten', async () => {
		expect(await submitGoldenPledge(k, 12)).toEqual({ ok: true, sudah: false });
		expect(h.posts).toEqual([{ karyawan_id: 7, project_id: 12, tanggal: '2026-11-13' }]);
		h.pledge = { id: 1 };
		expect(await submitGoldenPledge(k, 12)).toEqual({ ok: true, sudah: true });
		expect(h.posts).toHaveLength(1);
	});
	it('project_id tidak valid → 400; fitur mati → 409', async () => {
		await expect(submitGoldenPledge(k, 'x')).rejects.toMatchObject({ status: 400 });
		h.settings = { 'culture.golden_rules_enabled': false };
		await expect(submitGoldenPledge(k, 12)).rejects.toMatchObject({ status: 409 });
	});
});
