// src/lib/utils/processTraining.test.ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { trainingForNode, kategoriEnrollment, bestOf } from './processTraining';

const FLOW: any = {
	training: [{ program_id: 18, wajib: true, catatan: 'Semua personel' }, { program_id: 13, wajib: false }, { program_id: 0 }, null],
	nodes: [
		{ id: 'blast', training_ids: [13, 14, 14, 'x'] },
		{ id: 'polos' }
	]
};

describe('trainingForNode', () => {
	it('tautan langkah + tautan alur; langkah menang untuk scope, wajib/catatan dari alur', () => {
		const r = trainingForNode(FLOW, 'blast');
		expect(r.map((x) => `${x.program_id}:${x.scope}`).sort()).toEqual(['13:langkah', '14:langkah', '18:alur']);
		expect(r.find((x) => x.program_id === 18)).toMatchObject({ wajib: true, catatan: 'Semua personel' });
		expect(r.find((x) => x.program_id === 14)).toMatchObject({ wajib: false, scope: 'langkah' });
	});
	it('langkah tanpa tautan sendiri mewarisi tautan alur; langkah tak dikenal sama; masukan rusak aman', () => {
		expect(trainingForNode(FLOW, 'polos').map((x) => x.program_id).sort()).toEqual([13, 18]);
		expect(trainingForNode(FLOW, 'zzz').every((x) => x.scope === 'alur')).toBe(true);
		expect(trainingForNode(null, 'x')).toEqual([]);
		expect(trainingForNode({ nodes: [null as any] }, 'x')).toEqual([]);
	});
});

describe('kategoriEnrollment / bestOf', () => {
	it('Lulus > berjalan > belum', () => {
		expect(kategoriEnrollment('Lulus')).toBe('lulus');
		for (const s of ['Enrolled', 'ongoing', 'Remedial']) expect(kategoriEnrollment(s)).toBe('berjalan');
		for (const s of ['Batal', '', null, undefined]) expect(kategoriEnrollment(s)).toBe('belum');
		expect(bestOf('belum', 'berjalan')).toBe('berjalan');
		expect(bestOf('lulus', 'berjalan')).toBe('lulus');
	});
});

// PARITY dengan dashboard admin: aturan tautan harus sama. Dilewati bila repo erp-epi tidak ada di sebelah (mis. CI).
const erpPath = resolve(process.cwd(), '..', 'erp-epi', 'src/lib/utils/processTrainingIndex.js');
describe('parity dengan erp-epi', () => {
	it.skipIf(!existsSync(erpPath))('trainingForNode identik untuk alur yang sama', async () => {
		const erp = await import(/* @vite-ignore */ pathToFileURL(erpPath).href);
		for (const id of ['blast', 'polos', 'zzz']) {
			const a = trainingForNode(FLOW, id);
			const b = erp.trainingForNode(FLOW, id);
			expect(a.map((x) => [x.program_id, x.scope, x.wajib, x.catatan]).sort()).toEqual(b.map((x: any) => [x.program_id, x.scope, x.wajib, x.catatan]).sort());
		}
	});
});
