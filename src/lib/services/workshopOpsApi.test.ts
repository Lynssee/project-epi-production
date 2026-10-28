// src/lib/services/workshopOpsApi.test.ts
// Workshop Ops lapangan terpadu Ciketing & Balaraja (Fase 7c Unifikasi Workshop).
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Op = { op: string; collection: string; arg: any };
const h = vi.hoisted(() => ({ request: vi.fn(), scope: { unrestricted: true, kosong: false }, projects: [] as any[], wsProjects: [] as any[], getProjects: vi.fn(), auth: { karyawanId: null as number | null, karyawanName: null as string | null, directusToken: 'tok' } }));

vi.mock('@directus/sdk', () => ({
	readItems: (collection: string, query: any) => ({ op: 'read', collection, arg: query }),
	createItem: (collection: string, data: any) => ({ op: 'create', collection, arg: data }),
	createItems: (collection: string, data: any) => ({ op: 'createMany', collection, arg: data }),
	deleteItem: (collection: string, id: any) => ({ op: 'delete', collection, arg: id }),
	deleteItems: (collection: string, q: any) => ({ op: 'deleteMany', collection, arg: q }),
	uploadFiles: (fd: any) => ({ op: 'upload', collection: 'files', arg: fd }),
	aggregate: (collection: string, query: any) => ({ op: 'aggregate', collection, arg: query })
}));
vi.mock('./directus', () => ({ default: { request: (...a: any[]) => h.request(...a) }, handleDirectusError: vi.fn() }));
vi.mock('./projectScope', () => ({
	getProjectScope: () => h.scope,
	getProjectsForCurrentUser: async () => h.projects,
	getPeranProjectUser: (p: any) => (p.leader_id === 99 ? 'lead_pic' : 'anggota')
}));
vi.mock('./secureDirectus', () => ({ getIdToken: async () => 'tok-firebase' }));
vi.mock('./projects', () => ({ getProjects: (...a: any[]) => h.getProjects(...a) }));
vi.mock('$lib/stores/auth', () => ({ authStore: { subscribe: (fn: any) => { fn(h.auth); return () => {}; } } }));
vi.mock('../utils/subtaskProgressEngine', () => ({ extractActiveSubtasks: () => [] }));

const api = await import('./workshopOpsApi');
const stok = await import('./workshopStokApi');
const prof = await import('./workshopOpsProfile');

let ops: Op[] = [];
function respond(map: Record<string, any>) {
	h.request.mockImplementation(async (o: Op) => {
		ops.push(o);
		const key = `${o.op}:${o.collection}`;
		if (key in map) return typeof map[key] === 'function' ? map[key](o) : map[key];
		return o.op === 'create' ? { id: 1 } : [];
	});
}
const colls = () => ops.map((o) => o.collection);

beforeEach(() => { vi.clearAllMocks(); ops = []; h.scope = { unrestricted: true, kosong: false }; h.projects = []; h.wsProjects = []; h.auth = { karyawanId: null, karyawanName: null, directusToken: 'tok' }; h.getProjects.mockImplementation(async () => h.wsProjects); });

describe('profil', () => {
	it('kunci tak dikenal/kosong → Ciketing (aman untuk entri antrian offline lama)', () => {
		expect(prof.opsProfile(undefined).key).toBe('ciketing');
		expect(prof.opsProfile('x').key).toBe('ciketing');
		expect(prof.opsProfile('balaraja').id).toBe(2);
		expect(prof.parseOpsWorkshop('balaraja')).toBe('balaraja');
		expect(prof.parseOpsWorkshop('__proto__')).toBe('ciketing');
		expect(prof.WORKSHOP_OPS.balaraja.sjmHasKondisi).toBe(true);
		expect(prof.WORKSHOP_OPS.ciketing.hasOverstay).toBe(true);
	});
});

