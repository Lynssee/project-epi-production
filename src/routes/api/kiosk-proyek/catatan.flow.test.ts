// Uji alur Catatan Kerja (Fase 4) di level handler: kru kirim dari kiosk → leader lihat/impor/tandai.
// Directus palsu di memori; cookie HMAC, roster, batas harian, dan penandaan status berjalan sungguhan.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { KIOSK_SESSION_SECRET: 'rahasia-uji-catatan' } }));
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
	catatan: [] as any[],
	perangkat: new Map<number, any>(),
	files: 0,
	fileList: [] as Array<{ id: string; title: string }>,
	koleksiAda: true,
	nextId: 1
};
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
		const id = `file-${++db.files}`;
		db.fileList.push({ id, title: String(fd.get('title') ?? '') });
		return new Response(JSON.stringify({ data: { id } }), { status: 200 });
	}),
	directusServerJson: vi.fn(async (endpoint: string, opts: any = {}) => {
		const method = opts.method || 'GET';
		const body = opts.body ? JSON.parse(opts.body) : null;
		const path = endpoint.split('?')[0];
		const p = new URLSearchParams(endpoint.split('?')[1] || '');

		if (path === '/files') {
			const t = p.get('filter[title][_eq]');
			return { data: db.fileList.filter((f) => f.title === t).map((f) => ({ id: f.id })) };
		}
		if (path === '/items/system_settings') return { data: Object.entries(db.settings).map(([setting_key, setting_value]) => ({ setting_key, setting_value })) };
		if (path === '/items/projects/978') return { data: { id: 978, name: 'Gresik', kiosk_kode: 'AB12CD', manpower_leader_id: 10, manpower_leader_wakil_id: null } };
		if (path === '/items/manpower_assignment') return { data: [20, 21].map((m, i) => ({ id: i + 1, manpower_id: m, status: 'aktif' })) };
		if (path === '/items/manpower') {
			const all = [{ id: 20, nama: 'Agus', posisi: 'Painter' }, { id: 21, nama: 'Cahyo', posisi: 'Helper' }];
			const ids = (p.get('filter[id][_in]') || '').split(',');
			return { data: all.filter((m) => ids.includes(String(m.id))) };
		}
		if (path === '/items/manpower_absensi') return { data: [] };
		if (/^\/items\/kiosk_proyek_perangkat\/\d+$/.test(path)) {
			const r = db.perangkat.get(Number(path.split('/').pop()));
			if (!r) throw new Error('Directus 403');
			if (method === 'PATCH') { Object.assign(r, body); return { data: r }; }
			return { data: r };
		}
		if (path === '/items/kiosk_catatan_kerja') {
			if (!db.koleksiAda) throw new Error('Directus 403 FORBIDDEN');
			if (method === 'POST') {
				const row = { id: db.nextId++, date_created: new Date().toISOString(), ...body };
				db.catatan.push(row);
				return { data: { id: row.id } };
			}
			if (method === 'PATCH') {
				for (const k of body.keys) Object.assign(db.catatan.find((r) => r.id === k)!, body.data);
				return { data: [] };
			}
			const rows = db.catatan.filter((r) => cocok(r, p));
			if (p.get('aggregate[count]')) return { data: [{ count: String(rows.length) }] };
			return { data: rows };
		}
		throw new Error(`endpoint tak dikenal di fake: ${method} ${endpoint}`);
	})
}));

import { POST as catatanPOST } from './catatan/+server';
import { GET as rosterGET } from './roster/+server';
import { GET as masukanGET, POST as masukanPOST } from '../laporan/masukan-kru/+server';
import { KIOSK_PROYEK_COOKIE, signDeviceCookie } from '$lib/server/kioskProyekToken';
import { getKioskProyekSettings } from '$lib/server/kioskProyekSettings';

const SECRET = 'rahasia-uji-catatan';
const cookieBersama = () => signDeviceCookie({ deviceId: 1, projectId: 978, ttlDays: 30 }, SECRET).value;
const cookiePribadi = () => signDeviceCookie({ deviceId: 2, projectId: 978, ttlDays: 30 }, SECRET).value;

