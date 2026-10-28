// src/routes/api/sales/sample-request/+server.ts
// SI-TAMA Sales §7 — Request Sample Cat.
//   GET  : daftar request (filter status / mine / q / rentang tanggal)
//   POST : buat request baru (alokasi nomor SMP/YYYY/NNNN, idempoten via client_txn_id)
// Auth Firebase (requireUser). Semua tulis lewat token Directus server.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { directusServerJson } from '$lib/server/directus';
import { allocateSampleNomor } from '$lib/server/sampleRequestNumber';

const COL = 'sales_sample_request';
const READ_FIELDS = [
	'id', 'nomor_request', 'tanggal', 'status', 'sales_id', 'sales_id.nama_karyawan',
	'customer_id', 'customer_id.nama_sj_fp', 'customer_id.kode_customer', 'customer_name',
	'prospect_id', 'produk_cat', 'warna', 'ukuran_sample', 'jumlah', 'tujuan', 'kategori', 'keterangan',
	'approved_by', 'approved_by.nama_karyawan', 'approved_at', 'catatan_approver',
	'tanggal_kirim', 'foto_bukti', 'date_created',
	// Fase 6.3 (rencana lifecycle produksi v2, 15 Sep 2026): dipakai timeline & badge feedback di list.
	'sumber_pemenuhan', 'feedback_hasil'
].join(',');

async function resolveKaryawan(user: { localId: string; email: string }) {
	const byUid = await getKaryawanByFirebaseUid(user.localId).catch(() => null);
	if (byUid) return byUid;
	return resolveKaryawanByEmail(user.email);
}

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);

	const sp = event.url.searchParams;
	const filter: Record<string, any> = {};
	const and: any[] = [];

	const status = sp.get('status');
	if (status && status !== 'all') {
		if (status === 'aktif') and.push({ status: { _nin: ['selesai', 'ditolak'] } });
		else and.push({ status: { _eq: status } });
	}
	if (sp.get('mine') === '1' && karyawan?.id) and.push({ sales_id: { _eq: karyawan.id } });
	const from = sp.get('from');
	const to = sp.get('to');
	if (from) and.push({ tanggal: { _gte: from } });
	if (to) and.push({ tanggal: { _lte: to } });
	const q = sp.get('q')?.trim();
	if (q) {
		and.push({
			_or: [
				{ nomor_request: { _icontains: q } },
				{ warna: { _icontains: q } },
				{ produk_cat: { _icontains: q } },
				{ customer_name: { _icontains: q } }
			]
		});
	}
	if (and.length) filter._and = and;

	const params = new URLSearchParams({
		fields: READ_FIELDS,
		sort: '-id',
		limit: String(Math.min(Number(sp.get('limit')) || 100, 200))
	});
	if (and.length) params.set('filter', JSON.stringify(filter));

	const res = await directusServerJson<{ data: any[] }>(`/items/${COL}?${params.toString()}`);
	return json({ data: res?.data || [] });
};

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan?.id) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const body = await event.request.json().catch(() => null);
	if (!body) throw error(400, 'Body harus JSON.');

	// Idempotensi antrian offline
	const clientTxnId = typeof body.client_txn_id === 'string' ? body.client_txn_id.trim() : '';
	if (clientTxnId) {
		const dup = await directusServerJson<{ data: any[] }>(
			`/items/${COL}?filter[client_txn_id][_eq]=${encodeURIComponent(clientTxnId)}&fields=${READ_FIELDS}&limit=1`
		);
		if (dup?.data?.length) return json({ data: dup.data[0], duplicate: true });
	}

	if (!body.warna?.trim()) throw error(400, 'Warna wajib diisi.');
	if (!body.produk_cat?.trim()) throw error(400, 'Produk cat wajib diisi.');
	if (!body.kategori?.trim()) throw error(400, 'Kategori sample wajib dipilih.');

	const { nomor } = await allocateSampleNomor();

	const payload: Record<string, any> = {
		nomor_request: nomor,
		tanggal: body.tanggal || new Date().toISOString().slice(0, 10),
		sales_id: karyawan.id,
		customer_id: body.customer_id ? Number(body.customer_id) : null,
		customer_name: body.customer_name?.trim() || null,
		prospect_id: body.prospect_id ? Number(body.prospect_id) : null,
		produk_cat: body.produk_cat.trim(),
		warna: body.warna.trim(),
		ukuran_sample: body.ukuran_sample || null,
		jumlah: Number(body.jumlah) > 0 ? Number(body.jumlah) : 1,
		tujuan: body.tujuan || null,
		kategori: body.kategori?.trim() || null,
		keterangan: body.keterangan?.trim() || null,
		status: body.submit ? 'menunggu_approval' : 'draft',
		client_txn_id: clientTxnId || null
	};

	const created = await directusServerJson<{ data: any }>(`/items/${COL}`, {
		method: 'POST',
		body: JSON.stringify(payload)
	});

	return json({ data: created?.data });
};
