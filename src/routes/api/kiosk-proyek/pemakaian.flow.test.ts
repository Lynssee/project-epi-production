// Uji alur Draf Pemakaian Barang (Fase 5) di level handler: kru ajukan dari kiosk → leader lihat/impor/tandai.
// Pembuktian utama: draf TIDAK PERNAH menulis stok (project_expenses / ledger) — fake mencatat setiap tulis ke sana.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { KIOSK_SESSION_SECRET: 'rahasia-uji-pemakaian' } }));
vi.mock('$lib/server/rateLimit', () => ({ isRateLimited: vi.fn(() => false) }));
const guard = vi.hoisted(() => ({ izin: true }));
vi.mock('$lib/server/laporanPenulisGuard', () => ({
	authenticatePenulisLaporan: vi.fn(async () => {
		if (!guard.izin) throw Object.assign(new Error('x'), { status: 403, body: { message: 'Anda bukan leader di proyek ini.' } });
		return { uid: 'u1', email: 'leader@epi.test' };
	})
}));

const db = {
	settings: {} as Record<string, string>,
	draf: [] as any[],
	catatanAda: false, // koleksi Catatan Kerja (Fase 4) — tidak dipasang di skenario ini
	drafAda: true,
	perangkat: new Map<number, any>(),
	expenses: [] as any[],
	nextId: 1,
	files: 0
};
const tulisStok: string[] = []; // setiap tulis ke project_expenses / ledger tercatat di sini
const uploadedTitles: string[] = [];

function cocok(row: any, p: URLSearchParams): boolean {
	for (const [k, v] of p) {
		const m = /^filter\[(\w+)\]\[(_eq|_in)\]$/.exec(k);
		if (!m) continue;
		const val = row[m[1]] && typeof row[m[1]] === 'object' ? row[m[1]].id : row[m[1]];
		if (m[2] === '_eq' && String(val) !== v) return false;
		if (m[2] === '_in' && !v.split(',').includes(String(val))) return false;
	}
	return true;
}

vi.mock('$lib/server/directus', () => ({
	directusServerUpload: vi.fn(async (fd: FormData) => {
		uploadedTitles.push(String(fd.get('title') ?? ''));
		return new Response(JSON.stringify({ data: { id: `file-${++db.files}` } }), { status: 200 });
	}),
	directusServerJson: vi.fn(async (endpoint: string, opts: any = {}) => {
		const method = opts.method || 'GET';
		const body = opts.body ? JSON.parse(opts.body) : null;
		const path = endpoint.split('?')[0];
		const p = new URLSearchParams(endpoint.split('?')[1] || '');

		if (path.startsWith('/items/project_expenses') && method !== 'GET') { tulisStok.push(`${method} ${path}`); return { data: {} }; }
		if (path.includes('project_stock_ledger') || path.includes('project_stock_balance')) { tulisStok.push(`${method} ${path}`); return { data: {} }; }

		if (path === '/items/system_settings') return { data: Object.entries(db.settings).map(([setting_key, setting_value]) => ({ setting_key, setting_value })) };
		if (path === '/items/projects/978') return { data: { id: 978, name: 'Gresik', kiosk_kode: 'AB12CD', manpower_leader_id: 10, manpower_leader_wakil_id: null } };
		if (path === '/items/manpower_assignment') return { data: [20, 21].map((m, i) => ({ id: i + 1, manpower_id: m, status: 'aktif' })) };
		if (path === '/items/manpower') {
			const all = [{ id: 20, nama: 'Agus', posisi: 'Painter' }, { id: 21, nama: 'Cahyo', posisi: 'Helper' }];
			const ids = (p.get('filter[id][_in]') || '').split(',');
			return { data: all.filter((m) => ids.includes(String(m.id))) };
		}
		if (path === '/items/manpower_absensi') return { data: [] };
		if (path === '/items/project_expenses') return { data: db.expenses.filter((e) => cocok(e, p)) };
		if (/^\/items\/kiosk_proyek_perangkat\/\d+$/.test(path)) {
			const r = db.perangkat.get(Number(path.split('/').pop()));
			if (!r) throw new Error('Directus 403');
			return { data: r };
		}
		if (path === '/items/kiosk_catatan_kerja') throw new Error('Directus 403 FORBIDDEN'); // belum dipasang
		if (path === '/items/kiosk_pemakaian_draf') {
			if (!db.drafAda) throw new Error('Directus 403 FORBIDDEN');
			if (method === 'POST') {
				const row = { id: db.nextId++, date_created: new Date().toISOString(), ...body };
				db.draf.push(row);
				return { data: { id: row.id } };
			}
			if (method === 'PATCH') {
				for (const k of body.keys) Object.assign(db.draf.find((r) => r.id === k)!, body.data);
				return { data: [] };
			}
			const rows = db.draf.filter((r) => cocok(r, p));
			if (p.get('aggregate[count]')) return { data: [{ count: String(rows.length) }] };
			return { data: rows };
		}
		throw new Error(`endpoint tak dikenal di fake: ${method} ${endpoint}`);
	})
}));

