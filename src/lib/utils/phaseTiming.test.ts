import { describe, it, expect } from 'vitest';
import { phaseTiming, phaseTimingText } from './phaseTiming';

const D = 86_400_000;
const now = new Date('2026-11-10T08:00:00Z').getTime();
const iso = (daysAgo: number) => new Date(now - daysAgo * D).toISOString();

describe('phaseTiming', () => {
	it('tanpa baris progres -> none', () => {
		expect(phaseTiming({ target_duration_days: 5 }, undefined, now).level).toBe('none');
	});
	it('fase berjalan di bawah ambang -> ok, hari ke-N dihitung dari hari mulai = 1', () => {
		const t = phaseTiming({ target_duration_days: 10 }, { status: 'in_progress', started_at: iso(2) }, now);
		expect(t).toMatchObject({ level: 'ok', dayNumber: 3, targetDays: 10, remainingDays: 7 });
		expect(phaseTimingText(t)).toBe('Hari ke-3 dari target 10 hari');
	});
	it('>= ambang setelan -> warn; lewat target -> over', () => {
		expect(phaseTiming({ target_duration_days: 10 }, { status: 'in_progress', started_at: iso(7) }, now, 80).level).toBe('warn');
		expect(phaseTiming({ target_duration_days: 10 }, { status: 'in_progress', started_at: iso(7) }, now, 90).level).toBe('ok');
		const over = phaseTiming({ target_duration_days: 3 }, { status: 'in_progress', started_at: iso(5) }, now);
		expect(over.level).toBe('over');
		expect(phaseTimingText(over)).toContain('lewat target 3 hari');
	});
	it('tanpa target (eksekusi) -> hanya hari berjalan, level none', () => {
		const t = phaseTiming({ target_duration_days: null }, { status: 'in_progress', started_at: iso(30) }, now);
		expect(t.level).toBe('none');
		expect(phaseTimingText(t)).toBe('Berjalan hari ke-31');
	});
	it('fase selesai: lama pengerjaan; backfill started=completed tidak tampil "0 hari"', () => {
		const t = phaseTiming({ target_duration_days: 5 }, { status: 'completed', started_at: iso(6), completed_at: iso(2) }, now);
		expect(phaseTimingText(t)).toBe('Selesai dalam 4 hari (target 5 hari)');
		const same = phaseTiming({ target_duration_days: 5 }, { status: 'completed', started_at: iso(2), completed_at: iso(2) }, now);
		expect(phaseTimingText(same)).toBe('');
	});
	it('tanggal rusak / di masa depan jauh / ambang tak valid -> aman, tidak melempar', () => {
		expect(phaseTimingText(phaseTiming({ target_duration_days: 5 }, { status: 'in_progress', started_at: 'bukan-tanggal' }, now))).toBe('');
		expect(phaseTimingText(phaseTiming({ target_duration_days: 5 }, { status: 'in_progress', started_at: new Date(now + 10 * D).toISOString() }, now))).toBe('');
		expect(phaseTiming({ target_duration_days: 10 }, { status: 'in_progress', started_at: iso(1) }, now, NaN).level).toBe('ok');
	});
});
