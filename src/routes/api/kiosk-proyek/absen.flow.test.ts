// Uji alur absen Kiosk Proyek (Fase 2) + regresi jalur leader (absen-regu) di level handler.
// Directus diganti fake di memori; HMAC, geofence, gate (resolveGateMode asli), akrual, dan inti
// manpowerAbsensiCore berjalan sungguhan.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { KIOSK_SESSION_SECRET: 'rahasia-uji-absen' } }));
vi.mock('$lib/server/rateLimit', () => ({ isRateLimited: vi.fn(() => false) }));
vi.mock('$lib/server/manpowerLeaderGuard', () => ({
	authenticateManpowerLeader: vi.fn(async () => ({
		manpower: { id: 10, nama: 'Budi Leader' },
		project: { id: 978, geo_lat: -7.0, geo_lng: 112.0, geo_radius_m: 300 }
	}))
}));

// ---- Directus palsu ---------------------------------------------------------
const PROJECT = { id: 978, name: 'Gresik', kiosk_kode: 'AB12CD', geo_lat: -7.0, geo_lng: 112.0, geo_radius_m: 300, manpower_leader_id: 10, manpower_leader_wakil_id: null };
const db = {
	settings: {} as Record<string, string>,
	gateModes: {} as Record<string, string>,
	assignments: [] as any[],
	absensi: [] as any[],
	expenses: [] as any[],
	files: [] as Array<{ id: string; title: string | null }>,
	perangkat: new Map<number, any>(),
	manpower: [
		{ id: 10, nama: 'Budi Leader', posisi: 'Foreman' },
		{ id: 20, nama: 'Agus', posisi: 'Painter' },
		{ id: 21, nama: 'Cahyo', posisi: 'Helper' },
		{ id: 30, nama: 'Dedi', posisi: 'Helper' }
	] as any[],
	nextPerangkat: 2,
	nextAbsensi: 100,
	nextFile: 1
};
const uploads: string[] = [];

function matchRow(row: any, params: URLSearchParams): boolean {
	for (const [k, v] of params) {
		const m = /^filter\[(\w+)\]\[(_eq|_in|_starts_with)\]$/.exec(k);
		if (!m) continue;
		const [, field, op] = m;
		const val = row[field] && typeof row[field] === 'object' ? row[field].id : row[field];
		if (op === '_eq' && String(val) !== v) return false;
		if (op === '_in' && !v.split(',').includes(String(val))) return false;
		if (op === '_starts_with' && !String(val ?? '').startsWith(v)) return false;
	}
	return true;
}
const qs = (endpoint: string) => new URLSearchParams(endpoint.split('?')[1] || '');
const batasi = (rows: any[], p: URLSearchParams) => {
	const limit = Number(p.get('limit') || 100);
	return limit < 0 ? rows : rows.slice(0, limit); // limit=-1 di Directus = tanpa batas
};

