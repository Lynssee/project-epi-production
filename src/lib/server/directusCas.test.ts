import { describe, expect, it } from 'vitest';
import { casPatchBody } from './directusCas';
import { assertBatchPatch } from './directusCasTestkit';

describe('casPatchBody', () => {
	it('membungkus kondisi ke query.filter._and + data, fields ringan', () => {
		const body = JSON.parse(casPatchBody([{ id: { _eq: 5 } }, { status: { _eq: 'created' } }], { status: 'shipped' }));
		expect(body).toEqual({
			query: { filter: { _and: [{ id: { _eq: 5 } }, { status: { _eq: 'created' } }] }, fields: ['id'] },
			data: { status: 'shipped' }
		});
	});
	it('tanpa kondisi → error (cegah update SEMUA baris)', () => {
		expect(() => casPatchBody([], { a: 1 })).toThrow(/minimal satu kondisi/);
	});
});

describe('assertBatchPatch (penolak bentuk lama, meniru Directus prod)', () => {
	it('menerima { query:{filter}, data } dan { keys, data }', () => {
		expect(assertBatchPatch('/items/x', casPatchBody([{ id: { _eq: 1 } }], { a: 1 })).data).toEqual({ a: 1 });
		expect(assertBatchPatch('/items/x', JSON.stringify({ keys: [1, 2], data: { a: 1 } })).keys).toEqual([1, 2]);
	});
	it('menolak filter di URL (bentuk lama)', () => {
		expect(() => assertBatchPatch('/items/x?filter[id][_eq]=1&filter[status][_eq]=a', JSON.stringify({ a: 1 }))).toThrow(/data/);
	});
	it('menolak body polos tanpa data', () => {
		expect(() => assertBatchPatch('/items/x', JSON.stringify({ status: 'shipped' }))).toThrow(/"data" is required/);
	});
	it('menolak batch tanpa filter/keys', () => {
		expect(() => assertBatchPatch('/items/x', JSON.stringify({ data: { a: 1 } }))).toThrow(/SEMUA baris/);
	});
});
