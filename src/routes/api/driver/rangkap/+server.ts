// src/routes/api/driver/rangkap/+server.ts
// BK Gate v2 — Fase 7, diperbaiki Gate Ketat SJ v3 — Fase 5 (20 Sep 2026). Lembar
// rangkap milik PERAN DRIVER (peruntukan_role='driver') yang masih dipegang driver
// yang login, lintas SJ. Pola filter driver sama /api/lacak-sj.
//   GET  → daftar lembar driver belum disetor.
//   POST { rangkapId } → setor (majukan status langsung ke 'diarsip' — lembar driver
//         tidak wajib scan, jadi tak ada langkah antara).
//
// ⚠️ SEBELUMNYA hardcode `filter[lembar_kode][_eq]=hijau` — rusak begitu skema warna
// berubah (Fase 1 Gate Ketat SJ v3, 5 lembar Putih/Pink/Merah/Kuning/Hijau, Pink
// menggantikan Biru). Diperbaiki: filter by `peruntukan_role='driver'` (resolusi
// peran, bukan nama warna) — kalau admin ganti warna lagi lewat app_settings
// `logistik.sj_rangkap_scheme`, layar ini otomatis ikut tanpa perlu deploy ulang
// (CLAUDE.md: minimalisir hardcode).

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/projectLeaderGuard';
import { directusServerJson } from '$lib/server/directus';
import { advanceRangkapStatus } from '$lib/server/rangkap';

const TERMINAL = ['diarsip', 'discan', 'hilang'];

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawanByEmail(user.email);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const filter = {
		_or: [
			{ driver: { _icontains: karyawan.nama_karyawan } },
			{ delegated_driver_id: { _eq: karyawan.id } },
			{ delegated_user_id: { _eq: karyawan.id } }
		]
	};
	const q = new URLSearchParams({
		filter: JSON.stringify(filter),
		fields: 'id,nomor_sj,delivery_address',
		sort: '-id',
		limit: '100'
	});
	const sjRes = await directusServerJson<{ data: Array<{ id: number; nomor_sj: string; delivery_address: string | null }> }>(
		`/items/surat_jalan?${q.toString()}`
	).catch(() => ({ data: [] }));
	const sjs = sjRes?.data || [];
	if (!sjs.length) return json({ lembar: [] });

	const sjIds = sjs.map((s) => s.id);
	const sjById = new Map(sjs.map((s) => [s.id, s]));
	const rangkapRes = await directusServerJson<{ data: any[] }>(
		`/items/sj_dokumen_rangkap?filter[surat_jalan_id][_in]=${sjIds.join(',')}` +
			`&filter[peruntukan_role][_eq]=driver&fields=id,surat_jalan_id,status,deadline_kembali,lembar_nama,warna_hex&limit=-1`
	).catch(() => ({ data: [] }));

	const lembar = (rangkapRes?.data || [])
		.filter((r) => !TERMINAL.includes(r.status))
		.map((r) => {
			const sjId = typeof r.surat_jalan_id === 'object' ? r.surat_jalan_id.id : r.surat_jalan_id;
			const sj = sjById.get(sjId);
			return {
				rangkap_id: r.id,
				surat_jalan_id: sjId,
				nomor_sj: sj?.nomor_sj || `SJ #${sjId}`,
				tujuan: sj?.delivery_address || null,
				status: r.status,
				deadline_kembali: r.deadline_kembali,
				lembar_nama: r.lembar_nama || 'Lembar',
				warna_hex: r.warna_hex || null
			};
		});

	return json({ lembar });
};

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawanByEmail(user.email);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const body = await event.request.json().catch(() => null);
	const rangkapId = body?.rangkapId;
	if (!rangkapId) throw error(400, 'rangkapId wajib diisi');

	try {
		const result = await advanceRangkapStatus(rangkapId, 'diarsip', karyawan.nama_karyawan);
		return json({ success: true, ...result });
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Gagal menyetor lembar');
	}
};
