import { error, isHttpError, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { directusServerJson } from '$lib/server/directus';
import { getPatrolControlSettings } from '$lib/server/patrolControlSettings';
import { resolveGateMode } from '$lib/server/gateDefinitionsMode';
import { writeGateAudit } from '$lib/server/gates/gateAudit';
import { evaluateKeyBorrowGate, hitungRencanaKembali, resolveKeyDispensation } from '$lib/server/gates/securityKeyGate';
import { casUpdateKey, createKeyLog, findKey, isNonaktif, truthy } from '$lib/server/keyService';
import { notifyKeyEmergencyAccess, notifyKeyIzinAtasan } from '$lib/server/keyNotify';

/**
 * Pinjam kunci di pos satpam (G_SEC8). Pengambilan atomik: status kunci diubah lewat CAS
 * (tersedia → dipinjam/overnight_ijin) sebelum log ditulis; bila log gagal ditulis, status dikembalikan.
 * shadow = hanya dicatat ke gate_audit_log; soft = 422 sampai `gate_sec8_reason` (min. N karakter) diisi;
 * hard = 400, kecuali `izin_atasan_id` (atasan langsung/fungsional peminjam) atau `darurat: true` + alasan
 * (jalur akses darurat, tercatat sebagai emergency_access dan diteruskan ke GA lewat WA).
 * Izin atasan setara alasan pada mode soft/shadow, dan atasan diberi tahu lewat WA agar bisa menyanggah.
 * Gagal membaca setelan/mode = fail-open ke default (tidak memblokir pos jaga).
 */
export const POST: RequestHandler = async (event) => {
	const { user, karyawan } = await authenticateEss(event);

	const body = await event.request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Data peminjaman kunci tidak valid.');
	const b = body as Record<string, unknown>;

	const key = await findKey({ keyId: b.key_id, scan: b.scan });
	if (!key) throw error(404, 'Kunci tidak ditemukan. Periksa QR atau kode kunci.');
	if (isNonaktif(key.is_active)) throw error(409, `${key.kode_kunci} sudah dinonaktifkan oleh GA.`);
	if (key.status === 'disimpan_khusus') {
		throw error(409, `${key.kode_kunci} disimpan khusus di brankas GA dan tidak untuk dipinjam di pos jaga.`);
	}
	if (key.status !== 'tersedia') {
		throw error(409, `${key.kode_kunci} tidak tersedia (status: ${key.status}). Jika kunci ada di tangan peminjam, proses pengembalian dulu.`);
	}

	const peminjamId = Number(b.peminjam_id);
	if (!Number.isInteger(peminjamId) || peminjamId <= 0) throw error(400, 'Pilih karyawan peminjam kunci.');
	const pRes = await directusServerJson<{ data: Array<{ id: number; status: string | null; nama_karyawan: string | null; atasan_id: number | null; atasan_fungsional_id: number | null }> }>(
		`/items/karyawan?${new URLSearchParams({ 'filter[id][_eq]': String(peminjamId), fields: 'id,status,nama_karyawan,atasan_id,atasan_fungsional_id', limit: '1' }).toString()}`
	);
	const peminjam = pRes?.data?.[0];
	if (!peminjam) throw error(404, 'Karyawan peminjam tidak ditemukan.');

	const catatan = String(b.catatan ?? '').trim() || null;
	const reason = String(b.gate_sec8_reason ?? '').trim();
	const darurat = b.darurat === true;
	const izinAtasanRaw = Number(b.izin_atasan_id);
	const izinAtasanId = Number.isInteger(izinAtasanRaw) && izinAtasanRaw > 0 ? izinAtasanRaw : null;

	const ps = await getPatrolControlSettings();
	const now = new Date();
	const waktu = hitungRencanaKembali({
		now,
		jamDefault: ps.secKeyJamKembaliDefault,
		diminta: typeof b.rencana_kembali === 'string' && b.rencana_kembali ? b.rencana_kembali : null
	});
	if (waktu.error) throw error(400, waktu.error);

	// --- G_SEC8 (titik gigit: pinjam) ---
	let audit: { decision: 'shadow' | 'warn'; reason: string | null; summary: string; violations: unknown } | null = null;
	let dispensasi = false;
	let izinAtasanDipakai: number | null = null;
	try {
		const mode = await resolveGateMode('G_SEC8', 'security_lifecycle');
		const verdict = evaluateKeyBorrowGate({
			namaKunci: `${key.kode_kunci} ${key.nama_kunci}`.trim(),
			isRestricted: truthy(key.is_restricted),
			now,
			bawaPulang: waktu.bawaPulang,
			options: { jamKerjaMulai: ps.secJamKerjaMulai, jamKerjaSelesai: ps.secJamKerjaSelesai }
		});
		if (!verdict.passed) {
			const disp = resolveKeyDispensation({
				reason,
				minAlasan: ps.secKeyMinAlasan,
				izinAtasanId,
				atasanIds: [peminjam.atasan_id, peminjam.atasan_fungsional_id],
				izinAtasanAktif: ps.secKeyIzinAtasanAktif
			});
			const alasanCukup = disp.alasanCukup;
			const snapshot = { key_id: key.id, kode: key.kode_kunci, peminjam_id: peminjamId, mode, darurat, izin_atasan_id: izinAtasanId, violations: verdict.violations };
			if (disp.izinAtasanDitolak) {
				throw error(
					422,
					ps.secKeyIzinAtasanAktif
						? 'Pemberi izin bukan atasan langsung/fungsional peminjam. Pilih atasan yang tertera, atau isi alasan.'
						: 'Izin atasan sedang tidak diterima oleh pengaturan. Isi alasan.'
				);
			}
			izinAtasanDipakai = disp.izinAtasanValid ? izinAtasanId : null;
			if (darurat) {
				if (!alasanCukup) throw error(422, `Akses darurat wajib alasan minimal ${ps.secKeyMinAlasan} karakter.`);
				audit = { decision: 'warn', reason, summary: verdict.summary, violations: verdict.violations };
				dispensasi = true;
			} else if (mode === 'hard' && !disp.izinAtasanValid) {
				await writeGateAudit({ gate: 'G_SEC8', collection: 'key_logs', recordId: null, decision: 'block', reason: verdict.summary, snapshot, email: user.email ?? null });
				throw error(400, `Peminjaman kunci ditolak: ${verdict.summary}. Minta izin atasan peminjam, atau gunakan jalur akses darurat bila memang mendesak.`);
			} else if (mode === 'soft' || mode === 'hard') {
				if (!disp.dispensasi) {
					throw error(422, `${verdict.summary}. Pilih izin atasan peminjam, atau isi alasan (minimal ${ps.secKeyMinAlasan} karakter) untuk tetap meminjamkan.`);
				}
				audit = { decision: 'warn', reason: reason || `Izin atasan karyawan #${izinAtasanId}`, summary: verdict.summary, violations: verdict.violations };
				dispensasi = true;
			} else {
				audit = { decision: 'shadow', reason: verdict.summary, summary: verdict.summary, violations: verdict.violations };
				dispensasi = disp.dispensasi;
			}
		}
	} catch (err) {
		if (isHttpError(err)) throw err;
		console.error('[kunci/pinjam] evaluasi G_SEC8 gagal, dilewati (fail-open):', err);
	}

	// "Darurat" hanya bermakna bila memang ada pelanggaran gate yang dilewati; tanpa itu diperlakukan sebagai pinjam biasa.
	const daruratDipakai = darurat && audit !== null;

	// Kunci yang dibawa pulang dengan dispensasi (alasan tercatat) ditandai overnight_ijin agar tidak menahan serah-terima shift.
	const statusBaru = waktu.bawaPulang && dispensasi ? 'overnight_ijin' : 'dipinjam';
	const berhasil = await casUpdateKey(key.id, ['tersedia'], { status: statusBaru, pemegang_sekarang_id: peminjamId });
	if (!berhasil) throw error(409, `${key.kode_kunci} baru saja diambil petugas lain. Muat ulang daftar kunci.`);

	let log;
	try {
		log = await createKeyLog({
			key_id: key.id,
			jenis_aksi: daruratDipakai ? 'emergency_access' : 'pinjam',
			peminjam_id: peminjamId,
			petugas_satpam_id: karyawan.id,
			waktu_pinjam: now.toISOString(),
			rencana_kembali: waktu.rencana.toISOString(),
			status_log: 'aktif',
			catatan,
			gate_override_reason: dispensasi ? reason || null : null,
			izin_atasan_id: izinAtasanDipakai
		});
	} catch (err) {
		console.error('[kunci/pinjam] gagal menulis key_logs, status kunci dikembalikan:', err);
		const dipulihkan = await casUpdateKey(key.id, [statusBaru], { status: 'tersedia', pemegang_sekarang_id: null }).catch((e) => {
			console.error('[kunci/pinjam] GAGAL memulihkan status kunci — perlu koreksi manual oleh GA:', key.id, e);
			return false;
		});
		throw error(500, dipulihkan ? 'Peminjaman gagal dicatat. Coba lagi.' : `Peminjaman gagal dicatat dan status ${key.kode_kunci} perlu dikoreksi GA.`);
	}

	if (audit) {
		await writeGateAudit({
			gate: 'G_SEC8',
			collection: 'key_logs',
			recordId: log.id,
			decision: audit.decision,
			reason: audit.reason,
			snapshot: { key_id: key.id, kode: key.kode_kunci, peminjam_id: peminjamId, darurat, summary: audit.summary, violations: audit.violations },
			email: user.email ?? null
		});
	}

	// WA fail-soft & tidak ditunggu: pos jaga tidak boleh tertahan oleh relay notifikasi.
	const namaSatpam = String((karyawan as any).nama_karyawan ?? `#${karyawan.id}`);
	const namaPeminjam = peminjam.nama_karyawan || `#${peminjamId}`;
	if (daruratDipakai) {
		void notifyKeyEmergencyAccess({ kode: key.kode_kunci, nama: key.nama_kunci, peminjamNama: namaPeminjam, satpamNama: namaSatpam, alasan: reason });
	}
	if (izinAtasanDipakai) {
		const rencanaTeks = waktu.rencana.toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
		void notifyKeyIzinAtasan({ atasanId: izinAtasanDipakai, kode: key.kode_kunci, nama: key.nama_kunci, peminjamNama: namaPeminjam, satpamNama: namaSatpam, rencanaKembali: rencanaTeks });
	}

	return json({
		log,
		status: statusBaru,
		rencana_kembali: waktu.rencana.toISOString(),
		gate: audit ? { decision: audit.decision, summary: audit.summary } : null
	});
};
