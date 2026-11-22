import { describe, it, expect } from 'vitest';
import {
	DEFAULT_PAKTA_CONFIG,
	parsePaktaConfig,
	rulesForPath,
	isExcludedPath,
	itemsForPath,
	itemMatchesRule,
	decidePakta,
	itemKey
} from './paktaPolicy';
import type { UnconfirmedItem } from './sopReadRequirement';

const mk = (o: Partial<UnconfirmedItem>): UnconfirmedItem => ({
	type: 'sop', id: 1, flow_key: null, sop_id: 1, title: null, sop_code: null, kategori_sop: null, sub_kategori: null,
	approval_status: 'butuh_sosialisasi', sosialisasi_end_date: null, version: 1, ...o
});
const OPNAME = mk({ id: 10, sop_id: 10, title: 'SOP Stock Opname Site Proyek', sop_code: 'SOP-PRJ-320' });
const KAS = mk({ id: 11, sop_id: 11, title: 'SOP Kasbon', sop_code: 'SOP-FIN-001' });
const FLOW_OPN = mk({ type: 'flow', id: 5, sop_id: null, flow_key: 'opname_gudang', title: 'Alur opname gudang' });
const cfgOn = { ...DEFAULT_PAKTA_CONFIG, enabled: true };

describe('parsePaktaConfig', () => {
	it('kosong → default; saklar default MATI (nol perubahan perilaku sebelum diaktifkan)', () => {
		const c = parsePaktaConfig({});
		expect(c.enabled).toBe(false);
		expect(c.route_rules.length).toBeGreaterThan(0);
		expect(c.min_read_seconds).toBe(5);
	});
	it('membaca nilai valid dan membuang aturan tanpa kriteria / tanpa path absolut', () => {
		const c = parsePaktaConfig({
			'project.pakta.enabled': true,
			'project.pakta.min_read_seconds': 12,
			'project.pakta.require_scroll': true,
			'project.pakta.route_rules': [
				{ path_prefix: '/kasbon-terpusat/', match: { sop_codes: ['SOP-FIN-001'] }, label: 'Kasbon' },
				{ path_prefix: '/x', match: {} },
				{ path_prefix: 'tanpa-slash', match: { keywords: ['a'] } },
				null
			]
		});
		expect(c.enabled).toBe(true);
		expect(c.require_scroll).toBe(true);
		expect(c.min_read_seconds).toBe(12);
		expect(c.route_rules).toEqual([{ path_prefix: '/kasbon-terpusat', match: { keywords: [], sop_codes: ['sop-fin-001'], flow_keys: [], sop_ids: [], gate_keys: [] }, label: 'Kasbon' }]);
	});
	it('daftar aturan kosong yang disengaja = tidak ada rute dikunci; nilai rusak = default', () => {
		expect(parsePaktaConfig({ 'project.pakta.route_rules': [] }).route_rules).toEqual([]);
		expect(parsePaktaConfig({ 'project.pakta.route_rules': 'bukan-array' }).route_rules).toEqual(DEFAULT_PAKTA_CONFIG.route_rules);
		expect(parsePaktaConfig({ 'project.pakta.min_read_seconds': -3 }).min_read_seconds).toBe(5);
		expect(parsePaktaConfig({ 'project.pakta.min_read_seconds': 99999 }).min_read_seconds).toBe(120);
		expect(parsePaktaConfig({ 'project.pakta.enabled': 'true' }).enabled).toBe(false); // hanya boolean true yang menyalakan
	});
});

