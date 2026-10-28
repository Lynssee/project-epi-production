// Unit test murni untuk resolveEffectiveGateMode — tanpa framework tambahan, pakai test
// runner bawaan Node (`node --test`). Tidak mock Directus karena logikanya sudah dipisah
// dari I/O (lihat gateModeResolver.ts vs $lib/server/gateDefinitionsMode.ts).
//
//   node --test src/lib/utils/gateModeResolver.test.ts
//
// Menutup gap "Verification Plan > Automated Tests > gate predicates" di dokumen rencana
// Kontrol Patroli — mencakup ke-6 gate Fase 3 (semuanya lewat resolveGateMode() yang sama).

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEffectiveGateMode, type GateDefRow, type GateOverrideRow } from './gateModeResolver.ts';

const NOW = new Date('2026-09-15T12:00:00Z').getTime();

function def(overrides: Partial<GateDefRow> = {}): GateDefRow {
	return { gate_key: 'G_TEST', default_mode: 'soft', enforce_from: null, is_active: true, ...overrides };
}

test('gate belum terdaftar di gate_definitions (def=null) -> fallback soft, bukan error', () => {
	assert.equal(resolveEffectiveGateMode(null, [], 'pr', NOW), 'soft');
});

test('tanpa override -> pakai default_mode dari gate_definitions apa adanya', () => {
	assert.equal(resolveEffectiveGateMode(def({ default_mode: 'hard' }), [], 'pr', NOW), 'hard');
	assert.equal(resolveEffectiveGateMode(def({ default_mode: 'shadow' }), [], 'pr', NOW), 'shadow');
});

test('default_mode tidak valid -> fallback shadow (aman)', () => {
	assert.equal(resolveEffectiveGateMode(def({ default_mode: 'entahlah' }), [], 'pr', NOW), 'shadow');
});

test('override gate_enforcement document_type spesifik MENANG atas default_mode', () => {
	const overrides: GateOverrideRow[] = [
		{ jenis_pengajuan: 'PR', gate_key: 'G_TEST', mode: 'hard', document_type: 'pr', enforce_from: null, is_active: true }
	];
	assert.equal(resolveEffectiveGateMode(def({ default_mode: 'soft' }), overrides, 'pr', NOW), 'hard');
});

test('override document_type spesifik MENANG atas override generik (*)', () => {
	const overrides: GateOverrideRow[] = [
		{ jenis_pengajuan: '*', gate_key: 'G_TEST', mode: 'shadow', document_type: '*', enforce_from: null, is_active: true },
		{ jenis_pengajuan: 'PR', gate_key: 'G_TEST', mode: 'hard', document_type: 'pr', enforce_from: null, is_active: true }
	];
	assert.equal(resolveEffectiveGateMode(def(), overrides, 'pr', NOW), 'hard');
});

test('override generik (*) dipakai bila tidak ada override document_type spesifik', () => {
	const overrides: GateOverrideRow[] = [
		{ jenis_pengajuan: '*', gate_key: 'G_TEST', mode: 'warn', document_type: null, enforce_from: null, is_active: true }
	];
	assert.equal(resolveEffectiveGateMode(def({ default_mode: 'soft' }), overrides, 'pr', NOW), 'warn');
});

test('override dengan mode tidak valid diabaikan -> tetap pakai default_mode', () => {
	const overrides: GateOverrideRow[] = [
		{ jenis_pengajuan: 'PR', gate_key: 'G_TEST', mode: 'entahlah', document_type: 'pr', enforce_from: null, is_active: true }
	];
	assert.equal(resolveEffectiveGateMode(def({ default_mode: 'soft' }), overrides, 'pr', NOW), 'soft');
});

// ---- Aturan #3: enforce_from klem ke shadow bila masih di masa depan ----

test('enforce_from di MASA DEPAN -> diklem ke shadow meski default_mode=hard (Aturan #3)', () => {
	const future = new Date(NOW + 86_400_000).toISOString(); // besok
	assert.equal(resolveEffectiveGateMode(def({ default_mode: 'hard', enforce_from: future }), [], 'pr', NOW), 'shadow');
});

test('enforce_from di MASA LALU -> mode berlaku apa adanya (tidak diklem)', () => {
	const past = new Date(NOW - 86_400_000).toISOString(); // kemarin
	assert.equal(resolveEffectiveGateMode(def({ default_mode: 'hard', enforce_from: past }), [], 'pr', NOW), 'hard');
});

test('enforce_from null -> tidak pernah diklem (berlaku langsung)', () => {
	assert.equal(resolveEffectiveGateMode(def({ default_mode: 'hard', enforce_from: null }), [], 'pr', NOW), 'hard');
});

test('mode shadow TIDAK PERNAH diklem lebih lanjut (sudah paling longgar)', () => {
	const future = new Date(NOW + 86_400_000).toISOString();
	assert.equal(resolveEffectiveGateMode(def({ default_mode: 'shadow', enforce_from: future }), [], 'pr', NOW), 'shadow');
});

test('enforce_from dari OVERRIDE menggantikan enforce_from definisi (dipakai untuk klem)', () => {
	const future = new Date(NOW + 86_400_000).toISOString();
	const overrides: GateOverrideRow[] = [
		{ jenis_pengajuan: 'PR', gate_key: 'G_TEST', mode: 'hard', document_type: 'pr', enforce_from: future, is_active: true }
	];
	// default_mode='soft' tanpa enforce_from, tapi override menaikkan ke hard DENGAN enforce_from masa depan -> diklem shadow
	assert.equal(resolveEffectiveGateMode(def({ default_mode: 'soft', enforce_from: null }), overrides, 'pr', NOW), 'shadow');
});

test('skenario nyata: G_PR_CHECKLIST_CRITICAL_OPEN sebelum & sesudah 29 Sep 2026', () => {
	const gateDef = def({ default_mode: 'hard', enforce_from: '2026-09-29T00:00:00Z' });
	const before = new Date('2026-09-20T00:00:00Z').getTime();
	const after = new Date('2026-10-01T00:00:00Z').getTime();
	assert.equal(resolveEffectiveGateMode(gateDef, [], 'pr', before), 'shadow');
	assert.equal(resolveEffectiveGateMode(gateDef, [], 'pr', after), 'hard');
});
