import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: { FIREBASE_PROJECT_ID: 'test-proj' } }));
vi.mock('@sveltejs/kit', () => ({ error: vi.fn() }));
const directusServerJson = vi.fn();
vi.mock('./directus', () => ({ directusServerJson: (...a: any[]) => directusServerJson(...a) }));

import { __resetRbacCachesForTest, getUserPermissions } from './rbacServer';

// ── Helper: dokumen Firestore REST ──
const fsVal = (v: any): any =>
	typeof v === 'string' ? { stringValue: v }
	: typeof v === 'boolean' ? { booleanValue: v }
	: typeof v === 'number' ? { integerValue: String(v) }
	: Array.isArray(v) ? { arrayValue: { values: v.map(fsVal) } }
	: { stringValue: String(v) };
const fsDoc = (obj: Record<string, any>) => ({ fields: Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, fsVal(v)])) });

let firestore: Record<string, Record<string, any> | null> = {};
const fetchMock = vi.fn(async (url: string) => {
	const path = String(url).split('/documents/')[1];
	const doc = firestore[path];
	if (!doc) return { ok: false, json: async () => null } as any;
	return { ok: true, json: async () => fsDoc(doc) } as any;
});
vi.stubGlobal('fetch', fetchMock);

const POSISI = [
	{ id: 24, nama_posisi: 'SECURITY', role_slug: 'security', permissions: ['access_ess', 'access_security', 'gate_log'] },
	{ id: 13, nama_posisi: 'SATPAM', role_slug: null, permissions: ['access_security', 'patrol_scan'] },
	{ id: 3, nama_posisi: 'MANAGER', role_slug: null, permissions: ['m3'] },
	{ id: 11, nama_posisi: 'MANAGER', role_slug: null, permissions: ['m11'] },
	{ id: 1, nama_posisi: 'SUPER', role_slug: null, permissions: ['*'] }
];

let karyawan: any = null;
function setupDirectus(opts: { fail?: boolean } = {}) {
	directusServerJson.mockImplementation(async (endpoint: string) => {
		if (opts.fail) throw new Error('Directus down');
		if (endpoint.startsWith('/items/posisi')) return { data: POSISI };
		if (endpoint.startsWith('/items/karyawan')) {
			if (endpoint.includes(encodeURIComponent('"firebase_uid"'))) return { data: karyawan?.byUid ? [karyawan.byUid] : [] };
			return { data: karyawan?.byEmail ? [karyawan.byEmail] : [] };
		}
		return { data: [] };
	});
}
const countCalls = (prefix: string) => directusServerJson.mock.calls.filter((c: any[]) => String(c[0]).startsWith(prefix)).length;

