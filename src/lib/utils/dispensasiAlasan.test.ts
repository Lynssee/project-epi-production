// Uji fungsi PURE validasi alasan permintaan dispensasi.
//
//   node --test src/lib/utils/dispensasiAlasan.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAlasan, MIN_ALASAN } from './dispensasiAlasan.ts';

test('alasan kurang dari batas ditolak, memuat jumlah karakter', () => {
	assert.match(validateAlasan('pendek') || '', /minimal 20 karakter \(sekarang 6\)/);
});
test('spasi di tepi tidak dihitung; tepat batas lolos', () => {
	assert.equal(validateAlasan('  ' + 'x'.repeat(MIN_ALASAN) + '  '), null);
	assert.notEqual(validateAlasan('x'.repeat(MIN_ALASAN - 1)), null);
});
