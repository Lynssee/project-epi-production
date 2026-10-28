// Fase 1, Rencana v2 Shift-Left Gate Anggaran (25 Sep 2026) — kontrak §3: gate WAJIB-failed
// harus punya jalan keluar (override GM atau alasan) atau menjadi blocking murni. Uji
// fungsi PURE saja (tidak fetch).
//
//   node --test src/lib/services/evaluateSubmitDecision.test.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSubmitDecision, type EvaluatedGate } from './evaluateSubmitDecision.ts';

function gate(overrides: Partial<EvaluatedGate>): EvaluatedGate {
	return { gate_key: 'G_X', severity: 'WAJIB', status: 'failed', message: 'gagal', ...overrides };
}

test('gate SEMI atau passed tidak pernah masuk blocking/overridable', () => {
	const result = evaluateSubmitDecision(
		[
			gate({ gate_key: 'G4', severity: 'SEMI', status: 'failed' }),
			gate({ gate_key: 'G2', status: 'passed' }),
			gate({ gate_key: 'G5', status: 'not_applicable' })
		],
		{ canOverrideProjectData: false }
	);
	assert.deepEqual(result.blocking, []);
	assert.deepEqual(result.overridable, []);
	assert.equal(result.warnings.length, 3);
	assert.equal(result.blocked, false);
});

test('G9/G10/G11 WAJIB-failed tanpa izin GM -> overridable (blocked=true)', () => {
	const result = evaluateSubmitDecision([gate({ gate_key: 'G10' })], { canOverrideProjectData: false });
	assert.equal(result.overridable.length, 1);
	assert.equal(result.blocking.length, 0);
	assert.equal(result.blocked, true);
});

test('G9/G10/G11 WAJIB-failed dengan izin GM -> tidak menahan (masuk warnings)', () => {
	const result = evaluateSubmitDecision([gate({ gate_key: 'G11' })], { canOverrideProjectData: true });
	assert.equal(result.overridable.length, 0);
	assert.equal(result.blocking.length, 0);
	assert.equal(result.warnings.length, 1);
	assert.equal(result.blocked, false);
});

test('G8/G20 WAJIB-failed selalu overridable (pemanggil cek alasan pengecualian sendiri)', () => {
	const result = evaluateSubmitDecision([gate({ gate_key: 'G8' }), gate({ gate_key: 'G20' })], {
		canOverrideProjectData: false
	});
	assert.equal(result.overridable.length, 2);
	assert.equal(result.blocking.length, 0);
});

test('gate WAJIB-failed tanpa jalur override (mis. G17/G_KOMISI/G18) -> blocking murni', () => {
	const result = evaluateSubmitDecision(
		[gate({ gate_key: 'G17' }), gate({ gate_key: 'G_KOMISI' }), gate({ gate_key: 'G18' })],
		{ canOverrideProjectData: true }
	);
	assert.equal(result.blocking.length, 3);
	assert.equal(result.overridable.length, 0);
	assert.equal(result.blocked, true);
});

test('mode-driven: gate shadow (severity sudah diturunkan server jadi SEMI) tidak lagi memblokir', () => {
	// Server (validate/+server.js) sudah menurunkan severity ke SEMI saat gate_enforcement
	// mode='shadow' — evaluateSubmitDecision TIDAK membaca g.mode lagi, cukup severity+status.
	const result = evaluateSubmitDecision([gate({ gate_key: 'G_BAP_BORONGAN', severity: 'SEMI', mode: 'shadow' })], {
		canOverrideProjectData: false
	});
	assert.equal(result.blocked, false);
	assert.equal(result.warnings.length, 1);
});

// ---- PA-09 (Fase D): celah mode 'on' & fail-open bertingkat ----
import { evaluatePreflightFailOpen } from './evaluateSubmitDecision.ts';

test('PA-09: G10 WAJIB-failed, actor BUKAN GM -> ikut blockedForActor (mode on tidak meloloskannya)', () => {
	const result = evaluateSubmitDecision([gate({ gate_key: 'G10' }), gate({ gate_key: 'G8' })], { canOverrideProjectData: false });
	assert.deepEqual(result.blockedForActor.map((g) => g.gate_key), ['G10']); // G8 = alasan pengecualian, dicek form
});

test('PA-09: G10 WAJIB-failed, actor GM -> tidak memblokir', () => {
	const result = evaluateSubmitDecision([gate({ gate_key: 'G10' })], { canOverrideProjectData: true });
	assert.deepEqual(result.blockedForActor, []);
});

