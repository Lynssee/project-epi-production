// PR-08 — simpan item PR secara ATOMIK (mirror erp-epi/src/lib/server/prItemsAtomic.js). Satu item gagal ->
// semua item yang sudah tersimpan + header PR dibatalkan, error menyebut nama item. Operasi disuntikkan
// supaya bisa diuji tanpa Directus.

export type AtomicFailure = { nama: string; error: string };
export type AtomicError = Error & { failed: AtomicFailure[]; rolledBack: boolean };

export async function saveItemsAtomically(p: {
	items: Array<{ nama_barang?: string }>;
	createItem: (item: any) => Promise<{ data?: { id?: any } } | null | undefined>;
	deleteItem: (id: any) => Promise<unknown>;
	deleteHeader: () => Promise<unknown>;
	onRollbackError?: (what: string, err: unknown) => void;
}): Promise<{ createdIds: any[] }> {
	const { items, createItem, deleteItem, deleteHeader, onRollbackError = () => {} } = p;
	const createdIds: any[] = [];
	const failed: AtomicFailure[] = [];
	for (const item of items || []) {
		try {
			const res = await createItem(item);
			const id = res?.data?.id ?? (res as any)?.id;
			if (id == null) throw new Error('Directus tidak mengembalikan id item');
			createdIds.push(id);
		} catch (e: any) {
			failed.push({ nama: item?.nama_barang || '(tanpa nama)', error: e?.message || String(e) });
			break; // berhenti di kegagalan pertama, lalu rollback
		}
	}
	if (failed.length === 0) return { createdIds };

	let rolledBack = true;
	for (const id of createdIds) {
		try {
			await deleteItem(id);
		} catch (e) {
			rolledBack = false;
			onRollbackError(`hapus item ${id}`, e);
		}
	}
	try {
		await deleteHeader();
	} catch (e) {
		rolledBack = false;
		onRollbackError('hapus header PR', e);
	}

	const failedSummary = failed.map((f) => (f.error ? `${f.nama}: ${f.error}` : f.nama)).join(', ');
	const err = new Error(
		`Item gagal disimpan: ${failedSummary}. ` +
			(rolledBack
				? 'Pengajuan dibatalkan — silakan kirim ulang.'
				: 'Pengajuan sempat terbentuk sebagian — hubungi Procurement/IT untuk dibersihkan.')
	) as AtomicError;
	err.failed = failed;
	err.rolledBack = rolledBack;
	throw err;
}
