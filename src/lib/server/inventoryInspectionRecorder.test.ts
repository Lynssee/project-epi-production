import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/directus', () => ({ directusServerJson: vi.fn() }));

import { recordInspectionsForDocument, MAX_INSPECTION_ROWS } from './inventoryInspectionRecorder';

const items = [
	{ id: 'w0', text: 'Segel utuh' },
	{ id: 'w1', text: 'Label sesuai' }
];
const one = (over: Record<string, unknown> = {}) => ({ itemId: 10, profileId: 3, items, checked: ['w0', 'w1'], ...over });

function deps(on = true, post = vi.fn(async () => ({ data: [] }))) {
	return { fetchJson: post as any, readSetting: vi.fn(async () => on), post };
}

describe('recordInspectionsForDocument (lapangan)', () => {
	it('menulis rekaman dengan token surat jalan yang disusun server', async () => {
		const d = deps();
		const r = await recordInspectionsForDocument({ inspeksi: [one()], collection: 'items/surat_jalan', recordId: 77, label: 'SJ SJ-0012', userEmail: 'a@b.c' }, d);
		expect(r).toEqual({ saved: 1 });
		const [path, opts] = d.post.mock.calls[0] as unknown as [string, RequestInit];
		expect(path).toBe('/items/inventory_knowledge_inspection');
		const rows = JSON.parse(String(opts.body));
		expect(rows[0]).toMatchObject({ item_id: 10, konteks: 'receive', referensi: 'SJ SJ-0012 [sj:77]', lengkap: true, pemeriksa_email: 'a@b.c' });
	});

	it('setelan mati / tanpa data / tanpa centang → tidak menulis', async () => {
		const off = deps(false);
		expect((await recordInspectionsForDocument({ inspeksi: [one()], collection: 'items/surat_jalan', recordId: 1 }, off)).skipped).toContain('belum dinyalakan');
		expect(off.post).not.toHaveBeenCalled();
		const d = deps();
		expect((await recordInspectionsForDocument({ inspeksi: null, collection: 'items/surat_jalan', recordId: 1 }, d)).saved).toBe(0);
		expect((await recordInspectionsForDocument({ inspeksi: [one({ checked: [] })], collection: 'items/surat_jalan', recordId: 1 }, d)).skipped).toContain('dicentang');
		expect(d.post).not.toHaveBeenCalled();
	});

	it('memvalidasi masukan klien: id tak valid/duplikat dibuang, batas jumlah', async () => {
		const d = deps();
		const many = Array.from({ length: MAX_INSPECTION_ROWS + 10 }, (_, i) => one({ itemId: i + 1 }));
		await recordInspectionsForDocument({ inspeksi: [one({ itemId: 'x' }), one({ itemId: 5 }), one({ itemId: 5 }), ...many], collection: 'items/surat_jalan', recordId: 1 }, d);
		const rows = JSON.parse(String((d.post.mock.calls[0] as unknown as [string, RequestInit])[1].body));
		expect(rows.filter((r: any) => r.item_id === 5)).toHaveLength(1);
		expect(rows.length).toBeLessThanOrEqual(MAX_INSPECTION_ROWS);
	});

	it('gagal menulis tidak pernah melempar', async () => {
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const d = deps(true, vi.fn(async () => { throw new Error('403'); }) as any);
		await expect(recordInspectionsForDocument({ inspeksi: [one()], collection: 'items/surat_jalan', recordId: 1 }, d)).resolves.toMatchObject({ saved: 0 });
		spy.mockRestore();
	});
});
