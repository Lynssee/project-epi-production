// src/routes/api/rental-order/gate-retur/+server.ts
// F3/Q10 (rencana v2.0 Bab 6.3): gerbang untuk Peminjaman External, KEDUA arah. Menerima
// EPI:PJM:<id>:<token> ATAU EPI:SJ:<id>:<token> (SJ tipe peminjaman, token sama —
// lihat rentalOrderEngine.js::handleApprovalCallback) supaya satpam bisa scan dokumen
// fisik manapun yang tersedia.
//
// Arah rental_out (kita meminjamkan): status booked->out ditangani otomatis saat approval
// (SJ diterbitkan) + Proof of Delivery driver (api/scan/proof-of-delivery). Endpoint ini
// hanya menangani transisi TERAKHIR: out -> returned (barang kembali ke kita).
//
// Arah rental_in (Q10 — kita meminjam DARI pihak luar): TIDAK ada SJ yang kita terbitkan
// (pemilik yang mengirim dokumennya sendiri), jadi endpoint ini menangani KEDUA transisi:
//   booked -> out       : barang tiba di gerbang kita (kedatangan)
//   out    -> returned  : barang kita kembalikan ke pemilik (gerbang keluar)
//
// GET  ?code=<hasil scan>              -> info rental_order + item untuk direview satpam
// POST { code, items: [{id, kondisiKembali}] } -> proses transisi yang berlaku

import { error, json, type RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getUserPermissions, hasAnyPermission } from '$lib/server/rbacServer';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { directusServerJson } from '$lib/server/directus';
import { parseEpiQr } from '$lib/utils/qrParse';

async function resolveRentalId(code: string): Promise<{ rentalId: number; token: string } | null> {
	const parsed = parseEpiQr(code);
	if (!parsed || !parsed.token) return null;

	if (parsed.type === 'PJM') {
		return { rentalId: Number(parsed.id), token: parsed.token };
	}
	if (parsed.type === 'SJ') {
		const sjRes = await directusServerJson<{ data: { rental_order_id: number | null; type: string } }>(
			`/items/surat_jalan/${parsed.id}?fields=rental_order_id,type`
		).catch(() => null);
		const sj = sjRes?.data;
		if (!sj || sj.type !== 'peminjaman' || !sj.rental_order_id) return null;
		return { rentalId: sj.rental_order_id, token: parsed.token };
	}
	return null;
}

async function requireSatpam(event: RequestEvent) {
	const user = await requireUser(event);
	const authHeader = event.request.headers.get('authorization') || '';
	const idToken = authHeader.replace(/^Bearer\s+/i, '');
	const { permissions } = await getUserPermissions(idToken, user.localId, { email: user.email });
	if (!hasAnyPermission(permissions, 'gate_log')) throw error(403, 'Hanya Satpam yang boleh memproses gerbang peminjaman.');
	return resolveKaryawanByEmail(user.email);
}

/** Tentukan aksi gerbang yang berlaku dari arah peminjaman + status saat ini. */
function resolveGateAction(rentalDirection: string, status: string): 'kedatangan' | 'retur' | null {
	if (rentalDirection === 'rental_in') {
		if (status === 'booked') return 'kedatangan';
		if (status === 'out') return 'retur';
		return null;
	}
	// rental_out (default): satu-satunya transisi di gerbang ini adalah retur.
	if (status === 'out') return 'retur';
	return null;
}

export async function GET(event: RequestEvent) {
	await requireSatpam(event);
	const code = event.url.searchParams.get('code') || '';
	const resolved = await resolveRentalId(code);
	if (!resolved) throw error(400, 'Kode QR bukan Peminjaman External yang dikenali.');

	const rentalRes = await directusServerJson<{ data: any }>(
		`/items/rental_order/${resolved.rentalId}?fields=id,qr_token,status,rental_direction,reference_no,contact_id.name`
	).catch(() => null);
	const rental = rentalRes?.data;
	if (!rental) throw error(404, 'Peminjaman tidak ditemukan.');
	if (!rental.qr_token || rental.qr_token !== resolved.token) throw error(400, 'Token QR tidak cocok.');

	const action = resolveGateAction(rental.rental_direction, rental.status);
	if (!action) throw error(409, `Peminjaman ini berstatus '${rental.status}' — tidak ada aksi gerbang yang berlaku.`);

	const itemsRes = await directusServerJson<{ data: any[] }>(
		`/items/rental_order_items?filter[rental_order_id][_eq]=${resolved.rentalId}&limit=-1&fields=id,nama_barang,qty,satuan`
	);

	return json({
		rentalId: rental.id,
		referenceNo: rental.reference_no,
		peminjam: rental.contact_id?.name || '-',
		rentalDirection: rental.rental_direction,
		action, // 'kedatangan' | 'retur' — klien merutekan tampilan berdasar ini
		items: itemsRes?.data || []
	});
}

