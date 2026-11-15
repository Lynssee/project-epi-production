import { describe, it, expect, vi, beforeEach } from 'vitest';

const { envMock, dirRows } = vi.hoisted(() => ({
	envMock: { DOC_VERIFY_SECRET: 'rahasia-uji-1', AUTOMATION_SERVER_SECRET: undefined, ERP_EPI1_BASE_URL: 'https://erp.test/' } as Record<string, string | undefined>,
	dirRows: {} as Record<string, any>
}));
vi.mock('$env/dynamic/private', () => ({ env: envMock }));

vi.mock('$lib/server/directus', () => ({
	directusServerJson: vi.fn(async (endpoint: string) => {
		if (dirRows.__error) throw new Error('directus mati');
		const key = Object.keys(dirRows).find((k) => endpoint.startsWith(k));
		return { data: key ? dirRows[key] : null };
	})
}));
vi.mock('$lib/server/firebaseAuth', () => ({
	requireUser: vi.fn(async (event: any) => {
		if (!event.request.headers.get('authorization')) {
			const e: any = new Error('401');
			e.status = 401;
			throw e;
		}
		return { localId: 'u1', email: 'a@b.c' };
	})
}));

import { verifyLacakSig, lacakTarget, isValidLacakId, publicLacakUrl } from '$lib/server/lacakLink';
import { parseLacakLink, lacakBridgePath } from '$lib/utils/lacakLink';
import { POST } from '../../routes/api/lacak/resolve/+server';

// VEKTOR PARITAS — nilai yang sama persis ada di erp-epi (trackingService.test.js, blok "paritas dengan project-epi").
// Jika salah satu sisi mengubah skema tanda tangan, tes di kedua repo gagal bersamaan.
const VEC = { bk5: '_sSCB4ns6fp7AVv5C0FamS', sj12: 'Sumjn6EgNIfcqLmjDebKUz', pl304: 'x11mOv0cAfHHUIKmltLlu-', mutasi15: 'fAq-oTL9_Jxh261pTBUK6j' };

import { createHmac } from 'node:crypto';
const verifyAny = (jenis: string, id: string) => createHmac('sha256', 'rahasia-uji-1').update(`doktrack:v1:${jenis}:${id}`).digest('base64url').slice(0, 22);
const ev = (body: any, auth: string | null = 'Bearer t') =>
	({ request: new Request('http://x/api/lacak/resolve', { method: 'POST', headers: auth ? { authorization: auth, 'content-type': 'application/json' } : {}, body: JSON.stringify(body) }) }) as any;

beforeEach(() => {
	envMock.DOC_VERIFY_SECRET = 'rahasia-uji-1';
	envMock.AUTOMATION_SERVER_SECRET = undefined;
	for (const k of Object.keys(dirRows)) delete dirRows[k];
});

describe('verifyLacakSig (paritas erp-epi)', () => {
	it('vektor tetap lolos; id/jenis/sig lain gagal', () => {
		expect(verifyLacakSig('sj', '12', VEC.sj12)).toBe(true);
		expect(verifyLacakSig('pl', '304', VEC.pl304)).toBe(true);
		expect(verifyLacakSig('mutasi', '15', VEC.mutasi15)).toBe(true);
		expect(verifyLacakSig('sj', '13', VEC.sj12)).toBe(false);
		expect(verifyLacakSig('pl', '12', VEC.sj12)).toBe(false);
		expect(verifyLacakSig('sj', '12', '')).toBe(false);
		expect(verifyLacakSig('bast', '12', VEC.sj12)).toBe(false);
	});
	it('fallback AUTOMATION_SERVER_SECRET; tanpa rahasia → false (tanpa kunci bawaan)', () => {
		envMock.DOC_VERIFY_SECRET = undefined;
		expect(verifyLacakSig('sj', '12', VEC.sj12)).toBe(false);
		envMock.AUTOMATION_SERVER_SECRET = 'rahasia-uji-1';
		expect(verifyLacakSig('sj', '12', VEC.sj12)).toBe(true);
	});
	it('validasi id', () => {
		expect(isValidLacakId('0')).toBe(false);
		expect(isValidLacakId('1;x')).toBe(false);
		expect(isValidLacakId('123456789012')).toBe(true);
	});
});

