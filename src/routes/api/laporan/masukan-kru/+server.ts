// src/routes/api/laporan/masukan-kru/+server.ts
// Sisi PENULIS LAPORAN untuk masukan kru dari kiosk (Rencana Kiosk Proyek, Fase 4 & 5):
//   GET  ?project_id=N&tanggal=YYYY-MM-DD → { catatan: Catatan Kerja baru, pemakaian: Draf Pemakaian baru }
//   POST {project_id, jenis?:'catatan'|'pemakaian', action:'pakai', ids, report_id}  → tandai sudah dipakai di laporan
//   POST {project_id, jenis?, action:'abaikan', ids}                                  → buang dari daftar
// Mengimpor ke form laporan dilakukan di KLIEN; server hanya menandai status setelah laporan benar-benar tersimpan.
// Draf pemakaian TIDAK pernah memotong stok di sini — stok berubah hanya lewat penyimpanan Laporan Harian.
// Dua sumber berdiri sendiri: bila salah satu koleksi belum dipasang, yang lain tetap tampil (503 hanya bila keduanya belum).

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticatePenulisLaporan } from '$lib/server/laporanPenulisGuard';
import { daftarCatatanBaru, tandaiCatatan } from '$lib/server/kioskCatatan';
import { daftarDrafBaru, tandaiDraf } from '$lib/server/kioskPemakaian';
import { todayWIB } from '$lib/server/kioskProyekToken';

function parseProjectId(v: unknown): number {
	const n = Number(v);
	if (!Number.isInteger(n) || n <= 0) throw error(400, 'project_id tidak valid.');
	return n;
}
const TANGGAL_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Jalankan satu sumber; 503 ("belum disiapkan") dianggap kosong, error lain dilempar ulang. */
async function aman<T>(fn: () => Promise<T[]>): Promise<{ data: T[]; siap: boolean }> {
	try {
		return { data: await fn(), siap: true };
	} catch (e) {
		if ((e as { status?: number })?.status === 503) return { data: [], siap: false };
		throw e;
	}
}

export const GET: RequestHandler = async (event) => {
	const projectId = parseProjectId(event.url.searchParams.get('project_id'));
	await authenticatePenulisLaporan(event, projectId);
	const tgl = event.url.searchParams.get('tanggal') || todayWIB();
	if (!TANGGAL_RE.test(tgl)) throw error(400, 'Tanggal tidak valid.');

	const [catatan, pemakaian] = await Promise.all([aman(() => daftarCatatanBaru(projectId, tgl)), aman(() => daftarDrafBaru(projectId, tgl))]);
	if (!catatan.siap && !pemakaian.siap) throw error(503, 'Fitur masukan kru belum disiapkan di server.');
	return json({ tanggal: tgl, catatan: catatan.data, pemakaian: pemakaian.data }, { headers: { 'Cache-Control': 'no-store' } });
};

export const POST: RequestHandler = async (event) => {
	let body: any;
	try {
		body = await event.request.json();
	} catch {
		throw error(400, 'Body harus JSON.');
	}
	const projectId = parseProjectId(body?.project_id);
	const penulis = await authenticatePenulisLaporan(event, projectId);

	const jenis = body?.jenis === undefined ? 'catatan' : body.jenis;
	if (jenis !== 'catatan' && jenis !== 'pemakaian') throw error(400, 'jenis harus "catatan" atau "pemakaian".');
	const tandai = jenis === 'pemakaian' ? tandaiDraf : tandaiCatatan;

	const ids = [...new Set((Array.isArray(body?.ids) ? body.ids : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0))] as number[];
	if (!ids.length) throw error(400, 'Pilih minimal satu item.');
	if (ids.length > 100) throw error(400, 'Maksimal 100 item sekali proses.');

	if (body?.action === 'pakai') {
		const reportId = Number(body?.report_id);
		if (!Number.isInteger(reportId) || reportId <= 0) throw error(400, 'report_id tidak valid.');
		const n = await tandai({ projectId, ids, status: 'dipakai', reportId, oleh: penulis.email });
		return json({ ok: true, diubah: n });
	}
	if (body?.action === 'abaikan') {
		const n = await tandai({ projectId, ids, status: 'diabaikan', oleh: penulis.email });
		return json({ ok: true, diubah: n });
	}
	throw error(400, 'action harus "pakai" atau "abaikan".');
};
