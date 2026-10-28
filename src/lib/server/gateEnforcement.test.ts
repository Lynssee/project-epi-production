// Paket 06 Site Visit Release §2.5 (Aturan #3) — masa tenggang enforce_from: mode 'hard'
// dipaksa jadi 'soft' sebelum tanggal itu, supaya gate baru tidak pernah lahir langsung wajib.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockJson = vi.fn();
vi.mock('$lib/server/directus', () => ({
	directusServerJson: (...a: unknown[]) => mockJson(...a)
}));

const { getFieldGateMode, invalidateFieldGateEnforcementCache } = await import('./gateEnforcement');

beforeEach(() => {
	mockJson.mockReset();
	// Modul punya cache in-memory module-level (TTL 5 menit) — tanpa ini, test 2+ dalam
	// file yang sama akan membaca cache basi dari test SEBELUMNYA, bukan mock terbaru.
	invalidateFieldGateEnforcementCache();
});

describe('getFieldGateMode — enforce_from (§2.5)', () => {
	it('mode hard TANPA enforce_from -> tetap hard', async () => {
		mockJson.mockResolvedValue({ data: [{ gate_key: 'G_RMR_VISIT', mode: 'hard', enforce_from: null }] });
		expect(await getFieldGateMode('G_RMR_VISIT')).toBe('hard');
	});

	it('mode hard, enforce_from di MASA DEPAN -> diperlakukan soft (masa tenggang)', async () => {
		const jauhDiMasaDepan = '2099-01-01';
		mockJson.mockResolvedValue({ data: [{ gate_key: 'G_BBM_VISIT', mode: 'hard', enforce_from: jauhDiMasaDepan }] });
		expect(await getFieldGateMode('G_BBM_VISIT')).toBe('soft');
	});

	it('mode hard, enforce_from di MASA LALU -> tetap hard (tenggang sudah lewat)', async () => {
		mockJson.mockResolvedValue({ data: [{ gate_key: 'G_RMR_VISIT', mode: 'hard', enforce_from: '2020-01-01' }] });
		expect(await getFieldGateMode('G_RMR_VISIT')).toBe('hard');
	});

	it('mode soft/shadow -> enforce_from tidak berpengaruh sama sekali', async () => {
		mockJson.mockResolvedValue({ data: [{ gate_key: 'G_RMR_VISIT', mode: 'soft', enforce_from: '2099-01-01' }] });
		expect(await getFieldGateMode('G_RMR_VISIT')).toBe('soft');
	});

	it('gate belum terdaftar -> default shadow (Aturan #3, tidak pernah memblokir tanpa konfigurasi)', async () => {
		mockJson.mockResolvedValue({ data: [] });
		expect(await getFieldGateMode('G_SJ_KIRIM')).toBe('shadow');
	});
});

describe('getFieldGateMode — gate Revisi 4 mengikuti mode utama gate_definitions (Aturan #11)', () => {
	// Mock sadar-jalur: gate_enforcement (override '*') dan gate_definitions (mode utama) dijawab terpisah.
	function mockJalur(opts: { enforcement?: unknown[]; definisi?: unknown[]; definisiGagal?: boolean }) {
		mockJson.mockImplementation(async (path: string) => {
			if (path.startsWith('/items/gate_enforcement')) return { data: opts.enforcement ?? [] };
			if (path.startsWith('/items/gate_definitions')) {
				if (opts.definisiGagal) throw new Error('403 FORBIDDEN');
				return { data: opts.definisi ?? [] };
			}
			return { data: [] };
		});
	}

	it('tanpa override → memakai default_mode di gate_definitions', async () => {
		mockJalur({ definisi: [{ gate_key: 'G_RTN_DOBEL', default_mode: 'soft', enforce_from: null, is_active: true }] });
		expect(await getFieldGateMode('G_RTN_DOBEL')).toBe('soft');
	});

	it('override gate_enforcement menang atas definisi (termasuk shadow eksplisit)', async () => {
		mockJalur({
			enforcement: [{ gate_key: 'G_SJ_MUAT_DISCAN', mode: 'shadow', enforce_from: null }],
			definisi: [{ gate_key: 'G_SJ_MUAT_DISCAN', default_mode: 'hard', enforce_from: null, is_active: true }]
		});
		expect(await getFieldGateMode('G_SJ_MUAT_DISCAN')).toBe('shadow');
	});

	it('enforce_from di masa depan → shadow; sudah lewat → mode berlaku', async () => {
		mockJalur({ definisi: [{ gate_key: 'G_RTN_DOBEL', default_mode: 'hard', enforce_from: '2099-01-01', is_active: true }] });
		expect(await getFieldGateMode('G_RTN_DOBEL')).toBe('shadow');
		invalidateFieldGateEnforcementCache();
		mockJalur({ definisi: [{ gate_key: 'G_RTN_DOBEL', default_mode: 'hard', enforce_from: '2020-01-01', is_active: true }] });
		expect(await getFieldGateMode('G_RTN_DOBEL')).toBe('hard');
	});

	it('belum terdaftar / nonaktif / warn → shadow', async () => {
		mockJalur({});
		expect(await getFieldGateMode('G_RTN_DOBEL')).toBe('shadow');
		invalidateFieldGateEnforcementCache();
		mockJalur({ definisi: [{ gate_key: 'G_RTN_DOBEL', default_mode: 'soft', enforce_from: null, is_active: false }] });
		expect(await getFieldGateMode('G_RTN_DOBEL')).toBe('shadow');
		invalidateFieldGateEnforcementCache();
		mockJalur({ definisi: [{ gate_key: 'G_RTN_DOBEL', default_mode: 'warn', enforce_from: null, is_active: true }] });
		expect(await getFieldGateMode('G_RTN_DOBEL')).toBe('shadow');
	});

	it('gagal membaca definisi → shadow, error dicatat, dan tidak di-cache (pulih otomatis)', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockJalur({ definisiGagal: true });
		expect(await getFieldGateMode('G_RTN_DOBEL')).toBe('shadow');
		expect(err).toHaveBeenCalled();
		mockJalur({ definisi: [{ gate_key: 'G_RTN_DOBEL', default_mode: 'soft', enforce_from: null, is_active: true }] });
		expect(await getFieldGateMode('G_RTN_DOBEL')).toBe('soft');
		err.mockRestore();
	});

	it('gate LAMA tidak ikut fallback definisi (nol perubahan perilaku): tanpa override tetap shadow', async () => {
		mockJalur({ definisi: [{ gate_key: 'G_RMR_VISIT', default_mode: 'hard', enforce_from: null, is_active: true }] });
		expect(await getFieldGateMode('G_RMR_VISIT')).toBe('shadow');
	});
});
