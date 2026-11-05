// src/routes/api/ess/kinerja-rapor-pdf/+server.ts
// GET [?scorecard=<id>] → Rapor Kinerja PRIBADI (PDF, Gotenberg). Wajib login (authenticateEss); data HANYA milik karyawan yang login.
// Sumber = listKpiKaryawan (scorecard Finalized, redaksi AI-sebelum-rilis sudah diterapkan di sana) — rapor tidak menerima angka dari klien.
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { listKpiKaryawan } from '$lib/server/ess/kpi';
import { htmlToPdf } from '$lib/server/gotenbergClient';
import { buildRaporKinerjaHtml, pilihScorecard } from '$lib/pdf-templates/raporKinerjaPdf';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	const id = event.url.searchParams.get('scorecard');
	if (id && !ID_RE.test(id)) throw error(400, 'Parameter scorecard tidak valid.');

	let list;
	try {
		list = await listKpiKaryawan(karyawan.id);
	} catch (e: any) {
		console.error('[ess/kinerja-rapor-pdf] KPI gagal dimuat:', e?.message);
		throw error(502, 'Data kinerja gagal dimuat dari server. Coba lagi nanti.');
	}
	const rec = pilihScorecard(list, id);
	if (!rec) {
		throw error(404, id ? 'Scorecard tidak ditemukan atau bukan milik Anda.' : 'Belum ada scorecard final untuk dicetak.');
	}

	const html = buildRaporKinerjaHtml({
		karyawan: { nama: karyawan.nama_karyawan, posisi: karyawan.posisi, divisi: karyawan.divisi },
		rec,
		riwayat: list.filter((k) => k.id !== rec.id).slice(0, 6).map((k) => ({ periode: k.periode, tahun: k.tahun, total_skor: k.total_skor }))
	});
	try {
		const buffer = await htmlToPdf(html, { filename: 'rapor-kinerja.html' });
		const safe = `Rapor Kinerja ${rec.periode}${rec.tahun ? ` ${rec.tahun}` : ''}`.replace(/[\/:*?"<>|]+/g, '-');
		return new Response(Uint8Array.from(buffer), {
			headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${safe}.pdf"`, 'Cache-Control': 'private, no-store' }
		});
	} catch (e: any) {
		console.error('[ess/kinerja-rapor-pdf] gagal render:', e?.message);
		throw error(502, 'Layanan PDF sedang tidak tersedia. Coba lagi nanti.');
	}
};
