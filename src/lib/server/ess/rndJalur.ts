// src/lib/server/ess/rndJalur.ts
// Jalur Karier R&D (sisi lapangan): level sertifikat + progres program Track milik karyawan yang login.
// Level dibaca dari app_settings training_lms/rnd_cert_levels (diatur admin; cache 5 menit), default di rndJalur.js.
// Hanya baca: 3 query Directus (setelan ber-cache, program, enrollment sendiri) — query dipisah per relasi.
import { directusServerJson } from '$lib/server/directus';
import { DEFAULT_RND_CERT_LEVELS, RND_CERT_SETTING_KEY, parseRndCertLevels, evalRndJalur } from '$lib/utils/rndJalur.js';
import { listMyEnrollments } from './training';

const CACHE_TTL_MS = 5 * 60 * 1000;
let _cache: { at: number; value: any[] } | null = null;

export async function getRndLevels(): Promise<any[]> {
	if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) return _cache.value;
	let value: any[] = [...DEFAULT_RND_CERT_LEVELS];
	try {
		const res = await directusServerJson<{ data: Array<{ setting_value: unknown }> }>(
			`/items/app_settings?filter[module][_eq]=training_lms&filter[setting_key][_eq]=${RND_CERT_SETTING_KEY}&fields=setting_value&limit=1`
		);
		const raw = res?.data?.[0]?.setting_value;
		if (raw) value = parseRndCertLevels(raw) as any[];
	} catch (err) {
		console.error('[rndJalur] gagal baca app_settings rnd_cert_levels, pakai default:', err);
	}
	_cache = { at: Date.now(), value };
	return value;
}

export interface JalurProgram { kode: string; programId: number | null; judul: string; status: 'lulus' | 'proses' | 'kedaluwarsa' | 'belum'; progress: number; terbuka: boolean }
export interface JalurLevel { key: string; nama: string; achieved: boolean; masaBerlakuBulan: number; manual: string; blockedBy: string[]; programs: JalurProgram[] }
export interface JalurKarier { levels: JalurLevel[]; current: string | null; next: string | null; adaProgram: boolean }

export async function getMyRndJalur(karyawanId: number, today = new Date()): Promise<JalurKarier> {
	const levels = await getRndLevels();
	const kodes = [...new Set(levels.flatMap((l) => l.programKodes as string[]))];
	if (!kodes.length) return { levels: [], current: null, next: null, adaProgram: false };
	const progRes = await directusServerJson<{ data: Array<{ id: number; kode: string; judul: string; status: string }> }>(
		`/items/training_program?filter[kode][_in]=${kodes.map(encodeURIComponent).join(',')}&fields=id,kode,judul,status&limit=-1`
	);
	const programs = progRes?.data || [];
	const byKode = new Map(programs.map((p) => [p.kode, p]));
	const idKode = new Map(programs.map((p) => [String(p.id), p.kode]));
	const mine = (await listMyEnrollments(karyawanId)).filter((e) => idKode.has(String(e.program_id)));
	const enrollments = mine.map((e) => ({ program_kode: idKode.get(String(e.program_id)) as string, status: e.status, sertifikat_expired: e.sertifikat_expired }));
	const j = evalRndJalur({ levels, enrollments, today });
	const t0 = new Date(today); t0.setHours(0, 0, 0, 0);

	const statusOf = (kode: string): JalurProgram['status'] => {
		const rows = mine.filter((e) => idKode.get(String(e.program_id)) === kode);
		let best: JalurProgram['status'] = 'belum';
		const rank = { lulus: 3, proses: 2, kedaluwarsa: 1, belum: 0 };
		for (const e of rows) {
			let s: JalurProgram['status'] = 'proses';
			if (e.status === 'Lulus') {
				const exp = e.sertifikat_expired ? new Date(String(e.sertifikat_expired).slice(0, 10) + 'T00:00:00') : null;
				s = exp && exp < t0 ? 'kedaluwarsa' : 'lulus';
			}
			if (rank[s] > rank[best]) best = s;
		}
		return best;
	};
	const progressOf = (kode: string) => Math.max(0, ...mine.filter((e) => idKode.get(String(e.program_id)) === kode).map((e) => Number(e.progress_persen) || 0));

	return {
		current: j.current,
		next: j.next,
		adaProgram: programs.length > 0,
		levels: levels.map((l) => {
			const r = j.levels.find((x) => x.key === l.key)!;
			return {
				key: l.key, nama: l.nama, achieved: r.achieved, masaBerlakuBulan: l.masaBerlakuBulan, manual: l.manual || '', blockedBy: r.blockedBy,
				programs: (l.programKodes as string[]).map((kode) => {
					const p = byKode.get(kode);
					return { kode, programId: p?.id ?? null, judul: p?.judul ?? kode, status: statusOf(kode), progress: progressOf(kode), terbuka: p?.status === 'published' };
				})
			};
		})
	};
}