describe('rute', () => {
	it('prefix mengikuti batas segmen', () => {
		expect(rulesForPath('/stock-lapangan/opname', cfgOn)).toHaveLength(1);
		expect(rulesForPath('/stock-lapangan/opname/123?x=1', cfgOn)).toHaveLength(1);
		expect(rulesForPath('/stock-lapangan/opname-sesi', cfgOn).map((r) => r.path_prefix)).toEqual(['/stock-lapangan/opname-sesi']);
		expect(rulesForPath('/stock-lapangan/opnamex', cfgOn)).toHaveLength(0);
		expect(rulesForPath('/stock-lapangan', cfgOn)).toHaveLength(0);
	});
	it('rute wajib-kecuali (absen/insiden K3/login) tetap bebas walau daftar pengecualian dikosongkan Super Admin', () => {
		const cfg = { ...cfgOn, exclude_prefixes: [], route_rules: [{ path_prefix: '/absen', match: { keywords: ['x'] } }, { path_prefix: '/hse/insiden', match: { keywords: ['x'] } }] };
		expect(rulesForPath('/absen', cfg)).toEqual([]);
		expect(isExcludedPath('/hse/insiden/baru', cfg)).toBe(true);
		expect(isExcludedPath('/hse/izin-kerja', cfg)).toBe(false);
	});
	it('halaman darurat/baca TIDAK PERNAH dikunci walau ada aturan yang cocok', () => {
		const cfg = { ...cfgOn, route_rules: [{ path_prefix: '/absen', match: { keywords: ['x'] } }, { path_prefix: '/panduan/alur', match: { keywords: ['x'] } }] };
		expect(isExcludedPath('/absen', cfg)).toBe(true);
		expect(isExcludedPath('/panduan/alur/opname', cfg)).toBe(true);
		expect(rulesForPath('/absen', cfg)).toEqual([]);
		expect(rulesForPath('/panduan/alur', cfg)).toEqual([]);
		expect(isExcludedPath('/absensi-lain', cfg)).toBe(false);
	});
});

describe('itemsForPath', () => {
	it('hanya SOP/alur yang relevan untuk rute; unik; label dari aturan', () => {
		const r = itemsForPath([OPNAME, KAS, FLOW_OPN, OPNAME], '/stock-lapangan/opname', cfgOn);
		expect(r.items.map(itemKey)).toEqual(['sop:10', 'flow:opname_gudang']);
		expect(r.label).toBe('Stock Opname');
	});
	it('rute tak terkait → kosong (SOP kasbon tidak mengunci opname)', () => {
		expect(itemsForPath([KAS], '/stock-lapangan/opname', cfgOn).items).toEqual([]);
		expect(itemsForPath([OPNAME], '/kasbon-terpusat', cfgOn).items).toEqual([]);
	});
	it('kecocokan eksplisit via sop_codes / flow_keys / sop_ids', () => {
		const rule = { path_prefix: '/k', match: { sop_codes: ['sop-fin-001'], flow_keys: ['opname_gudang'], sop_ids: [10] } };
		expect(itemMatchesRule(KAS, rule)).toBe(true);
		expect(itemMatchesRule(FLOW_OPN, rule)).toBe(true);
		expect(itemMatchesRule(OPNAME, rule)).toBe(true);
		expect(itemMatchesRule(mk({ id: 99, sop_id: 99, title: 'lain' }), rule)).toBe(false);
	});
});

describe('decidePakta', () => {
	const items = [OPNAME, FLOW_OPN];
	it('tanpa item → tidak tampil apa pun', () => {
		expect(decidePakta({ gateMode: 'hard', items: [] })).toMatchObject({ show: false, blocked: false, presentation: 'none' });
	});
	it('shadow → tidak tampil; warn → banner tidak menahan', () => {
		expect(decidePakta({ gateMode: 'shadow', items })).toMatchObject({ show: false, blocked: false });
		expect(decidePakta({ gateMode: 'warn', items })).toMatchObject({ show: true, presentation: 'banner', blocked: false });
	});
	it('soft → modal, boleh lanjut dengan catatan; hard → modal menahan', () => {
		expect(decidePakta({ gateMode: 'soft', items })).toMatchObject({ presentation: 'modal', blocked: false, canProceedWithNote: true });
		expect(decidePakta({ gateMode: 'hard', items })).toMatchObject({ presentation: 'modal', blocked: true, canProceedWithNote: false });
	});
	it('hard: keberatan menunggu/ditolak tetap terkunci; hanya dispensasi atasan yang membuka', () => {
		expect(decidePakta({ gateMode: 'hard', items, objections: { 'sop:10': 'menunggu', 'flow:opname_gudang': 'ditolak' } }).blocked).toBe(true);
		const d = decidePakta({ gateMode: 'hard', items, objections: { 'sop:10': 'dispensasi' } });
		expect(d.blocked).toBe(true); // alur opname_gudang masih menahan
		expect(d.pending.map(itemKey)).toEqual(['flow:opname_gudang']);
		expect(d.dispensed.map(itemKey)).toEqual(['sop:10']);
		const semua = decidePakta({ gateMode: 'hard', items, objections: { 'sop:10': 'dispensasi', 'flow:opname_gudang': 'dispensasi' } });
		expect(semua).toMatchObject({ show: false, blocked: false });
	});
});

