// src/lib/server/ess/trainingCertBranding.ts
// Branding & penandatangan sertifikat pelatihan — app_settings module 'training_lms' (keys cert_*).
// SALINAN SETIA erp-epi/src/lib/utils/trainingCertBranding.js (ubah keduanya bersamaan).
// Default = teks yang sebelumnya hardcode, jadi sertifikat tetap sama bila setelan belum diisi.

import { directusServerJson } from '$lib/server/directus';

export const CERT_BRANDING_MODULE = 'training_lms';

export interface CertBranding {
	cert_logo_text: string;
	cert_company_name: string;
	cert_signatory_name: string;
	cert_signatory_title: string;
}

export const CERT_BRANDING_DEFAULTS: Readonly<CertBranding> = Object.freeze({
	cert_logo_text: 'EPI',
	cert_company_name: 'PT Eltama Prima Indo',
	cert_signatory_name: 'HRD Manager',
	cert_signatory_title: 'Human Resources Department'
});

const KEYS = Object.keys(CERT_BRANDING_DEFAULTS) as Array<keyof CertBranding>;

const MAX_LEN: Record<keyof CertBranding, number> = {
	cert_logo_text: 8,
	cert_company_name: 60,
	cert_signatory_name: 40,
	cert_signatory_title: 60
};

export function sanitizeCertText(key: keyof CertBranding, raw: unknown): string {
	const fallback = CERT_BRANDING_DEFAULTS[key];
	if (typeof raw !== 'string') return fallback;
	// eslint-disable-next-line no-control-regex
	const clean = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
	if (!clean) return fallback;
	return clean.slice(0, MAX_LEN[key]);
}

export function resolveCertBranding(rows: Array<{ setting_key?: string; setting_value?: unknown }> | null | undefined): CertBranding {
	const by = new Map<string, unknown>();
	for (const r of rows || []) {
		if (r?.setting_key && (KEYS as string[]).includes(r.setting_key)) by.set(r.setting_key, r.setting_value);
	}
	const out = {} as CertBranding;
	for (const key of KEYS) out[key] = sanitizeCertText(key, by.get(key));
	return out;
}

/** Satu query. Gagal baca TIDAK menggagalkan penerbitan sertifikat: dicatat jelas, pakai default. */
export async function loadCertBranding(): Promise<CertBranding> {
	try {
		const res = await directusServerJson<{ data: Array<{ setting_key: string; setting_value: unknown }> }>(
			`/items/app_settings?filter[module][_eq]=${CERT_BRANDING_MODULE}&filter[setting_key][_starts_with]=cert_&fields=setting_key,setting_value&limit=-1`
		);
		return resolveCertBranding(res?.data);
	} catch (e) {
		console.error('[trainingCertBranding] gagal membaca app_settings training_lms (cert_*), pakai default:', e);
		return { ...CERT_BRANDING_DEFAULTS };
	}
}