vi.mock('$lib/server/directus', () => ({
	directusServerUpload: vi.fn(async (fd: FormData) => {
		const id = `file-${db.nextFile++}`;
		db.files.push({ id, title: (fd.get('title') as string) || null });
		uploads.push(id);
		return new Response(JSON.stringify({ data: { id } }), { status: 200 });
	}),
	directusServerJson: vi.fn(async (endpoint: string, opts: any = {}) => {
		const method = opts.method || 'GET';
		const body = opts.body ? JSON.parse(opts.body) : null;
		const path = endpoint.split('?')[0];
		const p = qs(endpoint);

		if (path === '/items/system_settings') {
			const key = p.get('filter[setting_key][_eq]');
			if (key) return { data: key in db.settings ? [{ setting_value: db.settings[key] }] : [] };
			return { data: Object.entries(db.settings).map(([setting_key, setting_value]) => ({ setting_key, setting_value })) };
		}
		if (path === '/items/gate_definitions') {
			const key = p.get('filter[gate_key][_eq]')!;
			return { data: key in db.gateModes ? [{ gate_key: key, default_mode: db.gateModes[key], enforce_from: null, is_active: true }] : [] };
		}
		if (path === '/items/gate_enforcement') return { data: [] };
		if (path === '/files') {
			const t = p.get('filter[title][_eq]');
			return { data: db.files.filter((f) => f.title === t).map((f) => ({ id: f.id })) };
		}
		if (path === `/items/projects/${PROJECT.id}`) return { data: PROJECT };
		if (path === '/items/manpower_assignment') return { data: batasi(db.assignments.filter((a) => matchRow(a, p)), p) };
		if (path === '/items/projects') return { data: [PROJECT].filter((x) => matchRow(x, p)) };
		if (path === '/items/manpower') return { data: db.manpower.filter((m) => matchRow(m, p)) };
		if (path === '/items/kiosk_proyek_perangkat' && method === 'POST') {
			const id = db.nextPerangkat++;
			db.perangkat.set(id, { id, ...body });
			return { data: { id } };
		}
		if (path === '/items/kiosk_proyek_perangkat') return { data: batasi([...db.perangkat.values()].filter((r) => matchRow(r, p)), p) };
		if (path === '/items/manpower_absensi' && method === 'GET') {
			const rows = db.absensi.filter((r) => matchRow(r, p));
			if (p.get('aggregate[count]')) return { data: [{ count: String(rows.length) }] };
			return { data: batasi(rows, p) };
		}
		if (path === '/items/manpower_absensi' && method === 'POST') {
			const row = { id: db.nextAbsensi++, ...body };
			db.absensi.push(row);
			return { data: row };
		}
		if (/^\/items\/manpower_absensi\/\d+$/.test(path) && method === 'PATCH') {
			const row = db.absensi.find((r) => r.id === Number(path.split('/').pop()))!;
			Object.assign(row, body);
			return { data: row };
		}
		if (/^\/items\/manpower\/\d+$/.test(path)) {
			const m = db.manpower.find((x) => x.id === Number(path.split('/').pop()));
			return { data: m ?? { id: 20, nama: 'Agus' } };
		}
		if (path === '/items/project_expenses' && method === 'POST') {
			const row = { id: 500 + db.expenses.length, ...body };
			db.expenses.push(row);
			return { data: row };
		}
		if (/^\/items\/project_expenses\/\d+$/.test(path)) {
			const row = db.expenses.find((e) => e.id === Number(path.split('/').pop()));
			if (method === 'PATCH' && row) Object.assign(row, body);
			if (method === 'DELETE') db.expenses = db.expenses.filter((e) => e !== row);
			return { data: row };
		}
		if (path === '/items/activity_log') return { data: {} };
		if (/^\/items\/kiosk_proyek_perangkat\/\d+$/.test(path)) {
			const id = Number(path.split('/').pop());
			if (method === 'PATCH') { Object.assign(db.perangkat.get(id) || {}, body); return { data: {} }; }
			const row = db.perangkat.get(id);
			if (!row) throw new Error('Directus 403');
			return { data: row };
		}
		if (path === '/items/manpower_absensi' && method === 'PATCH') {
			// PATCH massal { keys, data }
			for (const k of body.keys) Object.assign(db.absensi.find((r) => r.id === k)!, body.data);
			return { data: [] };
		}
		throw new Error(`endpoint tak dikenal di fake: ${method} ${endpoint}`);
	})
}));

import { POST as absenPOST } from './absen/+server';
import { POST as absenReguPOST } from '../manpower-leader/absen-regu/+server';
import { POST as massalPOST } from '../manpower-leader/verifikasi-massal/+server';
import { GET as leaderGET } from '../manpower-leader/kiosk/+server';
import { GET as ikatGET, POST as ikatPOST } from './ikat/+server';
import { GET as rosterGET } from './roster/+server';
import { GET as manifestGET } from '../../k/[kode]/manifest.webmanifest/+server';
import { KIOSK_PROYEK_COOKIE, kodeHarian, signDeviceCookie, todayWIB } from '$lib/server/kioskProyekToken';
import { getKioskProyekSettings } from '$lib/server/kioskProyekSettings';
import { clearGateModeCache } from '$lib/server/gateDefinitionsMode';
import { resetGagal } from '$lib/server/kioskProyekLimit';

const SECRET = 'rahasia-uji-absen';
const DALAM = { lat: '-7.0', lng: '112.0' }; // tepat di titik proyek
const LUAR = { lat: '-7.1', lng: '112.1' }; // ±15 km

const jam = (utc: string) => vi.setSystemTime(new Date(`2026-10-27T${utc}:00Z`));
const PAGI = '00:42'; // 07:42 WIB
const SORE = '10:05'; // 17:05 WIB

function cookieValue(deviceId = 1) {
	return signDeviceCookie({ deviceId, projectId: PROJECT.id, ttlDays: 30 }, SECRET).value;
}

function kioskEvent(fields: Record<string, string | File>, cookie: string | null = cookieValue()) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.append(k, v);
	const jar = new Map<string, string>();
	if (cookie) jar.set(KIOSK_PROYEK_COOKIE, cookie);
	return {
		jar,
		event: {
			url: new URL('http://x/api/kiosk-proyek/absen'),
			request: new Request('http://x/api/kiosk-proyek/absen', { method: 'POST', body: fd }),
			cookies: { get: (k: string) => jar.get(k), set: (k: string, v: string) => void jar.set(k, v), delete: (k: string) => void jar.delete(k) },
			getClientAddress: () => '10.0.0.9'
		} as any
	};
}
let fotoSeq = 0;
const foto = (isi?: string) => new File([isi ?? `foto-unik-${fotoSeq++}`], 'x.jpg', { type: 'image/jpeg' });

