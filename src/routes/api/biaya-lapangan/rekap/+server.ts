// src/routes/api/biaya-lapangan/rekap/+server.ts
// Rekap Nota Lapangan (Fase 1 §5.2 Ekspor Lifecycle) — nota/biaya MILIK karyawan yang login per periode.
// HANYA-BACA. Sumber: fleet_trip_expense (kedua mode — talangan & dana proyek — menulis ke sini).
// Keamanan: filter karyawan_id SELALU dari sesi (authenticateEss), tidak pernah dari query. Rentang dibatasi
// (MAX_RANGE_DAYS) dan jumlah baris dibatasi agar ringan. Relasi proyek diambil TERPISAH (Aturan #2).

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { validateRange, type RekapRow } from '$lib/utils/rekapNotaLapangan';

const MAX_ROWS = 500;
const FIELDS = 'id,jenis,nominal,waktu,project_id,mode,catatan,foto_struk,approval_status';

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const dari = event.url.searchParams.get('dari');
	const sampai = event.url.searchParams.get('sampai');
	const v = validateRange(dari, sampai);
	if (!v.ok) throw error(400, v.reason);

	const filter = {
		_and: [
			{ karyawan_id: { _eq: String(karyawan.id) } },
			{ waktu: { _gte: `${dari}T00:00:00+07:00` } },
			{ waktu: { _lte: `${sampai}T23:59:59+07:00` } }
		]
	};
	const q = new URLSearchParams({
		filter: JSON.stringify(filter),
		fields: FIELDS,
		sort: '-waktu',
		limit: String(MAX_ROWS + 1)
	});

	let raw: any[] = [];
	try {
		const res = await directusServerJson<{ data: any[] }>(`/items/fleet_trip_expense?${q.toString()}`);
		raw = res?.data || [];
	} catch (e: any) {
		console.error('[biaya-lapangan/rekap] gagal memuat fleet_trip_expense:', e?.message || e);
		throw error(502, 'Gagal memuat rekap nota. Coba lagi.');
	}
	const truncated = raw.length > MAX_ROWS;
	if (truncated) raw = raw.slice(0, MAX_ROWS);

	// Relasi proyek: satu query terpisah untuk semua id unik.
	const projectIds = [...new Set(raw.map((r) => Number(r.project_id)).filter((n) => Number.isFinite(n) && n > 0))];
	const names = new Map<number, string>();
	if (projectIds.length > 0) {
		try {
			const pq = new URLSearchParams({ filter: JSON.stringify({ id: { _in: projectIds } }), fields: 'id,name', limit: String(projectIds.length) });
			const pr = await directusServerJson<{ data: { id: number; name: string }[] }>(`/items/projects?${pq.toString()}`);
			for (const p of pr?.data || []) names.set(Number(p.id), p.name);
		} catch (e: any) {
			// Nama proyek hanya pelengkap tampilan — rekap tetap dikirim, tapi jangan diam-diam (Aturan #1).
			console.warn('[biaya-lapangan/rekap] nama proyek gagal dimuat:', e?.message || e);
		}
	}

	const rows: RekapRow[] = raw.map((r) => ({
		id: r.id,
		waktu: r.waktu,
		jenis: r.jenis,
		nominal: Number(r.nominal) || 0,
		mode: r.mode || 'talangan',
		catatan: r.catatan ?? null,
		project_id: r.project_id ?? null,
		project_name: r.project_id != null ? names.get(Number(r.project_id)) ?? null : null,
		approval_status: r.approval_status ?? null,
		has_struk: !!r.foto_struk
	}));

	return json({ data: { rows, truncated, nama: karyawan.nama_karyawan, dari, sampai } });
};