import { GET as barangGET } from './barang/+server';
import { POST as pemakaianPOST } from './pemakaian/+server';
import { GET as rosterGET } from './roster/+server';
import { GET as masukanGET, POST as masukanPOST } from '../laporan/masukan-kru/+server';
import { KIOSK_PROYEK_COOKIE, signDeviceCookie } from '$lib/server/kioskProyekToken';
import { getKioskProyekSettings } from '$lib/server/kioskProyekSettings';
import { invalidateBarang } from '$lib/server/kioskPemakaian';
import { invalidateRoster } from '$lib/server/kioskProyekDevice';

const SECRET = 'rahasia-uji-pemakaian';
const cookieBersama = () => signDeviceCookie({ deviceId: 1, projectId: 978, ttlDays: 30 }, SECRET).value;
const cookiePribadi = () => signDeviceCookie({ deviceId: 2, projectId: 978, ttlDays: 30 }, SECRET).value;

function formEvent(fields: Record<string, string | File>, cookie: string | null) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.append(k, v);
	const jar = new Map<string, string>();
	if (cookie) jar.set(KIOSK_PROYEK_COOKIE, cookie);
	return {
		url: new URL('http://x/api/kiosk-proyek/pemakaian'),
		request: new Request('http://x/api/kiosk-proyek/pemakaian', { method: 'POST', body: fd }),
		cookies: { get: (k: string) => jar.get(k), set: () => {}, delete: (k: string) => void jar.delete(k) },
		getClientAddress: () => '10.0.0.9'
	} as any;
}
const foto = (isi = 'x', ukuran?: number) => new File([ukuran ? new Uint8Array(ukuran) : isi], 'p.jpg', { type: 'image/jpeg' });
async function panggil(fn: () => Response | Promise<Response>) {
	try {
		const r = await fn();
		return { status: r.status, body: await r.json() };
	} catch (e: any) {
		return { status: e?.status ?? 500, body: { message: e?.body?.message ?? String(e) } };
	}
}
const ajukan = (f: Record<string, string | File>, cookie: string | null = cookieBersama()) => panggil(() => pemakaianPOST(formEvent(f, cookie)));
const leaderEvent = (url: string, body?: unknown) => ({
	url: new URL(url),
	request: new Request(url, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, headers: { Authorization: 'Bearer t' } }),
	cookies: {}
}) as any;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-10-27T01:30:00Z'));
	guard.izin = true;
	db.settings = { 'kiosk_proyek.aktif': 'true' };
	db.draf = [];
	db.drafAda = true;
	db.nextId = 1;
	db.files = 0;
	db.expenses = [
		{ id: 77, project_id: 978, expense_type: 'supplier', material_name: 'Thinner', unit: 'liter', qty: '100', qty_used: '30', qty_remaining: '70', identitas_barang_id: 5 },
		{ id: 78, project_id: 978, expense_type: 'consumable', description: 'Sarung tangan', unit: 'pasang', qty: '10', qty_used: '4', qty_remaining: null, identitas_barang_id: null },
		{ id: 79, project_id: 978, expense_type: 'supplier', material_name: 'Habis', unit: 'kg', qty: '5', qty_used: '5', qty_remaining: '0' },
		{ id: 80, project_id: 978, expense_type: 'jasa', material_name: 'Upah (bukan barang)', unit: 'hari', qty: '9', qty_used: '0', qty_remaining: '9' },
		{ id: 81, project_id: 555, expense_type: 'supplier', material_name: 'Proyek lain', unit: 'kg', qty: '9', qty_used: '0', qty_remaining: '9' }
	];
	tulisStok.length = 0;
	uploadedTitles.length = 0;
	db.perangkat = new Map([
		[1, { id: 1, project_id: 978, label: 'Tablet pos', jenis: 'bersama', aktif: true, kedaluwarsa_pada: new Date(Date.now() + 86_400_000).toISOString() }],
		[2, { id: 2, project_id: 978, label: 'HP Agus', jenis: 'pribadi', manpower_id: 20, aktif: true, kedaluwarsa_pada: new Date(Date.now() + 86_400_000).toISOString() }]
	]);
	invalidateBarang(978);
	invalidateRoster(978);
	await getKioskProyekSettings(true);
});
afterEach(() => vi.useRealTimers());
const segarkan = () => getKioskProyekSettings(true);

