import { describe, it, expect } from 'vitest';
import { parseModeChange, isEscalation, latestGateChanges, buildGateItems, gateRingkasan } from './paktaGateChanges';
import { itemMatchesRule, itemKey, itemsForPath, parsePaktaConfig, DEFAULT_PAKTA_CONFIG } from './paktaPolicy';

const NOW = Date.parse('2026-11-18T00:00:00Z');
const row = (id: number, reason: string, date = '2026-11-10T00:00:00Z') => ({ id, date_created: date, context: 'mode_change', reason });

describe('parse & eskalasi', () => {
	it('parse kalimat log; bukan kalimat mode → null', () => {
		expect(parseModeChange('Mode G_INV_OPNAME_PHOTO (INV): soft → hard · berlaku sejak 2026-11-20 · alasan: x')).toEqual({ gate_key: 'G_INV_OPNAME_PHOTO', jenis: 'INV', from: 'soft', to: 'hard', enforce_from: '2026-11-20' });
		expect(parseModeChange('lain-lain')).toBeNull();
	});
	it('hanya kenaikan keketatan; mode asing = bukan eskalasi', () => {
		expect(isEscalation('soft', 'hard')).toBe(true);
		expect(isEscalation('(bawaan)', 'shadow')).toBe(true);
		expect(isEscalation('hard', 'soft')).toBe(false);
		expect(isEscalation('soft', 'warn')).toBe(false);
		expect(isEscalation('x', 'hard')).toBe(false);
	});
});

describe('latestGateChanges', () => {
	it('hanya gate yang diminta, dalam rentang hari, terbaru menang, id terbesar jadi versi', () => {
		const rows = [
			row(5, 'Mode G_A (PL): shadow → soft'),
			row(9, 'Mode G_A (SJ): soft → hard · berlaku sejak 2026-11-20'),
			row(7, 'Mode G_B (PL): soft → hard'),
			row(3, 'Mode G_C (PL): soft → hard', '2026-08-01T00:00:00Z') // terlalu lama
		];
		const m = latestGateChanges(rows, ['G_A', 'G_C'], { days: 30, now: NOW });
		expect([...m.keys()]).toEqual(['G_A']);
		expect(m.get('G_A')).toMatchObject({ version: 9, from: 'soft', to: 'hard', enforce_from: '2026-11-20' });
	});
	it('perubahan terbaru berupa PELONGGARAN membatalkan yang lama untuk (gate,jenis) itu', () => {
		const rows = [row(4, 'Mode G_A (PL): soft → hard'), row(8, 'Mode G_A (PL): hard → soft')];
		expect(latestGateChanges(rows, ['G_A'], { days: 30, now: NOW }).size).toBe(0);
	});
	it('baris tanpa id valid / context lain diabaikan; masukan rusak tidak melempar', () => {
		expect(latestGateChanges([{ id: 'x', reason: 'Mode G_A (PL): soft → hard' }, { id: 5, context: 'override', reason: 'Mode G_A (PL): soft → hard' }] as any, ['G_A'], { days: 30, now: NOW }).size).toBe(0);
		expect(latestGateChanges(null as any, ['G_A'], { days: 30, now: NOW }).size).toBe(0);
	});
});

describe('buildGateItems', () => {
	const changes = latestGateChanges([row(9, 'Mode G_A (SJ): soft → hard · berlaku sejak 2026-11-20')], ['G_A'], { days: 30, now: NOW });
	const defs = [{ gate_key: 'G_A', nama: 'Foto rak wajib', hint: 'Foto rak sebelum simpan.' }];
	it('item bernama manusia, ringkasan bahasa awam; kode gate tidak jadi judul', () => {
		const [it] = buildGateItems({ changes, defs, approvals: [] });
		expect(it).toMatchObject({ type: 'gate', gate_key: 'G_A', title: 'Foto rak wajib', version: 9, sop_code: null });
		expect(it.ringkasan).toContain('dari ditahan (boleh lanjut dengan alasan) menjadi wajib dipenuhi');
		expect(it.ringkasan).toContain('berlaku sejak 2026-11-20');
		expect(it.ringkasan).toContain('Foto rak sebelum simpan.');
		expect(itemKey(it)).toBe('gate:G_A');
	});
	it('sudah disetujui versi ini/lebih baru → tidak muncul; versi lama → muncul lagi', () => {
		expect(buildGateItems({ changes, defs, approvals: [{ doc_key: 'G_A', doc_version: 9 }] })).toEqual([]);
		expect(buildGateItems({ changes, defs, approvals: [{ doc_key: 'G_A', doc_version: 5 }] })).toHaveLength(1);
	});
	it('tanpa definisi → judul = kode gate (tetap tampil, tidak crash)', () => {
		expect(buildGateItems({ changes, defs: [], approvals: [] })[0].title).toBe('G_A');
		expect(gateRingkasan(changes.get('G_A')!, null)).toContain('G_A');
	});
});

describe('kebijakan rute untuk item gate', () => {
	const cfg = { ...DEFAULT_PAKTA_CONFIG, enabled: true, route_rules: parsePaktaConfig({ 'project.pakta.route_rules': [{ path_prefix: '/stock-lapangan/opname', label: 'Stock Opname', match: { gate_keys: ['g_a', 'G_A', 'bukan-gate'] } }] }).route_rules };
	const [item] = buildGateItems({ changes: latestGateChanges([row(9, 'Mode G_A (SJ): soft → hard')], ['G_A'], { days: 30, now: NOW }), defs: [], approvals: [] });
	it('gate_keys dinormalkan (huruf besar, unik, hanya pola G_*) dan aturan gate-only valid', () => {
		expect(cfg.route_rules).toHaveLength(1);
		expect(cfg.route_rules[0].match.gate_keys).toEqual(['G_A']);
	});
	it('item gate hanya cocok lewat gate_keys; SOP tidak cocok aturan gate-only; gate tidak cocok kata kunci', () => {
		expect(itemMatchesRule(item, cfg.route_rules[0])).toBe(true);
		expect(itemsForPath([item], '/stock-lapangan/opname', cfg).items).toHaveLength(1);
		expect(itemsForPath([item], '/kasbon', cfg).items).toEqual([]);
		const kw = { path_prefix: '/x', match: { keywords: ['g_a', 'foto'] } };
		expect(itemMatchesRule({ ...item, title: 'Foto G_A' }, kw)).toBe(false);
	});
	it('gate_change_days: default 30, dibatasi 1–180', () => {
		expect(parsePaktaConfig({}).gate_change_days).toBe(30);
		expect(parsePaktaConfig({ 'project.pakta.gate_change_days': 7 }).gate_change_days).toBe(7);
		expect(parsePaktaConfig({ 'project.pakta.gate_change_days': 9999 }).gate_change_days).toBe(180);
		expect(parsePaktaConfig({ 'project.pakta.gate_change_days': 0 }).gate_change_days).toBe(30);
	});
});
