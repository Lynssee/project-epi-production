// src/lib/utils/projectSoIds.ts
// Grand PO (audit lapangan, 29 Sep 2026) — di proyek gabungan satu proyek memuat >1 PO jasa:
// PO utama di projects.so_customer_id, PO saudara di so_customer.project_id = proyek.
// Logika MURNI (tanpa I/O) supaya konsumen lapangan yang dulu memakai `project.so_customer_id` tunggal
// bisa membaca SEMUA PO proyek. Padanan erp-epi: $lib/utils/projectSoIdMap.js.

const idOf = (v: unknown): number | null => {
	const x = v && typeof v === 'object' ? (v as { id?: unknown }).id : v;
	const n = Number(x);
	return x !== null && x !== undefined && x !== '' && Number.isFinite(n) ? n : null;
};

/** PO utama dulu, lalu PO saudara; unik, urutan stabil. Proyek 1-PO selalu menghasilkan 1 elemen. */
export function buildProjectSoIdList(
	project: { so_customer_id?: unknown } | null | undefined,
	siblingRows: Array<{ id?: unknown } | number | null | undefined> | null | undefined
): number[] {
	const out: number[] = [];
	const push = (v: unknown) => {
		const n = idOf(v);
		if (n !== null && !out.includes(n)) out.push(n);
	};
	push(project?.so_customer_id);
	for (const r of siblingRows || []) push(r);
	return out;
}

/** Gabungkan hasil baris detail beberapa PO; id ganda dibuang (aman bila dua kueri tumpang tindih). */
export function dedupeById<T extends { id?: unknown }>(rows: Array<T | null | undefined>): T[] {
	const seen = new Set<string>();
	const out: T[] = [];
	for (const r of rows || []) {
		if (!r) continue;
		const key = String(r.id);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(r);
	}
	return out;
}

/** Total nilai PO semua PO proyek (nilai_po per SO). Nilai kosong/NaN dihitung 0. */
export function sumNilaiPo(sos: Array<{ nilai_po?: unknown }> | null | undefined): number {
	return (sos || []).reduce((s, so) => {
		const n = parseFloat(String(so?.nilai_po ?? 0));
		return s + (Number.isFinite(n) ? n : 0);
	}, 0);
}
