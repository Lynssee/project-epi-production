// src/routes/api/kiosk/qc/+server.ts
// Fase 1-2, rencana Kiosk QC Produksi (8 Sep 2026). Proxy TIPIS (§3.2) — bisnis logic QC
// (resolusi spec, verdict, simpan qc_results) 100% di erp-epi-1 lewat
// POST /api/automation/qc-kiosk. Endpoint ini hanya: verifikasi sesi + akses menu, ambil
// daftar SPK qc_pending langsung dari Directus (pola sama /api/kiosk/home), upload foto
// (Directus token project-epi sendiri, sama pola driver/fuel-log), lalu teruskan ke erp-epi-1.
//
// §3.3: kiosk_menu_access di-re-verify DI SINI JUGA (GET maupun POST) -- bukan cuma sekali di
// /kiosk/home. Sesi kiosk sengaja tidak membawa info menu (§1), jadi endpoint yang mengubah
// data wajib cek ulang dari Directus tiap kali, bukan percaya klien.

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { directusServerJson, directusServerUpload } from '$lib/server/directus';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { requireKioskMenu } from '$lib/server/kioskMenuAccess';

// Fase 2 §3.5.5 -- hash SHA-256 isi foto (pola sama siteCheckin.ts::hashFile) dikirim bersama
// entry ke erp-epi-1 supaya deteksi anomali "foto dipakai ulang" (detect_anomalies) bisa jalan
// tanpa erp-epi-1 perlu mengunduh ulang file dari Directus untuk hashing.
async function hashFile(file: File): Promise<string> {
	const buf = await file.arrayBuffer();
	const digest = await crypto.subtle.digest('SHA-256', buf);
	return Array.from(new Uint8Array(digest))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

function erpEpiBase() {
	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.PRODUCTION_AUTOMATION_SECRET;
	if (!baseUrl || !secret) {
		throw error(503, 'ERP_EPI1_BASE_URL/PRODUCTION_AUTOMATION_SECRET belum dikonfigurasi di server.');
	}
	return { baseUrl: baseUrl.replace(/\/$/, ''), secret };
}

// Audit (audit-kiosk-master-lengkap.md Bagian 2 #5, Sedang): rate limit di erp-epi-1 dulu
// hanya dikunci per-IP, dan IP yang sampai di sana SELALU IP server project-epi (jembatan
// server-ke-server) -- kuota 60/menit dibagi rata SELURUH PABRIK, bukan per kiosk. Header ini
// meneruskan identitas operator kiosk supaya erp-epi-1 bisa mengunci per-terminal/operator.
async function callQcKiosk(action: string, payload: Record<string, unknown>, actorId?: number) {
	const { baseUrl, secret } = erpEpiBase();
	const res = await fetch(`${baseUrl}/api/automation/qc-kiosk`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'X-Automation-Secret': secret,
			...(actorId ? { 'X-Kiosk-Actor': String(actorId) } : {})
		},
		body: JSON.stringify({ action, ...payload })
	});
	const raw = await res.text();
	let data: any = null;
	try {
		data = raw ? JSON.parse(raw) : null;
	} catch {
		// Audit 22 Sep 2026 #2 — upstream erp-epi-1 bisa membalas body non-JSON (halaman
		// error gateway/HTML). Ditelan tanpa log sebelumnya bikin operator lihat pesan
		// generik sementara status code + body asli hilang total dari log server.
		console.error(`[kiosk/qc] callQcKiosk(${action}): respons non-JSON, status ${res.status}`, raw.slice(0, 500));
	}
	if (!res.ok) {
		console.error(`[kiosk/qc] callQcKiosk(${action}): upstream error, status ${res.status}`, data ?? raw.slice(0, 500));
		throw error(res.status, data?.message || 'Gagal menghubungi layanan QC.');
	}
	return data;
}