describe('kiosk: daftar barang & ajukan draf', () => {
	it('daftar barang = RAP Actual proyek ini bertipe barang dengan sisa > 0 (tanpa jasa, tanpa habis, tanpa proyek lain)', async () => {
		const r = await panggil(() => barangGET({ url: new URL('http://x/api/kiosk-proyek/barang'), cookies: { get: () => cookieBersama(), delete: () => {} } } as any));
		expect(r.status).toBe(200);
		expect(r.body.barang.map((b: any) => [b.expense_id, b.nama, b.sisa])).toEqual([[78, 'Sarung tangan', 6], [77, 'Thinner', 70]]);
	});

	it('draf tersimpan dengan nama/satuan/identitas SALINAN SERVER; stok TIDAK ditulis sama sekali', async () => {
		const r = await ajukan({ manpower_id: '20', expense_id: '77', qty: '2,5', catatan: 'untuk primer', foto: foto() });
		expect(r.status).toBe(200);
		expect(r.body).toMatchObject({ ok: true, sudah_ada: false });
		expect(db.draf[0]).toMatchObject({
			project_id: 978, manpower_id: 20, tanggal: '2026-10-27', expense_id: 77, identitas_barang_id: 5,
			nama_barang: 'Thinner', satuan: 'liter', qty: 2.5, catatan: 'untuk primer', foto: 'file-1', status: 'baru', perangkat_id: 1, dicatat_oleh: 'Agus'
		});
		expect(uploadedTitles[0]).toBe('kp-pemakaian:978:2026-10-27');
		expect(tulisStok).toEqual([]); // ← inti jaminan: tidak ada tulis ke project_expenses / ledger
	});

	it('validasi: jumlah salah 400, melebihi sisa 422, barang tak ada/habis/proyek lain/jasa 404, tanpa foto 400, foto raksasa 413, orang luar proyek 403', async () => {
		const dasar = { manpower_id: '20', expense_id: '77', qty: '1', foto: foto() };
		expect((await ajukan({ ...dasar, qty: '0' })).status).toBe(400);
		expect((await ajukan({ ...dasar, qty: 'abc' })).status).toBe(400);
		const lebih = await ajukan({ ...dasar, qty: '70.001' });
		expect(lebih.status).toBe(422);
		expect(lebih.body.message).toContain('70');
		expect((await ajukan({ ...dasar, qty: '70' })).status).toBe(200); // tepat sisa boleh
		for (const id of ['79', '80', '81', '9999']) expect((await ajukan({ ...dasar, expense_id: id })).status).toBe(404);
		expect((await ajukan({ manpower_id: '20', expense_id: '77', qty: '1' })).status).toBe(400);
		expect((await ajukan({ ...dasar, foto: foto('', 3 * 1024 * 1024) })).status).toBe(413);
		expect((await ajukan({ ...dasar, manpower_id: '999' })).status).toBe(403);
		expect((await ajukan({ expense_id: '77', qty: '1', foto: foto() })).status).toBe(400); // kiosk bersama wajib pilih nama
		expect(tulisStok).toEqual([]);
	});

	it('foto bisa dibuat opsional lewat setelan', async () => {
		db.settings['kiosk_proyek.pemakaian_foto_wajib'] = 'false';
		await segarkan();
		const r = await ajukan({ manpower_id: '20', expense_id: '77', qty: '1' });
		expect(r.status).toBe(200);
		expect(db.draf[0].foto).toBeNull();
	});

	it('ketuk ganda (draf kembar < 2 menit) tidak menggandakan; jumlah beda tetap draf baru', async () => {
		const a = await ajukan({ manpower_id: '20', expense_id: '77', qty: '2', foto: foto('a') });
		const b = await ajukan({ manpower_id: '20', expense_id: '77', qty: '2', foto: foto('b') });
		expect(b.body).toMatchObject({ ok: true, sudah_ada: true, id: a.body.id });
		expect(db.draf).toHaveLength(1);
		expect(db.files).toBe(1); // foto kedua tidak diunggah
		await ajukan({ manpower_id: '20', expense_id: '77', qty: '3', foto: foto('c') });
		expect(db.draf).toHaveLength(2);
	});

	it('HP pribadi: identitas dari perangkat; mengaku orang lain 403', async () => {
		expect((await ajukan({ expense_id: '78', qty: '1', foto: foto() }, cookiePribadi())).status).toBe(200);
		expect(db.draf[0]).toMatchObject({ manpower_id: 20, perangkat_id: 2 });
		expect((await ajukan({ manpower_id: '21', expense_id: '78', qty: '1', foto: foto() }, cookiePribadi())).status).toBe(403);
	});

	it('batas harian per orang dari setelan', async () => {
		db.settings['kiosk_proyek.pemakaian_maks_per_orang_per_hari'] = '2';
		await segarkan();
		expect((await ajukan({ manpower_id: '20', expense_id: '77', qty: '1', foto: foto('1') })).status).toBe(200);
		expect((await ajukan({ manpower_id: '20', expense_id: '77', qty: '2', foto: foto('2') })).status).toBe(200);
		const ketiga = await ajukan({ manpower_id: '20', expense_id: '77', qty: '3', foto: foto('3') });
		expect(ketiga.status).toBe(429);
		expect((await ajukan({ manpower_id: '21', expense_id: '77', qty: '1', foto: foto('4') })).status).toBe(200);
	});

	it('dimatikan admin / tanpa cookie / perangkat dicabut / kiosk mati; skema belum dipasang → 503', async () => {
		db.settings['kiosk_proyek.pemakaian_aktif'] = 'false';
		await segarkan();
		expect((await ajukan({ manpower_id: '20', expense_id: '77', qty: '1', foto: foto() })).status).toBe(403);
		expect((await panggil(() => barangGET({ url: new URL('http://x/'), cookies: { get: () => cookieBersama(), delete: () => {} } } as any))).status).toBe(403);
		db.settings['kiosk_proyek.pemakaian_aktif'] = 'true';
		await segarkan();
		expect((await ajukan({ manpower_id: '20', expense_id: '77', qty: '1', foto: foto() }, null)).body.reason).toBe('belum_aktif');
		db.perangkat.get(1).aktif = false;
		expect((await ajukan({ manpower_id: '20', expense_id: '77', qty: '1', foto: foto() })).body.reason).toBe('perangkat_tidak_sah');
		db.perangkat.get(1).aktif = true;
		db.drafAda = false;
		const belum = await ajukan({ manpower_id: '20', expense_id: '77', qty: '1', foto: foto() });
		expect(belum.status).toBe(503);
		expect(belum.body.message).toContain('belum disiapkan');
		db.settings['kiosk_proyek.aktif'] = 'false';
		await segarkan();
		expect((await ajukan({ manpower_id: '20', expense_id: '77', qty: '1', foto: foto() })).body.reason).toBe('kiosk_mati');
		expect(tulisStok).toEqual([]);
	});

	it('roster membawa pengaturan pemakaian hanya bila aktif', async () => {
		const ambil = () => panggil(() => rosterGET({ url: new URL('http://x/api/kiosk-proyek/roster'), cookies: { get: () => cookieBersama(), delete: () => {} } } as any));
		expect((await ambil()).body.pengaturan.pemakaian).toEqual({ foto_wajib: true });
		db.settings['kiosk_proyek.pemakaian_aktif'] = 'false';
		await segarkan();
		expect((await ambil()).body.pengaturan.pemakaian).toBeNull();
	});
});

