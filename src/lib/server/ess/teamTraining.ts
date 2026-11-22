// src/lib/server/ess/teamTraining.ts
// Kesehatan training TIM untuk atasan/mentor di ESS (rencana mentor_kpi_training, Fase 4). Salinan setia dari
// erp-epi/src/lib/utils/kpiMentorAccountability.js (logika murni: resolveMentorConfig, buildMenteeMap, computeTeamTraining) + pembaca setelan
// app_settings 'kpi_engine' prefix `mentor_` (cache 60 dtk). Bobot/masa tenggang/sumber atasan diatur Super Admin di Pengaturan > Mesin KPI (erp-epi);
// tidak ada angka tetap di sini selain bawaan darurat. Mode 'off' -> ESS menyembunyikan fitur. 'shadow' -> tampil berlabel simulasi.
// Hemat: hanya bawahan atasan ini yang di-query (bukan seluruh perusahaan), tiap koleksi terpisah tanpa relasi bersarang.

import { directusServerJson } from '$lib/server/directus';

export type MentorMode = 'off' | 'shadow' | 'on';
export interface MentorConfig {
	mode: MentorMode;
	sources: string[];
	includeIndirect: boolean;
	scope: 'wajib_only' | 'all_enrolled';
	wKelulusan: number;
	wNilai: number;
	fallbackPassScore: number;
	graceDays: number;
	penaltyPerItem: number;
	bonusAllPass: number;
	bonusMinAvg: number;
	minMentees: number;
}

const SOURCES_ALL = ['mentor_id', 'atasan_fungsional_id', 'atasan_id'];
const SOURCES_DEFAULT = ['mentor_id', 'atasan_fungsional_id', 'atasan_id']; // mentor khusus -> atasan fungsional -> atasan langsung
const num = (v: unknown, d: number) => {
	if (v == null || v === '') return d;
	const n = Number(v);
	return Number.isFinite(n) ? n : d;
};
const round1 = (n: number) => Math.round(n * 10) / 10;
const idOf = (v: any) => (v && typeof v === 'object' ? v.id : v);

export function resolveMentorConfig(raw: Record<string, unknown> = {}): MentorConfig {
	let srcRaw: unknown = raw.mentor_hierarchy_sources;
	if (typeof srcRaw === 'string') { try { srcRaw = JSON.parse(srcRaw); } catch { srcRaw = String(srcRaw).split(',').map((s) => s.trim()); } }
	const srcList = (Array.isArray(srcRaw) ? srcRaw : []).map(String).filter((s) => SOURCES_ALL.includes(s));
	const sources = srcList.length ? srcList : SOURCES_DEFAULT;
	const wk = Math.max(0, num(raw.mentor_w_kelulusan_pct, 60));
	const wn = Math.max(0, num(raw.mentor_w_nilai_pct, 40));
	const sum = wk + wn || 100;
	const mode = String(raw.mentor_kpi_mode ?? 'shadow').trim().toLowerCase();
	return {
		mode: mode === 'off' || mode === 'on' ? mode : 'shadow',
		sources,
		includeIndirect: raw.mentor_include_indirect === true || raw.mentor_include_indirect === 'true',
		scope: raw.mentor_training_scope === 'all_enrolled' ? 'all_enrolled' : 'wajib_only',
		wKelulusan: wk / sum,
		wNilai: wn / sum,
		fallbackPassScore: Math.min(100, Math.max(0, num(raw.mentor_fallback_pass_score, 80))),
		graceDays: Math.max(0, Math.floor(num(raw.mentor_grace_days, 14))),
		penaltyPerItem: Math.max(0, num(raw.mentor_overdue_penalty_per_item, 0)),
		bonusAllPass: Math.max(0, num(raw.mentor_bonus_all_pass_pct, 5)),
		bonusMinAvg: Math.min(100, Math.max(0, num(raw.mentor_bonus_min_avg, 85))),
		minMentees: Math.max(1, Math.floor(num(raw.mentor_min_mentees, 1)))
	};
}

const STATUS_KERJA_INAKTIF = ['tidak aktif', 'tidak_aktif', 'non aktif', 'non-aktif', 'nonaktif', 'resign', 'keluar', 'inaktif', 'inactive', 'terminated'];
export function isKaryawanAktif(k: any): boolean {
	return String(k?.status || '').trim().toLowerCase() !== 'off' && !STATUS_KERJA_INAKTIF.includes(String(k?.status_kerja || '').trim().toLowerCase());
}