async function panggil(fn: () => Response | Promise<Response>) {
	try {
		const r = await fn();
		return { status: r.status, body: await r.json() };
	} catch (e: any) {
		return { status: e?.status ?? 500, body: { message: e?.body?.message ?? String(e) } };
	}
}
const absen = (aksi: 'masuk' | 'pulang', lokasi = DALAM, mp = '20', f: File = foto(), cookie: string | null = cookieValue()) =>
	panggil(() => absenPOST(kioskEvent({ aksi, manpower_id: mp, ...lokasi, accuracy: '12', foto: f }, cookie).event));

beforeEach(async () => {
	vi.useFakeTimers({ toFake: ['Date'] });
	jam(PAGI);
	db.settings = { 'kiosk_proyek.aktif': 'true' };
	db.gateModes = {
		G_KSP_ABSEN_JENDELA_JAM: 'warn',
		G_KSP_ABSEN_REKAN_BATAS: 'warn',
		G_KSP_FOTO_HASH_GANDA: 'soft'
	};
	db.assignments = [
		{ id: 1, project_id: 978, manpower_id: 20, status: 'aktif', rate_harian: 200000, work_context_type: 'project', work_context_id: 978 },
		{ id: 2, project_id: 978, manpower_id: 21, status: 'aktif', rate_harian: 150000, work_context_type: 'project', work_context_id: 978 },
		// pekerja baru, SPK 2026-10-01 → jauh melewati masa sementara 3 hari kerja
		{ id: 3, project_id: 978, manpower_id: 30, status: 'menunggu_ttd', tanggal_spk: '2026-10-01', rate_harian: 100000, work_context_type: 'project', work_context_id: 978 }
	];
	db.absensi = [];
	db.expenses = [];
	db.files = [];
	uploads.length = 0;
	db.nextAbsensi = 100;
	db.nextFile = 1;
	db.nextPerangkat = 2;
	db.perangkat = new Map([[1, { id: 1, project_id: 978, label: 'Tablet pos', jenis: 'bersama', aktif: true, kedaluwarsa_pada: new Date(Date.now() + 86_400_000).toISOString() }]]);
	clearGateModeCache();
	resetGagal();
	await getKioskProyekSettings(true);
});
afterEach(() => vi.useRealTimers());

const refreshSettings = () => getKioskProyekSettings(true);

describe('absen HADIR dari kiosk', () => {
	it('di dalam radius: tercatat, metode kiosk_rekan, antrean menunggu, akrual SATU kali, tanpa penanda', async () => {
		const r = await absen('masuk');
		expect(r.status).toBe(200);
		expect(r.body).toMatchObject({ ok: true, aksi: 'masuk', sudah_ada: false, masuk_valid: true, peringatan: [], jam: '07:42' });
		const row = db.absensi[0];
		expect(row).toMatchObject({
			manpower_id: 20, project_id: 978, status: 'hadir', tanggal: '2026-10-27', masuk_valid: true,
			metode_catat: 'kiosk_rekan', verifikasi_leader_status: 'menunggu', dicatat_oleh_manpower_id: null, jam_kerja: 8
		});
		expect(row.dicatat_oleh).toBe('Kiosk#1 Tablet pos');
		expect(row.verifikasi_leader_catatan).toBe('');
		expect(row.foto_masuk).toBe('file-1');
		expect(db.expenses).toHaveLength(1);
		expect(db.expenses[0]).toMatchObject({ expense_amount: 200000, source: 'manpower_accrual', ref_absensi_id: row.id });
	});

	it('tekan HADIR dua kali = no-op: tidak ada baris/akrual/foto baru', async () => {
		await absen('masuk');
		const upload1 = uploads.length;
		const r2 = await absen('masuk');
		expect(r2.status).toBe(200);
		expect(r2.body).toMatchObject({ ok: true, sudah_ada: true });
		expect(db.absensi).toHaveLength(1);
		expect(db.expenses).toHaveLength(1);
		expect(uploads.length).toBe(upload1);
	});

	it('di luar radius: tetap tercatat tetapi masuk_valid=false (leader akan memeriksa)', async () => {
		const r = await absen('masuk', LUAR);
		expect(r.status).toBe(200);
		expect(r.body.masuk_valid).toBe(false);
		expect(db.absensi[0].masuk_valid).toBe(false);
		expect(db.absensi[0].jarak_masuk_m).toBeGreaterThan(300);
	});

	it('tidak menimpa absen yang sudah dicatat leader sebagai izin', async () => {
		db.absensi.push({ id: 7, assignment_id: 1, manpower_id: 20, project_id: 978, tanggal: '2026-10-27', status: 'izin' });
		const r = await absen('masuk');
		expect(r.status).toBe(409);
		expect(db.absensi).toHaveLength(1);
		expect(db.absensi[0].status).toBe('izin');
	});

	it('baris yang DITOLAK leader boleh diabsen ulang (keputusan lama dibersihkan)', async () => {
		db.absensi.push({ id: 7, assignment_id: 1, manpower_id: 20, project_id: 978, tanggal: '2026-10-27', status: 'hadir', verifikasi_leader_status: 'ditolak', verifikasi_leader_oleh: 10, verifikasi_leader_catatan: 'foto buram' });
		const r = await absen('masuk');
		expect(r.body).toMatchObject({ ok: true, sudah_ada: false });
		expect(db.absensi[0]).toMatchObject({ verifikasi_leader_status: 'menunggu', verifikasi_leader_oleh: null, verifikasi_leader_catatan: '' });
	});

	it('orang di luar proyek ditolak 403; masa kerja sementara lewat 423; baris terkunci 409', async () => {
		expect((await absen('masuk', DALAM, '999')).status).toBe(403);
		expect((await absen('masuk', DALAM, '30')).status).toBe(423);
		db.absensi.push({ id: 8, assignment_id: 2, manpower_id: 21, project_id: 978, tanggal: '2026-10-27', status: 'hadir', dikunci: 1 });
		expect((await absen('masuk', DALAM, '21')).status).toBe(409);
	});

	it('tanpa foto / GPS tidak valid ditolak 400', async () => {
		const tanpaFoto = await panggil(() => absenPOST(kioskEvent({ aksi: 'masuk', manpower_id: '20', ...DALAM }).event));
		expect(tanpaFoto.status).toBe(400);
		const gpsRusak = await absen('masuk', { lat: 'abc', lng: 'xyz' });
		expect(gpsRusak.status).toBe(400);
		expect(db.absensi).toHaveLength(0);
	});

	it('cookie hilang/tidak sah/perangkat dicabut/kiosk mati ditolak dengan alasan', async () => {
		expect((await absen('masuk', DALAM, '20', foto(), null)).body.reason).toBe('belum_aktif');
		db.perangkat.get(1).aktif = false;
		expect((await absen('masuk')).body.reason).toBe('perangkat_tidak_sah');
		db.perangkat.get(1).aktif = true;
		db.settings['kiosk_proyek.aktif'] = 'false';
		await refreshSettings();
		expect((await absen('masuk')).body.reason).toBe('kiosk_mati');
		expect(db.absensi).toHaveLength(0);
	});
});

