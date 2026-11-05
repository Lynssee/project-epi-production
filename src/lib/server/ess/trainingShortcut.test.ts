import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockJson = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: unknown[]) => mockJson(...a) }));

const { DEFAULT_SHORTCUT_MAP, normalizeShortcutMap, pickShortcuts, getShortcutMap, clearShortcutMapCache } = await import('./trainingShortcut');
const { DEFAULT_PILLAR_CONFIG } = await import('./trainingPillars');

const cfg = structuredClone(DEFAULT_PILLAR_CONFIG);
const P = (id: number, kode: string | null, kategori: string, extra: Record<string, unknown> = {}) =>
	({ id, kode, judul: `Kursus ${id}`, kategori, wajib: false, durasi_menit: 30, ...extra }) as any;
const E = (program_id: number, status: string, progress_persen = 0) => ({ program_id, status, progress_persen }) as any;

beforeEach(() => { mockJson.mockReset(); clearShortcutMapCache(); vi.spyOn(console, 'error').mockImplementation(() => {}); });

describe('pickShortcuts', () => {
	const programs = [
		P(13, 'KC-P1-BLAST', 'Project'),
		P(15, 'KC-P3-QC', 'Project'),
		P(16, 'KC-P4-PROYEK', 'Project'),
		P(6, 'ONB-001', 'Umum'),
		P(20, 'TRN-X', 'Tutorial', { wajib: true })
	];
	it('kursus berkode prioritas lebih dulu, lalu kursus se-pilar; dibatasi 2', () => {
		const r = pickShortcuts(DEFAULT_SHORTCUT_MAP.inspection, programs, [], cfg);
		expect(r.map((x) => x.programId)).toEqual([15, 13]); // KC-P3-QC dulu, lalu technical lain (judul urut)
		expect(r[0]).toMatchObject({ kode: 'KC-P3-QC', pilar: 'technical', pilarLabel: 'Technical', status: 'baru', progress: 0 });
	});
	it('kursus yang sudah Lulus dibuang; yang sedang berjalan ditandai berjalan + progres', () => {
		const r = pickShortcuts(DEFAULT_SHORTCUT_MAP.inspection, programs, [E(15, 'Lulus', 100), E(13, 'Ongoing', 40)], cfg);
		expect(r.map((x) => x.programId)).toEqual([13, 16]); // berjalan didahulukan, lalu kursus technical lain
		expect(r[0]).toMatchObject({ programId: 13, status: 'berjalan', progress: 40 });
	});
	it('Pengajuan → pilar administrative; wajib didahulukan', () => {
		const r = pickShortcuts(DEFAULT_SHORTCUT_MAP.pengajuan, programs, [], cfg);
		expect(r.map((x) => x.programId)).toEqual([20]);
		expect(r[0].wajib).toBe(true);
	});
	it('tanpa aturan / tanpa kursus cocok / semua sudah lulus → kosong', () => {
		expect(pickShortcuts(undefined, programs, [], cfg)).toEqual([]);
		expect(pickShortcuts({ kode: ['TIDAK-ADA'] }, programs, [], cfg)).toEqual([]);
		expect(pickShortcuts({ pilar: 'administrative' }, programs, [E(20, 'Lulus')], cfg)).toEqual([]);
	});
	it('kode dicocokkan tanpa peka huruf besar; duplikat (kode + pilar sama) tidak muncul dua kali', () => {
		const r = pickShortcuts({ kode: ['kc-p3-qc'], pilar: 'technical' }, programs, [], cfg, 5);
		expect(r.filter((x) => x.programId === 15)).toHaveLength(1);
	});
});

describe('normalizeShortcutMap & getShortcutMap', () => {
	it('JSON rusak / bentuk salah → default; entri tanpa kode & pilar dibuang; kunci dinormalkan', () => {
		expect(normalizeShortcutMap('bukan json')).toEqual(DEFAULT_SHORTCUT_MAP);
		expect(normalizeShortcutMap(['x'])).toEqual(DEFAULT_SHORTCUT_MAP);
		expect(normalizeShortcutMap({ kosong: {} })).toEqual(DEFAULT_SHORTCUT_MAP);
		expect(normalizeShortcutMap('{" Inspection ":{"kode":["A"," "],"pilar":"Technical"},"x":5}')).toEqual({ inspection: { kode: ['A'], pilar: 'technical' } });
	});
	it('membaca app_settings 1x (cache 5 menit); gagal baca → default + log', async () => {
		mockJson.mockResolvedValue({ data: [{ setting_value: '{"inspection":{"pilar":"product"}}' }] });
		expect(await getShortcutMap()).toEqual({ inspection: { pilar: 'product' } });
		await getShortcutMap();
		expect(mockJson).toHaveBeenCalledTimes(1);
		expect(mockJson.mock.calls[0][0]).toContain('setting_key][_eq]=pintasan_konteks');
		clearShortcutMapCache();
		mockJson.mockRejectedValue(new Error('HTTP 503'));
		expect(await getShortcutMap()).toEqual(DEFAULT_SHORTCUT_MAP);
		expect(console.error).toHaveBeenCalled();
	});
});
