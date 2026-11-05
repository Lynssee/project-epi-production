// src/lib/server/kioskProyekDevice.ts
// Rencana Kiosk Proyek, Fase 1 — perangkat kiosk (aktivasi, validasi, cabut) & roster kru.
// Semua query Directus DIPISAH per relasi (Aturan fetching): assignment → manpower → absensi.
// Skema (kiosk_proyek_perangkat, projects.kiosk_kode) sudah ada di prod sejak Fase 0; bila suatu
// saat tidak terbaca, error dilempar jelas (bukan ditelan) supaya terlihat di log.

import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { directusServerJson } from '$lib/server/directus';
import { makeKiosKode, todayWIB } from '$lib/server/kioskProyekToken';

const idOf = (v: any) => (v && typeof v === 'object' ? v.id : v);

/** Rahasia HMAC. Error 503 dilempar SAAT DIPAKAI (bukan saat import) — sama dengan kioskAuth.ts. */
export function kioskProyekSecret(): string {
	if (!env.KIOSK_SESSION_SECRET) {
		throw error(503, 'KIOSK_SESSION_SECRET belum dikonfigurasi di server — Kiosk Proyek tidak bisa dipakai.');
	}
	return env.KIOSK_SESSION_SECRET;
}

// ---------------------------------------------------------------- kode proyek

