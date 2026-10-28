import { describe, expect, it } from 'vitest';
import { labelUangMuka } from './fleetAdvanceLabel';

describe('labelUangMuka', () => {
	it('status baru jalur Petty Cash', () => {
		expect(labelUangMuka('diajukan').label).toBe('Menunggu booking disetujui');
		expect(labelUangMuka('menunggu_kasir').label).toBe('Menunggu pencairan kasir');
		expect(labelUangMuka('dicairkan').hint).toMatch(/struk/);
		expect(labelUangMuka('settled').label).toBe('Selesai');
		expect(labelUangMuka('dibatalkan').label).toBe('Dibatalkan');
	});
	it('nilai lama "disetujui" tetap dikenali; tak dikenal/null aman', () => {
		expect(labelUangMuka('disetujui').label).toMatch(/menunggu pencairan/);
		expect(labelUangMuka(null)).toEqual({ label: '—', hint: '' });
		expect(labelUangMuka('none').label).toBe('—');
		expect(labelUangMuka(undefined).label).toBe('—');
	});
});
