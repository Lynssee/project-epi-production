// PRJ-29 — pengaman override routing wizard "Keluar Uang": tujuan dari setelan HANYA boleh jalur internal aplikasi (berawalan "/" tunggal).
// Kembar finance/moneyRouting.js (ERP, validasi saat simpan); di sini dicek lagi saat DIBACA supaya baris setelan yang dirusak/diubah
// langsung di Directus tidak bisa mengalihkan Leader ke alamat luar.
export function isSafeInternalHref(h: unknown): boolean {
	const s = String(h ?? '');
	return /^\/(?!\/)[^\s"'<>\\\u0000-\u001f]*$/.test(s);
}

export interface RoutingOverride {
	href?: string;
	label?: string;
	why?: string;
}

/** Terapkan override pada bawaan: teks apa adanya, tujuan hanya bila aman. */
export function applyRoutingOverride<T extends { label: string; href: string; why: string }>(base: T, o: RoutingOverride | undefined | null): T {
	if (!o || typeof o !== 'object') return base;
	return {
		...base,
		label: typeof o.label === 'string' && o.label.trim() ? o.label.trim() : base.label,
		why: typeof o.why === 'string' && o.why.trim() ? o.why.trim() : base.why,
		href: isSafeInternalHref(o.href) ? (o.href as string) : base.href
	};
}

/**
 * PRJ-29 §4.5 — siapa boleh menambah Aktualisasi MANUAL. Setelan project.aktualisasi.manual: { mode:'warn'|'restrict', allowed_roles:[roleId] }.
 * 'warn' (bawaan, tanpa perubahan perilaku): semua boleh, dengan peringatan + cek duplikat. 'restrict': hanya roleId dalam daftar.
 * Daftar kosong pada 'restrict' = tidak ada yang dibatasi (jangan sampai semua terkunci karena setelan belum lengkap).
 */
export function canAddManualAktualisasi(setting: unknown, roleId: string | null | undefined): { allowed: boolean; mode: 'warn' | 'restrict' } {
	const s = (setting && typeof setting === 'object' ? setting : {}) as { mode?: string; allowed_roles?: unknown };
	if (s.mode !== 'restrict') return { allowed: true, mode: 'warn' };
	const roles = Array.isArray(s.allowed_roles) ? s.allowed_roles.map(String).filter(Boolean) : [];
	if (roles.length === 0) return { allowed: true, mode: 'restrict' };
	return { allowed: !!roleId && roles.includes(String(roleId)), mode: 'restrict' };
}
