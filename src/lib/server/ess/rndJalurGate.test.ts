import { describe, it, expect } from 'vitest';

// rndJalurGate mengimpor modul server ($env). Cukup uji fungsi murni dengan mock minimal.
import { vi } from 'vitest';
vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));
vi.mock('$lib/server/gateDefinitionsMode', () => ({ resolveGateMode: vi.fn() }));
vi.mock('./rndJalur', () => ({ getMyRndJalur: vi.fn(), getRndLevels: vi.fn() }));
const { decideRndEnroll, MIN_ALASAN } = await import('./rndJalurGate');

const gagal = { status: 'failed', reason: 'Prasyarat jalur R&D belum tercapai: R&D Foundation.' };

describe('decideRndEnroll', () => {
	it('lulus / tidak berlaku → lolos tanpa catatan', () => {
		expect(decideRndEnroll('hard', { status: 'passed' })).toEqual({ allow: true, audit: null });
		expect(decideRndEnroll('hard', { status: 'not_applicable' })).toEqual({ allow: true, audit: null });
	});
	it('shadow → lolos, hanya dicatat; off → tidak dicatat', () => {
		expect(decideRndEnroll('shadow', gagal)).toMatchObject({ allow: true, audit: 'shadow' });
		expect(decideRndEnroll('off', gagal)).toMatchObject({ allow: true, audit: null });
	});
	it('warn → lolos dengan peringatan', () => {
		const d = decideRndEnroll('warn', gagal);
		expect(d.allow).toBe(true);
		expect(d.message).toContain('R&D Foundation');
	});
	it('soft → butuh alasan cukup panjang', () => {
		expect(decideRndEnroll('soft', gagal, 'pendek').allow).toBe(false);
		expect(decideRndEnroll('soft', gagal, 'a'.repeat(MIN_ALASAN))).toMatchObject({ allow: true, usedAlasan: true });
	});
	it('hard → ditolak dengan jalan keluar (dispensasi HRD)', () => {
		const d = decideRndEnroll('hard', gagal, 'a'.repeat(50));
		expect(d.allow).toBe(false);
		expect(d.message).toContain('HRD');
	});
});
