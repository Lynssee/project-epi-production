import { describe, it, expect, vi, beforeEach } from 'vitest';

const directusServerJson = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: unknown[]) => directusServerJson(...a) }));

const { resolveCertBranding, sanitizeCertText, loadCertBranding, CERT_BRANDING_DEFAULTS } = await import('./trainingCertBranding');

beforeEach(() => {
	directusServerJson.mockReset();
});

describe('trainingCertBranding', () => {
	it('sanitize: trim, kosong→default, potong batas', () => {
		expect(sanitizeCertText('cert_company_name', '  PT  Maju\n Jaya ')).toBe('PT Maju Jaya');
		expect(sanitizeCertText('cert_signatory_name', '  ')).toBe(CERT_BRANDING_DEFAULTS.cert_signatory_name);
		expect(sanitizeCertText('cert_logo_text', 'ABCDEFGHIJ')).toBe('ABCDEFGH');
		expect(sanitizeCertText('cert_logo_text', 5)).toBe('EPI');
	});

	it('resolve: tanpa baris → default; baris cert_* dipakai, key lain diabaikan', () => {
		expect(resolveCertBranding([])).toEqual(CERT_BRANDING_DEFAULTS);
		expect(resolveCertBranding(null)).toEqual(CERT_BRANDING_DEFAULTS);
		const out = resolveCertBranding([
			{ setting_key: 'cert_signatory_name', setting_value: 'Budi' },
			{ setting_key: 'baca_min_persen', setting_value: '50' }
		]);
		expect(out.cert_signatory_name).toBe('Budi');
		expect(out.cert_company_name).toBe(CERT_BRANDING_DEFAULTS.cert_company_name);
	});

	it('loadCertBranding: sukses = satu query dengan filter module+cert_', async () => {
		directusServerJson.mockResolvedValue({ data: [{ setting_key: 'cert_company_name', setting_value: 'PT Baru' }] });
		const out = await loadCertBranding();
		expect(out.cert_company_name).toBe('PT Baru');
		expect(directusServerJson).toHaveBeenCalledTimes(1);
		expect(String(directusServerJson.mock.calls[0][0])).toContain('filter[setting_key][_starts_with]=cert_');
	});

	it('loadCertBranding: Directus gagal → default + log error, tidak melempar', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
		directusServerJson.mockImplementation(() => Promise.reject(new Error('boom')));
		const out = await loadCertBranding();
		expect(out).toEqual(CERT_BRANDING_DEFAULTS);
		expect(spy).toHaveBeenCalledTimes(1);
		spy.mockRestore();
	});
});
