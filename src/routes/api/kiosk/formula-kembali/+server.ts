// src/routes/api/kiosk/formula-kembali/+server.ts
// FSM-02 Fase 3 — Kiosk Produksi: daftar SPK menunggu formula, lookup hasil scan QR SPK, dan "Tandai Formula Kembali".
// Guard: sesi kiosk (badge+PIN) — pencatat selalu teridentifikasi. Menu ini bawaan semua akun kiosk (seperti Input Produksi)
// karena hanya mencatat (idempoten, tak mengubah status SPK). Logika di $lib/server/formulaReturnKiosk.ts.
import { json, error, type RequestHandler } from '@sveltejs/kit';
import { requireKioskSession } from '$lib/server/kioskAuth';
import { getSpkFormulaState, isTrackingEnabled, listPendingFormula, markFormulaReturnedKiosk, parseSpkScan } from '$lib/server/formulaReturnKiosk';

export const GET: RequestHandler = async (event) => {
	requireKioskSession(event);
	try {
		const enabled = await isTrackingEnabled();
		const scan = event.url.searchParams.get('spk');
		if (scan !== null) {
			const spkId = parseSpkScan(scan);
			if (!spkId) throw error(400, 'Kode bukan QR SPK. Pindai QR di lembar kerja (label "Scan di Kiosk Produksi").');
			const spk = await getSpkFormulaState(spkId);
			if (!spk) throw error(404, `SPK #${spkId} tidak ditemukan.`);
			return json({ enabled, spk });
		}
		const { items, total } = await listPendingFormula(50);
		return json({ enabled, items, total });
	} catch (e: any) {
		if (e?.status) throw e; // error() SvelteKit — teruskan apa adanya
		console.error('[api/kiosk/formula-kembali GET] gagal:', e);
		throw error(502, 'Gagal memuat data formula SPK. Coba lagi atau hubungi PPIC.');
	}
};

export const POST: RequestHandler = async (event) => {
	const session = requireKioskSession(event);
	const body = await event.request.json().catch(() => null);
	const spkId = parseSpkScan(String(body?.spk ?? body?.spkId ?? ''));
	if (!spkId) throw error(400, 'SPK tidak valid.');
	const via = body?.via === 'scan' ? 'scan' : 'manual';
	const actor = `${session.nama} (kiosk #${session.karyawanId})`;

	let out;
	try {
		out = await markFormulaReturnedKiosk(spkId, actor, via);
	} catch (e) {
		console.error(`[api/kiosk/formula-kembali POST] SPK ${spkId} gagal:`, e);
		throw error(502, 'Gagal menyimpan. Periksa koneksi lalu coba lagi — formula belum tercatat.');
	}

	if (!out.ok) {
		if (out.reason === 'disabled') throw error(409, 'Pelacakan formula kembali sedang dinonaktifkan admin.');
		if (out.reason === 'not_found') throw error(404, `SPK #${spkId} tidak ditemukan.`);
		throw error(409, `SPK ini berstatus "${out.status}" — formula hanya dicatat untuk SPK yang belum mulai produksi.`);
	}
	return json({ success: true, ...out });
};