describe('bolehCentang', () => {
	it('menunggu waktu baca minimum; scroll hanya bila diwajibkan', async () => {
		const { bolehCentang, alasanBelumBolehCentang } = await import('./paktaPolicy');
		expect(bolehCentang({ elapsedSec: 2, minSec: 5, scrolledToEnd: true, requireScroll: false })).toBe(false);
		expect(bolehCentang({ elapsedSec: 5, minSec: 5, scrolledToEnd: false, requireScroll: false })).toBe(true);
		expect(bolehCentang({ elapsedSec: 9, minSec: 5, scrolledToEnd: false, requireScroll: true })).toBe(false);
		expect(bolehCentang({ elapsedSec: 9, minSec: 5, scrolledToEnd: true, requireScroll: true })).toBe(true);
		expect(bolehCentang({ elapsedSec: 0, minSec: 0, scrolledToEnd: false, requireScroll: false })).toBe(true);
		expect(alasanBelumBolehCentang({ elapsedSec: 2, minSec: 5, scrolledToEnd: true, requireScroll: false })).toContain('3 detik');
		expect(alasanBelumBolehCentang({ elapsedSec: 9, minSec: 5, scrolledToEnd: false, requireScroll: true })).toContain('Gulir');
		expect(alasanBelumBolehCentang({ elapsedSec: 9, minSec: 5, scrolledToEnd: true, requireScroll: true })).toBeNull();
	});
});

describe('listPaktaSaya', () => {
	it('hanya item yang terkait aturan rute; terkelompok prosedur vs gate; rute & label dari aturan; dispensasi tidak dihitung', async () => {
		const { listPaktaSaya, parsePaktaConfig: parse } = await import('./paktaPolicy');
		const cfg = { ...parse({}), enabled: true, route_rules: parse({ 'project.pakta.route_rules': [
			{ path_prefix: '/stock-lapangan/opname', label: 'Stock Opname', match: { keywords: ['opname'], gate_keys: ['G_A'] } },
			{ path_prefix: '/kasbon-terpusat', label: 'Kasbon', match: { keywords: ['kasbon'] } }
		] }).route_rules };
		const gate = { type: 'gate' as const, id: 9, gate_key: 'G_A', flow_key: null, sop_id: null, title: 'Foto rak', sop_code: null, kategori_sop: null, sub_kategori: null, approval_status: null, sosialisasi_end_date: null, version: 9 };
		const lain = mk({ id: 77, sop_id: 77, title: 'SOP Tanpa Rute', sop_code: 'SOP-X' });
		const r = listPaktaSaya([OPNAME, KAS, FLOW_OPN, gate, lain, OPNAME], cfg, { 'sop:11': 'dispensasi', 'flow:opname_gudang': 'menunggu' });
		expect(r.count).toBe(3);
		expect(r.prosedur.map((x) => x.key)).toEqual(['sop:10', 'flow:opname_gudang']); // KAS didispensasi, 'lain' tanpa rute, duplikat dibuang
		expect(r.prosedur[0]).toMatchObject({ route: '/stock-lapangan/opname', label: 'Stock Opname', status_kendala: null });
		expect(r.prosedur[1].status_kendala).toBe('menunggu');
		expect(r.gate.map((x) => x.key)).toEqual(['gate:G_A']);
		expect(listPaktaSaya([], cfg).count).toBe(0);
		expect(listPaktaSaya(null as any, cfg).count).toBe(0);
	});
});
