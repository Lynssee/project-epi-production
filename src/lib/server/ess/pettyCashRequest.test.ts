// Audit petty cash 21 Sep 2026 — Fase 0 (BUG-10 fail-closed, BUG-01 fund/ceiling, FLD-04 duplikat)
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockJson = vi.fn();
vi.mock('$lib/server/directus', () => ({
	directusServerJson: (...a: unknown[]) => mockJson(...a),
	directusServerUpload: vi.fn()
}));

const {
	resolveAtasanKaryawanId,
	resolveKasirKaryawanId,
	assertFundAndAmount,
	findRecentDuplicate
} = await import('./pettyCashRequest');

const has = (u: unknown, ...n: string[]) => n.every((x) => String(u ?? '').includes(x));
/** status HTTP dari error yang dilempar ("ok" bila tidak melempar). */
const statusOf = async (p: Promise<unknown>) => {
	try {
		await p;
		return "ok";
	} catch (e: any) {
		return e?.status ?? "error";
	}
};

beforeEach(() => {
	mockJson.mockReset();
});

describe('BUG-10 — resolusi atasan/kasir fail-closed (503, tidak lompat ke kasir)', () => {
	it('Directus gagal saat baca karyawan → 503, bukan null', async () => {
		mockJson.mockImplementation(() => {
			throw new Error('ECONNRESET');
		});
		expect(await statusOf(resolveAtasanKaryawanId(10))).toBe(503);
	});

	it('atasan_id valid dipakai langsung', async () => {
		mockJson.mockResolvedValue({ data: { id: 1, atasan_id: 9, atasan_fungsional_id: null } });
		await expect(resolveAtasanKaryawanId(1)).resolves.toBe(9);
	});

	it('atasan_id = pemohon sendiri diabaikan → fallback jabatan', async () => {
		mockJson.mockImplementation((u: string) => {
			if (has(u, '/items/karyawan/12')) return Promise.resolve({ data: { id: 12, atasan_id: 12, atasan_fungsional_id: null } });
			if (has(u, 'system_settings')) return Promise.resolve({ data: [{ setting_value: [70] }] });
			if (has(u, '/items/karyawan?', 'jabatan_id')) return Promise.resolve({ data: [{ id: 70 }] });
			return Promise.resolve({ data: [] });
		});
		await expect(resolveAtasanKaryawanId(12)).resolves.toBe(70);
	});

	it('gagal baca kustodian → 503', async () => {
		mockJson.mockImplementation(() => {
			throw new Error('timeout');
		});
		expect(await statusOf(resolveKasirKaryawanId(3, 9))).toBe(503);
	});
});

describe('BUG-01 — assertFundAndAmount', () => {
	const fund = { id: 1, fund_name: 'Dana Inventory', status: 'ACTIVE', ceiling_per_transaksi: 1_000_000, department: 'INVENTORY' };
	it('lolos ≤ ceiling & mengembalikan fund', async () => {
		mockJson.mockResolvedValue({ data: fund });
		await expect(assertFundAndAmount(1, 900_000)).resolves.toMatchObject({ id: 1 });
	});
	it('> ceiling → 400', async () => {
		mockJson.mockResolvedValue({ data: fund });
		expect(await statusOf(assertFundAndAmount(1, 5_000_000))).toBe(400);
	});
	it('fund nonaktif → 400, fund tak ada → 404, Directus gagal → 503', async () => {
		mockJson.mockResolvedValueOnce({ data: { ...fund, status: 'SUSPENDED' } });
		expect(await statusOf(assertFundAndAmount(1, 1000))).toBe(400);
		mockJson.mockResolvedValueOnce({ data: null });
		expect(await statusOf(assertFundAndAmount(1, 1000))).toBe(404);
		mockJson.mockRejectedValueOnce(new Error('403'));
		expect(await statusOf(assertFundAndAmount(1, 1000))).toBe(503);
	});
});