describe('Papan Order', () => {
	beforeEach(() => {
		h.projects = [
			{ id: 1, workshop: 'ciketing', status: 'on progress', nomor_po: 'C-1', customer: [{ name: 'A' }] },
			{ id: 2, workshop: 'balaraja', status: 'on progress', nomor_po: 'B-2', customer: [{ name: 'B' }] },
			{ id: 3, workshop: 'balaraja', status: 'selesai', nomor_po: 'B-3' }
		];
		respond({});
	});

	it('balaraja: hanya PO Balaraja aktif; tahap dihitung dari koleksi Balaraja & workshop_id 2', async () => {
		const rows = await api.getMyOrders('balaraja');
		expect(rows.map((r) => r.nomorPo)).toEqual(['B-2']);
		expect(colls()).toEqual(expect.arrayContaining(['balaraja_surat_jalan_masuk', 'balaraja_surat_jalan_keluar', 'workshop_report_po_detail', 'inspection_report']));
		expect(colls().some((c) => c.startsWith('ciketing_'))).toBe(false);
		const detail = ops.find((o) => o.collection === 'workshop_report_po_detail')!;
		expect(detail.arg.query.filter.workshop_id._eq).toBe(2);
	});

	it('default & alias lama = ciketing', async () => {
		expect((await api.getMyOrders()).map((r) => r.nomorPo)).toEqual(['C-1']);
		expect((await api.getMyCiketingOrders()).map((r) => r.nomorPo)).toEqual(['C-1']);
		expect(ops.find((o) => o.collection === 'workshop_report_po_detail')!.arg.query.filter.workshop_id._eq).toBe(1);
	});

	it('scope kosong → daftar kosong tanpa query', async () => {
		h.scope = { unrestricted: false, kosong: true };
		expect(await api.getMyOrders('balaraja')).toEqual([]);
		expect(ops).toHaveLength(0);
	});

	it('WSK-31 tahap TERPADU (agregat): tagih > dikirim > siap kirim > QC > produksi > inbound > order', async () => {
		h.projects = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => ({ id, workshop: 'balaraja', status: 'on progress', nomor_po: 'B-' + id, total_progress: id === 8 ? 40 : 0 }));
		respond({
			'aggregate:balaraja_surat_jalan_masuk': [{ project: 2, count: '1' }],
			'aggregate:workshop_report_po_detail': [
				{ po_id: 3, count: '2', sum: { total_objek: '10', sudah_dikerjakan: '4', sandblasting: '0' } }, // laporan tanpa angka produksi => baru "barang diterima"
				{ po_id: 4, count: '1', sum: { total_objek: '10', sudah_dikerjakan: '10', sandblasting: '5' } } // produksi selesai => QC
			],
			'aggregate:inspection_report': [{ project_id: 5, status: 'approved', count: '1' }],
			'aggregate:balaraja_surat_jalan_keluar': (o: any) => {
				const f = o.arg.query.filter;
				if (f.invoice_id) return [{ project: 7, count: '1' }]; // berinvoice
				if (f._or) return [{ project: 6, count: '2' }, { project: 7, count: '1' }]; // diserahkan
				return [{ project: 6, count: '2' }, { project: 5, count: '1' }, { project: 7, count: '1' }]; // semua SJ Keluar
			}
		});
		const st = Object.fromEntries((await api.getMyOrders('balaraja')).map((r) => [r.projectId, r.stage]));
		expect(st).toEqual({ 1: 'order', 2: 'inbound', 3: 'inbound', 4: 'qc', 5: 'siap_kirim', 6: 'dikirim', 7: 'tagih', 8: 'produksi' });
	});

	it('WSK-31: label tahap = kosakata terpadu & draft inspeksi menahan di QC', async () => {
		h.projects = [{ id: 1, workshop: 'ciketing', status: 'on progress', nomor_po: 'C-1' }];
		respond({ 'aggregate:inspection_report': [{ project_id: 1, status: 'draft', count: '1' }] });
		const [r] = await api.getMyOrders('ciketing');
		expect(r.stage).toBe('qc');
		expect(r.stageLabel).toBe('QC / inspeksi');
	});

	it('WSK-31: Ciketing hanya menghitung SJ Masuk barang customer (consumable/sinkron pusat tidak memajukan tahap)', async () => {
		h.projects = [{ id: 1, workshop: 'ciketing', status: 'on progress', nomor_po: 'C-1' }];
		respond({});
		await api.getMyOrders('ciketing');
		const masuk = ops.find((o) => o.op === 'aggregate' && o.collection === 'ciketing_surat_jalan_masuk')!;
		expect(masuk.arg.query.filter._or).toEqual([{ source_type: { _eq: 'customer' } }, { source_type: { _null: true } }]);
		ops = [];
		h.projects = [{ id: 2, workshop: 'balaraja', status: 'on progress', nomor_po: 'B-2' }];
		await api.getMyOrders('balaraja');
		expect(ops.find((o) => o.op === 'aggregate' && o.collection === 'balaraja_surat_jalan_masuk')!.arg.query.filter._or).toBeUndefined();
	});

	it('WSK-15: jumlah request TIDAK tumbuh dengan jumlah PO (6 agregat untuk 40 PO, bukan 160+)', async () => {
		h.projects = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, workshop: 'ciketing', status: 'on progress', nomor_po: 'C-' + (i + 1) }));
		respond({});
		await api.getMyOrders('ciketing');
		expect(ops.filter((o) => o.op === 'aggregate')).toHaveLength(6);
		expect(ops.filter((o) => o.op === 'read')).toHaveLength(0);
	});

	it('WSK-15: galat Directus dilempar (BUKAN daftar kosong yang menyamar jadi "belum ada order")', async () => {
		h.request.mockRejectedValue(new Error('500 boom'));
		vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(api.getMyOrders('ciketing')).rejects.toThrow(/Papan Order gagal dimuat/);
	});
});

