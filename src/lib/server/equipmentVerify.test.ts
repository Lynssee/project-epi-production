import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn(), directusServerFetch: vi.fn() }));
vi.mock('$lib/server/gateDefinitionsMode', () => ({ resolveGateMode: vi.fn(async () => 'soft') }));

const m = await import('./equipmentVerify');
const { resolveGateMode } = await import('$lib/server/gateDefinitionsMode');

const thumb = vi.fn(async (fileId: string) => `data:image/jpeg;base64,${fileId}`);
/** Rute karyawan + pas_foto standar: karyawan ber-id X bernama "KX", punya pas_foto "file-X". */
const personRoutes = {
	'/items/karyawan_dokumen_files': (p: string) => ({ data: [{ directus_files_id: `file-${/karyawan_dokumen_id%5D%5B_eq%5D=(\d+)/.exec(p)?.[1] ?? '0'}` }] }),
	'/items/karyawan_dokumen?': (p: string) => ({ data: [{ id: Number(/karyawan_id%5D%5B_eq%5D=(\d+)/.exec(p)?.[1] ?? 0), is_encrypted: false }] }),
	'/items/karyawan?': (p: string) => {
		const id = /id%5D%5B_eq%5D=(\d+)/.exec(p)?.[1] ?? '0';
		return { data: [{ id: Number(id), nama_karyawan: `K${id}`, divisi: 'Ops', posisi: 'Staff' }] };
	}
};

const EQ = { id: 'eq-1', name: 'Avanza', code: 'ASET/EPI/KDR/MOB/0001', category_id: null };
const VEH = { id: 7, nomor_polisi: 'B 1', merk: 'Toyota', model: 'Avanza', jenis: 'Mobil', status: 'Dipinjam', pemilik: 'perusahaan' };
const NOW = Date.parse('2026-11-06T08:00:00Z');
const booking = {
	id: 'b1',
	kode_booking: 'BK-1',
	vehicle_id: '7',
	driver_id: 'drv-1',
	karyawan_id: '10',
	butuh_driver: true,
	requester_name: 'Budi',
	tujuan: 'Cikarang',
	status: 'aktif',
	tanggal_mulai: new Date(NOW - 3_600_000).toISOString(),
	tanggal_selesai_rencana: new Date(NOW + 3_600_000).toISOString()
};

/** Directus palsu berbasis rute; mencatat tiap pemanggilan agar bisa diperiksa. */
function fakeDx(routes: Record<string, any>) {
	const calls: string[] = [];
	const dx = vi.fn(async (path: string) => {
		calls.push(path);
		for (const [prefix, val] of Object.entries(routes)) {
			if (path.startsWith(prefix)) {
				if (val instanceof Error) throw val;
				return typeof val === 'function' ? val(path) : val;
			}
		}
		return { data: [] };
	});
	return { dx: dx as any, calls };
}

beforeEach(() => {
	m.clearVerifySettingsCache();
	m.clearFotoCache();
	vi.mocked(resolveGateMode).mockResolvedValue('soft');
});

describe('verifyVehicle', () => {
	const routes = (over: Record<string, any> = {}) => ({
		...personRoutes,
		'/items/fleet_settings': { data: [] },
		'/items/fleet_bookings': { data: [booking] },
		'/items/fleet_drivers/drv-1': { data: { karyawan_id: '20' } },
		...over
	});

	it('driver booking => authorized, kartu pemegang = driver (foto ikut)', async () => {
		const { dx } = fakeDx(routes());
		const r = await m.verifyVehicle(EQ, VEH, '20', NOW, dx, thumb);
		expect(r.verification).toMatchObject({ decision: 'authorized', isAuthorized: true });
		expect(r.holder).toMatchObject({ karyawanId: '20', nama: 'K20', fotoDataUrl: 'data:image/jpeg;base64,file-20' });
	});

	it('orang lain di mode soft => denied + warn, tiap relasi diambil di query terpisah (tanpa field bersarang)', async () => {
		const { dx, calls } = fakeDx(routes());
		const r = await m.verifyVehicle(EQ, VEH, '99', NOW, dx, thumb);
		expect(r.verification).toMatchObject({ decision: 'denied', warn: true, blocked: false, attempt: true });
		for (const c of calls) expect(decodeURIComponent(c)).not.toMatch(/fields=[^&]*\w+\.\w+/);
		expect(calls.filter((c) => c.startsWith('/items/fleet_bookings'))).toHaveLength(1);
	});

	it('Directus gagal baca booking => fail-open (free), bukan terkunci', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { dx } = fakeDx(routes({ '/items/fleet_bookings': new Error('Directus 403') }));
		const r = await m.verifyVehicle(EQ, VEH, '99', NOW, dx, thumb);
		expect(r.verification).toMatchObject({ decision: 'free', blocked: false });
		expect(r.booking).toBeNull();
		expect(spy).toHaveBeenCalled(); // tidak ditelan diam-diam (Aturan #1)
		spy.mockRestore();
	});

	it('tanpa booking: driver tetap unit (fleet_driver_assignment) sah, orang lain free', async () => {
		const r1 = fakeDx(routes({ '/items/fleet_bookings': { data: [] }, '/items/fleet_driver_assignment': { data: [{ driver_id: 'drv-1' }] } }));
		expect((await m.verifyVehicle(EQ, VEH, '20', NOW, r1.dx, thumb)).verification.decision).toBe('authorized');
		const r2 = fakeDx(routes({ '/items/fleet_bookings': { data: [] }, '/items/fleet_driver_assignment': { data: [{ driver_id: 'drv-1' }] } }));
		expect((await m.verifyVehicle(EQ, VEH, '55', NOW, r2.dx, thumb)).verification.decision).toBe('free');
	});

	it('mode hard dari gate_definitions => blocked', async () => {
		vi.mocked(resolveGateMode).mockResolvedValue('hard');
		const { dx } = fakeDx(routes());
		expect((await m.verifyVehicle(EQ, VEH, '99', NOW, dx, thumb)).verification.blocked).toBe(true);
	});

	it('ambang dari fleet_settings dipakai (grace 0 menutup booking disetujui yang belum mulai)', async () => {
		const approved = { ...booking, status: 'disetujui', tanggal_mulai: new Date(NOW + 30 * 60_000).toISOString(), tanggal_selesai_rencana: new Date(NOW + 3 * 3_600_000).toISOString() };
		const { dx } = fakeDx(routes({ '/items/fleet_bookings': { data: [approved] }, '/items/fleet_settings': { data: [{ key: 'driver_lock_grace_menit', value: '0' }] } }));
		expect((await m.verifyVehicle(EQ, VEH, '99', NOW, dx, thumb)).verification.decision).toBe('free');
	});
});