describe('FLD-04 — findRecentDuplicate', () => {
	const args = { requesterId: 5, fundId: 1, amount: 50000, description: 'Beli materai' };
	it('mengembalikan tiket identik yang baru tersimpan', async () => {
		mockJson.mockResolvedValue({ data: [{ id: 7, request_number: 'PCR-2609-0007' }] });
		await expect(findRecentDuplicate(args)).resolves.toMatchObject({ request_number: 'PCR-2609-0007' });
		expect(String(mockJson.mock.calls[0][0])).toContain('filter[status][_nin]=cancelled,rejected');
	});
	it('tanpa duplikat → null; gagal cek → null (tidak memblokir pengajuan)', async () => {
		mockJson.mockResolvedValueOnce({ data: [] });
		await expect(findRecentDuplicate(args)).resolves.toBeNull();
		mockJson.mockRejectedValueOnce(new Error('down'));
		await expect(findRecentDuplicate(args)).resolves.toBeNull();
	});
});

describe('BUG-08a — createRequestWithUniqueNumber (lapangan)', () => {
	// Nomor PCR memakai bulan berjalan — jangan hardcode (tes dulu pecah tiap pergantian bulan).
	const YYMM = `${String(new Date().getFullYear()).slice(-2)}${String(new Date().getMonth() + 1).padStart(2, '0')}`;

	it('nomor bentrok → nomor berikutnya, berhasil tanpa error ke pemohon', async () => {
		const { createRequestWithUniqueNumber } = await import('./pettyCashRequest');
		let last = `PCR-${YYMM}-0041`;
		let posts = 0;
		mockJson.mockImplementation((url: string, opts?: any) => {
			if (has(url, 'sort=-request_number')) return Promise.resolve({ data: [{ request_number: last }] });
			if (opts?.method === 'POST') {
				posts++;
				const body = JSON.parse(opts.body);
				if (posts === 1) {
					last = body.request_number; // pemohon lain menyimpan nomor sama lebih dulu
					return Promise.reject(new Error('Value for field "request_number" has to be unique.'));
				}
				return Promise.resolve({ data: { id: 5, request_number: body.request_number } });
			}
			return Promise.resolve({ data: [] });
		});
		const row = await createRequestWithUniqueNumber((n) => ({ request_number: n }));
		expect(row.request_number).toBe(`PCR-${YYMM}-0043`);
		expect(posts).toBe(2);
	});

	it('error selain unik tidak diulang', async () => {
		const { createRequestWithUniqueNumber } = await import('./pettyCashRequest');
		let posts = 0;
		mockJson.mockImplementation((url: string, opts?: any) => {
			if (has(url, 'sort=-request_number')) return Promise.resolve({ data: [] });
			if (opts?.method === 'POST') {
				posts++;
				return Promise.reject(new Error('403 FORBIDDEN'));
			}
			return Promise.resolve({ data: [] });
		});
		expect(await statusOf(createRequestWithUniqueNumber((n) => ({ request_number: n })))).toBe('error');
		expect(posts).toBe(1);
	});
});

