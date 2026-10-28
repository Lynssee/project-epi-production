// src/lib/utils/dispensasiStatus.ts
// Tampilan status permintaan dispensasi gate milik sendiri (MURNI, tanpa I/O).
export type DispensasiStatus = 'menunggu' | 'disetujui' | 'ditolak';

const INFO: Record<DispensasiStatus, { icon: string; label: string; tone: string; hint: string }> = {
	menunggu: { icon: '🕓', label: 'Menunggu keputusan', tone: 'amber', hint: 'GM/Direktur belum memutuskan.' },
	disetujui: { icon: '✅', label: 'Disetujui', tone: 'green', hint: 'Tekan Cek Ulang di halaman pengajuan.' },
	ditolak: { icon: '❌', label: 'Ditolak', tone: 'red', hint: '' }
};

/** Status tak dikenal diperlakukan sebagai menunggu (aman: tidak menjanjikan persetujuan). */
export function dispensasiStatusInfo(status: string | null | undefined) {
	return INFO[(status as DispensasiStatus) in INFO ? (status as DispensasiStatus) : 'menunggu'];
}

/** Ambil N permintaan terbaru; yang masih menunggu selalu di depan. */
export function pickRecentRequests<T extends { id: number; status?: string }>(rows: T[] | null | undefined, n = 5): T[] {
	const list = [...(rows || [])];
	list.sort((a, b) => Number(b.status === 'menunggu') - Number(a.status === 'menunggu') || b.id - a.id);
	return list.slice(0, n);
}
