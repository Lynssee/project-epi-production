// src/routes/api/barang/rangkap-saya/+server.ts
// BK Gate v2 — Fase 7. Dua ringkasan untuk kartu di /barang:
//   - "Kiriman ke Saya": SJ dalam perjalanan/tiba di lokasi, ke user ini (delegated_user_id,
//     pola filter sama /api/lacak-sj).
//   - "Lembar yang Harus Dikembalikan": lembar rangkap wajib_kembali milik SJ yang SAYA
//     terima (delegated_user_id) — begitu SJ diterima & ditandatangani, penerima
//     bertanggung jawab mengirim balik lembar putih/kuning ke kantor.

import { json, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/projectLeaderGuard';
import { directusServerJson } from '$lib/server/directus';

const INCOMING_STAGES = ['dalam_perjalanan', 'tiba_lokasi'];
const TERMINAL = ['diarsip', 'discan', 'hilang'];

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawanByEmail(user.email);
	if (!karyawan) return json({ kiriman: [], kembalikan: [] });

	const myFilter = {
		_or: [
			{ driver: { _icontains: karyawan.nama_karyawan } },
			{ delegated_driver_id: { _eq: karyawan.id } },
			{ delegated_user_id: { _eq: karyawan.id } }
		]
	};
	const q = new URLSearchParams({
		filter: JSON.stringify(myFilter),
		fields: 'id,nomor_sj,track_stage,delivery_address',
		sort: '-id',
		limit: '100'
	});
	const sjRes = await directusServerJson<{ data: Array<{ id: number; nomor_sj: string; track_stage: string | null; delivery_address: string | null }> }>(
		`/items/surat_jalan?${q.toString()}`
	).catch(() => ({ data: [] }));
	const sjs = sjRes?.data || [];

	const kiriman = sjs
		.filter((s) => INCOMING_STAGES.includes(String(s.track_stage)))
		.map((s) => ({ surat_jalan_id: s.id, nomor_sj: s.nomor_sj, tujuan: s.delivery_address, tahap: s.track_stage }));

	let kembalikan: Array<{ rangkap_id: number; surat_jalan_id: number; nomor_sj: string; lembar: string; status: string; deadline_kembali: string | null }> = [];
	if (sjs.length) {
		const sjIds = sjs.map((s) => s.id);
		const sjById = new Map(sjs.map((s) => [s.id, s]));
		const rangkapRes = await directusServerJson<{ data: any[] }>(
			`/items/sj_dokumen_rangkap?filter[surat_jalan_id][_in]=${sjIds.join(',')}` +
				`&filter[wajib_kembali][_eq]=true&fields=id,surat_jalan_id,lembar_nama,status,deadline_kembali&limit=-1`
		).catch(() => ({ data: [] }));
		kembalikan = (rangkapRes?.data || [])
			.filter((r) => !TERMINAL.includes(r.status))
			.map((r) => {
				const sjId = typeof r.surat_jalan_id === 'object' ? r.surat_jalan_id.id : r.surat_jalan_id;
				const sj = sjById.get(sjId);
				return {
					rangkap_id: r.id,
					surat_jalan_id: sjId,
					nomor_sj: sj?.nomor_sj || `SJ #${sjId}`,
					lembar: r.lembar_nama,
					status: r.status,
					deadline_kembali: r.deadline_kembali
				};
			});
	}

	return json({ kiriman, kembalikan });
};
