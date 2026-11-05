// src/routes/api/ess/sop/[id]/usulan/+server.ts
// Usulan perbaikan SOP dari lapangan → proposed_sop (source 'lapangan'), ditinjau tim HRD di ERP (HRD › Usulan).
// Menutup lingkar perbaikan: SOP yang dibaca di lapangan bisa dikoreksi oleh orang yang menjalankannya.
// Identitas pengusul diambil dari sesi server (authenticateEss), bukan dari kiriman klien.
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { getSopById, isReadableSop } from '$lib/server/ess/sop';
import { directusServerJson } from '$lib/server/directus';
import { validateUsulan, buildProposalRecord, checkLimits, type RecentProposalRow } from '$lib/utils/sopUsulan';

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const sopId = Number(event.params.id);
	if (!Number.isInteger(sopId) || sopId <= 0) throw error(400, 'ID SOP tidak valid.');
	const sop = await getSopById(sopId);
	if (!sop || !isReadableSop(sop)) throw error(404, 'SOP tidak ditemukan.');

	let body: any;
	try {
		body = await event.request.json();
	} catch {
		throw error(400, 'Payload JSON tidak valid');
	}
	const v = validateUsulan(body);
	if (!v.ok) throw error(400, v.errors.jenis || v.errors.catatan || 'Isian tidak valid.');

	// Batas kiriman dihitung dari usulan lapangan 30 hari terakhir (satu fetch). Gagal baca → TOLAK (502),
	// bukan lolos tanpa batas.
	const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
	let recent: RecentProposalRow[];
	try {
		const res = await directusServerJson<{ data: RecentProposalRow[] }>(
			`/items/proposed_sop?filter[source][_eq]=lapangan&filter[date_created][_gte]=${encodeURIComponent(since)}&fields=id,status,date_created,data_snapshot&sort=-date_created&limit=300`
		);
		recent = Array.isArray(res?.data) ? res.data : [];
	} catch (e: any) {
		console.error('[sop/usulan] gagal membaca usulan terakhir:', e?.message || e);
		throw error(502, 'Gagal memeriksa batas usulan. Coba lagi.');
	}
	const limit = checkLimits(recent, karyawan.id, sop.id, Date.now());
	if (!limit.ok) throw error(429, limit.reason || 'Batas usulan tercapai.');

	const record = buildProposalRecord({ sop, karyawan, jenis: v.jenis, catatan: v.catatan });
	let created: { data?: { id?: number } } | undefined;
	try {
		created = await directusServerJson<{ data: { id: number } }>('/items/proposed_sop', {
			method: 'POST',
			body: JSON.stringify(record)
		});
	} catch (e: any) {
		console.error('[sop/usulan] gagal menyimpan usulan:', e?.message || e);
		throw error(502, 'Gagal menyimpan usulan. Coba lagi.');
	}
	return json({ success: true, id: created?.data?.id ?? null });
};
