// src/lib/server/gates/komplainLockGate.ts
// SERVER-ONLY. Skema Ketidaksesuaian Pengiriman F2 — gate G_PROYEK_KOMPLAIN_LOCK.
// Barang yang sedang dikomplain (salah spek / rusak) di sebuah proyek tidak boleh dilaporkan terpakai di Laporan Harian
// sebelum Admin memutuskan disposisinya. Kunci PER BARANG PER PROYEK, bersumber dari barang_bermasalah_log baris komplain
// lapangan (batch_no 'KOMPLAIN:<SJ>', item_id terisi) berstatus open/in_review — lepas otomatis saat Selesai/Dikesampingkan.
//
// Mode dari gate_definitions + gate_enforcement (document_type 'laporan_harian') lewat resolveGateMode — diatur Superadmin di
// /settings/gates, TIDAK hardcode (CLAUDE.md #11). Anti-lockdown retroaktif (#3): gate lahir 'warn'; enforce_from di resolver
// menjepit ke 'shadow'; kunci hanya ada untuk komplain BARU (baris komplain lama tak punya item_id/penanda). Kegagalan baca
// data => fail-open (dilog), tidak pernah mengunci lapangan karena gangguan Directus.
//   shadow : tidak menahan, tidak memperingatkan (hanya jejak audit)
//   soft/warn : peringatan, lapangan boleh lanjut setelah konfirmasi
//   hard   : blokir

import { directusServerJson } from '$lib/server/directus';
import { resolveGateMode, type GateMode } from '$lib/server/gateDefinitionsMode';
import { KOMPLAIN_BATCH_PREFIX } from '$lib/server/goodsReceived/mismatchLog';

export const KOMPLAIN_LOCK_GATE_KEY = 'G_PROYEK_KOMPLAIN_LOCK';
export const KOMPLAIN_LOCK_DOCUMENT_TYPE = 'laporan_harian';

export interface KomplainLock {
	itemId: number;
	namaBarang: string;
	logId: number;
	jenis: string;
	nomorSj: string | null;
}

export type KomplainLockDecision = 'pass' | 'warn' | 'block';

export interface KomplainLockVerdict {
	mode: GateMode;
	decision: KomplainLockDecision;
	locks: KomplainLock[];
	message: string | null;
}

type Dx = (path: string, init?: any) => Promise<any>;

/** Murni: mode + daftar kunci -> keputusan. */
export function decideKomplainLock(mode: GateMode, locks: KomplainLock[]): KomplainLockVerdict {
	if (!locks.length) return { mode, decision: 'pass', locks, message: null };
	const nama = [...new Set(locks.map((l) => l.namaBarang))].slice(0, 5).join(', ');
	const base = `Barang berikut sedang dikomplain di proyek ini dan belum diputuskan disposisinya: ${nama}.`;
	if (mode === 'hard') {
		return { mode, decision: 'block', locks, message: `${base} Tidak bisa dipakai sampai Admin Gudang menyelesaikan atau mengesampingkan komplainnya.` };
	}
	if (mode === 'shadow') return { mode, decision: 'pass', locks, message: null };
	return { mode, decision: 'warn', locks, message: `${base} Sebaiknya jangan dipakai dulu — tunggu keputusan Admin Gudang.` };
}

/**
 * Cari kunci aktif untuk barang-barang (identitas_barang.id) di satu proyek. Satu query. null = gagal baca (fail-open, dilog).
 */
export async function findKomplainLocks(
	projectId: number,
	itemIds: number[],
	dx: Dx = directusServerJson
): Promise<KomplainLock[] | null> {
	const ids = [...new Set(itemIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
	if (!ids.length || !Number.isFinite(projectId)) return [];
	try {
		const q = new URLSearchParams({
			filter: JSON.stringify({
				_and: [
					{ project_id: { _eq: projectId } },
					{ item_id: { _in: ids } },
					{ status: { _in: ['open', 'in_review'] } },
					{ batch_no: { _starts_with: KOMPLAIN_BATCH_PREFIX } }
				]
			}),
			fields: 'id,item_id,nama_barang,jenis,batch_no',
			limit: '-1'
		});
		const res = await dx(`/items/barang_bermasalah_log?${q.toString()}`);
		return ((res?.data as any[]) || []).map((r) => ({
			itemId: Number(r.item_id),
			namaBarang: String(r.nama_barang || `Barang #${r.item_id}`),
			logId: Number(r.id),
			jenis: String(r.jenis || ''),
			nomorSj: String(r.batch_no || '').startsWith(KOMPLAIN_BATCH_PREFIX) ? String(r.batch_no).slice(KOMPLAIN_BATCH_PREFIX.length) : null
		}));
	} catch (e) {
		console.error('[komplainLockGate] gagal baca barang_bermasalah_log — gate dilewati (fail-open):', e instanceof Error ? e.message : e);
		return null;
	}
}

/** Evaluasi lengkap: kunci + mode. Gagal baca / gagal resolusi mode => pass (fail-open, dilog). */
export async function evaluateKomplainLock(projectId: number, itemIds: number[]): Promise<KomplainLockVerdict> {
	const locks = await findKomplainLocks(projectId, itemIds);
	const mode = await resolveGateMode(KOMPLAIN_LOCK_GATE_KEY, KOMPLAIN_LOCK_DOCUMENT_TYPE).catch((e) => {
		console.error('[komplainLockGate] gagal resolusi mode, pakai shadow:', e instanceof Error ? e.message : e);
		return 'shadow' as GateMode;
	});
	if (locks === null) return { mode, decision: 'pass', locks: [], message: null };
	return decideKomplainLock(mode, locks);
}