function formEvent(fields: Record<string, string | File>, cookie: string | null) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.append(k, v);
	const jar = new Map<string, string>();
	if (cookie) jar.set(KIOSK_PROYEK_COOKIE, cookie);
	return {
		event: {
			url: new URL('http://x/api/kiosk-proyek/catatan'),
			request: new Request('http://x/api/kiosk-proyek/catatan', { method: 'POST', body: fd }),
			cookies: { get: (k: string) => jar.get(k), set: () => {}, delete: (k: string) => void jar.delete(k) },
			getClientAddress: () => '10.0.0.9'
		} as any,
		jar
	};
}
const foto = (isi = 'x', ukuran?: number) => new File([ukuran ? new Uint8Array(ukuran) : isi], 'c.jpg', { type: 'image/jpeg' });
async function panggil(fn: () => Response | Promise<Response>) {
	try {
		const r = await fn();
		return { status: r.status, body: await r.json() };
	} catch (e: any) {
		return { status: e?.status ?? 500, body: { message: e?.body?.message ?? String(e) } };
	}
}
const kirim = (f: Record<string, string | File>, cookie: string | null = cookieBersama()) => panggil(() => catatanPOST(formEvent(f, cookie).event));
const leaderEvent = (url: string, body?: unknown) => ({
	url: new URL(url),
	request: new Request(url, { method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined, headers: { Authorization: 'Bearer t' } }),
	cookies: {}
}) as any;

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-10-27T01:30:00Z')); // 08:30 WIB
	guard.izin = true;
	db.settings = { 'kiosk_proyek.aktif': 'true' };
	db.catatan = [];
	db.files = 0;
	db.fileList = [];
	db.nextId = 1;
	db.koleksiAda = true;
	uploadedTitles.length = 0;
	db.perangkat = new Map([
		[1, { id: 1, project_id: 978, label: 'Tablet pos', jenis: 'bersama', aktif: true, kedaluwarsa_pada: new Date(Date.now() + 86_400_000).toISOString() }],
		[2, { id: 2, project_id: 978, label: 'HP Agus', jenis: 'pribadi', manpower_id: 20, aktif: true, kedaluwarsa_pada: new Date(Date.now() + 86_400_000).toISOString() }]
	]);
	await getKioskProyekSettings(true);
});
afterEach(() => vi.useRealTimers());
const segarkan = () => getKioskProyekSettings(true);

