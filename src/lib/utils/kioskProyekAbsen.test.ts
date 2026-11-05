import { describe, it, expect } from 'vitest';
import { cekJendela, jamWIB, keputusanGate } from './kioskProyekAbsen';

const S = {
	'kiosk_proyek.jendela_masuk_mulai': '05:00',
	'kiosk_proyek.jendela_masuk_selesai': '11:00',
	'kiosk_proyek.jendela_pulang_mulai': '14:00',
	'kiosk_proyek.jendela_pulang_selesai': '23:00'
};

describe('keputusanGate', () => {
	it('hard menolak; warn/soft menandai; shadow hanya mencatat', () => {
		expect(keputusanGate('hard')).toEqual({ tolak: true, tandai: false, catat: false });
		expect(keputusanGate('warn')).toEqual({ tolak: false, tandai: true, catat: false });
		expect(keputusanGate('soft')).toEqual({ tolak: false, tandai: true, catat: false });
		expect(keputusanGate('shadow')).toEqual({ tolak: false, tandai: false, catat: true });
	});
});

describe('jam & jendela (WIB, jam server)', () => {
	it('jamWIB memakai zona Jakarta', () => {
		expect(jamWIB(new Date('2026-10-27T00:42:00Z'))).toBe('07:42');
		expect(jamWIB(new Date('2026-10-27T17:30:00Z'))).toBe('00:30');
	});
	it('masuk: di dalam / di luar jendela', () => {
		expect(cekJendela('masuk', new Date('2026-10-27T00:42:00Z'), S).ok).toBe(true); // 07:42
		const r = cekJendela('masuk', new Date('2026-10-27T06:00:00Z'), S); // 13:00
		expect(r.ok).toBe(false);
		expect(r.alasan).toContain('05:00–11:00');
		expect(cekJendela('masuk', new Date('2026-10-26T21:30:00Z'), S).ok).toBe(false); // 04:30
	});
	it('pulang: pulang awal & lewat batas ditolak, sore wajar lolos', () => {
		expect(cekJendela('pulang', new Date('2026-10-27T10:05:00Z'), S).ok).toBe(true); // 17:05
		expect(cekJendela('pulang', new Date('2026-10-27T03:00:00Z'), S).ok).toBe(false); // 10:00
		expect(cekJendela('pulang', new Date('2026-10-27T17:30:00Z'), S).ok).toBe(false); // 00:30
	});
});
