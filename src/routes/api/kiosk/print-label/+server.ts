// src/routes/api/kiosk/print-label/+server.ts
// Fase 4A "Pertajam Modul Kiosk Produksi v2" (12 Sep 2026) — proxy server-side ke
// erp-epi-1 /api/print/product-label. Reuse CSS/markup label yang sudah ada (Aturan:
// maksimalkan penggunaan yang sudah ada), TIDAK menduplikasi ±500 baris generator HTML.
//
// Kenapa proxy, bukan panggil labelPrintApi.ts langsung dari browser kiosk: fungsi itu
// butuh Firebase ID token (getIdToken()), sementara kiosk memakai sesi PIN sendiri
// (kioskAuth) -- tidak ada token Firebase sama sekali. Proxy ini memanggil erp-epi-1
// dengan AUTOMATION_SERVER_SECRET dari server (env, tidak pernah sampai ke browser kiosk).
//
// Fase 4 correction_plan_cetak-label-produk.md (24 Sep 2026) -- secret dikirim lewat
// header X-Automation-Secret, BUKAN query `?s=` (query string tercatat di access log
// server & proxy/CDN, header tidak) -- pola sama qc-kiosk/konsumsi-kiosk di erp-epi.

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { requireKioskSession } from '$lib/server/kioskAuth';

export const GET: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	const spkId = event.url.searchParams.get('spkId');
	if (!spkId) throw error(400, 'Query param spkId wajib diisi.');
	// File 12 §C item 3 — validasi qty integer 1-100 di server (klien sekarang mengirim pilihan
	// operator, bukan hardcode 10 lagi).
	const qtyNum = Math.trunc(Number(event.url.searchParams.get('qty') ?? '10'));
	if (!Number.isFinite(qtyNum) || qtyNum < 1 || qtyNum > 100) {
		throw error(400, 'Jumlah label harus angka 1-100.');
	}
	const qty = String(qtyNum);

	const baseUrl = env.ERP_EPI1_BASE_URL;
	const secret = env.AUTOMATION_SERVER_SECRET || env.PRODUCTION_AUTOMATION_SECRET;
	if (!baseUrl || !secret) {
		throw error(503, 'ERP_EPI1_BASE_URL/AUTOMATION_SERVER_SECRET belum dikonfigurasi di server.');
	}

	try {
		const params = new URLSearchParams({
			spkId,
			qty,
			printedBy: session.nama
		});
		const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/print/product-label?${params.toString()}`, {
			headers: { 'x-automation-secret': secret }
		});
		const data = await res.json().catch(() => null);
		if (!res.ok) throw new Error(data?.message || 'Gagal membangun label produk.');
		return json({ html: data.html, batchNo: data.batchNo, spkNomor: data.spkNomor, spkStatus: data.spkStatus });
	} catch (e: any) {
		throw error(502, e?.message || 'Gagal terhubung ke server label erp-epi-1.');
	}
};
