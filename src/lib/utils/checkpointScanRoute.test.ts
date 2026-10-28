// Unit test murni untuk routeCheckpointScan — tanpa framework tambahan, pakai
// test runner bawaan Node (`node --test`). project-epi belum punya vitest; helper
// ini fungsi murni jadi cukup node:test + node:assert.
//
//   node --test src/lib/utils/checkpointScanRoute.test.ts
//
// Bagian dari "Barang per Ruangan via QR Patroli" (Fase 1).

import test from 'node:test';
import assert from 'node:assert/strict';
import { routeCheckpointScan, roomPageUrl, type ScanRouteMode } from './checkpointScanRoute.ts';

const gaAssigned = { kind: 'ga' as const, schedule_id: 12, area_id: 29, template_id: 5, is_assigned: true };
const gaNotAssigned = { kind: 'ga' as const, schedule_id: 'unscheduled', area_id: 29, template_id: 5, is_assigned: false };
const security = { kind: 'security' as const };
const gaNoArea = { kind: 'ga' as const, schedule_id: 'unscheduled', is_assigned: false };

const MODES: ScanRouteMode[] = ['auto', 'pilih', 'checklist_dulu'];

test('security selalu ke /satpam/patroli, apa pun modenya', () => {
	for (const m of MODES) {
		assert.equal(routeCheckpointScan(security, { scanRouteMode: m }).url, '/satpam/patroli');
	}
});

test('mode checklist_dulu: semua scan GA ke checklist (tombol mundur)', () => {
	assert.match(routeCheckpointScan(gaAssigned, { scanRouteMode: 'checklist_dulu' }).url, /^\/ga-checklist\/12\?/);
	assert.match(routeCheckpointScan(gaNotAssigned, { scanRouteMode: 'checklist_dulu' }).url, /^\/ga-checklist\/unscheduled\?/);
});

test('mode auto: petugas terjadwal -> checklist', () => {
	const d = routeCheckpointScan(gaAssigned, { scanRouteMode: 'auto' });
	assert.equal(d.reason, 'checklist_assigned');
	assert.match(d.url, /^\/ga-checklist\/12\?area_id=29&template_id=5$/);
});

test('mode auto: non-petugas -> Halaman Ruangan', () => {
	const d = routeCheckpointScan(gaNotAssigned, { scanRouteMode: 'auto' });
	assert.equal(d.reason, 'room_page');
	assert.equal(d.url, roomPageUrl(29));
});

test('mode pilih: selalu Halaman Ruangan (juga untuk petugas terjadwal)', () => {
	assert.equal(routeCheckpointScan(gaAssigned, { scanRouteMode: 'pilih' }).url, roomPageUrl(29));
	assert.equal(routeCheckpointScan(gaNotAssigned, { scanRouteMode: 'pilih' }).url, roomPageUrl(29));
});

test('default mode = auto bila opts tidak diberi', () => {
	assert.equal(routeCheckpointScan(gaAssigned).reason, 'checklist_assigned');
	assert.equal(routeCheckpointScan(gaNotAssigned).reason, 'room_page');
});

test('kind ga tanpa area_id: jatuh ke checklist, TIDAK pernah /ruangan/undefined', () => {
	for (const m of MODES) {
		const d = routeCheckpointScan(gaNoArea, { scanRouteMode: m });
		assert.equal(d.reason, 'checklist_no_area');
		assert.ok(!d.url.includes('undefined'));
		assert.match(d.url, /^\/ga-checklist\/unscheduled$/);
	}
});

test('is_assigned undefined (server lama) diperlakukan sebagai non-petugas', () => {
	const legacy = { kind: 'ga' as const, schedule_id: 'unscheduled', area_id: 7, template_id: 2 };
	assert.equal(routeCheckpointScan(legacy, { scanRouteMode: 'auto' }).url, roomPageUrl(7));
});
