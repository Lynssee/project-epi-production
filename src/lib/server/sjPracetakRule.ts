// src/lib/server/sjPracetakRule.ts
// SJH-07 §4.3 — aturan perekaman TTD pra-cetak gudang. Salinan setia dari
// erp-epi/src/lib/server/gates/sjPracetakRule.js — ubah keduanya bersamaan.

const isBlank = (v: unknown) => v == null || String(v).trim() === '' || String(v).trim() === '-';

export type PracetakDecision =
	| { action: 'write' }
	| { action: 'already'; existing: Record<string, any> }
	| { action: 'reject'; status: number; message: string };

export function decidePracetakAction(sj: {
	print_count?: number | string | null;
	reprint_status?: string | null;
	pracetak_gudang?: any;
	status?: string | null;
}): PracetakDecision {
	if (['cancelled', 'canceled', 'dibatalkan'].includes(String(sj?.status || '').toLowerCase())) {
		return { action: 'reject', status: 409, message: 'SJ sudah dibatalkan — TTD gudang tidak bisa direkam.' };
	}
	if (Number(sj?.print_count) >= 1 && sj?.reprint_status !== 'disetujui') {
		return { action: 'reject', status: 409, message: 'SJ sudah dicetak final — TTD pra-cetak tidak bisa direkam lagi tanpa izin cetak ulang.' };
	}
	let pg = sj?.pracetak_gudang;
	if (typeof pg === 'string') {
		try { pg = JSON.parse(pg); } catch { pg = null; }
	}
	if (pg && !isBlank(pg.by_name) && !isBlank(pg.at) && !(Number(sj?.print_count) >= 1)) {
		return { action: 'already', existing: pg };
	}
	return { action: 'write' };
}
