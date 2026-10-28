// src/lib/server/rbacServer.ts
// SERVER-ONLY. Resolve permission efektif user dari Firestore, memakai
// Firestore REST API dengan ID token milik user itu sendiri (bukan admin
// SDK / service account) — tunduk pada Security Rules yang sama seperti
// client SDK di src/routes/+layout.svelte, jadi tidak perlu kredensial admin
// baru. Firestore project sama dengan erp-epi-1 (koleksi users/roles dibagi).

import { error, type RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { directusServerJson } from './directus';

const PROJECT_ID = env.FIREBASE_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID;
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

function parseFirestoreValue(v: any): any {
	if (v == null) return null;
	if ('stringValue' in v) return v.stringValue;
	if ('booleanValue' in v) return v.booleanValue;
	if ('integerValue' in v) return Number(v.integerValue);
	if ('doubleValue' in v) return v.doubleValue;
	if ('arrayValue' in v) return (v.arrayValue.values || []).map(parseFirestoreValue);
	if ('mapValue' in v) return parseFirestoreFields(v.mapValue.fields || {});
	return null;
}

function parseFirestoreFields(fields: Record<string, any>): Record<string, any> {
	const out: Record<string, any> = {};
	for (const [k, v] of Object.entries(fields || {})) out[k] = parseFirestoreValue(v);
	return out;
}

async function getFirestoreDoc(idToken: string, path: string): Promise<Record<string, any> | null> {
	const res = await fetch(`${FIRESTORE_BASE}/${path}`, {
		headers: { Authorization: `Bearer ${idToken}` }
	});
	if (!res.ok) return null;
	const body = await res.json().catch(() => null);
	if (!body?.fields) return null;
	return parseFirestoreFields(body.fields);
}

function toFirestoreValue(v: any): any {
	if (v === null || v === undefined) return { nullValue: null };
	if (typeof v === 'string') return { stringValue: v };
	if (typeof v === 'boolean') return { booleanValue: v };
	if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
	if (v instanceof Date) return { timestampValue: v.toISOString() };
	if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
	if (typeof v === 'object') return { mapValue: { fields: toFirestoreFields(v) } };
	return { stringValue: String(v) };
}

function toFirestoreFields(obj: Record<string, any>): Record<string, any> {
	const out: Record<string, any> = {};
	for (const [k, v] of Object.entries(obj)) out[k] = toFirestoreValue(v);
	return out;
}

/** Buat dokumen baru (auto-ID) di sebuah koleksi, pakai token milik user (bukan admin SDK). */
async function createFirestoreDoc(idToken: string, collectionPath: string, fields: Record<string, any>): Promise<void> {
	await fetch(`${FIRESTORE_BASE}/${collectionPath}`, {
		method: 'POST',
		headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' },
		body: JSON.stringify({ fields: toFirestoreFields(fields) })
	});
}

const CACHE_TTL_MS = 60_000;
type JabatanRef = { id: number; nama: string };
type PermResult = {
	/** Firestore users/{uid}.roleId || role — ARTI TIDAK BERUBAH (dipakai hseGuard, fieldProjectScope, search, AI). */
	roleId: string | null;
	/** posisi.role_slug jabatan utama (mis. 'security'), null bila tidak ada. Selaras erp-epi-1. */
	roleSlug: string | null;
	/** Jabatan Directus yang izinnya ikut dihitung (untuk pesan error & log). */
	jabatan: JabatanRef[];
	permissions: string[];
	enforcementMode: 'log' | 'enforce';
	enforcedPermissions: string[];
	/** Jejak sumber izin, untuk diagnosa (bukan untuk logika akses). */
	sources: string[];
};
const permCache = new Map<string, PermResult & { exp: number }>();

// ── Indeks Directus `posisi` (unifikasi role & jabatan, selaras erp-epi-1 positionPermissions.js) ──
type PosisiRbac = { id: number; nama: string; permissions: string[]; roleSlug: string | null };
type PosisiIndex = { byId: Map<string, PosisiRbac>; byName: Map<string, PosisiRbac[]> };
const POSISI_CACHE_TTL_MS = 5 * 60_000;
let posisiIndexCache: { exp: number; index: PosisiIndex } | null = null;
let posisiIndexInflight: Promise<PosisiIndex> | null = null;

/** Reset cache modul — hanya untuk test. */
export function __resetRbacCachesForTest(): void {
	permCache.clear();
	posisiIndexCache = null;
	posisiIndexInflight = null;
}

async function loadPosisiIndex(): Promise<PosisiIndex> {
	if (posisiIndexCache && posisiIndexCache.exp > Date.now()) return posisiIndexCache.index;
	if (posisiIndexInflight) return posisiIndexInflight;
	posisiIndexInflight = (async () => {
		const res = await directusServerJson<{ data: any[] }>(
			'/items/posisi?fields=id,nama_posisi,permissions,role_slug&limit=-1'
		);
		const byId = new Map<string, PosisiRbac>();
		const byName = new Map<string, PosisiRbac[]>();
		for (const p of res?.data || []) {
			const row: PosisiRbac = {
				id: Number(p.id),
				nama: String(p.nama_posisi || ''),
				permissions: Array.isArray(p.permissions) ? p.permissions : [],
				roleSlug: p.role_slug || null
			};
			byId.set(String(row.id), row);
			const key = row.nama.trim().toUpperCase();
			if (key) byName.set(key, [...(byName.get(key) || []), row]);
		}
		const index = { byId, byName };
		posisiIndexCache = { exp: Date.now() + POSISI_CACHE_TTL_MS, index };
		return index;
	})().finally(() => {
		posisiIndexInflight = null;
	});
	return posisiIndexInflight;
}

type KaryawanRbac = { id: number; posisi: string | null; jabatan_id: number | { id: number } | null };
const KARYAWAN_RBAC_FIELDS = 'id,posisi,jabatan_id';

async function getKaryawanRbac(uid: string, email?: string | null): Promise<KaryawanRbac | null> {
	const byUid = encodeURIComponent(JSON.stringify({ firebase_uid: { _eq: uid } }));
	const res = await directusServerJson<{ data: KaryawanRbac[] }>(
		`/items/karyawan?filter=${byUid}&fields=${KARYAWAN_RBAC_FIELDS}&limit=1`
	);
	if (res?.data?.[0]) return res.data[0];
	if (!email) return null;
	const lower = String(email).trim().toLowerCase();
	const byEmail = encodeURIComponent(
		JSON.stringify({ _or: [{ login_email: { _eq: lower } }, { email_company: { _eq: lower } }, { email: { _eq: lower } }] })
	);
	const res2 = await directusServerJson<{ data: KaryawanRbac[] }>(
		`/items/karyawan?filter=${byEmail}&fields=${KARYAWAN_RBAC_FIELDS}&limit=1`
	);
	return res2?.data?.[0] || null;
}

const isPosisiId = (v: unknown) => /^\d+$/.test(String(v ?? '').trim());

/**
 * Resolve permission efektif user. Sumber (union, hanya menambah):
 *  1. Directus posisi.permissions — jabatan dari karyawan.jabatan_id → Firestore jabatanId → nama karyawan.posisi (unik)
 *     + setiap roleIds[] yang berupa id posisi
 *  2. Firestore roles/{id} untuk roleId/roleIds non-numerik (perilaku lama, dipertahankan)
 *  3. rbac_config.mandatoryFeatures
 * `roleId` tetap Firestore roleId (arti lama). Super admin → ['*'].
 * @param opts.email email login (opsional) — dipakai bila karyawan belum tertaut firebase_uid.
 */
export async function getUserPermissions(
	idToken: string,
	uid: string,
	opts: { email?: string | null } = {}
): Promise<PermResult> {
	const cached = permCache.get(uid);
	if (cached && cached.exp > Date.now()) {
		const { exp, ...rest } = cached;
		return rest;
	}

	// Ambil paralel — masing-masing berdiri sendiri (relasi dipisah, tanpa nested field).
	const [userDoc, configDoc, karyawanRes, posisiRes] = await Promise.all([
		getFirestoreDoc(idToken, `users/${uid}`),
		getFirestoreDoc(idToken, 'rbac_config/main').catch(() => null),
		getKaryawanRbac(uid, opts.email).then(
			(v) => ({ ok: true as const, v }),
			(e) => ({ ok: false as const, e })
		),
		loadPosisiIndex().then(
			(v) => ({ ok: true as const, v }),
			(e) => ({ ok: false as const, e })
		)
	]);

	// Rencana RBAC v2: satu baca rbac_config dipakai untuk fitur wajib DAN mode penegakan.
	const mandatoryFeatures: string[] = Array.isArray(configDoc?.mandatoryFeatures) ? configDoc.mandatoryFeatures : [];
	const enforcementMode: 'log' | 'enforce' = configDoc?.enforcementMode === 'enforce' ? 'enforce' : 'log';
	const enforcedPermissions: string[] = Array.isArray(configDoc?.enforcedPermissions) ? configDoc.enforcedPermissions : [];

	const roleId: string | null = userDoc?.roleId || userDoc?.role || null;
	const legacyRoleIds: string[] = Array.isArray(userDoc?.roleIds) ? userDoc.roleIds.map(String) : [];
	const sources: string[] = [];
	const directusOk = karyawanRes.ok && posisiRes.ok;
	if (!karyawanRes.ok) console.error('[rbacServer] Gagal baca karyawan untuk RBAC', { uid, err: String(karyawanRes.e) });
	if (!posisiRes.ok) console.error('[rbacServer] Gagal baca indeks posisi untuk RBAC', { uid, err: String(posisiRes.e) });

	const karyawan = karyawanRes.ok ? karyawanRes.v : null;
	const idx = posisiRes.ok ? posisiRes.v : null;

	// ── 1. Jabatan Directus ──
	const jabatanIds = new Set<string>();
	if (idx) {
		const kj = karyawan?.jabatan_id;
		const karyawanJab = kj == null ? null : String(typeof kj === 'object' ? kj.id : kj);
		if (karyawanJab && idx.byId.has(karyawanJab)) {
			jabatanIds.add(karyawanJab);
			sources.push(`karyawan.jabatan_id=${karyawanJab}`);
		} else if (userDoc?.jabatanId != null && idx.byId.has(String(userDoc.jabatanId))) {
			jabatanIds.add(String(userDoc.jabatanId));
			sources.push(`firestore.jabatanId=${userDoc.jabatanId}`);
		} else if (karyawan?.posisi) {
			const matches = idx.byName.get(String(karyawan.posisi).trim().toUpperCase()) || [];
			if (matches.length === 1) {
				jabatanIds.add(String(matches[0].id));
				sources.push(`karyawan.posisi="${karyawan.posisi}"→${matches[0].id}`);
			} else if (matches.length > 1) {
				console.warn('[rbacServer] Nama posisi ganda, tidak dipetakan — isi karyawan.jabatan_id', {
					uid,
					posisi: karyawan.posisi,
					kandidat: matches.map((m) => m.id)
				});
			}
		}
		for (const rid of legacyRoleIds) {
			if (isPosisiId(rid) && idx.byId.has(rid) && !jabatanIds.has(rid)) {
				jabatanIds.add(rid);
				sources.push(`firestore.roleIds=${rid}`);
			}
		}
	}
	const jabatanRows = idx ? [...jabatanIds].map((id) => idx.byId.get(id)!).filter(Boolean) : [];

	// ── Super admin ──
	const isSuperAdmin =
		userDoc?.isSuperAdmin === true ||
		roleId === 'super_admin' ||
		legacyRoleIds.includes('super_admin') ||
		jabatanRows.some((j) => j.permissions.includes('*') || j.roleSlug === 'super_admin');

	const base = {
		roleId: isSuperAdmin ? 'super_admin' : roleId,
		roleSlug: jabatanRows[0]?.roleSlug ?? null,
		jabatan: jabatanRows.map((j) => ({ id: j.id, nama: j.nama })),
		enforcementMode,
		enforcedPermissions
	};

	let result: PermResult;
	if (isSuperAdmin) {
		result = { ...base, permissions: ['*'], sources: [...sources, 'super_admin'] };
	} else {
		const perms = new Set<string>();
		for (const j of jabatanRows) for (const p of j.permissions) perms.add(p);

		// ── 2. Firestore roles lama (non-numerik) — perilaku lama dipertahankan ──
		const legacyIds = [...new Set([roleId, ...legacyRoleIds].filter((v): v is string => !!v && !isPosisiId(v)))];
		const legacyDocs = await Promise.all(legacyIds.map((id) => getFirestoreDoc(idToken, `roles/${id}`)));
		legacyDocs.forEach((doc, i) => {
			if (Array.isArray(doc?.permissions) && doc.permissions.length) {
				doc.permissions.forEach((p: string) => perms.add(p));
				sources.push(`firestore.roles/${legacyIds[i]}`);
			}
		});

		// ── 3. Fitur wajib ──
		for (const p of mandatoryFeatures) perms.add(p);

		result = { ...base, permissions: [...perms], sources };
		if (result.permissions.length === mandatoryFeatures.length) {
			console.warn('[rbacServer] Izin efektif hanya fitur wajib — cek jabatan karyawan', { uid, roleId, sources });
		}
	}

	// Jangan cache hasil saat Directus gagal → pulih otomatis begitu Directus normal.
	if (directusOk) permCache.set(uid, { ...result, exp: Date.now() + CACHE_TTL_MS });
	return result;
}

export function hasAnyPermission(permissions: string[], required: string | string[]): boolean {
	if (permissions.includes('*')) return true;
	const list = Array.isArray(required) ? required : [required];
	return list.some((p) => permissions.includes(p));
}

/**
 * Rencana RBAC v2, Fase 4 (Bagian 10 "Jejak audit"): catat setiap keputusan
 * izin yang gagal -- baik yang diloloskan lewat mode "log" (would-deny)
 * maupun yang sungguh ditolak (denied) -- ke koleksi rbac_access_log
 * (dibagi dengan erp-epi-1). Fire-and-forget: kegagalan mencatat TIDAK
 * BOLEH menggagalkan permintaan aslinya.
 */
function logAccessDecision(
	idToken: string,
	entry: { uid: string; email?: string | null; path?: string; method?: string; required: string[]; result: 'would-deny' | 'denied' }
): void {
	createFirestoreDoc(idToken, 'rbac_access_log', { ...entry, email: entry.email ?? null, createdAt: new Date() }).catch((e) =>
		console.warn('[rbacServer] Gagal mencatat rbac_access_log:', e)
	);
}

/**
 * Wrapper mode-aware setara requirePermission.js di erp-epi-1, siap dipakai
 * endpoint project-epi (opsional -- endpoint yang sudah ada masih memakai
 * hasAnyPermission() langsung; ini infrastruktur untuk migrasi bertahap,
 * bukan migrasi endpoint yang sudah ada).
 * @param event SvelteKit RequestEvent
 * @param uid Firebase UID pemanggil (dari requireUser)
 * @param requiredPermission satu atau lebih permission, salah satu cukup
 */
export async function requirePermission(
	event: RequestEvent,
	uid: string,
	requiredPermission: string | string[]
): Promise<PermResult> {
	const authHeader = event.request.headers.get('authorization') || '';
	const idToken = authHeader.replace(/^Bearer\s+/i, '');
	const required = Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission];

	const result = await getUserPermissions(idToken, uid);
	const authorized = hasAnyPermission(result.permissions, required);

	if (!authorized) {
		const shouldEnforce = result.enforcementMode === 'enforce' || required.some((p) => result.enforcedPermissions.includes(p));
		logAccessDecision(idToken, {
			uid,
			path: event.url?.pathname,
			method: event.request?.method,
			required,
			result: shouldEnforce ? 'denied' : 'would-deny'
		});
		if (shouldEnforce) {
			throw error(403, 'Anda tidak punya izin untuk aksi ini.');
		}
	}

	return result;
}
