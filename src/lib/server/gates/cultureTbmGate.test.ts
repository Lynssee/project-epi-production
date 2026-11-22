import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
	defRow: [{ gate_key: 'G_TBM_CULTURE_BRIEF' }] as any[],
	mode: 'warn' as string,
	ctx: { hasItem: true, judul: 'Fokus K3' },
	audits: [] as any[]
}));

vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn(async () => ({ data: h.defRow })) }));
vi.mock('$lib/server/gateDefinitionsMode', () => ({ resolveGateMode: vi.fn(async () => h.mode) }));
vi.mock('$lib/server/gates/gateAudit', () => ({ writeGateAudit: vi.fn(async (p: any) => void h.audits.push(p)) }));
vi.mock('$lib/server/ess/budayaHarian', () => ({ getTbmCultureContext: vi.fn(async () => h.ctx) }));

const { decideTbmGate, evaluateTbmCultureGate, clearTbmGateCache } = await import('./cultureTbmGate');

beforeEach(() => {
	clearTbmGateCache();
	h.defRow = [{ gate_key: 'G_TBM_CULTURE_BRIEF' }];
	h.mode = 'warn';
	h.ctx = { hasItem: true, judul: 'Fokus K3' };
	h.audits.length = 0;
});

const input = (over: Partial<{ topic: string; dibacakan: boolean; alasan: string }> = {}) => ({ projectId: 12, topic: '', dibacakan: false, alasan: '', ...over });

describe('decideTbmGate (murni)', () => {
	it('mode menentukan aksi saat gagal; lolos selalu lanjut', () => {
		expect(decideTbmGate('hard', 'failed', 'm', '').aksi).toBe('blokir');
		expect(decideTbmGate('soft', 'failed', 'm', '').aksi).toBe('butuh_alasan');
		expect(decideTbmGate('soft', 'failed', 'm', 'terlalu pendek').aksi).toBe('lanjut'); // 14 karakter ≥ 10
		expect(decideTbmGate('soft', 'failed', 'm', 'pendek').aksi).toBe('butuh_alasan');
		expect(decideTbmGate('warn', 'failed', 'm', '').aksi).toBe('peringatan');
		expect(decideTbmGate('shadow', 'failed', 'm', '').aksi).toBe('lanjut');
		expect(decideTbmGate('hard', 'passed', '', '').aksi).toBe('lanjut');
	});
});

describe('evaluateTbmCultureGate', () => {
	it('tanpa konten budaya hari ini / topik terisi / sudah dibacakan → lanjut tanpa audit', async () => {
		h.ctx = { hasItem: false, judul: null as any };
		expect((await evaluateTbmCultureGate(input())).aksi).toBe('lanjut');
		h.ctx = { hasItem: true, judul: 'x' };
		expect((await evaluateTbmCultureGate(input({ topic: 'K3 ketinggian' }))).aksi).toBe('lanjut');
		expect((await evaluateTbmCultureGate(input({ dibacakan: true }))).aksi).toBe('lanjut');
		expect(h.audits).toHaveLength(0);
	});

	it('warn: peringatan + audit; hard: blokir + audit block', async () => {
		expect((await evaluateTbmCultureGate(input())).aksi).toBe('peringatan');
		h.mode = 'hard';
		expect((await evaluateTbmCultureGate(input())).aksi).toBe('blokir');
		expect(h.audits.map((a) => a.decision)).toEqual(['warn', 'block']);
	});

	it('soft: butuh alasan, lalu lolos dengan alasan (tercatat sebagai pengecualian)', async () => {
		h.mode = 'soft';
		expect((await evaluateTbmCultureGate(input())).aksi).toBe('butuh_alasan');
		const r = await evaluateTbmCultureGate(input({ alasan: 'Apel dibatalkan hujan deras' }));
		expect(r.aksi).toBe('lanjut');
		expect(h.audits.at(-1)?.reason).toContain('Pengecualian');
	});

	it('ANTI-LOCKDOWN: definisi gate belum terdaftar → shadow, tidak pernah menahan presensi', async () => {
		h.defRow = [];
		h.mode = 'hard'; // seandainya resolver mengembalikan hard, wrapper tidak boleh memakainya
		const r = await evaluateTbmCultureGate(input());
		expect(r.aksi).toBe('lanjut');
		expect(h.audits.at(-1)?.decision).toBe('shadow');
	});
});