describe('gate kiosk (mode dari gate_definitions)', () => {
	it('jendela jam warn → diterima + penanda; hard → ditolak 422; shadow → bersih', async () => {
		jam('06:00'); // 13:00 WIB, di luar 05:00–11:00
		const warn = await absen('masuk');
		expect(warn.status).toBe(200);
		expect(warn.body.peringatan).toEqual(['Di luar jam absen']);
		expect(db.absensi[0].verifikasi_leader_catatan).toBe('[kiosk] jendela_jam');

		db.absensi = []; db.expenses = []; clearGateModeCache();
		db.gateModes.G_KSP_ABSEN_JENDELA_JAM = 'hard';
		const hard = await absen('masuk');
		expect(hard.status).toBe(422);
		expect(db.absensi).toHaveLength(0);

		clearGateModeCache();
		db.gateModes.G_KSP_ABSEN_JENDELA_JAM = 'shadow';
		const shadow = await absen('masuk');
		expect(shadow.status).toBe(200);
		expect(shadow.body.peringatan).toEqual([]);
		expect(db.absensi[0].verifikasi_leader_catatan).toBe('');
	});

	it('batas absen-rekan: perangkat yang sama melewati batas → ditandai', async () => {
		db.settings['kiosk_proyek.absen_rekan_batas_per_hari'] = '1';
		await refreshSettings();
		const a = await absen('masuk', DALAM, '20');
		expect(a.body.peringatan).toEqual([]);
		const b = await absen('masuk', DALAM, '21');
		expect(b.status).toBe(200);
		expect(b.body.peringatan).toEqual(['Perangkat mengabsenkan banyak orang']);
		expect(db.absensi.find((r) => r.manpower_id === 21).verifikasi_leader_catatan).toBe('[kiosk] rekan_batas');
	});

	it('batas 0 = tanpa batas', async () => {
		db.settings['kiosk_proyek.absen_rekan_batas_per_hari'] = '0';
		await refreshSettings();
		await absen('masuk', DALAM, '20');
		expect((await absen('masuk', DALAM, '21')).body.peringatan).toEqual([]);
	});

	it('foto yang sama dipakai ulang: soft → ditandai; hard → ditolak', async () => {
		const sama = 'isi-foto-persis-sama';
		await absen('masuk', DALAM, '20', foto(sama));
		const dup = await absen('masuk', DALAM, '21', foto(sama));
		expect(dup.status).toBe(200);
		expect(dup.body.peringatan).toEqual(['Foto sama dengan absen lain']);

		clearGateModeCache();
		db.gateModes.G_KSP_FOTO_HASH_GANDA = 'hard';
		db.absensi = db.absensi.filter((r) => r.manpower_id !== 21);
		const hard = await absen('masuk', DALAM, '21', foto(sama));
		expect(hard.status).toBe(422);
	});

	it('gate belum terdaftar → fallback aman soft (ditandai, tidak ditolak)', async () => {
		jam('06:00');
		delete db.gateModes.G_KSP_ABSEN_JENDELA_JAM;
		clearGateModeCache();
		const r = await absen('masuk');
		expect(r.status).toBe(200);
		expect(r.body.peringatan).toEqual(['Di luar jam absen']);
	});
});