describe('Papan Order — scope anggota workshop & "PO saya" (WSK-15 §4c)', () => {
	const semua = [
		{ id: 10, workshop: 'ciketing', status: 'on progress', nomor_po: 'C-10', leader_id: 99 },
		{ id: 11, workshop: 'ciketing', status: 'on progress', nomor_po: 'C-11', leader_id: 371 },
		{ id: 12, workshop: 'ciketing', status: 'on progress', nomor_po: 'C-12', leader_id: 371 }
	];
	const asMember = () => respond({ 'read:workshop_project_leader': [{ id: 1 }] });

	it('anggota roster: melihat SEMUA PO aktif workshop-nya (query workshop, bukan scope pribadi); PO saya ditandai & di atas', async () => {
		h.auth = { karyawanId: 61, karyawanName: 'RIDHO', directusToken: 'tok' };
		h.projects = []; h.wsProjects = [semua[1], semua[2], semua[0]];
		asMember();
		const rows = await api.getMyOrders('ciketing');
		expect(h.getProjects).toHaveBeenCalledWith(null, true, 'tok', { orWorkshops: ['ciketing'] });
		expect(rows.map((r) => r.nomorPo)).toEqual(['C-10', 'C-11', 'C-12']); // PO saya (leader_id 99) naik ke atas
		expect(rows.map((r) => r.mine)).toEqual([true, false, false]);
	});

	it('anggota dengan scope pribadi KOSONG tetap melihat PO workshop-nya', async () => {
		h.auth = { karyawanId: 62, karyawanName: 'IRFAN', directusToken: 'tok' };
		h.scope = { unrestricted: false, kosong: true };
		h.wsProjects = [semua[1]];
		asMember();
		expect((await api.getMyOrders('ciketing')).map((r) => r.nomorPo)).toEqual(['C-11']);
	});

	it('bukan anggota roster: scope proyek biasa (tidak melebar); roster workshop LAIN tidak dihitung (filter workshop_id)', async () => {
		h.auth = { karyawanId: 63, karyawanName: 'X', directusToken: 'tok' };
		h.projects = [semua[0]];
		respond({});
		const rows = await api.getMyOrders('ciketing');
		expect(h.getProjects).not.toHaveBeenCalled();
		expect(rows.map((r) => r.nomorPo)).toEqual(['C-10']);
		const roster = ops.filter((o) => o.collection === 'workshop_project_leader' || o.collection === 'workshop_manpower');
		expect(roster).toHaveLength(2);
		expect(roster.every((o) => o.arg.filter.workshop_id._eq === 1 && o.arg.filter.status._eq === 'aktif')).toBe(true);
	});

	it('galat baca roster → jatuh ke scope biasa (TIDAK melebar) dan tidak menggagalkan papan', async () => {
		h.auth = { karyawanId: 64, karyawanName: 'Y', directusToken: 'tok' };
		h.projects = [semua[0]];
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		h.request.mockImplementation(async (o: Op) => { ops.push(o); if (o.collection === 'workshop_project_leader') throw new Error('403'); return []; });
		expect((await api.getMyOrders('ciketing')).map((r) => r.nomorPo)).toEqual(['C-10']);
		expect(h.getProjects).not.toHaveBeenCalled();
		spy.mockRestore();
	});
});