export async function ensureKiosKode(projectId: number): Promise<string> {
	const cur = await directusServerJson<{ data: { kiosk_kode?: string | null } }>(
		`/items/projects/${projectId}?fields=id,kiosk_kode`
	).then((r) => r?.data);
	if (cur?.kiosk_kode) return cur.kiosk_kode;

	// Unik di DB (is_unique) — tabrakan jarang, ulangi beberapa kali dengan kode baru.
	let lastErr: unknown = null;
	for (let i = 0; i < 5; i++) {
		const kode = makeKiosKode();
		try {
			await directusServerJson(`/items/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ kiosk_kode: kode }) });
			return kode;
		} catch (e) {
			lastErr = e;
			// Mungkin tabrakan unik, atau proses lain sudah mengisi — cek dulu sebelum mencoba lagi.
			const again = await directusServerJson<{ data: { kiosk_kode?: string | null } }>(
				`/items/projects/${projectId}?fields=id,kiosk_kode`
			).then((r) => r?.data);
			if (again?.kiosk_kode) return again.kiosk_kode;
		}
	}
	console.error('[kioskProyek] gagal membuat kiosk_kode:', lastErr);
	throw error(502, 'Gagal membuat kode kiosk proyek. Coba lagi.');
}

export async function resolveProjectByKode(kode: string): Promise<{ id: number; name: string } | null> {
	const res = await directusServerJson<{ data: any[] }>(
		`/items/projects?filter[kiosk_kode][_eq]=${encodeURIComponent(kode)}&fields=id,name&limit=1`
	);
	const p = res?.data?.[0];
	return p ? { id: Number(p.id), name: String(p.name || `Proyek #${p.id}`) } : null;
}

// ---------------------------------------------------------------- perangkat

export interface PerangkatRow {
	id: number;
	project_id: number;
	label: string | null;
	jenis: string | null;
	manpower_id: number | null;
	diaktifkan_oleh: string | null;
	aktif: boolean;
	kedaluwarsa_pada: string | null;
	terakhir_dipakai: string | null;
	dicabut_pada: string | null;
}
const PERANGKAT_FIELDS =
	'id,project_id,label,jenis,manpower_id,diaktifkan_oleh,aktif,kedaluwarsa_pada,terakhir_dipakai,dicabut_pada';

export async function createDevice(input: {
	projectId: number;
	label: string;
	leaderManpowerId: number;
	leaderNama: string;
	ttlDays: number;
	/** 'pribadi' = HP terikat ke satu kru (Fase 3); bawaan 'bersama'. */
	jenis?: 'bersama' | 'pribadi';
	manpowerId?: number | null;
}): Promise<{ id: number; kedaluwarsaPada: string }> {
	const kedaluwarsaPada = new Date(Date.now() + input.ttlDays * 86_400_000).toISOString();
	const created = await directusServerJson<{ data: { id: number } }>('/items/kiosk_proyek_perangkat', {
		method: 'POST',
		body: JSON.stringify({
			project_id: input.projectId,
			label: input.label.slice(0, 100) || 'Perangkat kiosk',
			jenis: input.jenis ?? 'bersama',
			manpower_id: input.jenis === 'pribadi' ? input.manpowerId ?? null : null,
			diaktifkan_oleh: input.leaderNama,
			diaktifkan_oleh_manpower_id: input.leaderManpowerId,
			aktif: true,
			kedaluwarsa_pada: kedaluwarsaPada,
			terakhir_dipakai: new Date().toISOString()
		})
	});
	const id = Number(created?.data?.id);
	if (!Number.isFinite(id)) throw error(502, 'Gagal menyimpan perangkat kiosk.');
	return { id, kedaluwarsaPada };
}

/** Perangkat sah = ada, aktif, belum kedaluwarsa, dan milik proyek di cookie. Satu request. */
export async function validateDevice(deviceId: number, projectId: number): Promise<PerangkatRow | null> {
	let row: PerangkatRow | null = null;
	try {
		row = await directusServerJson<{ data: PerangkatRow }>(`/items/kiosk_proyek_perangkat/${deviceId}?fields=${PERANGKAT_FIELDS}`).then((r) => r?.data || null);
	} catch (e) {
		// Baris dihapus admin → Directus balas 403 (aturan #403). Perlakukan sebagai tidak sah, tapi LOG.
		console.warn(`[kioskProyek] validateDevice #${deviceId} gagal dibaca:`, (e as Error)?.message);
		return null;
	}
	if (!row || !row.aktif) return null;
	if (Number(idOf(row.project_id)) !== Number(projectId)) return null;
	if (row.kedaluwarsa_pada && new Date(row.kedaluwarsa_pada).getTime() < Date.now()) return null;
	return row;
}

const lastTouch = new Map<number, number>();
/** Catat pemakaian terakhir paling sering 1x/menit per perangkat — hemat tulis. Best-effort. */
export function touchDevice(deviceId: number): void {
	const now = Date.now();
	if (now - (lastTouch.get(deviceId) || 0) < 60_000) return;
	lastTouch.set(deviceId, now);
	directusServerJson(`/items/kiosk_proyek_perangkat/${deviceId}`, {
		method: 'PATCH',
		body: JSON.stringify({ terakhir_dipakai: new Date(now).toISOString() })
	}).catch((e) => console.warn('[kioskProyek] touchDevice gagal (diabaikan):', e?.message));
}

export async function listDevices(projectId: number): Promise<PerangkatRow[]> {
	const res = await directusServerJson<{ data: PerangkatRow[] }>(
		`/items/kiosk_proyek_perangkat?filter[project_id][_eq]=${projectId}&sort=-date_created&limit=50&fields=${PERANGKAT_FIELDS}`
	);
	return res?.data || [];
}

/** HP pribadi yang masih berlaku untuk satu proyek (dipakai menandai nama yang sudah terikat & mencabut yang lama). */
export async function listPribadiAktif(projectId: number, manpowerId?: number): Promise<Array<{ id: number; manpower_id: number }>> {
	const who = manpowerId ? `&filter[manpower_id][_eq]=${manpowerId}` : '';
	const res = await directusServerJson<{ data: any[] }>(
		`/items/kiosk_proyek_perangkat?filter[project_id][_eq]=${projectId}&filter[jenis][_eq]=pribadi&filter[aktif][_eq]=true${who}` +
			`&fields=id,manpower_id,kedaluwarsa_pada&limit=-1`
	);
	const now = Date.now();
	return (res?.data || [])
		.filter((r) => !r.kedaluwarsa_pada || new Date(r.kedaluwarsa_pada).getTime() >= now)
		.map((r) => ({ id: Number(r.id), manpower_id: Number(idOf(r.manpower_id)) }));
}

/** Satu orang = satu HP pribadi aktif per proyek: ikat baru mencabut yang lama. Mengembalikan jumlah yang dicabut. */
export async function cabutPribadiLama(projectId: number, manpowerId: number, oleh: string, exceptId?: number): Promise<number> {
	const lama = (await listPribadiAktif(projectId, manpowerId)).filter((d) => d.id !== exceptId);
	for (const d of lama) {
		await directusServerJson(`/items/kiosk_proyek_perangkat/${d.id}`, {
			method: 'PATCH',
			body: JSON.stringify({ aktif: false, dicabut_pada: new Date().toISOString(), dicabut_oleh: oleh.slice(0, 128) })
		});
		lastTouch.delete(d.id);
	}
	return lama.length;
}

/** Nama manpower untuk daftar perangkat (query terpisah, satu request). */
export async function namaManpower(ids: number[]): Promise<Map<number, string>> {
	const uniq = [...new Set(ids.filter((n) => Number.isFinite(n) && n > 0))];
	if (!uniq.length) return new Map();
	const res = await directusServerJson<{ data: any[] }>(`/items/manpower?filter[id][_in]=${uniq.join(',')}&fields=id,nama&limit=-1`);
	return new Map((res?.data || []).map((m) => [Number(m.id), String(m.nama || `Kru #${m.id}`)]));
}

export async function revokeDevice(deviceId: number, projectId: number, oleh: string): Promise<void> {
	const row = await directusServerJson<{ data: { id: number; project_id: any } }>(
		`/items/kiosk_proyek_perangkat/${deviceId}?fields=id,project_id`
	).then((r) => r?.data);
	if (!row || Number(idOf(row.project_id)) !== Number(projectId)) throw error(404, 'Perangkat tidak ditemukan di proyek ini.');
	await directusServerJson(`/items/kiosk_proyek_perangkat/${deviceId}`, {
		method: 'PATCH',
		body: JSON.stringify({ aktif: false, dicabut_pada: new Date().toISOString(), dicabut_oleh: oleh.slice(0, 128) })
	});
	lastTouch.delete(deviceId);
}

// ---------------------------------------------------------------- roster

export interface RosterKru {
	manpower_id: number;
	assignment_id: number;
	nama: string;
	posisi: string | null;
	penugasan: string; // aktif | menunggu_validasi | menunggu_ttd
	adalah_leader: boolean;
	hari_ini: null | {
		status: string | null;
		jam_masuk: string | null;
		jam_pulang: string | null;
		verifikasi: string | null;
	};
}
export interface Roster {
	project: { id: number; name: string; kode: string | null };
	tanggal: string;
	kru: RosterKru[];
	ringkasan: { terdaftar: number; hadir: number; belum: number };
}

const rosterCache = new Map<string, { at: number; data: Roster }>();
export function invalidateRoster(projectId: number): void {
	for (const k of rosterCache.keys()) if (k.startsWith(`${projectId}:`)) rosterCache.delete(k);
}

const STATUS_HADIR = new Set(['hadir', 'setengah_hari']);

/** Murni (dites): rakit roster dari tiga hasil query terpisah. */
export function buildRoster(
	project: { id: number; name: string; kode?: string | null; leaderIds: number[] },
	tanggal: string,
	assignments: Array<{ id: number; manpower_id: any; status: string }>,
	manpower: Array<{ id: number; nama?: string | null; posisi?: string | null }>,
	absensi: Array<{ manpower_id: any; status?: string | null; jam_masuk?: string | null; jam_pulang?: string | null; verifikasi_leader_status?: string | null }>
): Roster {
	const mpById = new Map(manpower.map((m) => [Number(m.id), m]));
	const absById = new Map<number, (typeof absensi)[number]>();
	for (const a of absensi) absById.set(Number(idOf(a.manpower_id)), a);

	const seen = new Set<number>();
	const kru: RosterKru[] = [];
	for (const as of assignments) {
		const mid = Number(idOf(as.manpower_id));
		if (!Number.isFinite(mid) || seen.has(mid)) continue; // satu orang bisa punya >1 penugasan — tampilkan sekali
		seen.add(mid);
		const mp = mpById.get(mid);
		const a = absById.get(mid);
		kru.push({
			manpower_id: mid,
			assignment_id: Number(as.id),
			nama: mp?.nama?.trim() || `Kru #${mid}`,
			posisi: mp?.posisi || null,
			penugasan: as.status,
			adalah_leader: project.leaderIds.includes(mid),
			hari_ini: a
				? { status: a.status ?? null, jam_masuk: a.jam_masuk ?? null, jam_pulang: a.jam_pulang ?? null, verifikasi: a.verifikasi_leader_status ?? null }
				: null
		});
	}
	kru.sort((x, y) => x.nama.localeCompare(y.nama, 'id'));
	const hadir = kru.filter((k) => k.hari_ini?.status && STATUS_HADIR.has(k.hari_ini.status)).length;
	return {
		project: { id: project.id, name: project.name, kode: project.kode ?? null },
		tanggal,
		kru,
		ringkasan: { terdaftar: kru.length, hadir, belum: kru.filter((k) => !k.hari_ini).length }
	};
}

export async function getRoster(projectId: number, cacheSeconds: number): Promise<Roster> {
	const tanggal = todayWIB();
	const key = `${projectId}:${tanggal}`;
	const hit = rosterCache.get(key);
	if (hit && cacheSeconds > 0 && Date.now() - hit.at < cacheSeconds * 1000) return hit.data;

	const project = await directusServerJson<{ data: any }>(
		`/items/projects/${projectId}?fields=id,name,kiosk_kode,manpower_leader_id,manpower_leader_wakil_id`
	).then((r) => r?.data);
	if (!project) throw error(404, 'Proyek tidak ditemukan.');

	const assignments = await directusServerJson<{ data: any[] }>(
		`/items/manpower_assignment?filter[project_id][_eq]=${projectId}` +
			`&filter[status][_in]=aktif,menunggu_validasi,menunggu_ttd&fields=id,manpower_id,status&limit=-1`
	).then((r) => r?.data || []);

	const ids = [...new Set(assignments.map((a) => Number(idOf(a.manpower_id))).filter((n) => Number.isFinite(n)))];
	const manpower = ids.length
		? await directusServerJson<{ data: any[] }>(`/items/manpower?filter[id][_in]=${ids.join(',')}&fields=id,nama,posisi&limit=-1`).then((r) => r?.data || [])
		: [];

	const absensi = await directusServerJson<{ data: any[] }>(
		`/items/manpower_absensi?filter[project_id][_eq]=${projectId}&filter[tanggal][_eq]=${tanggal}` +
			`&fields=manpower_id,status,jam_masuk,jam_pulang,verifikasi_leader_status&limit=-1`
	).then((r) => r?.data || []);

	const leaderIds = [project.manpower_leader_id, project.manpower_leader_wakil_id].map((v) => Number(idOf(v))).filter((n) => Number.isFinite(n));
	const data = buildRoster({ id: Number(project.id), name: String(project.name || `Proyek #${project.id}`), kode: project.kiosk_kode ?? null, leaderIds }, tanggal, assignments, manpower, absensi);
	rosterCache.set(key, { at: Date.now(), data });
	return data;
}