describe('absen PULANG dari kiosk', () => {
	it('melengkapi baris hadir; tidak membuat baris/akrual baru; kedua kali = no-op', async () => {
		await absen('masuk');
		jam(SORE);
		const r = await absen('pulang');
		expect(r.status).toBe(200);
		expect(r.body).toMatchObject({ ok: true, aksi: 'pulang', sudah_ada: false, jam: '17:05' });
		expect(db.absensi).toHaveLength(1);
		expect(db.absensi[0]).toMatchObject({ pulang_valid: true, foto_pulang: expect.any(String) });
		expect(db.absensi[0].jam_pulang).toBeTruthy();
		expect(db.expenses).toHaveLength(1);

		const ulang = await absen('pulang');
		expect(ulang.body.sudah_ada).toBe(true);
	});

	it('pulang tanpa absen masuk ditolak 409', async () => {
		jam(SORE);
		const r = await absen('pulang');
		expect(r.status).toBe(409);
		expect(r.body.message).toContain('Belum ada absen masuk');
	});

	it('pulang di luar radius ditandai pulang_valid=false dan baris yang sudah disetujui kembali ke antrean', async () => {
		await absen('masuk');
		db.absensi[0].verifikasi_leader_status = 'disetujui';
		jam(SORE);
		const r = await absen('pulang', LUAR);
		expect(r.body.masuk_valid).toBe(false);
		expect(db.absensi[0].pulang_valid).toBe(false);
		expect(db.absensi[0].verifikasi_leader_status).toBe('menunggu');
	});

	it('pulang pada baris legacy hadir tanpa jam_masuk tetap diterima', async () => {
		db.absensi.push({ id: 9, assignment_id: 1, manpower_id: 20, project_id: 978, tanggal: '2026-10-27', status: 'hadir', jam_masuk: null });
		jam(SORE);
		expect((await absen('pulang')).status).toBe(200);
		expect(db.absensi[0].jam_pulang).toBeTruthy();
	});
});

describe('kirim ulang aman (sinyal putus, respons hilang)', () => {
	it('PULANG dikirim ulang dengan foto yang sama saat gerbang foto HARD → no-op bersih, BUKAN ditolak "foto ganda"', async () => {
		await absen('masuk', DALAM, '20', foto('foto-masuk'));
		jam(SORE);
		clearGateModeCache();
		db.gateModes.G_KSP_FOTO_HASH_GANDA = 'hard';
		const pertama = await absen('pulang', DALAM, '20', foto('foto-pulang'));
		expect(pertama.status).toBe(200);
		expect(pertama.body.sudah_ada).toBe(false);
		const upload1 = uploads.length;

		const ulang = await absen('pulang', DALAM, '20', foto('foto-pulang')); // respons pertama "hilang" → klien kirim ulang
		expect(ulang.status).toBe(200);
		expect(ulang.body).toMatchObject({ ok: true, sudah_ada: true, peringatan: [] });
		expect(uploads.length).toBe(upload1); // tidak mengunggah lagi
		expect(db.absensi[0].verifikasi_leader_catatan).toBe('');
	});

	it('gerbang foto HARD tetap berlaku untuk PULANG pertama yang memakai foto lama (tidak dilemahkan)', async () => {
		await absen('masuk', DALAM, '20', foto('foto-sama'));
		jam(SORE);
		clearGateModeCache();
		db.gateModes.G_KSP_FOTO_HASH_GANDA = 'hard';
		const r = await absen('pulang', DALAM, '20', foto('foto-sama'));
		expect(r.status).toBe(422);
		expect(db.absensi[0].jam_pulang).toBeFalsy();
	});

	it('PULANG di luar jendela jam HARD: percobaan pertama ditolak; kirim ulang setelah sukses (jam beda) tidak ikut ditolak', async () => {
		await absen('masuk');
		jam(SORE);
		expect((await absen('pulang', DALAM, '20', foto('p1'))).status).toBe(200);
		clearGateModeCache();
		db.gateModes.G_KSP_ABSEN_JENDELA_JAM = 'hard';
		jam('16:30'); // 23:30 WIB, tanggal WIB yang sama — di luar jendela pulang (14:00–23:00)
		const ulang = await absen('pulang', DALAM, '20', foto('p1'));
		expect(ulang.status).toBe(200);
		expect(ulang.body.sudah_ada).toBe(true);
	});
});

