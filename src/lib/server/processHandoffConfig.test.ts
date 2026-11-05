import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));
import { directusServerJson } from '$lib/server/directus';
import { loadHandoffConfig, clearHandoffConfigCache } from './processHandoffConfig';
import { DEFAULT_HANDOFFS } from '$lib/data/processHandoffDefaults';

const dj = directusServerJson as unknown as ReturnType<typeof vi.fn>;
const custom = { code: 'X1', from_flow: 'a', from_node: 'n', to_flow: 'b', to_node: '', handoff_type: 'dana', doc_label: 'D' };

beforeEach(() => {
	vi.clearAllMocks();
	clearHandoffConfigCache();
});

describe('loadHandoffConfig', () => {
	it('belum ada baris / tanpa daftar handoffs → bawaan 28; query kecil 1 baris', async () => {
		dj.mockResolvedValue({ data: [] });
		expect(await loadHandoffConfig({ now: 1 })).toEqual(DEFAULT_HANDOFFS);
		const url = dj.mock.calls[0][0] as string;
		expect(url).toContain('filter[module][_eq]=process_guidance');
		expect(url).toContain('filter[setting_key][_eq]=grand_map_config');
		expect(url).toContain('fields=setting_value');
		expect(url).toContain('limit=1');
		clearHandoffConfigCache();
		dj.mockResolvedValue({ data: [{ setting_value: JSON.stringify({ phases: [] }) }] });
		expect(await loadHandoffConfig({ now: 1 })).toEqual(DEFAULT_HANDOFFS);
	});
	it('konfigurasi tersimpan dipakai; di-cache 5 menit (hemat query)', async () => {
		dj.mockResolvedValue({ data: [{ setting_value: JSON.stringify({ handoffs: [custom] }) }] });
		expect(await loadHandoffConfig({ now: 1000 })).toEqual([custom]);
		await loadHandoffConfig({ now: 1000 + 4 * 60 * 1000 });
		expect(dj).toHaveBeenCalledTimes(1);
		await loadHandoffConfig({ now: 1000 + 6 * 60 * 1000 });
		expect(dj).toHaveBeenCalledTimes(2);
	});
	it('gagal baca → bawaan (tidak melempar) dan TIDAK di-cache', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		dj.mockRejectedValueOnce(new Error('403 detail')).mockResolvedValue({ data: [{ setting_value: JSON.stringify({ handoffs: [custom] }) }] });
		expect(await loadHandoffConfig({ now: 1 })).toEqual(DEFAULT_HANDOFFS);
		expect(await loadHandoffConfig({ now: 2 })).toEqual([custom]);
		warn.mockRestore();
	});
});
