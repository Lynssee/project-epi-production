import { describe, it, expect } from 'vitest';
import { normalizeMaterialName, findMatchingMaterial, realUsageSkips, manualUsageItems } from './materialManualMatch';

// Material kiriman proyek #1051 (Tri Daya)
const materials = [
	{ id: 8915, material_name: 'SAFETY HOSE / SAFETY WIRE SLING', qty_remaining: 1 },
	{ id: 8922, material_name: 'THINNER CUCI', qty_remaining: 20 },
	{ id: 8948, material_name: 'AMPLAS TEMPEL', qty_remaining: 3 },
	{ id: 8949, material_name: 'SARUNG TANGAN', qty_remaining: 1 },
	{ id: 8921, material_name: 'LAKBAN KERTAS 2"', qty_remaining: 3 }
];

describe('findMatchingMaterial — padanan untuk entri "Tulis Manual"', () => {
	it('kasus Tri Daya: "tiner cuci" → THINNER CUCI, "sarung tangan" → SARUNG TANGAN', () => {
		expect(findMatchingMaterial('tiner cuci', materials)?.id).toBe(8922);
		expect(findMatchingMaterial('Tiner Cuci', materials)?.id).toBe(8922);
		expect(findMatchingMaterial('sarung tangan', materials)?.id).toBe(8949);
	});

	it('sinonim ejaan & sebagian nama: "thiner" → thinner; "lakban" → LAKBAN KERTAS', () => {
		expect(findMatchingMaterial('thiner', materials)?.id).toBe(8922);
		expect(findMatchingMaterial('lakban', materials)?.id).toBe(8921);
	});

	it('tidak ada padanan / terlalu pendek / input kosong → null (jangan menebak)', () => {
		expect(findMatchingMaterial('cat epoxy', materials)).toBeNull();
		expect(findMatchingMaterial('ab', materials)).toBeNull();
		expect(findMatchingMaterial('', materials)).toBeNull();
		expect(findMatchingMaterial(null, materials)).toBeNull();
		expect(findMatchingMaterial('thinner', [])).toBeNull();
	});

	it('beberapa kandidat: yang sisanya terbanyak didahulukan', () => {
		const m = [
			{ id: 1, material_name: 'SARUNG TANGAN KARET', qty_remaining: 0 },
			{ id: 2, material_name: 'SARUNG TANGAN KAIN', qty_remaining: 5 }
		];
		expect(findMatchingMaterial('sarung tangan', m)?.id).toBe(2);
	});

	it('normalisasi: tanda kutip & simbol dibuang', () => {
		expect(normalizeMaterialName('LAKBAN KERTAS 2"')).toBe('lakban kertas 2');
		expect(normalizeMaterialName('  TINER   cuci ')).toBe('thinner cuci');
	});
});

describe('realUsageSkips / manualUsageItems', () => {
	it('skip wajar (delta 0, manual tanpa identitas, non-pilot) diabaikan; kegagalan tulis ledger dilaporkan', () => {
		const skipped = [
			{ expenseId: 1, reason: 'delta 0' },
			{ expenseId: 2, reason: 'tidak ada identitas_barang_id (kemungkinan is_manual)' },
			{ expenseId: 3, reason: 'Directus 403: FORBIDDEN' },
			{ expenseId: 4, reason: 'gagal tulis ledger' }
		];
		expect(realUsageSkips(skipped).map((s) => s.expenseId)).toEqual([3, 4]);
		expect(realUsageSkips(null)).toEqual([]);
	});

	it('manualUsageItems: hanya entri manual berjumlah > 0 dengan nama', () => {
		const items = [
			{ is_manual: true, type: 'sarung tangan', amount: 4 },
			{ is_manual: true, type: '', amount: 4 },
			{ is_manual: true, type: 'tiner', amount: 0 },
			{ is_manual: false, type: 'AMPLAS', amount: 3 }
		];
		expect(manualUsageItems(items)).toHaveLength(1);
		expect(manualUsageItems(undefined)).toEqual([]);
	});
});
