// src/routes/api/produksi/pelarut/+server.ts
// Pelacak Pelarut Daur Ulang — Tahap A (13 Okt 2026). HANYA pencatatan di solvent_recovery_log;
// tidak menyentuh stok/jurnal. Identitas pencatat diresolve server-side dari token.
//   GET  -> { items, spk, riwayat }   (daftar pelarut dari app_settings production.solvent_item_ids)
//   POST { jenis, item_id, qty_kg, spk_id?, sumber?, catatan?, tanggal? }

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { requirePermission } from '$lib/server/rbacServer';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { directusServerJson } from '$lib/server/directus';
import { parseSolventItemIds, validatePelarutEntry } from '$lib/server/produksi/pelarut';

const PERMISSION = 'input_produksi_harian';

async function authenticate(event: Parameters<RequestHandler>[0]) {
	const user = await requireUser(event);
	await requirePermission(event, user.localId, PERMISSION);
	const karyawan = await resolveKaryawanByEmail(user.email);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');
	return karyawan;
}

async function loadAllowedItemIds(): Promise<number[]> {
	const filter = encodeURIComponent(JSON.stringify({ module: { _eq: 'production' }, setting_key: { _eq: 'solvent_item_ids' } }));
	const res = await directusServerJson<{ data: Array<{ setting_value: unknown }> }>(
		`/items/app_settings?filter=${filter}&fields=setting_value&limit=1`
	);
	return parseSolventItemIds(res?.data?.[0]?.setting_value);
}

export const GET: RequestHandler = async (event) => {
	const karyawan = await authenticate(event);
	let ids: number[];
	try {
		ids = await loadAllowedItemIds();
	} catch (e: any) {
		console.error('[produksi/pelarut] gagal membaca setelan solvent_item_ids:', e);
		throw error(502, e?.message || 'Gagal membaca setelan daftar pelarut.');
	}

	// Tiga sumber, query TERPISAH (Aturan Directus #2).
	const [itemsRes, spkRes, logRes] = await Promise.all([
		ids.length
			? directusServerJson<{ data: any[] }>(`/items/identitas_barang?filter[id][_in]=${ids.join(',')}&fields=id,nama_barang_lengkap,satuan&limit=-1`)
			: Promise.resolve({ data: [] as any[] }),
		directusServerJson<{ data: any[] }>(`/items/spk?filter[status][_in]=in_progress,qc_pending&fields=id,nomor&sort=-id&limit=40`).catch((e: any) => {
			console.warn('[produksi/pelarut] gagal membaca daftar SPK:', e);
			return { data: [] as any[] };
		}),
		directusServerJson<{ data: any[] }>(
			`/items/solvent_recovery_log?filter[dicatat_oleh_karyawan_id][_eq]=${karyawan.id}` +
				`&fields=id,tanggal,jenis,item_id,qty_kg,spk_id,sumber,catatan&sort=-tanggal&limit=30`
		).catch((e: any) => {
			console.warn('[produksi/pelarut] gagal membaca riwayat:', e);
			return { data: [] as any[] };
		})
	]);

	const items = (itemsRes?.data || []).map((i) => ({ id: i.id, nama: i.nama_barang_lengkap || `Barang #${i.id}`, satuan: i.satuan || 'KG' }));
	return json({ items, spk: spkRes?.data || [], riwayat: logRes?.data || [] });
};

export const POST: RequestHandler = async (event) => {
	const karyawan = await authenticate(event);
	const body = await event.request.json().catch(() => null);

	let ids: number[];
	try {
		ids = await loadAllowedItemIds();
	} catch (e: any) {
		throw error(502, e?.message || 'Gagal membaca setelan daftar pelarut.');
	}
	const v = validatePelarutEntry(body, ids);
	if (!v.ok) throw error(v.code, v.message);

	try {
		const res = await directusServerJson<{ data: any }>('/items/solvent_recovery_log', {
			method: 'POST',
			body: JSON.stringify({ ...v.row, dicatat_oleh_karyawan_id: karyawan.id, dicatat_oleh: karyawan.nama_karyawan })
		});
		return json({ entry: res?.data ?? v.row });
	} catch (e: any) {
		console.error('[produksi/pelarut] gagal menyimpan:', e);
		throw error(502, e?.message || 'Gagal menyimpan catatan pelarut.');
	}
};
