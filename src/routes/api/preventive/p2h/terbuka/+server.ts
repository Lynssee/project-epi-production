// src/routes/api/preventive/p2h/terbuka/+server.ts
// PMT-49: daftar sesi P2H yang belum ditutup (jam_selesai_pakai kosong).
//  - selalu: sesi milik operator yang login (operator_id = personnel sendiri);
//  - bila ?equipment_id=…: ditambah sesi lama unit itu milik siapa pun (peringatan "sesi lama belum ditutup").
// PMT-49 §4.1: ?leader=1 -> ditambah sesi terbuka unit yang sedang dipinjam di proyek yang DIPIMPIN pemanggil (leader/co-leader).
// Relasi di-fetch terpisah (Aturan #2): sesi dulu, lalu nama unit.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticatePreventiveOperator } from '$lib/server/preventive/preventiveGuard';
import { directusServerJson } from '$lib/server/directus';
import { resolveLedProjectIds } from '$lib/server/projectLeaderGuard';
import { resolveGateMode } from '$lib/server/gateDefinitionsMode';
import { writeGateAudit } from '$lib/server/gates/gateAudit';

// PMT-49 §4.3 — gate SHADOW: peringatan "sesi lama belum ditutup" + jejak di gate_audit_log. TIDAK menahan P2H baru
// (kenaikan ke soft = keputusan terpisah setelah angka kepatuhan). Mode diatur Superadmin di erp-epi /settings/gates.
export const GATE_SESI_LAMA = 'G_P2H_SESI_LAMA_TERBUKA';
const LOG_THROTTLE_MS = 6 * 60 * 60 * 1000;
const recentLogs = new Map<string, number>();
const wibToday = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

const SESSION_FIELDS = 'id,equipment_id,operator_id,date';
const MAX_ROWS = 100;
const LOAN_STATUS_AKTIF = '8d23640e-5726-4480-a9fb-693e3ea6c8fa'; // internal_loan_log.status "aktif" (sama dengan erp-epi compressor-compliance)

type SessionRow = {
	id: string;
	equipment_id: string;
	operator_id: string | null;
	date: string;
};

async function fetchOpen(extraFilter: Record<string, string>): Promise<SessionRow[]> {
	const q = new URLSearchParams({
		'filter[jam_selesai_pakai][_null]': 'true',
		fields: SESSION_FIELDS,
		sort: '-date',
		limit: String(MAX_ROWS),
		...extraFilter
	});
	const res = await directusServerJson<{ data: SessionRow[] }>(`/items/p2h_session?${q.toString()}`);
	return res?.data ?? [];
}

