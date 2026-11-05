import { describe, expect, it } from 'vitest';
import { susunBarisPemilih } from './siteGroupList';

const p = (id: number, site_id: number | null = null, site_nama: string | null = null) => ({ id, site_id, site_nama });

describe('susunBarisPemilih', () => {
	it('tanpa grup: daftar apa adanya, urutan sama', () => {
		const r = susunBarisPemilih([p(3), p(1), p(2)]);
		expect(r.map((x) => x.key)).toEqual(['p3', 'p1', 'p2']);
		expect(r.every((x) => x.type === 'project' && !x.dalamGrup)).toBe(true);
	});

	it('proyek se-site dikumpulkan di bawah satu judul "Nama — N", di posisi anggota pertama', () => {
		const r = susunBarisPemilih([p(877, 1, 'PT Prakarsalanggeng'), p(10), p(895, 1, 'PT Prakarsalanggeng'), p(904, 1, 'PT Prakarsalanggeng'), p(20)]);
		expect(r.map((x) => x.key)).toEqual(['s1', 'p877', 'p895', 'p904', 'p10', 'p20']);
		const h = r[0];
		expect(h).toMatchObject({ type: 'header', nama: 'PT Prakarsalanggeng', jumlah: 3 });
		expect(r.slice(1, 4).every((x) => x.type === 'project' && x.dalamGrup)).toBe(true);
	});

	it('site dengan hanya satu anggota di daftar tidak diberi judul (mis. sisanya tersaring)', () => {
		const r = susunBarisPemilih([p(877, 1, 'PT X'), p(10)]);
		expect(r.map((x) => x.key)).toEqual(['p877', 'p10']);
		expect(r[0]).toMatchObject({ type: 'project', dalamGrup: false });
	});

	it('dua site berbeda → dua judul terpisah; nama site kosong memakai "Site #id"', () => {
		const r = susunBarisPemilih([p(1, 1, 'A'), p(2, 2), p(3, 1, 'A'), p(4, 2)]);
		expect(r.map((x) => x.key)).toEqual(['s1', 'p1', 'p3', 's2', 'p2', 'p4']);
		expect(r.find((x) => x.key === 's2')).toMatchObject({ nama: 'Site #2', jumlah: 2 });
	});

	it('daftar kosong → kosong', () => {
		expect(susunBarisPemilih([])).toEqual([]);
	});
});
