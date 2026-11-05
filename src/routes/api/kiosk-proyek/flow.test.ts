// Uji alur Kiosk Proyek Fase 1 end-to-end di level handler: token leader → aktivasi → cookie → roster → cabut.
// Directus diganti fake di memori; HMAC, cookie, jti sekali pakai, dan logika roster berjalan sungguhan.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { KIOSK_SESSION_SECRET: 'rahasia-uji-flow' } }));
vi.mock('$lib/server/rateLimit', () => ({ isRateLimited: vi.fn(() => false) }));
vi.mock('$lib/server/manpowerLeaderGuard', () => ({
	authenticateManpowerLeader: vi.fn(async () => ({ manpower: { id: 10, nama: 'Budi Leader' }, project: { id: 978 } }))
}));

// ---- Directus palsu ---------------------------------------------------------
const db = {
	settings: [] as any[],
	projects: new Map<number, any>(),
	perangkat: new Map<number, any>(),
	nextId: 1
};
const calls: string[] = [];

vi.mock('$lib/server/directus', () => ({
	directusServerJson: vi.fn(async (endpoint: string, opts: any = {}) => {
		const method = opts.method || 'GET';
		calls.push(`${method} ${endpoint.split('?')[0]}`);
		const body = opts.body ? JSON.parse(opts.body) : null;
		const idIn = (re: RegExp) => Number(re.exec(endpoint)?.[1]);

		if (endpoint.startsWith('/items/system_settings')) return { data: db.settings };
		if (/^\/items\/projects\/\d+/.test(endpoint)) {
			const id = idIn(/projects\/(\d+)/);
			if (method === 'PATCH') { Object.assign(db.projects.get(id), body); return { data: db.projects.get(id) }; }
			return { data: db.projects.get(id) };
		}
		if (endpoint.startsWith('/items/projects?')) {
			const kode = /kiosk_kode\]\[_eq\]=([^&]+)/.exec(endpoint)?.[1];
			return { data: [...db.projects.values()].filter((p) => p.kiosk_kode === kode) };
		}
		if (endpoint.startsWith('/items/manpower_assignment')) {
			return { data: [{ id: 1, manpower_id: 10, status: 'aktif' }, { id: 2, manpower_id: 20, status: 'aktif' }] };
		}
		if (endpoint.startsWith('/items/manpower?')) {
			return { data: [{ id: 10, nama: 'Budi Leader', posisi: 'Foreman' }, { id: 20, nama: 'Agus', posisi: 'Painter' }] };
		}
		if (endpoint.startsWith('/items/manpower/')) return { data: { id: 10, nama: 'Budi Leader' } };
		if (endpoint.startsWith('/items/manpower_absensi')) {
			return { data: [{ manpower_id: 20, status: 'hadir', jam_masuk: '2026-10-27T00:42:00Z' }] };
		}
		if (endpoint === '/items/kiosk_proyek_perangkat' && method === 'POST') {
			const id = db.nextId++;
			db.perangkat.set(id, { id, ...body });
			return { data: { id } };
		}
		if (endpoint.startsWith('/items/kiosk_proyek_perangkat?')) {
			return { data: [...db.perangkat.values()] };
		}
		if (/^\/items\/kiosk_proyek_perangkat\/\d+/.test(endpoint)) {
			const id = idIn(/perangkat\/(\d+)/);
			if (method === 'PATCH') { Object.assign(db.perangkat.get(id), body); return { data: db.perangkat.get(id) }; }
			const row = db.perangkat.get(id);
			if (!row) throw new Error('Directus 403');
			return { data: row };
		}
		throw new Error(`endpoint tak dikenal di fake: ${method} ${endpoint}`);
	})
}));

import { GET as leaderGET, POST as leaderPOST } from '../manpower-leader/kiosk/+server';
import { POST as aktivasiPOST } from './aktivasi/+server';
import { GET as rosterGET } from './roster/+server';
import { KIOSK_PROYEK_COOKIE } from '$lib/server/kioskProyekToken';

