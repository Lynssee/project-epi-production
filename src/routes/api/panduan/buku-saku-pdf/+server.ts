// src/routes/api/panduan/buku-saku-pdf/+server.ts
// GET ?alur=<id alur> → Buku Saku & Checklist Lapangan (PDF, Gotenberg). Wajib login (authenticateEss). Hanya baca.
// Sumber = alur TERBIT yang sama dengan halaman /panduan/alur (loadPublishedFlowsForField, cache server 5 mnt) → tidak ada query tambahan
// ke Directus bila cache hangat. Detail gate (mode/hint) best-effort: gagal → PDF tetap dibuat, bagian gate memberi catatan jujur.
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { htmlToPdf } from '$lib/server/gotenbergClient';
import { loadPublishedFlowsForField } from '$lib/server/processGuidanceFlows';
import { buildBukuSakuHtml, buildBukuSakuJabatanHtml } from '$lib/pdf-templates/bukuSakuAlurPdf';
import { loadPicIndex, resolveMyPosisi } from '$lib/server/processPicContext';
import { forwardReportEvent } from '$lib/server/reportEventForward';
import { extractMyTasks } from '$lib/utils/processMyTasks';
import { loadGateInfoForFlow, type FieldGateInfoResult } from '../../process-guidance/flows/gateInfo';

const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * GET ?jabatan=1 → Buku Saku JABATAN: semua langkah milik jabatan karyawan yang login (kecocokan PIC pasti, sama dengan "Tugas Saya"),
 * dikelompokkan per alur terbit. Memakai cache alur & indeks jabatan 5 menit yang sama → tanpa query tambahan ke Directus.
 */
async function bukuSakuJabatan(event: import('@sveltejs/kit').RequestEvent, karyawan: { jabatan_id?: number | null; posisi?: string | null; nama_karyawan?: string }): Promise<Response> {
	let flows, index;
	try {
		[flows, index] = await Promise.all([loadPublishedFlowsForField(), loadPicIndex()]);
	} catch (e: any) {
		console.error('[panduan/buku-saku-pdf] jabatan: data gagal dimuat:', e?.message);
		throw error(502, 'Data alur gagal dimuat dari server. Coba lagi nanti.');
	}
	const posisi = resolveMyPosisi(karyawan, index);
	if (!posisi) throw error(404, 'Jabatan Anda belum terhubung ke master jabatan. Minta HRD mengisi jabatan di data karyawan Anda.');
	const tasks = extractMyTasks(flows, index, posisi.id);
	const byFlow = new Map<string, string[]>();
	for (const t of tasks) byFlow.set(t.flow_id, [...(byFlow.get(t.flow_id) ?? []), t.node_id]);
	const groups = flows.filter((f) => byFlow.has(f.id)).map((flow) => ({ flow, nodeIds: byFlow.get(flow.id)! }));
	if (!groups.length) throw error(404, 'Belum ada langkah di Peta Alur yang terpetakan pasti ke jabatan Anda.');

	const html = buildBukuSakuJabatanHtml({ posisiNama: posisi.nama, groups, dicetakOleh: karyawan.nama_karyawan || '' });
	try {
		const buffer = await htmlToPdf(html, { landscape: true, filename: 'buku-saku-jabatan.html' });
		const safe = posisi.nama.replace(/[\/:*?"<>|]+/g, '-').slice(0, 80);
		forwardReportEvent(event, { catalog_key: 'panduan-buku-saku-pdf', format: 'pdf' }); // Report Center: catat unduhan
		return new Response(Uint8Array.from(buffer), {
			headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="Buku Saku Jabatan - ${safe}.pdf"`, 'Cache-Control': 'private, no-store' }
		});
	} catch (e: any) {
		console.error('[panduan/buku-saku-pdf] jabatan: gagal render:', e?.message);
		throw error(502, 'Layanan PDF sedang tidak tersedia. Coba lagi nanti.');
	}
}

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	if (event.url.searchParams.get('jabatan') === '1') return bukuSakuJabatan(event, karyawan);
	const alur = event.url.searchParams.get('alur') || '';
	if (!ID_RE.test(alur)) throw error(400, 'Parameter alur tidak valid.');

	let flows;
	try {
		flows = await loadPublishedFlowsForField();
	} catch (e: any) {
		console.error('[panduan/buku-saku-pdf] alur gagal dimuat:', e?.message);
		throw error(502, 'Alur gagal dimuat dari server. Coba lagi nanti.');
	}
	const flow = flows.find((f) => f.id === alur);
	if (!flow) throw error(404, 'Alur tidak ditemukan atau belum terbit.');

	let gateInfo: FieldGateInfoResult | null = null;
	try {
		gateInfo = await loadGateInfoForFlow(flow, event.request?.headers?.get('authorization') || '');
	} catch (e: any) {
		console.warn('[panduan/buku-saku-pdf] detail gate tidak terbaca:', e?.message);
	}

	const html = buildBukuSakuHtml({ flow, dicetakOleh: karyawan.nama_karyawan || '', gateInfo });
	try {
		const buffer = await htmlToPdf(html, { landscape: true, filename: 'buku-saku.html' });
		const safe = flow.title.replace(/[\/:*?"<>|]+/g, '-').slice(0, 80);
		forwardReportEvent(event, { catalog_key: 'panduan-buku-saku-pdf', format: 'pdf' }); // Report Center: catat unduhan
		return new Response(Uint8Array.from(buffer), {
			headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="Buku Saku - ${safe}.pdf"`, 'Cache-Control': 'private, no-store' }
		});
	} catch (e: any) {
		console.error('[panduan/buku-saku-pdf] gagal render:', e?.message);
		throw error(502, 'Layanan PDF sedang tidak tersedia. Coba lagi nanti.');
	}
};
