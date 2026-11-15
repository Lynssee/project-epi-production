import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDirectus = vi.fn();
const mockLed = vi.fn();
vi.mock('$lib/server/firebaseAuth', () => ({ requireUser: vi.fn(async () => ({ localId: 'u1', email: 'leader@eltama.com' })) }));
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: any[]) => mockDirectus(...a) }));
vi.mock('$lib/server/projectLeaderGuard', () => ({
	resolveKaryawanByEmail: vi.fn(async () => ({ id: 241, nama_karyawan: 'YUSUF ALY' })),
	resolveLedProjectIds: (...a: any[]) => mockLed(...a)
}));

const { tutupVisit, daftarVisitBelumDitutup } = await import('./visitLeaderTutup');
const ev: any = {};
const FOTO = '0b4f1c2e-1a2b-4c3d-8e4f-123456789abc';

function route(map: Record<string, any>) {
	mockDirectus.mockImplementation(async (url: string, init?: any) => {
		if (url.includes('/items/app_settings?')) return { data: map.__settings || [] };
		for (const [frag, val] of Object.entries(map)) if (frag !== '__settings' && url.includes(frag)) return typeof val === 'function' ? val(url, init) : val;
		throw new Error('URL tak terduga: ' + url);
	});
}

beforeEach(() => {
	mockDirectus.mockReset();
	mockLed.mockReset().mockResolvedValue([877]);
});

describe('tutupVisit', () => {
	const input = { visitId: 333, kegiatan: 'Inspeksi coating area B', fotoIds: [FOTO] };

	it('visit milik saya terbuka → closed dengan jejak penutupan', async () => {
		let patch: any = null;
		route({
			'/items/project_visit_leader/333?fields': { data: { id: 333, status: 'open', karyawan_id: '241', project_id: 877 } },
			'/items/project_visit_leader/333': (_u: string, init: any) => { patch = JSON.parse(init.body); return { data: {} }; }
		});
		const r = await tutupVisit(ev, { ...input, temuan: 'DFT kurang' });
		expect(r.status).toBe('closed');
		expect(patch).toMatchObject({ status: 'closed', cara_tutup: 'leader', ditutup_oleh_karyawan_id: 241, kegiatan: 'Inspeksi coating area B', temuan: 'DFT kurang', foto_tutup: [FOTO] });
		expect(typeof patch.ditutup_pada).toBe('string');
	});

	it('kegiatan pendek / tanpa foto ditolak (min foto dari setelan)', async () => {
		route({});
		await expect(tutupVisit(ev, { ...input, kegiatan: 'x' })).rejects.toMatchObject({ status: 400 });
		await expect(tutupVisit(ev, { ...input, fotoIds: ['bukan-uuid'] })).rejects.toMatchObject({ status: 400 });
		route({ __settings: [{ setting_key: 'visit.min_foto', setting_value: '2' }] });
		await expect(tutupVisit(ev, input)).rejects.toMatchObject({ status: 400 });
	});

	it('visit sudah ditutup → 409; tidak ada → 404', async () => {
		route({ '/items/project_visit_leader/333?fields': { data: { id: 333, status: 'closed', karyawan_id: '241', project_id: 877 } } });
		await expect(tutupVisit(ev, input)).rejects.toMatchObject({ status: 409 });
		route({ '/items/project_visit_leader/333?fields': { data: null } });
		await expect(tutupVisit(ev, input)).rejects.toMatchObject({ status: 404 });
	});

	it('visit orang lain di proyek yang tidak saya pimpin → 403; proyek yang saya pimpin (visit manual admin) → boleh', async () => {
		route({ '/items/project_visit_leader/333?fields': { data: { id: 333, status: 'in_progress', karyawan_id: null, project_id: 999 } } });
		await expect(tutupVisit(ev, input)).rejects.toMatchObject({ status: 403 });
		route({
			'/items/project_visit_leader/333?fields': { data: { id: 333, status: 'in_progress', karyawan_id: null, project_id: 877 } },
			'/items/project_visit_leader/333': { data: {} }
		});
		expect((await tutupVisit(ev, input)).status).toBe('closed');
	});
});

describe('daftarVisitBelumDitutup', () => {
	it('mengembalikan visit terbuka + setelan + nama proyek; filter memuat karyawan dan proyek yang dipimpin', async () => {
		let urlVisit = '';
		route({
			'/items/project_visit_leader?': (u: string) => { urlVisit = u; return { data: [{ id: 334, project_id: 877, status: 'open', tanggal_kunjungan: '2026-11-06' }] }; },
			'/items/projects?': { data: [{ id: 877, name: 'PT. PMB' }] }
		});
		const r = await daftarVisitBelumDitutup(ev);
		expect(r.visits[0]).toMatchObject({ id: 334, project_name: 'PT. PMB' });
		expect(r.setelan.batasJam).toBe('17:00');
		expect(decodeURIComponent(urlVisit)).toContain('"karyawan_id":{"_eq":"241"}');
		expect(decodeURIComponent(urlVisit)).toContain('"project_id":{"_in":[877]}');
	});
});
