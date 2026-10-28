// src/lib/shared/manpowerGroups.ts
// Pembaca MURNI kolom `reports.manpower` (tab Tenaga). Kembar erp-epi: src/lib/shared/manpowerGroups.js.
// R2-10/R2-11: id pekerja hanya sah bila bilangan bulat positif — "null"/""/0 BUKAN id (jangan pernah dijadikan kunci pencocokan).

export const idNum = (v: unknown): number | null => {
	const raw = v && typeof v === 'object' ? (v as any).id : v;
	if (raw === null || raw === undefined) return null;
	const s = String(raw).trim();
	if (!/^\d+$/.test(s)) return null;
	const n = Number(s);
	return n > 0 ? n : null;
};

/** Grup tenaga dari kolom JSON/string `reports.manpower`. */
export function parseManpowerGroups(raw: unknown): any[] {
	let v: any = raw;
	if (typeof v === 'string') {
		try {
			v = JSON.parse(v);
		} catch {
			return [];
		}
	}
	return Array.isArray(v) ? v.filter((g) => g && typeof g === 'object') : [];
}

export interface TenagaTanpaNama {
	role: string;
	total: number;
	named: number;
	tanpa_nama: number;
}

/**
 * Grup tenaga yang jumlahnya lebih besar dari pekerja bernama (K3: harian wajib nama; borongan cukup mandor/vendor).
 */
export function findTenagaTanpaNama(manpower: unknown): TenagaTanpaNama[] {
	const out: TenagaTanpaNama[] = [];
	for (const g of parseManpowerGroups(manpower)) {
		const role = String(g.role || 'HARIAN').toUpperCase();
		if (role === 'STANDBY') continue;
		const workers: any[] = Array.isArray(g.workers) ? g.workers : [];
		const named = workers.filter((w) => w && idNum(w.id) && String(w.nama || '').trim() !== '').length;
		const total = Math.max(Number(g.count) || 0, workers.length);
		if (total <= 0) continue;
		if (role === 'BORONGAN') {
			if (named < 1) out.push({ role, total, named, tanpa_nama: total - named }); // wajib ada mandor/vendor bernama
		} else if (named < total) {
			out.push({ role, total, named, tanpa_nama: total - named });
		}
	}
	return out;
}

/** Jumlah pekerja BERNAMA dari seluruh grup (dasar `manpower_count` yang konsisten dengan isi — R2-11). */
export function countNamedWorkers(manpower: unknown): number {
	let n = 0;
	for (const g of parseManpowerGroups(manpower)) {
		for (const w of Array.isArray(g.workers) ? g.workers : []) {
			if (w && idNum(w.id) && String(w.nama || '').trim() !== '') n++;
		}
	}
	return n;
}
