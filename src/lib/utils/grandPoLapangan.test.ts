import { describe, it, expect } from 'vitest';
import {
	buildPaketMembers, orderedQty, buildMaterialItems, sjStatus, estimasiTiba, findMoneyKeys, normalizeProgress, idOf,
	buildPilihanProduk, buildRekonsiliasi, matchCustomerMaterial, type BarisMaterial
} from './grandPoLapangan';

describe('normalizeProgress / idOf', () => {
	it('null/kosong/NaN → null (bukan 0 palsu); dijepit 0..100', () => {
		expect(normalizeProgress(null)).toBeNull();
		expect(normalizeProgress('')).toBeNull();
		expect(normalizeProgress('abc')).toBeNull();
		expect(normalizeProgress(0)).toBe(0);
		expect(normalizeProgress(39.234)).toBe(39.2);
		expect(normalizeProgress(140)).toBe(100);
		expect(normalizeProgress(-5)).toBe(0);
	});
	it('idOf menerima angka, string, objek relasi', () => {
		expect(idOf(5)).toBe(5);
		expect(idOf('7')).toBe(7);
		expect(idOf({ id: 9 })).toBe(9);
		expect(idOf(null)).toBeNull();
		expect(idOf('')).toBeNull();
	});
});

describe('buildPaketMembers', () => {
	const soById = new Map<number, any>([
		[2000, { id: 2000, nomor_po_customer: 'Rev2-1019', project_id: 978 }],
		[1998, { id: 1998, nomor_po_customer: '1021', project_id: 978 }],
		[2001, { id: 2001, nomor_po_customer: '1022', project_id: null }],
		[3000, { id: 3000, nomor_so: 'SO3000', project_id: 555 }]
	]);
	const projectById = new Map<number, any>([[978, { id: 978, total_progress: 41.26 }], [555, { id: 555, total_progress: null }]]);
	const base = { soById, projectById, thisProjectId: 978, thisProjectSoIds: new Set([2000, 1998]) };

	it('PO proyek ini ditandai & di urutan atas; progres hanya untuk jasa; material tanpa progres', () => {
		const r = buildPaketMembers({ ...base, members: [
			{ so_customer_id: 2001, peran: 'material' },
			{ so_customer_id: 3000, peran: 'jasa' },
			{ so_customer_id: 2000, peran: 'jasa' }
		] });
		expect(r.map((x) => x.so_id)).toEqual([2000, 3000, 2001]);
		expect(r[0]).toMatchObject({ proyek_ini: true, progres_pct: 41.3, proyek_id: 978 });
		expect(r[1]).toMatchObject({ proyek_ini: false, progres_pct: null, nomor_po: 'SO3000' }); // proyek ada tapi progres null → bukan 0
		expect(r[2]).toMatchObject({ peran: 'material', progres_pct: null });
	});

	it('PO saudara dalam proyek yang sama memakai progres proyek ini', () => {
		const r = buildPaketMembers({ ...base, members: [{ so_customer_id: 1998, peran: 'jasa' }] });
		expect(r[0]).toMatchObject({ proyek_ini: true, progres_pct: 41.3 });
	});

	it('SO tak dikenal / relasi objek / kosong tidak crash', () => {
		const r = buildPaketMembers({ ...base, members: [{ so_customer_id: { id: 9999 }, peran: 'jasa' }, { so_customer_id: null, peran: 'jasa' }] });
		expect(r).toHaveLength(1);
		expect(r[0].nomor_po).toBe('SO #9999');
		expect(buildPaketMembers({ ...base, members: undefined as any })).toEqual([]);
	});

	it('output tidak memuat kunci Rupiah', () => {
		expect(findMoneyKeys(buildPaketMembers({ ...base, members: [{ so_customer_id: 2000, peran: 'jasa' }] }))).toEqual([]);
	});
});

