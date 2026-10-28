// src/lib/server/gates/laporanHarianHilirGate.ts
// ⚠️ SERVER-ONLY. Kembar dari erp-epi-1/src/lib/server/gates/laporanHarianGate.js
// (evaluateLaporanMutuGate/evaluateLaporanRevisiGate/evaluateLaporanHilirGates) —
// G_LAPOR sendiri TIDAK dipindah ke sini (butuh evaluasi "kemarin bolong" yang sudah
// dievaluasi sisi admin; titik hilir lapangan hanya butuh mutu+revisi).
//
// Fase 4 (Gate Keras Disiplin Data & Laporan Harian, 17 Sep 2026). Dibaca LANGSUNG
// lewat Directus (koleksi sama dengan erp-epi-1) — TIDAK mengimpor kode erp-epi-1
// (beda repo/deploy), pola sama laporanWriteGate.ts.

import { directusServerJson } from '../directus';

const VALID_MODES = ['shadow', 'warn', 'block'] as const;
type GateMode = (typeof VALID_MODES)[number];

function isValidMode(m: any): m is GateMode {
	return VALID_MODES.includes(m);
}

function inFuture(dateVal: string | null): boolean {
	if (!dateVal) return false;
	const d = new Date(dateVal);
	if (isNaN(d.getTime())) return false;
	return d.getTime() > Date.now();
}

interface Rule {
	gate_mutu_mode: GateMode;
	gate_revisi_mode: GateMode;
	mutu_ambang: number;
	enforce_from: string | null;
}

async function readRule(): Promise<Rule> {
	try {
		const r: any = (await directusServerJson('/items/laporan_compliance_rule/1'))?.data || {};
		return {
			gate_mutu_mode: isValidMode(r.gate_mutu_mode) ? r.gate_mutu_mode : 'shadow',
			gate_revisi_mode: isValidMode(r.gate_revisi_mode) ? r.gate_revisi_mode : 'warn',
			mutu_ambang: Number.isFinite(r.mutu_ambang) ? r.mutu_ambang : 70,
			enforce_from: r.enforce_from || null
		};
	} catch {
		return { gate_mutu_mode: 'shadow', gate_revisi_mode: 'warn', mutu_ambang: 70, enforce_from: null };
	}
}

export interface HilirGateResult {
	gate: string;
	mode: GateMode | 'shadow';
	allowed: boolean;
	reason: string;
}

export async function evaluateLaporanMutuGate(karyawanId: number | string | null): Promise<HilirGateResult> {
	const base: HilirGateResult = { gate: 'G_LAPOR_MUTU', mode: 'shadow', allowed: true, reason: '' };
	if (!karyawanId) return { ...base, reason: 'Tidak ada karyawanId — dilewati.' };
	try {
		const rule = await readRule();
		const mode = inFuture(rule.enforce_from) ? 'shadow' : rule.gate_mutu_mode;
		const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
		const filter = encodeURIComponent(JSON.stringify({
			_and: [
				{ karyawan_id: { _eq: karyawanId } },
				{ date: { _gte: since } },
				{ quality_score: { _nnull: true } },
				{ quality_score: { _lt: rule.mutu_ambang } }
			]
		}));
		const rows: any[] = (await directusServerJson(
			`/items/reports?filter=${filter}&fields=id,date,quality_score&sort=-date&limit=20`
		))?.data || [];
		const allowed = rows.length === 0;
		return {
			gate: 'G_LAPOR_MUTU', mode, allowed,
			reason: allowed
				? `Tidak ada laporan bermutu rendah (<${rule.mutu_ambang}) 14 hari terakhir.`
				: `${rows.length} laporan 14 hari terakhir bermutu di bawah ${rule.mutu_ambang}.`
		};
	} catch (e: any) {
		console.warn('[laporanHarianHilirGate] gagal evaluasi G_LAPOR_MUTU (fail-open):', e?.message || e);
		return { ...base, reason: 'Gagal evaluasi gate — dilewati.' };
	}
}

export async function evaluateLaporanRevisiGate(karyawanId: number | string | null): Promise<HilirGateResult> {
	const base: HilirGateResult = { gate: 'G_LAPOR_REVISI', mode: 'warn', allowed: true, reason: '' };
	if (!karyawanId) return { ...base, reason: 'Tidak ada karyawanId — dilewati.' };
	try {
		const rule = await readRule();
		const mode = inFuture(rule.enforce_from) ? 'shadow' : rule.gate_revisi_mode;
		const today = new Date().toISOString().slice(0, 10);
		const filter = encodeURIComponent(JSON.stringify({
			_and: [
				{ karyawan_id: { _eq: karyawanId } },
				{ status: { _eq: 'revision_requested' } },
				{ revisi_batas: { _lt: today } }
			]
		}));
		const rows: any[] = (await directusServerJson(
			`/items/reports?filter=${filter}&fields=id,date,revisi_batas&sort=revisi_batas&limit=20`
		))?.data || [];
		const allowed = rows.length === 0;
		return {
			gate: 'G_LAPOR_REVISI', mode, allowed,
			reason: allowed
				? 'Tidak ada tunggakan revisi laporan harian lewat batas waktu.'
				: `${rows.length} laporan harian revisi lewat batas waktu (paling lama: ${rows[0]?.revisi_batas}). Perbaiki di /laporan/perlu-diperbaiki.`
		};
	} catch (e: any) {
		console.warn('[laporanHarianHilirGate] gagal evaluasi G_LAPOR_REVISI (fail-open):', e?.message || e);
		return { ...base, reason: 'Gagal evaluasi gate — dilewati.' };
	}
}

export async function evaluateLaporanHilirGates(karyawanId: number | string | null) {
	const [gMutu, gRevisi] = await Promise.all([
		evaluateLaporanMutuGate(karyawanId),
		evaluateLaporanRevisiGate(karyawanId)
	]);
	return { gMutu, gRevisi };
}