describe('resolveKasir (PC3-07)', async () => {
	const { resolveKasir, resolveKasirKaryawanId } = await import('./pettyCashRequest');
	function world(fund: any, pusat: any, status: Record<string, string> = {}, delegations: any[] = []) {
		mockJson.mockImplementation(async (url: string) => {
			if (/\/items\/petty_cash_funds\/\d+\?/.test(url)) return { data: fund };
			if (url.includes('/items/approval_delegations')) return { data: delegations };
			if (url.includes('fund_code][_eq]=PCF-PST-001')) return { data: [pusat] };
			const m = url.match(/\/items\/karyawan\?.*_in\]=([\d,]+)/);
			if (m) return { data: m[1].split(',').map((id) => ({ id: Number(id), status: status[id] ?? 'On' })) };
			throw new Error('url tak dikenal ' + url);
		});
	}
	it('kustodian aktif', async () => {
		world({ custodian_karyawan_id: 5, backup_custodian_karyawan_id: 6 }, { custodian_karyawan_id: 7 });
		expect(await resolveKasir(1, 9)).toEqual({ kasirId: 5, via: 'custodian' });
	});
	it('kustodian cuti (Off) → cadangan; "Kontrak " tetap aktif', async () => {
		world({ custodian_karyawan_id: 5, backup_custodian_karyawan_id: 6 }, { custodian_karyawan_id: 7 }, { 5: 'Off', 6: 'Kontrak ' });
		expect(await resolveKasir(1, 9)).toEqual({ kasirId: 6, via: 'backup' });
	});
	it('fund tanpa kustodian → jatuh ke Pusat', async () => {
		world({}, { custodian_karyawan_id: 7, backup_custodian_karyawan_id: 8 });
		expect(await resolveKasir(1, 9)).toEqual({ kasirId: 7, via: 'pusat' });
	});
	it('semua kosong → null tanpa query karyawan', async () => {
		world({}, {});
		expect(await resolveKasir(1, 9)).toEqual({ kasirId: null, via: null });
		expect(mockJson.mock.calls.some(([u]: any) => String(u).includes('/items/karyawan'))).toBe(false);
	});
	it('PC3-15: kasir cuti dengan delegasi aktif → penerima delegasi', async () => {
		world({ custodian_karyawan_id: 5 }, {}, {}, [{ from_user: 5, to_user: 55, module_key: '*', start_date: '2000-01-01', end_date: '2999-12-31', is_active: true }]);
		expect(await resolveKasir(1, 9)).toEqual({ kasirId: 55, via: 'custodian' });
	});
	it('PC3-15: delegasi ke pemohon dilewati → kasir semula', async () => {
		world({ custodian_karyawan_id: 5 }, {}, {}, [{ from_user: 5, to_user: 9, module_key: '*', start_date: '2000-01-01', end_date: '2999-12-31', is_active: true }]);
		expect(await resolveKasir(1, 9)).toEqual({ kasirId: 5, via: 'custodian' });
	});
	it('pembungkus lama mengembalikan id saja; gagal baca → 503', async () => {
		world({ custodian_karyawan_id: 5 }, {});
		expect(await resolveKasirKaryawanId(1, 9)).toBe(5);
		mockJson.mockRejectedValue(new Error('timeout'));
		await expect(resolveKasir(1, 9)).rejects.toMatchObject({ status: 503 });
	});
});

describe('syncPcrStatusToPusat (PC3-10)', async () => {
	const { syncPcrStatusToPusat } = await import('./pettyCashRequest');
	it('tiket dibatalkan dari HP → PATCH master_pengajuan status ditolak', async () => {
		mockJson.mockImplementation(async (url: string, opts?: any) => {
			if (String(url).startsWith('/items/master_pengajuan?')) return { data: [{ id: 'mp-1' }] };
			if (String(url) === '/items/master_pengajuan/mp-1') return { data: {} };
			throw new Error('url tak dikenal ' + url);
		});
		expect(await syncPcrStatusToPusat({ id: 7, status: 'cancelled' })).toBe(true);
		const patch = mockJson.mock.calls.find(([u]: any) => u === '/items/master_pengajuan/mp-1');
		expect(JSON.parse(patch[1].body)).toEqual({ status: 'ditolak' });
	});
	it('draf / tanpa id → tidak memanggil Directus', async () => {
		expect(await syncPcrStatusToPusat({ id: 7, status: 'draft' })).toBe(false);
		expect(await syncPcrStatusToPusat({ status: 'posted' })).toBe(false);
		expect(mockJson).not.toHaveBeenCalled();
	});
	it('gagal → false + console.error, tidak melempar', async () => {
		const err = vi.spyOn(console, 'error').mockImplementation(() => {});
		mockJson.mockRejectedValue(new Error('403'));
		await expect(syncPcrStatusToPusat({ id: 7, status: 'posted' })).resolves.toBe(false);
		expect(err).toHaveBeenCalled();
		err.mockRestore();
	});
});