describe('regresi jalur leader (absen-regu) memakai inti bersama', () => {
	function leaderEvent(f: Record<string, string | File>) {
		const fd = new FormData();
		for (const [k, v] of Object.entries(f)) fd.append(k, v);
		return { request: new Request('http://x/api/manpower-leader/absen-regu', { method: 'POST', body: fd }), cookies: {}, url: new URL('http://x/') } as any;
	}
	const base = { project_id: '978', assignment_id: '1', manpower_id: '20', status: 'hadir', tanggal: '2026-10-27', ...DALAM };

	it('menulis metode_catat=leader dengan identitas leader, akrual satu kali, dan MENIMPA ulang (perilaku lama)', async () => {
		const r = await panggil(() => absenReguPOST(leaderEvent({ ...base, foto: foto() })));
		expect(r.status).toBe(200);
		expect(r.body).toMatchObject({ success: true, masuk_valid: true });
		expect(db.absensi[0]).toMatchObject({ metode_catat: 'leader', dicatat_oleh: 'Budi Leader', dicatat_oleh_manpower_id: 10, verifikasi_leader_status: 'menunggu' });
		expect(db.absensi[0]).not.toHaveProperty('verifikasi_leader_catatan');
		expect(db.expenses).toHaveLength(1);

		// leader mengubah ke izin → baris yang sama ditimpa, akrual dibatalkan
		const izin = await panggil(() => absenReguPOST(leaderEvent({ ...base, status: 'izin' })));
		expect(izin.status).toBe(200);
		expect(db.absensi).toHaveLength(1);
		expect(db.absensi[0].status).toBe('izin');
		expect(db.expenses).toHaveLength(0);
	});

	it('pesan error lama dipertahankan', async () => {
		expect((await panggil(() => absenReguPOST(leaderEvent({ ...base, status: 'ngawur' })))).body.message).toContain('Status tidak dikenal');
		expect((await panggil(() => absenReguPOST(leaderEvent({ ...base, manpower_id: '10', foto: foto() })))).body.message).toContain('Absensi Anda sendiri');
		expect((await panggil(() => absenReguPOST(leaderEvent({ ...base })))).body.message).toContain('Foto bukti wajib');
		expect((await panggil(() => absenReguPOST(leaderEvent({ ...base, assignment_id: '3', manpower_id: '30', foto: foto() })))).status).toBe(423);
	});
});

describe('verifikasi massal', () => {
	const massalEvent = (ids: number[]) => ({ request: new Request('http://x/', { method: 'POST', body: JSON.stringify({ project_id: 978, ids }) }), cookies: {}, url: new URL('http://x/') }) as any;

	it('hanya baris normal yang disetujui; anomali dilewati dan TIDAK berubah', async () => {
		await absen('masuk', DALAM, '20'); // normal
		await absen('masuk', LUAR, '21'); // luar radius
		jam('06:00');
		await absen('masuk', DALAM, '20'); // no-op (sudah ada)
		const [normal, luar] = db.absensi;
		db.absensi.push({ id: 900, project_id: 978, manpower_id: 10, status: 'hadir', masuk_valid: true, verifikasi_leader_status: 'menunggu', verifikasi_leader_catatan: '' }); // milik leader sendiri
		db.absensi.push({ id: 901, project_id: 555, manpower_id: 22, status: 'hadir', masuk_valid: true, verifikasi_leader_status: 'menunggu', verifikasi_leader_catatan: '' }); // proyek lain

		const r = await panggil(() => massalPOST(massalEvent([normal.id, luar.id, 900, 901, 12345])));
		expect(r.status).toBe(200);
		expect(r.body.disetujui).toBe(1);
		expect(normal).toMatchObject({ verifikasi_leader_status: 'disetujui', verifikasi_leader_oleh: 10 });
		expect(luar.verifikasi_leader_status).toBe('menunggu');
		expect(db.absensi.find((x) => x.id === 900).verifikasi_leader_status).toBe('menunggu');
		expect(db.absensi.find((x) => x.id === 901).verifikasi_leader_status).toBe('menunggu');
		const alasan = Object.fromEntries(r.body.dilewati.map((d: any) => [d.id, d.alasan]));
		expect(alasan[luar.id]).toContain('satu per satu');
		expect(alasan[900]).toContain('sendiri');
		expect(alasan[901]).toContain('tidak ditemukan');
		expect(alasan[12345]).toContain('tidak ditemukan');
	});

	it('penanda kiosk menghalangi persetujuan massal; input kosong/terlalu banyak ditolak', async () => {
		jam('06:00');
		await absen('masuk'); // jendela warn → ada penanda
		const r = await panggil(() => massalPOST(massalEvent([db.absensi[0].id])));
		expect(r.body.disetujui).toBe(0);
		expect(db.absensi[0].verifikasi_leader_status).toBe('menunggu');
		expect((await panggil(() => massalPOST(massalEvent([])))).status).toBe(400);
		expect((await panggil(() => massalPOST(massalEvent(Array.from({ length: 201 }, (_, i) => i + 1))))).status).toBe(400);
	});
});

