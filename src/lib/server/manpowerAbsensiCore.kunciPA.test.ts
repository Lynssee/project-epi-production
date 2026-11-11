// Kunci lunak absensi selama PA upah berjalan di pintu server (absen regu / kiosk).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ mode: 'warn' as any, pam: [] as any[], pas: [] as any[], calls: [] as string[] }));

vi.mock('@sveltejs/kit', () => ({
	error: (status: number, message: string) => Object.assign(new Error(message), { status })
}));
vi.mock('$lib/server/ess/geo', () => ({ withinRadius: vi.fn() }));
vi.mock('$lib/server/directus', () => ({
	directusServerUpload: vi.fn(),
	directusServerJson: vi.fn(async (path: string) => {
		m.calls.push(path);
		if (path.startsWith('/items/system_settings')) return { data: m.mode == null ? [] : [{ setting_value: JSON.stringify(m.mode) }] };
		if (path.startsWith('/items/pengajuan_anggaran_manpower')) return { data: m.pam };
		if (path.startsWith('/items/pengajuan_anggaran?')) return { data: m.pas };
		return { data: [] };
	})
}));

import { cekKunciPAServer } from './manpowerAbsensiCore';

const PAM = [{ id: 1, assignment_id: 7, pengajuan_anggaran_id: 70, periode_dari: '2026-10-01', periode_sampai: '2026-10-10' }];

describe('cekKunciPAServer', () => {
	beforeEach(() => { m.mode = 'warn'; m.pam = PAM; m.pas = [{ id: 70, nomor_pengajuan: 'PA-2610-0070', status: 'Pending' }]; m.calls = []; });

	it('PA Pending meliputi hari itu -> bentrok dengan nomor PA', async () => {
		const r = await cekKunciPAServer(7, '2026-10-05');
		expect(r.mode).toBe('warn');
		expect(r.bentrok?.nomor).toBe('PA-2610-0070');
	});
	it('PA sudah ditolak -> tidak menagih, tidak bentrok', async () => {
		m.pas = [{ id: 70, nomor_pengajuan: 'PA-2610-0070', status: 'Rejected' }];
		expect((await cekKunciPAServer(7, '2026-10-05')).bentrok).toBeNull();
	});
	it("mode 'off' -> berhenti setelah membaca setelan (tanpa query PA)", async () => {
		m.mode = 'off';
		const r = await cekKunciPAServer(7, '2026-10-05');
		expect(r.bentrok).toBeNull();
		expect(m.calls.some((c) => c.startsWith('/items/pengajuan_anggaran'))).toBe(false);
	});
	it('mode block dibaca dari setelan', async () => {
		m.mode = 'block';
		expect((await cekKunciPAServer(7, '2026-10-05')).mode).toBe('block');
	});
	it('tanpa rincian yang meliputi hari itu -> hanya 2 query (setelan + rincian), PA tidak dibaca', async () => {
		m.pam = [];
		const r = await cekKunciPAServer(7, '2026-10-05');
		expect(r.bentrok).toBeNull();
		expect(m.calls).toHaveLength(2);
	});
	it('setelan kosong / nilai rusak -> default warn (tidak diam-diam mengunci)', async () => {
		m.mode = null;
		expect((await cekKunciPAServer(7, '2026-10-05')).mode).toBe('warn');
		m.mode = 'keras';
		expect((await cekKunciPAServer(7, '2026-10-05')).mode).toBe('warn');
	});
});
