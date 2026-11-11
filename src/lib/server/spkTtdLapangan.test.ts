import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';

const h = vi.hoisted(() => ({ db: null as any, scope: null as any }));

function freshDb() {
	return {
		settings: [{ setting_key: 'manpower.spk_doc.ttd_link_aktif', setting_value: 'true' }],
		assignment: {
			7: { id: 7, manpower_id: 3, project_id: 9, status: 'menunggu_ttd', rate_tipe: 'borongan' },
			8: { id: 8, manpower_id: 4, project_id: 9, status: 'aktif', rate_tipe: 'harian' },
			9: { id: 9, manpower_id: 6, project_id: 9, status: 'batal', rate_tipe: 'harian' },
			10: { id: 10, manpower_id: 5, project_id: 77, status: 'aktif', rate_tipe: 'harian' }
		} as Record<number, any>,
		links: [] as any[],
		next: 1,
		calls: [] as string[]
	};
}

function fake(endpoint: string, opts: any = {}) {
	const method = opts.method || 'GET';
	const body = opts.body ? JSON.parse(opts.body) : null;
	const db = h.db;
	db.calls.push(`${method} ${endpoint}`);
	let m: RegExpExecArray | null;
	if (/^\/items\/system_settings\?/.test(endpoint)) return { data: db.settings };
	if (/^\/items\/app_settings\?/.test(endpoint)) return { data: [] };
	if (/^\/items\/manpower_assignment\?/.test(endpoint)) {
		const pid = /filter\[project_id\]\[_eq\]=(\d+)/.exec(endpoint)?.[1];
		const mid = /filter\[manpower_id\]\[_eq\]=(\d+)/.exec(endpoint)?.[1];
		return { data: Object.values(db.assignment).filter((x: any) => String(x.project_id) === pid && String(x.manpower_id) === mid && x.status !== 'batal').map((x: any) => ({ id: x.id })) };
	}
	if ((m = /^\/items\/manpower_assignment\/(\d+)/.exec(endpoint))) {
		const a = db.assignment[Number(m[1])];
		if (method === 'PATCH') { Object.assign(a, body); return { data: a }; }
		return { data: a ? { ...a } : null };
	}
	if (method === 'POST' && endpoint === '/items/manpower_akses_link') {
		const row = { id: db.next++, ...body };
		db.links.push(row);
		return { data: row };
	}
	if ((m = /^\/items\/manpower_akses_link\/(\d+)/.exec(endpoint))) {
		const l = db.links.find((x: any) => x.id === Number(m![1]));
		if (method === 'PATCH') { Object.assign(l, body); return { data: l }; }
		return { data: l };
	}
	if (/^\/items\/manpower_akses_link\?/.test(endpoint)) {
		const aid = /filter\[assignment_id\]\[_eq\]=(\d+)/.exec(endpoint)?.[1];
		const mp = /filter\[manpower_id\]\[_eq\]=(\d+)/.exec(endpoint)?.[1];
		const rows = db.links.filter((l: any) => String(l.assignment_id) === aid && (!mp || String(l.manpower_id) === mp));
		return { data: endpoint.includes('dicabut][_eq]=false') ? rows.filter((l: any) => !l.dicabut).map((l: any) => ({ id: l.id })) : rows };
	}
	throw new Error('fake directus: tak dikenal ' + method + ' ' + endpoint);
}

vi.mock('$env/dynamic/private', () => ({ env: { ERP_EPI1_BASE_URL: 'https://erp.test/' } }));
vi.mock('./directus', () => ({ directusServerJson: vi.fn(async (e: string, o?: any) => fake(e, o)) }));
vi.mock('./firebaseAuth', () => ({ requireUser: vi.fn(async () => ({ uid: 'u1', email: 'pl@epi' })) }));
vi.mock('./fieldProjectScope', () => ({ resolveFieldProjectScope: vi.fn(async () => h.scope) }));

const svc = await import('./spkTtdLapangan');
const sha = (v: string) => createHash('sha256').update(v).digest('hex');
const evt = { request: { headers: { get: () => 'Bearer tok123' } } } as any;

beforeEach(() => {
	h.db = freshDb();
	h.scope = { unrestricted: false, projectIds: [9] };
	svc.resetSettingsCache();
});

