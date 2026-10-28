// src/lib/server/searchLogging.ts
// SERVER-ONLY. F5 — observability Global Deep Search.
// Semua tulisan bersifat fire-and-forget (tidak pernah melempar / memblokir
// respons pencarian) — kegagalan logging tidak boleh menggagalkan pencarian.

import { directusServerJson } from './directus';

// Kata kunci yang mengindikasikan pencarian data sensitif (gaji/payroll/PII).
// Cocok di sini TIDAK berarti data payroll bocor — ini murni sinyal untuk W4
// (alert pola anomali), mis. non-HR berulang kali mencari kata kunci ini.
const SENSITIVE_KEYWORDS = [
	'gaji', 'payroll', 'slip gaji', 'upah', 'honor', 'nik', 'rekening',
	'komisi', 'bonus', 'tunjangan', 'thr', 'potongan gaji'
];

function matchesSensitiveKeyword(q: string): boolean {
	const needle = q.toLowerCase();
	return SENSITIVE_KEYWORDS.some((kw) => needle.includes(kw));
}

export function logSearchAnalytics({
	query,
	userEmail,
	resultCount,
	moduleScope
}: {
	query: string;
	userEmail: string | null;
	resultCount: number;
	moduleScope: string;
}) {
	directusServerJson('/items/search_analytics', {
		method: 'POST',
		body: JSON.stringify({
			query,
			user_email: userEmail || null,
			result_count: resultCount,
			module_scope: moduleScope,
			zero_result: resultCount === 0,
			created_at: new Date().toISOString()
		})
	}).catch((err: any) => console.warn('[searchLogging] gagal tulis search_analytics:', err?.message || err));
}

export function logSearchAuditIfSensitive({
	query,
	userEmail,
	ip
}: {
	query: string;
	userEmail: string | null;
	ip: string | null;
}) {
	if (!matchesSensitiveKeyword(query)) return;
	directusServerJson('/items/search_audit', {
		method: 'POST',
		body: JSON.stringify({
			user_email: userEmail || null,
			query,
			matched_sensitive: true,
			ip: ip || null,
			created_at: new Date().toISOString(),
			flagged: true
		})
	}).catch((err: any) => console.warn('[searchLogging] gagal tulis search_audit:', err?.message || err));
}
