// Uji fungsi PURE petunjuk kontak gate (owner_role dari erp-epi /api/pengajuan/validate).
//
//   node --test src/lib/utils/paGateStage.test.ts

import test from 'node:test';
import assert from 'node:assert/strict';
import { contactHint, isDeferredGate, canRequestDispensasi, menungguAdminProject, sembunyikDariLeader, milikPihakLainGagal, teksMenungguAdmin } from './paGateStage.ts';

test('gate gagal non-deferred dengan owner_role -> petunjuk hubungi', () => {
	assert.equal(
		contactHint({ status: 'failed', target_stage: 'APPROVAL_ATASAN', owner_role: 'Atasan langsung / Project Leader' }),
		'Butuh bantuan? Hubungi Atasan langsung / Project Leader.'
	);
});

test('gate deferred tidak diberi petunjuk (sudah "ditangani X")', () => {
	const g = { status: 'failed', target_stage: 'APPROVAL_HRD', owner_role: 'HRD / Ketenagakerjaan' };
	assert.equal(isDeferredGate(g), true);
	assert.equal(contactHint(g), null);
});

test('tanpa owner_role, owner pemohon sendiri, atau gate lolos -> null (tidak mengarang kontak)', () => {
	assert.equal(contactHint({ status: 'failed', target_stage: null, owner_role: null }), null);
	assert.equal(contactHint({ status: 'failed', target_stage: 'SUBMIT', owner_role: 'Pemohon' }), null);
	assert.equal(contactHint({ status: 'passed', owner_role: 'Atasan' }), null);
	assert.equal(contactHint(null), null);
});

test('canRequestDispensasi: hanya gate cakupan yang GAGAL dan bukan deferred', () => {
	assert.equal(canRequestDispensasi({ gate_key: 'G10_HARIAN', status: 'failed' }), true);
	assert.equal(canRequestDispensasi({ gate_key: 'G_MOM_BRIEFING', status: 'failed', target_stage: 'SUBMIT' }), true);
	assert.equal(canRequestDispensasi({ gate_key: 'G10_HARIAN', status: 'passed' }), false);
	assert.equal(canRequestDispensasi({ gate_key: 'G4', status: 'failed' }), false);
	assert.equal(canRequestDispensasi({ gate_key: 'G10_HARIAN', status: 'failed', target_stage: 'APPROVAL_FINANCE' }), false);
	assert.equal(canRequestDispensasi(null), false);
});

// ── PDP-36 pemilik gate ──────────────────────────────────────────────────────
test('menungguAdminProject hanya untuk gate admin yang gagal', () => {
	assert.equal(menungguAdminProject({ pemilik: 'admin_project', status: 'failed' }), true);
	assert.equal(menungguAdminProject({ pemilik: 'admin_project', status: 'passed' }), false);
	assert.equal(menungguAdminProject({ pemilik: 'leader', status: 'failed' }), false);
	assert.equal(menungguAdminProject({ status: 'failed' }), false);
	assert.equal(menungguAdminProject(null), false);
});

test('sembunyikDariLeader: semua gate admin keluar dari daftar syarat leader', () => {
	assert.equal(sembunyikDariLeader({ pemilik: 'admin_project', status: 'passed' }), true);
	assert.equal(sembunyikDariLeader({ pemilik: 'leader' }), false);
	assert.equal(sembunyikDariLeader({}), false);
});

test('milikPihakLainGagal: hrd/finance/tim_sentral gagal saja', () => {
	assert.equal(milikPihakLainGagal({ pemilik: 'hrd', status: 'failed' }), true);
	assert.equal(milikPihakLainGagal({ pemilik: 'tim_sentral', status: 'failed' }), true);
	assert.equal(milikPihakLainGagal({ pemilik: 'finance', status: 'passed' }), false);
	assert.equal(milikPihakLainGagal({ pemilik: 'admin_project', status: 'failed' }), false);
});

test('teksMenungguAdmin dengan dan tanpa PIC', () => {
	assert.equal(teksMenungguAdmin({ nama: 'Putri Handayani' }), 'Menunggu Admin Project — Putri Handayani');
	assert.match(teksMenungguAdmin(null), /Hubungi PM/);
	assert.match(teksMenungguAdmin({ nama: null }), /Hubungi PM/);
});