describe('pengaman fitur', () => {
	it('flag mati → 409 tanpa menyentuh koleksi tautan/penugasan; daftar → aktif:false', async () => {
		h.db.settings = [];
		await expect(svc.buatLink(h.db.assignment[7], { mode: 'link', oleh: 'pl' })).rejects.toMatchObject({ status: 409 });
		await expect(svc.dispensasi(h.db.assignment[7], 'alasan cukup panjang', 'pl')).rejects.toMatchObject({ status: 409 });
		await expect(svc.cabutSemua(7)).rejects.toMatchObject({ status: 409 });
		expect((await svc.daftarLink(7)).aktif).toBe(false);
		expect(h.db.calls.some((c: string) => /manpower_akses_link|PATCH/.test(c))).toBe(false);
	});
	it('gagal baca setelan → fail-closed', async () => {
		const { directusServerJson } = await import('./directus');
		(directusServerJson as any).mockRejectedValueOnce(new Error('down'));
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(svc.buatLink(h.db.assignment[7], { mode: 'link', oleh: 'pl' })).rejects.toMatchObject({ status: 409 });
		spy.mockRestore();
	});
});

describe('buatLink', () => {
	it('token hanya tersimpan sebagai hash; URL menunjuk domain ERP; format sama dengan erp-epi', async () => {
		const out = await svc.buatLink(h.db.assignment[7], { mode: 'link', oleh: 'pl@epi' });
		const token = new URL(out.url).searchParams.get('t')!;
		const row = h.db.links[0];
		expect(out.url.startsWith(`https://erp.test/akses-manpower/${out.id}?t=`)).toBe(true);
		expect(token).toMatch(/^[0-9a-f]{48}$/);
		expect(row.token_hash).toBe(sha(token));
		expect(JSON.stringify(row)).not.toContain(token);
		expect(row).toMatchObject({ tipe: 'spk_ttd', assignment_id: 7, manpower_id: 3, varian_dokumen: 'lengkap', mode: 'link', sekali_pakai: true, dibuat_oleh: 'pl@epi', dicabut: false });
		const hari = (new Date(row.kedaluwarsa).getTime() - Date.now()) / 86400000;
		expect(hari).toBeGreaterThan(6.9);
		expect(hari).toBeLessThan(7.1);
	});
	it('mode kiosk tercatat; masa berlaku mengikuti setelan', async () => {
		h.db.settings.push({ setting_key: 'manpower.spk_doc.link_ttl_hari', setting_value: '3' });
		svc.resetSettingsCache();
		const out = await svc.buatLink(h.db.assignment[7], { mode: 'kiosk_pl', oleh: 'pl' });
		expect(h.db.links[0].mode).toBe('kiosk_pl');
		expect(out.hari).toBe(3);
	});
	it('kirim ulang mencabut tautan lama', async () => {
		const a = await svc.buatLink(h.db.assignment[7], { mode: 'link', oleh: 'pl' });
		const b = await svc.buatLink(h.db.assignment[7], { mode: 'link', oleh: 'pl' });
		expect(h.db.links.find((l: any) => l.id === a.id).dicabut).toBe(true);
		expect(h.db.links.find((l: any) => l.id === b.id).dicabut).toBe(false);
	});
	it('menolak SPK sudah TTD / bukan menunggu_ttd / batal / mode salah / tanpa manpower', async () => {
		for (const status of ['aktif', 'selesai', 'draft', 'batal']) {
			await expect(svc.buatLink({ ...h.db.assignment[7], status }, { mode: 'link', oleh: 'pl' })).rejects.toMatchObject({ status: 409 });
		}
		await expect(svc.buatLink({ ...h.db.assignment[7], ttd_manpower: 'f' }, { mode: 'link', oleh: 'pl' })).rejects.toMatchObject({ status: 409 });
		await expect(svc.buatLink(h.db.assignment[7], { mode: 'x' as any, oleh: 'pl' })).rejects.toMatchObject({ status: 400 });
		await expect(svc.buatLink({ ...h.db.assignment[7], manpower_id: null }, { mode: 'link', oleh: 'pl' })).rejects.toMatchObject({ status: 400 });
	});
});