describe('findActiveLoan / verifyTool', () => {
	it('internal_loan_log aktif => PIC jadi peminjam; filter status memakai uuid AKTIF & end_date_actual null', async () => {
		const { dx, calls } = fakeDx({
			...personRoutes,
			'/items/internal_loan_log': { data: [{ id: 'L1', pic_id: 5, project_id: 9, start_date: '2026-10-05', end_date_planned: '2026-10-12', purpose: 'Sandblasting' }] },
			'/items/projects/9': { data: { name: 'Proyek Tangki' } }
		});
		const r = await m.verifyTool(EQ, '5', dx, thumb);
		const q = decodeURIComponent(calls[0]);
		expect(q).toContain(`filter[status][_eq]=${m.LOAN_STATUS_AKTIF}`);
		expect(q).toContain('filter[end_date_actual][_null]=true');
		expect(r.loan).toMatchObject({ source: 'internal_loan_log', projectName: 'Proyek Tangki' });
		expect(r.borrower).toMatchObject({ karyawanId: '5', nama: 'K5' });
		expect(r.verification.decision).toBe('match');
	});

	it('fallback ke peminjaman_internal (peminjam = karyawan) bila log internal kosong; mismatch tidak memblokir', async () => {
		const { dx } = fakeDx({
			...personRoutes,
			'/items/internal_loan_log': { data: [] },
			'/items/identitas_barang': { data: [{ id: 31 }] },
			'/items/peminjaman_internal': { data: [{ id: 3, peminjam_id: 6, tanggal_pinjam: '2026-11-01', tanggal_jatuh_tempo: '2026-11-10', keperluan: 'Kompresor' }] }
		});
		const r = await m.verifyTool(EQ, '5', dx, thumb);
		expect(r.loan?.source).toBe('peminjaman_internal');
		expect(r.verification).toMatchObject({ decision: 'mismatch', warn: true });
	});

	it('loan ada tapi PIC kosong => unknown_borrower (tanpa kartu), bukan crash', async () => {
		const { dx } = fakeDx({ '/items/internal_loan_log': { data: [{ id: 'L1', pic_id: null, project_id: null }] } });
		const r = await m.verifyTool(EQ, '5', dx, thumb);
		expect(r.borrower).toBeNull();
		expect(r.verification.decision).toBe('unknown_borrower');
	});

	it('tanpa loan aktif => no_loan; gagal baca => dicatat & no_loan (fail-open)', async () => {
		expect((await m.verifyTool(EQ, '5', fakeDx({ '/items/internal_loan_log': { data: [] } }).dx, thumb)).verification.decision).toBe('no_loan');
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const r = await m.verifyTool(EQ, '5', fakeDx({ '/items/internal_loan_log': new Error('boom') }).dx, thumb);
		expect(r.verification.decision).toBe('no_loan');
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});
});

describe('logDeniedAttempt', () => {
	it('menulis scan_log dengan penanda terstruktur; gagal tulis tidak melempar', async () => {
		const { dx, calls } = fakeDx({ '/items/scan_log': { data: { id: 1 } } });
		await m.logDeniedAttempt({ equipmentId: 'eq-1', karyawanId: '99', gateKey: 'G_FLT_DRIVER_LOCK', mode: 'shadow', bookingCode: 'BK-1' }, dx);
		expect(calls).toEqual(['/items/scan_log']);
		const body = JSON.parse((dx.mock.calls[0] as any[])[1].body);
		expect(body).toMatchObject({ ref_collection: 'equipment', ref_id: 'eq-1', actor_id: 99, source: 'field' });
		expect(body.notes).toBe('EQUIPMENT_VERIFY|denied|G_FLT_DRIVER_LOCK|mode=shadow|booking=BK-1');

		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(m.logDeniedAttempt({ equipmentId: 'e', karyawanId: '1', gateKey: 'G', mode: 'soft' }, fakeDx({ '/items/scan_log': new Error('403') }).dx)).resolves.toBeUndefined();
		spy.mockRestore();
	});
});

