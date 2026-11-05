// src/routes/api/panduan/buku-saku-pdf/+server.ts
// GET ?alur=<id alur> → Buku Saku & Checklist Lapangan (PDF, Gotenberg). Wajib login (authenticateEss). Hanya baca.
// Sumber = alur TERBIT yang sama dengan halaman /panduan/alur (loadPublishedFlowsForField, cache server 5 mnt) → tidak ada query tambahan
// ke Directus bila cache hangat. Detail gate (mode/hint) best-effort: gagal → PDF tetap dibuat, bagian gate memberi catatan jujur.
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { htmlToPdf } from '$lib/server/gotenbergClient';
import { loadPublishedFlowsForField } from '$lib/server/processGuidanceFlows';
import { buildBukuSakuHtml } from '$lib/pdf-templates/bukuSakuAlurPdf';
import { loadGateInfoForFlow, type FieldGateInfoResult } from '../../process-guidance/flows/gateInfo';

const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
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
		return new Response(Uint8Array.from(buffer), {
			headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="Buku Saku - ${safe}.pdf"`, 'Cache-Control': 'private, no-store' }
		});
	} catch (e: any) {
		console.error('[panduan/buku-saku-pdf] gagal render:', e?.message);
		throw error(502, 'Layanan PDF sedang tidak tersedia. Coba lagi nanti.');
	}
};
