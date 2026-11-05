// src/lib/services/processGuidanceMineApi.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadMyTasks, clearMineMemo } from './processGuidanceMineApi';

const tok = async () => 't';
const res = (body: any, status = 200) => ({ ok: status < 400, status, json: async () => body }) as any;
const TASK = { flow_id: 'f1', flow_title: 'F', node_id: 'n1', label: 'L', lane_label: 'A', type: 'task', sla_hours: 4, kpi_code: '', gate_keys: [], has_actions: false };
const POSISI = { id: 30, nama: 'PROJECT LEADER', via: 'jabatan_id' };
const mem = () => {
	const m = new Map<string, string>();
	return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), _m: m };
};
beforeEach(() => clearMineMemo());

describe('loadMyTasks', () => {
	it('sukses → posisi + tugas, Bearer, disimpan, memo 5 menit per pengguna', async () => {
		const storage = mem();
		const fetchImpl = vi.fn(async () => res({ success: true, source: 'directus', posisi: POSISI, tasks: [TASK] }));
		const a = await loadMyTasks({ fetchImpl: fetchImpl as any, getToken: tok, uid: 'u1', storage, now: 0 });
		expect(a).toMatchObject({ source: 'directus', posisi: POSISI, tasks: [TASK] });
		expect((fetchImpl.mock.calls[0] as any)[0]).toBe('/api/process-guidance/mine');
		expect((fetchImpl.mock.calls[0] as any)[1].headers.Authorization).toBe('Bearer t');
		await loadMyTasks({ fetchImpl: fetchImpl as any, getToken: tok, uid: 'u1', storage, now: 200000 });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		await loadMyTasks({ fetchImpl: fetchImpl as any, getToken: tok, uid: 'u2', storage, now: 200000 });
		expect(fetchImpl).toHaveBeenCalledTimes(2); // pengguna lain tidak memakai memo orang lain
	});

	it('kontak approver: bentuk rusak dibuang; nomor WA rekan TIDAK disimpan di perangkat; salinan perangkat tanpa kontak', async () => {
		const storage = mem();
		const contacts = { 58: { nama: 'PM', total: 1, people: [{ id: 9, nama: 'Pak PM', wa: '6281234567890' }, null, { id: 'x' }] }, 70: 'rusak', 71: { nama: 'X' } };
		const ok = vi.fn(async () => res({ success: true, source: 'directus', posisi: POSISI, tasks: [TASK], contacts }));
		const a = await loadMyTasks({ fetchImpl: ok as any, getToken: tok, uid: 'u1', storage, now: 0 });
		expect(a.contacts).toEqual({ 58: { nama: 'PM', total: 1, people: [{ id: 9, nama: 'Pak PM', wa: '6281234567890' }] } });
		expect([...storage._m.values()].join('')).not.toContain('6281234567890');
		clearMineMemo();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const offline = vi.fn(async () => { throw new Error('offline'); });
		const b = await loadMyTasks({ fetchImpl: offline as any, getToken: tok, uid: 'u1', storage, now: 1 });
		expect(b).toMatchObject({ source: 'cached', tasks: [TASK] });
		expect(b.contacts).toBeUndefined();
		warn.mockRestore();
	});

	it('jabatan tak terhubung → posisi null + alasan (kartu memberi petunjuk, bukan galat)', async () => {
		const fetchImpl = vi.fn(async () => res({ success: true, source: 'directus', posisi: null, reason: 'Hubungi HRD', tasks: [] }));
		expect(await loadMyTasks({ fetchImpl: fetchImpl as any, getToken: tok, uid: 'u', storage: mem() })).toMatchObject({ posisi: null, reason: 'Hubungi HRD', tasks: [], source: 'directus' });
	});

	it('gagal → salinan terakhir milik pengguna yang sama; pengguna lain tidak menerima salinan orang lain', async () => {
		const storage = mem();
		const ok = vi.fn(async () => res({ success: true, source: 'directus', posisi: POSISI, tasks: [TASK] }));
		await loadMyTasks({ fetchImpl: ok as any, getToken: tok, uid: 'u1', storage, now: 0 });
		clearMineMemo();
		const boom = vi.fn(async () => { throw new Error('offline'); });
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(await loadMyTasks({ fetchImpl: boom as any, getToken: tok, uid: 'u1', storage })).toMatchObject({ source: 'cached', tasks: [TASK] });
		clearMineMemo();
		expect(await loadMyTasks({ fetchImpl: boom as any, getToken: tok, uid: 'u2', storage })).toMatchObject({ source: 'none', tasks: [] });
		warn.mockRestore();
	});

	it('server fallback / HTTP error / token kosong / data rusak → none tanpa melempar', async () => {
		const fb = vi.fn(async () => res({ success: true, source: 'fallback', posisi: null, tasks: [] }));
		expect((await loadMyTasks({ fetchImpl: fb as any, getToken: tok, uid: 'u', storage: mem() })).source).toBe('none');
		expect((await loadMyTasks({ fetchImpl: (async () => res({}, 500)) as any, getToken: tok, uid: 'u', storage: mem() })).source).toBe('none');
		expect((await loadMyTasks({ fetchImpl: fb as any, getToken: async () => null, uid: 'u', storage: mem() })).source).toBe('none');
		const bad = vi.fn(async () => res({ success: true, source: 'directus', posisi: POSISI, tasks: [{ x: 1 }] }));
		expect((await loadMyTasks({ fetchImpl: bad as any, getToken: tok, uid: 'u', storage: mem() })).source).toBe('none');
	});

	it('penyimpanan penuh tidak menggagalkan hasil', async () => {
		const full = { getItem: () => null, setItem: () => { throw new Error('Quota'); } };
		const ok = vi.fn(async () => res({ success: true, source: 'directus', posisi: POSISI, tasks: [TASK] }));
		expect((await loadMyTasks({ fetchImpl: ok as any, getToken: tok, uid: 'u', storage: full })).tasks).toHaveLength(1);
	});
});
