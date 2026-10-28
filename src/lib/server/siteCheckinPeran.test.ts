// Paket 04 Site Visit Release §3.6 — getPeranProyek (dipakai gate "Simpan Titik Ini").
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockJson = vi.fn();
vi.mock('$lib/server/directus', () => ({
	directusServerJson: (...a: unknown[]) => mockJson(...a),
	directusServerUpload: vi.fn()
}));

const { getPeranProyek } = await import('./siteCheckinPeran');

const has = (u: unknown, ...n: string[]) => n.every((x) => decodeURIComponent(String(u ?? '')).includes(x));

beforeEach(() => {
	mockJson.mockReset();
});

describe('getPeranProyek', () => {
	it('leader_id persis -> leader', async () => {
		mockJson.mockImplementation((u: string) => {
			if (has(u, '/items/projects/10')) return Promise.resolve({ data: { id: 10, leader_id: '5', leader: null, manpower_leader_id: null, manpower_leader_wakil_id: null } });
			throw new Error('unexpected: ' + u);
		});
		const peran = await getPeranProyek({ id: 5, nama_karyawan: 'Budi' }, { email: 'budi@x.com' }, 10);
		expect(peran).toBe('leader');
	});

	it('leader_id kosong, nama PERSIS cocok -> leader; nama SEBAGIAN (Budi vs Budi Santoso) TIDAK cocok', async () => {
		mockJson.mockImplementation((u: string) => {
			if (has(u, '/items/projects/11')) return Promise.resolve({ data: { id: 11, leader_id: null, leader: 'Budi Santoso', manpower_leader_id: null, manpower_leader_wakil_id: null } });
			if (has(u, '/items/manpower?')) return Promise.resolve({ data: [] });
			throw new Error('unexpected: ' + u);
		});
		// karyawan bernama pendek "Budi" TIDAK match "Budi Santoso" secara persis -> bukan leader
		const peranBudi = await getPeranProyek({ id: 5, nama_karyawan: 'Budi' }, { email: 'budi@x.com' }, 11);
		expect(peranBudi).toBe('kunjungan');

		const peranSantoso = await getPeranProyek({ id: 6, nama_karyawan: '  budi santoso  ' }, { email: 'santoso@x.com' }, 11);
		expect(peranSantoso).toBe('leader');
	});

	it('manpower leader/wakil via manpower_id', async () => {
		mockJson.mockImplementation((u: string) => {
			if (has(u, '/items/projects/12')) return Promise.resolve({ data: { id: 12, leader_id: null, leader: null, manpower_leader_id: '77', manpower_leader_wakil_id: null } });
			if (has(u, '/items/manpower?')) return Promise.resolve({ data: [{ id: 77 }] });
			throw new Error('unexpected: ' + u);
		});
		const peran = await getPeranProyek({ id: 5, nama_karyawan: null }, { email: 'a@x.com' }, 12);
		expect(peran).toBe('manpower_leader');
	});

	it('anggota_regu via manpower_assignment aktif', async () => {
		mockJson.mockImplementation((u: string) => {
			if (has(u, '/items/projects/13')) return Promise.resolve({ data: { id: 13, leader_id: null, leader: null, manpower_leader_id: null, manpower_leader_wakil_id: null } });
			if (has(u, '/items/manpower?')) return Promise.resolve({ data: [{ id: 88 }] });
			if (has(u, '/items/manpower_assignment')) return Promise.resolve({ data: [{ id: 1 }] });
			throw new Error('unexpected: ' + u);
		});
		const peran = await getPeranProyek({ id: 5, nama_karyawan: null }, { email: 'a@x.com' }, 13);
		expect(peran).toBe('anggota_regu');
	});

	it('tidak match apa pun -> kunjungan', async () => {
		mockJson.mockImplementation((u: string) => {
			if (has(u, '/items/projects/14')) return Promise.resolve({ data: { id: 14, leader_id: null, leader: null, manpower_leader_id: null, manpower_leader_wakil_id: null } });
			if (has(u, '/items/manpower?')) return Promise.resolve({ data: [{ id: 99 }] });
			if (has(u, '/items/manpower_assignment')) return Promise.resolve({ data: [] });
			throw new Error('unexpected: ' + u);
		});
		const peran = await getPeranProyek({ id: 5, nama_karyawan: null }, { email: 'a@x.com' }, 14);
		expect(peran).toBe('kunjungan');
	});

	it('proyek tidak ditemukan -> kunjungan (fail-closed, tidak crash)', async () => {
		mockJson.mockImplementation((u: string) => {
			if (has(u, '/items/projects/999')) return Promise.resolve({ data: null });
			throw new Error('unexpected: ' + u);
		});
		const peran = await getPeranProyek({ id: 5, nama_karyawan: null }, { email: 'a@x.com' }, 999);
		expect(peran).toBe('kunjungan');
	});
});
