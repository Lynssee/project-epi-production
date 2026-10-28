// Uji berbagi panggilan berjalan (bukan cache).
//
//   node --test src/lib/services/preflightShare.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { shareInflight, _inflightSize } from './preflightShare.ts';

test('panggilan bertumpuk dengan key sama berbagi satu eksekusi', async () => {
	let calls = 0;
	const run = () => new Promise<number>((r) => setTimeout(() => r(++calls), 10));
	const [a, b] = await Promise.all([shareInflight('k', run), shareInflight('k', run)]);
	assert.equal(calls, 1);
	assert.equal(a, 1);
	assert.equal(b, 1);
});

test('setelah selesai TIDAK ada hasil tersimpan: panggilan berikutnya mengeksekusi ulang', async () => {
	let calls = 0;
	const run = async () => ++calls;
	assert.equal(await shareInflight('k2', run), 1);
	assert.equal(await shareInflight('k2', run), 2);
	assert.equal(_inflightSize(), 0);
});

test('key berbeda tidak saling berbagi; error dibersihkan dan tidak menempel', async () => {
	let calls = 0;
	await Promise.all([shareInflight('a', async () => ++calls), shareInflight('b', async () => ++calls)]);
	assert.equal(calls, 2);
	await assert.rejects(shareInflight('e', async () => { throw new Error('x'); }));
	assert.equal(_inflightSize(), 0);
	assert.equal(await shareInflight('e', async () => 'ok'), 'ok');
});
