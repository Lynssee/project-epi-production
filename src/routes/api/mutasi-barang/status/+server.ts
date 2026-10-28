// src/routes/api/mutasi-barang/status/+server.ts
// RSM-13 — apakah skema e-SJ Mutasi sudah diterapkan? Dipakai UI untuk memilih layar baru atau jalur lama (masa transisi).
// Bila server admin tak terjangkau, jawab `tersedia:false` + alasan (UI jatuh ke jalur lama), bukan error layar.
import { json, type RequestHandler } from '@sveltejs/kit';
import { karyawanDariEvent, panggilMutasiErp } from '$lib/server/mutasiBridge';

export const GET: RequestHandler = async (event) => {
	const karyawan = await karyawanDariEvent(event);
	try {
		const r = await panggilMutasiErp(karyawan.id, 'status', {}, { timeoutMs: 6000 });
		return json({ tersedia: !!r?.skema_ada, alasan: r?.skema_ada ? null : 'Skema mutasi belum diterapkan.', projectIds: r?.aktor?.projectIds || [] });
	} catch (e: any) {
		return json({ tersedia: false, alasan: e?.body?.message || 'Server admin tidak terjangkau.', projectIds: [] });
	}
};
