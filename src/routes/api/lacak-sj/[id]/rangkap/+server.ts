// src/routes/api/lacak-sj/[id]/rangkap/+server.ts
// Gate Ketat Surat Jalan v3 — Fase 5 (20 Sep 2026, sisi lapangan). Konfirmasi
// penyerahan lembar wajib_kembali (Putih=finance, Pink=admin_peminjam) ke driver
// sebelum berangkat (§4 dok rencana: "Pop-up konfirmasi sebelum supir pergi").
//   GET  → lembar wajib_kembali SJ ini yang masih status 'dicetak' (belum
//          dikonfirmasi diserahkan) — dipakai layar Lacak SJ untuk tahu perlu
//          menampilkan pop-up atau tidak (kategori tanpa lembar wajib_kembali = N/A,
//          tidak pernah menampilkan pop-up).
//   POST → tandai SEMUA lembar wajib_kembali SJ ini yang masih 'dicetak' -> 'diserahkan'.

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/projectLeaderGuard';
import { listRangkapForSj, advanceRangkapStatus } from '$lib/server/rangkap';

async function pendingWajibKembali(sjId: string) {
	const rows = await listRangkapForSj(sjId);
	return rows.filter((r) => r.wajib_kembali && r.status === 'dicetak');
}

export const GET: RequestHandler = async (event) => {
	await requireUser(event);
	const sjId = event.params.id as string;
	try {
		const pending = await pendingWajibKembali(sjId);
		return json({ pending: pending.map((r) => ({ id: r.id, lembar_nama: r.lembar_nama, warna_hex: r.warna_hex })) });
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Gagal memuat rangkap SJ');
	}
};

export const POST: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const sjId = event.params.id as string;
	const karyawan = await resolveKaryawanByEmail(user.email).catch(() => null);
	const actorName = karyawan?.nama_karyawan || user.email || null;

	try {
		const pending = await pendingWajibKembali(sjId);
		const results = [];
		for (const row of pending) {
			results.push(await advanceRangkapStatus(row.id, 'diserahkan', actorName));
		}
		return json({ success: true, updated: results.length });
	} catch (e) {
		throw error(400, e instanceof Error ? e.message : 'Gagal mencatat penyerahan lembar');
	}
};
