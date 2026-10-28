// src/routes/api/opname-sesi/+server.ts
// Lifecycle Inventory Tahap 6 — F4 (7 Okt 2026): API lapangan untuk Stock Opname berbasis sesi.
//   GET            -> daftar sesi yang sedang "Menghitung" (+ penanda sesi saya)
//   GET ?id=<n>    -> detail sesi + baris (blind count ditegakkan di server)
//   POST {action:'count', id, entries:[{lineId, qtyFisik, alasan?, catatan?, foto?}]}
// Identitas penghitung di-resolve SERVER-SIDE dari Firebase (pola /api/stock-lapangan/cek-area) — klien tidak bisa
// mengaku sebagai orang lain. Menutup hitung / approval / posting stok TIDAK ada di sini (tetap di erp-epi).

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { listSesiAktif, getSesiLapangan, simpanHitungan, readOpnameLapanganConfig } from '$lib/server/opnameSesi';

async function resolveKaryawan(user: { localId: string; email: string }) {
	const byUid = await getKaryawanByFirebaseUid(user.localId).catch(() => null);
	if (byUid) return byUid;
	return resolveKaryawanByEmail(user.email);
}

function toHttp(e: any, fallback: string): never {
	if (e?.status && e.status < 500) throw error(e.status, e.message);
	console.error('[api/opname-sesi]', e);
	throw error(500, e?.message || fallback);
}

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Data karyawan tidak ditemukan untuk akun ini.');
	try {
		const id = Number(event.url.searchParams.get('id'));
		if (id) return json({ success: true, ...(await getSesiLapangan(id)) });
		const [sesi, cfg] = await Promise.all([listSesiAktif(karyawan as any), readOpnameLapanganConfig()]);
		return json({ success: true, sesi, toleransi_pct: cfg.toleransiPct });
	} catch (e) {
		toHttp(e, 'Gagal memuat sesi opname.');
	}
};

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Data karyawan tidak ditemukan untuk akun ini.');
	const body = await event.request.json().catch(() => null);
	if (!body) throw error(400, 'Body tidak valid.');
	if (body.action !== 'count') throw error(400, `Aksi tidak dikenal: ${body.action}`);
	const id = Number(body.id);
	if (!id) throw error(400, 'id sesi wajib.');
	try {
		const res = await simpanHitungan(id, Array.isArray(body.entries) ? body.entries : [], karyawan.nama_karyawan);
		return json({ success: true, ...res });
	} catch (e) {
		toHttp(e, 'Gagal menyimpan hitungan.');
	}
};
