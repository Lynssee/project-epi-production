import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockJson = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: unknown[]) => mockJson(...a) }));

const { DEFAULT_PILLAR_CONFIG, normalizePillarConfig, pillarOfProgram, getPillarConfig, clearPillarConfigCache } = await import('./trainingPillars');

beforeEach(() => { mockJson.mockReset(); clearPillarConfigCache(); vi.spyOn(console, 'error').mockImplementation(() => {}); });

describe('trainingPillars (lapangan)', () => {
	it('kategori lama → pilar padanan; tak dikenal → fallback', () => {
		const c = DEFAULT_PILLAR_CONFIG;
		expect(pillarOfProgram({ id: 1, kategori: 'Project' }, c)).toBe('technical');
		expect(pillarOfProgram({ id: 2, kategori: 'sales' }, c)).toBe('product');
		expect(pillarOfProgram({ id: 3, kategori: 'K3' }, c)).toBe('technical');
		expect(pillarOfProgram({ id: 4, kategori: 'Aneh' }, c)).toBe('general');
		expect(pillarOfProgram({ id: 5, kategori: null }, c)).toBe('general');
	});
	it('override per program; override ke pilar tak ada dibuang', () => {
		const c = normalizePillarConfig({ ...DEFAULT_PILLAR_CONFIG, program_overrides: { 2: 'management', 3: 'xx' } });
		expect(pillarOfProgram({ id: 2, kategori: 'Umum' }, c)).toBe('management');
		expect(pillarOfProgram({ id: 3, kategori: 'Umum' }, c)).toBe('general');
	});
	it('input rusak → default', () => {
		expect(normalizePillarConfig('bukan json').pillars).toHaveLength(5);
		expect(normalizePillarConfig({ pillars: [] }).pillars).toHaveLength(5);
	});
	it('getPillarConfig membaca app_settings 1x (cache) dan menormalkan string JSON', async () => {
		mockJson.mockResolvedValue({ data: [{ setting_value: JSON.stringify({ pillars: [{ code: 'a', label: 'A', kategori: ['X'] }] }) }] });
		const a = await getPillarConfig();
		const b = await getPillarConfig();
		expect(a.pillars.map((p) => p.code)).toEqual(['a']);
		expect(b).toBe(a);
		expect(mockJson).toHaveBeenCalledTimes(1);
		expect(mockJson.mock.calls[0][0]).toContain('setting_key][_eq]=pilar_pemetaan');
	});
	it('gagal baca → default + log (katalog tetap tampil)', async () => {
		mockJson.mockRejectedValue(new Error('HTTP 503'));
		const c = await getPillarConfig();
		expect(c.pillars).toHaveLength(5);
		expect(console.error).toHaveBeenCalled();
	});
});