describe('loadPerson / loadPasFoto', () => {
	it('pas_foto: karyawan_dokumen -> karyawan_dokumen_files -> thumbnail; hasil di-cache (hemat query)', async () => {
		const { dx, calls } = fakeDx(personRoutes);
		const a = await m.loadPerson('7', dx, thumb);
		const b = await m.loadPerson('7', dx, thumb);
		expect(a).toMatchObject({ nama: 'K7', fotoDataUrl: 'data:image/jpeg;base64,file-7' });
		expect(b?.fotoDataUrl).toBe(a?.fotoDataUrl);
		expect(calls.filter((c) => c.startsWith('/items/karyawan_dokumen?'))).toHaveLength(1);
	});
	it('dokumen terenkripsi dilewati => kartu tanpa foto (bukan error)', async () => {
		const { dx } = fakeDx({ ...personRoutes, '/items/karyawan_dokumen?': { data: [{ id: 1, is_encrypted: true }] } });
		expect((await m.loadPerson('8', dx, thumb))?.fotoDataUrl).toBeNull();
	});
	it('foto gagal dimuat => kartu tetap ada tanpa foto & error dicatat', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { dx } = fakeDx({ ...personRoutes, '/items/karyawan_dokumen_files': new Error('boom') });
		const p = await m.loadPerson('9', dx, thumb);
		expect(p).toMatchObject({ nama: 'K9', fotoDataUrl: null });
		expect(spy).toHaveBeenCalled();
		spy.mockRestore();
	});
	it('kolom karyawan tidak valid (403 Directus) => TERLIHAT di log, bukan kartu kosong diam-diam', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { dx } = fakeDx({ '/items/karyawan?': new Error('You do not have permission to access field "x"') });
		expect(await m.loadPerson('10', dx, thumb)).toBeNull();
		expect(String(spy.mock.calls[0]?.[0])).toContain('[equipmentVerify]');
		spy.mockRestore();
	});
});

describe('logHandover', () => {
	it('menulis alasan ke notes (jejak audit); BERBEDA dari denied, kegagalan menulis DILEMPAR', async () => {
		const { dx } = fakeDx({ '/items/scan_log': { data: { id: 2 } } });
		await m.logHandover({ equipmentId: 'eq-1', karyawanId: '99', gateKey: 'G_FLT_DRIVER_LOCK', mode: 'soft', bookingCode: 'BK-1' }, 'driver utama sakit mendadak', dx);
		const body = JSON.parse((dx.mock.calls[0] as any[])[1].body);
		expect(body.notes).toBe('EQUIPMENT_VERIFY|handover|G_FLT_DRIVER_LOCK|mode=soft|booking=BK-1|reason=driver utama sakit mendadak');
		await expect(
			m.logHandover({ equipmentId: 'e', karyawanId: '1', gateKey: 'G', mode: 'soft' }, 'alasan', fakeDx({ '/items/scan_log': new Error('403') }).dx)
		).rejects.toThrow('403');
	});
});

describe('findActiveLoan — peminjam diturunkan dari borrower_id bila PIC kosong', () => {
	it('pic_id null + borrower_id (personnel) -> personnel.karyawan_id menjadi peminjam; query terpisah', async () => {
		const { dx, calls } = fakeDx({
			...personRoutes,
			'/items/internal_loan_log': { data: [{ id: 'L1', pic_id: null, borrower_id: 'pers-1', project_id: null }] },
			'/items/personnel/pers-1': { data: { karyawan_id: 5 } }
		});
		const r = await m.verifyTool(EQ, '5', dx, thumb);
		expect(r.borrower?.karyawanId).toBe('5');
		expect(r.verification.decision).toBe('match');
		expect(calls.some((c) => c.startsWith('/items/personnel/pers-1?fields=karyawan_id'))).toBe(true);
	});
	it('PIC terisi diutamakan (tidak query personnel); personnel tanpa karyawan_id -> unknown_borrower', async () => {
		const a = fakeDx({ ...personRoutes, '/items/internal_loan_log': { data: [{ id: 'L1', pic_id: 5, borrower_id: 'pers-1' }] } });
		await m.verifyTool(EQ, '5', a.dx, thumb);
		expect(a.calls.some((c) => c.startsWith('/items/personnel/'))).toBe(false);

		const b = fakeDx({ ...personRoutes, '/items/internal_loan_log': { data: [{ id: 'L1', pic_id: null, borrower_id: 'pers-2' }] }, '/items/personnel/pers-2': { data: { karyawan_id: null } } });
		expect((await m.verifyTool(EQ, '5', b.dx, thumb)).verification.decision).toBe('unknown_borrower');
	});
});