function makeEvent(opts: { url: string; method?: string; body?: unknown; cookie?: string }) {
	const jar = new Map<string, string>();
	if (opts.cookie) jar.set(KIOSK_PROYEK_COOKIE, opts.cookie);
	const url = new URL(opts.url);
	return {
		jar,
		event: {
			url,
			request: new Request(opts.url, {
				method: opts.method || 'GET',
				body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
				headers: { 'Content-Type': 'application/json' }
			}),
			cookies: {
				get: (k: string) => jar.get(k),
				set: (k: string, v: string) => void jar.set(k, v),
				delete: (k: string) => void jar.delete(k)
			},
			getClientAddress: () => '10.0.0.9'
		} as any
	};
}
async function status(fn: () => Response | Promise<Response>): Promise<{ status: number; body: any }> {
	try {
		const r = await fn();
		return { status: r.status, body: await r.json() };
	} catch (e: any) {
		return { status: e?.status ?? 500, body: { message: e?.body?.message } };
	}
}

const aktifkan = () => (db.settings = [{ setting_key: 'kiosk_proyek.aktif', setting_value: 'true' }]);

beforeEach(async () => {
	db.settings = [];
	db.projects = new Map([[978, { id: 978, name: 'Gresik', kiosk_kode: null, manpower_leader_id: 10, manpower_leader_wakil_id: null }]]);
	db.perangkat = new Map();
	db.nextId = 1;
	calls.length = 0;
	// cache setelan 5 menit di modul → paksa muat ulang tiap tes
	const { getKioskProyekSettings } = await import('$lib/server/kioskProyekSettings');
	await getKioskProyekSettings(true);
});

async function refreshSettings() {
	const { getKioskProyekSettings } = await import('$lib/server/kioskProyekSettings');
	await getKioskProyekSettings(true);
}

