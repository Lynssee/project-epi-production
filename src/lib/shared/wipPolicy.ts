// src/lib/shared/wipPolicy.ts
// FIN-15 (K10) — kebijakan WIP di sisi project-epi. SALINAN logika minimal dari erp-epi
// src/lib/finance/wipPolicy.js (repo berbeda, tidak bisa saling impor) — UBAH KEDUANYA BERSAMAAN.
// Tanpa import supaya aman dipakai server maupun klien.
//
// Biaya proyek baru (>= finance.proyek.wip_sejak) ditahan di 1132-001 WIP sampai BAST; kosong = mati = perilaku lama.

export const AKUN_WIP_DEFAULT = '1132-001';
export const AKUN_BIAYA_WIP_DEFAULT = ['5100001', '5100008', '5100011', '5100012', '5100013', '5100014', '5130-010', '5130-013', '5130-015'];

export interface KebijakanWip {
	aktif: boolean;
	akun: string;
	akunBiaya: string[];
}

const ymd = (s: unknown): string | null => (/^\d{4}-\d{2}-\d{2}/.test(String(s ?? '')) ? String(s).slice(0, 10) : null);

export function wipBerlaku(tanggal: unknown, sejak: unknown): boolean {
	const from = ymd(sejak);
	const d = ymd(tanggal);
	return !!from && !!d && d >= from;
}

/** Nilai system_settings disimpan sebagai JSON ("1132-001", [..]); kembalikan nilai terurai atau fallback. */
export function bacaSetelan<T>(raw: unknown, fallback: T): T {
	if (raw == null) return fallback;
	if (typeof raw !== 'string') return raw as T;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return raw as unknown as T;
	}
}

export function susunKebijakanWip(tanggal: unknown, rows: Array<{ setting_key: string; setting_value: unknown }>): KebijakanWip {
	const get = (k: string) => rows.find((r) => r.setting_key === k)?.setting_value;
	const list = bacaSetelan<unknown>(get('finance.proyek.akun_biaya_wip'), null);
	const akun = String(bacaSetelan<unknown>(get('finance.akun.wip_proyek'), '') || AKUN_WIP_DEFAULT).trim() || AKUN_WIP_DEFAULT;
	return {
		aktif: wipBerlaku(tanggal, bacaSetelan<unknown>(get('finance.proyek.wip_sejak'), '')),
		akun,
		akunBiaya: Array.isArray(list) && list.length ? list.map(String) : AKUN_BIAYA_WIP_DEFAULT
	};
}

export const KUNCI_SETELAN_WIP = ['finance.proyek.wip_sejak', 'finance.akun.wip_proyek', 'finance.proyek.akun_biaya_wip'];

/** Debit biaya proyek: WIP bila kebijakan aktif, transaksi bertanda proyek, dan akun asal termasuk akun biaya proyek. */
export function debitBiayaProyek(p: {
	mappingDebit: string;
	mappingDebitName: string;
	jenisLabel?: string;
	projectId?: number | string | null;
	wip: KebijakanWip;
}): { account_code: string; account_name: string; dialihkan: boolean; prefix: string } {
	const { mappingDebit, mappingDebitName, jenisLabel, projectId, wip } = p;
	const harus = wip?.aktif && !!projectId && mappingDebit !== wip.akun && mappingDebit.startsWith('5') && wip.akunBiaya.includes(mappingDebit);
	if (!harus) return { account_code: mappingDebit, account_name: mappingDebitName, dialihkan: false, prefix: '' };
	return {
		account_code: wip.akun,
		account_name: 'Pekerjaan Dalam Pelaksanaan (WIP Proyek)',
		dialihkan: true,
		prefix: `[WIP ${mappingDebit}${jenisLabel ? ' ' + jenisLabel : ''}] `
	};
}
