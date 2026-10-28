// src/lib/server/ess/pengumuman.ts
// Query helper feed pengumuman HR (koleksi hr_pengumuman) + state baca per
// karyawan (koleksi ess_pengumuman_read) untuk /api/ess/pengumuman.

import { directusServerJson } from '$lib/server/directus';
import { todayJakarta } from '$lib/server/ess/time';

export interface PengumumanRecord {
	id: string;
	judul: string;
	isi: string;
	kategori: string;
	target: string;
	target_divisi: string | null;
	tanggal_mulai: string;
	tanggal_selesai: string | null;
	lampiran: string | null;
}

const PENGUMUMAN_FIELDS = [
	'id', 'judul', 'isi', 'kategori', 'target', 'target_divisi', 'tanggal_mulai', 'tanggal_selesai', 'lampiran'
].join(',');

export async function listActivePengumuman(divisi: string | null): Promise<PengumumanRecord[]> {
	const today = todayJakarta();
	const filter = {
		_and: [
			{ aktif: { _eq: true } },
			{ tanggal_mulai: { _lte: today } },
			{ _or: [{ tanggal_selesai: { _null: true } }, { tanggal_selesai: { _gte: today } }] },
			{ _or: [{ target: { _eq: 'all' } }, { _and: [{ target: { _eq: 'dept' } }, { target_divisi: { _eq: divisi || '' } }] }] }
		]
	};
	const query = new URLSearchParams({
		filter: JSON.stringify(filter),
		fields: PENGUMUMAN_FIELDS,
		sort: '-tanggal_mulai',
		limit: '50'
	});
	const result = await directusServerJson<{ data: PengumumanRecord[] }>(`/items/hr_pengumuman?${query.toString()}`);
	return result?.data || [];
}

export async function listReadIds(karyawanId: number, pengumumanIds: string[]): Promise<Set<string>> {
	if (pengumumanIds.length === 0) return new Set();
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		'filter[pengumuman_id][_in]': pengumumanIds.join(','),
		fields: 'pengumuman_id',
		limit: '-1'
	});
	const result = await directusServerJson<{ data: { pengumuman_id: string }[] }>(`/items/ess_pengumuman_read?${query.toString()}`);
	return new Set((result?.data || []).map((r) => r.pengumuman_id));
}

export async function markAsRead(karyawanId: number, pengumumanId: string): Promise<void> {
	const query = new URLSearchParams({
		'filter[karyawan_id][_eq]': String(karyawanId),
		'filter[pengumuman_id][_eq]': pengumumanId,
		fields: 'id',
		limit: '1'
	});
	const existing = await directusServerJson<{ data: { id: string }[] }>(`/items/ess_pengumuman_read?${query.toString()}`);
	if (existing?.data?.length) return;

	await directusServerJson('/items/ess_pengumuman_read', {
		method: 'POST',
		body: JSON.stringify({
			karyawan_id: karyawanId,
			pengumuman_id: pengumumanId,
			read_at: new Date().toISOString()
		})
	});
}