/** Penanggung jawab tiap karyawan = sumber pertama yang terisi (bukan dirinya). Mengembalikan peta atasan -> id bawahan. */
export function buildMenteeMap(rows: any[], sources: string[], includeIndirect = false): Map<string, string[]> {
	const direct = new Map<string, string[]>();
	for (const k of rows || []) {
		if (k?.id == null) continue;
		const id = String(k.id);
		let resp: string | null = null;
		for (const src of sources || []) {
			const rid = idOf(k[src]);
			if (rid != null && String(rid) !== id) { resp = String(rid); break; }
		}
		if (resp == null) continue;
		if (!direct.has(resp)) direct.set(resp, []);
		direct.get(resp)!.push(id);
	}
	if (!includeIndirect) return direct;
	const out = new Map<string, string[]>();
	for (const [mgr, kids] of direct) {
		const set = new Set(kids);
		for (const kid of kids) for (const gk of direct.get(kid) || []) if (gk !== mgr) set.add(gk);
		out.set(mgr, [...set]);
	}
	return out;
}

export interface EnrollmentRow {
	id?: number;
	karyawan_id: number | string | { id: number };
	program_id?: number | string | { id: number } | null;
	status: string;
	nilai_akhir?: number | string | null;
	tanggal_daftar?: string | null;
	tenggat?: string | null;
	sumber_daftar?: string | null;
}

export interface MenteeContribution {
	karyawan_id: string;
	nama: string;
	total: number;
	lulus: number;
	avgNilai: number | null;
	passRate: number;
	kritis: boolean;
}
export interface TeamTrainingResult {
	value: number;
	note: string;
	raw: { mentees: number; counted: number; lulus: number; passRate: number; avgScore: number | null; penalti: number; bonus: number; kritisMentees: number };
	perMentee: MenteeContribution[];
}

const DAY = 86400000;
const toDay = (v: unknown): number | null => {
	if (!v) return null;
	const t = Date.parse(String(v).slice(0, 10));
	return Number.isFinite(t) ? t : null;
};

export function computeTeamTraining(enrollments: EnrollmentRow[], c: MentorConfig, today = new Date(), nameOf?: (id: string) => string | undefined): TeamTrainingResult | null {
	const todayMs = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
	const rows = (enrollments || []).filter((e) => e && e.status !== 'Cancelled').filter((e) => c.scope === 'all_enrolled' || String(e.sumber_daftar || 'ditugaskan') !== 'mandiri');
	const counted: { e: EnrollmentRow; lulus: boolean; nilai: number | null; kritis: boolean }[] = [];
	for (const e of rows) {
		const nilai = e.nilai_akhir != null && e.nilai_akhir !== '' && Number.isFinite(Number(e.nilai_akhir)) ? Number(e.nilai_akhir) : null;
		if (e.status === 'Lulus') { counted.push({ e, lulus: true, nilai: nilai ?? c.fallbackPassScore, kritis: false }); continue; }
		// nilai null = tak ada skor (bukan nol): tidak ikut rata-rata nilai; kegagalan sudah tercermin di kelulusan.
		if (e.status === 'Gagal' || e.status === 'Remedial') { counted.push({ e, lulus: false, nilai, kritis: true }); continue; }
		const tenggat = toDay(e.tenggat);
		const daftar = toDay(e.tanggal_daftar);
		const lewatTenggat = tenggat != null && tenggat < todayMs;
		const lewatGrace = daftar != null && daftar + c.graceDays * DAY <= todayMs;
		if (lewatTenggat || lewatGrace) counted.push({ e, lulus: false, nilai: null, kritis: lewatTenggat });
	}
	const mentees = new Set(counted.map((x) => String(idOf(x.e.karyawan_id))));
	if (counted.length === 0 || mentees.size < c.minMentees) return null;
	const lulus = counted.filter((x) => x.lulus).length;
	const passRate = (lulus / counted.length) * 100;
	// Rata-rata nilai hanya dari training yang punya skor; tak ada satu pun → null dan skor memakai kelulusan saja (tanpa hukuman ganda).
	const scored = counted.filter((x) => x.nilai != null) as { nilai: number }[];
	const avgScore = scored.length ? scored.reduce((s, x) => s + x.nilai, 0) / scored.length : null;
	const kritisMentees = new Set(counted.filter((x) => x.kritis).map((x) => String(idOf(x.e.karyawan_id)))).size;
	const penalti = c.penaltyPerItem * kritisMentees;
	const bonus = c.bonusAllPass > 0 && lulus === counted.length && avgScore != null && avgScore >= c.bonusMinAvg ? c.bonusAllPass : 0;
	const base = avgScore == null ? passRate : c.wKelulusan * passRate + c.wNilai * avgScore;
	const value = round1(Math.min(100, Math.max(0, base - penalti + bonus)));

	const per = new Map<string, { total: number; lulus: number; sum: number; n: number; kritis: boolean }>();
	for (const x of counted) {
		const id = String(idOf(x.e.karyawan_id));
		const p = per.get(id) || { total: 0, lulus: 0, sum: 0, n: 0, kritis: false };
		p.total += 1; if (x.nilai != null) { p.sum += x.nilai; p.n += 1; } if (x.lulus) p.lulus += 1; if (x.kritis) p.kritis = true;
		per.set(id, p);
	}
	const perMentee = [...per.entries()]
		.map(([id, p]) => ({ karyawan_id: id, nama: nameOf?.(id) || `Karyawan #${id}`, total: p.total, lulus: p.lulus, avgNilai: p.n ? round1(p.sum / p.n) : null, passRate: round1((p.lulus / p.total) * 100), kritis: p.kritis }))
		.sort((a, b) => a.passRate - b.passRate || (a.avgNilai ?? 101) - (b.avgNilai ?? 101));
	return {
		value,
		note: `Tim ${mentees.size} orang: ${lulus}/${counted.length} training lulus (${round1(passRate)}%), rata-rata nilai ${avgScore == null ? '—' : round1(avgScore)}`,
		raw: { mentees: mentees.size, counted: counted.length, lulus, passRate: round1(passRate), avgScore: avgScore == null ? null : round1(avgScore), penalti: round1(penalti), bonus, kritisMentees },
		perMentee
	};
}

