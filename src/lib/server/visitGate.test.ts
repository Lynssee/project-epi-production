// Paket 06 Site Visit Release (docs/(eh) site visit/06_finance-gate-kunjungan.md §2.1-§2.2) —
// jendela klaim ASIMETRIS (kunjungan sebelum tanggal klaim, hingga maks_selisih_hari_klaim
// hari — bukan +-1 hari simetris lama) dan pesan aktif yang bisa ditindaklanjuti.
// Pola mock: sama seperti pettyCashRequest.test.ts / siteCheckin.idempotensi.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockJson = vi.fn();
vi.mock('$lib/server/directus', () => ({
	directusServerJson: (...a: unknown[]) => mockJson(...a)
}));

const { checkRmrVisitGate } = await import('./visitGate');

const has = (u: unknown, ...n: string[]) => {
	const decoded = decodeURIComponent(String(u ?? ''));
	return n.every((x) => decoded.includes(x));
};

const SETTINGS = {
	visit_gate_aktif: true,
	min_durasi_menit_finansial: 30,
	maks_selisih_hari_klaim: 7,
	visit_picker_hari: 30
};

function checkinRow(overrides: Partial<Record<string, unknown>> = {}) {
	return {
		id: 'chk-1',
		status: 'completed',
		nama_lokasi: 'Proyek A',
		karyawan_id: '99',
		check_in_at: '2026-09-20T02:00:00.000Z', // 2026-09-20 WIB (UTC+7, masih tanggal sama pagi)
		durasi_menit: 60,
		...overrides
	};
}

function mockSettingsAnd(checkin: ReturnType<typeof checkinRow>) {
	mockJson.mockImplementation((url: string) => {
		if (has(url, '/items/site_checkin_settings')) return Promise.resolve({ data: SETTINGS });
		if (has(url, '/items/site_checkin/chk-1')) return Promise.resolve({ data: checkin });
		return Promise.resolve({ data: [] });
	});
}

beforeEach(() => {
	mockJson.mockReset();
});

describe('checkRmrVisitGate — jendela klaim asimetris (§2.2)', () => {
	it('klaim 4 hari SETELAH kunjungan (dalam batas 7 hari default) -> lolos', async () => {
		mockSettingsAnd(checkinRow({ check_in_at: '2026-09-20T02:00:00.000Z' })); // 20 Sep WIB
		const result = await checkRmrVisitGate('chk-1', null, '99', '2026-09-24'); // klaim 24 Sep, 4 hari
		expect(result.allowed).toBe(true);
	});

	it('klaim TEPAT di batas maks_selisih_hari_klaim (7 hari) -> lolos', async () => {
		mockSettingsAnd(checkinRow({ check_in_at: '2026-09-20T02:00:00.000Z' }));
		const result = await checkRmrVisitGate('chk-1', null, '99', '2026-09-27'); // 7 hari persis
		expect(result.allowed).toBe(true);
	});

	it('klaim 10 hari SETELAH kunjungan (> 7 hari) -> tolak, pesan sebut jumlah hari maksimal', async () => {
		mockSettingsAnd(checkinRow({ check_in_at: '2026-09-20T02:00:00.000Z' }));
		const result = await checkRmrVisitGate('chk-1', null, '99', '2026-09-30'); // 10 hari
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('lebih dari 7 hari');
	});

	it('kunjungan SETELAH tanggal klaim (klaim mendahului kejadian) -> tolak "belum terjadi"', async () => {
		mockSettingsAnd(checkinRow({ check_in_at: '2026-09-25T02:00:00.000Z' })); // 25 Sep
		const result = await checkRmrVisitGate('chk-1', null, '99', '2026-09-20'); // klaim 20 Sep, sebelum kunjungan
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('belum terjadi');
	});

	it('kunjungan 1 hari SETELAH tanggal klaim (lintas hari WIB/UTC wajar) -> tetap lolos', async () => {
		mockSettingsAnd(checkinRow({ check_in_at: '2026-09-21T02:00:00.000Z' })); // 21 Sep
		const result = await checkRmrVisitGate('chk-1', null, '99', '2026-09-20'); // klaim 20 Sep, selisih 1 hari
		expect(result.allowed).toBe(true);
	});

	it('klaim hari yang SAMA dengan kunjungan -> lolos (kasus paling umum)', async () => {
		mockSettingsAnd(checkinRow({ check_in_at: '2026-09-20T02:00:00.000Z' }));
		const result = await checkRmrVisitGate('chk-1', null, '99', '2026-09-20');
		expect(result.allowed).toBe(true);
	});
});

