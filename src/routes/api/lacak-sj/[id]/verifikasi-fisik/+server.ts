// src/routes/api/lacak-sj/[id]/verifikasi-fisik/+server.ts
// SJH-02 §4.3 + SJ-06/SJH-19 — Project Leader, staf backup proyek, atau Admin memverifikasi fisik barang SJ proyek
// dari lapangan (HP). Menulis kontrak SAMA dengan erp-epi: surat_jalan.pengaju_verification (source:'lapangan').
// Verifikasi ≠ approval: tidak mengubah qty_delivered / stok. Aktor dari sesi, bukan body.
// K1 PL+backup+admin · K2 tidak boleh setelah cetak · K3 alasan "rusak" → jenis 'rusak' · K4 tanpa kolom baru.

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { directusServerJson } from '$lib/server/directus';
import { normalizeVerifikasiFisik } from '$lib/server/sjVerifikasiFisik';
import {
	aktorBolehProyek, authenticateLacakActor, cekSelfVerify, evaluasiKelayakan, sudahDiverifikasi, tanggalMulaiVerifikasi
} from '$lib/server/sjVerifikasiAkses';
import { notifyLogistik, runEffect } from '$lib/server/gerbangSj/effects';

const MIN_NOTE = 5;

async function loadOwned(event: Parameters<RequestHandler>[0]) {
	const aktor = await authenticateLacakActor(event);
	const id = Number(event.params.id);
	if (!Number.isFinite(id)) throw error(400, 'id tidak valid.');
	const sj = (await directusServerJson<{ data: any }>(
		`/items/surat_jalan/${id}?fields=id,nomor_sj,project_id,packing_list_id,status,draft_status,print_count,reprint_status,date_created,track_stage,pengaju_verification,pracetak_gudang`
	).catch(() => null))?.data;
	if (!sj) throw error(404, 'Surat Jalan tidak ditemukan.');
	const projId = typeof sj.project_id === 'object' ? sj.project_id?.id : sj.project_id;
	if (projId == null || !aktorBolehProyek(aktor, Number(projId))) throw error(403, 'SJ ini tidak berkaitan dengan Anda.');
	// Query item dipisah dari header (Aturan #2)
	const items = (await directusServerJson<{ data: any[] }>(
		`/items/surat_jalan_items?filter[surat_jalan_id][_eq]=${id}&fields=id,nama_barang,qty_required,qty_delivered,unit&sort=id&limit=-1`
	))?.data || [];
	return { aktor, karyawan: aktor.karyawan, sj, id, projId: Number(projId), items };
}

export const GET: RequestHandler = async (event) => {
	const { sj, items } = await loadOwned(event);
	const k = evaluasiKelayakan(sj, await tanggalMulaiVerifikasi());
	return json({
		pengaju_verification: sj.pengaju_verification || null,
		items,
		boleh_ubah: k.boleh,
		alasan_tidak_boleh: k.alasan,
		draft: sj.draft_status === 'menunggu_approval',
		nomor_sj: sj.nomor_sj
	});
};

