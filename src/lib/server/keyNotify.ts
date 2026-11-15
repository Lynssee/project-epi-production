// src/lib/server/keyNotify.ts
// Notifikasi WA Key Management (G_SEC8) — relay lewat notif-dispatch erp-epi (tercatat di notification_log,
// tunduk kill-switch). Semua fail-soft: gagal kirim TIDAK boleh menggagalkan transaksi kunci di pos jaga.
// Penerima GA = fleet_notify_recipients peran 'ga_hrd' (daftar yang sama dengan notifikasi Fleet; diatur di ERP).
// Pengingat kunci TERLAMBAT tidak lewat sini: dikirim endpoint erp-epi /api/automation/kunci-overdue.

import { fetchNotifyRecipients, relayNotifyDispatch } from '$lib/server/fleetNotify';

const lbl = (kode: string, nama: string) => `${kode} ${nama}`.trim();

/** Kunci diambil lewat jalur akses darurat (melewati gate) — GA/HRD perlu tahu. */
export async function notifyKeyEmergencyAccess(p: { kode: string; nama: string; peminjamNama: string; satpamNama: string; alasan: string }): Promise<boolean> {
	try {
		const recipients = await fetchNotifyRecipients('ga_hrd');
		if (recipients.length === 0) {
			console.warn('[keyNotify] fleet_notify_recipients kosong untuk peran ga_hrd — notif akses darurat kunci TIDAK terkirim.');
			return false;
		}
		const message = `🚨 AKSES DARURAT KUNCI\n${lbl(p.kode, p.nama)} diambil oleh ${p.peminjamNama} (dilayani satpam ${p.satpamNama}) lewat jalur darurat.\nAlasan: ${p.alasan}\nTinjau di ERP > GA > Manajemen Kunci > Riwayat.`;
		return await relayNotifyDispatch({ eventType: 'security_key_emergency_access', message, waRecipients: recipients });
	} catch (e) {
		console.warn('[keyNotify] Gagal kirim notifikasi akses darurat kunci:', e);
		return false;
	}
}

/** Satpam mencatat izin atasan (kunci terbatas / bawa pulang) — atasan diberi tahu agar bisa menyanggah bila tidak benar. */
export async function notifyKeyIzinAtasan(p: { atasanId: number; kode: string; nama: string; peminjamNama: string; satpamNama: string; rencanaKembali: string }): Promise<boolean> {
	try {
		const message = `🔑 Izin Anda dicatat untuk kunci ${lbl(p.kode, p.nama)}: dipinjam ${p.peminjamNama}, batas kembali ${p.rencanaKembali}. Dicatat satpam ${p.satpamNama}. Bila Anda TIDAK memberi izin ini, segera hubungi GA.`;
		return await relayNotifyDispatch({ eventType: 'security_key_izin_atasan', message, waKaryawanIds: [p.atasanId] });
	} catch (e) {
		console.warn('[keyNotify] Gagal kirim notifikasi izin atasan kunci:', e);
		return false;
	}
}

/** Kunci dikembalikan dalam kondisi rusak/hilang — GA menindaklanjuti (status log: investigasi). */
export async function notifyKeyHilangRusak(p: { kode: string; nama: string; kondisi: 'rusak' | 'hilang'; catatan: string; pemegangNama: string | null }): Promise<boolean> {
	try {
		const recipients = await fetchNotifyRecipients('ga_hrd');
		if (recipients.length === 0) {
			console.warn('[keyNotify] fleet_notify_recipients kosong untuk peran ga_hrd — notif kunci hilang/rusak TIDAK terkirim.');
			return false;
		}
		const message = `⚠️ KUNCI ${p.kondisi.toUpperCase()}\n${lbl(p.kode, p.nama)} dilaporkan ${p.kondisi}${p.pemegangNama ? ` (pemegang terakhir ${p.pemegangNama})` : ''}.\nCatatan: ${p.catatan}\nTindak lanjuti di ERP > GA > Manajemen Kunci > Riwayat (status Investigasi).`;
		return await relayNotifyDispatch({ eventType: 'security_key_hilang_rusak', message, waRecipients: recipients });
	} catch (e) {
		console.warn('[keyNotify] Gagal kirim notifikasi kunci hilang/rusak:', e);
		return false;
	}
}
