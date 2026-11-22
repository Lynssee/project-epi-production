// src/lib/server/ess/rndJalurGate.ts
// Gate G_TRN_RND_JALUR di titik daftar mandiri: program Track R&D hanya boleh diambil bila level prasyarat jalur sertifikasi sudah tercapai.
// Mode (shadow/warn/soft/hard) dibaca dari gate_definitions + gate_enforcement (diatur Superadmin di /settings/gates) — bukan hardcode.
//   shadow : lolos, kegagalan hanya dicatat di gate_audit_log      warn : lolos + peringatan
//   soft   : butuh `alasan` ≥ MIN_ALASAN (tercatat), tanpa alasan ditolak   hard : ditolak
// Gagal membaca data → FAIL-OPEN (lolos) + log jelas: gate tidak boleh melumpuhkan operasional (Aturan #3).
// Pendaftaran oleh HRD/otomasi tidak melewati gate ini (jalur pengecualian/dispensasi HRD).

import { directusServerJson } from '$lib/server/directus';
import { resolveGateMode, type GateMode } from '$lib/server/gateDefinitionsMode';
import { evalRndEnrollPrasyarat } from '$lib/utils/rndJalur.js';
import { getMyRndJalur, getRndLevels } from './rndJalur';

export const RND_JALUR_GATE_KEY = 'G_TRN_RND_JALUR';
export const RND_JALUR_DOC_TYPE = 'rnd_jalur';
export const MIN_ALASAN = 20;

export interface RndEnrollDecision {
	allow: boolean;
	/** Pesan untuk pengguna (peringatan bila lolos, alasan penolakan bila ditolak). */
	message?: string;
	/** Nilai untuk gate_audit_log.decision; null = tidak dicatat (lulus / tidak berlaku). */
	audit: 'shadow' | 'warn' | 'block' | null;
	usedAlasan?: boolean;
}

/** MURNI: keputusan dari mode + hasil evaluasi prasyarat (+ alasan pengecualian untuk soft). */
export function decideRndEnroll(mode: GateMode | string, evalResult: { status: string; reason?: string }, alasan = ''): RndEnrollDecision {
	if (evalResult.status !== 'failed') return { allow: true, audit: null };
	const reason = evalResult.reason || 'Prasyarat jalur R&D belum tercapai.';
	switch (mode) {
		case 'warn':
			return { allow: true, audit: 'warn', message: `${reason} Anda tetap bisa mendaftar, tetapi disarankan menyelesaikan prasyarat dulu.` };
		case 'soft':
			if (String(alasan ?? '').trim().length >= MIN_ALASAN) return { allow: true, audit: 'warn', usedAlasan: true };
			return { allow: false, audit: 'block', message: `${reason} Isi alasan pengecualian (minimal ${MIN_ALASAN} karakter) atau minta HRD mendaftarkan Anda.` };
		case 'hard':
			return { allow: false, audit: 'block', message: `${reason} Selesaikan program prasyarat dulu, atau minta HRD untuk dispensasi.` };
		default: // shadow / off / tak dikenal → tidak mengganggu
			return { allow: true, audit: mode === 'off' ? null : 'shadow' };
	}
}

async function audit(karyawan: { id: number }, programId: number, decision: string, reason: string, snapshot: Record<string, unknown>) {
	try {
		await directusServerJson('/items/gate_audit_log', {
			method: 'POST',
			body: JSON.stringify({ gate: RND_JALUR_GATE_KEY, collection: 'training_enrollment', method: 'CHECK', record_id: String(programId), decision, reason: reason.slice(0, 500), payload_snapshot: { karyawan_id: karyawan.id, ...snapshot }, user_email: null })
		});
	} catch (e) {
		console.error('[rndJalurGate] gagal mencatat gate_audit_log:', (e as Error)?.message);
	}
}

/**
 * Periksa prasyarat daftar mandiri. Hanya program yang termasuk jalur R&D yang memicu query (program lain: nol biaya tambahan).
 * Melempar `Error` bertanda status 409 bila ditolak.
 */
export async function guardRndEnroll(karyawan: { id: number }, program: { id: number; kode: string | null }, alasan = ''): Promise<{ peringatan?: string }> {
	try {
		const levels = await getRndLevels();
		if (!program.kode || !levels.some((l) => (l.programKodes as string[]).includes(program.kode as string))) return {};
		const mode = await resolveGateMode(RND_JALUR_GATE_KEY, RND_JALUR_DOC_TYPE);
		if (mode === ('off' as GateMode)) return {};
		const jalur = await getMyRndJalur(karyawan.id);
		const achievedKeys: string[] = jalur.levels.filter((l) => l.achieved).map((l) => l.key);
		const ev = (evalRndEnrollPrasyarat as any)({ programKode: program.kode, levels, achievedKeys });
		const d = decideRndEnroll(mode, ev, alasan);
		if (d.audit) await audit(karyawan, program.id, d.audit, d.usedAlasan ? `${ev.reason} Alasan pengecualian: ${String(alasan).trim()}` : ev.reason || '', { kode: program.kode, mode, missing: (ev as any).missing ?? [] });
		if (!d.allow) throw Object.assign(new Error(d.message), { status: 409, gateBlocked: true });
		return d.message ? { peringatan: d.message } : {};
	} catch (e: any) {
		if (e?.gateBlocked) throw e;
		console.error('[rndJalurGate] gagal memeriksa gate (fail-open, pendaftaran dilanjutkan):', e?.message || e);
		return {};
	}
}
