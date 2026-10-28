// src/routes/api/sji/[id]/dokumen/+server.ts
// e-Surat Jalan: pemohon (bukan cuma admin) bisa melihat/menerbitkan bukti approval SJI
// miliknya sendiri, untuk ditunjukkan (layar HP / discan) ke petugas gudang — menggantikan
// surat jalan kertas (permintaan user, 2026-08-03).
//
// GET: hanya pemilik SJI. Kalau sudah 'disetujui'/'sebagian_diserahkan', tampilkan token QR.
//
// Gap 2 (audit 2026-08-03): rotate-on-EVERY-view awalnya membingungkan — pemohon buka ulang
// halaman (mis. layar mati lalu dibuka lagi) sesaat sebelum gudang sempat scan, QR yang tadi
// ditunjukkan jadi tidak valid. Sekarang di-cache in-memory 30 menit (pola sama dengan
// verifyCache di firebaseAuth.ts) — buka-tutup berulang dalam jendela itu mengembalikan QR yang
// SAMA, tidak menulis ulang ke Directus. Token tetap rotate otomatis setelah 30 menit lewat,
// atau begitu item diserahkan (header pindah status keluar dari disetujui/sebagian_diserahkan).

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createHash, randomBytes } from 'node:crypto';
import { requireUser } from '$lib/server/firebaseAuth';
import { resolveKaryawanByEmail } from '$lib/server/ess/karyawan';
import { getKaryawanByFirebaseUid } from '$lib/server/approvalSubmit';
import { directusServerJson } from '$lib/server/directus';

async function resolveKaryawan(user: { localId: string; email: string }) {
	const byUid = await getKaryawanByFirebaseUid(user.localId).catch(() => null);
	if (byUid) return byUid;
	return resolveKaryawanByEmail(user.email);
}

function sha256Hex(value: string) {
	return createHash('sha256').update(value).digest('hex');
}

const TOKEN_CACHE_TTL_MS = 30 * 60 * 1000;
const tokenCache = new Map<number, { rawToken: string; hash: string; expiresAt: number }>();

export const GET: RequestHandler = async (event) => {
	const user = await requireUser(event);
	const karyawan = await resolveKaryawan(user);
	if (!karyawan) throw error(403, 'Akun ini belum tertaut ke data karyawan. Hubungi HRD.');

	const id = Number(event.params.id);
	if (!Number.isFinite(id)) throw error(400, 'ID tidak valid.');

	const headerRes = await directusServerJson<{ data: any }>(
		`/items/sji_header/${id}?fields=id,reference_no,status,urgency,keperluan,karyawan_id,approver,tanggal_approval,gudang_id.nama_gudang,date_created`
	).catch(() => null);
	const header = headerRes?.data;
	if (!header) throw error(404, 'SJI tidak ditemukan.');

	const ownerId = typeof header.karyawan_id === 'object' ? header.karyawan_id?.id : header.karyawan_id;
	if (ownerId !== karyawan.id) throw error(403, 'Anda tidak berhak melihat e-Surat Jalan ini.');

	if (header.status !== 'disetujui' && header.status !== 'sebagian_diserahkan') {
		return json({ available: false, status: header.status, reference_no: header.reference_no });
	}

	const idsFilter = encodeURIComponent(JSON.stringify({ sji_header_id: { _eq: id } }));
	const [pbRes, piRes] = await Promise.all([
		directusServerJson<{ data: any[] }>(
			`/items/pengeluaran_barang?filter=${idsFilter}&fields=id,item_id.nama_barang_lengkap,quantity,status&limit=-1`
		),
		directusServerJson<{ data: any[] }>(
			`/items/peminjaman_internal?filter=${idsFilter}&fields=id,item_id.nama_barang_lengkap,quantity,status&limit=-1`
		)
	]);
	const items = [
		...(pbRes?.data || []).map((r) => ({ ...r, tipe: 'ambil_pakai' as const })),
		...(piRes?.data || []).map((r) => ({ ...r, tipe: 'pinjam' as const }))
	];

	let rawToken: string;
	const cached = tokenCache.get(id);
	if (cached && cached.expiresAt > Date.now() && cached.hash === header.qr_token) {
		// Masih dalam jendela cache DAN belum ada yang menerbitkan token lain (mis. admin cetak
		// manual) sejak itu — pakai token yang sama, tidak perlu tulis ulang ke Directus.
		rawToken = cached.rawToken;
	} else {
		rawToken = randomBytes(24).toString('hex');
		const tokenHash = sha256Hex(rawToken);
		await directusServerJson(`/items/sji_header/${id}`, {
			method: 'PATCH',
			body: JSON.stringify({ qr_token: tokenHash })
		});
		tokenCache.set(id, { rawToken, hash: tokenHash, expiresAt: Date.now() + TOKEN_CACHE_TTL_MS });
	}

	return json({
		available: true,
		reference_no: header.reference_no,
		status: header.status,
		urgency: header.urgency,
		keperluan: header.keperluan,
		gudang: header.gudang_id?.nama_gudang || '-',
		approver: header.approver,
		tanggal_approval: header.tanggal_approval,
		items,
		qrPayload: `EPI:SJI:${id}:${rawToken}`
	});
};
