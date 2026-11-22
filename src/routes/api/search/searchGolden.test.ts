// src/routes/api/search/searchGolden.test.ts
// Fase 6: Golden Test E2E (server-side handler & permission) untuk Dashboard Lapangan.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockUser = { localId: 'u_field_1', uid: 'u_field_1', email: 'leader@eltamaprimaindo.com' };
let mockRoleId = 'project_leader';
let mockPerms: string[] = ['access_ess', 'view_own_projects', 'input_laporan'];

vi.mock('$lib/server/firebaseAuth', () => ({
	requireUser: vi.fn(async () => mockUser)
}));

vi.mock('$lib/server/rbacServer', () => ({
	getUserPermissions: vi.fn(async () => ({ roleId: mockRoleId, permissions: mockPerms }))
}));

vi.mock('$lib/server/searchService', () => ({
	runSearch: vi.fn(async () => [])
}));

vi.mock('$lib/server/searchLogging', () => ({
	logSearchAnalytics: vi.fn(),
	logSearchAuditIfSensitive: vi.fn()
}));

vi.mock('$lib/server/directus', () => ({
	directusServerJson: vi.fn(async (endpoint: string) => {
		if (endpoint.includes('/items/app_settings')) return { data: [] };
		if (endpoint.includes('/items/company_identity')) {
			return {
				data: [
					{
						id: 1,
						nama_badan_hukum: 'PT. Eltama Prima Indo',
						visi: 'Menjadi mitra jasa coating dan pengecatan industri terpercaya.',
						misi: ['Mutu sesuai spesifikasi.', 'Keselamatan utama.'],
						motto: 'Presisi di Setiap Lapisan'
					}
				]
			};
		}
		if (endpoint.includes('/items/company_core_values')) {
			return { data: [{ id: 1, kode: 'K', judul: 'Keselamatan Utama', arti_singkat: 'Pulang selamat.', aktif: 1 }] };
		}
		return { data: [] };
	})
}));

import { GET } from './+server';

function makeEvent(urlStr: string) {
	return {
		url: new URL(urlStr, 'http://localhost'),
		request: new Request(new URL(urlStr, 'http://localhost'), {
			headers: { authorization: 'Bearer mock-token' }
		}),
		getClientAddress: () => '127.0.0.1'
	} as any;
}

describe('Fase 6: Golden E2E & Security Verification (project-epi)', () => {
	beforeEach(() => {
		mockRoleId = 'project_leader';
		mockPerms = ['access_ess', 'view_own_projects', 'input_laporan'];
	});

	it('user lapangan berizin access_ess menemukan /ess/budaya & konten Visi/Misi', async () => {
		const res = await GET(makeEvent('http://localhost/api/search?q=visi+misi'));
		const body = await res.json();
		const urls = body.groups.flatMap((g: any) => g.results.map((r: any) => r.url));
		expect(urls).toContain('/ess/budaya');
		expect(body.groups.some((g: any) => g.entity === 'Budaya & Identitas Perusahaan')).toBe(true);
	});

	it('user tanpa access_ess tidak mendapat rute ESS privat di Menu & Halaman Lainnya', async () => {
		mockRoleId = 'guest';
		mockPerms = [];
		const res = await GET(makeEvent('http://localhost/api/search?q=visi+misi'));
		const body = await res.json();
		const navGroup = body.groups.find((g: any) => g.entity === 'Menu & Halaman Lainnya');
		expect(navGroup).toBeUndefined();
	});

	it('typo "rport" menemukan Daily General Report (/laporan/general)', async () => {
		const res = await GET(makeEvent('http://localhost/api/search?q=rport'));
		const body = await res.json();
		const urls = body.groups.flatMap((g: any) => g.results.map((r: any) => r.url));
		expect(urls).toContain('/laporan/general');
	});
});
