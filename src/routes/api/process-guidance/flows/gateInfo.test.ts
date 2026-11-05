import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/gates/fieldGateHints', () => ({ fetchFieldGateHints: vi.fn() }));
import { fetchFieldGateHints } from '$lib/server/gates/fieldGateHints';
import { collectGateScopes, gateKeysOfFlow, compactGate, loadGateInfoForFlow, MAX_SCOPES } from './gateInfo';

const fetchHints = fetchFieldGateHints as unknown as ReturnType<typeof vi.fn>;
const g = (key: string, modul = 'project_report', documentType = 'laporan_harian') => ({ key, modul, documentType });
const flow = (nodes: any[]) => ({ id: 'f', title: 'F', description: '', lanes: [], edges: [], nodes }) as any;
const entry = (o: any = {}) => ({
	mode: 'hard', message: 'Foto kurang', hint: 'Ambil dari 2 sisi', severity_hint: null, nama: 'Foto BA', action_type: null, action_config: null,
	bypass_policy: { method: 'override_gm' }, checklist_items: [{ id: 'a', label: 'Foto sisi kiri', wajib: true, tips: 'terang' }, { id: 'b', label: '  ' }], owner_role: 'Finance', ...o
});

beforeEach(() => vi.clearAllMocks());

describe('collectGateScopes / gateKeysOfFlow', () => {
	it('scope unik modul×dokumen; gate tanpa modul/dokumen diabaikan; kunci terkumpul', () => {
		const f = flow([{ id: 'a', gates: [g('G1'), g('G2'), g('G3', 'finance', 'invoices'), { key: 'G4', modul: '', documentType: 'x' }] }, { id: 'b' }]);
		expect(collectGateScopes(f)).toEqual([{ modul: 'project_report', documentType: 'laporan_harian' }, { modul: 'finance', documentType: 'invoices' }]);
		expect([...gateKeysOfFlow(f)].sort()).toEqual(['G1', 'G2', 'G3', 'G4']);
		expect(collectGateScopes(null)).toEqual([]);
	});
});

describe('compactGate', () => {
	it('ringkas: bypass none → null, checklist kosong dibuang, teks dipotong', () => {
		const c = compactGate(entry({ bypass_policy: { method: 'none' }, message: 'x'.repeat(500) }) as any);
		expect(c.bypass).toBeNull();
		expect(c.message!.length).toBe(300);
		expect(c.checklist).toEqual([{ label: 'Foto sisi kiri', wajib: true, tips: 'terang' }]);
		expect(compactGate(entry() as any)).toMatchObject({ mode: 'hard', bypass: 'override_gm', owner_role: 'Finance' });
	});
});

describe('loadGateInfoForFlow', () => {
	it('alur tanpa gate → tanpa panggilan ke admin', async () => {
		expect(await loadGateInfoForFlow(flow([{ id: 'a' }]), 'Bearer t')).toEqual({ available: true, gates: {} });
		expect(fetchHints).not.toHaveBeenCalled();
	});

	it('hanya gate yang dirujuk alur; token diteruskan; satu panggilan per scope', async () => {
		fetchHints.mockImplementation(async (modul: string) => ({ available: true, modes: modul === 'finance' ? { G3: entry({ mode: 'soft' }), LAIN: entry() } : { G1: entry(), TIDAK_DIPAKAI: entry() } }));
		const f = flow([{ id: 'a', gates: [g('G1'), g('G3', 'finance', 'invoices')] }]);
		const r = await loadGateInfoForFlow(f, 'Bearer t');
		expect(fetchHints).toHaveBeenCalledTimes(2);
		expect(fetchHints).toHaveBeenCalledWith('finance', 'invoices', 'Bearer t');
		expect(Object.keys(r.gates).sort()).toEqual(['G1', 'G3']);
		expect(r.gates.G3.mode).toBe('soft');
		expect(r.partial).toBeUndefined();
	});

	it('sebagian scope gagal → partial; semua gagal → available:false + alasan (tidak melempar)', async () => {
		const f = flow([{ id: 'a', gates: [g('G1'), g('G3', 'finance', 'invoices')] }]);
		fetchHints.mockImplementation(async (modul: string) => (modul === 'finance' ? { available: false, reason: 'admin 503' } : { available: true, modes: { G1: entry() } }));
		expect(await loadGateInfoForFlow(f, 't')).toMatchObject({ available: true, partial: true, gates: { G1: expect.any(Object) } });
		fetchHints.mockResolvedValue({ available: false, reason: 'ERP_EPI1_BASE_URL kosong' });
		expect(await loadGateInfoForFlow(f, 't')).toEqual({ available: false, gates: {}, reason: 'ERP_EPI1_BASE_URL kosong' });
		fetchHints.mockRejectedValue(new Error('timeout'));
		expect(await loadGateInfoForFlow(f, 't')).toMatchObject({ available: false, reason: 'timeout' });
	});

	it(`scope dibatasi ${MAX_SCOPES} (hemat beban admin) dan ditandai partial`, async () => {
		const nodes = [{ id: 'a', gates: Array.from({ length: 12 }, (_, i) => g(`G${i}`, `m${i}`, 'd')) }];
		fetchHints.mockResolvedValue({ available: true, modes: {} });
		const r = await loadGateInfoForFlow(flow(nodes), 't');
		expect(fetchHints).toHaveBeenCalledTimes(MAX_SCOPES);
		expect(r.partial).toBe(true);
	});
});
