// src/lib/server/kioskProyekToken.ts
// Rencana Kiosk Proyek, Fase 1 — token aktivasi (QR di HP leader) & cookie perangkat.
// Fungsi MURNI: rahasia dilempar sebagai argumen supaya mudah dites dan tidak mengimpor $env.
// Pemanggil (kioskProyekDevice.ts) mengambil rahasia lewat kioskProyekSecret().
//
// Pemisahan konteks: tiap token diberi prefix HMAC berbeda ("kp-act" / "kp-dev"), jadi token
// aktivasi tidak bisa dipakai sebagai cookie perangkat dan keduanya tidak bisa dipakai sebagai
// sesi kiosk workshop (kioskAuth.ts) walau rahasianya sama (KIOSK_SESSION_SECRET).

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const KIOSK_PROYEK_COOKIE = 'epi_kiosk_proyek';

export interface ActivationPayload {
	p: number; // project_id
	l: number; // manpower_id leader yang menampilkan QR
	j: string; // jti — sekali pakai
	exp: number; // epoch ms
}

export interface DevicePayload {
	d: number; // kiosk_proyek_perangkat.id
	p: number; // project_id
	exp: number; // epoch ms
}

type Konteks = 'kp-act' | 'kp-dev' | 'kp-bind';

function sign(context: Konteks, body: string, secret: string): string {
	return createHmac('sha256', secret).update(`${context}:${body}`).digest('base64url');
}

function seal(context: Konteks, payload: object, secret: string): string {
	const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
	return `${body}.${sign(context, body, secret)}`;
}

function unseal<T extends { exp: number }>(context: Konteks, token: unknown, secret: string, now: number): T | null {
	if (typeof token !== 'string' || token.length > 2048) return null;
	const [body, sig, extra] = token.split('.');
	if (!body || !sig || extra !== undefined) return null;
	try {
		const expected = sign(context, body, secret);
		if (sig.length !== expected.length) return null;
		if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
		const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as T;
		if (!payload || typeof payload.exp !== 'number' || payload.exp < now) return null;
		return payload;
	} catch {
		return null;
	}
}

export function signActivationToken(
	input: { projectId: number; leaderManpowerId: number; ttlSeconds: number },
	secret: string,
	now = Date.now()
): { token: string; jti: string; exp: number } {
	const jti = randomBytes(9).toString('base64url');
	const exp = now + Math.max(10, input.ttlSeconds) * 1000;
	const payload: ActivationPayload = { p: input.projectId, l: input.leaderManpowerId, j: jti, exp };
	return { token: seal('kp-act', payload, secret), jti, exp };
}

export function verifyActivationToken(token: unknown, secret: string, now = Date.now()): ActivationPayload | null {
	const p = unseal<ActivationPayload>('kp-act', token, secret, now);
	if (!p || !Number.isInteger(p.p) || !Number.isInteger(p.l) || typeof p.j !== 'string') return null;
	return p;
}

export function signDeviceCookie(
	input: { deviceId: number; projectId: number; ttlDays: number },
	secret: string,
	now = Date.now()
): { value: string; exp: number } {
	const exp = now + Math.max(1, input.ttlDays) * 86_400_000;
	const payload: DevicePayload = { d: input.deviceId, p: input.projectId, exp };
	return { value: seal('kp-dev', payload, secret), exp };
}

export function verifyDeviceCookie(value: unknown, secret: string, now = Date.now()): DevicePayload | null {
	const p = unseal<DevicePayload>('kp-dev', value, secret, now);
	if (!p || !Number.isInteger(p.d) || !Number.isInteger(p.p)) return null;
	return p;
}

// ---------------------------------------------------------------- Fase 3: HP pribadi

/** Token pendek hasil lolos kode harian: izin untuk memilih nama & mengikat HP (bukan identitas perangkat). */
export interface BindPayload {
	p: number; // project_id
	exp: number;
}

export function signBindToken(input: { projectId: number; ttlSeconds: number }, secret: string, now = Date.now()): { token: string; exp: number } {
	const exp = now + Math.max(30, input.ttlSeconds) * 1000;
	return { token: seal('kp-bind', { p: input.projectId, exp } satisfies BindPayload, secret), exp };
}

export function verifyBindToken(token: unknown, secret: string, now = Date.now()): BindPayload | null {
	const p = unseal<BindPayload>('kp-bind', token, secret, now);
	return p && Number.isInteger(p.p) ? p : null;
}

/**
 * Kode harian 6 digit per proyek per tanggal WIB — ditampilkan di HP leader, berganti otomatis tiap hari.
 * Deterministik dari rahasia server (tanpa tabel), jadi tidak ada yang perlu disimpan/disinkronkan.
 */
export function kodeHarian(projectId: number, tanggalWIB: string, secret: string): string {
	const h = createHmac('sha256', secret).update(`kp-harian:${projectId}:${tanggalWIB}`).digest();
	return String(h.readUInt32BE(0) % 1_000_000).padStart(6, '0');
}

export function cocokKodeHarian(input: unknown, projectId: number, tanggalWIB: string, secret: string): boolean {
	if (typeof input !== 'string' || !/^\d{6}$/.test(input.trim())) return false;
	const a = Buffer.from(input.trim());
	const b = Buffer.from(kodeHarian(projectId, tanggalWIB, secret));
	return a.length === b.length && timingSafeEqual(a, b);
}

/** Alfabet tanpa karakter membingungkan (0/O, 1/I/L) — kode diketik/dibaca manusia di lapangan. */
const KODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeKiosKode(length = 6): string {
	const bytes = randomBytes(length);
	let out = '';
	for (let i = 0; i < length; i++) out += KODE_ALPHABET[bytes[i] % KODE_ALPHABET.length];
	return out;
}

/** Kode dari URL dinormalisasi (huruf besar, spasi dibuang) dan divalidasi bentuknya. */
export function normalizeKode(raw: unknown): string | null {
	if (typeof raw !== 'string') return null;
	const k = raw.trim().toUpperCase();
	return /^[A-Z0-9]{4,8}$/.test(k) ? k : null;
}

/** Tanggal kalender WIB (YYYY-MM-DD) — "hari ini" menurut JAM SERVER, bukan jam HP. */
export function todayWIB(now = new Date()): string {
	return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jakarta' }).format(now);
}

/** Penyimpan jti sekali pakai (memori proses; kedaluwarsa otomatis). Token sudah berumur pendek,
 *  jadi kehilangan state saat restart hanya membuka jendela replay selama sisa umur token. */
export function createUsedJtiStore() {
	const used = new Map<string, number>();
	return {
		/** true bila jti baru ditandai; false bila sudah pernah dipakai. */
		consume(jti: string, exp: number, now = Date.now()): boolean {
			for (const [k, e] of used) if (e < now) used.delete(k);
			if (used.has(jti)) return false;
			used.set(jti, exp);
			return true;
		},
		size: () => used.size
	};
}