export const POST: RequestHandler = async (event) => {
	const { aktor, karyawan, sj, id, projId, items } = await loadOwned(event);
	const body = await event.request.json().catch(() => ({}));
	const clientEventId = String(body.client_event_id || '').trim() || `verif-${crypto.randomUUID()}`;
	const prev = sj.pengaju_verification as any;

	// Idempoten: tombol simpan ditekan dua kali (sinyal gudang lemah) → kembalikan hasil lama tanpa menulis lagi.
	if (prev?.client_event_id && prev.client_event_id === clientEventId) {
		return json({ ok: true, idempoten: true, mode: prev.mode, selisih: (prev.items || []).filter((i: any) => i.status !== 'sesuai').length, pengaju_verification: prev, barang_bermasalah_logged: 0 });
	}

	const kelayakan = evaluasiKelayakan(sj, await tanggalMulaiVerifikasi());
	if (!kelayakan.boleh) throw error(409, kelayakan.alasan || 'SJ ini tidak bisa diverifikasi.');

	const norm = normalizeVerifikasiFisik(items, body.items);
	if (!norm.ok) throw error(400, norm.error);
	const tanpaCatatan = norm.problems.find((p) => !p.note || p.note.length < MIN_NOTE);
	if (tanpaCatatan) throw error(400, `Isi alasan min. ${MIN_NOTE} huruf untuk "${tanpaCatatan.nama_barang || `item #${tanpaCatatan.sj_item_id}`}".`);

	// Self-approval lock + fallback (Aturan #4): penyiap barang tidak boleh memverifikasi sendiri bila ada orang lain berhak.
	const proj = (await directusServerJson<{ data: any }>(`/items/projects/${projId}?fields=id,leader_id,gr_backup_karyawan_ids`).catch((e) => {
		console.error('[lacak-sj/verifikasi-fisik] gagal baca proyek untuk cek self-verify:', e instanceof Error ? e.message : e);
		return null;
	}))?.data;
	const kandidat = [proj?.leader_id, ...(Array.isArray(proj?.gr_backup_karyawan_ids) ? proj.gr_backup_karyawan_ids : [])]
		.filter((x) => x != null && Number(x) !== Number(karyawan.id));
	const self = cekSelfVerify(karyawan.id, sj.pracetak_gudang, kandidat.length > 0);
	if (self.tolak) throw error(409, 'Verifikasi harus oleh orang lain selain yang menyiapkan barang.');

	const now = new Date().toISOString();
	const riwayat = [
		...(sudahDiverifikasi(sj) ? [{ verified_by_name: prev.verified_by_name ?? null, verified_at: prev.verified_at, mode: prev.mode ?? null }] : []),
		...(Array.isArray(prev?.riwayat) ? prev.riwayat : [])
	].slice(0, 5);
	const alasanById = new Map<string, string>((Array.isArray(body.items) ? body.items : []).map((r: any) => [String(r?.sj_item_id), String(r?.alasan ?? '')]));

	const pengaju_verification = {
		verified_by: String(karyawan.id),
		verified_by_name: karyawan.nama_karyawan,
		verified_by_email: (karyawan as any).email ?? null,
		verified_at: now,
		source: 'lapangan',
		mode: norm.mode,
		self_verified: self.selfVerified,
		overall_note: String(body.overall_note ?? '').trim() || null,
		client_event_id: clientEventId,
		items: norm.items,
		riwayat
	};
	await directusServerJson(`/items/surat_jalan/${id}`, { method: 'PATCH', body: JSON.stringify({ pengaju_verification }) });

	// Riwayat Tahap /lacak-sj/[id]: stage_to null = bukan perpindahan tahap. Gagal → log keras, tidak menggagalkan simpan.
	const sesuai = norm.items.length - norm.problems.length;
	const ringkas = `Verifikasi muat: ${sesuai}/${norm.items.length} sesuai${norm.problems.length ? `, ${norm.problems.length} bermasalah` : ''}`;
	const gagal: string[] = [];
	const g1 = await runEffect('scan_log', id, () => directusServerJson('/items/scan_log', {
		method: 'POST',
		body: JSON.stringify({
			ref_collection: 'surat_jalan', ref_id: String(id), actor_id: karyawan.id, actor_role: aktor.isAdmin ? 'admin' : 'admin_project',
			timestamp: now, stage_from: sj.track_stage ?? null, stage_to: null, notes: ringkas, source: 'lapangan', client_event_id: clientEventId
		})
	}));
	if (g1) gagal.push(g1);

	let logged = 0;
	if (sj.draft_status !== 'menunggu_approval') {
		for (const p of norm.problems) {
			try {
				const nama = p.nama_barang || `item #${p.sj_item_id}`;
				const exist = (await directusServerJson<{ data: any[] }>(
					`/items/barang_bermasalah_log?filter[surat_jalan_id][_eq]=${id}&filter[nama_barang][_eq]=${encodeURIComponent(nama)}` +
					`&filter[status][_in]=open,in_review&fields=id&limit=1`
				).catch(() => ({ data: [] })))?.data?.length;
				if (exist) continue;
				const jenis = alasanById.get(String(p.sj_item_id)) === 'rusak' ? 'rusak' : 'kurang'; // K3
				await directusServerJson('/items/barang_bermasalah_log', {
					method: 'POST',
					body: JSON.stringify({
						surat_jalan_id: id, project_id: projId, packing_list_id: typeof sj.packing_list_id === 'object' ? sj.packing_list_id?.id ?? null : sj.packing_list_id ?? null,
						nama_barang: nama, jenis, qty: p.qty_sj - p.qty_confirmed, severity: 'blocker', blocks_dispatch: true,
						deskripsi: `Verifikasi fisik ${sj.nomor_sj} (lapangan): ${p.status === 'tidak_dimuat' ? 'tidak dimuat' : `qty dimuat ${p.qty_confirmed} dari ${p.qty_sj}`}${p.note ? ` — ${p.note}` : ''}`,
						reported_by: karyawan.id
					})
				});
				logged += 1;
			} catch (e) {
				console.error('[lacak-sj/verifikasi-fisik] gagal catat barang_bermasalah_log:', e instanceof Error ? e.message : e);
			}
		}
	}
	if (norm.problems.length) {
		const g2 = await runEffect('notifikasi', id, () => notifyLogistik({
			title: `Selisih muat SJ ${sj.nomor_sj}`,
			message: `${ringkas} — oleh ${karyawan.nama_karyawan}.`,
			priority: 'high', actionRequired: true
		}));
		if (g2) gagal.push(g2);
	}

	const draft = sj.draft_status === 'menunggu_approval';
	const langkah = norm.problems.length === 0
		? '✓ Semua barang sesuai. Gudang bisa mencetak SJ.'
		: draft
			? `⚠ ${norm.problems.length} barang beda. Manager Project akan menyetujui dengan jumlah yang Anda catat.`
			: Number(sj.print_count) > 0
				? `⚠ ${norm.problems.length} barang beda. SJ sudah tercetak: gudang diberi tahu dan harus mencetak ulang SJ yang benar sebelum truk keluar — satpam tidak akan meloloskan sampai selisih diselesaikan di menu Barang Bermasalah.`
				: `⚠ ${norm.problems.length} barang beda. Gudang sudah diberi tahu; SJ tertahan sampai selisih diselesaikan di menu Barang Bermasalah.`;
	return json({
		ok: true, idempoten: false, mode: norm.mode, selisih: norm.problems.length, langkah_berikut: langkah,
		pengaju_verification, barang_bermasalah_logged: logged, effects_gagal: gagal
	});
};
