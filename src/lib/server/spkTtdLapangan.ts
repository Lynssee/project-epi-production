// src/lib/server/spkTtdLapangan.ts
// SERVER-ONLY. Sisi LAPANGAN dari "TTD SPK Manpower via tautan" (Rencana Penajaman SPK Borongan & E-Sign, Fase 4).
// Lapangan hanya MEMBUAT/MENCABUT/MELIHAT tautan dan memberi dispensasi. Halaman publik + OTP + penyimpanan TTD
// hidup di erp-epi (internal.eltamaprimaindo.com) — tautan yang dibuat di sini menunjuk ke sana, memakai
// koleksi Directus yang sama (manpower_akses_link). Logika disamakan dengan erp-epi `spkTtdService.js`.
//
// Pengaman: fitur dikunci setelan manpower.spk_doc.ttd_link_aktif (default mati; kolom skema baru belum tentu ada —
// Directus membalas kolom tak dikenal sebagai 403) dan akses dibatasi ke proyek yang dipegang pemanggil
// (resolveFieldProjectScope, fail-closed). Tidak mengirim WhatsApp (WA OTP dikirim erp-epi saat mandor membuka tautan;
// PL membagikan tautan sendiri atau memakai mode kiosk di perangkatnya).

import { createHash, randomBytes } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { error, type RequestEvent } from '@sveltejs/kit';
import { directusServerJson } from './directus';
import { requireUser } from './firebaseAuth';
import { resolveFieldProjectScope } from './fieldProjectScope';

const NS = 'manpower.spk_doc.';
const SETTINGS_TTL_MS = 60 * 1000;

export class SpkTtdError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

const sha256Hex = (v: string) => createHash('sha256').update(v).digest('hex');
const idOf = (v: any) => (v && typeof v === 'object' ? v.id : v);
const erpOrigin = () =>
	(env.ERP_EPI1_BASE_URL || (process.env.NODE_ENV === 'production' ? 'https://internal.eltamaprimaindo.com' : 'http://localhost:9390')).replace(/\/$/, '');

/* ───────────── Setelan (fail-closed) ───────────── */

let cache: { at: number; aktif: boolean; hari: number } | null = null;
export function resetSettingsCache() {
	cache = null;
}

function parseNilai(raw: any): any {
	if (raw == null) return null;
	if (typeof raw === 'object') return raw;
	try {
		return JSON.parse(String(raw));
	} catch {
		return raw;
	}
}

export async function bacaSetelan(): Promise<{ aktif: boolean; hari: number }> {
	if (cache && Date.now() - cache.at < SETTINGS_TTL_MS) return cache;
	const map: Record<string, any> = {};
	try {
		const q = encodeURIComponent(NS);
		const [sys, app] = await Promise.all([
			directusServerJson<any>(`/items/system_settings?filter[setting_key][_starts_with]=${q}&limit=-1`),
			directusServerJson<any>(`/items/app_settings?filter[module][_eq]=manpower&filter[setting_key][_starts_with]=${q}&limit=-1`).catch((e) => {
				console.warn('[spkTtdLapangan] app_settings(manpower) gagal dibaca (diabaikan):', e?.message);
				return { data: [] };
			})
		]);
		for (const r of sys?.data || []) map[r.setting_key] = parseNilai(r.setting_value);
		for (const r of app?.data || []) {
			const v = parseNilai(r.setting_value);
			if (v !== null && v !== undefined) map[r.setting_key] = v;
		}
	} catch (e) {
		console.error('[spkTtdLapangan] Gagal baca setelan — fitur dianggap NONAKTIF:', e);
		return { aktif: false, hari: 7 };
	}
	const aktifRaw = map[NS + 'ttd_link_aktif'];
	const hariRaw = Number(map[NS + 'link_ttl_hari']);
	cache = {
		at: Date.now(),
		aktif: aktifRaw === true || aktifRaw === 'true' || aktifRaw === 1 || aktifRaw === '1',
		hari: Number.isFinite(hariRaw) && hariRaw >= 1 && hariRaw <= 30 ? hariRaw : 7
	};
	return cache;
}

