import { describe, it, expect, vi } from 'vitest';
vi.mock('./secureDirectus', () => ({ getIdToken: async () => 't' }));
import { buildTodoItems, type CompletenessRow } from './projectCompletenessMine';

const gap = (key: string, severity: any) => ({ key, label: key, detail: null, severity, owner: 'Leader', slaHours: 24, action: 'Isi', hint: '' });
const row = (o: Partial<CompletenessRow>): CompletenessRow => ({ id: 1, name: 'P1', nomorPo: null, status: 'on progress', completenessPct: 50, band: 'data_kurang', gaps: [], review: [], unknown: [], ...o });

describe('buildTodoItems', () => {
	it('input null/kosong tidak melempar', () => {
		expect(buildTodoItems(null).total).toBe(0);
		expect(buildTodoItems([]).shown).toEqual([]);
	});
	it('urut keparahan, dibatasi limit, total tetap utuh', () => {
		const r = buildTodoItems([row({ gaps: [gap('a', 'rendah'), gap('b', 'tinggi'), gap('c', 'sedang')] })], 2);
		expect(r.shown.map((i) => i.label)).toEqual(['b', 'c']);
		expect(r.total).toBe(3);
	});
	it('gap lebih dulu daripada tinjauan pada keparahan sama', () => {
		const r = buildTodoItems([row({ review: [{ key: 'R02', label: 'closing', owner: 'Leader', action: 'x', hint: '' }], gaps: [gap('g', 'sedang')] })]);
		expect(r.shown[0].kind).toBe('gap');
	});
	it('anomali ikut daftar dan lebih dulu daripada gap pada keparahan sama', () => {
		const a = { key: 'AN01', label: 'Progres identik', detail: '3 laporan', severity: 'tinggi' as const, owner: 'Leader', action: 'Periksa', hint: '' };
		const r = buildTodoItems([row({ anomalies: [a], gaps: [gap('g', 'tinggi')] })]);
		expect(r.shown.map((i) => i.kind)).toEqual(['anomali', 'gap']);
		expect(r.shown[0].label).toContain('3 laporan');
	});
	it('tinjauan proyek waiting dihitung terpisah, tidak membanjiri daftar', () => {
		const rv = { key: 'R01', label: 'waiting lewat', owner: 'Leader', action: 'x', hint: '' };
		const r = buildTodoItems([row({ id: 2, status: 'waiting', review: [rv] }), row({ id: 3, status: 'waiting', review: [rv] })]);
		expect(r.total).toBe(0);
		expect(r.waitingReview).toBe(2);
	});
});
