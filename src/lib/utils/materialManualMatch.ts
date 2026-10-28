// src/lib/utils/materialManualMatch.ts
// MURNI. Audit hidden cost #1051 (Tri Daya, 20 Okt 2026): 6 dari 9 entri pemakaian material di laporan harian
// diketik "Tulis Manual" ("sarung tangan", "tiner cuci") padahal barangnya SUDAH dikirim ke proyek lewat Surat Jalan.
// Entri manual TIDAK mengurangi stok proyek (tidak ada expense_id) dan TIDAK tercatat di project_stock_ledger, sehingga
// saldo stok tetap penuh, qty_used = 0, dan pemakaian tak terlihat di biaya. Helper ini menawarkan padanan dari
// material kiriman proyek supaya leader cukup menekan satu tombol.

export interface MaterialLike {
	id: number | string;
	material_name?: string | null;
	qty_remaining?: number | string | null;
	[key: string]: unknown;
}

// Sinonim ejaan lapangan → bentuk baku (tanpa kamus panjang; tambah di sini bila ada temuan baru).
const SYNONYMS: Array<[RegExp, string]> = [
	[/\btiner\b/g, 'thinner'],
	[/\bthiner\b/g, 'thinner'],
	[/\bamplas\b/g, 'ampelas'],
	[/\bsarung tangan\b/g, 'sarung tangan']
];

export function normalizeMaterialName(raw: unknown): string {
	let s = String(raw ?? '')
		.toLowerCase()
		.replace(/["'`´]/g, ' ')
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	for (const [re, to] of SYNONYMS) s = s.replace(re, to);
	return s;
}

/**
 * Cari material kiriman proyek yang paling cocok dengan nama yang diketik manual.
 * Cocok bila salah satu nama memuat yang lain (min. 4 karakter), atau semua kata ketikan ada di nama material.
 * Material dengan sisa 0 tetap boleh cocok (pemakaian bisa dilaporkan telat), tetapi yang bersisa didahulukan.
 */
export function findMatchingMaterial<T extends MaterialLike>(typedName: unknown, materials: T[]): T | null {
	const q = normalizeMaterialName(typedName);
	if (q.length < 4 || !Array.isArray(materials) || materials.length === 0) return null;
	const qWords = q.split(' ').filter((w) => w.length >= 3);
	const candidates = materials.filter((m) => {
		const n = normalizeMaterialName(m.material_name);
		if (n.length < 4) return false;
		if (n.includes(q) || q.includes(n)) return true;
		return qWords.length > 0 && qWords.every((w) => n.includes(w));
	});
	if (!candidates.length) return null;
	const remaining = (m: T) => Number(m.qty_remaining ?? 0) || 0;
	return [...candidates].sort((a, b) => remaining(b) - remaining(a))[0];
}

export type UsageLedgerSkip = { expenseId: string | number; reason: string };

// Alasan skip yang WAJAR (bukan kegagalan): tidak perlu mengganggu leader.
const BENIGN_SKIP = [/^delta 0/i, /tidak ada identitas_barang_id/i, /bukan pilot/i];

/** Dari hasil endpoint usage-ledger: skip yang benar-benar berarti pemakaian GAGAL masuk stok proyek. */
export function realUsageSkips(skipped: UsageLedgerSkip[] | null | undefined): UsageLedgerSkip[] {
	return (skipped || []).filter((s) => !BENIGN_SKIP.some((re) => re.test(String(s?.reason || ''))));
}

/** Entri manual (tanpa expense_id) dengan jumlah > 0: pemakaian yang TIDAK akan mengurangi stok proyek. */
export function manualUsageItems(items: Array<{ is_manual?: boolean; type?: string; amount?: number | string }> | null | undefined) {
	return (items || []).filter((i) => i?.is_manual && String(i.type || '').trim() && Number(i.amount) > 0);
}
