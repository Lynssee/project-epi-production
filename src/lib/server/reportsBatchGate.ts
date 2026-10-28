// src/lib/server/reportsBatchGate.ts
// ⚠️ SERVER-ONLY. R2-07 — gerbang tulis laporan harian PER ELEMEN (POST array lolos gerbang di versi lama),
// fail-open BERTANDA (GATE_ERROR) dan gate G_LH_TANGGAL_UNIK. Kembar dari erp-epi
// src/lib/server/gates/reportsBatchGate.js — jaga keduanya tetap sama.
// Murni terhadap I/O: akses (evaluasi gate, DB, audit) disuntikkan lewat opts supaya mudah diuji.

import { findTenagaTanpaNama } from '$lib/shared/manpowerGroups';

export const GATE_ERROR_FLAG = 'GATE_ERROR';
export const LH_TANGGAL_UNIK = 'G_LH_TANGGAL_UNIK';
export const LH_TENAGA_TANPA_NAMA = 'G_LH_TENAGA_TANPA_NAMA';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const dayKeyOf = (v: unknown): string | null => {
	const k = String(v ?? '').slice(0, 10);
	return DAY_RE.test(k) ? k : null;
};
const projectIdOf = (v: any) => (v && typeof v === 'object' ? v.id : v);

export function nextDayKey(day: string): string | null {
	const k = dayKeyOf(day);
	if (!k) return null;
	const [y, m, d] = k.split('-').map(Number);
	const t = new Date(Date.UTC(y, m - 1, d));
	if (Number.isNaN(t.getTime()) || t.getUTCMonth() !== m - 1) return null;
	t.setUTCDate(t.getUTCDate() + 1);
	return t.toISOString().slice(0, 10);
}

export interface GateView {
	gate_key: string;
	label?: string;
	message?: string;
	tab?: string;
}
export interface RejectedElement {
	index: number;
	gates: GateView[];
	selfApprovalBlocked: boolean;
	overrideNotAvailableHere?: boolean;
}
type DupMode = 'shadow' | 'warn' | 'soft' | 'hard';

export interface ExtraCheck {
	gateKey: string;
	label: string;
	tab?: string;
	appliesTo?: 'create' | 'all';
	mode: () => Promise<DupMode>;
	/** Pesan pelanggaran, null = lolos. */
	run: (el: any, ctx: { isCreate: boolean; index: number }) => Promise<string | null>;
}

export interface BatchOpts {
	evaluate: (el: any, index: number) => Promise<any>;
	isCreate?: boolean;
	dupMode?: () => Promise<DupMode>;
	findExisting?: (projectId: any, dayKey: string) => Promise<Array<number | string>>;
	multiShiftProjects?: () => Promise<Set<string>>;
	audit?: (entry: { gate: string; decision: string; record: any; reason: string; payload?: any }) => Promise<void>;
	/** Mode G_LH_TENAGA_TANPA_NAMA (K3: harian wajib nama dari penugasan). */
	tenagaMode?: () => Promise<DupMode>;
	/** Gate isi laporan lain (R2-08: lapor mundur, volume wajar, foto harian, pola datar). */
	extraChecks?: ExtraCheck[];
	previousFlags?: string[];
}

const gatesView = (list: any[] | undefined): GateView[] =>
	(list || []).map((g) => ({ gate_key: g.gate_key, label: g.label, message: g.message, tab: g.tab }));