describe('createRequestWithUniqueNumber — idempoten (PC3-19)', async () => {
	const { createRequestWithUniqueNumber, findRequestByTxn } = await import('./pettyCashRequest');
	it('bentrok unik pada client_txn_id → mengembalikan tiket yang sudah ada (_idempotent)', async () => {
		mockJson.mockImplementation(async (url: string, opts?: any) => {
			if (String(url).includes('sort=-request_number')) return { data: [] };
			if (opts?.method === 'POST') throw Object.assign(new Error('Value for field "client_txn_id" has to be unique'), { code: 'RECORD_NOT_UNIQUE', field: 'client_txn_id' });
			if (String(url).includes('filter[client_txn_id][_eq]=abc')) return { data: [{ id: 5, request_number: 'PCR-1' }] };
			throw new Error('url ' + url);
		});
		const row = await createRequestWithUniqueNumber((n) => ({ request_number: n }), { clientTxnId: 'abc' });
		expect(row).toMatchObject({ id: 5, _idempotent: true });
	});
	it('bentrok pada request_number tidak dianggap idempoten (retry nomor)', async () => {
		let posts = 0;
		mockJson.mockImplementation(async (url: string, opts?: any) => {
			if (String(url).includes('sort=-request_number')) return { data: [] };
			if (opts?.method === 'POST') {
				posts++;
				if (posts === 1) throw Object.assign(new Error('Value for field "request_number" has to be unique'), { code: 'RECORD_NOT_UNIQUE', field: 'request_number' });
				return { data: { id: 9, request_number: 'PCR-2' } };
			}
			throw new Error('url ' + url);
		});
		const row = await createRequestWithUniqueNumber((n) => ({ request_number: n }), { clientTxnId: 'abc' });
		expect(row.id).toBe(9);
		expect(row._idempotent).toBeUndefined();
	});
	it('findRequestByTxn tanpa kunci → null tanpa query', async () => {
		mockJson.mockReset();
		expect(await findRequestByTxn(null)).toBeNull();
		expect(mockJson).not.toHaveBeenCalled();
	});
});

describe('Interlocking Kas Kecil Fase 3 — validateRequestForm & parseRequestForm (KM + tanggal nota BBM)', async () => {
	const { validateRequestForm, parseRequestForm } = await import('./pettyCashRequest');
	const base = { fundId: 1, amount: 50000, description: 'Isi bensin mobil operasional' };
	const status = (fn: () => void) => { try { fn(); return 200; } catch (e: any) { return e?.status ?? 500; } };

	it('tanpa kendaraan -> tidak dikunci (klaim lama / alat / lainnya)', () => {
		expect(status(() => validateRequestForm(base))).toBe(200);
	});
	it('kendaraan dipilih tanpa KM -> 400', () => {
		expect(status(() => validateRequestForm({ ...base, vehicleRefId: 3, receiptDate: '2026-10-12' }))).toBe(400);
	});
	it('kendaraan dipilih tanpa tanggal nota -> 400', () => {
		expect(status(() => validateRequestForm({ ...base, vehicleRefId: 3, odometerKm: 1000 }))).toBe(400);
	});
	it('kendaraan + KM + tanggal nota -> lolos', () => {
		expect(status(() => validateRequestForm({ ...base, vehicleRefId: 3, odometerKm: 1000, receiptDate: '2026-10-12' }))).toBe(200);
	});
	it('tanggal nota di masa depan / format salah -> 400', () => {
		expect(status(() => validateRequestForm({ ...base, receiptDate: '2999-01-01' }))).toBe(400);
		expect(status(() => validateRequestForm({ ...base, receiptDate: '12/10/2026' }))).toBe(400);
	});
	it('parseRequestForm membaca field baru', () => {
		const fd = new FormData();
		fd.append('fund_id', '1'); fd.append('amount', '1000'); fd.append('description', 'bensin');
		fd.append('vehicle_ref_id', '3'); fd.append('odometer_km', '12345'); fd.append('receipt_date', '2026-10-12T00:00:00');
		const p = parseRequestForm(fd);
		expect(p.vehicleRefId).toBe(3);
		expect(p.odometerKm).toBe(12345);
		expect(p.receiptDate).toBe('2026-10-12');
		expect(p.hmAlat).toBeNull();
	});
});
