import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDirectusJson = vi.fn();
vi.mock('$lib/server/directus', () => ({
	directusServerJson: (...args: unknown[]) => mockDirectusJson(...args)
}));

const {
	loadIstirahatConfig,
	getJendelaIstirahat,
	getJadwalPulangNormal,
	listJedaHariIni,
	rollupIstirahat,
	seedKaryawanJadwalMeta,
	clearIstirahatCache
} = await import('./istirahat');

describe('istirahat caching & separated Directus relations', () => {
	beforeEach(() => {
		mockDirectusJson.mockReset();
		clearIstirahatCache();
	});

	it('caches loadIstirahatConfig and coalesces concurrent requests', async () => {
		mockDirectusJson.mockImplementation(async (path: string) => {
			if (path.startsWith('/items/konfigurasi_kebijakan_disiplin')) {
				return {
					data: [
						{
							id: 1,
							tahun_berlaku: 2026,
							status: 'aktif',
							istirahat_absen_mandiri_aktif: true,
							istirahat_makan_siang_menit: 60
						}
					]
				};
			}
			if (path.startsWith('/items/istirahat_kategori')) {
				return {
					data: [
						{ id: 'kat-1', nama: 'Makan Siang', hitung_kuota: true, kuota_menit_sendiri: null, foto_wajib: false, urutan: 1, aktif: true },
						{ id: 'kat-2', nama: 'Arsip', hitung_kuota: false, kuota_menit_sendiri: null, foto_wajib: false, urutan: 2, aktif: false }
					]
				};
			}
			throw new Error(`Unexpected path: ${path}`);
		});

		const results = await Promise.all([
			loadIstirahatConfig(),
			loadIstirahatConfig(),
			loadIstirahatConfig()
		]);

		expect(mockDirectusJson).toHaveBeenCalledTimes(2);
		expect(results[0].aktif).toBe(true);
		expect(results[0].kategoriAktif).toHaveLength(1);
		expect(results[0].kategoriAktif[0].nama).toBe('Makan Siang');

		// Panggilan berikutnya hit cache -> 0 query tambahan.
		await loadIstirahatConfig();
		expect(mockDirectusJson).toHaveBeenCalledTimes(2);
	});

	it('listJedaHariIni and rollupIstirahat never use nested dot-relations (kategori_id.*)', async () => {
		const requestedPaths: string[] = [];
		mockDirectusJson.mockImplementation(async (path: string, init?: RequestInit) => {
			requestedPaths.push(path);
			if (path.startsWith('/items/konfigurasi_kebijakan_disiplin')) {
				return {
					data: [
						{
							id: 1,
							tahun_berlaku: 2026,
							status: 'aktif',
							istirahat_absen_mandiri_aktif: true,
							istirahat_makan_siang_menit: 60,
							istirahat_toleransi_menit: 5,
							istirahat_tier1_batas_menit: 15,
							istirahat_tier2_batas_menit: 30
						}
					]
				};
			}
			if (path.startsWith('/items/istirahat_kategori')) {
				return {
					data: [
						{ id: 'kat-makan', nama: 'Makan Siang', hitung_kuota: true, kuota_menit_sendiri: null, foto_wajib: false, urutan: 1, aktif: true },
						{ id: 'kat-sholat', nama: 'Sholat', hitung_kuota: false, kuota_menit_sendiri: null, foto_wajib: false, urutan: 2, aktif: true }
					]
				};
			}
			if (path.startsWith('/items/absensi_istirahat_log')) {
				return {
					data: [
						{
							id: 'log-1',
							absensi_harian_id: 'abs-1',
							karyawan_id: '10',
							tanggal: '2026-11-24',
							kategori_id: 'kat-makan',
							jam_keluar: '12:00',
							jam_masuk: '13:10',
							durasi_menit: 70,
							overrun_menit: 0,
							tier: 0,
							foto_masuk: 'f-1'
						},
						{
							id: 'log-2',
							absensi_harian_id: 'abs-1',
							karyawan_id: '10',
							tanggal: '2026-11-24',
							kategori_id: 'kat-sholat',
							jam_keluar: '15:00',
							jam_masuk: '15:20',
							durasi_menit: 20,
							overrun_menit: 0,
							tier: 0,
							foto_masuk: 'f-2'
						}
					]
				};
			}
			if (path === '/items/absensi_harian/abs-1' && init?.method === 'PATCH') {
				const body = JSON.parse(String(init.body));
				return { data: { id: 'abs-1', ...body } };
			}
			throw new Error(`Unexpected path: ${path}`);
		});

		const list = await listJedaHariIni('abs-1');
		expect(list.map((r) => r.kategoriNama)).toEqual(['Makan Siang', 'Sholat']);

		const rollup = await rollupIstirahat('abs-1');
		// Makan siang 70m (kuota 60m -> overrun 10m); Sholat 20m tidak dihitung kuota!
		expect(rollup.overrunMenit).toBe(10);
		expect(rollup.record?.istirahat_jumlah_jeda).toBe(2);

		// Pastikan tidak ada dot-relation di query Directus mana pun.
		for (const p of requestedPaths) {
			expect(p).not.toContain('kategori_id.');
		}
	});

	it('shares 5-minute karyawan & jadwal_kerja cache between getJendelaIstirahat and getJadwalPulangNormal', async () => {
		mockDirectusJson.mockImplementation(async (path: string) => {
			if (path.startsWith('/items/karyawan/10')) {
				return { data: { jadwal_kerja_id: 'shift-pagi' } };
			}
			if (path.startsWith('/items/karyawan/11')) {
				return { data: { jadwal_kerja_id: 'shift-pagi' } };
			}
			if (path.startsWith('/items/jadwal_kerja/shift-pagi')) {
				return {
					data: {
						jam_istirahat_mulai: '12:00',
						jam_istirahat_selesai: '13:00',
						jam_keluar_normal: '17:00:00'
					}
				};
			}
			throw new Error(`Unexpected path: ${path}`);
		});

		const jendela = await getJendelaIstirahat(10);
		expect(jendela).toEqual({ mulai: '12:00', selesai: '13:00' });

		// Karyawan yang sama -> 0 query tambahan untuk jam pulang normal.
		const pulang10 = await getJadwalPulangNormal(10);
		expect(pulang10).toBe('17:00');
		expect(mockDirectusJson).toHaveBeenCalledTimes(2);

		// Karyawan lain pada shift yang sama -> hanya 1 query karyawan/11, 0 query jadwal_kerja!
		const pulang11 = await getJadwalPulangNormal(11);
		expect(pulang11).toBe('17:00');
		expect(mockDirectusJson).toHaveBeenCalledTimes(3);
	});

	it('skips GET /items/karyawan/{id} when knownJadwalId is passed or seeded from authenticateEss', async () => {
		mockDirectusJson.mockImplementation(async (path: string) => {
			if (path.startsWith('/items/karyawan/')) {
				throw new Error(`Should NOT fetch karyawan again: ${path}`);
			}
			if (path.startsWith('/items/jadwal_kerja/shift-pagi')) {
				return {
					data: {
						jam_istirahat_mulai: '12:00',
						jam_istirahat_selesai: '13:00',
						jam_keluar_normal: '17:00:00'
					}
				};
			}
			throw new Error(`Unexpected path: ${path}`);
		});

		seedKaryawanJadwalMeta(20, { jadwalId: 'shift-pagi', polaKerja: null });
		const jendela = await getJendelaIstirahat(20, 'shift-pagi');
		const pulang = await getJadwalPulangNormal(20);

		expect(jendela).toEqual({ mulai: '12:00', selesai: '13:00' });
		expect(pulang).toBe('17:00');
		expect(mockDirectusJson).toHaveBeenCalledTimes(1);
	});
});