export async function POST(event: RequestEvent) {
	const satpam = await requireSatpam(event);
	const body = await event.request.json().catch(() => ({}));
	const code = String(body?.code || '');
	const itemConditions: Array<{ id: number; kondisiKembali: string }> = Array.isArray(body?.items) ? body.items : [];

	const resolved = await resolveRentalId(code);
	if (!resolved) throw error(400, 'Kode QR bukan Peminjaman External yang dikenali.');

	const rentalRes = await directusServerJson<{ data: any }>(
		`/items/rental_order/${resolved.rentalId}?fields=id,qr_token,status,rental_direction,surat_jalan_id,reference_no,contact_id.name`
	).catch(() => null);
	const rental = rentalRes?.data;
	if (!rental) throw error(404, 'Peminjaman tidak ditemukan.');
	if (!rental.qr_token || rental.qr_token !== resolved.token) throw error(400, 'Token QR tidak cocok.');

	const action = resolveGateAction(rental.rental_direction, rental.status);
	if (!action) throw error(409, `Peminjaman ini berstatus '${rental.status}' — tidak ada aksi gerbang yang berlaku.`);

	// Q10, arah rental_in, transisi pertama (booked -> out): barang baru tiba, cukup catat
	// kondisi kedatangan per item sebagai kondisi_keluar (baseline pembanding saat retur nanti).
	// Belum ada denda di sini — belum tentu ada kerusakan, itemnya baru saja datang.
	if (action === 'kedatangan') {
		for (const it of itemConditions) {
			await directusServerJson(`/items/rental_order_items/${it.id}`, {
				method: 'PATCH',
				body: JSON.stringify({ kondisi_keluar: it.kondisiKembali || 'Baik' })
			}).catch(() => {});
		}
		await directusServerJson(`/items/rental_order/${resolved.rentalId}`, {
			method: 'PATCH',
			body: JSON.stringify({ status: 'out' })
		});
		return json({ success: true, rentalId: resolved.rentalId, newStatus: 'out', action });
	}

	// action === 'retur' — barang kembali ke kita (rental_out) ATAU kita kembalikan ke
	// pemilik (rental_in). Logika sama: catat kondisi, tandai returned, beri tahu Finance
	// bila ada deviasi kondisi (siapa yang berutang denda ke siapa ditentukan manusia, bukan sistem).
	const catRes = await directusServerJson<{ data: Array<{ id: string; name: string }> }>(
		`/items/category?filter[group][_eq]=kondisi_kembali&limit=-1&fields=id,name`
	).catch(() => ({ data: [] }));
	const kondisiMap = new Map((catRes?.data || []).map((c) => [c.name, c.id]));

	let worstCondition: string | null = null;
	for (const it of itemConditions) {
		const kondisiId = kondisiMap.get(it.kondisiKembali) || null;
		await directusServerJson(`/items/rental_order_items/${it.id}`, {
			method: 'PATCH',
			body: JSON.stringify({ kondisi_kembali: kondisiId })
		}).catch(() => {});
		if (it.kondisiKembali && it.kondisiKembali !== 'Baik') worstCondition = it.kondisiKembali;
	}

	const rentalKondisiId = worstCondition ? kondisiMap.get(worstCondition) || null : kondisiMap.get('Baik') || null;

	await directusServerJson(`/items/rental_order/${resolved.rentalId}`, {
		method: 'PATCH',
		body: JSON.stringify({
			status: 'returned',
			actual_return_date: new Date().toISOString().split('T')[0],
			kondisi_kembali: rentalKondisiId
		})
	});

	if (rental.surat_jalan_id) {
		const sjId = typeof rental.surat_jalan_id === 'object' ? rental.surat_jalan_id.id : rental.surat_jalan_id;
		// status='received' + delivery_variance (bila kondisi bukan 'Baik') dipakai bersama oleh
		// workflow n8n "GR - Alert Deviasi ke Manajer" yang SUDAH generik (query status=received
		// AND delivery_variance=true) — cukup set field ini, tidak perlu cabang n8n baru.
		await directusServerJson(`/items/surat_jalan/${sjId}`, {
			method: 'PATCH',
			body: JSON.stringify({
				return_status: 'selesai',
				status: 'received',
				received_at: new Date().toISOString(),
				received_by: satpam?.nama_karyawan || null,
				delivery_variance: !!worstCondition
			})
		}).catch(() => {});
	}

	// F4 (Q4: "catat saja, buat draf, atau kirim tagihan otomatis?" — belum dijawab eksplisit,
	// jadi diambil opsi paling aman: catat kondisi + beri tahu Finance, JANGAN hitung nominal
	// denda otomatis karena tidak ada kebijakan tarif yang disepakati). denda_amount dibiarkan
	// kosong untuk diisi manual oleh Finance/Admin di panel Peminjaman External.
	if (worstCondition) {
		const arahLabel = rental.rental_direction === 'rental_in' ? 'dikembalikan ke pemilik' : 'kembali dari peminjam';
		await directusServerJson('/items/app_notifications', {
			method: 'POST',
			body: JSON.stringify({
				type: 'RENTAL_DAMAGE_REVIEW',
				title: 'Peminjaman Kembali dengan Kerusakan/Kehilangan',
				message: `${rental.reference_no} (${rental.contact_id?.name || '-'}) ${arahLabel} dengan kondisi "${worstCondition}". Perlu penilaian denda oleh Finance.`,
				priority: 'high',
				department: 'Finance',
				action_required: true,
				action_url: `/maintenance/rental-monitor`,
				read: false,
				created_at: new Date().toISOString(),
				source_collection: 'rental_order',
				source_id: String(resolved.rentalId)
			})
		}).catch((e) => console.error('[gate-retur] gagal kirim notifikasi denda ke Finance:', e));
	}

	return json({ success: true, rentalId: resolved.rentalId, newStatus: 'returned', action, needsDamageReview: !!worstCondition });
}