describe('material', () => {
	it('orderedQty = qty × jumlah_pcs (16 × 20 = 320); tanpa pcs = qty; null aman', () => {
		expect(orderedQty({ qty: 16, jumlah_pcs: 20 })).toBe(320);
		expect(orderedQty({ qty: 4, jumlah_pcs: null })).toBe(4);
		expect(orderedQty({})).toBe(0);
	});

	const details = [
		{ id: 1, nama_barang: '0X-515 BROWN 130', qty: 16, jumlah_pcs: 20, packing: 'kg' },
		{ id: 2, nama_barang: 'HARDENER', qty: 4, jumlah_pcs: 20, input_unit: 'kg' }
	];
	const sjById = new Map<number, any>([[10, { status: 'shipped' }], [11, { status: 'cancelled' }], [12, { status: 'delivered' }]]);

	it('dipesan/dikirim/diterima/belum; SJ & item batal tidak dihitung; overship dijepit belum=0', () => {
		const r = buildMaterialItems({ details, sjById, sjItems: [
			{ so_detail_id: 1, surat_jalan_id: 10, qty_delivered: 100, qty_gr_received: 0 },
			{ so_detail_id: 1, surat_jalan_id: 12, qty_delivered: 120, qty_gr_received: 120 },
			{ so_detail_id: 1, surat_jalan_id: 11, qty_delivered: 999 }, // SJ batal
			{ so_detail_id: 1, surat_jalan_id: 10, qty_delivered: 50, cancelled_at: '2026-09-01' }, // item batal
			{ so_detail_id: 2, surat_jalan_id: 10, qty_delivered: 90 } // > pesan 80
		] });
		expect(r[0]).toMatchObject({ qty_pesan: 320, qty_kirim: 220, qty_terima: 120, qty_belum: 100, unit: 'kg' });
		expect(r[1]).toMatchObject({ qty_pesan: 80, qty_kirim: 90, qty_belum: 0, unit: 'kg' });
	});

	it('satuan memakai input_unit (bukan label kemasan packing "5kg")', () => {
		const r = buildMaterialItems({ details: [{ id: 9, nama_barang: 'HARDENER', qty: 4, jumlah_pcs: 6, packing: '5kg', input_unit: 'kg' }], sjById, sjItems: [] });
		expect(r[0]).toMatchObject({ unit: 'kg', qty_pesan: 24 });
	});

	it('tanpa SJ sama sekali: semua belum; relasi objek didukung', () => {
		const r = buildMaterialItems({ details, sjById, sjItems: [] });
		expect(r.map((x) => x.qty_belum)).toEqual([320, 80]);
		const r2 = buildMaterialItems({ details, sjById, sjItems: [{ so_detail_id: { id: 1 }, surat_jalan_id: { id: 10 }, qty_delivered: 20 }] });
		expect(r2[0].qty_kirim).toBe(20);
	});

	it('output tidak memuat kunci Rupiah', () => {
		expect(findMoneyKeys(buildMaterialItems({ details, sjById, sjItems: [] }))).toEqual([]);
	});
});

describe('status SJ & estimasi tiba', () => {
	it('sjStatus', () => {
		expect(sjStatus({ status: 'cancelled' })).toBe('dibatalkan');
		expect(sjStatus({ status: 'delivered' })).toBe('diterima');
		expect(sjStatus({ status: 'shipped', received_at: '2026-09-20' })).toBe('diterima');
		expect(sjStatus({ status: 'shipped', track_stage: 'dalam_perjalanan' })).toBe('dalam_perjalanan');
		expect(sjStatus({ status: 'shipped', track_stage: 'tiba_lokasi' })).toBe('dalam_perjalanan');
		expect(sjStatus({ status: 'shipped' })).toBe('terkirim');
		expect(sjStatus({ status: 'draft' })).toBe('belum_dikirim');
		expect(sjStatus({})).toBe('belum_dikirim');
	});

	const sj = (status: any) => ({ id: 1, nomor_sj: 'SJ1', status, tanggal: null });
	it('estimasiTiba tidak mengarang tanggal', () => {
		expect(estimasiTiba([], 100)).toBe('Belum ada jadwal kirim');
		expect(estimasiTiba([sj('dalam_perjalanan')], 10)).toContain('perjalanan');
		expect(estimasiTiba([sj('diterima')], 0)).toBe('Semua kiriman sudah diterima');
		expect(estimasiTiba([sj('diterima')], 50)).toContain('Sebagian');
		expect(estimasiTiba([sj('terkirim')], 0)).toContain('menunggu tiba');
		expect(estimasiTiba([sj('dibatalkan')], 5)).toBe('Belum ada jadwal kirim');
	});
});

describe('findMoneyKeys', () => {
	it('mendeteksi kunci bernuansa Rupiah di objek bersarang', () => {
		expect(findMoneyKeys({ a: 1, items: [{ harga_satuan: 5 }], x: { grand_total: 1 } }).sort()).toEqual(['items.0.harga_satuan', 'x.grand_total']);
		expect(findMoneyKeys(null)).toEqual([]);
	});
});