export async function gateReportElements(
	elements: any[],
	opts: BatchOpts
): Promise<{ accepted: Array<{ index: number; element: any }>; rejected: RejectedElement[] }> {
	const {
		evaluate,
		isCreate = false,
		dupMode = async () => 'shadow' as DupMode,
		findExisting = async () => [],
		multiShiftProjects = async () => new Set<string>(),
		audit = async () => {},
		previousFlags = [],
		tenagaMode = async () => 'shadow' as DupMode,
		extraChecks = []
	} = opts;

	const accepted: Array<{ index: number; element: any }> = [];
	const rejected: RejectedElement[] = [];
	const seenInBatch = new Map<string, number>();
	const existingCache = new Map<string, Array<number | string>>();
	let multiShift: Set<string> | null = null;
	let dupModeCache: DupMode | null = null;
	let tenagaModeCache: DupMode | null = null;
	const extraModeCache = new Map<string, DupMode>();

	for (let index = 0; index < elements.length; index++) {
		const el = elements[index];
		if (!el || typeof el !== 'object' || Array.isArray(el)) {
			accepted.push({ index, element: el }); // bukan objek laporan — biarkan Directus yang menolak
			continue;
		}

		let result: any = null;
		try {
			result = await evaluate(el, index);
		} catch (e: any) {
			// Fail-open BERTANDA: laporan tetap tersimpan, tapi terlihat di antrean review (bukan "bersih tanpa skor").
			console.error(`[reportsBatchGate] evaluasi gate gagal untuk elemen #${index}, fail-open bertanda ${GATE_ERROR_FLAG}:`, e);
			el.quality_score = null;
			el.quality_flags = [GATE_ERROR_FLAG];
			el.quality_evaluated_at = new Date().toISOString();
			await audit({
				gate: 'LAPORAN_WRITE_GATE',
				decision: 'warn',
				record: el.id ?? null,
				reason: `${GATE_ERROR_FLAG}: ${e?.message || e}`.slice(0, 500),
				payload: { project_id: projectIdOf(el.project_id) ?? null, date: dayKeyOf(el.date) }
			}).catch(() => {});
		}

		if (result) {
			if (result.decision === 'reject') {
				rejected.push({ index, gates: gatesView(result.blockingGates), selfApprovalBlocked: !!result.selfApprovalBlocked });
				continue;
			}
			if (result.decision === 'override') {
				// Lapangan tidak punya jalur override (itu tugas admin di proxy ERP).
				rejected.push({ index, gates: gatesView(result.blockingGates), selfApprovalBlocked: false, overrideNotAvailableHere: true });
				continue;
			}
			el.quality_score = result.qualityFields.quality_score;
			el.quality_flags = [...(result.qualityFields.quality_flags || [])];
			if (!isCreate && previousFlags.includes(LH_TANGGAL_UNIK)) el.quality_flags.push(LH_TANGGAL_UNIK);
			el.quality_evaluated_at = result.qualityFields.quality_evaluated_at;
		}

		// G_LH_TENAGA_TANPA_NAMA (K3) — hanya bila payload membawa kolom tenaga. Pekerja tanpa nama tidak bisa masuk absensi/gaji.
		if (el.manpower !== undefined) {
			try {
				const tanpa = findTenagaTanpaNama(el.manpower);
				if (tanpa.length) {
					if (tenagaModeCache === null) tenagaModeCache = await tenagaMode();
					const total = tanpa.reduce((n, t) => n + t.tanpa_nama, 0);
					const message = `Tab Tenaga: ${total} pekerja belum dipilih namanya (${tanpa.map((t) => `${t.role} ${t.tanpa_nama}`).join(', ')}). Pilih nama dari daftar penugasan agar masuk absensi dan bisa dibayar.`;
					if (tenagaModeCache === 'hard') {
						rejected.push({
							index,
							gates: [{ gate_key: LH_TENAGA_TANPA_NAMA, label: 'Pekerja harian wajib bernama', message, tab: 'tenaga' }],
							selfApprovalBlocked: false
						});
						continue;
					}
					if (tenagaModeCache === 'soft' || tenagaModeCache === 'warn') {
						el.quality_flags = [...new Set([...(el.quality_flags || []), LH_TENAGA_TANPA_NAMA])];
					}
					await audit({
						gate: LH_TENAGA_TANPA_NAMA,
						decision: tenagaModeCache === 'shadow' ? 'shadow' : 'warn',
						record: el.id ?? null,
						reason: message,
						payload: { project_id: projectIdOf(el.project_id) ?? null, date: dayKeyOf(el.date), tanpa_nama: total }
					}).catch(() => {});
				}
			} catch (e) {
				console.error('[reportsBatchGate] cek G_LH_TENAGA_TANPA_NAMA gagal (dilewati, laporan tetap diproses):', e);
			}
		}

		// Gate isi laporan tambahan (R2-08). shadow = audit saja, soft/warn = tanda di quality_flags, hard = tolak.
		let ditolakExtra = false;
		for (const chk of extraChecks) {
			if (chk.appliesTo === 'create' && !isCreate) continue;
			try {
				const message = await chk.run(el, { isCreate, index });
				if (!message) continue;
				if (!extraModeCache.has(chk.gateKey)) extraModeCache.set(chk.gateKey, await chk.mode());
				const mode = extraModeCache.get(chk.gateKey) as DupMode;
				if (mode === 'hard') {
					rejected.push({
						index,
						gates: [{ gate_key: chk.gateKey, label: chk.label, message, tab: chk.tab || 'meta' }],
						selfApprovalBlocked: false
					});
					ditolakExtra = true;
					break;
				}
				if (mode === 'soft' || mode === 'warn') el.quality_flags = [...new Set([...(el.quality_flags || []), chk.gateKey])];
				await audit({
					gate: chk.gateKey,
					decision: mode === 'shadow' ? 'shadow' : 'warn',
					record: el.id ?? null,
					reason: message,
					payload: { project_id: projectIdOf(el.project_id) ?? null, date: dayKeyOf(el.date) }
				}).catch(() => {});
			} catch (e) {
				console.error(`[reportsBatchGate] cek ${chk.gateKey} gagal (dilewati, laporan tetap diproses):`, e);
			}
		}
		if (ditolakExtra) continue;

		if (isCreate) {
			const pid = projectIdOf(el.project_id);
			const day = dayKeyOf(el.date);
			if (pid != null && pid !== '' && day) {
				try {
					const key = `${pid}|${day}`;
					let dupIds: string[] = [];
					if (seenInBatch.has(key)) dupIds.push(`elemen #${seenInBatch.get(key)} dalam kiriman yang sama`);
					else seenInBatch.set(key, index);
					if (!existingCache.has(key)) existingCache.set(key, await findExisting(pid, day));
					dupIds = [...dupIds, ...(existingCache.get(key) || []).map((id) => `#${id}`)];

					if (dupIds.length) {
						if (multiShift === null) multiShift = await multiShiftProjects();
						if (!multiShift.has(String(pid))) {
							if (dupModeCache === null) dupModeCache = await dupMode();
							const message = `Laporan tanggal ${day} untuk proyek ini sudah ada (${dupIds.join(', ')}). Buka & edit laporan itu, bukan membuat yang baru.`;
							if (dupModeCache === 'hard') {
								rejected.push({
									index,
									gates: [{ gate_key: LH_TANGGAL_UNIK, label: 'Satu laporan per proyek per tanggal', message, tab: 'meta' }],
									selfApprovalBlocked: false
								});
								continue;
							}
							if (dupModeCache === 'soft' || dupModeCache === 'warn') {
								el.quality_flags = [...new Set([...(el.quality_flags || []), LH_TANGGAL_UNIK])];
							}
							await audit({
								gate: LH_TANGGAL_UNIK,
								decision: dupModeCache === 'shadow' ? 'shadow' : 'warn',
								record: null,
								reason: message,
								payload: { project_id: pid, date: day }
							}).catch(() => {});
						}
					}
				} catch (e) {
					console.error('[reportsBatchGate] cek G_LH_TANGGAL_UNIK gagal (dilewati, laporan tetap diproses):', e);
				}
			}
		}

		accepted.push({ index, element: el });
	}

	return { accepted, rejected };
}