describe('leader: masukan kru memuat draf pemakaian', () => {
	async function isi() {
		await ajukan({ manpower_id: '20', expense_id: '77', qty: '2', foto: foto('a') });
		await ajukan({ manpower_id: '21', expense_id: '78', qty: '4', foto: foto('b') });
	}

	it('GET: draf baru + nama pengaju; catatan kerja yang belum dipasang tidak mematikan panel', async () => {
		await isi();
		db.draf[1].status = 'diabaikan';
		const r = await panggil(() => masukanGET(leaderEvent('http://x/api/laporan/masukan-kru?project_id=978&tanggal=2026-10-27')));
		expect(r.status).toBe(200);
		expect(r.body.catatan).toEqual([]);
		expect(r.body.pemakaian).toHaveLength(1);
		expect(r.body.pemakaian[0]).toMatchObject({ nama_barang: 'Thinner', qty: 2, satuan: 'liter', manpower_nama: 'Agus', expense_id: 77 });
	});

	it('GET: kedua koleksi belum dipasang → 503 (panel diam)', async () => {
		db.drafAda = false;
		expect((await panggil(() => masukanGET(leaderEvent('http://x/api/laporan/masukan-kru?project_id=978')))).status).toBe(503);
	});

	it('POST pakai (jenis pemakaian): status dipakai + report_id; stok tetap tidak ditulis server; proyek lain/ulang tidak tersentuh', async () => {
		await isi();
		db.draf.push({ id: 50, project_id: 555, manpower_id: 20, tanggal: '2026-10-27', status: 'baru', qty: 1 });
		const r = await panggil(() => masukanPOST(leaderEvent('http://x/api/laporan/masukan-kru', { project_id: 978, jenis: 'pemakaian', action: 'pakai', ids: [1, 50], report_id: 3700 })));
		expect(r.body).toMatchObject({ ok: true, diubah: 1 });
		expect(db.draf[0]).toMatchObject({ status: 'dipakai', report_id: 3700, diproses_oleh: 'leader@epi.test' });
		expect(db.draf[1].status).toBe('baru');
		expect(db.draf.find((d) => d.id === 50)!.status).toBe('baru');
		expect((await panggil(() => masukanPOST(leaderEvent('http://x/api/laporan/masukan-kru', { project_id: 978, jenis: 'pemakaian', action: 'pakai', ids: [1], report_id: 3701 })))).body.diubah).toBe(0);
		expect(tulisStok).toEqual([]);
	});

	it('POST abaikan; jenis salah 400; bukan leader proyek 403', async () => {
		await isi();
		const a = await panggil(() => masukanPOST(leaderEvent('http://x/api/laporan/masukan-kru', { project_id: 978, jenis: 'pemakaian', action: 'abaikan', ids: [2] })));
		expect(a.body.diubah).toBe(1);
		expect(db.draf[1]).toMatchObject({ status: 'diabaikan', report_id: null });
		expect((await panggil(() => masukanPOST(leaderEvent('http://x/api/laporan/masukan-kru', { project_id: 978, jenis: 'ngawur', action: 'abaikan', ids: [1] })))).status).toBe(400);
		guard.izin = false;
		expect((await panggil(() => masukanPOST(leaderEvent('http://x/api/laporan/masukan-kru', { project_id: 978, jenis: 'pemakaian', action: 'abaikan', ids: [1] })))).status).toBe(403);
	});
});
