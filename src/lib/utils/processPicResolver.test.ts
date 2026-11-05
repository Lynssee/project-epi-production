// src/lib/utils/processPicResolver.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizePicText, splitPicText, buildPosisiIndex, matchPicToken, resolveNodePositions, parseAliasSetting } from './processPicResolver';

// Cuplikan master live (id & nama asli), termasuk nama dobel dan baris [TIDAK DIPAKAI].
const POSISI = [
	{ id: 3, nama_posisi: 'MANAGER' },
	{ id: 11, nama_posisi: 'MANAGER' },
	{ id: 6, nama_posisi: '[TIDAK DIPAKAI] digabung ke STAFF' },
	{ id: 9, nama_posisi: 'ADMIN' },
	{ id: 30, nama_posisi: 'PROJECT LEADER' },
	{ id: 63, nama_posisi: 'PROJECT LEADER (EPOXY)' },
	{ id: 58, nama_posisi: 'PROJECT MANAGER' },
	{ id: 68, nama_posisi: 'ADMIN INVENTORY' },
	{ id: 76, nama_posisi: 'PROCUREMENT' },
	{ id: 53, nama_posisi: 'SALES REPRESENTATIVE (FOXAPAINT)' },
	{ id: 54, nama_posisi: 'SALES REPRESENTATIVE (PROJECT)' },
	{ id: 17, nama_posisi: 'AR & TAX' }
];
const idx = (aliases: Record<string, unknown> = {}) => buildPosisiIndex(POSISI, aliases);

describe('normalisasi & pemecahan', () => {
	it('normalisasi huruf & tanda baca', () => {
		expect(normalizePicText('  Admin   Gudang (Inventory) ')).toBe('admin gudang inventory');
		expect(normalizePicText(null)).toBe('');
	});
	it('memecah beberapa PIC, dedup; singkatan R&D tidak dipecah', () => {
		expect(splitPicText('Project Leader, Mandor')).toEqual(['Project Leader', 'Mandor']);
		expect(splitPicText('Admin Gudang & Procurement / Finance dan Kasir')).toEqual(['Admin Gudang', 'Procurement', 'Finance', 'Kasir']);
		expect(splitPicText('Formulator R&D, QC')).toEqual(['Formulator R&D', 'QC']);
		expect(splitPicText(undefined)).toEqual([]);
	});
});

describe('matchPicToken', () => {
	it('exact unik → resolved; nama dobel → ambigu; baris nonaktif dibuang', () => {
		expect(matchPicToken('Project Leader', idx())).toMatchObject({ confidence: 'exact', resolved: true, posisi_id: 30 });
		const m = matchPicToken('Manager', idx());
		expect(m).toMatchObject({ confidence: 'ambiguous', resolved: false, posisi_id: null });
		expect(idx().byId.has(6)).toBe(false);
	});
	it('alias menang; alias ke id yang tak ada dilaporkan & diabaikan', () => {
		const i = idx({ 'Admin Gudang': 68, 'Foo Bar': 9999 });
		expect(matchPicToken('admin gudang', i)).toMatchObject({ confidence: 'alias', resolved: true, posisi_id: 68 });
		expect(i.badAliases).toEqual([{ text: 'Foo Bar', id: 9999 }]);
	});
	it('saran / ambigu / none; nama satu kata terlalu umum untuk saran', () => {
		expect(matchPicToken('Project Leader Lapangan', idx())).toMatchObject({ confidence: 'suggest', resolved: false, posisi_id: 30 });
		expect(matchPicToken('Sales Representative', idx()).confidence).toBe('ambiguous');
		expect(matchPicToken('Admin Gudang', idx()).confidence).toBe('none');
		expect(matchPicToken('Pelamar Kerja', idx()).confidence).toBe('none');
		expect(matchPicToken('x', null).confidence).toBe('none');
	});
});

describe('resolveNodePositions', () => {
	it('posisi_ids manual menang; id tak ada → missing', () => {
		const r = resolveNodePositions({ pic: 'Project Leader', posisi_ids: [58, 9999] }, idx());
		expect(r).toMatchObject({ source: 'explicit', posisiIds: [58], missing: [9999] });
	});
	it('multi-peran: hanya yang pasti masuk; nama bertanda & dicocokkan utuh', () => {
		expect(resolveNodePositions({ pic: 'Project Leader, Mandor' }, idx())).toMatchObject({ posisiIds: [30], unresolved: ['Mandor'] });
		expect(resolveNodePositions({ pic: 'AR & TAX' }, idx()).posisiIds).toEqual([17]);
		expect(resolveNodePositions(null, idx()).source).toBe('none');
	});
});

describe('parseAliasSetting', () => {
	it('teks JSON/objek; entri rusak dibuang; rusak total → kosong', () => {
		expect(parseAliasSetting('{"A":1,"B":"x","":2,"C":-1}')).toEqual({ A: 1 });
		expect(parseAliasSetting('bukan json')).toEqual({});
		expect(parseAliasSetting([1])).toEqual({});
	});
});

// PARITY: aturan pencocokan HARUS sama dengan dashboard admin. Dilewati bila repo erp-epi tidak ada di sebelah (mis. CI).
const erpPath = resolve(process.cwd(), '..', 'erp-epi', 'src/lib/utils/processPicResolver.js');
describe('parity dengan erp-epi', () => {
	it.skipIf(!existsSync(erpPath))('hasil identik untuk tabel masukan yang sama', async () => {
		const erp = await import(/* @vite-ignore */ pathToFileURL(erpPath).href);
		const aliases = { 'Admin Gudang': 68 };
		const a = buildPosisiIndex(POSISI, aliases);
		const b = erp.buildPosisiIndex(POSISI, aliases);
		const cases = ['Project Leader', 'Project Leader Lapangan', 'Manager', 'Admin Gudang', 'Sales Representative', 'Pelamar Kerja', 'AR & TAX', 'Formulator R&D', 'Project Leader, Mandor', 'HSE Officer / Project Manager'];
		for (const c of cases) {
			expect(resolveNodePositions({ pic: c }, a), c).toEqual(erp.resolveNodePositions({ pic: c }, b));
		}
	});
});