// ───────────────────────────── Fase 3: HP pribadi ─────────────────────────────
describe('ikat HP pribadi (kode harian) & absen diri sendiri', () => {
	const kodeHariIni = () => kodeHarian(978, todayWIB(), SECRET);
	function jsonEvent(method: 'GET' | 'POST', url: string, body?: unknown, cookie?: string) {
		const jar = new Map<string, string>();
		if (cookie) jar.set(KIOSK_PROYEK_COOKIE, cookie);
		return {
			jar,
			event: {
				url: new URL(url),
				request: new Request(url, { method, body: body !== undefined ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json' } }),
				cookies: { get: (k: string) => jar.get(k), set: (k: string, v: string) => void jar.set(k, v), delete: (k: string) => void jar.delete(k) },
				getClientAddress: () => '10.0.0.9'
			} as any
		};
	}
	const langkahKode = (kode_harian?: string, kode = 'AB12CD') =>
		panggil(() => ikatPOST(jsonEvent('POST', 'http://x/api/kiosk-proyek/ikat', { kode, langkah: 'kode', kode_harian }).event));
	async function ikatSebagai(manpowerId: number) {
		const k = await langkahKode(kodeHariIni());
		const je = jsonEvent('POST', 'http://x/api/kiosk-proyek/ikat', { kode: 'AB12CD', langkah: 'pilih', bind_token: k.body.bind_token, manpower_id: manpowerId });
		const r = await panggil(() => ikatPOST(je.event));
		return { r, cookie: je.jar.get(KIOSK_PROYEK_COOKIE) };
	}
	const rosterDengan = (cookie: string) => panggil(() => rosterGET(jsonEvent('GET', 'http://x/api/kiosk-proyek/roster?kode=AB12CD', undefined, cookie).event));

	it('kode harian salah ditolak 401; benar → token ikat + daftar nama', async () => {
		const salah = await langkahKode(kodeHariIni() === '000000' ? '111111' : '000000');
		expect(salah.status).toBe(401);
		const tanpa = await langkahKode(undefined);
		expect(tanpa.status).toBe(401);
		const ok = await langkahKode(kodeHariIni());
		expect(ok.status).toBe(200);
		expect(ok.body.kru.map((k: any) => k.nama).sort()).toEqual(['Agus', 'Cahyo', 'Dedi']);
		expect(ok.body.kru.every((k: any) => k.terikat === false)).toBe(true);
	});

	it('20 kode salah dalam 15 menit mengunci tebakan (bahkan kode benar ditolak 429) lalu terbuka sendiri', async () => {
		const salah = kodeHariIni() === '000000' ? '111111' : '000000';
		for (let i = 0; i < 20; i++) expect((await langkahKode(salah)).status).toBe(401);
		const terkunci = await langkahKode(kodeHariIni());
		expect(terkunci.status).toBe(429);
		expect(terkunci.body.message).toContain('QR');
		vi.setSystemTime(Date.now() + 16 * 60 * 1000);
		expect((await langkahKode(kodeHariIni())).status).toBe(200);
	});

	it('kode harian berganti besok (WIB): kode kemarin tidak berlaku', async () => {
		const kemarin = kodeHariIni();
		jam('18:30'); // 01:30 WIB tanggal berikutnya
		expect(kodeHariIni()).not.toBe(kemarin);
		expect((await langkahKode(kemarin)).status).toBe(401);
		expect((await langkahKode(kodeHariIni())).status).toBe(200);
	});

	it('mode kode harian nonaktif: tanpa kode tetap boleh', async () => {
		db.settings['kiosk_proyek.kode_harian_mode'] = '"nonaktif"';
		await refreshSettings();
		expect((await langkahKode(undefined)).status).toBe(200);
		const info = await panggil(() => ikatGET(jsonEvent('GET', 'http://x/api/kiosk-proyek/ikat?kode=AB12CD').event));
		expect(info.body).toMatchObject({ ok: true, project_name: 'Gresik', butuh_kode_harian: false });
	});

	it('kiosk mati / kode proyek salah ditolak', async () => {
		expect((await langkahKode(kodeHariIni(), 'ZZZZZZ')).status).toBe(404);
		db.settings['kiosk_proyek.aktif'] = 'false';
		await refreshSettings();
		expect((await langkahKode(kodeHariIni())).status).toBe(403);
	});

	it('alur penuh: ikat → roster hanya diri sendiri → absen tanpa kirim manpower_id → kiosk_mandiri', async () => {
		const { r, cookie } = await ikatSebagai(20);
		expect(r.status).toBe(200);
		expect(r.body).toMatchObject({ ok: true, nama: 'Agus', hp_lama_dicabut: 0 });
		expect(cookie).toBeTruthy();
		const dev = [...db.perangkat.values()].find((d) => d.jenis === 'pribadi');
		expect(dev).toMatchObject({ project_id: 978, manpower_id: 20, aktif: true });

		const ro = await rosterDengan(cookie!);
		expect(ro.body).toMatchObject({ ok: true, mode: 'pribadi', saya: 20 });
		expect(ro.body.roster.kru.map((k: any) => k.manpower_id)).toEqual([20]);
		expect(ro.body.roster.ringkasan.terdaftar).toBe(1);

		// HP pribadi tidak mengirim manpower_id sama sekali — identitas dari baris perangkat di server.
		const ab = await panggil(() => absenPOST(kioskEvent({ aksi: 'masuk', ...DALAM, foto: foto() }, cookie!).event));
		expect(ab.status).toBe(200);
		expect(db.absensi[0]).toMatchObject({ manpower_id: 20, metode_catat: 'kiosk_mandiri', dicatat_oleh_manpower_id: 20, masuk_valid: true });
		expect(db.expenses).toHaveLength(1);
	});

	it('HP pribadi TIDAK bisa mengabsenkan orang lain (403) dan tidak kena batas absen-rekan', async () => {
		const { cookie } = await ikatSebagai(20);
		const orangLain = await absen('masuk', DALAM, '21', foto(), cookie!);
		expect(orangLain.status).toBe(403);
		expect(db.absensi).toHaveLength(0);

		db.settings['kiosk_proyek.absen_rekan_batas_per_hari'] = '1';
		await refreshSettings();
		const idHp = [...db.perangkat.keys()].pop();
		db.absensi.push({ id: 1, project_id: 978, tanggal: '2026-10-27', dicatat_oleh: `Kiosk#${idHp} HP Agus`, manpower_id: 99 });
		const sendiri = await absen('masuk', DALAM, '20', foto(), cookie!);
		expect(sendiri.status).toBe(200);
		expect(sendiri.body.peringatan).toEqual([]);
	});

	it('nama sudah terikat ditandai; ikat ulang mencabut HP lama dan HP lama langsung ditolak', async () => {
		const pertama = await ikatSebagai(20);
		const k = await langkahKode(kodeHariIni());
		expect(k.body.kru.find((x: any) => x.manpower_id === 20).terikat).toBe(true);
		const kedua = await ikatSebagai(20);
		expect(kedua.r.body.hp_lama_dicabut).toBe(1);
		expect((await rosterDengan(pertama.cookie!)).body.reason).toBe('perangkat_tidak_sah');
		expect((await rosterDengan(kedua.cookie!)).status).toBe(200);
	});

	it('token ikat: sampah / kedaluwarsa / orang di luar proyek ditolak', async () => {
		const k = await langkahKode(kodeHariIni());
		const pilih = (bind_token: string, manpower_id: number) =>
			panggil(() => ikatPOST(jsonEvent('POST', 'http://x/api/kiosk-proyek/ikat', { kode: 'AB12CD', langkah: 'pilih', bind_token, manpower_id }).event));
		expect((await pilih('sampah.sampah', 20)).status).toBe(401);
		expect((await pilih(k.body.bind_token, 999)).status).toBe(403);
		expect((await pilih(k.body.bind_token, 0)).status).toBe(400);
		vi.setSystemTime(Date.now() + 11 * 60 * 1000);
		expect((await pilih(k.body.bind_token, 20)).status).toBe(401);
		expect([...db.perangkat.values()].filter((d) => d.jenis === 'pribadi')).toHaveLength(0);
	});

	it('leader melihat kode harian yang sama dengan server + nama pemilik HP pribadi', async () => {
		await ikatSebagai(21);
		const r = await panggil(() => leaderGET({ url: new URL('http://x/api/manpower-leader/kiosk?project_id=978'), request: new Request('http://x/'), cookies: {} } as any));
		expect(r.body.kode_harian).toBe(kodeHariIni());
		expect(r.body.kode_harian_mode).toBe('harian');
		const hp = r.body.perangkat.find((d: any) => d.jenis === 'pribadi');
		expect(hp).toMatchObject({ manpower_nama: 'Cahyo', status: 'aktif' });
	});
});

describe('manifest PWA per proyek', () => {
	it('start_url membuka kiosk proyek itu; kode tidak valid 404', async () => {
		const r = await manifestGET({ params: { kode: 'ab12cd' } } as any);
		const m = await r.json();
		expect(m).toMatchObject({ id: '/k/AB12CD', start_url: '/k/AB12CD', scope: '/k/', display: 'standalone' });
		expect(m.icons.length).toBeGreaterThanOrEqual(3);
		expect(r.headers.get('content-type')).toContain('manifest');
		expect(() => manifestGET({ params: { kode: '../x' } } as any)).toThrowError();
	});
});
