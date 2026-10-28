// src/lib/constants/catItem.ts
// Heuristik klien: baris barang di Goods Received yang berupa CAT/coating, supaya checklist kondisi
// visual (segel, bocor/karat, homogen) hanya muncul untuk barang yang relevan. Hanya memengaruhi tampilan
// checklist (opsional, tidak memblokir konfirmasi), jadi false-positive/negative tidak berbahaya.

const CAT_KEYWORDS = ['cat ', 'epoxy', 'polyurethane', 'hardener', 'thinner', 'primer', 'zinc', 'coating', 'alkyd', 'lacquer'];

export function isCatItem(materialName: string | null | undefined): boolean {
	const n = ` ${String(materialName || '').toLowerCase()} `;
	return CAT_KEYWORDS.some((k) => n.includes(k));
}

/** Tiga pemeriksaan visual. Semua dicentang = kondisi baik. */
export const CEK_CAT_FIELDS = [
	{ key: 'segel_utuh', label: 'Segel kaleng utuh', hint: 'Tutup/segel tidak pernah dibuka dan tidak penyok.' },
	{ key: 'tidak_bocor_karat', label: 'Tidak bocor / berkarat', hint: 'Tidak ada rembesan cat di kemasan atau karat di kaleng.' },
	{ key: 'homogen_diaduk', label: 'Homogen saat diaduk pertama', hint: 'Buka satu kaleng sampel: cat menyatu, tidak mengeras di dasar atau menggumpal.' }
] as const;

export type CekCatKey = (typeof CEK_CAT_FIELDS)[number]['key'];
export type CekCatState = Record<CekCatKey, boolean>;

export function emptyCekCat(): CekCatState {
	return { segel_utuh: false, tidak_bocor_karat: false, homogen_diaduk: false };
}