describe('Fase 6 — rekonsiliasi', () => {
	const row = (id: number, pid: number | null, nama: string, pesan: number, kirim: number, unit = 'kg'): BarisMaterial => ({
		so_detail_id: id, product_id: pid, nama_barang: nama, unit, qty_pesan: pesan, qty_kirim: kirim, qty_terima: 0, qty_belum: Math.max(pesan - kirim, 0)
	});
	const items = [row(1, 16644, 'HARDENER', 80, 80), row(2, 16644, 'HARDENER', 240, 100), row(3, 22380, 'BROWN', 320, 320), row(4, null, 'TANPA ID', 10, 0)];

	it('buildPilihanProduk: unik per produk, tanpa product_id dilewati, urut nama', () => {
		const p = buildPilihanProduk(items);
		expect(p).toHaveLength(2);
		expect(p.map((x) => x.nama_barang)).toEqual(['BROWN', 'HARDENER']);
	});

	it('baris PO produk sama dijumlahkan; dipakai dari log ber-product_id; sisa = dikirim − dipakai', () => {
		const r = buildRekonsiliasi({ items, logs: [{ product_id: 16644, qty_used: 50, satuan: 'kg' }, { product_id: 16644, qty_used: 30, satuan: 'KG' }, { product_id: 22380, qty_used: 100 }] });
		const h = r.baris.find((b) => b.product_id === 16644)!;
		expect(h).toMatchObject({ qty_pesan: 320, qty_kirim: 180, qty_dipakai: 80, qty_sisa: 100, level: 'ok' });
		expect(r.baris.find((b) => b.product_id === 22380)).toMatchObject({ qty_dipakai: 100, qty_sisa: 220 });
	});

	it('dipakai > dikirim (lewat toleransi) → perhatian; dipakai > dipesan → melebihi_po (urut paling parah dulu)', () => {
		const r = buildRekonsiliasi({ items, logs: [{ product_id: 16644, qty_used: 200, satuan: 'kg' }, { product_id: 22380, qty_used: 400, satuan: 'kg' }] });
		expect(r.baris[0]).toMatchObject({ product_id: 22380, level: 'melebihi_po' });
		expect(r.baris[1]).toMatchObject({ product_id: 16644, level: 'perhatian', qty_sisa: -20 });
		expect(r.baris[0].catatan).toContain('PO tambahan');
	});

	it('toleransi: dalam kelonggaran tetap ok; toleransi 0 langsung perhatian', () => {
		const logs = [{ product_id: 22380, qty_used: 330, satuan: 'kg' }]; // 320 dikirim, 330 = +3.1%
		expect(buildRekonsiliasi({ items, logs, toleransiPct: 5 }).baris.find((b) => b.product_id === 22380)!.level).toBe('ok');
		expect(buildRekonsiliasi({ items, logs, toleransiPct: 0 }).baris.find((b) => b.product_id === 22380)!.level).toBe('melebihi_po');
	});

	it('log tanpa product_id dihitung terpisah; satuan beda TIDAK dijumlahkan (tanpa konversi karangan); produk asing diabaikan', () => {
		const r = buildRekonsiliasi({ items, logs: [{ product_id: null, qty_used: 5 }, { product_id: 16644, qty_used: 25, satuan: 'liter' }, { product_id: 99999, qty_used: 7, satuan: 'kg' }] });
		expect(r.tanpaProduk).toBe(1);
		expect(r.satuanBeda).toBe(1);
		expect(r.baris.find((b) => b.product_id === 16644)!.qty_dipakai).toBe(0);
		expect(r.baris.some((b) => b.product_id === 99999)).toBe(false);
	});

	it('tanpa item / tanpa log aman; output tanpa kunci Rupiah', () => {
		expect(buildRekonsiliasi({ items: [], logs: [] })).toEqual({ baris: [], tanpaProduk: 0, satuanBeda: 0 });
		expect(buildRekonsiliasi({ items: undefined as any, logs: undefined as any }).baris).toEqual([]);
		expect(findMoneyKeys(buildRekonsiliasi({ items, logs: [] }))).toEqual([]);
	});
});