describe('lacakTarget', () => {
	it('sj dengan token → /scan/EPI:SJ:<id>:<token> (ter-encode); tanpa token → /lacak-sj/<id>', () => {
		expect(lacakTarget('sj', 7, { sjQrToken: 'abc' }).target).toBe('/scan/EPI%3ASJ%3A7%3Aabc');
		expect(lacakTarget('sj', 7, { sjQrToken: null }).target).toBe('/lacak-sj/7');
	});
	it('mutasi & pl', () => {
		expect(lacakTarget('mutasi', 3).target).toBe('/mutasi-barang?doc=3');
		expect(lacakTarget('bk', 5).target).toBe('/requisition/5');
		expect(lacakTarget('pl', 3, { plProjectId: 55 }).target).toBe('/packing-list?proyek=55');
		expect(lacakTarget('pl', 3, { plProjectId: null }).target).toBe('/packing-list');
		expect(lacakTarget('pl', 3, { plProjectId: -2 }).target).toBe('/packing-list');
	});
	it('publicLacakUrl memakai ERP_EPI1_BASE_URL tanpa slash ganda & menandai publik=1', () => {
		expect(publicLacakUrl('sj', '12', VEC.sj12)).toBe(`https://erp.test/lacak/sj/12?h=${VEC.sj12}&publik=1`);
	});
});

describe('jenis tanpa layar Lapangan + id UUID', () => {
	const UUID = 'fe28b068-fca4-40fe-9f8c-65e1347ab467';
	it('lacakTarget: trf/produksi/fleet → target null (publik)', () => {
		for (const j of ['trf', 'produksi', 'fleet', 'maintenance', 'komplain', 'returgudang'] as const) expect(lacakTarget(j, 1).target).toBeNull();
	});
	it('isValidLacakId: UUID hanya untuk fleet', () => {
		expect(isValidLacakId(UUID, 'fleet')).toBe(true);
		expect(isValidLacakId('12', 'fleet')).toBe(false);
		expect(isValidLacakId(UUID, 'maintenance')).toBe(true);
		expect(isValidLacakId('5', 'komplain')).toBe(true);
		expect(isValidLacakId(UUID, 'komplain')).toBe(false);
		expect(isValidLacakId(UUID, 'sj')).toBe(false);
		expect(isValidLacakId(UUID)).toBe(false);
	});
	it('parseLacakLink: UUID dan jenis baru', () => {
		expect(parseLacakLink(`https://x/lacak/fleet/${UUID}?h=${VEC.sj12}`)).toEqual({ jenis: 'fleet', id: UUID, sig: VEC.sj12 });
		expect(parseLacakLink(`/lacak/trf/1?h=${VEC.sj12}`)?.jenis).toBe('trf');
	});
	it('resolve: trf sah → external ke halaman publik; fleet UUID sah', async () => {
		const sigTrf = verifyAny('trf', '1');
		const r = await (await POST(ev({ jenis: 'trf', id: 1, sig: sigTrf }))).json();
		expect(r.external).toBe(true);
		expect(r.target).toContain('/lacak/trf/1?h=');
		expect(r.target).toContain('publik=1');
		const f = await (await POST(ev({ jenis: 'fleet', id: UUID, sig: verifyAny('fleet', UUID) }))).json();
		expect(f.external).toBe(true);
		expect(f.target).toContain(`/lacak/fleet/${UUID}?h=`);
	});
	it('resolve: UUID untuk jenis integer → 400', async () => {
		await expect(POST(ev({ jenis: 'sj', id: UUID, sig: VEC.sj12 }))).rejects.toMatchObject({ status: 400 });
	});
});

