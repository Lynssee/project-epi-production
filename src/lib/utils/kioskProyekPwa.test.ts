import { describe, it, expect } from 'vitest';
import { deteksiPlatform } from './kioskProyekPwa';

describe('deteksiPlatform', () => {
	it('mengenali iPhone/iPad, Android, dan lainnya; null aman', () => {
		expect(deteksiPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari')).toBe('ios');
		expect(deteksiPlatform('Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X)')).toBe('ios');
		expect(deteksiPlatform('Mozilla/5.0 (Linux; Android 13; SM-A135F) Chrome/120 Mobile')).toBe('android');
		expect(deteksiPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120')).toBe('lain');
		expect(deteksiPlatform(null)).toBe('lain');
		expect(deteksiPlatform('')).toBe('lain');
	});
});
