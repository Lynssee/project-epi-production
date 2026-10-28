import { describe, it, expect, vi } from 'vitest';
import { saveItemsAtomically } from './saveItemsAtomically';

function mk(failOn: string[] = []) {
	const created: number[] = [];
	const deleted: number[] = [];
	let headerDeleted = false;
	return {
		created,
		deleted,
		get headerDeleted() {
			return headerDeleted;
		},
		ops: {
			createItem: vi.fn(async (it: any) => {
				if (failOn.includes(it.nama_barang)) throw new Error('kolom tidak valid');
				const id = created.length + 100;
				created.push(id);
				return { data: { id } };
			}),
			deleteItem: vi.fn(async (id: any) => {
				deleted.push(id);
			}),
			deleteHeader: vi.fn(async () => {
				headerDeleted = true;
			})
		}
	};
}

describe('saveItemsAtomically (PR-08, project-epi)', () => {
	it('semua tersimpan -> id dikembalikan, tanpa rollback', async () => {
		const m = mk();
		const r = await saveItemsAtomically({ items: [{ nama_barang: 'A' }, { nama_barang: 'B' }], ...m.ops });
		expect(r.createdIds).toEqual([100, 101]);
		expect(m.deleted).toEqual([]);
		expect(m.headerDeleted).toBe(false);
	});

	it('item ke-2 gagal -> item pertama & header dihapus, pesan menyebut nama item', async () => {
		const m = mk(['Kabel NYY']);
		await expect(
			saveItemsAtomically({ items: [{ nama_barang: 'Baut' }, { nama_barang: 'Kabel NYY' }, { nama_barang: 'Lem' }], ...m.ops })
		).rejects.toMatchObject({ message: expect.stringContaining('Kabel NYY'), rolledBack: true });
		expect(m.deleted).toEqual([100]);
		expect(m.headerDeleted).toBe(true);
		expect(m.ops.createItem).toHaveBeenCalledTimes(2);
	});

	it('rollback gagal -> rolledBack=false, pesan jujur', async () => {
		const m = mk(['B']);
		m.ops.deleteHeader.mockRejectedValueOnce(new Error('403'));
		await expect(saveItemsAtomically({ items: [{ nama_barang: 'A' }, { nama_barang: 'B' }], ...m.ops })).rejects.toMatchObject({
			rolledBack: false,
			message: expect.stringContaining('hubungi Procurement/IT')
		});
	});
});