// ── I/O ──────────────────────────────────────────────────────────────────────
let cfgCache: { at: number; value: MentorConfig } | null = null;
export function _resetTeamTrainingCacheForTest() { cfgCache = null; }

/** Setelan mentor_* (1 query, cache 60 dtk). Gagal baca -> mode 'off' (ESS tidak menampilkan, tak menebak). */
export async function loadMentorConfig(): Promise<MentorConfig> {
	if (cfgCache && Date.now() - cfgCache.at < 60_000) return cfgCache.value;
	let value = { ...resolveMentorConfig({}), mode: 'off' as MentorMode };
	try {
		const res = await directusServerJson<{ data: { setting_key: string; setting_value: unknown }[] }>(
			`/items/app_settings?filter[module][_eq]=kpi_engine&filter[setting_key][_starts_with]=mentor_&fields=setting_key,setting_value&limit=-1`
		);
		value = resolveMentorConfig(Object.fromEntries((res?.data || []).map((r) => [r.setting_key, r.setting_value])));
	} catch (e) {
		console.error('[ess/teamTraining] gagal baca setelan mentor, fitur disembunyikan:', (e as Error)?.message);
	}
	cfgCache = { at: Date.now(), value };
	return value;
}

const enc = encodeURIComponent;
const KAR_FIELDS = 'id,nama_karyawan,divisi,status,status_kerja,atasan_id,atasan_fungsional_id,mentor_id';

/** Bawahan atasan ini sesuai urutan sumber di setelan (anggota yang penanggung jawab pertamanya = atasan ini). */
export async function resolveTeamMembers(managerId: number, c: MentorConfig): Promise<any[]> {
	const q = (ids: number[]) => enc(JSON.stringify({ _or: [{ atasan_id: { _in: ids } }, { atasan_fungsional_id: { _in: ids } }, { mentor_id: { _in: ids } }] }));
	const level1 = (await directusServerJson<{ data: any[] }>(`/items/karyawan?filter=${q([managerId])}&fields=${KAR_FIELDS}&limit=-1`))?.data || [];
	let rows = level1;
	if (c.includeIndirect && level1.length) {
		const ids = level1.map((k) => Number(k.id)).filter(Number.isFinite);
		const level2 = (await directusServerJson<{ data: any[] }>(`/items/karyawan?filter=${q(ids)}&fields=${KAR_FIELDS}&limit=-1`))?.data || [];
		const seen = new Set(level1.map((k) => String(k.id)));
		rows = [...level1, ...level2.filter((k) => !seen.has(String(k.id)))];
	}
	const aktif = rows.filter(isKaryawanAktif);
	const ids = new Set(buildMenteeMap(aktif, c.sources, c.includeIndirect).get(String(managerId)) || []);
	return aktif.filter((k) => ids.has(String(k.id)));
}