export const GET: RequestHandler = async (event) => {
	const { personnel } = await authenticatePreventiveOperator(event);
	const equipmentId = event.url.searchParams.get('equipment_id')?.trim() || '';
	const leaderMode = event.url.searchParams.get('leader') === '1';

	let mine: SessionRow[];
	let ofUnit: SessionRow[] = [];
	try {
		mine = await fetchOpen({ 'filter[operator_id][_eq]': personnel.id });
		if (equipmentId) ofUnit = await fetchOpen({ 'filter[equipment_id][_eq]': equipmentId });
	} catch (err) {
		console.error('[p2h/terbuka] gagal membaca sesi terbuka', err);
		throw error(502, 'Gagal membaca daftar sesi P2H terbuka. Coba lagi sebentar lagi.');
	}

	// Sesi unit di proyek yang saya pimpin (hanya bila diminta). Gagal membaca -> daftar utama tetap dikembalikan, tapi dilog.
	let ofLeader: SessionRow[] = [];
	if (leaderMode) {
		try {
			const karyawan = personnel.karyawan_id ? { id: Number(personnel.karyawan_id), nama_karyawan: personnel.name } : null;
			const projectIds = karyawan ? await resolveLedProjectIds(karyawan) : [];
			if (projectIds.length) {
				const loans = await directusServerJson<{ data: Array<{ equipment_id: any }> }>(
					`/items/internal_loan_log?${new URLSearchParams({
						'filter[project_id][_in]': projectIds.join(','),
						'filter[status][_eq]': LOAN_STATUS_AKTIF,
						fields: 'equipment_id',
						limit: '-1'
					}).toString()}`
				);
				const eqIds = [...new Set((loans?.data || []).map((l) => (l.equipment_id && typeof l.equipment_id === 'object' ? l.equipment_id.id : l.equipment_id)).filter(Boolean))];
				if (eqIds.length) ofLeader = await fetchOpen({ 'filter[equipment_id][_in]': eqIds.join(',') });
			}
		} catch (err) {
			console.error('[p2h/terbuka] gagal membaca sesi unit proyek yang dipimpin', err);
		}
	}
	const leaderIds = new Set(ofLeader.map((s) => s.id));

	const byId = new Map<string, SessionRow>();
	for (const s of [...mine, ...ofUnit, ...ofLeader]) byId.set(s.id, s);
	const sessions = [...byId.values()].sort((a, b) => String(b.date).localeCompare(String(a.date)));

	// Nama unit — satu query terpisah untuk semua sesi (bukan per baris).
	const names = new Map<string, { name: string; code: string | null }>();
	const eqIds = [...new Set(sessions.map((s) => s.equipment_id).filter(Boolean))];
	if (eqIds.length) {
		try {
			const q = new URLSearchParams({
				'filter[id][_in]': eqIds.join(','),
				fields: 'id,name,code',
				limit: String(eqIds.length)
			});
			const res = await directusServerJson<{ data: Array<{ id: string; name: string; code: string | null }> }>(
				`/items/equipment?${q.toString()}`
			);
			for (const e of res?.data ?? []) names.set(e.id, { name: e.name, code: e.code ?? null });
		} catch (err) {
			// Nama unit hanya pelengkap tampilan — daftar tetap dikembalikan.
			console.error('[p2h/terbuka] gagal membaca nama unit', err);
		}
	}

	// Jejak gate: hanya saat dipanggil dari halaman P2H unit (ada equipment_id) dan ada sesi LAMA yang masih terbuka.
	let gate: { key: string; mode: string } | null = null;
	if (equipmentId) {
		const lama = sessions.filter((x) => x.equipment_id === equipmentId && x.date < wibToday());
		if (lama.length > 0) {
			try {
				const mode = await resolveGateMode(GATE_SESI_LAMA, 'p2h_session');
				gate = { key: GATE_SESI_LAMA, mode };
				const k = `${equipmentId}:${personnel.id}:${wibToday()}`;
				if (!recentLogs.has(k) || Date.now() - (recentLogs.get(k) as number) > LOG_THROTTLE_MS) {
					recentLogs.set(k, Date.now());
					if (recentLogs.size > 500) recentLogs.clear();
					void writeGateAudit({
						gate: GATE_SESI_LAMA,
						collection: 'p2h_session',
						recordId: lama[0].id,
						decision: mode === 'shadow' ? 'shadow' : 'warn',
						reason: `${lama.length} sesi P2H lama belum ditutup (terlama ${lama[lama.length - 1].date}); P2H baru tidak ditahan.`,
						snapshot: {
							equipment_id: equipmentId,
							operator_id: personnel.id,
							jumlah_sesi_lama: lama.length,
							tanggal_terlama: lama[lama.length - 1].date,
							mode
						},
						email: null
					});
				}
			} catch (err) {
				// Jejak shadow pelengkap — gagal tidak boleh mengganggu banner/ P2H, tapi harus terlihat di log.
				console.error('[p2h/terbuka] gagal menyiapkan jejak gate', GATE_SESI_LAMA, err);
			}
		}
	}

	// Nama operator (satu query terpisah) hanya untuk tampilan daftar Leader.
	const opNames = new Map<string, string>();
	const opIds = [...new Set(sessions.filter((s) => leaderIds.has(s.id) && s.operator_id).map((s) => s.operator_id as string))];
	if (opIds.length) {
		try {
			const r = await directusServerJson<{ data: Array<{ id: string; name: string }> }>(`/items/personnel?filter[id][_in]=${opIds.join(',')}&fields=id,name&limit=${opIds.length}`);
			for (const p of r?.data ?? []) opNames.set(p.id, p.name);
		} catch (err) {
			console.error('[p2h/terbuka] gagal membaca nama operator', err);
		}
	}

	return json({
		gate,
		me: personnel.id,
		sessions: sessions.map((s) => ({
			id: s.id,
			equipment_id: s.equipment_id,
			equipment_name: names.get(s.equipment_id)?.name ?? null,
			equipment_code: names.get(s.equipment_id)?.code ?? null,
			operator_id: s.operator_id,
			is_mine: s.operator_id === personnel.id,
			is_leader_scope: leaderIds.has(s.id) && s.operator_id !== personnel.id,
			operator_name: s.operator_id ? opNames.get(s.operator_id) ?? null : null,
			date: s.date
		}))
	});
};