describe('checkRmrVisitGate — kunjungan aktif (§2.2, pesan bisa ditindaklanjuti)', () => {
	it('status active -> tolak dengan instruksi jelas (checkout dulu), BUKAN status mentah', async () => {
		mockSettingsAnd(checkinRow({ status: 'active', durasi_menit: null }));
		const result = await checkRmrVisitGate('chk-1', null, '99', '2026-09-20');
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('belum di-check-out');
		expect(result.reason).toContain('Check-out');
	});

	it('status cancelled -> tetap tolak, pesan generik (bukan pesan checkout)', async () => {
		mockSettingsAnd(checkinRow({ status: 'cancelled' }));
		const result = await checkRmrVisitGate('chk-1', null, '99', '2026-09-20');
		expect(result.allowed).toBe(false);
		expect(result.reason).not.toContain('Check-out');
	});
});

describe('checkRmrVisitGate — regresi (kepemilikan & durasi tidak berubah)', () => {
	it('kunjungan milik karyawan lain -> tetap tolak', async () => {
		mockSettingsAnd(checkinRow({ karyawan_id: '1' }));
		const result = await checkRmrVisitGate('chk-1', null, '99', '2026-09-20');
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('karyawan lain');
	});

	it('durasi di bawah minimum -> tetap tolak', async () => {
		mockSettingsAnd(checkinRow({ durasi_menit: 10 }));
		const result = await checkRmrVisitGate('chk-1', null, '99', '2026-09-20');
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('di bawah minimum');
	});
});

describe('checkRmrVisitGate — alasan pengecualian terstruktur (§2.6)', () => {
	beforeEach(() => {
		mockJson.mockImplementation((url: string) => {
			if (has(url, '/items/site_checkin_settings')) return Promise.resolve({ data: SETTINGS });
			return Promise.resolve({ data: [] });
		});
	});

	it('kategori valid (bukan "Lainnya") -> lolos tanpa keterangan tambahan', async () => {
		const result = await checkRmrVisitGate(null, 'Lupa check-in di lokasi', '99', '2026-09-20');
		expect(result.allowed).toBe(true);
	});

	it('kategori "Lainnya" dengan keterangan bermakna (>=10 karakter) -> lolos', async () => {
		const result = await checkRmrVisitGate(null, 'Lainnya (tulis): Menjemput sample material dari supplier', '99', '2026-09-20');
		expect(result.allowed).toBe(true);
	});

	it('kategori "Lainnya" tanpa keterangan -> tolak', async () => {
		const result = await checkRmrVisitGate(null, 'Lainnya (tulis): ', '99', '2026-09-20');
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('terlalu pendek');
	});

	it('kategori "Lainnya" dengan keterangan spam (karakter berulang) -> tolak', async () => {
		const result = await checkRmrVisitGate(null, 'Lainnya (tulis): aaaaaaaaaaaaaaaaaaaa', '99', '2026-09-20');
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('berulang');
	});

	it('teks bebas yang tidak cocok kategori manapun -> tolak (bukan diloloskan karena panjang)', async () => {
		const result = await checkRmrVisitGate(null, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '99', '2026-09-20');
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('tidak dikenali');
	});

	it('kosong sama sekali -> tolak, pesan "belum memilih"', async () => {
		const result = await checkRmrVisitGate(null, null, '99', '2026-09-20');
		expect(result.allowed).toBe(false);
		expect(result.reason).toContain('Belum memilih');
	});
});
