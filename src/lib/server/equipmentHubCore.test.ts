import { describe, it, expect } from 'vitest';
import {
	DEFAULT_HUB_SETTINGS,
	normalizeHubSettings,
	resolveProfileKey,
	actionsForProfile,
	buildActions,
	redactCost,
	computeExpiry
} from './equipmentHubCore';

describe('normalizeHubSettings', () => {
	it('baris kosong → default (nominal tersembunyi)', () => {
		expect(normalizeHubSettings([])).toEqual(DEFAULT_HUB_SETTINGS);
		expect(normalizeHubSettings(null).showCost).toBe(false);
	});
	it('izin kosong disengaja = tak seorang pun', () => {
		expect(normalizeHubSettings([{ key: 'eq_hub_izin_biaya', value: '' }]).costPermissions).toEqual([]);
		expect(normalizeHubSettings([{ key: 'eq_hub_izin_biaya', value: 'a, b' }]).costPermissions).toEqual(['a', 'b']);
	});
	it('tab: filter nilai tak valid, JSON string diterima, kosong → default', () => {
		expect(normalizeHubSettings([{ key: 'eq_hub_tab_aktif', value: ['p2h', 'xxx', 'p2h', 'pembelian'] }]).tabs).toEqual(['p2h', 'pembelian']);
		expect(normalizeHubSettings([{ key: 'eq_hub_tab_aktif', value: '["perbaikan"]' }]).tabs).toEqual(['perbaikan']);
		expect(normalizeHubSettings([{ key: 'eq_hub_tab_aktif', value: ['xxx'] }]).tabs).toEqual(DEFAULT_HUB_SETTINGS.tabs);
		expect(normalizeHubSettings([{ key: 'eq_hub_tab_aktif', value: '{rusak' }]).tabs).toEqual(DEFAULT_HUB_SETTINGS.tabs);
	});
	it('profil kustom divalidasi (aksi asing dibuang, profil tanpa aksi dibuang)', () => {
		const s = normalizeHubSettings([{ key: 'eq_hub_profil', value: { a: { kata_kunci: ['Truk'], aksi: ['p2h', 'zzz'] }, b: { kata_kunci: [], aksi: ['p2h'] } } }]);
		expect(Object.keys(s.profiles)).toEqual(['a']);
		expect(s.profiles.a).toEqual({ kataKunci: ['truk'], aksi: ['p2h'] });
	});
	it('boolean string', () => {
		expect(normalizeHubSettings([{ key: 'eq_hub_tampil_biaya', value: 'true' }]).showCost).toBe(true);
	});
});

describe('profil kategori', () => {
	const P = DEFAULT_HUB_SETTINGS.profiles;
	it('cocok kata kunci (parent_category atau nama kategori)', () => {
		expect(resolveProfileKey('KENDARAAN', 'Kendaraan Roda 4', P)).toBe('kendaraan');
		expect(resolveProfileKey('EQUIPMENT', 'Compressor Screw', P)).toBe('alat_berat');
		expect(resolveProfileKey(null, 'Bangunan', P)).toBe('fasilitas');
	});
	it('tak cocok / kosong → umum dengan aksi generik', () => {
		expect(resolveProfileKey('LAIN', 'Meja', P)).toBe('umum');
		expect(resolveProfileKey(null, null, P)).toBe('umum');
		expect(actionsForProfile('umum', P)).toEqual(['p2h', 'lapor', 'pm']);
	});
	it('buildActions mengisi href dengan id ter-encode', () => {
		const a = buildActions('kendaraan', P, 'abc 1');
		expect(a.find((x) => x.id === 'p2h')?.href).toBe('/preventive/p2h/abc%201');
		expect(a.find((x) => x.id === 'komponen')?.href).toBe('tab:perbaikan');
	});
});

describe('redactCost', () => {
	const rows = [{ poNumber: 'PO-1', unitPrice: 10, totalPrice: 20, discountAmount: 1 }];
	it('tidak berhak → nominal null, data lain utuh, objek asli tak berubah', () => {
		const r = redactCost(rows, false);
		expect(r[0]).toEqual({ poNumber: 'PO-1', unitPrice: null, totalPrice: null, discountAmount: null });
		expect(rows[0].unitPrice).toBe(10);
	});
	it('berhak → apa adanya', () => {
		expect(redactCost(rows, true)).toBe(rows);
	});
});

describe('computeExpiry', () => {
	const now = Date.parse('2026-11-14T10:00:00Z');
	it('menghitung level', () => {
		const r = computeExpiry({ stnk_expiry: '2026-11-20', tax_expiry: '2026-10-01', kir_expiry: '2027-06-01' }, now);
		expect(r.find((x) => x.key === 'stnk')?.level).toBe('soon');
		expect(r.find((x) => x.key === 'pajak')?.level).toBe('expired');
		expect(r.find((x) => x.key === 'kir')?.level).toBe('ok');
	});
	it('tanggal kosong dilewati; tanggal rusak → unknown', () => {
		expect(computeExpiry({}, now)).toEqual([]);
		expect(computeExpiry({ stnk_expiry: 'abc' }, now)[0].level).toBe('unknown');
	});
});
