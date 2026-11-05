import { describe, it, expect } from 'vitest';
import { searchKendala, tokenize, MAX_QUERY } from './kendalaSearch';

const flows = [
	{
		id: 'laporan_harian', title: 'Laporan Harian', lanes: [], edges: [], description: '',
		nodes: [
			{ id: 'foto', label: 'Foto Berita Acara', desc: 'Ambil foto BA', blockers: ['Foto BA belum diunggah'], gates: [{ key: 'G_LH_FOTO_BA', modul: 'project_report', documentType: 'laporan_harian' }], checklist: ['Foto 2 sisi'] },
			{ id: 'kurva', label: 'Isi progres', desc: '', blockers: ['Kurva S tidak sesuai target'], checklist: ['Update kurva s mingguan'] }
		]
	},
	{ id: 'sales', title: 'Alur Sales', lanes: [], edges: [], description: '', nodes: [{ id: 'kredit', label: 'Cek kredit', desc: 'Customer kredit hold harus dilunasi', blockers: [], checklist: [] }] }
] as any[];

describe('searchKendala', () => {
	it('mencari di kendala; kata kunci tidak peka huruf besar-kecil & pemisah', () => {
		const r = searchKendala(flows, 'kurva s');
		expect(r[0]).toMatchObject({ flow_id: 'laporan_harian', node_id: 'kurva', kind: 'kendala', snippet: 'Kurva S tidak sesuai target' });
	});

	it('kode gate cocok walau diketik tanpa garis bawah; satu hasil terbaik per langkah (kendala menang atas gate)', () => {
		const r = searchKendala(flows, 'foto ba');
		expect(r).toHaveLength(1);
		expect(r[0]).toMatchObject({ node_id: 'foto', kind: 'kendala' });
		expect(searchKendala(flows, 'g lh foto')[0]).toMatchObject({ node_id: 'foto', kind: 'gate' });
		expect(searchKendala(flows, 'G_LH_FOTO_BA')[0].kind).toBe('gate');
	});

	it('mencocokkan langkah/deskripsi lintas alur; semua kata harus ada pada satu bidang', () => {
		expect(searchKendala(flows, 'kredit hold')[0]).toMatchObject({ flow_id: 'sales', kind: 'langkah' });
		expect(searchKendala(flows, 'kurva kredit')).toEqual([]);
	});

	it('urutan: kendala dulu; batas hasil dihormati', () => {
		const many = [{ id: 'f', title: 'F', lanes: [], edges: [], description: '', nodes: Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, label: `Langkah foto ${i}`, desc: '', blockers: [], checklist: [] })) }] as any[];
		expect(searchKendala(many, 'foto')).toHaveLength(12);
		expect(searchKendala(many, 'foto', 3)).toHaveLength(3);
		const rank = ['kendala', 'gate', 'syarat', 'langkah'];
		const kinds = searchKendala(flows, 'kurva').map((h) => rank.indexOf(h.kind));
		expect(kinds).toEqual([...kinds].sort((a, b) => a - b));
	});

	it('kueri pendek/kosong/ngawur tidak crash; panjang dibatasi; data rusak diabaikan', () => {
		expect(searchKendala(flows, '')).toEqual([]);
		expect(searchKendala(flows, 'a')).toEqual([]);
		expect(searchKendala(flows, 'zzzz tidak ada')).toEqual([]);
		expect(tokenize('x'.repeat(500)).join('').length).toBeLessThanOrEqual(MAX_QUERY);
		expect(() => searchKendala(null as any, 'foto')).not.toThrow();
		expect(() => searchKendala([{ id: 'x', title: 'X', nodes: [null, { id: 'y', label: 'foto' }] }] as any, 'foto')).not.toThrow();
	});
});