describe('kiru kirim Catatan Kerja dari kiosk', () => {
	it('kiosk bersama: progres dengan foto → tersimpan status baru, tanggal WIB, nama penulis', async () => {
		const r = await kirim({ manpower_id: '20', kategori: 'progres kerja', catatan: 'Primer lantai 2 selesai', foto: foto() });
		expect(r.status).toBe(200);
		expect(r.body).toMatchObject({ ok: true, jenis: 'progres' });
		expect(db.catatan[0]).toMatchObject({
			project_id: 978, manpower_id: 20, tanggal: '2026-10-27', jenis: 'progres', kategori: 'Progres kerja',
			catatan: 'Primer lantai 2 selesai', foto: 'file-1', status: 'baru', perangkat_id: 1, dicatat_oleh: 'Agus'
		});
		expect(uploadedTitles[0]).toBe('kp-catatan:978:2026-10-27');
	});

	it('kategori kendala → jenis kendala; foto saja / teks saja sama-sama cukup', async () => {
		expect((await kirim({ manpower_id: '21', kategori: 'K3 / bahaya', foto: foto() })).body.jenis).toBe('kendala');
		const teksSaja = await kirim({ manpower_id: '21', kategori: 'Kendala', catatan: 'Kabel roll habis' });
		expect(teksSaja.status).toBe(200);
		expect(db.catatan[1].foto).toBeNull();
	});

	it('validasi: kategori asing 400, kosong 400, terlalu panjang 400, foto raksasa 413, orang luar proyek 403', async () => {
		expect((await kirim({ manpower_id: '20', kategori: 'ngawur', catatan: 'x' })).status).toBe(400);
		expect((await kirim({ manpower_id: '20', kategori: 'Kendala' })).status).toBe(400);
		expect((await kirim({ manpower_id: '20', kategori: 'Kendala', catatan: 'a'.repeat(301) })).status).toBe(400);
		expect((await kirim({ manpower_id: '20', kategori: 'Kendala', foto: foto('', 3 * 1024 * 1024) })).status).toBe(413);
		expect((await kirim({ manpower_id: '999', kategori: 'Kendala', catatan: 'x' })).status).toBe(403);
		expect((await kirim({ kategori: 'Kendala', catatan: 'x' })).status).toBe(400); // kiosk bersama wajib pilih nama
		expect(db.catatan).toHaveLength(0);
	});

	it('HP pribadi: identitas dari perangkat; mengaku orang lain ditolak 403', async () => {
		const sendiri = await kirim({ kategori: 'Progres kerja', catatan: 'oke' }, cookiePribadi());
		expect(sendiri.status).toBe(200);
		expect(db.catatan[0]).toMatchObject({ manpower_id: 20, perangkat_id: 2, dicatat_oleh: 'Agus' });
		expect((await kirim({ manpower_id: '21', kategori: 'Progres kerja', catatan: 'oke' }, cookiePribadi())).status).toBe(403);
		expect(db.catatan).toHaveLength(1);
	});

	it('batas harian per orang dari setelan; 0 = tanpa batas', async () => {
		db.settings['kiosk_proyek.catatan_maks_per_orang_per_hari'] = '2';
		await segarkan();
		expect((await kirim({ manpower_id: '20', kategori: 'Kendala', catatan: '1' })).status).toBe(200);
		expect((await kirim({ manpower_id: '20', kategori: 'Kendala', catatan: '2' })).status).toBe(200);
		const ketiga = await kirim({ manpower_id: '20', kategori: 'Kendala', catatan: '3' });
		expect(ketiga.status).toBe(429);
		expect(ketiga.body.message).toContain('Agus');
		expect((await kirim({ manpower_id: '21', kategori: 'Kendala', catatan: 'orang lain tetap bisa' })).status).toBe(200);

		db.settings['kiosk_proyek.catatan_maks_per_orang_per_hari'] = '0';
		await segarkan();
		expect((await kirim({ manpower_id: '20', kategori: 'Kendala', catatan: '4' })).status).toBe(200);
	});

	it('kategori bisa diubah admin lewat setelan (bukan hardcode)', async () => {
		db.settings['kiosk_proyek.catatan_kategori_kendala'] = '["Hujan deras","Macet material"]';
		await segarkan();
		expect((await kirim({ manpower_id: '20', kategori: 'hujan deras', catatan: 'x' })).body.jenis).toBe('kendala');
		expect((await kirim({ manpower_id: '20', kategori: 'K3 / bahaya', catatan: 'x' })).status).toBe(400); // sudah tidak ada
	});

	it('dimatikan admin / kiosk mati / tanpa cookie / perangkat dicabut', async () => {
		db.settings['kiosk_proyek.catatan_aktif'] = 'false';
		await segarkan();
		expect((await kirim({ manpower_id: '20', kategori: 'Kendala', catatan: 'x' })).status).toBe(403);
		db.settings['kiosk_proyek.catatan_aktif'] = 'true';
		await segarkan();
		expect((await kirim({ manpower_id: '20', kategori: 'Kendala', catatan: 'x' }, null)).body.reason).toBe('belum_aktif');
		db.perangkat.get(1).aktif = false;
		expect((await kirim({ manpower_id: '20', kategori: 'Kendala', catatan: 'x' })).body.reason).toBe('perangkat_tidak_sah');
		db.settings['kiosk_proyek.aktif'] = 'false';
		await segarkan();
		expect((await kirim({ manpower_id: '20', kategori: 'Kendala', catatan: 'x' }, cookiePribadi())).body.reason).toBe('kiosk_mati');
	});

	it('skema belum dipasang → 503 jelas (bukan crash), tidak ada yang tersimpan', async () => {
		db.koleksiAda = false;
		const r = await kirim({ manpower_id: '20', kategori: 'Kendala', catatan: 'x' });
		expect(r.status).toBe(503);
		expect(r.body.message).toContain('belum disiapkan');
		expect(db.catatan).toHaveLength(0);
	});

	it('roster membawa daftar kategori hanya bila Catatan Kerja aktif', async () => {
		const ambil = () => panggil(() => rosterGET({ url: new URL('http://x/api/kiosk-proyek/roster'), cookies: { get: () => cookieBersama(), delete: () => {} } } as any));
		const on = await ambil();
		expect(on.body.pengaturan.catatan).toMatchObject({ maks_karakter: 300, progres: expect.any(Array), kendala: expect.any(Array) });
		expect(on.body.pengaturan.catatan.kendala).toContain('K3 / bahaya');
		db.settings['kiosk_proyek.catatan_aktif'] = 'false';
		await segarkan();
		expect((await ambil()).body.pengaturan.catatan).toBeNull();
	});
});