describe('otorisasiPenugasan (batas proyek, fail-closed)', () => {
	it('pemegang proyek lolos; proyek lain → 403; role lintas proyek lolos; penugasan tak ada → 404', async () => {
		await expect(svc.otorisasiPenugasan(evt, 7)).resolves.toMatchObject({ oleh: 'pl@epi' });
		h.scope = { unrestricted: false, projectIds: [1, 2] };
		await expect(svc.otorisasiPenugasan(evt, 7)).rejects.toMatchObject({ status: 403 });
		h.scope = { unrestricted: false, projectIds: [] };
		await expect(svc.otorisasiPenugasan(evt, 7)).rejects.toMatchObject({ status: 403 });
		h.scope = { unrestricted: true };
		await expect(svc.otorisasiPenugasan(evt, 7)).resolves.toBeTruthy();
		await expect(svc.otorisasiPenugasan(evt, 999)).rejects.toMatchObject({ status: 404 });
	});
});

describe('dispensasi & cabut', () => {
	it('alasan ≥10 karakter; SPK aktif tanpa file TTD, jejak lengkap, tautan dicabut; tak bisa diulang', async () => {
		await svc.buatLink(h.db.assignment[7], { mode: 'link', oleh: 'pl' });
		await expect(svc.dispensasi(h.db.assignment[7], 'singkat', 'pl')).rejects.toMatchObject({ status: 400 });
		await svc.dispensasi(h.db.assignment[7], 'Mandor tanpa sinyal di lokasi', 'pl@epi');
		expect(h.db.assignment[7]).toMatchObject({ status: 'aktif', ttd_via: 'dispensasi', ttd_dispensasi_alasan: 'Mandor tanpa sinyal di lokasi' });
		expect(h.db.assignment[7].ttd_nama).toContain('pl@epi');
		expect(h.db.assignment[7].ttd_manpower).toBeUndefined();
		expect(h.db.links[0].dicabut).toBe(true);
		await expect(svc.dispensasi(h.db.assignment[7], 'sekali lagi alasan panjang', 'pl')).rejects.toMatchObject({ status: 409 });
	});
	it('cabutSemua mencabut tautan aktif dan melaporkan jumlahnya', async () => {
		await svc.buatLink(h.db.assignment[7], { mode: 'link', oleh: 'pl' });
		expect(await svc.cabutSemua(7)).toEqual({ dicabut: 1 });
		expect((await svc.cabutSemua(7)).dicabut).toBe(0);
	});
	it('daftarLink mengembalikan riwayat saat aktif', async () => {
		await svc.buatLink(h.db.assignment[7], { mode: 'link', oleh: 'pl' });
		const r = await svc.daftarLink(7);
		expect(r.aktif).toBe(true);
		expect(r.links).toHaveLength(1);
	});
});

describe('pakta kru (varian tanpa_harga)', () => {
	it('anggota proyek yang sama → tautan spk_syarat untuk kru itu; tidak mencabut tautan TTD pemilik SPK', async () => {
		const spkPemilik = await svc.buatLink(h.db.assignment[7], { mode: 'link', oleh: 'pl' });
		const pakta = await svc.buatLink(h.db.assignment[7], { mode: 'link', oleh: 'pl', varian: 'tanpa_harga', manpowerId: 4 });
		const row = h.db.links.find((l: any) => l.id === pakta.id);
		expect(row).toMatchObject({ tipe: 'spk_syarat', manpower_id: 4, assignment_id: 7, varian_dokumen: 'tanpa_harga' });
		expect(h.db.links.find((l: any) => l.id === spkPemilik.id).dicabut).toBe(false);
	});
	it('bukan anggota proyek / dibatalkan / tak dikenal → 403 tanpa membuat tautan', async () => {
		for (const manpowerId of [5, 6, 999]) {
			await expect(svc.buatLink(h.db.assignment[7], { mode: 'link', oleh: 'pl', varian: 'tanpa_harga', manpowerId })).rejects.toMatchObject({ status: 403 });
		}
		expect(h.db.links).toHaveLength(0);
	});
	it('pakta tidak butuh SPK berstatus menunggu_ttd; mode kiosk ditolak untuk pakta', async () => {
		const aktif = { ...h.db.assignment[7], status: 'aktif' };
		await expect(svc.buatLink(aktif, { mode: 'link', oleh: 'pl', varian: 'tanpa_harga', manpowerId: 4 })).resolves.toBeTruthy();
		await expect(svc.buatLink(h.db.assignment[7], { mode: 'kiosk_pl', oleh: 'pl', varian: 'tanpa_harga', manpowerId: 4 })).rejects.toMatchObject({ status: 400 });
		await expect(svc.buatLink({ ...h.db.assignment[7], status: 'batal' }, { mode: 'link', oleh: 'pl', varian: 'tanpa_harga', manpowerId: 4 })).rejects.toMatchObject({ status: 409 });
	});
});
