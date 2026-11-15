import { describe, expect, it } from 'vitest';
import { MOB_SYNC_LABEL, mobSyncView, mobSyncReason, mobSyncCountdown, trackStageLabel, listProjectSj, listInTransitSj, contingencySuggestions } from './mobSyncLapangan';
import type { ProjectFulfillment } from '$lib/services/projectFulfillment';

const TODAY = '2026-11-10';
const sj = (id: number, over: Record<string, any> = {}) => ({ id, nomor_sj: `SJ-${id}`, status: 'shipped', tanggal: null, received_at: null, driver: null, eta_tiba: null, ...over });
const f = (over: Partial<ProjectFulfillment> = {}): ProjectFulfillment =>
	({
		projectId: 1,
		today: TODAY,
		forecastEmpty: false,
		bySubtask: {
			a: { materials: [{ id: 1, ref_name: 'Epoxy', status: 'shipped', late: false, pl: null, sj: [sj(2, { eta_tiba: '2026-11-17' }), sj(1, { eta_tiba: '2026-11-12' })] }], equipment: [], manpowerRoles: [] },
			b: { materials: [{ id: 2, ref_name: 'Thinner', status: 'shipped', late: false, pl: null, sj: [sj(2, { eta_tiba: '2026-11-17' }), sj(3, { received_at: '2026-11-09' })] }], equipment: [], manpowerRoles: [] },
			c: { materials: [], equipment: [], manpowerRoles: [] }
		},
		subtasks: [
			{ id: 'a', name: 'Blasting', category: 'K', first: '2026-11-15', last: '2026-11-20', activeToday: false, readiness: { state: 'problem', reasons: [], total: 1, ready: 0 } },
			{ id: 'c', name: 'Pasang scaffold', category: 'Persiapan', first: '2026-11-11', last: '2026-11-13', activeToday: false, readiness: { state: 'none', reasons: [], total: 0, ready: 0 } },
			{ id: 'd', name: 'Marking area', category: 'Persiapan', first: '2026-11-12', last: '2026-11-14', activeToday: false, readiness: { state: 'none', reasons: [], total: 0, ready: 0 } },
			{ id: 'e', name: 'Sudah lewat', category: 'Persiapan', first: '2026-11-01', last: '2026-11-05', activeToday: false, readiness: { state: 'none', reasons: [], total: 0, ready: 0 } },
			{ id: 'f', name: 'Terlalu jauh', category: 'Persiapan', first: '2026-12-20', last: '2026-12-22', activeToday: false, readiness: { state: 'none', reasons: [], total: 0, ready: 0 } }
		],
		manpowerToday: { roles: [] },
		syncedAt: '',
		mobSync: { status: 'waiting_material', gap_days: -2, manpower_start: '2026-11-15', material_eta: '2026-11-17' },
		...over
	}) as ProjectFulfillment;

describe('label & alasan', () => {
	it('semua status punya label/kelas/bantuan; status asing → Belum Dinilai', () => {
		for (const s of ['waiting_material', 'synchronized', 'early_material', 'waiting_manpower', 'unknown']) {
			expect(MOB_SYNC_LABEL[s].label).toBeTruthy();
			expect(MOB_SYNC_LABEL[s].help).toBeTruthy();
		}
		expect(mobSyncView('aneh').label).toBe('Belum Dinilai');
		expect(mobSyncView(undefined).label).toBe('Belum Dinilai');
	});
	it('alasan selalu punya teks', () => {
		for (const r of ['no_upcoming_spk', 'no_material_forecast', 'eta_unconfirmed', 'disabled', 'error', 'x', undefined, null]) expect(mobSyncReason(r as any)).toBeTruthy();
	});
});

describe('mobSyncCountdown', () => {
	it('besok / hari ini / dalam N hari / lampau', () => {
		expect(mobSyncCountdown({ status: 'waiting_material', gap_days: -2, material_eta: '2026-11-12', manpower_start: '2026-11-11' }, TODAY)).toBe('Material tiba dalam 2 hari · Tim mulai besok');
		expect(mobSyncCountdown({ status: 'synchronized', gap_days: 0, material_eta: TODAY, manpower_start: TODAY }, TODAY)).toBe('Material tiba hari ini · Tim mulai hari ini');
		expect(mobSyncCountdown({ status: 'early_material', gap_days: 3, material_eta: '2026-11-08', manpower_start: null }, TODAY)).toBe('Material tiba 2 hari lalu');
	});
	it('proyeksi memakai "diperkirakan"; input kosong aman', () => {
		expect(mobSyncCountdown({ status: 'waiting_material', gap_days: -1, material_eta: '2026-11-12', manpower_start: null, projected: true }, TODAY)).toContain('diperkirakan');
		expect(mobSyncCountdown(null, TODAY)).toBe('');
		expect(mobSyncCountdown(undefined, 'x')).toBe('');
	});
});

describe('SJ', () => {
	it('listProjectSj: unik per id, terurut ETA; listInTransitSj membuang yang sudah diterima', () => {
		expect(listProjectSj(f()).map((s) => s.id)).toEqual([1, 2, 3]);
		expect(listInTransitSj(f()).map((s) => s.id)).toEqual([1, 2]);
	});
	it('null-safe', () => {
		expect(listProjectSj(null)).toEqual([]);
		expect(listInTransitSj({ bySubtask: {} } as any)).toEqual([]);
	});
	it('trackStageLabel', () => {
		expect(trackStageLabel('dalam_perjalanan')).toBe('Dalam perjalanan');
		expect(trackStageLabel('tahap_baru')).toBe('tahap baru');
		expect(trackStageLabel(null)).toBe('');
	});
});

describe('contingencySuggestions (hanya saran)', () => {
	it('subtask tanpa material, belum lewat, mulai sebelum material tiba — urut mulai', () => {
		expect(contingencySuggestions(f()).map((s) => s.id)).toEqual(['c', 'd']);
	});
	it('kosong bila status bukan waiting_material atau tanpa data', () => {
		expect(contingencySuggestions(f({ mobSync: { status: 'synchronized', gap_days: 1, manpower_start: null, material_eta: null } }))).toEqual([]);
		expect(contingencySuggestions(null)).toEqual([]);
		expect(contingencySuggestions(f({ mobSync: undefined }))).toEqual([]);
	});
	it('batas jumlah', () => expect(contingencySuggestions(f(), 1)).toHaveLength(1));
});