describe('kirim ulang aman (id transaksi & dedupe)', () => {
	const TXN = 'txn-0123456789abcdef';
	it('id transaksi + foto sama dikirim dua kali (respons hilang) → satu baris, satu unggahan, id sama', async () => {
		const a = await kirim({ manpower_id: '20', kategori: 'Progres kerja', catatan: 'cat primer', foto: foto('p'), txn_id: TXN });
		const b = await kirim({ manpower_id: '20', kategori: 'Progres kerja', catatan: 'cat primer', foto: foto('p'), txn_id: TXN });
		expect(a.body).toMatchObject({ ok: true, sudah_ada: false });
		expect(b.body).toMatchObject({ ok: true, sudah_ada: true, id: a.body.id });
		expect(db.catatan).toHaveLength(1);
		expect(db.files).toBe(1);
		expect(uploadedTitles[0]).toBe(`kp-catatan:978:2026-10-27:${TXN}`);
	});

	it('id transaksi BERBEDA dengan isi mirip → dua catatan terpisah (bukan duplikat)', async () => {
		await kirim({ manpower_id: '20', kategori: 'Progres kerja', foto: foto('p'), txn_id: 'txn-aaaaaaaaaaaa' });
		await kirim({ manpower_id: '20', kategori: 'Progres kerja', foto: foto('p'), txn_id: 'txn-bbbbbbbbbbbb' });
		expect(db.catatan).toHaveLength(2);
	});

	it('klien lama tanpa txn_id tetap jalan seperti sebelumnya', async () => {
		await kirim({ manpower_id: '20', kategori: 'Progres kerja', foto: foto('p') });
		await kirim({ manpower_id: '20', kategori: 'Progres kerja', foto: foto('p') });
		expect(db.catatan).toHaveLength(2);
	});

	it('txn_id berbentuk aneh diabaikan (tidak merusak judul file)', async () => {
		await kirim({ manpower_id: '20', kategori: 'Progres kerja', foto: foto('p'), txn_id: '../../etc/passwd' });
		expect(uploadedTitles[0]).toBe('kp-catatan:978:2026-10-27');
	});

	it('file sudah terunggah tetapi barisnya belum ada (proses putus di tengah) → file dipakai ulang, tidak diunggah lagi', async () => {
		db.fileList.push({ id: 'file-lama', title: `kp-catatan:978:2026-10-27:${TXN}` });
		db.files = 1;
		const r = await kirim({ manpower_id: '20', kategori: 'Kendala', catatan: 'x', foto: foto('p'), txn_id: TXN });
		expect(r.body).toMatchObject({ ok: true, sudah_ada: false });
		expect(db.catatan[0].foto).toBe('file-lama');
		expect(db.files).toBe(1);
	});

	it('hanya-teks identik < 2 menit → satu baris; teks beda / lewat 2 menit → baris baru', async () => {
		const a = await kirim({ manpower_id: '20', kategori: 'Kendala', catatan: 'kabel roll habis' });
		const b = await kirim({ manpower_id: '20', kategori: 'Kendala', catatan: 'kabel roll habis' });
		expect(b.body).toMatchObject({ sudah_ada: true, id: a.body.id });
		await kirim({ manpower_id: '20', kategori: 'Kendala', catatan: 'kabel roll habis dan lem' });
		expect(db.catatan).toHaveLength(2);
		vi.setSystemTime(Date.now() + 3 * 60 * 1000);
		await kirim({ manpower_id: '20', kategori: 'Kendala', catatan: 'kabel roll habis' });
		expect(db.catatan).toHaveLength(3);
	});

	it('kirim ulang TIDAK memakan jatah harian dan tidak kena 429', async () => {
		db.settings['kiosk_proyek.catatan_maks_per_orang_per_hari'] = '1';
		await segarkan();
		const a = await kirim({ manpower_id: '20', kategori: 'Kendala', foto: foto('p'), txn_id: TXN });
		expect(a.status).toBe(200);
		const ulang = await kirim({ manpower_id: '20', kategori: 'Kendala', foto: foto('p'), txn_id: TXN });
		expect(ulang.status).toBe(200);
		expect(ulang.body.sudah_ada).toBe(true);
		const baru = await kirim({ manpower_id: '20', kategori: 'Kendala', foto: foto('q'), txn_id: 'txn-cccccccccccc' });
		expect(baru.status).toBe(429); // catatan BENAR-BENAR baru tetap dibatasi
	});
});

