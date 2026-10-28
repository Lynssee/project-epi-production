import { describe, it, expect } from 'vitest';
import { validatePelarutEntry, parseSolventItemIds } from './pelarut';

const NOW = new Date('2026-10-13T08:00:00Z');
const ALLOWED = [14638, 16190];
const ok = (o: Record<string, unknown> = {}) => ({ jenis: 'dikumpulkan', item_id: 14638, qty_kg: 12.3456, ...o });

describe('validatePelarutEntry', () => {
	it('menerima entri dikumpulkan; qty dibulatkan 3 desimal; tanggal default sekarang', () => {
		const r = validatePelarutEntry(ok({ catatan: ' pembilas mixer 2 ' }), ALLOWED, NOW);
		expect(r.ok && r.row).toMatchObject({ jenis: 'dikumpulkan', item_id: 14638, qty_kg: 12.346, spk_id: null, catatan: 'pembilas mixer 2', tanggal: NOW.toISOString() });
	});

	it('pakai ulang wajib SPK', () => {
		expect(validatePelarutEntry(ok({ jenis: 'dipakai_ulang' }), ALLOWED, NOW)).toMatchObject({ ok: false, code: 400 });
		expect(validatePelarutEntry(ok({ jenis: 'dipakai_ulang', spk_id: '1399' }), ALLOWED, NOW)).toMatchObject({ ok: true });
	});

	it('menolak pelarut di luar daftar, jenis tak dikenal, qty tak wajar', () => {
		expect(validatePelarutEntry(ok({ item_id: 999 }), ALLOWED, NOW)).toMatchObject({ ok: false });
		expect(validatePelarutEntry(ok({ jenis: 'hapus' }), ALLOWED, NOW)).toMatchObject({ ok: false });
		expect(validatePelarutEntry(ok({ qty_kg: 0 }), ALLOWED, NOW)).toMatchObject({ ok: false });
		expect(validatePelarutEntry(ok({ qty_kg: 'x' }), ALLOWED, NOW)).toMatchObject({ ok: false });
		expect(validatePelarutEntry(ok({ qty_kg: 6000 }), ALLOWED, NOW)).toMatchObject({ ok: false });
		expect(validatePelarutEntry(null, ALLOWED, NOW)).toMatchObject({ ok: false });
	});

	it('tanggal: tidak boleh masa depan atau lebih dari 7 hari lalu', () => {
		expect(validatePelarutEntry(ok({ tanggal: '2026-10-14T08:00:00Z' }), ALLOWED, NOW)).toMatchObject({ ok: false });
		expect(validatePelarutEntry(ok({ tanggal: '2026-10-01T08:00:00Z' }), ALLOWED, NOW)).toMatchObject({ ok: false });
		expect(validatePelarutEntry(ok({ tanggal: '2026-10-11T08:00:00Z' }), ALLOWED, NOW)).toMatchObject({ ok: true });
		expect(validatePelarutEntry(ok({ tanggal: 'bukan-tanggal' }), ALLOWED, NOW)).toMatchObject({ ok: false });
	});

	it('sumber tak dikenal -> null', () => {
		const r = validatePelarutEntry(ok({ sumber: 'gaib' }), ALLOWED, NOW);
		expect(r.ok && r.row.sumber).toBeNull();
	});
});

describe('parseSolventItemIds', () => {
	it('menerima string JSON atau array; membuang nilai tak valid & duplikat', () => {
		expect(parseSolventItemIds('[14638, "16190", 14638, 0, -1, "x"]')).toEqual([14638, 16190]);
		expect(parseSolventItemIds([1, 2])).toEqual([1, 2]);
	});
	it('rusak/bukan array -> []', () => {
		expect(parseSolventItemIds('{bad')).toEqual([]);
		expect(parseSolventItemIds(null)).toEqual([]);
		expect(parseSolventItemIds('{"a":1}')).toEqual([]);
	});
});
