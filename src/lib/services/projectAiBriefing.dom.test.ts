// @vitest-environment jsdom
// projectAiBriefing — klien pasif: cache memori, salinan offline, centang harian lokal, label umur.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./secureDirectus', () => ({ getIdToken: vi.fn().mockResolvedValue('tok') }));

import {
	fetchFieldBriefing, loadOfflineBriefing, saveOfflineBriefing, loadChecked, saveChecked, localDayKey, ageLabel,
	type FieldBriefing
} from './projectAiBriefing';

const ok = (over: Partial<FieldBriefing> = {}): FieldBriefing => ({
	available: true, project_id: 5, horizon: 'pendek', status: 'warning', coverage: 'terukur', items: [], generated_at: '2026-11-09T01:00:00Z', ...over
});

beforeEach(() => {
	localStorage.clear();
	vi.restoreAllMocks();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('fetchFieldBriefing', () => {
	it('memanggil endpoint GET dengan Bearer, tanpa parameter force/refresh, dan menyimpan salinan offline', async () => {
		const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ok() });
		vi.stubGlobal('fetch', f);
		const r = await fetchFieldBriefing(101);
		expect(r.available).toBe(true);
		expect(f).toHaveBeenCalledWith('/api/project/101/ai-briefing', { headers: { Authorization: 'Bearer tok' } });
		expect(String(f.mock.calls[0][0])).not.toMatch(/force|refresh/);
		expect(loadOfflineBriefing(101)?.briefing.project_id).toBe(5);
	});

	it('panggilan berikutnya (≤5 mnt) memakai cache memori — satu request saja', async () => {
		const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ok() });
		vi.stubGlobal('fetch', f);
		await fetchFieldBriefing(102);
		await fetchFieldBriefing(102);
		expect(f).toHaveBeenCalledTimes(1);
	});

	it('kegagalan tidak di-cache dan TIDAK menimpa salinan offline lama', async () => {
		saveOfflineBriefing(103, ok({ summary: 'lama' }));
		const f = vi.fn().mockResolvedValueOnce({ ok: false, status: 502 }).mockResolvedValueOnce({ ok: true, json: async () => ok({ summary: 'baru' }) });
		vi.stubGlobal('fetch', f);
		await expect(fetchFieldBriefing(103)).rejects.toThrow(/502/);
		expect(loadOfflineBriefing(103)?.briefing.summary).toBe('lama');
		expect((await fetchFieldBriefing(103)).summary).toBe('baru'); // percobaan ulang tidak terjebak cache gagal
		expect(f).toHaveBeenCalledTimes(2);
	});

	it('respons available:false TIDAK disimpan sebagai salinan offline', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ available: false, reason: 'off', project_id: 5, horizon: 'pendek' }) }));
		await fetchFieldBriefing(104);
		expect(loadOfflineBriefing(104)).toBeNull();
	});
});

describe('salinan offline & localStorage tidak tersedia', () => {
	it('data rusak di storage ⇒ null, tidak melempar', () => {
		localStorage.setItem('ai-briefing:v1:9', '{rusak');
		expect(loadOfflineBriefing(9)).toBeNull();
		localStorage.setItem('ai-briefing:v1:9', JSON.stringify({ briefing: null }));
		expect(loadOfflineBriefing(9)).toBeNull();
	});

	it('storage melempar (mode privat) ⇒ semua fungsi tetap aman', () => {
		vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } });
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(loadOfflineBriefing(1)).toBeNull();
		expect(() => saveOfflineBriefing(1, ok())).not.toThrow();
		expect(loadChecked(1).size).toBe(0);
		expect(() => saveChecked(1, new Set(['a']))).not.toThrow();
	});
});

describe('centang harian lokal', () => {
	it('tersimpan per proyek & per hari; hari berikutnya kosong lagi', () => {
		saveChecked(5, new Set(['material_terlambat']), '2026-11-09');
		expect([...loadChecked(5, '2026-11-09')]).toEqual(['material_terlambat']);
		expect(loadChecked(5, '2026-11-10').size).toBe(0);
		expect(loadChecked(6, '2026-11-09').size).toBe(0);
	});

	it('isi bukan array / elemen bukan string dibersihkan', () => {
		localStorage.setItem('ai-briefing-check:v1:5:2026-11-09', JSON.stringify({ a: 1 }));
		expect(loadChecked(5, '2026-11-09').size).toBe(0);
		localStorage.setItem('ai-briefing-check:v1:5:2026-11-09', JSON.stringify(['a', 3, null]));
		expect([...loadChecked(5, '2026-11-09')]).toEqual(['a']);
	});

	it('localDayKey memakai tanggal LOKAL perangkat', () => {
		expect(localDayKey(new Date(2026, 10, 9, 23, 59))).toBe('2026-11-09');
		expect(localDayKey(new Date(2026, 0, 5, 0, 1))).toBe('2026-01-05');
	});
});

describe('ageLabel', () => {
	const now = Date.parse('2026-11-09T12:00:00Z');
	it.each([
		['2026-11-09T11:59:40Z', 'baru saja'],
		['2026-11-09T11:30:00Z', '30 menit lalu'],
		['2026-11-09T09:00:00Z', '3 jam lalu'],
		['2026-11-06T12:00:00Z', '3 hari lalu']
	])('%s → %s', (iso, text) => expect(ageLabel(iso, now)).toBe(text));
	it('kosong/tak valid ⇒ string kosong', () => {
		expect(ageLabel(null, now)).toBe('');
		expect(ageLabel('bukan tanggal', now)).toBe('');
	});
});