describe('leader: lihat, pakai, abaikan', () => {
	async function isi() {
		await kirim({ manpower_id: '20', kategori: 'Progres kerja', catatan: 'A', foto: foto('a') });
		await kirim({ manpower_id: '21', kategori: 'Kendala', catatan: 'B' });
		await kirim({ manpower_id: '20', kategori: 'Hasil kerja', catatan: 'C' });
	}

	it('GET: hanya status baru pada tanggal itu, lengkap dengan nama penulis', async () => {
		await isi();
		db.catatan[2].status = 'diabaikan';
		db.catatan.push({ id: 99, project_id: 978, manpower_id: 20, tanggal: '2026-10-26', jenis: 'progres', status: 'baru', catatan: 'kemarin' });
		const r = await panggil(() => masukanGET(leaderEvent('http://x/api/laporan/masukan-kru?project_id=978&tanggal=2026-10-27')));
		expect(r.status).toBe(200);
		expect(r.body.catatan.map((c: any) => c.catatan)).toEqual(['A', 'B']);
		expect(r.body.catatan.map((c: any) => c.manpower_nama)).toEqual(['Agus', 'Cahyo']);
		// tanggal default = hari ini menurut jam server WIB
		const def = await panggil(() => masukanGET(leaderEvent('http://x/api/laporan/masukan-kru?project_id=978')));
		expect(def.body.tanggal).toBe('2026-10-27');
	});

	it('POST pakai: status dipakai + report_id + jejak; baris proyek lain / sudah diproses tidak tersentuh', async () => {
		await isi();
		db.catatan.push({ id: 50, project_id: 555, manpower_id: 20, tanggal: '2026-10-27', jenis: 'progres', status: 'baru' });
		const r = await panggil(() => masukanPOST(leaderEvent('http://x/api/laporan/masukan-kru', { project_id: 978, action: 'pakai', ids: [1, 2, 50], report_id: 3700 })));
		expect(r.body).toMatchObject({ ok: true, diubah: 2 });
		expect(db.catatan[0]).toMatchObject({ status: 'dipakai', report_id: 3700, diproses_oleh: 'leader@epi.test' });
		expect(db.catatan[2].status).toBe('baru');
		expect(db.catatan.find((c) => c.id === 50)!.status).toBe('baru');
		// diproses dua kali → tidak mengubah apa pun
		const ulang = await panggil(() => masukanPOST(leaderEvent('http://x/api/laporan/masukan-kru', { project_id: 978, action: 'pakai', ids: [1, 2], report_id: 3701 })));
		expect(ulang.body.diubah).toBe(0);
		expect(db.catatan[0].report_id).toBe(3700);
	});

	it('POST abaikan; validasi input; bukan leader proyek → 403', async () => {
		await isi();
		expect((await panggil(() => masukanPOST(leaderEvent('http://x/api/laporan/masukan-kru', { project_id: 978, action: 'abaikan', ids: [3] })))).body.diubah).toBe(1);
		expect(db.catatan[2]).toMatchObject({ status: 'diabaikan', report_id: null });
		const salah = (b: any) => panggil(() => masukanPOST(leaderEvent('http://x/api/laporan/masukan-kru', b)));
		expect((await salah({ project_id: 978, action: 'pakai', ids: [1] })).status).toBe(400); // tanpa report_id
		expect((await salah({ project_id: 978, action: 'pakai', ids: [], report_id: 1 })).status).toBe(400);
		expect((await salah({ project_id: 'x', action: 'abaikan', ids: [1] })).status).toBe(400);
		expect((await salah({ project_id: 978, action: 'hapus', ids: [1] })).status).toBe(400);
		guard.izin = false;
		expect((await salah({ project_id: 978, action: 'abaikan', ids: [1] })).status).toBe(403);
		expect((await panggil(() => masukanGET(leaderEvent('http://x/api/laporan/masukan-kru?project_id=978')))).status).toBe(403);
	});

	it('GET saat skema belum dipasang → 503 (panel leader akan diam)', async () => {
		db.koleksiAda = false;
		const r = await panggil(() => masukanGET(leaderEvent('http://x/api/laporan/masukan-kru?project_id=978')));
		expect(r.status).toBe(503);
	});
});
