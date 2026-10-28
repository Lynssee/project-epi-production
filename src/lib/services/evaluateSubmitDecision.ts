// src/lib/services/evaluateSubmitDecision.ts
// Fase 1 (Rencana v2 Shift-Left Gate Anggaran, 25 Sep 2026) — "Satu Otak Penegakan".
//
// Akar masalah F1: finance.ts::createPengajuanAnggaran (lapangan) memutuskan blokir
// submit dari DAFTAR gate_key HARDCODE (['G9','G10','G11'], ['G18','G19','G_KOMISI',...]),
// bukan dari `severity`/`status`/`mode` yang SUDAH dihitung benar oleh admin
// (/api/pengajuan/validate, membaca gate_enforcement lewat getGateMode()). Akibatnya
// konfigurasi Panel Kalibrasi Gate tidak berefek di lapangan — gate yang admin turunkan
// ke shadow tetap memblokir, gate yang admin naikkan ke hard tapi tidak ada di daftar
// hardcode malah lolos lalu macet di approver (audit 25 Sep: 159 PA, lihat rencana §2).
//
// Fungsi ini MURNI (tidak fetch, tidak baca state global) supaya gampang diuji &
// paritas dengan mesin server bisa dipastikan lewat unit test kontrak. Aturan:
//   - g.severity === 'WAJIB' && g.status === 'failed'  →  gate ini "ingin" memblokir.
//     (severity WAJIB/SEMI sudah ditentukan server dari mode gate_enforcement — lihat
//     validate/+server.js — jadi TIDAK perlu membaca g.mode lagi di sini.)
//   - Gate WAJIB-failed dengan jalur override (G9/G10/G11: izin GM; G4/G8/G20: alasan
//     tertulis) masuk `overridable`, bukan `blocking` langsung — pemanggil yang
//     memutuskan apakah override itu tersedia untuk actor ini.
//   - Sisanya (WAJIB-failed, tanpa jalur override) masuk `blocking` — submit ditolak.
//   - SEMI-failed / not_applicable / passed → `warnings` (tidak pernah memblokir).
//
// TIDAK MENGUBAH PERILAKU SENDIRIAN — hanya dipanggil di belakang flag
// `app_settings` module=pengajuan key=submit_decision_engine (legacy|shadow|on, lihat
// pengajuanSubmitEngineSettings.ts). Default 'shadow': keputusan legacy tetap yang
// berlaku, hasil fungsi ini hanya dibandingkan & dicatat (observability) sampai admin
// sadar dan memutuskan pindah ke 'on'.

import { isDeferredGate } from '../utils/paGateStage.ts';

export interface EvaluatedGate {
	gate_key: string;
	label?: string;
	severity: 'WAJIB' | 'SEMI';
	status: 'passed' | 'failed' | 'not_applicable';
	message?: string;
	mode?: string;
	/** Tahap blokir dari Kalibrasi Gate (Phased Gate Enforcement): HRD/Finance/dst. = bukan tugas pemohon saat submit. */
	target_stage?: string | null;
}

export interface SubmitDecisionActorPerms {
	/** izin PENGAJUAN_PROJECT_DATA_GATE_OVERRIDE (General Manager) — buka G9/G10/G11. */
	canOverrideProjectData: boolean;
}

export interface SubmitDecisionResult {
	/** WAJIB-failed tanpa jalur override tersedia untuk actor ini — submit HARUS ditolak. */
	blocking: EvaluatedGate[];
	/** WAJIB-failed dengan jalur override, tapi actor TIDAK punya wewenang (mis. bukan GM). */
	overridable: EvaluatedGate[];
	/** Semua gate lain (passed/not_applicable/SEMI) — informasional saja. */
	warnings: EvaluatedGate[];
	/** true bila ada minimal satu blocking ATAU overridable-tanpa-wewenang. */
	blocked: boolean;
	/**
	 * Yang BENAR-BENAR menolak submit untuk actor ini: `blocking` + G9/G10/G11 yang gagal sementara actor
	 * bukan GM. (Dulu mode 'on' hanya membaca `blocking`, sehingga non-GM lolos G9/G10/G11 — celah PA-09.)
	 * G4/G8/G20 (alasan pengecualian) tetap TIDAK ikut: dicek terpisah oleh form.
	 */
	blockedForActor: EvaluatedGate[];
}

// Gate WAJIB-failed di kelompok ini punya jalur override GM (Override kelengkapan data
// proyek) — sama seperti perilaku lama G9/G10/G11.
const OVERRIDE_BY_GM = new Set(['G9', 'G10', 'G11']);

