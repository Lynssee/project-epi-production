import { describe, it, expect, vi, beforeEach } from 'vitest';

const dx = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: any[]) => dx(...a) }));
vi.mock('$lib/server/firebaseAuth', () => ({ requireUser: async () => ({ localId: 'u', email: 'a@x.id' }) }));
const { POST, _ringkasAgen: ringkasAgen } = await import('./+server');

const call = async (body: any, ua = 'Mozilla/5.0 (Linux; Android 11; SM-A125F) AppleWebKit/537.36 Chrome/118.0.0.0 Mobile Safari/537.36') =>
	(await (POST as any)({ request: { json: async () => body, headers: new Headers({ 'user-agent': ua }) } })).json();

beforeEach(() => {
	dx.mockReset();
	dx.mockResolvedValue({ data: {} });
});

describe('ringkasAgen', () => {
	it('OS + browser tanpa build panjang', () => {
		expect(ringkasAgen('Mozilla/5.0 (Linux; Android 11; SM-A125F) AppleWebKit/537.36 Chrome/118.0.0.0 Mobile Safari/537.36')).toBe('Android 11 · Chrome 118');
		expect(ringkasAgen(null)).toBeNull();
	});
});

describe('POST /api/preventive/foto-telemetri', () => {
	it('menulis baris tanpa data pribadi (tidak ada user/unit/isi foto)', async () => {
		const r = await call({ tier: 'utama', durasi_ms: 3200.4, ukuran_asal_kb: 5200, ukuran_hasil_kb: 310, perangkat_lemah: true, jaringan: 'slow', konteks: 'p2h-item', user: 'rahasia', equipment_id: 'e1' });
		expect(r.ok).toBe(true);
		const body = JSON.parse(dx.mock.calls[0][1].body);
		expect(body).toEqual({ tier: 'utama', durasi_ms: 3200, ukuran_asal_kb: 5200, ukuran_hasil_kb: 310, perangkat_lemah: true, jaringan: 'slow', agen: 'Android 11 · Chrome 118', konteks: 'p2h-item' });
	});
	it('tier tidak valid → 400; angka liar/negatif → null; konteks asing → null', async () => {
		await expect(call({ tier: 'x' })).rejects.toMatchObject({ status: 400 });
		await call({ tier: 'gagal', durasi_ms: -5, ukuran_asal_kb: 9e12, konteks: 'lain' });
		expect(JSON.parse(dx.mock.calls[0][1].body)).toMatchObject({ durasi_ms: null, ukuran_asal_kb: null, konteks: null });
	});
	it('gagal menulis Directus tidak melempar (fail-soft)', async () => {
		dx.mockRejectedValue(new Error('down'));
		expect(await call({ tier: 'asli' })).toEqual({ ok: false });
	});
});