describe('parseLacakLink', () => {
	it('URL penuh, path, dan teks WhatsApp', () => {
		const p = { jenis: 'sj', id: '12', sig: VEC.sj12 };
		expect(parseLacakLink(`https://internal.eltamaprimaindo.com/lacak/sj/12?h=${VEC.sj12}`)).toEqual(p);
		expect(parseLacakLink(`/lacak/sj/12?h=${VEC.sj12}`)).toEqual(p);
		expect(parseLacakLink(`Lacak status Surat Jalan SJ/1\nhttps://x.id/lacak/sj/12?h=${VEC.sj12} terima kasih`)).toEqual(p);
		expect(parseLacakLink(`https://x.id/lacak/pl/304?foo=1&h=${VEC.pl304}&publik=1`)).toEqual({ jenis: 'pl', id: '304', sig: VEC.pl304 });
	});
	it('menolak: jenis asing, id nol, sig salah panjang, bukan teks, terlalu panjang', () => {
		expect(parseLacakLink(`/lacak/bast/12?h=${VEC.sj12}`)).toBeNull();
		expect(parseLacakLink(`/lacak/sj/0?h=${VEC.sj12}`)).toBeNull();
		expect(parseLacakLink('/lacak/sj/12?h=pendek')).toBeNull();
		expect(parseLacakLink(`/lacak/sj/12?h=${VEC.sj12}XYZ`)).toBeNull();
		expect(parseLacakLink(null)).toBeNull();
		expect(parseLacakLink('x'.repeat(2500))).toBeNull();
		expect(parseLacakLink('EPI:SJ:12:abc')).toBeNull();
	});
	it('lacakBridgePath', () => {
		expect(lacakBridgePath({ jenis: 'mutasi', id: '15', sig: VEC.mutasi15 })).toBe(`/lacak/mutasi/15?h=${VEC.mutasi15}`);
	});
});

describe('POST /api/lacak/resolve', () => {
	const ev = (body: any, auth: string | null = 'Bearer t') =>
		({ request: new Request('http://x/api/lacak/resolve', { method: 'POST', headers: auth ? { authorization: auth, 'content-type': 'application/json' } : {}, body: JSON.stringify(body) }) }) as any;

	it('wajib login (tautan publik saja tidak memberi token)', async () => {
		await expect(POST(ev({ jenis: 'sj', id: 12, sig: VEC.sj12 }, null))).rejects.toBeTruthy();
		expect(dirRows).toEqual({});
	});
	it('sig salah → 403 TANPA membaca Directus & tanpa membocorkan apa pun', async () => {
		const res = await POST(ev({ jenis: 'sj', id: 12, sig: 'x'.repeat(22) }));
		expect(res.status).toBe(403);
		expect(JSON.stringify(await res.json())).not.toContain('token');
	});
	it('jenis/id jelek → 400', async () => {
		await expect(POST(ev({ jenis: 'bast', id: 12, sig: VEC.sj12 }))).rejects.toMatchObject({ status: 400 });
		await expect(POST(ev({ jenis: 'sj', id: 'abc', sig: VEC.sj12 }))).rejects.toMatchObject({ status: 400 });
	});
	it('sj sah → target /scan dengan token dari Directus + url publik', async () => {
		dirRows['/items/surat_jalan/12'] = { id: 12, qr_token: 'tok-12' };
		const out = await (await POST(ev({ jenis: 'sj', id: 12, sig: VEC.sj12 }))).json();
		expect(out.target).toBe('/scan/EPI%3ASJ%3A12%3Atok-12');
		expect(out.publik).toContain('/lacak/sj/12?h=');
	});
	it('pl sah → /packing-list/<project>; mutasi sah → /mutasi-barang tanpa query Directus', async () => {
		dirRows['/items/packing_list/304'] = { id: 304, project_id: 9 };
		expect((await (await POST(ev({ jenis: 'pl', id: 304, sig: VEC.pl304 }))).json()).target).toBe('/packing-list?proyek=9');
		expect((await (await POST(ev({ jenis: 'mutasi', id: 15, sig: VEC.mutasi15 }))).json()).target).toBe('/mutasi-barang?doc=15');
	});
	it('bk sah → /requisition/<id> tanpa membaca Directus', async () => {
		const out = await (await POST(ev({ jenis: 'bk', id: 5, sig: VEC.bk5 }))).json();
		expect(out.target).toBe('/requisition/5');
	});
	it('dokumen tidak ada → 404; Directus mati → 503 (bukan 404)', async () => {
		await expect(POST(ev({ jenis: 'sj', id: 12, sig: VEC.sj12 }))).rejects.toMatchObject({ status: 404 });
		dirRows.__error = true;
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		await expect(POST(ev({ jenis: 'sj', id: 12, sig: VEC.sj12 }))).rejects.toMatchObject({ status: 503 });
		spy.mockRestore();
	});
});