export interface TeamTrainingMember {
	karyawanId: number;
	nama: string;
	total: number;
	lulus: number;
	avgNilai: number | null;
	passRate: number | null;
	kritis: boolean;
	status: 'perlu_dibina' | 'pantau' | 'tuntas' | 'belum_terhitung';
	training: { judul: string; status: string; nilai: number | null; tenggat: string | null; terlambat: boolean }[];
}
export interface TeamTrainingHealth {
	aktif: boolean;
	mode: MentorMode;
	jumlahAnggota: number;
	estimasiKpi: number | null;
	catatan: string | null;
	rataKelulusan: number | null;
	rataNilai: number | null;
	perluDibina: number;
	anggota: TeamTrainingMember[];
}

export async function getTeamTrainingHealth(managerId: number, today = new Date()): Promise<TeamTrainingHealth> {
	const c = await loadMentorConfig();
	const kosong: TeamTrainingHealth = { aktif: c.mode !== 'off', mode: c.mode, jumlahAnggota: 0, estimasiKpi: null, catatan: null, rataKelulusan: null, rataNilai: null, perluDibina: 0, anggota: [] };
	if (c.mode === 'off') return kosong;
	const members = await resolveTeamMembers(managerId, c);
	if (members.length === 0) return kosong;

	const ids = members.map((m) => Number(m.id)).filter(Number.isFinite);
	const enr = (await directusServerJson<{ data: EnrollmentRow[] }>(
		`/items/training_enrollment?filter=${enc(JSON.stringify({ _and: [{ karyawan_id: { _in: ids } }, { status: { _neq: 'Cancelled' } }] }))}&fields=id,karyawan_id,program_id,status,nilai_akhir,tanggal_daftar,tenggat,sumber_daftar&limit=-1`
	))?.data || [];
	const progIds = [...new Set(enr.map((e) => idOf(e.program_id)).filter((v) => v != null))].map(Number).filter(Number.isFinite);
	const judul = new Map<string, string>();
	if (progIds.length) {
		try {
			const rows = (await directusServerJson<{ data: { id: number; judul: string }[] }>(`/items/training_program?filter[id][_in]=${progIds.join(',')}&fields=id,judul&limit=-1`))?.data || [];
			for (const r of rows) judul.set(String(r.id), r.judul);
		} catch (e) {
			console.warn('[ess/teamTraining] training_program gagal, tampil id program:', (e as Error)?.message);
		}
	}
	const nameOf = new Map(members.map((m) => [String(m.id), m.nama_karyawan as string]));
	const res = computeTeamTraining(enr, c, today, (id) => nameOf.get(id));
	const per = new Map((res?.perMentee || []).map((p) => [p.karyawan_id, p]));
	const todayStr = today.toISOString().slice(0, 10);

	const anggota: TeamTrainingMember[] = members.map((m) => {
		const p = per.get(String(m.id));
		const training = enr.filter((e) => String(idOf(e.karyawan_id)) === String(m.id)).slice(0, 12).map((e) => ({
			judul: judul.get(String(idOf(e.program_id))) || (e.program_id != null ? `Program #${idOf(e.program_id)}` : `Pendaftaran #${e.id ?? '?'}`),
			status: e.status,
			nilai: e.nilai_akhir != null && Number.isFinite(Number(e.nilai_akhir)) ? Number(e.nilai_akhir) : null,
			tenggat: e.tenggat ? String(e.tenggat).slice(0, 10) : null,
			terlambat: e.status !== 'Lulus' && !!e.tenggat && String(e.tenggat).slice(0, 10) < todayStr
		}));
		return {
			karyawanId: Number(m.id), nama: m.nama_karyawan, total: p?.total ?? 0, lulus: p?.lulus ?? 0,
			avgNilai: p ? p.avgNilai : null, passRate: p ? p.passRate : null, kritis: !!p?.kritis,
			status: (!p ? 'belum_terhitung' : p.kritis ? 'perlu_dibina' : p.passRate >= 100 ? 'tuntas' : 'pantau') as TeamTrainingMember['status'],
			training
		};
	}).sort((a, b) => Number(b.kritis) - Number(a.kritis) || (a.passRate ?? 101) - (b.passRate ?? 101) || a.nama.localeCompare(b.nama));

	return {
		aktif: true, mode: c.mode, jumlahAnggota: members.length,
		estimasiKpi: res?.value ?? null, catatan: res?.note ?? null,
		rataKelulusan: res?.raw.passRate ?? null, rataNilai: res?.raw.avgScore ?? null,
		perluDibina: anggota.filter((a) => a.kritis).length, anggota
	};
}

