import { describe, it, expect } from 'vitest';
import { signProxy, verifyProxySignature, labelOf } from './actor';

describe('tanda tangan proxy ERP (GSP-02)', () => {
	const secret = 'rahasia-uji';
	const now = 1_800_000_000_000;
	const sig = signProxy(secret, 'uid1', now);
	it('valid dalam ±120 detik', () => {
		expect(verifyProxySignature(secret, 'uid1', String(now), sig, now + 60_000)).toBe(true);
	});
	it('ditolak: secret kosong / uid beda / sig salah / kedaluwarsa / header hilang', () => {
		expect(verifyProxySignature('', 'uid1', String(now), sig, now)).toBe(false);
		expect(verifyProxySignature(secret, 'uid2', String(now), sig, now)).toBe(false);
		expect(verifyProxySignature(secret, 'uid1', String(now), 'ab' + sig.slice(2), now)).toBe(false);
		expect(verifyProxySignature(secret, 'uid1', String(now), sig, now + 200_000)).toBe(false);
		expect(verifyProxySignature(secret, 'uid1', null, null, now)).toBe(false);
	});
	it('label pelaku seragam', () => {
		expect(labelOf('kiosk', 'BUDI')).toBe('KIOSK/BUDI');
		expect(labelOf('erp', 'ANDI')).toBe('ERP/ANDI');
	});
});