test('PA-09: gate WAJIB lain tanpa jalur override (G12) -> blockedForActor', () => {
	const result = evaluateSubmitDecision([gate({ gate_key: 'G12' }), gate({ gate_key: 'G17', severity: 'SEMI' })], { canOverrideProjectData: false });
	assert.deepEqual(result.blockedForActor.map((g) => g.gate_key), ['G12']);
});

test('PA-09: fail-open — preflight tersedia -> ok', () => {
	assert.equal(evaluatePreflightFailOpen({ available: true, total: 900_000_000 }).ok, true);
});
test('PA-09: fail-open — preflight mati, nominal kecil -> ok', () => {
	assert.equal(evaluatePreflightFailOpen({ available: false, total: 5_000_000 }).ok, true);
});
test('PA-09: fail-open — preflight mati, nominal > Rp 5 juta tanpa alasan -> ditolak', () => {
	const r = evaluatePreflightFailOpen({ available: false, total: 5_000_001 });
	assert.equal(r.ok, false);
	assert.match((r as { message: string }).message, /tidak tersedia/);
});
test('PA-09: fail-open — preflight mati, nominal besar, alasan >= 10 karakter -> ok; alasan pendek -> ditolak', () => {
	assert.equal(evaluatePreflightFailOpen({ available: false, total: 20_000_000, reason: 'server preflight down, mendesak' }).ok, true);
	assert.equal(evaluatePreflightFailOpen({ available: false, total: 20_000_000, reason: 'mendesak' }).ok, false);
});

const permsF4 = { canOverrideProjectData: false };
const wajibFailed = (gate_key: string, target_stage?: string | null) =>
	({ gate_key, severity: 'WAJIB', status: 'failed', target_stage }) as EvaluatedGate;

test('F4: gate WAJIB-failed bertahap HRD/Finance/Manajemen TIDAK memblokir submit', () => {
	const r = evaluateSubmitDecision(
		[wajibFailed('G_MANPOWER_IDENTITAS', 'APPROVAL_HRD'), wajibFailed('G15', 'APPROVAL_FINANCE'), wajibFailed('G3', 'APPROVAL_MANAJEMEN')],
		permsF4
	);
	assert.equal(r.blocked, false);
	assert.equal(r.blocking.length, 0);
	assert.equal(r.warnings.length, 3);
});

test('F4: tanpa tahap / SUBMIT / APPROVAL_ATASAN / tahap tak dikenal tetap memblokir (perilaku lama)', () => {
	const r = evaluateSubmitDecision(
		[wajibFailed('G_BAP_BORONGAN', null), wajibFailed('G_BAST', 'SUBMIT'), wajibFailed('G12', 'APPROVAL_ATASAN'), wajibFailed('G17', 'NGAWUR')],
		permsF4
	);
	assert.deepEqual(r.blocking.map((g) => g.gate_key), ['G_BAP_BORONGAN', 'G_BAST', 'G12', 'G17']);
});

// Dual Gate PA (soft): pernyataan tertulis sebagai jalur keluar G10_HARIAN / G_MOM_BRIEFING.
import { gatesNeedingPernyataan, hasValidPernyataan } from './evaluateSubmitDecision.ts';

test('gatesNeedingPernyataan: hanya G10_HARIAN/G_MOM_BRIEFING yang failed dan mode soft', () => {
	const r = gatesNeedingPernyataan([
		gate({ gate_key: 'G10_HARIAN', severity: 'SEMI', mode: 'soft' }),
		gate({ gate_key: 'G_MOM_BRIEFING', severity: 'SEMI', mode: 'soft' }),
		gate({ gate_key: 'G10_HARIAN', severity: 'SEMI', mode: 'shadow' }),
		gate({ gate_key: 'G_MOM_BRIEFING', severity: 'SEMI', mode: 'soft', status: 'passed' }),
		gate({ gate_key: 'G8', mode: 'soft' })
	]);
	assert.deepEqual(r.map((g) => g.gate_key), ['G10_HARIAN', 'G_MOM_BRIEFING']);
});

test('gate yang didispensasi (server mengirim passed) tidak menuntut pernyataan', () => {
	assert.equal(gatesNeedingPernyataan([gate({ gate_key: 'G10_HARIAN', mode: 'soft', status: 'passed' })]).length, 0);
});

test('hasValidPernyataan: minimal 20 karakter setelah trim', () => {
	assert.equal(hasValidPernyataan('pendek'), false);
	assert.equal(hasValidPernyataan('   ' + 'a'.repeat(19) + '   '), false);
	assert.equal(hasValidPernyataan('a'.repeat(20)), true);
	assert.equal(hasValidPernyataan(undefined), false);
});
