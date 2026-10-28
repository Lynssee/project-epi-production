import { describe, it, expect, vi, beforeEach } from 'vitest';

const directus = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: any[]) => directus(...a) }));
const m = await import('./opnameSesi');

let lines: any[];
let header: any;
function setup(opts: { sessionMode?: string; status?: string; blind?: boolean } = {}) {
	header = { id: 1, kode: 'OPN-G-2610-001', status: opts.status ?? 'counting', blind_count: opts.blind ?? true, total_lines: 2, counted_lines: 0 };
	lines = [
		{ id: 11, session: 1, item_id: 10, rak_id: 2, status: 'pending', qty_fisik: null, qty_sistem_snapshot: 100, qty_mutasi_setelah_snapshot: 0 },
		{ id: 12, session: 1, item_id: 11, rak_id: null, status: 'pending', qty_fisik: null, qty_sistem_snapshot: 5, qty_mutasi_setelah_snapshot: 0 }
	];
	directus.mockReset();
	m._resetOpnameSesiCache();
	directus.mockImplementation(async (url: string, opt: any = {}) => {
		const body = opt.body ? JSON.parse(opt.body) : null;
		if (url.startsWith('/items/system_settings')) {
			return { data: [{ setting_key: 'inventory.opname.session_mode', setting_value: JSON.stringify(opts.sessionMode ?? 'session') }, { setting_key: 'inventory.opname.toleransi_pct', setting_value: '2' }] };
		}
		if (url.startsWith('/items/stock_opname_session?') ) return { data: [{ id: 1, kode: header.kode }] };
		if (url.startsWith('/items/stock_opname_session/')) {
			if (opt.method === 'PATCH') Object.assign(header, body);
			return { data: header };
		}
		if (url.startsWith('/items/stock_opname_line?') && url.includes('aggregate')) return { data: [{ count: { qty_fisik: String(lines.filter((l) => l.qty_fisik !== null).length) } }] };
		if (url.startsWith('/items/stock_opname_line?') && url.includes('filter[item_id][_in]')) {
			const ids = (/filter\[item_id\]\[_in\]=([\d,]+)/.exec(url)?.[1] || '').split(',').map(Number);
			const rakOk = (l: any) => (url.includes('[rak_id][_null]') ? l.rak_id === null : url.includes('[rak_id][_eq]=2') ? l.rak_id === 2 : true);
			return { data: lines.filter((l) => ids.includes(l.item_id) && rakOk(l)).map((l) => ({ item_id: l.item_id })) };
		}
		if (url.startsWith('/items/stock_opname_line?') && url.includes('filter[session][_in]') ) {
			const rakOk = (l: any) => (url.includes('[rak_id][_null]') ? l.rak_id === null : url.includes('[rak_id][_eq]=2') ? l.rak_id === 2 : true);
			return { data: lines.filter((l) => url.includes(`[item_id][_eq]=${l.item_id}`) && rakOk(l)).map((l) => ({ id: l.id, session: l.session })) };
		}
		if (url.startsWith('/items/stock_opname_line?')) return { data: lines.map((l) => ({ ...l, foto_bukti: null, alasan_selisih: null, alasan_catatan: null })) };
		if (url.startsWith('/items/stock_opname_line/')) {
			const l = lines.find((x) => x.id === Number(url.split('/')[3].split('?')[0]));
			if (opt.method === 'PATCH') Object.assign(l, body);
			return { data: l };
		}
		if (url.startsWith('/items/identitas_barang')) return { data: [{ id: 10, nama_barang_lengkap: 'Cat A', kode_item: 'CA', satuan: 'KG' }, { id: 11, nama_barang_lengkap: 'Cat B', kode_item: 'CB', satuan: 'PCS' }] };
		if (url.startsWith('/items/gudang?')) return { data: [{ id: 2, kode_gudang: 'R-2', nama_gudang: 'Rak 2' }] };
		throw new Error('mock: url tak dikenal ' + url);
	});
}
beforeEach(() => setup());

describe('getSesiLapangan — blind count di SERVER', () => {
	it('blind: qty sistem tidak ikut terkirim', async () => {
		const r = await m.getSesiLapangan(1);
		expect(r.lines).toHaveLength(2);
		expect(r.lines.every((l) => l.qty_sistem === null)).toBe(true);
		expect(JSON.stringify(r)).not.toContain('qty_sistem_snapshot');
		expect(r.lines[0]).toMatchObject({ nama: 'Cat A', rak_nama: 'R-2 Rak 2', satuan: 'KG' });
	});
	it('non-blind: qty sistem ikut', async () => {
		setup({ blind: false });
		expect((await m.getSesiLapangan(1)).lines[0].qty_sistem).toBe(100);
	});
	it('sesi bukan counting -> 409', async () => {
		setup({ status: 'review' });
		await expect(m.getSesiLapangan(1)).rejects.toMatchObject({ status: 409 });
	});
});

