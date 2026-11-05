// src/lib/utils/processHandoffContacts.test.ts
import { describe, it, expect } from 'vitest';
import { handoffPosisiIds, attachHandoff, buildRoleContacts, isActiveKaryawan, MAX_PEOPLE_PER_ROLE } from './processHandoffContacts';
import { buildPosisiIndex } from './processPicResolver';
import { extractMyTasks } from './processMyTasks';

const index = buildPosisiIndex([
	{ id: 30, nama_posisi: 'PROJECT LEADER' },
	{ id: 58, nama_posisi: 'PROJECT MANAGER' },
	{ id: 68, nama_posisi: 'ADMIN INVENTORY' },
	{ id: 70, nama_posisi: 'FINANCE' }
]);
const n = (id: string, over: any = {}) => ({ id, type: 'task', lane: 'a', col: 0, label: `L-${id}`, desc: '', ...over });
const flow = (nodes: any[], edges: [string, string][]): any => ({
	id: 'f1', title: 'Alur 1', description: '', lanes: [{ key: 'a', label: 'A' }], nodes, edges: edges.map(([from, to]) => ({ from, to }))
});

describe('handoffPosisiIds', () => {
	const f = flow(
		[n('a', { pic: 'Project Leader' }), n('b', { pic: 'Project Manager' }), n('d', { type: 'decision', pic: '' }), n('c', { pic: 'Admin Inventory' }), n('x', { pic: 'Project Leader' }), n('e', { type: 'end' })],
		[['a', 'b'], ['b', 'd'], ['d', 'c'], ['d', 'x'], ['c', 'e']]
	);
	it('langkah berikutnya langsung', () => {
		expect(handoffPosisiIds(f, 'a', index, 30)).toEqual([58]);
	});
	it('melewati keputusan tanpa PIC; jabatan saya sendiri & langkah end tidak dihitung', () => {
		expect(handoffPosisiIds(f, 'b', index, 30)).toEqual([68]); // d → c (68); d → x (30 = saya) dibuang
		expect(handoffPosisiIds(f, 'c', index, 30)).toEqual([]); // hanya end
	});
	it('batas jumlah jabatan, tidak berputar pada siklus, tidak melempar pada data rusak', () => {
		const cyc = flow([n('a', { pic: 'Project Leader' }), n('b', { type: 'decision' })], [['a', 'b'], ['b', 'a']]);
		expect(handoffPosisiIds(cyc, 'a', index, 30)).toEqual([]);
		const wide = flow([n('a', { pic: 'Project Leader' }), n('b', { pic: 'Project Manager' }), n('c', { pic: 'Admin Inventory' }), n('d', { pic: 'Finance' })], [['a', 'b'], ['a', 'c'], ['a', 'd']]);
		expect(handoffPosisiIds(wide, 'a', index, 30, 2)).toEqual([58, 68]);
		expect(() => handoffPosisiIds({ id: 'x' } as any, 'a', index, 30)).not.toThrow();
		expect(handoffPosisiIds(f, 'tidak-ada', index, 30)).toEqual([]);
	});
});

describe('attachHandoff', () => {
	it('menambahkan handoff_to hanya pada tugas yang punya penerima; mengumpulkan jabatan unik', () => {
		const f = flow([n('a', { pic: 'Project Leader' }), n('b', { pic: 'Project Manager' }), n('z', { pic: 'Project Leader' })], [['a', 'b']]);
		const base = extractMyTasks([f], index, 30);
		const { tasks, posisiIds } = attachHandoff(base, [f], index, 30);
		expect(tasks.find((t) => t.node_id === 'a')!.handoff_to).toEqual([58]);
		expect(tasks.find((t) => t.node_id === 'z')!.handoff_to).toBeUndefined();
		expect(posisiIds).toEqual([58]);
	});
});

describe('buildRoleContacts', () => {
	const kar = [
		{ id: 1, nama_karyawan: 'Saya', no_hp: '0811', jabatan_id: 58, status_kerja: 'Aktif' },
		{ id: 2, nama_karyawan: 'Budi', no_hp: '0812-3456-7890', jabatan_id: 58, status_kerja: 'Aktif' },
		{ id: 3, nama_karyawan: 'Sari', no_hp: '', jabatan_id: 58, status_kerja: 'aktif' },
		{ id: 4, nama_karyawan: 'Resign', no_hp: '0813', jabatan_id: 58, status_kerja: 'Resign' },
		{ id: 5, nama_karyawan: 'Orang Lain', no_hp: '0814', jabatan_id: 70, status_kerja: 'Aktif' },
		{ id: 6, nama_karyawan: 'Ngawur', no_hp: '123', jabatan_id: 58, status_kerja: 'Aktif' }
	];
	const holderOf = (k: any) => k.jabatan_id ?? null;

	it('hanya pemegang aktif jabatan yang diminta; saya & nonaktif dikecualikan; jabatan lain tidak bocor', () => {
		const r = buildRoleContacts(kar, holderOf, [58], index, 1);
		expect(Object.keys(r)).toEqual(['58']);
		expect(r[58].nama).toBe('PROJECT MANAGER');
		expect(r[58].people.map((p) => p.nama)).toEqual(['Budi', 'Ngawur', 'Sari']);
		expect(r[58].total).toBe(3);
	});
	it('nomor dinormalkan ke 62…; kosong/tak valid → "" (UI menyembunyikan tombol)', () => {
		const people = buildRoleContacts(kar, holderOf, [58], index, 1)[58].people;
		expect(people.find((p) => p.nama === 'Budi')!.wa).toBe('6281234567890');
		expect(people.find((p) => p.nama === 'Sari')!.wa).toBe('');
		expect(people.find((p) => p.nama === 'Ngawur')!.wa).toBe('');
	});
	it('dibatasi MAX_PEOPLE_PER_ROLE tetapi total tetap benar; jabatan tanpa pemegang → people kosong', () => {
		const many = Array.from({ length: 9 }, (_, i) => ({ id: 100 + i, nama_karyawan: `K${i}`, no_hp: '08123456789', jabatan_id: 68, status_kerja: 'Aktif' }));
		const r = buildRoleContacts(many, holderOf, [68, 70], index);
		expect(r[68].people).toHaveLength(MAX_PEOPLE_PER_ROLE);
		expect(r[68].total).toBe(9);
		expect(r[70]).toMatchObject({ people: [], total: 0 });
	});
	it('input rusak tidak melempar', () => {
		expect(() => buildRoleContacts(null as any, holderOf, [58], index)).not.toThrow();
		expect(() => buildRoleContacts([null, {}] as any, holderOf, [58], index)).not.toThrow();
	});
});

describe('isActiveKaryawan', () => {
	it('status_kerja nonaktif / status off → tidak aktif', () => {
		expect(isActiveKaryawan({ status_kerja: 'Resign' })).toBe(false);
		expect(isActiveKaryawan({ status_kerja: 'Tidak Aktif' })).toBe(false);
		expect(isActiveKaryawan({ status: 'off' })).toBe(false);
		expect(isActiveKaryawan({ status_kerja: 'Aktif' })).toBe(true);
		expect(isActiveKaryawan(null)).toBe(true);
	});
});
