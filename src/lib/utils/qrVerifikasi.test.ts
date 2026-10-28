import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/firebase', () => ({ auth: { currentUser: { getIdToken: async () => 'TOK' } } }));
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async (u: string) => 'data:image/png;base64,' + btoa(u)) } }));

import { requestVerifyUrl, buatQrVerifikasi } from './qrVerifikasi';

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });

const okFetch = (body: any, status = 200) => vi.fn(async () => ({ ok: status < 400, status, json: async () => body })) as any;

describe('requestVerifyUrl', () => {
	it('POST ke /api/verifikasi/sign dengan token Firebase dan mengembalikan url', async () => {
		const f = okFetch({ url: 'https://p/verifikasi/pa/5?s=abc' });
		expect(await requestVerifyUrl('pa', 5, f)).toBe('https://p/verifikasi/pa/5?s=abc');
		const [path, opt] = f.mock.calls[0];
		expect(path).toBe('/api/verifikasi/sign');
		expect(opt.method).toBe('POST');
		expect(opt.headers.Authorization).toBe('Bearer TOK');
		expect(JSON.parse(opt.body)).toEqual({ jenis: 'pa', id: 5 });
	});
	it('ditolak (403/503) / respons tanpa url / jaringan putus -> null dengan peringatan, tidak melempar', async () => {
		expect(await requestVerifyUrl('pa', 5, okFetch({}, 403))).toBeNull();
		expect(await requestVerifyUrl('pa', 5, okFetch({}, 503))).toBeNull();
		expect(await requestVerifyUrl('pa', 5, okFetch({ url: '' }))).toBeNull();
		expect(await requestVerifyUrl('pa', 5, vi.fn(async () => { throw new Error('offline'); }) as any)).toBeNull();
		expect(console.warn).toHaveBeenCalled();
	});
});

describe('buatQrVerifikasi', () => {
	it('mengembalikan data-URI QR dan url bila server menerbitkan tautan', async () => {
		vi.stubGlobal('fetch', okFetch({ url: 'https://p/verifikasi/pa/5?s=abc' }));
		const r = await buatQrVerifikasi('pa', 5);
		expect(r?.verifyUrl).toBe('https://p/verifikasi/pa/5?s=abc');
		expect(r?.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
	});
	it('server menolak -> null (slip tetap tercetak tanpa QR)', async () => {
		vi.stubGlobal('fetch', okFetch({}, 403));
		expect(await buatQrVerifikasi('pa', 5)).toBeNull();
	});
});
