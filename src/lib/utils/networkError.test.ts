// Paket 02 Site Visit Release §3.1, §6 — klasifikasi error jaringan/server sementara vs
// permanen. Uji fungsi murni, node:test (konsisten dengan checkpointScanRoute.test.ts).
//
//   node --test src/lib/utils/networkError.test.ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpError, isRetryableError, pesanErrorAwam } from './networkError.ts';

test('TypeError "failed to fetch" (Chrome offline) -> retryable', () => {
	assert.equal(isRetryableError(new TypeError('Failed to fetch')), true);
});

test('TypeError "load failed" (Safari offline) -> retryable', () => {
	assert.equal(isRetryableError(new TypeError('Load failed')), true);
});

test('TypeError pesan lain (bukan jaringan) -> TIDAK retryable', () => {
	assert.equal(isRetryableError(new TypeError("Cannot read properties of undefined")), false);
});

test('AbortError (fetchWithTimeout) -> retryable', () => {
	const err = new Error('timeout');
	err.name = 'AbortError';
	assert.equal(isRetryableError(err), true);
});

test('Firebase auth/network-request-failed -> retryable', () => {
	assert.equal(isRetryableError({ code: 'auth/network-request-failed' }), true);
});

test('HttpError 502/503/504/500/429/408/425 -> retryable', () => {
	for (const status of [408, 425, 429, 500, 502, 503, 504]) {
		assert.equal(isRetryableError(new HttpError('gagal', status)), true, `status ${status}`);
	}
});

test('HttpError 400/401/403/404/409/422 -> TIDAK retryable (permanen)', () => {
	for (const status of [400, 401, 403, 404, 409, 422]) {
		assert.equal(isRetryableError(new HttpError('ditolak', status)), false, `status ${status}`);
	}
});

test('navigator.onLine === false -> selalu retryable apa pun errornya', () => {
	// Node 22 mendefinisikan globalThis.navigator sebagai getter read-only (NodeJS navigator
	// experimental) — tidak bisa langsung di-assign, harus lewat defineProperty.
	const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
	Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
	try {
		assert.equal(isRetryableError(new Error('apa saja')), true);
	} finally {
		if (original) Object.defineProperty(globalThis, 'navigator', original);
		else delete (globalThis as any).navigator;
	}
});

test('pesanErrorAwam: error retryable -> pesan "tersimpan di HP", bukan teks error asli', () => {
	const msg = pesanErrorAwam(new TypeError('Failed to fetch'));
	assert.match(msg, /tersimpan di hp/i);
});

test('pesanErrorAwam: error permanen dengan pesan server -> tampilkan pesan server', () => {
	const msg = pesanErrorAwam(new HttpError('Foto wajib diisi', 400));
	assert.equal(msg, 'Foto wajib diisi');
});

test('pesanErrorAwam: pesan mengandung istilah firebase/auth -> jangan ditampilkan mentah', () => {
	const msg = pesanErrorAwam(new Error('Firebase: Error (auth/user-token-expired)'));
	assert.equal(msg, 'Terjadi kendala. Coba lagi, atau hubungi admin bila berulang.');
});