describe('Laporan Harian (WSK-10/13: SATU request ke endpoint server)', () => {
	const input = {
		tanggal: '2026-10-10', jumlah_tenaga: 2, client_txn_id: 'txn-12345678',
		po_details: [{ po_id: 2, subtask_name: 'Blasting', volume_aktual: 5, jumlah_manpower: 2 }] as any
	};
	const okBody = (extra: any = {}) => ({ ok: true, status: 200, json: async () => ({ success: true, laporanId: 99, idempotent: false, manpowerForSync: [], ...extra }) });
	let fetchMock: ReturnType<typeof vi.fn>;
	beforeEach(() => { fetchMock = vi.fn(async () => okBody()); vi.stubGlobal('fetch', fetchMock); });
	const sent = () => JSON.parse(fetchMock.mock.calls[0][1].body);

	it('balaraja: POST ke /api/workshop/balaraja/daily-report dengan token Firebase; TIDAK menulis ke Directus dari browser', async () => {
		const res = await api.submitLaporanHarianWorkshop({ ...input, ws: 'balaraja', materials: [{ nama_material: 'Cat', qty: 2 }] });
		expect(res).toMatchObject({ success: true, laporanId: 99, alreadyProcessed: false });
		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(fetchMock.mock.calls[0][0]).toBe('/api/workshop/balaraja/daily-report');
		expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok-firebase');
		const b = sent();
		expect(b.clientTxnId).toBe('txn-12345678');
		expect(b.header.tanggal).toBe('2026-10-10');
		expect(b.material).toEqual([{ kategori: null, nama_material: 'Cat', qty: 2, satuan: null }]);
		expect(b.po_details[0]).toMatchObject({ po_id: 2, subtask_name: 'Blasting', volume_aktual: 5, jumlah_manpower: 2 });
		expect(ops.filter((o) => o.op === 'create' || o.op === 'createMany' || o.op === 'delete' || o.op === 'deleteMany')).toHaveLength(0);
	});

	it('dibuat_oleh TIDAK dikirim (ditentukan server dari token) dan jumlah_tenaga tidak dikirim (dihitung server)', async () => {
		await api.submitLaporanHarianWorkshop({ ...input, ws: 'ciketing', dibuat_oleh: 'Palsu' });
		const b = sent();
		expect(JSON.stringify(b)).not.toContain('Palsu');
		expect(b.header.jumlah_tenaga).toBeUndefined();
		expect(b.header.dibuat_oleh).toBeUndefined();
	});

	it('kehadiran dipisah leader/manpower, lengkap dengan pembagian PO', async () => {
		await api.submitLaporanHarianWorkshop({
			...input, ws: 'ciketing',
			absensi: [
				{ tipe: 'leader', nama: 'Budi', status_hadir: 'hadir' },
				{ tipe: 'manpower', nama: 'Andi', status_hadir: 'hadir', manpower_id: 7, po_split: [{ po_id: 2, persentase: 100 }] }
			] as any
		});
		const b = sent();
		expect(b.absensi_leader.map((r: any) => r.nama)).toEqual(['Budi']);
		expect(b.absensi.map((r: any) => [r.nama, r.manpower_id, r.po_split])).toEqual([['Andi', 7, [{ po_id: 2, persentase: 100 }]]]);
	});

	it('sukses → absensi manpower BARU disalin ke HR (manpower_absensi) lewat baris yang dikembalikan server; gagal HR tidak membatalkan', async () => {
		fetchMock.mockResolvedValue(okBody({ manpowerForSync: [{ manpower_id: 7, status_hadir: 'hadir' }] }));
		respond({ 'read:workshop_manpower': [{ id: 7, manpower_id: 70 }], 'read:manpower_absensi': [] });
		const res = await api.submitLaporanHarianWorkshop({ ...input, ws: 'ciketing', absensi: [{ tipe: 'leader', nama: 'B', status_hadir: 'hadir' }, { tipe: 'manpower', nama: 'A', status_hadir: 'hadir', manpower_id: 7 }] as any });
		expect(res.success).toBe(true);
		const hr = ops.find((o) => o.op === 'createMany' && o.collection === 'manpower_absensi');
		expect(hr?.arg[0]).toMatchObject({ manpower_id: 70, tanggal: '2026-10-10', status: 'hadir' });
	});

	it('kirim ulang (idempoten): server menjawab idempotent → alreadyProcessed, tanpa sinkron HR', async () => {
		fetchMock.mockResolvedValue(okBody({ idempotent: true }));
		const res = await api.submitLaporanHarianWorkshop({ ...input, ws: 'ciketing' });
		expect(res).toMatchObject({ success: true, alreadyProcessed: true });
		expect(ops).toHaveLength(0);
	});

	it('tanggal sudah ada (409 LAPORAN_TANGGAL_ADA) → gagal dengan pesan jelas + kode + id laporan yang ada', async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 409, json: async () => ({ success: false, code: 'LAPORAN_TANGGAL_ADA', message: 'Laporan tanggal 2026-10-10 sudah ada (#5).', existing: { id: 5 } }) });
		const res = await api.submitLaporanHarianWorkshop({ ...input, ws: 'ciketing' });
		expect(res).toMatchObject({ success: false, code: 'LAPORAN_TANGGAL_ADA', existingId: 5 });
		expect(res.error).toContain('sudah ada');
	});

	it('galat server (503) → pesan server ditampilkan, bukan "berhasil"', async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 503, json: async () => ({ message: 'Laporan gagal disimpan — tidak ada yang tersimpan.' }) });
		const res = await api.submitLaporanHarianWorkshop({ ...input, ws: 'ciketing' });
		expect(res.success).toBe(false);
		expect(res.error).toContain('tidak ada yang tersimpan');
	});

	it('tidak ada sinyal (TypeError) dilempar ulang → pemanggil memasukkan ke antrian offline', async () => {
		fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
		await expect(api.submitLaporanHarianWorkshop({ ...input, ws: 'ciketing' })).rejects.toBeInstanceOf(TypeError);
	});

	it('tanpa ws → DITOLAK (WSK-12: tidak ada default diam-diam ke Ciketing); antrian lama ditentukan lewat resolveWorkshopForProjects', async () => {
		const res = await api.submitLaporanHarianWorkshop(input as any);
		expect(res.success).toBe(false);
		expect(res.error).toMatch(/Workshop belum dipilih/);
		expect(ops).toHaveLength(0);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('validasi klien tetap berlaku (Σ orang per PO = jumlah tenaga) dan tidak memanggil server', async () => {
		const res = await api.submitLaporanHarianWorkshop({ ...input, ws: 'balaraja', jumlah_tenaga: 5 } as any);
		expect(res.success).toBe(false);
		expect(ops).toHaveLength(0);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('Terima Barang (SJ Masuk)', () => {
	const base = { projectId: 2, no_sj: 'SJ-9', tanggal: '2026-10-10', nama_barang: 'Pipa', qty: 2, satuan: 'Pcs', fotoSjId: 'f1', kondisi_barang: 'utuh' as const };

	it('balaraja: koleksi Balaraja dan kondisi_barang tersimpan', async () => {
		respond({});
		const res = await api.submitTerimaBarangLapangan({ ...base, ws: 'balaraja' });
		expect(res.success).toBe(true);
		const w = ops.find((o) => o.op === 'create')!;
		expect(w.collection).toBe('balaraja_surat_jalan_masuk');
		expect(w.arg).toMatchObject({ project: 2, no_sj: 'SJ-9', status_input: 'belum_input', kondisi_barang: 'utuh' });
	});

	it('ciketing (eksplisit): koleksi Ciketing + kondisi_barang tersimpan', async () => {
		respond({});
		await api.submitTerimaBarangLapangan({ ...base, ws: 'ciketing' });
		const w = ops.find((o) => o.op === 'create')!;
		expect(w.collection).toBe('ciketing_surat_jalan_masuk');
		expect(w.arg.kondisi_barang).toBe('utuh');
	});

	it('validasi: foto barang wajib bila kondisi bukan utuh (kedua workshop)', async () => {
		const res = await api.submitTerimaBarangLapangan({ ...base, kondisi_barang: 'cacat', ws: 'balaraja' });
		expect(res.success).toBe(false);
		expect(ops).toHaveLength(0);
	});
});

describe('Quick Report, SJ Masuk opsi, foto, tiket kerja', () => {
	it('quick report → SATU request ke /quick-report (balaraja), tanpa tulis Directus dari browser; pembuat dari server', async () => {
		const fetchMock = vi.fn(async (..._a: any[]) => ({ ok: true, status: 200, json: async () => ({ success: true, laporanId: 7, idempotent: false }) }));
		vi.stubGlobal('fetch', fetchMock);
		const res = await api.submitQuickFieldReport({ projectId: 2, aktivitas: 'Cek', fotoIds: ['a'], ws: 'balaraja', client_txn_id: 'txn-q-123456', dibuat_oleh: 'Palsu' });
		expect(res).toMatchObject({ success: true, laporanId: 7, alreadyProcessed: false });
		expect(fetchMock.mock.calls[0][0]).toBe('/api/workshop/balaraja/quick-report');
		expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok-firebase');
		const b = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(b).toEqual({ clientTxnId: 'txn-q-123456', projectId: 2, aktivitas: 'Cek', fotoIds: ['a'] });
		expect(ops).toHaveLength(0);
	});

	it('quick report: idempoten → alreadyProcessed; galat server ditampilkan; tanpa sinyal (TypeError) dilempar; validasi lokal tanpa request', async () => {
		const fm = vi.fn();
		vi.stubGlobal('fetch', fm);
		fm.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true, laporanId: 7, idempotent: true }) });
		expect((await api.submitQuickFieldReport({ projectId: 2, aktivitas: '', fotoIds: ['a'], ws: 'ciketing' })).alreadyProcessed).toBe(true);
		fm.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({ message: 'Quick report gagal disimpan — tidak ada yang tersimpan.' }) });
		expect((await api.submitQuickFieldReport({ projectId: 2, aktivitas: '', fotoIds: ['a'], ws: 'ciketing' })).error).toContain('tidak ada yang tersimpan');
		fm.mockRejectedValueOnce(new TypeError('Failed to fetch'));
		await expect(api.submitQuickFieldReport({ projectId: 2, aktivitas: '', fotoIds: ['a'], ws: 'ciketing' })).rejects.toBeInstanceOf(TypeError);
		fm.mockClear();
		expect((await api.submitQuickFieldReport({ projectId: 2, aktivitas: '', fotoIds: [], ws: 'ciketing' })).success).toBe(false);
		expect((await api.submitQuickFieldReport({ projectId: 2, aktivitas: '', fotoIds: ['a'] } as any)).error).toMatch(/Workshop belum dipilih/);
		expect(fm).not.toHaveBeenCalled();
	});

	it('opsi SJ Masuk, foto progres, tiket kerja memakai koleksi/ID workshop yang diminta', async () => {
		respond({});
		await api.getSjMasukOptionsForProjects([2], 'balaraja');
		await api.fetchFotoTahapForProject(2, 'balaraja');
		await api.fetchWorkTicketsForProject(2, 'balaraja');
		await api.getProjectSubtasksAndAccum([2], 'balaraja');
		expect(colls()).toEqual(expect.arrayContaining(['balaraja_surat_jalan_masuk', 'balaraja_work_ticket']));
		expect(colls().some((c) => c.startsWith('ciketing_'))).toBe(false);
		const ids = ops.filter((o) => o.collection === 'workshop_report_po_detail').map((o) => o.arg.filter.workshop_id._eq);
		expect(ids.length).toBeGreaterThan(0);
		expect(ids.every((i: number) => i === 2)).toBe(true);
	});
});

