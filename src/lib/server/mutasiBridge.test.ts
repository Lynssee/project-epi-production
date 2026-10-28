// RSM-13 — jembatan lapangan → erp-epi: konfigurasi, header secret, passthrough error, timeout/jaringan.
import { describe, it, expect, vi, beforeEach } from 'vitest';

let envMock: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({
	get env() {
		return envMock;
	}
}));
vi.mock('$lib/server/firebaseAuth', () => ({ requireUser: vi.fn() }));
vi.mock('$lib/server/projectLeaderGuard', () => ({ resolveKaryawanByEmail: vi.fn() }));

const { panggilMutasiErp } = await import('./mutasiBridge');

const resp = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
	envMock = { ERP_EPI1_BASE_URL: 'https://erp.example/', AUTOMATION_SERVER_SECRET: 's3cret' };
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('panggilMutasiErp', () => {
	it('mengirim secret + karyawan_id + op ke endpoint automation, tanpa slash ganda', async () => {
		const f = vi.fn(async () => resp(200, { success: true, data: [] }));
		const r = await panggilMutasiErp(42, 'daftar', { project_id: 5 }, { fetchImpl: f as any });
		expect(r).toEqual({ success: true, data: [] });
		const [url, init] = f.mock.calls[0] as any;
		expect(url).toBe('https://erp.example/api/automation/mutasi-barang');
		expect(init.headers['x-automation-secret']).toBe('s3cret');
		expect(JSON.parse(init.body)).toEqual({ project_id: 5, op: 'daftar', karyawan_id: 42 });
	});
	it('env belum diisi → 503 dengan petunjuk, tanpa memanggil jaringan', async () => {
		envMock = {};
		const f = vi.fn();
		await expect(panggilMutasiErp(1, 'status', {}, { fetchImpl: f as any })).rejects.toMatchObject({ status: 503 });
		expect(f).not.toHaveBeenCalled();
	});
	it('ERP menolak (mis. 409 SELF_APPROVAL) → pesan & status diteruskan ke pengguna', async () => {
		const f = vi.fn(async () => resp(403, { message: 'Anda tidak boleh menyetujui pengajuan sendiri.' }));
		await expect(panggilMutasiErp(1, 'aksi', { id: 3 }, { fetchImpl: f as any })).rejects.toMatchObject({ status: 403, body: { message: 'Anda tidak boleh menyetujui pengajuan sendiri.' } });
	});
	it('ERP 500 → 502 (bukan membocorkan 500 mentah)', async () => {
		const f = vi.fn(async () => resp(500, { message: 'boom' }));
		await expect(panggilMutasiErp(1, 'daftar', {}, { fetchImpl: f as any })).rejects.toMatchObject({ status: 502 });
	});
	it('jaringan putus → 503 pesan jelas dan dicatat', async () => {
		const f = vi.fn(async () => {
			throw new Error('ECONNREFUSED');
		});
		await expect(panggilMutasiErp(1, 'daftar', {}, { fetchImpl: f as any })).rejects.toMatchObject({ status: 503 });
		expect(console.error).toHaveBeenCalled();
	});
});
