// Uji fungsi PURE tampilan status permintaan dispensasi.
//
//   node --test src/lib/utils/dispensasiStatus.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { dispensasiStatusInfo, pickRecentRequests } from './dispensasiStatus.ts';

test('status dikenal dipetakan; tak dikenal/null dianggap menunggu', () => {
	assert.equal(dispensasiStatusInfo('disetujui').icon, '✅');
	assert.equal(dispensasiStatusInfo('ditolak').tone, 'red');
	assert.equal(dispensasiStatusInfo('aneh').label, 'Menunggu keputusan');
	assert.equal(dispensasiStatusInfo(null).label, 'Menunggu keputusan');
});

test('pickRecentRequests: menunggu di depan, lalu id terbesar, dibatasi N', () => {
	const rows = [
		{ id: 1, status: 'disetujui' },
		{ id: 5, status: 'ditolak' },
		{ id: 3, status: 'menunggu' },
		{ id: 2, status: 'menunggu' }
	];
	assert.deepEqual(pickRecentRequests(rows, 3).map((r) => r.id), [3, 2, 5]);
	assert.deepEqual(pickRecentRequests(null), []);
});
