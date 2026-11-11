import { describe, it, expect } from 'vitest';
import { describeTransit } from './grTransit';

describe('describeTransit', () => {
	it('armada internal: plat + sopir, tanpa ETA', () => {
		const t = describeTransit({ modeKirim: 'driver_internal', plat: 'B 1234 XY', driver: 'PANJI PRATAMA' }, '2026-11-10');
		expect(t.text).toBe('Armada EPI · B 1234 XY · Sopir PANJI PRATAMA');
		expect(t.etaOverdue).toBe(false);
	});
	it('ekspedisi: resi + ETA; ETA sebelum hari ini = sudah lewat', () => {
		const ok = describeTransit({ modeKirim: 'ekspedisi', noResi: 'JNE123', etaTiba: '2026-11-12' }, '2026-11-10');
		expect(ok.text).toBe('Ekspedisi (resi JNE123) · ETA 12 Nov');
		expect(ok.etaOverdue).toBe(false);
		const late = describeTransit({ modeKirim: 'ekspedisi', etaTiba: '2026-11-08' }, '2026-11-10');
		expect(late.etaOverdue).toBe(true);
		expect(late.text).toContain('ETA 8 Nov (sudah lewat)');
	});
	it('ETA sama dengan hari ini belum dianggap lewat', () => {
		expect(describeTransit({ etaTiba: '2026-11-10' }, '2026-11-10').etaOverdue).toBe(false);
	});
	it('tanpa informasi / data rusak -> kosong, tidak melempar', () => {
		expect(describeTransit(null).text).toBe('');
		expect(describeTransit({ driver: '  ', plat: '', etaTiba: 'bukan-tanggal', modeKirim: 'aneh' }).text).toBe('');
	});
	it('mode kirim tak dikenal tidak ditebak', () => {
		expect(describeTransit({ modeKirim: 'lainnya', driver: 'Budi' }).text).toBe('Sopir Budi');
	});
});
