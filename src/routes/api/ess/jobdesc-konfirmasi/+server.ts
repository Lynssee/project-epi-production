// src/routes/api/ess/jobdesc-konfirmasi/+server.ts
// SERVER-ONLY. Konfirmasi "sudah membaca" jobdesc jabatan sendiri (HANYA INFORMASI — tidak memblokir apa pun; aturan #3).
// Memakai kembali sop_read_confirmations (tanpa koleksi/kolom baru): flow_key = "jobdesc:posisi:<posisi.id>", flow_version = versi jobdesc.
// Versi jobdesc dibaca dari SERVER (jobdesc terbit = posisi.jobdesc_aktif_id & aktif), bukan kiriman klien; draf (aktif:false) tak pernah dihitung.
import { json, type RequestHandler } from '@sveltejs/kit';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';

const keyOf = (posisiId: number) => `jobdesc:posisi:${posisiId}`;

/** Jobdesc TERBIT untuk jabatan karyawan; null bila belum ada/belum terhubung. Fetch dipisah per koleksi (tanpa relasi bersarang). */
async function resolveJobdesc(jabatanId: number | null) {
	if (!jabatanId) return null;
	const pos = await directusServerJson<{ data: { id: number; jobdesc_aktif_id: number | null } }>(
		`/items/posisi/${jabatanId}?fields=id,jobdesc_aktif_id`
	);
	const jdId = pos?.data?.jobdesc_aktif_id;
	if (!jdId) return null;
	const jd = await directusServerJson<{ data: { id: number; versi: number | null; aktif: boolean | number | null } }>(
		`/items/jabatan_jobdesc/${jdId}?fields=id,versi,aktif`
	);
	const row = jd?.data;
	if (!row || !row.aktif) return null;
	return { posisiId: Number(jabatanId), versi: Number(row.versi) || 1 };
}

async function findConfirmation(karyawanId: number, key: string) {
	const res = await directusServerJson<{ data: any[] }>(
		`/items/sop_read_confirmations?filter[karyawan_id][_eq]=${karyawanId}&filter[flow_key][_eq]=${encodeURIComponent(key)}&fields=id,flow_version,confirmed_at&sort=-confirmed_at&limit=1`
	);
	return res?.data?.[0] ?? null;
}

export const GET: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	try {
		const jd = await resolveJobdesc(karyawan.jabatan_id);
		if (!jd) return json({ success: true, available: false });
		const rec = await findConfirmation(karyawan.id, keyOf(jd.posisiId));
		const confirmed = Boolean(rec) && (Number(rec.flow_version) || 1) >= jd.versi;
		return json({
			success: true,
			available: true,
			versi: jd.versi,
			confirmed,
			needs_reconfirm: Boolean(rec) && !confirmed,
			confirmed_at: rec?.confirmed_at ?? null
		});
	} catch (e: any) {
		console.error('[ess/jobdesc-konfirmasi GET] gagal:', e?.message || e);
		return json({ success: false, available: false, error: 'Status konfirmasi belum bisa dimuat.' }, { status: 502 });
	}
};

export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);
	try {
		const jd = await resolveJobdesc(karyawan.jabatan_id);
		if (!jd) return json({ success: false, error: 'Jabatan Anda belum punya jobdesc terbit.' }, { status: 404 });
		const key = keyOf(jd.posisiId);
		const rec = await findConfirmation(karyawan.id, key);
		if (rec && (Number(rec.flow_version) || 1) >= jd.versi) {
			return json({ success: true, already_confirmed: true, versi: jd.versi, confirmed_at: rec.confirmed_at });
		}
		const ip = event.getClientAddress ? event.getClientAddress() : null;
		const at = new Date().toISOString();
		if (rec) {
			await directusServerJson(`/items/sop_read_confirmations/${rec.id}`, {
				method: 'PATCH',
				body: JSON.stringify({ flow_version: jd.versi, confirmed_at: at, ip_address: ip })
			});
			return json({ success: true, versi: jd.versi, confirmed_at: at });
		}
		const created = await directusServerJson<{ data: any }>('/items/sop_read_confirmations', {
			method: 'POST',
			body: JSON.stringify({
				karyawan_id: karyawan.id,
				sop_id: null,
				sop_version_seq: 1,
				flow_key: key,
				flow_version: jd.versi,
				confirmed_at: at,
				ip_address: ip
			})
		});
		return json({ success: true, versi: jd.versi, confirmed_at: created?.data?.confirmed_at ?? at });
	} catch (e: any) {
		console.error('[ess/jobdesc-konfirmasi POST] gagal:', e?.message || e);
		return json({ success: false, error: 'Gagal mencatat konfirmasi baca jobdesc.' }, { status: 500 });
	}
};
