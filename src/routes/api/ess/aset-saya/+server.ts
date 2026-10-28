// src/routes/api/ess/aset-saya/+server.ts
// Asset Tracker: agregasi read-only aset milik karyawan yang sedang login, dari 4
// koleksi Directus terpisah (bukan nested query — lihat CLAUDE.md aturan Directus fetching).
//   1. IT_items            (karyawan_id) — fallback assigned_to teks utk data lama
//   2. peminjaman_barang_it (karyawan_id) — fallback email_peminjam utk data lama
//   3. ga_asset             (penanggung_jawab_id)
//   4. internal_loan_log    (pic_id, FK langsung ke karyawan) DIGABUNG dengan
//      internal_loan_log.borrower_id (FK ke personnel) dijembatani via personnel.karyawan_id
//      (relasi FK resmi Fase 4 — diaudit 25 Sep 2026, 0 nilai invalid/orphan). Sama persis
//      dengan erp-epi/employeeAssetApi.js — jaga sinkron bila salah satu diubah.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

async function fetchItTetap(karyawanId: number, nama: string) {
	const filters: any[] = [{ karyawan_id: { _eq: karyawanId } }];
	if (nama) filters.push({ _and: [{ karyawan_id: { _null: true } }, { assigned_to: { _eq: nama } }] });
	const filter = filters.length > 1 ? { _or: filters } : filters[0];
	const qp = new URLSearchParams({
		fields: 'id,name,type,category,serial_number,asset_tag,kondisi,lifecycle_status,location,karyawan_id',
		filter: JSON.stringify(filter),
		limit: '-1'
	});
	const res = await directusServerJson<{ data: any[] }>(`/items/IT_items?${qp}`);
	return (res?.data || []).map((it) => ({ ...it, _tertaut_resmi: !!it.karyawan_id }));
}

async function fetchItPinjaman(karyawanId: number, email: string) {
	const filters: any[] = [{ karyawan_id: { _eq: karyawanId } }];
	if (email) filters.push({ _and: [{ karyawan_id: { _null: true } }, { email_peminjam: { _eq: email } }] });
	const combined = filters.length > 1 ? { _or: filters } : filters[0];
	const filter = { _and: [combined, { status_pinjam: { _nin: ['dikembalikan', 'ditolak'] } }] };
	const qp = new URLSearchParams({
		fields: 'id,tanggal_pinjam,tanggal_target_kembali,status_pinjam,karyawan_id,asset_item_id.name,asset_item_id.asset_tag',
		filter: JSON.stringify(filter),
		limit: '-1'
	});
	const res = await directusServerJson<{ data: any[] }>(`/items/peminjaman_barang_it?${qp}`);
	return (res?.data || []).map((it) => ({ ...it, _tertaut_resmi: !!it.karyawan_id }));
}

async function fetchGaFasilitas(karyawanId: number) {
	const qp = new URLSearchParams({
		fields: 'id,kode,nama,kategori,kondisi,status,lokasi_id.location_name,qty,mode_lacak',
		filter: JSON.stringify({ penanggung_jawab_id: { _eq: karyawanId } }),
		limit: '-1'
	});
	const res = await directusServerJson<{ data: any[] }>(`/items/ga_asset?${qp}`);
	return res?.data || [];
}

async function fetchPersonnelIdsByKaryawan(karyawanId: number): Promise<string[]> {
	const qp = new URLSearchParams({
		fields: 'id',
		filter: JSON.stringify({ karyawan_id: { _eq: karyawanId } }),
		limit: '-1'
	});
	const res = await directusServerJson<{ data: { id: string }[] }>(`/items/personnel?${qp}`).catch(() => null);
	return (res?.data || []).map((p) => p.id);
}

const ALAT_LAPANGAN_FIELDS = 'id,equipment_id.name,equipment_id.code,equipment_id.parent_category,start_date,end_date_planned,purpose,project_id.name';

async function fetchAlatLapangan(karyawanId: number) {
	const personnelIds = await fetchPersonnelIdsByKaryawan(karyawanId);

	const [picRes, borrowerRes] = await Promise.all([
		directusServerJson<{ data: any[] }>(
			`/items/internal_loan_log?${new URLSearchParams({
				fields: ALAT_LAPANGAN_FIELDS,
				filter: JSON.stringify({ _and: [{ pic_id: { _eq: karyawanId } }, { end_date_actual: { _null: true } }] }),
				limit: '-1'
			})}`
		),
		personnelIds.length
			? directusServerJson<{ data: any[] }>(
					`/items/internal_loan_log?${new URLSearchParams({
						fields: ALAT_LAPANGAN_FIELDS,
						filter: JSON.stringify({ _and: [{ borrower_id: { _in: personnelIds } }, { end_date_actual: { _null: true } }] }),
						limit: '-1'
					})}`
				)
			: Promise.resolve({ data: [] })
	]);

	const merged = new Map<number, any>();
	for (const it of picRes?.data || []) merged.set(it.id, it);
	for (const it of borrowerRes?.data || []) if (!merged.has(it.id)) merged.set(it.id, it);
	return [...merged.values()];
}

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const [itTetap, itPinjaman, gaFasilitas, alatLapangan] = await Promise.all([
		fetchItTetap(karyawan.id, karyawan.nama_karyawan),
		fetchItPinjaman(karyawan.id, karyawan.email_company),
		fetchGaFasilitas(karyawan.id),
		fetchAlatLapangan(karyawan.id)
	]);

	return json({
		itTetap,
		itPinjaman,
		gaFasilitas,
		alatLapangan,
		totalItem: itTetap.length + itPinjaman.length + gaFasilitas.length + alatLapangan.length
	});
};
