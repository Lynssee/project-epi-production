// src/lib/utils/siteGroupList.ts
// GPM-C11 — pengelompokan daftar proyek di pemilih check-in: proyek se-site (≥ 2 PO di daftar) dikumpulkan di bawah satu judul
// "Nama Site — N PO"; proyek tanpa grup (atau satu-satunya di sitenya) tampil biasa. Urutan asli dipertahankan: grup muncul di posisi
// anggota pertamanya. Murni (tanpa I/O) agar mudah diuji.

export interface ProyekBersite {
	id: number;
	site_id?: number | null;
	site_nama?: string | null;
	site_jumlah?: number;
}

export type BarisPemilih<T extends ProyekBersite> =
	| { type: 'header'; key: string; nama: string; jumlah: number }
	| { type: 'project'; key: string; p: T; dalamGrup: boolean };

export function susunBarisPemilih<T extends ProyekBersite>(daftar: T[]): Array<BarisPemilih<T>> {
	// berapa anggota tiap site yang benar-benar ada di daftar yang sedang tampil (hasil saring bisa memangkas grup)
	const hitung = new Map<number, number>();
	for (const p of daftar) if (p.site_id) hitung.set(p.site_id, (hitung.get(p.site_id) || 0) + 1);

	const sudah = new Set<number>();
	const out: Array<BarisPemilih<T>> = [];
	for (const p of daftar) {
		const sid = p.site_id || 0;
		if (!sid || (hitung.get(sid) || 0) < 2) {
			out.push({ type: 'project', key: `p${p.id}`, p, dalamGrup: false });
			continue;
		}
		if (sudah.has(sid)) continue;
		sudah.add(sid);
		out.push({ type: 'header', key: `s${sid}`, nama: p.site_nama || `Site #${sid}`, jumlah: hitung.get(sid) || 0 });
		for (const q of daftar) if (q.site_id === sid) out.push({ type: 'project', key: `p${q.id}`, p: q, dalamGrup: true });
	}
	return out;
}