describe('Fase 6 — hint PL proyek (shadow)', () => {
	const produk = [{ nama_barang: 'FOXAPOX-PRIME : OX-515 HARDENER', unit: 'kg' }, { nama_barang: 'THINNER WASHING', unit: 'kg' }, { nama_barang: 'CAT', unit: 'kg' }];
	it('cocok setelah normalisasi (huruf besar/kecil, tanda baca, spasi)', () => {
		const h = matchCustomerMaterial(['foxapox prime ox-515 hardener'], produk);
		expect(h).toEqual([{ material_name: 'foxapox prime ox-515 hardener', produk_po: 'FOXAPOX-PRIME : OX-515 HARDENER', unit: 'kg' }]);
	});
	it('salah satu memuat yang lain (≥6 huruf) cocok; nama pendek/generik ("cat") tidak cocok ke mana-mana', () => {
		expect(matchCustomerMaterial(['Thinner Washing 20 L'], produk)).toHaveLength(1);
		expect(matchCustomerMaterial(['cat', 'Cat dinding putih'], produk)).toHaveLength(0);
	});
	it('tanpa kecocokan / input kosong aman; duplikat nama tidak menggandakan hit', () => {
		expect(matchCustomerMaterial(['Sarung tangan'], produk)).toEqual([]);
		expect(matchCustomerMaterial([], produk)).toEqual([]);
		expect(matchCustomerMaterial(undefined as any, undefined as any)).toEqual([]);
		expect(matchCustomerMaterial(['THINNER WASHING', 'thinner washing'], produk)).toHaveLength(1);
	});
});

describe('buildRekonsiliasi: pembanding satuan (PRJ-26)', () => {
	const row2 = (unit: string) => ({ id: 1, product_id: 7, nama_barang: 'PIPA', qty: 10, qty_dikirim: 10, unit } as any);
	const run = (poUnit: string, logUnit: string) => buildRekonsiliasi({ items: [row2(poUnit)], logs: [{ product_id: 7, qty_used: 4, satuan: logUnit }] } as any);
	it('ejaan berbeda untuk satuan sama dihitung (Lbr = Lembar, Meter = M, kg = KG )', () => {
		expect(run('Lembar', 'Lbr').satuanBeda).toBe(0);
		expect(run('M', 'meter').satuanBeda).toBe(0);
		expect(run('kg', 'KG ').satuanBeda).toBe(0);
	});
	it("satuan berbeda tidak lagi 'sama' karena huruf s dibuang: Ls ≠ L(iter), Sak ≠ Ak", () => {
		expect(run('Ls', 'l').satuanBeda).toBe(1);
		expect(run('Sak', 'ak').satuanBeda).toBe(1);
	});
	it('satuan tak dikenal: spasi diabaikan, huruf tidak', () => {
		expect(run('drum 200', 'Drum200').satuanBeda).toBe(0);
		expect(run('drum 200', 'drum 20').satuanBeda).toBe(1);
	});
});

describe('tambahSumberPo — tag PO pada rekonsiliasi (tanpa Rupiah)', () => {
	const item = (product_id: number, qty_pesan: number, qty_kirim: number) => ({ so_detail_id: 1, product_id, nama_barang: 'EPOXY', unit: 'kg', qty_pesan, qty_kirim, qty_terima: 0, qty_belum: qty_pesan - qty_kirim });
	const baris = [{ product_id: 7, nama_barang: 'EPOXY', unit: 'kg', qty_pesan: 200, qty_kirim: 120, qty_dipakai: 50, qty_sisa: 70, level: 'ok' as const, catatan: '' }];

	it('memecah kuota pesan/kirim per PO material yang memasok produk sama', async () => {
		const { tambahSumberPo } = await import('./grandPoLapangan');
		const out = tambahSumberPo(baris, [
			{ so_id: 1, nomor_po: 'PO-A', items: [item(7, 150, 100)] },
			{ so_id: 2, nomor_po: 'PO-B', items: [item(7, 30, 20), item(7, 20, 0), item(9, 5, 5)] },
			{ so_id: 3, nomor_po: 'PO-C', items: [item(9, 5, 5)] }
		]);
		expect(out[0].sumber_po).toEqual([
			{ so_id: 1, nomor_po: 'PO-A', qty_pesan: 150, qty_kirim: 100 },
			{ so_id: 2, nomor_po: 'PO-B', qty_pesan: 50, qty_kirim: 20 }
		]);
		// pemakaian TIDAK dipecah per PO (coating log belum bertag PO)
		expect(out[0].qty_dipakai).toBe(50);
	});

	it('tanpa material → sumber_po kosong; tidak mengubah baris asal; tanpa kunci Rupiah', async () => {
		const { tambahSumberPo, findMoneyKeys } = await import('./grandPoLapangan');
		const out = tambahSumberPo(baris, []);
		expect(out[0].sumber_po).toEqual([]);
		expect((baris[0] as any).sumber_po).toBeUndefined();
		expect(findMoneyKeys(tambahSumberPo(baris, [{ so_id: 1, nomor_po: 'X', items: [item(7, 1, 1)] }]))).toEqual([]);
	});
});

