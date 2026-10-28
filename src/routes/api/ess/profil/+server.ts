import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

// Field data diri yang boleh dilengkapi/diedit mandiri oleh karyawan lewat ESS. Field
// organisasi (nama, divisi, posisi, status_kerja, tanggal_masuk, no_karyawan) SENGAJA
// tidak dibuka di sini — itu catatan resmi HR, hanya boleh diubah lewat admin app.
const EDITABLE_FIELDS = [
	'tempat_lahir', 'tanggal_lahir', 'no_ktp', 'no_kk', 'no_npwp', 'alamat_ktp',
	'agama', 'pendidikan_terakhir', 'no_hp', 'kontak_darurat', 'no_telp_darurat',
	'no_bpjs_kes', 'no_rekening'
];

const PROFIL_FIELDS = [
	'id', 'nama_karyawan', 'id_karyawan', 'no_karyawan', 'divisi', 'posisi',
	'email_company', 'tanggal_masuk', 'status_kerja', 'status',
	...EDITABLE_FIELDS
].join(',');

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const query = new URLSearchParams({ fields: PROFIL_FIELDS });
	const result = await directusServerJson<{ data: any }>(`/items/karyawan/${karyawan.id}?${query.toString()}`);

	return json({ profil: result?.data || null });
};

export const PATCH: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const body = await event.request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Data tidak valid.');

	const payload: Record<string, string | null> = {};
	for (const key of EDITABLE_FIELDS) {
		if (!(key in body)) continue;
		const val = body[key];
		if (val === null || val === undefined) {
			payload[key] = null;
			continue;
		}
		const str = String(val).trim();
		if (str.length > 255) throw error(400, `Nilai "${key}" terlalu panjang.`);
		payload[key] = str;
	}

	if (Object.keys(payload).length === 0) throw error(400, 'Tidak ada field yang diubah.');

	const updated = await directusServerJson<{ data: any }>(`/items/karyawan/${karyawan.id}`, {
		method: 'PATCH',
		body: JSON.stringify(payload)
	});

	try {
		await directusServerJson('/items/app_notifications', {
			method: 'POST',
			body: JSON.stringify({
				type: 'dokumen',
				title: 'Data profil dilengkapi mandiri',
				message: `${karyawan.nama_karyawan} melengkapi data profil (${Object.keys(payload).join(', ')}) via aplikasi lapangan.`,
				priority: 'low',
				department: 'hrd',
				read: false,
				action_required: false,
				action_url: '/hrd?tab=dokumen',
				created_at: new Date().toISOString()
			})
		});
	} catch (e) {
		console.warn('[ess/profil] gagal membuat notifikasi (non-fatal):', (e as Error).message);
	}

	return json({ profil: updated?.data });
};
