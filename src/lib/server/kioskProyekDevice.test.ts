import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));

import { buildRoster } from './kioskProyekDevice';
import { mergeKioskProyekRows, KIOSK_PROYEK_DEFAULTS } from './kioskProyekSettings';

const project = { id: 978, name: 'Gresik', kode: 'AB12CD', leaderIds: [10] };

describe('buildRoster', () => {
	const assignments = [
		{ id: 1, manpower_id: 10, status: 'aktif' },
		{ id: 2, manpower_id: 20, status: 'aktif' },
		{ id: 3, manpower_id: 30, status: 'menunggu_validasi' },
		{ id: 4, manpower_id: 20, status: 'aktif' } // penugasan ganda orang yang sama
	];
	const manpower = [
		{ id: 10, nama: 'Budi Leader', posisi: 'Foreman' },
		{ id: 20, nama: 'Agus', posisi: 'Painter' },
		{ id: 30, nama: null, posisi: null }
	];

	it('satu baris per orang, urut nama, leader ditandai, nama kosong punya cadangan', () => {
		const r = buildRoster(project, '2026-10-27', assignments, manpower, []);
		expect(r.kru.map((k) => k.manpower_id)).toEqual([20, 10, 30].sort((a, b) => {
			const n = (id: number) => r.kru.find((k) => k.manpower_id === id)!.nama;
			return n(a).localeCompare(n(b), 'id');
		}));
		expect(r.kru.find((k) => k.manpower_id === 10)!.adalah_leader).toBe(true);
		expect(r.kru.find((k) => k.manpower_id === 30)!.nama).toBe('Kru #30');
		expect(r.ringkasan).toEqual({ terdaftar: 3, hadir: 0, belum: 3 });
		expect(r.project.kode).toBe('AB12CD');
	});

	it('menghitung hadir (hadir/setengah_hari) dan belum; izin tidak dihitung hadir', () => {
		const r = buildRoster(project, '2026-10-27', assignments, manpower, [
			{ manpower_id: 20, status: 'hadir', jam_masuk: '2026-10-27T00:10:00Z' },
			{ manpower_id: { id: 30 }, status: 'izin' }
		]);
		expect(r.ringkasan).toEqual({ terdaftar: 3, hadir: 1, belum: 1 });
		expect(r.kru.find((k) => k.manpower_id === 30)!.hari_ini?.status).toBe('izin');
	});

	it('tanpa penugasan → roster kosong, tidak crash', () => {
		const r = buildRoster(project, '2026-10-27', [], [], []);
		expect(r.kru).toEqual([]);
		expect(r.ringkasan).toEqual({ terdaftar: 0, hadir: 0, belum: 0 });
	});
});

describe('mergeKioskProyekRows (sisi lapangan)', () => {
	it('default aman: kiosk mati', () => {
		expect(mergeKioskProyekRows([])['kiosk_proyek.aktif']).toBe(false);
		expect(mergeKioskProyekRows(null)).toEqual(KIOSK_PROYEK_DEFAULTS);
	});
	it('override dipakai, nilai sampah → default, dijepit ke rentang', () => {
		const m = mergeKioskProyekRows([
			{ setting_key: 'kiosk_proyek.aktif', setting_value: 'true' },
			{ setting_key: 'kiosk_proyek.aktivasi_qr_detik', setting_value: '5' },
			{ setting_key: 'kiosk_proyek.foto_maks_kb', setting_value: 'abc' },
			{ setting_key: 'kiosk_proyek.jendela_masuk_mulai', setting_value: '"07:30"' },
			{ setting_key: 'kiosk_proyek.kode_harian_mode', setting_value: '"ngawur"' },
			{ setting_key: 'kiosk.enabled', setting_value: 'true' }
		]);
		expect(m['kiosk_proyek.aktif']).toBe(true);
		expect(m['kiosk_proyek.aktivasi_qr_detik']).toBe(30);
		expect(m['kiosk_proyek.foto_maks_kb']).toBe(150);
		expect(m['kiosk_proyek.jendela_masuk_mulai']).toBe('07:30');
		expect(m['kiosk_proyek.kode_harian_mode']).toBe('harian');
		expect('kiosk.enabled' in m).toBe(false);
	});
});

describe('mergeKioskProyekRows — daftar kategori Catatan Kerja (Fase 4)', () => {
	it('daftar dari JSON/teks diparse; kosong/sampah → default; batas 12 item', () => {
		const m = mergeKioskProyekRows([
			{ setting_key: 'kiosk_proyek.catatan_kategori_kendala', setting_value: '["Hujan","hujan","Macet"]' },
			{ setting_key: 'kiosk_proyek.catatan_kategori_progres', setting_value: '[]' },
			{ setting_key: 'kiosk_proyek.catatan_maks_per_orang_per_hari', setting_value: '999' }
		]);
		expect(m['kiosk_proyek.catatan_kategori_kendala']).toEqual(['Hujan', 'Macet']);
		expect(m['kiosk_proyek.catatan_kategori_progres']).toEqual(KIOSK_PROYEK_DEFAULTS['kiosk_proyek.catatan_kategori_progres']);
		expect(m['kiosk_proyek.catatan_maks_per_orang_per_hari']).toBe(100);
		const banyak = mergeKioskProyekRows([{ setting_key: 'kiosk_proyek.catatan_kategori_progres', setting_value: JSON.stringify(Array.from({ length: 30 }, (_, i) => `p${i}`)) }]);
		expect(banyak['kiosk_proyek.catatan_kategori_progres']).toHaveLength(12);
	});
});