/** Query "laporan non-rejected pada proyek+tanggal" (rentang [hari, hari+1) — laporan berjam tetap ikut). */
export function makeFindExisting(fetchJson: (path: string) => Promise<any>) {
	return async (projectId: any, dayKey: string) => {
		const next = nextDayKey(dayKey);
		const res = await fetchJson(
			`/items/reports?filter[project_id][_eq]=${encodeURIComponent(projectId)}` +
				`&filter[date][_gte]=${dayKey}&filter[date][_lt]=${next}&filter[status][_neq]=rejected&fields=id&limit=5`
		);
		return (Array.isArray(res?.data) ? res.data : []).map((r: any) => r.id);
	};
}

export const MULTI_SHIFT_SETTING_KEY = 'project.laporan.multi_shift_project_ids';
const SETTING_TTL_MS = 5 * 60 * 1000;
let msCache: { at: number; value: Set<string> } = { at: 0, value: new Set() };

/** Daftar proyek multi-shift (system_settings, diatur di Setelan Project ERP). Gagal baca → kosong + log. */
export function makeMultiShiftLoader(fetchJson: (path: string) => Promise<any>) {
	return async (): Promise<Set<string>> => {
		const now = Date.now();
		if (now - msCache.at < SETTING_TTL_MS) return msCache.value;
		try {
			const res = await fetchJson(
				`/items/system_settings?filter[setting_key][_eq]=${MULTI_SHIFT_SETTING_KEY}&fields=setting_value&limit=1`
			);
			let raw = res?.data?.[0]?.setting_value;
			if (typeof raw === 'string') {
				try {
					raw = JSON.parse(raw);
				} catch {
					raw = [];
				}
			}
			const set = new Set<string>((Array.isArray(raw) ? raw : []).map((x: any) => String(x)));
			msCache = { at: now, value: set };
			return set;
		} catch (e: any) {
			console.error('[reportsBatchGate] gagal baca setelan multi-shift (dianggap kosong):', e?.message || e);
			return new Set<string>();
		}
	};
}

/** Penulis gate_audit_log best-effort. */
export function makeAuditWriter(
	fetchJson: (path: string, init?: any) => Promise<any>,
	ctx: { method: string; userEmail?: string | null }
) {
	return async ({ gate, decision, record, reason, payload }: { gate: string; decision: string; record: any; reason: string; payload?: any }) => {
		try {
			await fetchJson('/items/gate_audit_log', {
				method: 'POST',
				body: JSON.stringify({
					gate,
					collection: 'items/reports',
					method: ctx.method,
					record_id: record != null ? String(record) : null,
					decision,
					reason,
					payload_snapshot: payload ?? null,
					user_email: ctx.userEmail || null
				})
			});
		} catch (e: any) {
			console.error('[reportsBatchGate] gagal menulis gate_audit_log:', e?.message || e);
		}
	};
}