async function wajibAktif() {
	const s = await bacaSetelan();
	if (!s.aktif) throw new SpkTtdError(409, 'Fitur TTD via tautan belum diaktifkan (menunggu skema Directus & setelan dari Lead).');
	return s;
}

/* ───────────── Otorisasi ───────────── */

/** Login + pemanggil harus memegang proyek tempat penugasan berada (atau role lintas proyek). */
export async function otorisasiPenugasan(event: RequestEvent, assignmentId: number) {
	const user = await requireUser(event);
	const idToken = (event.request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
	const a = (await directusServerJson<any>(`/items/manpower_assignment/${assignmentId}`))?.data;
	if (!a) throw error(404, 'Penugasan tidak ditemukan.');
	const scope = await resolveFieldProjectScope(idToken, (user as any).uid, user.email);
	const projectId = Number(idOf(a.project_id));
	if (!scope.unrestricted && !scope.projectIds.includes(projectId)) {
		throw error(403, 'Anda bukan pemegang proyek penugasan ini.');
	}
	return { a, oleh: user.email || (user as any).uid || '' };
}

/* ───────────── Operasi ───────────── */

async function cabutAktif(assignmentId: number, manpowerId: number | null, tipe: string | null) {
	const f = [
		`filter[assignment_id][_eq]=${assignmentId}`,
		manpowerId ? `filter[manpower_id][_eq]=${manpowerId}` : null,
		tipe ? `filter[tipe][_eq]=${tipe}` : 'filter[tipe][_in]=spk_ttd,spk_syarat',
		'filter[dicabut][_eq]=false',
		'fields=id',
		'limit=-1'
	]
		.filter(Boolean)
		.join('&');
	const aktif: any[] = (await directusServerJson<any>(`/items/manpower_akses_link?${f}`))?.data || [];
	await Promise.all(aktif.map((r) => directusServerJson(`/items/manpower_akses_link/${r.id}`, { method: 'PATCH', body: JSON.stringify({ dicabut: true }) })));
	return aktif.length;
}

export async function buatLink(a: any, opts: { mode: 'link' | 'kiosk_pl'; oleh: string; varian?: 'lengkap' | 'tanpa_harga'; manpowerId?: number | null }) {
	const s = await wajibAktif();
	if (!['link', 'kiosk_pl'].includes(opts.mode)) throw new SpkTtdError(400, 'Mode tidak dikenal.');
	const varian = opts.varian === 'tanpa_harga' ? 'tanpa_harga' : 'lengkap';
	if (varian === 'tanpa_harga' && opts.mode === 'kiosk_pl') throw new SpkTtdError(400, 'Mode kiosk hanya untuk SPK lengkap.');
	if (a.status === 'batal') throw new SpkTtdError(409, 'Penugasan sudah dibatalkan.');
	if (varian === 'lengkap') {
		if (a.ttd_manpower || ['aktif', 'selesai'].includes(a.status)) throw new SpkTtdError(409, 'SPK ini sudah ditandatangani.');
		if (a.status !== 'menunggu_ttd') throw new SpkTtdError(409, 'SPK belum berstatus "Menunggu TTD". Selesaikan data penugasan dulu.');
	}
	const pemilikId = Number(idOf(a.manpower_id));
	const manpowerId = opts.manpowerId ? Number(opts.manpowerId) : pemilikId;
	if (!manpowerId) throw new SpkTtdError(400, 'Manpower penerima belum dipilih.');
	if (varian === 'tanpa_harga' && manpowerId !== pemilikId) {
		// pakta kru: penerima HARUS anggota proyek penugasan ini (aktif, bukan batal)
		const m = await directusServerJson<any>(
			`/items/manpower_assignment?filter[project_id][_eq]=${Number(idOf(a.project_id))}&filter[manpower_id][_eq]=${manpowerId}&filter[status][_neq]=batal&fields=id&limit=1`
		);
		if (!m?.data?.length) throw new SpkTtdError(403, 'Manpower ini bukan anggota proyek penugasan tersebut.');
	}
	const tipe = varian === 'lengkap' ? 'spk_ttd' : 'spk_syarat';

	await cabutAktif(a.id, manpowerId, tipe);
	const raw = randomBytes(24).toString('hex');
	const kedaluwarsa = new Date(Date.now() + s.hari * 24 * 60 * 60 * 1000).toISOString();
	const res = await directusServerJson<any>('/items/manpower_akses_link', {
		method: 'POST',
		body: JSON.stringify({
			tipe, assignment_id: a.id, manpower_id: manpowerId, token_hash: sha256Hex(raw), kedaluwarsa,
			dicabut: false, jumlah_dibuka: 0, varian_dokumen: varian, mode: opts.mode, sekali_pakai: true,
			dibuat_oleh: String(opts.oleh || '').slice(0, 120), otp_percobaan: 0
		})
	});
	const row = res?.data;
	if (!row?.id) throw new SpkTtdError(500, 'Gagal membuat tautan.');
	return { id: row.id, url: `${erpOrigin()}/akses-manpower/${row.id}?t=${raw}`, kedaluwarsa, hari: s.hari, mode: opts.mode };
}

export async function daftarLink(assignmentId: number) {
	const s = await bacaSetelan();
	if (!s.aktif) return { aktif: false, links: [] as any[] };
	const f = `filter[assignment_id][_eq]=${assignmentId}&filter[tipe][_in]=spk_ttd,spk_syarat&fields=id,tipe,mode,varian_dokumen,manpower_id,kedaluwarsa,dicabut,jumlah_dibuka,terakhir_dibuka,digunakan_at,ttd_nama&sort=-id&limit=8`;
	const links = (await directusServerJson<any>(`/items/manpower_akses_link?${f}`))?.data || [];
	return { aktif: true, links };
}

export async function cabutSemua(assignmentId: number) {
	await wajibAktif();
	return { dicabut: await cabutAktif(assignmentId, null, null) };
}

export async function dispensasi(a: any, alasan: string, oleh: string) {
	await wajibAktif();
	const teks = String(alasan || '').trim();
	if (teks.length < 10) throw new SpkTtdError(400, 'Alasan dispensasi wajib diisi (minimal 10 karakter).');
	if (a.ttd_manpower || ['aktif', 'selesai'].includes(a.status)) throw new SpkTtdError(409, 'SPK ini sudah ditandatangani/aktif.');
	if (a.status !== 'menunggu_ttd') throw new SpkTtdError(409, 'SPK belum berstatus "Menunggu TTD".');
	await directusServerJson(`/items/manpower_assignment/${a.id}`, {
		method: 'PATCH',
		body: JSON.stringify({
			status: 'aktif', ttd_manpower_at: new Date().toISOString(), ttd_nama: `Dispensasi (${String(oleh).slice(0, 60) || 'PL'})`,
			ttd_via: 'dispensasi', ttd_dispensasi_alasan: teks
		})
	});
	await cabutAktif(a.id, null, null);
	return { success: true };
}

/** Respons galat seragam untuk route. */
export function balasGalat(e: any) {
	if (e instanceof SpkTtdError) return new Response(JSON.stringify({ success: false, error: e.message }), { status: e.status, headers: { 'Content-Type': 'application/json' } });
	if (e && typeof e === 'object' && 'status' in e && 'body' in e) throw e; // HttpError SvelteKit
	console.error('[spkTtdLapangan]', e);
	return new Response(JSON.stringify({ success: false, error: 'Terjadi kesalahan pada server. Coba lagi.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
}
