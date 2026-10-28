// src/lib/server/gerbangSj/actor.ts
// GSP-02 — satu pintu identitas & hak akses untuk ketiga layar gerbang SJ.
//   cookie kiosk            → sumber 'kiosk' (badge+PIN, menu gerbang_sj)
//   Bearer + X-Gerbang-Sumber: erp (+ tanda tangan HMAC dari proxy ERP) → sumber 'erp'
//   Bearer Firebase lain    → sumber 'app' (wajib punya peran satpam)

import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { error, json, type RequestEvent } from '@sveltejs/kit';
import { KIOSK_COOKIE_NAME, requireKioskSession } from '../kioskAuth';
import { requireKioskMenu } from '../kioskMenuAccess';
import { verifyFirebaseToken } from '../firebaseAuth';
import { getUserPermissions, hasAnyPermission } from '../rbacServer';
import { getKaryawanByFirebaseUid } from '../approvalSubmit';
import { resolveKaryawanByEmail } from '../ess/karyawan';
import { GateError, type GateActor, type GateSumber } from './types';

const SIG_MAX_SKEW_MS = 120_000;
export const APP_PERMISSIONS = ['access_security', 'gate_log', 'admin_panel'];

export const labelOf = (sumber: GateSumber, nama: string) => `${sumber.toUpperCase()}/${nama}`;

/** Tanda tangan proxy ERP: HMAC-SHA256(secret, `${uid}|${ts}`) hex. Dipakai proxy ERP (membuat) & di sini (memeriksa). */
export function signProxy(secret: string, uid: string, ts: number | string): string {
	return createHmac('sha256', secret).update(`${uid}|${ts}`).digest('hex');
}

export function verifyProxySignature(secret: string | undefined, uid: string, ts: string | null, sig: string | null, now = Date.now()): boolean {
	if (!secret || !uid || !ts || !sig) return false;
	const t = Number(ts);
	if (!Number.isFinite(t) || Math.abs(now - t) > SIG_MAX_SKEW_MS) return false;
	const expected = Buffer.from(signProxy(secret, uid, ts));
	const given = Buffer.from(sig);
	return expected.length === given.length && timingSafeEqual(expected, given);
}

export async function resolveGateActor(event: RequestEvent): Promise<GateActor> {
	// 1) Kiosk (cookie badge+PIN)
	if (event.cookies.get(KIOSK_COOKIE_NAME)) {
		const session = requireKioskSession(event);
		await requireKioskMenu(session.karyawanId, 'gerbang_sj', 'Gerbang Satpam');
		return { sumber: 'kiosk', karyawanId: session.karyawanId, nama: session.nama, email: null, label: labelOf('kiosk', session.nama) };
	}

	// 2) Bearer Firebase
	const header = event.request.headers.get('authorization') || '';
	const token = header.startsWith('Bearer ') ? header.slice(7) : null;
	if (!token) throw new GateError(401, 'BELUM_LOGIN', 'Silakan login ulang.');
	const user = await verifyFirebaseToken(token);
	if (!user) throw new GateError(401, 'BELUM_LOGIN', 'Sesi tidak valid atau kedaluwarsa. Silakan login ulang.');

	const karyawan =
		(await getKaryawanByFirebaseUid(user.localId).catch(() => null)) ||
		(user.email ? await resolveKaryawanByEmail(user.email).catch(() => null) : null);
	if (!karyawan?.id) throw new GateError(403, 'TIDAK_ADA_AKSES', 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');
	const nama = String(karyawan.nama_karyawan || user.email || user.localId);

	const fromErp = (event.request.headers.get('x-gerbang-sumber') || '').toLowerCase() === 'erp';
	if (fromErp) {
		const ok = verifyProxySignature(
			env.GERBANG_PROXY_SECRET, user.localId, event.request.headers.get('x-gerbang-ts'), event.request.headers.get('x-gerbang-sig')
		);
		if (!ok) throw new GateError(403, 'TIDAK_ADA_AKSES', 'Permintaan dari ERP tidak sah.');
		return { sumber: 'erp', karyawanId: karyawan.id, nama, email: user.email || null, label: labelOf('erp', nama) };
	}

	const perms = await getUserPermissions(token, user.localId, { email: user.email });
	if (!hasAnyPermission(perms.permissions, APP_PERMISSIONS)) {
		const jab = (perms.jabatan || []).map((j) => j.nama).join(', ');
		console.warn('[gerbangSj] akses ditolak', { uid: user.localId, karyawanId: karyawan.id, roleId: perms.roleId, sources: perms.sources });
		throw new GateError(
			403,
			'TIDAK_ADA_AKSES',
			jab
				? `Jabatan Anda (${jab}) belum punya izin Gerbang Satpam. Minta admin menambahkan izin "gate_log" pada jabatan tersebut di menu Jabatan & Hak Akses ERP.`
				: 'Data jabatan Anda belum diisi di HRD. Minta admin HRD mengisi jabatan karyawan Anda (mis. SECURITY), lalu muat ulang halaman.'
		);
	}
	return { sumber: 'app', karyawanId: karyawan.id, nama, email: user.email || null, label: labelOf('app', nama) };
}

/** Bungkus handler route: GateError → JSON seragam `{ ok:false, kode, pesan, blockers }`. */
export async function gateRoute(fn: () => Promise<Response>): Promise<Response> {
	try {
		return await fn();
	} catch (e) {
		if (e instanceof GateError) return json(e.toJSON(), { status: e.status });
		// error() SvelteKit (kiosk guard dll) → ubah ke bentuk seragam
		const st = (e as any)?.status;
		const body = (e as any)?.body?.message;
		if (typeof st === 'number' && st >= 400 && st < 600 && body) {
			return json({ ok: false, kode: st === 401 ? 'BELUM_LOGIN' : st === 403 ? 'TIDAK_ADA_AKSES' : 'INPUT_TIDAK_VALID', pesan: String(body), blockers: [] }, { status: st });
		}
		console.error('[gerbangSj] error tak terduga:', e);
		return json({ ok: false, kode: 'INPUT_TIDAK_VALID', pesan: 'Terjadi kesalahan di server. Coba lagi.', blockers: [] }, { status: 500 });
	}
}

/** Legacy wrapper: ubah GateError menjadi error() SvelteKit agar bentuk respons endpoint lama tetap sama. */
export function toKitError(e: unknown): never {
	if (e instanceof GateError) throw error(e.status, e.pesan);
	throw e;
}
