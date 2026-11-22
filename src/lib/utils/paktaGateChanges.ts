// src/lib/utils/paktaGateChanges.ts
// MURNI (tanpa I/O): Pakta jenis GATE — perubahan aturan gate (KENAIKAN keketatan mode) yang wajib dikonfirmasi pekerja di rute tertentu.
// Sumber: gate_override_log (context 'mode_change'); kalimat `reason` disusun erp-epi gateChangeLog.formatGateChange:
//   "Mode G12 (PA-OPS): soft → hard · berlaku sejak 2026-11-01 · alasan: ..."
// Logika parse/eskalasi = salinan erp-epi src/lib/server/gates/gateModeChangeFeed.js (ubah di KEDUA repo).
// Versi perubahan = id baris log TERBARU yang memperketat gate itu → perubahan berikutnya (id lebih besar) wajib dikonfirmasi ulang.
import type { UnconfirmedItem } from './sopReadRequirement';

export const MODE_RANK: Record<string, number> = { '(bawaan)': 0, off: 0, shadow: 1, warn: 2, soft: 2, hard: 3 };

/** Bahasa pekerja (bukan istilah teknis). */
export const MODE_LABEL: Record<string, string> = {
	'(bawaan)': 'tanpa aturan',
	off: 'tanpa aturan',
	shadow: 'hanya dicatat',
	warn: 'peringatan',
	soft: 'ditahan (boleh lanjut dengan alasan)',
	hard: 'wajib dipenuhi (tidak bisa lanjut bila belum)'
};

const RE = /^Mode\s+(\S+)\s+\(([^)]+)\):\s*(\S+)\s*→\s*(\S+)(?:\s*·\s*berlaku sejak\s*(\d{4}-\d{2}-\d{2}))?/;

export interface ModeChange { gate_key: string; jenis: string; from: string; to: string; enforce_from: string | null }

export function parseModeChange(reason: unknown): ModeChange | null {
	const m = RE.exec(String(reason ?? '').trim());
	return m ? { gate_key: m[1], jenis: m[2], from: m[3], to: m[4], enforce_from: m[5] || null } : null;
}

export function isEscalation(from: string, to: string): boolean {
	const a = MODE_RANK[from];
	const b = MODE_RANK[to];
	return a !== undefined && b !== undefined && b > a;
}

export interface GateLogRow { id: number | string; date_created?: string | null; context?: string | null; reason?: string | null }
export interface GateChange { gate_key: string; version: number; from: string; to: string; enforce_from: string | null; date: string | null }
export interface GateDefRow { gate_key: string; nama?: string | null; hint?: string | null; message?: string | null }
export interface GateApprovalRow { doc_key: string; doc_version?: number | null }

/**
 * Perubahan gate TERBARU yang memperketat, untuk gate_keys yang diminta, dalam `days` hari terakhir.
 * Per (gate, jenis) yang terbaru menang — bila yang terbaru pelonggaran, gate/jenis itu tidak dihitung. Per gate dipilih id terbesar.
 */
export function latestGateChanges(rows: GateLogRow[], gateKeys: string[], opts: { days: number; now?: number }): Map<string, GateChange> {
	const want = new Set(gateKeys);
	const now = opts.now ?? Date.now();
	const cutoff = now - Math.max(1, opts.days) * 86_400_000;
	const sorted = [...(rows || [])].filter((r) => r && (!r.context || r.context === 'mode_change')).sort((a, b) => Number(b.id) - Number(a.id));
	const seen = new Set<string>();
	const out = new Map<string, GateChange>();
	for (const r of sorted) {
		const p = parseModeChange(r.reason);
		if (!p || !want.has(p.gate_key)) continue;
		const k = `${p.gate_key}|${p.jenis}`;
		if (seen.has(k)) continue;
		seen.add(k);
		if (!isEscalation(p.from, p.to)) continue;
		const t = r.date_created ? Date.parse(r.date_created) : NaN;
		if (Number.isFinite(t) && t < cutoff) continue;
		const id = Number(r.id);
		if (!Number.isInteger(id) || id <= 0) continue;
		const prev = out.get(p.gate_key);
		if (!prev || id > prev.version) out.set(p.gate_key, { gate_key: p.gate_key, version: id, from: p.from, to: p.to, enforce_from: p.enforce_from, date: r.date_created ?? null });
	}
	return out;
}

export function gateRingkasan(c: GateChange, def?: GateDefRow | null): string {
	const nama = def?.nama || c.gate_key;
	const sejak = c.enforce_from ? `, berlaku sejak ${c.enforce_from}` : '';
	const tip = def?.hint ? ` ${def.hint}` : def?.message ? ` ${def.message}` : '';
	return `Aturan "${nama}" diperketat: dari ${MODE_LABEL[c.from] ?? c.from} menjadi ${MODE_LABEL[c.to] ?? c.to}${sejak}.${tip}`.slice(0, 600);
}

/** Item pakta gate yang BELUM dikonfirmasi karyawan (approval doc_version >= versi perubahan = sudah). */
export function buildGateItems(input: { changes: Map<string, GateChange>; defs: GateDefRow[]; approvals: GateApprovalRow[] }): UnconfirmedItem[] {
	const defs = new Map((input.defs || []).map((d) => [d.gate_key, d]));
	const items: UnconfirmedItem[] = [];
	for (const c of input.changes.values()) {
		const done = (input.approvals || []).some((a) => a.doc_key === c.gate_key && Number(a.doc_version ?? 0) >= c.version);
		if (done) continue;
		const def = defs.get(c.gate_key);
		items.push({
			type: 'gate',
			id: c.version,
			gate_key: c.gate_key,
			gate_from: c.from,
			gate_to: c.to,
			flow_key: null,
			sop_id: null,
			title: def?.nama || c.gate_key,
			sop_code: null,
			kategori_sop: null,
			sub_kategori: null,
			approval_status: null,
			sosialisasi_end_date: c.enforce_from,
			version: c.version,
			ringkasan: gateRingkasan(c, def)
		});
	}
	return items.sort((a, b) => b.version - a.version);
}