describe('alur Kiosk Proyek Fase 1', () => {
	it('kiosk mati (bawaan) → token leader 409, aktivasi 403, roster 403 kiosk_mati', async () => {
		const t = await status(() => leaderPOST(makeEvent({ url: 'http://x/api/manpower-leader/kiosk', method: 'POST', body: { project_id: 978, action: 'token' } }).event));
		expect(t.status).toBe(409);
		const a = await status(() => aktivasiPOST(makeEvent({ url: 'http://x/api/kiosk-proyek/aktivasi', method: 'POST', body: { kode: 'ABCDEF', token: 'x' } }).event));
		expect(a.status).toBe(403);
		const r = await status(() => rosterGET(makeEvent({ url: 'http://x/api/kiosk-proyek/roster' }).event));
		expect(r).toMatchObject({ status: 403, body: { reason: 'kiosk_mati' } });
	});

	it('alur penuh: token → aktivasi → cookie → roster → cabut → ditolak', async () => {
		aktifkan();
		await refreshSettings();

		// 1) leader meminta token; kode proyek dibuat malas
		const tk = await status(() => leaderPOST(makeEvent({ url: 'http://x/api/manpower-leader/kiosk', method: 'POST', body: { project_id: 978, action: 'token' } }).event));
		expect(tk.status).toBe(200);
		const { kode, token } = tk.body;
		expect(kode).toMatch(/^[A-Z2-9]{6}$/);
		expect(db.projects.get(978).kiosk_kode).toBe(kode);

		// 2) perangkat kiosk menukar token → cookie terpasang
		const kiosk = makeEvent({ url: 'http://x/api/kiosk-proyek/aktivasi', method: 'POST', body: { kode, token, label: 'Android · test' } });
		const ak = await status(() => aktivasiPOST(kiosk.event));
		expect(ak.status).toBe(200);
		expect(ak.body.project).toEqual({ id: 978, name: 'Gresik' });
		const cookie = kiosk.jar.get(KIOSK_PROYEK_COOKIE)!;
		expect(cookie).toBeTruthy();
		expect(db.perangkat.get(1)).toMatchObject({ project_id: 978, aktif: true, diaktifkan_oleh: 'Budi Leader', jenis: 'bersama' });

		// 3) token yang sama TIDAK bisa dipakai dua kali
		const ulang = await status(() => aktivasiPOST(makeEvent({ url: 'http://x/api/kiosk-proyek/aktivasi', method: 'POST', body: { kode, token } }).event));
		expect(ulang.status).toBe(409);

		// 4) roster dengan cookie
		const ro = await status(() => rosterGET(makeEvent({ url: `http://x/api/kiosk-proyek/roster?kode=${kode}`, cookie }).event));
		expect(ro.status).toBe(200);
		expect(ro.body.roster.ringkasan).toEqual({ terdaftar: 2, hadir: 1, belum: 1 });
		expect(ro.body.roster.project.kode).toBe(kode);

		// 5) kode proyek lain → kode_beda
		const beda = await status(() => rosterGET(makeEvent({ url: 'http://x/api/kiosk-proyek/roster?kode=ZZZZZZ', cookie }).event));
		expect(beda).toMatchObject({ status: 409, body: { reason: 'kode_beda', project_name: 'Gresik' } });

		// 6) tanpa cookie → belum_aktif
		const tanpa = await status(() => rosterGET(makeEvent({ url: 'http://x/api/kiosk-proyek/roster' }).event));
		expect(tanpa).toMatchObject({ status: 401, body: { reason: 'belum_aktif' } });

		// 7) daftar perangkat untuk leader
		const list = await status(() => leaderGET(makeEvent({ url: 'http://x/api/manpower-leader/kiosk?project_id=978' }).event));
		expect(list.body.perangkat).toHaveLength(1);
		expect(list.body.perangkat[0].status).toBe('aktif');

		// 8) leader mencabut → roster berikutnya ditolak & cookie dibersihkan
		const cb = await status(() => leaderPOST(makeEvent({ url: 'http://x/api/manpower-leader/kiosk', method: 'POST', body: { project_id: 978, action: 'cabut', id: 1 } }).event));
		expect(cb.status).toBe(200);
		const setelah = makeEvent({ url: 'http://x/api/kiosk-proyek/roster', cookie });
		const ditolak = await status(() => rosterGET(setelah.event));
		expect(ditolak).toMatchObject({ status: 401, body: { reason: 'perangkat_tidak_sah' } });
		expect(setelah.jar.has(KIOSK_PROYEK_COOKIE)).toBe(false);
	});

	it('token dari proyek lain / kode salah ditolak, dan tidak membuat perangkat', async () => {
		aktifkan();
		await refreshSettings();
		db.projects.set(555, { id: 555, name: 'Lain', kiosk_kode: 'LAIN22' });
		const tk = await status(() => leaderPOST(makeEvent({ url: 'http://x/api/manpower-leader/kiosk', method: 'POST', body: { project_id: 978, action: 'token' } }).event));
		const salah = await status(() => aktivasiPOST(makeEvent({ url: 'http://x/api/kiosk-proyek/aktivasi', method: 'POST', body: { kode: 'LAIN22', token: tk.body.token } }).event));
		expect(salah.status).toBe(401);
		const sampah = await status(() => aktivasiPOST(makeEvent({ url: 'http://x/api/kiosk-proyek/aktivasi', method: 'POST', body: { kode: tk.body.kode, token: 'sampah.sampah' } }).event));
		expect(sampah.status).toBe(401);
		expect(db.perangkat.size).toBe(0);
	});

	it('roster di-cache sesuai setelan: panggilan kedua tidak menembak Directus lagi untuk kru', async () => {
		aktifkan();
		await refreshSettings();
		const tk = await status(() => leaderPOST(makeEvent({ url: 'http://x/api/manpower-leader/kiosk', method: 'POST', body: { project_id: 978, action: 'token' } }).event));
		const kiosk = makeEvent({ url: 'http://x/api/kiosk-proyek/aktivasi', method: 'POST', body: { kode: tk.body.kode, token: tk.body.token } });
		await aktivasiPOST(kiosk.event);
		const cookie = kiosk.jar.get(KIOSK_PROYEK_COOKIE)!;
		await rosterGET(makeEvent({ url: 'http://x/api/kiosk-proyek/roster', cookie }).event);
		const sebelum = calls.filter((c) => c.includes('manpower_assignment')).length;
		await rosterGET(makeEvent({ url: 'http://x/api/kiosk-proyek/roster', cookie }).event);
		expect(calls.filter((c) => c.includes('manpower_assignment')).length).toBe(sebelum); // cache kena
	});
});