describe('Cek Stok lapangan', () => {
	it('ledgerBalances: IN − OUT, abaikan tipe lain/baris tanpa item', () => {
		const m = stok.ledgerBalances([
			{ item: 1, tipe: 'IN', sum: { qty: '10' } }, { item: 1, tipe: 'OUT', sum: { qty: 3 } },
			{ item: { id: 2 }, tipe: 'IN', sum: { qty: 4 } }, { item: 3, tipe: 'ADJ', sum: { qty: 9 } }, { item: null, tipe: 'IN', sum: { qty: 1 } }
		] as any);
		expect(m.get(1)).toBe(7);
		expect(m.get(2)).toBe(4);
		expect(m.get(3)).toBe(0);
	});

	it('balaraja: tidak meminta stok_tersedia; saldo dari agregat ledger; kritis bila < stok_min', async () => {
		respond({
			'read:balaraja_item': [{ id: 1, nama_barang: 'Cat', kode: 'C', satuan_default: 'L', stok_min: 10 }, { id: 2, nama_barang: 'Thinner', stok_min: 0 }],
			'aggregate:balaraja_stok_ledger': [{ item: 1, tipe: 'IN', sum: { qty: '12' } }, { item: 1, tipe: 'OUT', sum: { qty: '5' } }]
		});
		const rows = await stok.fetchWorkshopStok('balaraja');
		expect(ops.find((o) => o.collection === 'balaraja_item')!.arg.fields).not.toContain('stok_tersedia');
		expect(rows.map((r) => [r.id, r.stokTersedia, r.statusKritis])).toEqual([[1, 7, true], [2, 0, false]]);
	});

	it('ciketing (default & alias): membaca kolom stok_tersedia, tanpa agregat', async () => {
		respond({ 'read:ciketing_item': [{ id: 1, nama_barang: 'Pasir', stok_tersedia: '8', stok_min: 5 }] });
		const rows = await stok.fetchCiketingStok();
		expect(rows[0]).toMatchObject({ stokTersedia: 8, statusKritis: false });
		expect(ops.some((o) => o.op === 'aggregate')).toBe(false);
	});
});
