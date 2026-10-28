// Unit test murni untuk logika ambang Kontrol Patroli — tanpa framework tambahan, pakai
// test runner bawaan Node (`node --test`). project-epi belum punya vitest; helper ini
// fungsi murni jadi cukup node:test + node:assert.
//
//   node --test src/lib/utils/patrolThresholds.test.ts
//
// Menutup gap "Verification Plan > Automated Tests" di dokumen rencana Kontrol Patroli
// (velocity check, durasi ronda minimal, dwell time Two-Tap).

import test from 'node:test';
import assert from 'node:assert/strict';
import {
	isVelocityViolation,
	velocitySecondsRemaining,
	isPatrolDurationViolation,
	isDwellViolation,
	elapsedMinutes
} from './patrolThresholds.ts';

const MIN = 60_000;

// ---- 1.3 Velocity check (anti-speedrun) ----

test('velocity: scan pertama (belum ada scan sebelumnya) tidak pernah melanggar', () => {
	assert.equal(isVelocityViolation(null, Date.now(), 60), false);
});

test('velocity: scan < threshold detik dari scan sebelumnya DITOLAK (melanggar)', () => {
	const now = 1_000_000;
	const lastScan = now - 30_000; // 30 detik lalu
	assert.equal(isVelocityViolation(lastScan, now, 60), true);
});

test('velocity: scan >= threshold detik dari scan sebelumnya LOLOS', () => {
	const now = 1_000_000;
	const lastScan = now - 61_000; // 61 detik lalu
	assert.equal(isVelocityViolation(lastScan, now, 60), false);
});

test('velocity: tepat di batas threshold (== ) dianggap LOLOS (bukan <)', () => {
	const now = 1_000_000;
	const lastScan = now - 60_000; // pas 60 detik
	assert.equal(isVelocityViolation(lastScan, now, 60), false);
});

test('velocity: sisa detik dihitung benar & dibulatkan ke atas', () => {
	const now = 1_000_000;
	const lastScan = now - 30_400; // 30.4 detik lalu, sisa 29.6 -> bulat ke 30
	assert.equal(velocitySecondsRemaining(lastScan, now, 60), 30);
});

test('velocity: sisa detik 0 bila sudah boleh scan / belum ada scan sebelumnya', () => {
	assert.equal(velocitySecondsRemaining(null, Date.now(), 60), 0);
	const now = 1_000_000;
	assert.equal(velocitySecondsRemaining(now - 120_000, now, 60), 0);
});

// ---- 1.4 Durasi ronda minimal ----

test('durasi ronda: selesai sebelum durasi minimal DITOLAK (melanggar)', () => {
	const mulai = 0;
	const now = 5 * MIN; // baru 5 menit
	assert.equal(isPatrolDurationViolation(mulai, now, 10), true);
});

test('durasi ronda: selesai setelah durasi minimal LOLOS', () => {
	const mulai = 0;
	const now = 15 * MIN; // sudah 15 menit
	assert.equal(isPatrolDurationViolation(mulai, now, 10), false);
});

test('durasi ronda: tepat di batas (==) dianggap LOLOS', () => {
	const mulai = 0;
	const now = 10 * MIN;
	assert.equal(isPatrolDurationViolation(mulai, now, 10), false);
});

// ---- 2.2 Dwell time Two-Tap kebersihan ----

test('dwell: Tap 2 sebelum dwell minimal DITOLAK (melanggar)', () => {
	const mulaiKerja = 0;
	const now = 3 * MIN;
	assert.equal(isDwellViolation(mulaiKerja, now, 10), true);
});

test('dwell: Tap 2 setelah dwell minimal LOLOS', () => {
	const mulaiKerja = 0;
	const now = 12 * MIN;
	assert.equal(isDwellViolation(mulaiKerja, now, 10), false);
});

// ---- Timer tampilan ----

test('elapsedMinutes: dibulatkan ke bawah, tidak pernah negatif untuk sinceMs <= nowMs', () => {
	assert.equal(elapsedMinutes(0, 9 * MIN + 59_000), 9);
	assert.equal(elapsedMinutes(0, 10 * MIN), 10);
	assert.equal(elapsedMinutes(0, 0), 0);
});
