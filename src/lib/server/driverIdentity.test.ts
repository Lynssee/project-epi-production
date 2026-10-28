import { describe, it, expect } from 'vitest';
import { isSjDriver } from './driverIdentity';

const topik = { karyawanId: 171, fleetDriverId: 'ed021c1b-uuid', names: ['muhamad taufik', 'm. topik'] };

describe('isSjDriver (SJH-17)', () => {
	it('UUID fleet_drivers cocok', () => {
		expect(isSjDriver({ delegated_driver_id: 'ed021c1b-uuid' }, topik)).toBe(true);
	});
	it('delegated_driver_id berisi karyawan.id (angka) TIDAK dianggap cocok', () => {
		expect(isSjDriver({ delegated_driver_id: '171' }, topik)).toBe(false);
	});
	it('teks driver cocok persis dengan nama fleet_drivers (case-insensitive)', () => {
		expect(isSjDriver({ driver: ' M. TOPIK ' }, topik)).toBe(true);
	});
	it('teks sebagian ditolak (ADI vs ADITYA)', () => {
		const adi = { karyawanId: 1, fleetDriverId: null, names: ['adi'] };
		expect(isSjDriver({ driver: 'ADITYA ANGGA YULIAN' }, adi)).toBe(false);
		expect(isSjDriver({ driver: 'Adi' }, adi)).toBe(true);
	});
	it('delegated_user_id = karyawan id cocok', () => {
		expect(isSjDriver({ delegated_user_id: 171 }, topik)).toBe(true);
	});
});