// Gate WAJIB-failed di kelompok ini punya jalur "alasan pengecualian" (lampiran_exception_*)
// yang sudah dicek TERPISAH sebelum evaluateSubmitDecision dipanggil (lihat form baru) —
// jadi di sini dianggap overridable, bukan blocking mutlak, supaya pemanggil yang lebih
// tahu (sudah adakah alasan tersimpan) yang memutuskan.
const OVERRIDE_BY_REASON = new Set(['G4', 'G8', 'G20']);

export function evaluateSubmitDecision(
	gates: EvaluatedGate[],
	actorPerms: SubmitDecisionActorPerms
): SubmitDecisionResult {
	const blocking: EvaluatedGate[] = [];
	const overridable: EvaluatedGate[] = [];
	const warnings: EvaluatedGate[] = [];

	for (const g of gates || []) {
		const isWajibFailed = g.severity === 'WAJIB' && g.status === 'failed';
		// Phased Gate Enforcement Fase 4: gate bertahap HRD/Finance/Manajemen/dst. tidak memblokir submit —
		// ia baru memblokir di approval engine pada tahap itu (sisi server, Fase 3).
		if (!isWajibFailed || isDeferredGate(g)) {
			warnings.push(g);
			continue;
		}
		if (OVERRIDE_BY_GM.has(g.gate_key)) {
			if (actorPerms.canOverrideProjectData) {
				warnings.push(g); // GM berwenang — bukan penghalang untuk actor ini
			} else {
				overridable.push(g);
			}
			continue;
		}
		if (OVERRIDE_BY_REASON.has(g.gate_key)) {
			overridable.push(g); // pemanggil mengecek alasan pengecualian secara terpisah
			continue;
		}
		blocking.push(g);
	}

	return {
		blocking,
		overridable,
		warnings,
		blocked: blocking.length > 0 || overridable.length > 0,
		blockedForActor: [...blocking, ...overridable.filter((g) => OVERRIDE_BY_GM.has(g.gate_key))]
	};
}

/**
 * Dual Gate PA (G10_HARIAN laporan bolong, G_MOM_BRIEFING): mode 'soft' = boleh lanjut ASALKAN
 * pengaju menulis pernyataan tertulis (>= PERNYATAAN_MIN_LEN karakter; disimpan di
 * dynamic_fields._gate_pernyataan). Gate yang sedang didispensasi GM sudah berstatus 'passed'
 * dari server, jadi otomatis tidak ikut. Shadow/warn tidak menuntut apa pun.
 */
export const PERNYATAAN_GATES = ['G10_HARIAN', 'G_MOM_BRIEFING'];
export const PERNYATAAN_MIN_LEN = 20;

export function gatesNeedingPernyataan(gates: EvaluatedGate[] | null | undefined): EvaluatedGate[] {
	return (gates || []).filter((g) => PERNYATAAN_GATES.includes(g.gate_key) && g.status === 'failed' && g.mode === 'soft');
}

export function hasValidPernyataan(text: unknown): boolean {
	return String(text ?? '').trim().length >= PERNYATAAN_MIN_LEN;
}

/** Di atas nominal ini, pemeriksa gate yang tak terjangkau TIDAK lagi fail-open tanpa alasan tertulis (PA-09 butir 3). */
export const FAIL_OPEN_THRESHOLD = 5_000_000;
export const FAIL_OPEN_MIN_REASON = 10;

/**
 * Pemeriksa gate (preflight) tidak tersedia: boleh lanjut hanya bila nominal kecil, atau ada alasan tertulis.
 * Dipakai service submit sebagai pagar terakhir (form sudah meminta alasan, tapi jalur lain bisa memanggil
 * createPengajuanAnggaran langsung).
 */
export function evaluatePreflightFailOpen(p: {
	available: boolean;
	total: number | string | null | undefined;
	reason?: string | null;
}): { ok: true } | { ok: false; message: string } {
	if (p.available) return { ok: true };
	const total = Number(p.total) || 0;
	if (total <= FAIL_OPEN_THRESHOLD) return { ok: true };
	if (String(p.reason ?? '').trim().length >= FAIL_OPEN_MIN_REASON) return { ok: true };
	return {
		ok: false,
		message:
			'Pemeriksa syarat pengajuan tidak tersedia saat ini dan nominal pengajuan besar (> Rp 5 juta). Coba lagi sebentar lagi, atau isi alasan tertulis (minimal 10 karakter) bila tetap harus dikirim.'
	};
}