describe('Pemakaian per PO (coating log bertag so_customer_id)', () => {
	const item = (product_id: number, qty_pesan: number, qty_kirim: number) => ({ so_detail_id: 1, product_id, nama_barang: 'EPOXY', unit: 'kg', qty_pesan, qty_kirim, qty_terima: 0, qty_belum: qty_pesan - qty_kirim });
	const material = [
		{ so_id: 1, nomor_po: 'PO-A', items: [item(7, 150, 100)] },
		{ so_id: 2, nomor_po: 'PO-B', items: [item(7, 50, 20)] }
	];
	const baris = [{ product_id: 7, nama_barang: 'EPOXY', unit: 'kg', qty_pesan: 200, qty_kirim: 120, qty_dipakai: 70, qty_sisa: 50, level: 'ok' as const, catatan: '' }];

	it('memecah pemakaian per PO dari log bertag; log tak bertag dilaporkan terpisah (tidak dibagi)', async () => {
		const { tambahSumberPo } = await import('./grandPoLapangan');
		const logs = [
			{ product_id: 7, so_customer_id: 1, qty_used: 40, satuan: 'kg' },
			{ product_id: 7, so_customer_id: 2, qty_used: 25, satuan: 'KG' }, // > kirim 20 PO-B
			{ product_id: 7, so_customer_id: null, qty_used: 5, satuan: 'kg' }, // tak bertag
			{ product_id: 9, so_customer_id: 1, qty_used: 99, satuan: 'kg' } // produk lain
		];
		const [b] = tambahSumberPo(baris, material, { logs, toleransiPct: 5 });
		expect(b.sumber_po![0]).toMatchObject({ so_id: 1, qty_dipakai: 40, qty_sisa: 60, level: 'ok' });
		expect(b.sumber_po![1]).toMatchObject({ so_id: 2, qty_dipakai: 25, qty_sisa: -5, level: 'perhatian' });
		expect(b.qty_dipakai_tanpa_po).toBe(5); // 70 − (40+25)
	});

	it('log dengan satuan beda tidak dijumlahkan; PO yang bukan pemasok tidak mendapat pemakaian', async () => {
		const { tambahSumberPo } = await import('./grandPoLapangan');
		const [b] = tambahSumberPo(baris, material, { logs: [{ product_id: 7, so_customer_id: 1, qty_used: 10, satuan: 'liter' }, { product_id: 7, so_customer_id: 99, qty_used: 10, satuan: 'kg' }] });
		expect(b.sumber_po![0].qty_dipakai).toBe(0);
		expect(b.sumber_po!.some((s) => s.so_id === 99)).toBe(false);
	});

	it('melebihi total pesan PO → level melebihi_po; tanpa opsi logs → tak ada field pemakaian (kompatibel)', async () => {
		const { tambahSumberPo } = await import('./grandPoLapangan');
		const [b] = tambahSumberPo(baris, material, { logs: [{ product_id: 7, so_customer_id: 2, qty_used: 60, satuan: 'kg' }] });
		expect(b.sumber_po![1].level).toBe('melebihi_po');
		const [c] = tambahSumberPo(baris, material);
		expect(c.sumber_po![0].qty_dipakai).toBeUndefined();
		expect(c.qty_dipakai_tanpa_po).toBeUndefined();
	});

	it('poOptionsForProduct: hanya PO yang memuat produk; null → []; tanpa kunci Rupiah', async () => {
		const { poOptionsForProduct, findMoneyKeys, tambahSumberPo } = await import('./grandPoLapangan');
		expect(poOptionsForProduct(material, 7)).toEqual([{ so_id: 1, nomor_po: 'PO-A' }, { so_id: 2, nomor_po: 'PO-B' }]);
		expect(poOptionsForProduct(material, 8)).toEqual([]);
		expect(poOptionsForProduct(material, null)).toEqual([]);
		expect(findMoneyKeys(tambahSumberPo(baris, material, { logs: [{ product_id: 7, so_customer_id: 1, qty_used: 1 }] }))).toEqual([]);
	});
});
