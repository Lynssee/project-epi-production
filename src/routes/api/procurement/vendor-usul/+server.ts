// src/routes/api/procurement/vendor-usul/+server.ts
// Vendor Wajib Terdaftar & Identitas Lengkap — Fase 7 (Dashboard Lapangan B2).
// Usul vendor baru dari lapangan → antrian Procurement (vendor_bayangan_log,
// sumber 'usul_lapangan'). Tim lapangan paling tahu toko lokal.
//
//   POST { nama, telp?, kota?, catatan?, gps_lat?, gps_lng?, foto? (uuid) }

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { directusServerJson } from '$lib/server/directus';

function normalizeVendorName(sv: string): string {
	return String(sv ?? '')
		.toUpperCase()
		.replace(/\b(PT|CV|UD|PD|TBK|PERSERO|PERSEROAN|KOPERASI|FIRMA)\b\.?/g, '')
		.replace(/[^A-Z0-9]+/g, ' ')
		.trim();
}
const s = (v: any) => (v == null ? '' : String(v)).trim();

export async function POST(event: RequestEvent) {
	const fbUser = await requireUser(event);
	const karyawan = await getKaryawanByFirebaseUid(fbUser.localId).catch(() => null);

	const body = await event.request.json().catch(() => ({}));
	const nama = s(body?.nama).slice(0, 255);
	if (nama.length < 3) throw error(400, 'Nama toko/vendor wajib diisi (min. 3 karakter).');

	const row: Record<string, any> = {
		nama,
		nama_normal: normalizeVendorName(nama),
		sumber: 'usul_lapangan',
		tanggal: new Date().toISOString().slice(0, 10),
		status_tindak_lanjut: 'baru',
		telp: s(body?.telp).slice(0, 64) || null,
		kota: s(body?.kota).slice(0, 128) || null,
		catatan: s(body?.catatan).slice(0, 2000) || null,
		gps_lat: Number(body?.gps_lat) || null,
		gps_lng: Number(body?.gps_lng) || null,
		foto: s(body?.foto) || null,
		diusulkan_oleh: karyawan?.nama || fbUser?.email || null
	};

	try {
		const res: any = await directusServerJson('/items/vendor_bayangan_log', {
			method: 'POST',
			body: JSON.stringify(row)
		});
		return json({ success: true, id: res?.data?.id });
	} catch (e: any) {
		console.error('[vendor-usul] gagal:', e?.message || e);
		throw error(500, 'Gagal mengirim usulan: ' + (e?.message || 'unknown'));
	}
}
