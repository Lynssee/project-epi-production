// src/routes/api/sop-context/+server.ts
// Konteks SOP & Gate untuk satu tab cockpit proyek. GET ?tab=<tab cockpit: informasi|keuangan|laporan|progress|manpower|barang|dokumen>
// Hanya baca (konfigurasi diatur Superadmin di dashboard admin). Tab tanpa padanan → konteks kosong.
import { json, type RequestHandler } from '@sveltejs/kit';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getViewContext } from '$lib/server/sopContext';
import { contextKeyForFieldTab } from '$lib/utils/sopContext';

export const GET: RequestHandler = async (event) => {
	await authenticateEss(event);
	const tab = (event.url.searchParams.get('tab') || '').trim();
	const key = contextKeyForFieldTab(tab);
	if (!key) return json({ success: true, key: null, sumber: 'kosong', catatan: '', sops: [], gates: [] });
	try {
		return json({ success: true, ...(await getViewContext(key)) });
	} catch (err: any) {
		console.error('[/api/sop-context] gagal:', err?.message || err);
		return json({ success: false, error: err?.message || 'Gagal memuat konteks SOP' }, { status: 500 });
	}
};
