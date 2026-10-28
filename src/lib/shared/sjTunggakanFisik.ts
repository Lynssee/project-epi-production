// src/lib/shared/sjTunggakanFisik.ts
// Penajaman Gate SJ Fase 3 — padanan sisi lapangan dari erp-epi `src/lib/server/gates/sjTunggakanFisik.js`
// (gate G_SJ_TUNGGAKAN_FISIK). LOGIKA HARUS SAMA: ubah di kedua repo sekaligus. Murni, tanpa Directus.

export const TUNGGAKAN_RECEIVED_STAGES = ['tiba_lokasi', 'diterima', 'selisih', 'dokumen_kembali', 'tutup'] as const;
// diterima_pic = admin sudah menerima fisik lewat Handover QR (padanan erp-epi sjTunggakanFisik.js).
export const RANGKAP_KEMBALI_STATUSES = ['diterima_pic', 'discan', 'diarsip'] as const;

export interface TunggakanRules {
	maxOutstanding: number;
	graceDays: number;
	scope: 'karyawan_pengaju' | 'proyek';
	requireFullTtd: boolean;
	requireAdminReceipt: boolean;
	enforceFrom: string;
	lookbackDays: number;
}

export const TUNGGAKAN_DEFAULTS: TunggakanRules = {
	maxOutstanding: 3,
	graceDays: 3,
	scope: 'karyawan_pengaju',
	requireFullTtd: true,
	requireAdminReceipt: true,
	enforceFrom: '2026-10-13',
	lookbackDays: 90
};

const isBlank = (v: unknown) => v == null || String(v).trim() === '' || String(v).trim() === '-';

export function normalizeTunggakanRules(raw: Partial<Record<keyof TunggakanRules, unknown>> = {}): TunggakanRules {
	const d = TUNGGAKAN_DEFAULTS;
	const int = (v: unknown, fb: number, min: number) => {
		const n = Number(v);
		return Number.isFinite(n) && n >= min ? Math.floor(n) : fb;
	};
	const bool = (v: unknown, fb: boolean) => (typeof v === 'boolean' ? v : v == null ? fb : v === 'true' || v === '1' || v === 1);
	return {
		maxOutstanding: int(raw.maxOutstanding, d.maxOutstanding, 0),
		graceDays: int(raw.graceDays, d.graceDays, 0),
		scope: raw.scope === 'proyek' ? 'proyek' : 'karyawan_pengaju',
		requireFullTtd: bool(raw.requireFullTtd, d.requireFullTtd),
		requireAdminReceipt: bool(raw.requireAdminReceipt, d.requireAdminReceipt),
		enforceFrom: isBlank(raw.enforceFrom) ? '' : String(raw.enforceFrom).slice(0, 10),
		lookbackDays: int(raw.lookbackDays, d.lookbackDays, 1)
	};
}

/** Selisih hari KERJA (Sen–Jum) dari `from` sampai `to`. */
export function workingDaysBetween(from: string | Date, to: string | Date): number {
	const a = new Date(from);
	const b = new Date(to);
	if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b <= a) return 0;
	const cur = new Date(a.getFullYear(), a.getMonth(), a.getDate());
	const end = new Date(b.getFullYear(), b.getMonth(), b.getDate());
	let days = 0;
	while (cur < end) {
		cur.setDate(cur.getDate() + 1);
		const dow = cur.getDay();
		if (dow !== 0 && dow !== 6) days++;
	}
	return days;
}

export interface TunggakanSj {
	id: number | string;
	nomor_sj?: string | null;
	track_stage?: string | null;
	track_stage_at?: string | null;
	received_at?: string | null;
	scan_sj_file?: string | null;
}
export interface TunggakanLembar {
	status?: string | null;
	lembar_nama?: string | null;
	lembar_kode?: string | null;
	wajib_kembali?: boolean | null;
}
export interface TunggakanRow {
	id: number | string;
	nomor_sj: string;
	ageDays: number;
	reasons: string[];
}

export function receivedTimestamp(sj: TunggakanSj): string | null {
	if (!isBlank(sj?.received_at)) return sj.received_at as string;
	if ((TUNGGAKAN_RECEIVED_STAGES as readonly string[]).includes(String(sj?.track_stage)) && !isBlank(sj?.track_stage_at)) {
		return sj.track_stage_at as string;
	}
	return null;
}

export function computeTunggakanFisik(
	sjList: TunggakanSj[],
	rangkapBySj: Map<string, TunggakanLembar[]>,
	rulesIn: Partial<TunggakanRules>,
	now: Date = new Date()
): { rows: TunggakanRow[]; count: number; oldestDays: number } {
	const r = normalizeTunggakanRules(rulesIn);
	const efTime = r.enforceFrom ? new Date(`${r.enforceFrom}T00:00:00`).getTime() : NaN;
	const rows: TunggakanRow[] = [];
	for (const sj of Array.isArray(sjList) ? sjList : []) {
		const recv = receivedTimestamp(sj);
		if (!recv) continue;
		if (!Number.isNaN(efTime) && new Date(recv).getTime() < efTime) continue;
		const reasons: string[] = [];
		if (r.requireFullTtd && isBlank(sj.scan_sj_file)) reasons.push('scan SJ bertanda tangan belum diunggah');
		if (r.requireAdminReceipt) {
			const belum = (rangkapBySj.get(String(sj.id)) || []).filter(
				(l) => l.wajib_kembali !== false && !(RANGKAP_KEMBALI_STATUSES as readonly string[]).includes(String(l.status))
			);
			if (belum.length) reasons.push(`lembar belum diarsip admin: ${belum.map((l) => l.lembar_nama || l.lembar_kode).join(', ')}`);
		}
		if (!reasons.length) continue;
		const ageDays = workingDaysBetween(recv, now);
		if (ageDays <= r.graceDays) continue;
		rows.push({ id: sj.id, nomor_sj: sj.nomor_sj || `#${sj.id}`, ageDays, reasons });
	}
	rows.sort((a, b) => b.ageDays - a.ageDays);
	return { rows, count: rows.length, oldestDays: rows[0]?.ageDays ?? 0 };
}