export const GET: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, 'qc', 'Input Hasil QC');

	const spkId = event.url.searchParams.get('spkId');
	// B7(fix, 24 Sep 2026): dulu limit=50 hardcode — live sudah 34, akan diam-diam
	// memotong daftar begitu tembus 50. Naikkan default + bisa dioverride via query,
	// dibatasi 500 supaya tetap wajar.
	const limitParam = Number(event.url.searchParams.get('limit')) || 200;
	const limit = Math.min(Math.max(limitParam, 1), 500);

	// B7(fix): Rule #2 — fetch relasi dipisah. Dulu `product_id.nama_barang_lengkap`
	// (relasi bersarang) rawan gagal di-resolve Directus (403). Ambil SPK dulu, baru
	// nama produknya lewat query terpisah (batch filter[id][_in]).
	const spkListRes = await directusServerJson<{ data: any[] }>(
		`/items/spk?filter[status][_eq]=qc_pending&fields=id,nomor,batch_no,quantity,unit,product_id,customer_id,customer_nama&sort=-tanggal&limit=${limit}`
	).catch((e) => {
		// Audit 22 Sep 2026 #2 — error Directus (403 schema drift, koneksi putus) ditelan jadi
		// list kosong tanpa log sebelumnya, operator lihat "Belum ada SPK menunggu QC" padahal
		// server yang bermasalah.
		console.error('[kiosk/qc] GET: gagal fetch daftar SPK qc_pending', e);
		return { data: [] };
	});
	let spkList = spkListRes?.data || [];

	const productIds = [...new Set(spkList.map((s) => (typeof s.product_id === 'object' ? s.product_id?.id : s.product_id)).filter(Boolean))];
	if (productIds.length > 0) {
		const productsRes = await directusServerJson<{ data: any[] }>(
			`/items/identitas_barang?filter[id][_in]=${productIds.join(',')}&fields=id,nama_barang_lengkap,kode_fg_id&limit=-1`
		).catch((e) => {
			console.error('[kiosk/qc] GET: gagal fetch nama produk untuk daftar SPK', e);
			return { data: [] };
		});
		const productById = new Map((productsRes?.data || []).map((p) => [p.id, p]));
		spkList = spkList.map((s) => {
			const pId = typeof s.product_id === 'object' ? s.product_id?.id : s.product_id;
			return {
				...s,
				product_id: productById.get(pId) || { id: pId, nama_barang_lengkap: null, kode_fg_id: null }
			};
		});
	}

	const customerIds = [...new Set(spkList.map((s) => (typeof s.customer_id === 'object' ? s.customer_id?.id : s.customer_id)).filter(Boolean))];
	if (customerIds.length > 0) {
		const custRes = await directusServerJson<{ data: any[] }>(
			`/items/master_customer?filter[id][_in]=${customerIds.join(',')}&fields=id,nama_sj_fp,customer_name&limit=-1`
		).catch((e) => {
			console.error('[kiosk/qc] GET: gagal fetch data master_customer', e);
			return { data: [] };
		});
		const cMap = new Map((custRes?.data || []).map((c) => [c.id, c]));
		spkList = spkList.map((s) => {
			const cId = typeof s.customer_id === 'object' ? s.customer_id?.id : s.customer_id;
			const cObj = cId ? cMap.get(cId) : null;
			return {
				...s,
				customer_obj: cObj || null,
				customer_nama: s.customer_nama || cObj?.nama_sj_fp || cObj?.customer_name || ''
			};
		});
	}

	// File 08 §2.4 — SPK yang sudah diuji (ada baris qc_results) tetap muncul di daftar
	// qc_pending (keputusan release/rework ada di tangan QA admin, itu benar), tapi TANPA
	// tanda apa pun operator lain bisa menguji ulang tanpa sadar dan qc_results jadi dobel.
	// Satu query agregat (bukan N+1) untuk seluruh SPK di halaman ini.
	const spkIdsForAgg = spkList.map((s) => s.id);
	if (spkIdsForAgg.length) {
		const aggRes = await directusServerJson<{ data: any[] }>(
			`/items/qc_results?filter[spk_id][_in]=${spkIdsForAgg.join(',')}` +
				`&aggregate[count]=id&aggregate[max]=tested_at&groupBy[]=spk_id&groupBy[]=verdict`
		).catch((e) => {
			console.error('[kiosk/qc] GET: gagal fetch agregat qc_results', e);
			return { data: [] };
		});
		const ringkas = new Map<number, { total: number; gagal: number; terakhir: string | null }>();
		for (const r of aggRes?.data || []) {
			const cur = ringkas.get(r.spk_id) || { total: 0, gagal: 0, terakhir: null };
			cur.total += Number(r.count?.id) || 0;
			if (r.verdict === 'gagal') cur.gagal += Number(r.count?.id) || 0;
			const t = r.max?.tested_at;
			if (t && (!cur.terakhir || t > cur.terakhir)) cur.terakhir = t;
			ringkas.set(r.spk_id, cur);
		}
		spkList = spkList.map((s) => ({ ...s, qcRingkas: ringkas.get(s.id) || null }));
	}

	const karyawan = { id: session.karyawanId, nama: session.nama };

	if (!spkId) return json({ spkList, karyawan });

	const selected = spkList.find((s) => String(s.id) === String(spkId));
	if (!selected) throw error(404, 'SPK tidak ditemukan di daftar qc_pending.');

	const productId = selected.product_id?.id ?? selected.product_id;
	// Audit 22 Sep 2026 #3 — validasi productId DI SINI sebelum memanggil erp-epi-1 (hemat
	// API usage juga). Kalau kosong, erp-epi-1 menolak dengan 400 generik yang jatuh ke jalur
	// penelanan error di atas, operator tidak pernah tahu masalahnya ada di data SPK.
	if (!productId) {
		throw error(
			422,
			`SPK ${selected.nomor} belum terhubung ke produk (product_id kosong) — tidak bisa ambil spec QC. Hubungi Supervisor/Admin untuk perbaiki data SPK ini.`
		);
	}
	const customerId = typeof selected.customer_id === 'object' ? selected.customer_id?.id : selected.customer_id ?? null;
	const customerName = selected.customer_obj?.nama_sj_fp || selected.customer_obj?.customer_name || selected.customer_nama || '';
	const kodeFgId = selected.product_id?.kode_fg_id?.id ?? selected.product_id?.kode_fg_id ?? null;

	const qcRes = await callQcKiosk('get_spec', { productId, customerId, customerName, kodeFgId }, session.karyawanId);

	return json({
		spkList,
		karyawan,
		selectedSpk: selected,
		specs: qcRes?.specs || [],
		internal: qcRes?.internal || qcRes?.specs || [],
		customer: qcRes?.customer || [],
		instruksi_produksi: qcRes?.instruksi_produksi || ''
	});
};

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	await requireKioskMenu(session.karyawanId, 'qc', 'Input Hasil QC');

	const form = await event.request.formData().catch(() => null);
	if (!form) throw error(400, 'Form data tidak valid.');

	const spkId = form.get('spkId');
	const productId = form.get('productId');
	const clientTxnId = form.get('clientTxnId');
	let entries: any[] = [];
	try {
		entries = JSON.parse(String(form.get('entries') || '[]'));
	} catch {
		throw error(400, 'entries tidak valid.');
	}
	let kondisiUji: Record<string, unknown> = {};
	try {
		kondisiUji = JSON.parse(String(form.get('kondisiUji') || '{}'));
	} catch {
		/* opsional, abaikan kalau kosong/rusak */
	}

	if (!spkId) throw error(400, 'spkId wajib diisi.');
	if (!clientTxnId) throw error(400, 'clientTxnId wajib diisi.');
	if (!Array.isArray(entries) || entries.length === 0) throw error(400, 'Belum ada parameter yang diisi.');

	// File 08 §2.2 — cek idempotensi SEBELUM upload foto. Sebelumnya semua foto diunggah dulu,
	// baru erp-epi-1 mengecek client_txn_id — tiap retry/tekan-2x menghasilkan N file yatim baru
	// di directus_files. qc_results.client_txn_id disimpan sebagai "<clientTxnId>:<index>" per
	// baris (satu submit QC = banyak baris qc_results, satu per parameter).
	const existing = await directusServerJson<{ data: any[] }>(
		`/items/qc_results?filter[client_txn_id][_starts_with]=${encodeURIComponent(`${clientTxnId}:`)}&fields=id,verdict&limit=-1`
	).catch((e) => {
		console.error('[kiosk/qc] cek duplikat gagal', e);
		throw error(503, 'Server sibuk, coba lagi.');
	});
	if (existing?.data?.length) return json({ results: existing.data, deduped: true });

	// Foto bukti alat ukur WAJIB per parameter yang TERISI (§2.3 — parameter opsional yang
	// dikosongkan tidak lagi dikirim sama sekali oleh klien, jadi validasi ini tetap ketat untuk
	// entri yang memang ada). Upload ke Directus (token project-epi sendiri, pola sama
	// driver/fuel-log) SEBELUM diteruskan ke erp-epi-1 -- erp-epi-1 hanya menerima ID file jadi.
	// §2.2 — upload PARALEL (maks 3 sekaligus), bukan berurutan satu-satu.
	async function uploadOne(i: number): Promise<void> {
		const foto = form!.get(`foto_${i}`);
		if (!(foto instanceof File) || foto.size === 0) {
			throw error(400, `Parameter "${entries[i]?.parameter || i + 1}" belum ada foto bukti alat ukur.`);
		}
		const fotoHash = await hashFile(foto).catch(() => null);
		const uploadForm = new FormData();
		uploadForm.append('file', foto, `qc-${spkId}-${clientTxnId}-${i}.jpg`);
		const uploadRes = await directusServerUpload(uploadForm);
		if (!uploadRes.ok) throw error(502, `Gagal mengunggah foto parameter "${entries[i]?.parameter || i + 1}".`);
		const uploaded = await uploadRes.json();
		const fotoId = uploaded?.data?.id;
		if (!fotoId) throw error(502, `Gagal mengunggah foto parameter "${entries[i]?.parameter || i + 1}".`);
		entries[i] = { ...entries[i], lampiran_foto: fotoId, foto_hash: fotoHash };
	}
	{
		let next = 0;
		async function worker() {
			while (next < entries.length) {
				const i = next++;
				await uploadOne(i);
			}
		}
		await Promise.all([worker(), worker(), worker()]);
	}

	const result = await callQcKiosk('submit_results', {
		spkId: Number(spkId),
		productId: productId ? Number(productId) : null,
		entries,
		kondisiUji,
		karyawanId: session.karyawanId,
		nama: session.nama,
		clientTxnId: String(clientTxnId)
	}, session.karyawanId);

	return json(result);
};