beforeEach(() => {
	vi.restoreAllMocks();
	__resetRbacCachesForTest();
	directusServerJson.mockReset();
	fetchMock.mockClear();
	firestore = { 'users/u1': { roleId: 'staff' } };
	karyawan = { byUid: { id: 370, posisi: 'SECURITY', jabatan_id: 24 } };
	setupDirectus();
	vi.spyOn(console, 'warn').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('getUserPermissions — posisi Directus', () => {
	it('1. jabatan_id=24, roles/staff tidak ada → izin posisi, roleId tetap Firestore', async () => {
		const r = await getUserPermissions('t', 'u1');
		expect(r.permissions).toEqual(expect.arrayContaining(['gate_log', 'access_security']));
		expect(r.roleId).toBe('staff');
		expect(r.roleSlug).toBe('security');
		expect(r.jabatan).toEqual([{ id: 24, nama: 'SECURITY' }]);
	});
	it('2. jabatan_id kosong → pakai Firestore jabatanId', async () => {
		karyawan = { byUid: { id: 1, posisi: null, jabatan_id: null } };
		firestore['users/u1'] = { roleId: 'staff', jabatanId: 24 };
		const r = await getUserPermissions('t', 'u1');
		expect(r.permissions).toContain('gate_log');
		expect(r.sources).toContain('firestore.jabatanId=24');
	});
	it('3. keduanya kosong → cocok nama posisi unik', async () => {
		karyawan = { byUid: { id: 1, posisi: ' security ', jabatan_id: null } };
		const r = await getUserPermissions('t', 'u1');
		expect(r.jabatan[0].id).toBe(24);
	});
	it('4. nama ganda (MANAGER) → tidak dipetakan, warn, tidak crash', async () => {
		karyawan = { byUid: { id: 1, posisi: 'MANAGER', jabatan_id: null } };
		const r = await getUserPermissions('t', 'u1');
		expect(r.jabatan).toEqual([]);
		expect(console.warn).toHaveBeenCalled();
	});
	it('5. roleIds [24, satpam] → union posisi + roles/satpam', async () => {
		karyawan = { byUid: { id: 1, posisi: null, jabatan_id: null } };
		firestore['users/u1'] = { roleId: 'staff', roleIds: ['24', 'satpam'] };
		firestore['roles/satpam'] = { permissions: ['extra_perm'] };
		const r = await getUserPermissions('t', 'u1');
		expect(r.permissions).toEqual(expect.arrayContaining(['gate_log', 'extra_perm']));
	});
	it('6. isSuperAdmin → [*] dan roleId super_admin', async () => {
		firestore['users/u1'] = { roleId: 'staff', isSuperAdmin: true };
		const r = await getUserPermissions('t', 'u1');
		expect(r.permissions).toEqual(['*']);
		expect(r.roleId).toBe('super_admin');
	});
	it('7. posisi dengan permissions [*] → [*]', async () => {
		karyawan = { byUid: { id: 1, posisi: null, jabatan_id: 1 } };
		const r = await getUserPermissions('t', 'u1');
		expect(r.permissions).toEqual(['*']);
	});
	it('8. Directus gagal → fallback Firestore lama, error dilog, TIDAK di-cache', async () => {
		setupDirectus({ fail: true });
		firestore['roles/staff'] = { permissions: ['legacy'] };
		const r = await getUserPermissions('t', 'u1');
		expect(r.permissions).toEqual(['legacy']);
		expect(console.error).toHaveBeenCalled();
		const before = countCalls('/items/karyawan');
		await getUserPermissions('t', 'u1');
		expect(countCalls('/items/karyawan')).toBeGreaterThan(before);
	});
	it('9. mandatoryFeatures ikut masuk', async () => {
		firestore['rbac_config/main'] = { mandatoryFeatures: ['access_ess_wajib'] };
		const r = await getUserPermissions('t', 'u1');
		expect(r.permissions).toContain('access_ess_wajib');
	});
	it('10. dua panggilan uid sama → Directus & Firestore sekali (cache 60 dtk)', async () => {
		await getUserPermissions('t', 'u1');
		const f = fetchMock.mock.calls.length;
		const k = countCalls('/items/karyawan');
		await getUserPermissions('t', 'u1');
		expect(fetchMock.mock.calls.length).toBe(f);
		expect(countCalls('/items/karyawan')).toBe(k);
	});
	it('11. dua uid berbeda → /items/posisi hanya sekali', async () => {
		firestore['users/u2'] = { roleId: 'staff' };
		await getUserPermissions('t', 'u1');
		await getUserPermissions('t', 'u2');
		expect(countCalls('/items/posisi')).toBe(1);
	});
	it('12. karyawan tak ketemu by uid + email → query kedua _or email lowercase', async () => {
		karyawan = { byUid: null, byEmail: { id: 370, posisi: 'SECURITY', jabatan_id: 24 } };
		const r = await getUserPermissions('t', 'u1', { email: ' Yoga@EltamaPrimaIndo.com ' });
		expect(r.jabatan[0].id).toBe(24);
		const q = decodeURIComponent(directusServerJson.mock.calls.find((c: any[]) => String(c[0]).includes('_or'))![0]);
		expect(q).toContain('yoga@eltamaprimaindo.com');
	});
});
