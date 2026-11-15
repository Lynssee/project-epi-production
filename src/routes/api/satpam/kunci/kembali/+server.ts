import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { casUpdateKey, fetchKaryawanNames, findActiveLog, findKey, updateKeyLog } from '$lib/server/keyService';
import { notifyKeyHilangRusak } from '$lib/server/keyNotify';

const KONDISI = ['lengkap_baik', 'rusak', 'hilang'] as const;

/**
 * Kembalikan kunci ke slot. Satu baris key_logs = satu peminjaman: baris aktif ditutup (waktu_kembali, status_log).
 * kondisi `rusak`/`hilang` → status kunci ikut berubah dan log masuk `investigasi` (GA menindaklanjuti).
 */
export const POST: RequestHandler = async (event) => {
	const { karyawan } = await authenticateEss(event);

	const body = await event.request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Data pengembalian kunci tidak valid.');
	const b = body as Record<string, unknown>;

	const key = await findKey({ keyId: b.key_id, scan: b.scan });
	if (!key) throw error(404, 'Kunci tidak ditemukan. Periksa QR atau kode kunci.');

	const kondisi = String(b.kondisi_fisik || 'lengkap_baik');
	if (!KONDISI.includes(kondisi as (typeof KONDISI)[number])) throw error(400, 'Kondisi fisik kunci tidak valid.');
	const catatan = String(b.catatan ?? '').trim();
	if (kondisi !== 'lengkap_baik' && catatan.length < 10) {
		throw error(422, 'Kunci rusak/hilang wajib catatan (minimal 10 karakter) agar GA bisa menindaklanjuti.');
	}

	if (key.status !== 'dipinjam' && key.status !== 'overnight_ijin') {
		throw error(409, `${key.kode_kunci} sudah berada di slot (status: ${key.status}).`);
	}

	const statusBaru = kondisi === 'hilang' ? 'hilang' : kondisi === 'rusak' ? 'rusak' : 'tersedia';
	const berhasil = await casUpdateKey(key.id, ['dipinjam', 'overnight_ijin'], { status: statusBaru, pemegang_sekarang_id: null });
	if (!berhasil) throw error(409, `${key.kode_kunci} baru saja diproses petugas lain. Muat ulang daftar kunci.`);

	// Kunci rusak/hilang: GA diberi tahu lewat WA (fail-soft, tidak ditunggu).
	if (kondisi === 'rusak' || kondisi === 'hilang') {
		void fetchKaryawanNames([key.pemegang_sekarang_id])
			.then((names) =>
				notifyKeyHilangRusak({
					kode: key.kode_kunci,
					nama: key.nama_kunci,
					kondisi,
					catatan,
					pemegangNama: key.pemegang_sekarang_id ? (names.get(key.pemegang_sekarang_id) ?? null) : null
				})
			)
			.catch((e) => console.warn('[kunci/kembali] notifikasi kunci hilang/rusak gagal:', e));
	}

	const log = await findActiveLog(key.id);
	if (!log) {
		// Kunci kembali tetapi tidak ada log aktif (data lama/koreksi manual): jangan menggagalkan pengembalian fisik.
		console.warn(`[kunci/kembali] ${key.kode_kunci} dikembalikan tanpa log aktif (status kunci tetap dipulihkan).`);
		return json({ status: statusBaru, log: null, peringatan: 'Tidak ada catatan peminjaman aktif untuk kunci ini.' });
	}
	await updateKeyLog(log.id, {
		waktu_kembali: new Date().toISOString(),
		status_log: statusBaru === 'tersedia' ? 'selesai' : 'investigasi',
		kondisi_fisik: kondisi,
		catatan: [log.catatan, catatan ? `[Kembali: ${catatan}]` : '', `[Diterima satpam #${karyawan.id}]`].filter(Boolean).join(' ')
	});

	return json({ status: statusBaru, log_id: log.id });
};
