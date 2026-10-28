import { describe, it, expect, vi, beforeEach } from 'vitest';

const envMock = vi.hoisted(() => ({ ERP_EPI1_BASE_URL: 'https://erp.example/', AUTOMATION_SERVER_SECRET: 'rahasia' } as Record<string, string | undefined>));
vi.mock('$env/dynamic/private', () => ({ env: envMock }));

import { mapErpGateBlockers, checkErpGerbangGates } from './sjGerbangErpGate';

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;

beforeEach(() => {
	envMock.ERP_EPI1_BASE_URL = 'https://erp.example/';
	envMock.AUTOMATION_SERVER_SECRET = 'rahasia';
});

describe('sjGerbangErpGate (SJH-12 §4.2)', () => {
	it('mapErpGateBlockers: petakan blocking, buang G_SJ_BARANG_BERMASALAH (sudah dicek lokal)', () => {
		const r = mapErpGateBlockers({
			blocking: [
				{ gate_key: 'G_SJ_BUKTI_KIRIM', label: 'Bukti kirim', message: 'foto muat belum ada' },
				{ gate_key: 'G_SJ_BARANG_BERMASALAH', label: 'Barang bermasalah', message: 'x' }
			]
		});
		expect(r).toHaveLength(1);
		expect(r[0]).toMatchObject({ code: 'GATE', gate_key: 'G_SJ_BUKTI_KIRIM', who: 'Admin Logistik' });
		expect(r[0].message).toContain('foto muat belum ada');
	});
	it('mapErpGateBlockers: respons kosong/aneh → []', () => {
		expect(mapErpGateBlockers(null)).toEqual([]);
		expect(mapErpGateBlockers({ blocking: 'x' })).toEqual([]);
	});
	it('env belum diset → tidak_terhubung, TIDAK memanggil fetch', async () => {
		envMock.ERP_EPI1_BASE_URL = undefined;
		const f = vi.fn();
		const r = await checkErpGerbangGates(1, { fetchImpl: f as unknown as typeof fetch });
		expect(r).toEqual({ status: 'tidak_terhubung', blockers: [] });
		expect(f).not.toHaveBeenCalled();
	});
	it('erp menjawab blocking → diblokir; header secret terkirim; URL benar', async () => {
		const f = vi.fn().mockResolvedValue(okJson({ blocking: [{ gate_key: 'G_SJ_RANGKAP_CETAK', label: 'Rangkap', message: 'belum dicetak' }] }));
		const r = await checkErpGerbangGates(7, { fetchImpl: f as unknown as typeof fetch });
		expect(r.status).toBe('diblokir');
		expect(f.mock.calls[0][0]).toBe('https://erp.example/api/surat-jalan/7/gate-check?point=gerbang');
		expect((f.mock.calls[0][1] as any).headers['x-automation-secret']).toBe('rahasia');
	});
	it('erp OK tanpa blocking → ok', async () => {
		const f = vi.fn().mockResolvedValue(okJson({ blocking: [] }));
		expect(await checkErpGerbangGates(1, { fetchImpl: f as unknown as typeof fetch })).toEqual({ status: 'ok', blockers: [] });
	});
	it('FAIL-SAFE: HTTP error / network error / timeout → tidak_terhubung (gerbang tidak dikunci)', async () => {
		const bad = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
		expect((await checkErpGerbangGates(1, { fetchImpl: bad as unknown as typeof fetch })).status).toBe('tidak_terhubung');
		const boom = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
		expect((await checkErpGerbangGates(1, { fetchImpl: boom as unknown as typeof fetch })).status).toBe('tidak_terhubung');
		const hang = vi.fn((_u: string, o: any) => new Promise((_res, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted')))));
		const r = await checkErpGerbangGates(1, { timeoutMs: 20, fetchImpl: hang as unknown as typeof fetch });
		expect(r).toEqual({ status: 'tidak_terhubung', blockers: [] });
	});
});