// ── Catat Pembinaan (Action Plan) ────────────────────────────────────────────
export const MENTOR_ACTION_KPI_CODE = 'team_training_accountability';
export class PembinaanError extends Error {
	constructor(message: string, public status: number) { super(message); }
}

/**
 * Atasan mencatat pembinaan atas bawahannya. Memakai koleksi kpi_action_plans yang SAMA dengan yang diperiksa gate G_KPI_MENTOR_ACCOUNTABILITY di erp-epi
 * (kpi_code = team_training_accountability, pic = atasan, period = YYYY-MM). Satu plan terbuka per atasan per bulan; catatan berikutnya ditambahkan ke
 * uraian plan itu (idempoten terhadap gate). Otorisasi: bawahan HARUS ada di tim hasil resolveTeamMembers (bukan id dari klien semata).
 */
export async function catatPembinaan(
	manager: { id: number; nama_karyawan?: string | null; divisi?: string | null; email_company?: string | null },
	input: { memberId: number; catatan: string; targetSelesai?: string },
	today = new Date()
): Promise<{ planId: number; created: boolean }> {
	const catatan = String(input.catatan || '').trim().slice(0, 1500);
	if (catatan.length < 5) throw new PembinaanError('Catatan pembinaan minimal 5 karakter.', 400);
	const c = await loadMentorConfig();
	if (c.mode === 'off') throw new PembinaanError('Fitur pembinaan tim sedang dinonaktifkan.', 403);
	const members = await resolveTeamMembers(manager.id, c);
	const member = members.find((m) => Number(m.id) === Number(input.memberId));
	if (!member) throw new PembinaanError('Karyawan ini bukan bawahan Anda.', 403);

	const period = today.toISOString().slice(0, 7);
	const tgl = today.toISOString().slice(0, 10);
	const baris = `[${tgl}] ${member.nama_karyawan}: ${catatan}`;
	const open = (await directusServerJson<{ data: { id: number; description: string | null }[] }>(
		`/items/kpi_action_plans?filter=${enc(JSON.stringify({ _and: [{ pic_karyawan_id: { _eq: manager.id } }, { period: { _eq: period } }, { kpi_code: { _eq: MENTOR_ACTION_KPI_CODE } }, { status: { _in: ['open', 'in_progress'] } }] }))}&fields=id,description&limit=1`
	).catch((e: any) => {
		throw new PembinaanError(`Action Plan belum aktif di sistem (${e?.message || 'koleksi tidak terbaca'}). Hubungi HRD.`, 503);
	}))?.data?.[0];

	if (open) {
		const desc = `${open.description || ''}\n${baris}`.trim().slice(0, 4000);
		await directusServerJson(`/items/kpi_action_plans/${open.id}`, { method: 'PATCH', body: JSON.stringify({ description: desc }) });
		return { planId: open.id, created: false };
	}
	const due = input.targetSelesai && /^\d{4}-\d{2}-\d{2}$/.test(input.targetSelesai) ? input.targetSelesai : new Date(today.getTime() + 14 * DAY).toISOString().slice(0, 10);
	const created = (await directusServerJson<{ data: { id: number } }>('/items/kpi_action_plans', {
		method: 'POST',
		body: JSON.stringify({
			department: manager.divisi || 'GENERAL', period, kpi_code: MENTOR_ACTION_KPI_CODE, kpi_name: 'Akuntabilitas Training & Pembinaan Tim',
			category: 'inovasi', description: baris, target_selesai: due, pic_karyawan_id: manager.id, pic_nama: manager.nama_karyawan || null,
			status: 'open', created_by: String(manager.email_company || `karyawan:${manager.id}`).slice(0, 120)
		})
	}))?.data;
	if (!created?.id) throw new PembinaanError('Gagal menyimpan catatan pembinaan.', 500);
	return { planId: created.id, created: true };
}