describe('simpanHitungan', () => {
	it('simpan + header counted_lines disinkron; perlu_bukti bila selisih > toleransi (tanpa membocorkan angka)', async () => {
		const r = await m.simpanHitungan(1, [{ lineId: 11, qtyFisik: 90 }, { lineId: 12, qtyFisik: 5 }], 'Budi');
		expect(r.hasil).toEqual([{ lineId: 11, ok: true, perlu_bukti: true }, { lineId: 12, ok: true, perlu_bukti: false }]);
		expect(JSON.stringify(r)).not.toMatch(/selisih/);
		expect(lines[0]).toMatchObject({ qty_fisik: 90, status: 'counted', counted_by: 'Budi' });
		expect(header.counted_lines).toBe(2);
	});
	it('foto sudah ada -> tidak minta bukti lagi', async () => {
		const r = await m.simpanHitungan(1, [{ lineId: 11, qtyFisik: 90, foto: 'abc' }], 'Budi');
		expect(r.hasil[0].perlu_bukti).toBe(false);
	});
	it('qty negatif / baris sesi lain ditolak per-baris, baris lain tetap tersimpan', async () => {
		lines.push({ id: 99, session: 7, item_id: 10, rak_id: null, status: 'pending', qty_fisik: null, qty_sistem_snapshot: 1, qty_mutasi_setelah_snapshot: 0 });
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const r = await m.simpanHitungan(1, [{ lineId: 11, qtyFisik: -1 }, { lineId: 99, qtyFisik: 1 }, { lineId: 12, qtyFisik: 5 }], 'Budi');
		expect(r.hasil.map((h) => h.ok)).toEqual([false, false, true]);
		spy.mockRestore();
	});
	it('kosongkan hitungan (null) mengembalikan baris ke pending', async () => {
		await m.simpanHitungan(1, [{ lineId: 12, qtyFisik: 5 }], 'Budi');
		await m.simpanHitungan(1, [{ lineId: 12, qtyFisik: null }], 'Budi');
		expect(lines[1]).toMatchObject({ qty_fisik: null, status: 'pending' });
	});
	it('sesi bukan counting -> 409', async () => {
		setup({ status: 'submitted' });
		await expect(m.simpanHitungan(1, [{ lineId: 11, qtyFisik: 1 }], 'Budi')).rejects.toMatchObject({ status: 409 });
	});
});

describe('masukkanKeSesiAktif (Kiosk)', () => {
	it('mode legacy -> null (kiosk berperilaku seperti dulu)', async () => {
		setup({ sessionMode: 'legacy' });
		expect(await m.masukkanKeSesiAktif({ itemId: 10, rakId: 2, hitungFisik: 5, karyawanNama: 'Budi' })).toBeNull();
	});
	it('mode session + baris cocok (rak,item) -> hitungan masuk sesi', async () => {
		const r = await m.masukkanKeSesiAktif({ itemId: 10, rakId: 2, hitungFisik: 100, karyawanNama: 'Budi' });
		expect(r).toMatchObject({ kode: 'OPN-G-2610-001', lineId: 11, perlu_bukti: false });
		expect(lines[0].qty_fisik).toBe(100);
	});
	it('item tidak ada di sesi -> null (jalur lama)', async () => {
		expect(await m.masukkanKeSesiAktif({ itemId: 999, rakId: 2, hitungFisik: 1, karyawanNama: 'Budi' })).toBeNull();
	});
	it('rak berbeda dari baris sesi -> null', async () => {
		expect(await m.masukkanKeSesiAktif({ itemId: 10, rakId: null, hitungFisik: 1, karyawanNama: 'Budi' })).toBeNull();
	});
});

describe('blind count kiosk (server-side)', () => {
	const items = [{ item_id: 10, stok_sistem: 100 }, { item_id: 11, stok_sistem: 5 }, { item_id: 77, stok_sistem: 9 }];
	it('rak 2: item 10 (baris sesi blind) dikosongkan + ditandai; lainnya utuh', async () => {
		const r: any[] = await m.anotasiBlindKiosk(items, 2);
		expect(r[0]).toMatchObject({ item_id: 10, stok_sistem: null, blind_sesi: true });
		expect(r[1].stok_sistem).toBe(5);
		expect(r[2].stok_sistem).toBe(9);
	});
	it('tanpa rak: hanya baris global (rak null) -> item 11 yang blind', async () => {
		const r: any[] = await m.anotasiBlindKiosk(items, null);
		expect(r.find((i) => i.item_id === 11)).toMatchObject({ stok_sistem: null, blind_sesi: true });
		expect(r.find((i) => i.item_id === 10).stok_sistem).toBe(100);
	});
	it('sesi tidak blind / mode legacy -> daftar tidak diubah', async () => {
		setup({ sessionMode: 'legacy' });
		expect(await m.anotasiBlindKiosk(items, 2)).toBe(items);
	});
	it('gagal baca -> stok tetap tampil (fail-open, bukan error)', async () => {
		const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		directus.mockImplementation(async (url: string) => {
			if (url.startsWith('/items/system_settings')) return { data: [{ setting_key: 'inventory.opname.session_mode', setting_value: '"session"' }] };
			throw new Error('Directus 403 FORBIDDEN');
		});
		m._resetOpnameSesiCache();
		expect(await m.anotasiBlindKiosk(items, 2)).toBe(items);
		spy.mockRestore();
	});
});
