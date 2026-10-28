import { describe, it, expect } from 'vitest';
import { buildSafeSpendView, worstCaseRemaining } from './fieldSafeSpend';
import type { FieldBudgetPct } from '$lib/services/projectFinancePct';

const base: FieldBudgetPct = {
	status: 'ok', level: 'safe', used_pct: 40, actual_pct: 40, commitment_pct: 0, remaining_pct: 60,
	thresholds: { warnPct: 80, dangerPct: 100 }, note: '', warnings: []
};
const withSS = (state: any, projected: number | null, un: any = { pct: 30, birokrasi_pct: 20, pipeline_pct: 10, item_count: 5 }): FieldBudgetPct =>
	({ ...base, unrealized: un, safe_spend: { state, projected_pct: projected } });

describe('buildSafeSpendView', () => {
	it('fitur mati / pre-flight (safe_spend tidak ada) → null (tidak tampil)', () => {
		expect(buildSafeSpendView(base)).toBeNull();
		expect(buildSafeSpendView(null)).toBeNull();
	});
	it('safe → hijau "Aman Digunakan"', () => {
		const v = buildSafeSpendView(withSS('safe', 70))!;
		expect(v.label).toBe('Aman Digunakan');
		expect(v.tone).toBe('ok');
		expect(v.detail).toBe('Birokrasi 20.0% · Draft/Akrual 10.0% · 5 item');
	});
	it('held → "Tertahan di Pusat" dengan kalimat dari spek', () => {
		const v = buildSafeSpendView(withSS('held', 85))!;
		expect(v.label).toBe('Tertahan di Pusat');
		expect(v.message).toContain('Ada pengajuan/akrual belum cair sebesar 30.0% dari RAP');
		expect(v.message).toContain('Sisa pagu efektif menipis');
	});
	it('locked → merah, peringatan bukan pemblokiran', () => {
		const v = buildSafeSpendView(withSS('locked', 130))!;
		expect(v.tone).toBe('danger');
		expect(v.hint).toContain('bukan pemblokiran');
	});
	it('tight → Menipis tanpa menyebut dana tertahan', () => {
		const v = buildSafeSpendView(withSS('tight', 85, null))!;
		expect(v.label).toBe('Menipis');
		expect(v.detail).toBeNull();
	});
	it('unknown: RAP ada tapi komitmen gagal → pesan jujur, BUKAN aman', () => {
		const v = buildSafeSpendView(withSS('unknown', null, null))!;
		expect(v.tone).toBe('neutral');
		expect(v.message).toContain('belum bisa dibaca');
	});
	it('unknown: RAP belum disusun', () => {
		const v = buildSafeSpendView({ ...withSS('unknown', null, null), status: 'unknown' })!;
		expect(v.message).toContain('RAP proyek belum disusun');
	});
	it('tidak pernah memuat angka rupiah', () => {
		const v = buildSafeSpendView(withSS('held', 85))!;
		expect(JSON.stringify(v)).not.toMatch(/Rp\s?\d/);
	});
});

describe('worstCaseRemaining', () => {
	it('menghitung sisa bila semua dana tertahan cair', () => {
		expect(worstCaseRemaining(withSS('held', 85))).toEqual({ usedPct: 85, remainingPct: 15, over: false });
	});
	it('melewati 100% → over true, sisa negatif', () => {
		expect(worstCaseRemaining(withSS('locked', 130))).toEqual({ usedPct: 130, remainingPct: -30, over: true });
	});
	it('data tak lengkap → null (bukan 0)', () => {
		expect(worstCaseRemaining(null)).toBeNull();
		expect(worstCaseRemaining(base)).toBeNull();
		expect(worstCaseRemaining(withSS('unknown', null, null))).toBeNull();
		expect(worstCaseRemaining({ ...withSS('safe', 50), status: 'unknown' })).toBeNull();
	});
});

import { formatPendingAge, groupPendingItems } from './fieldSafeSpend';

describe('formatPendingAge', () => {
	it('format ringkas', () => {
		expect(formatPendingAge(0.2)).toBe('baru saja');
		expect(formatPendingAge(5.9)).toBe('5 jam');
		expect(formatPendingAge(47)).toBe('47 jam');
		expect(formatPendingAge(72)).toBe('3 hari');
	});
	it('tidak diketahui → "—" (bukan 0)', () => {
		expect(formatPendingAge(null)).toBe('—');
		expect(formatPendingAge(undefined)).toBe('—');
		expect(formatPendingAge(-3)).toBe('—');
		expect(formatPendingAge(NaN)).toBe('—');
	});
});

import { describePingResult, worstCasePositionVsBep } from './fieldSafeSpend';

describe('worstCasePositionVsBep', () => {
	// tertagih 1.000, biaya 400, overhead 500, RAP 2.000 → posisi sekarang 1,2x (di atas impas)
	const base = { contract_billed: 1000, variable_realized: 400, overhead_allocated: 500, rap_plafon: 2000 };

	it('dana tertahan 10% RAP (≈200) menurunkan posisi 1,2 → 0,8 dan menembus impas', () => {
		const r = worstCasePositionVsBep({ ...base, unrealized_pct: 10 })!;
		expect(r.current).toBeCloseTo(1.2);
		expect(r.worst).toBeCloseTo(0.8);
		expect(r.dropPts).toBe(40);
		expect(r.belowBep).toBe(true);
		expect(r.crossesBep).toBe(true);
	});
	it('dana tertahan kecil tetap di atas impas', () => {
		const r = worstCasePositionVsBep({ ...base, unrealized_pct: 2 })!;
		expect(r.worst).toBeCloseTo(1.12);
		expect(r.belowBep).toBe(false);
		expect(r.crossesBep).toBe(false);
	});
	it('sudah di bawah impas → belowBep true tapi crossesBep false', () => {
		const r = worstCasePositionVsBep({ ...base, contract_billed: 600, unrealized_pct: 5 })!;
		expect(r.current).toBeCloseTo(0.4);
		expect(r.crossesBep).toBe(false);
		expect(r.belowBep).toBe(true);
	});
	it('dana tertahan 0% → posisi tidak berubah (0 poin)', () => {
		expect(worstCasePositionVsBep({ ...base, unrealized_pct: 0 })!.dropPts).toBe(0);
	});
	it('data tak cukup → null (tanpa overhead, tanpa RAP, dana tertahan tak terbaca/negatif)', () => {
		expect(worstCasePositionVsBep({ ...base, overhead_allocated: 0, unrealized_pct: 10 })).toBeNull();
		expect(worstCasePositionVsBep({ ...base, rap_plafon: 0, unrealized_pct: 10 })).toBeNull();
		expect(worstCasePositionVsBep({ ...base, unrealized_pct: null })).toBeNull();
		expect(worstCasePositionVsBep({ ...base, unrealized_pct: undefined })).toBeNull();
		expect(worstCasePositionVsBep({ ...base, unrealized_pct: -5 })).toBeNull();
		expect(worstCasePositionVsBep({ ...base, contract_billed: NaN, unrealized_pct: 5 })).toBeNull();
		expect(worstCasePositionVsBep(null as any)).toBeNull();
	});
});

describe('describePingResult', () => {
	it('terkirim → sukses & tombol terkunci', () => {
		expect(describePingResult({ sent: true, recipients: 2 })).toEqual({ tone: 'success', text: 'Pengingat terkirim ke 2 approver yang sedang giliran.', lock: true });
	});
	it('cooldown → info dengan sisa waktu terbaca, terkunci', () => {
		const f = describePingResult({ sent: false, reason: 'cooldown', retry_after_minutes: 360 });
		expect(f.tone).toBe('info');
		expect(f.lock).toBe(true);
		expect(f.text).toContain('6 jam');
		expect(describePingResult({ sent: false, reason: 'cooldown', retry_after_minutes: 40 }).text).toContain('40 menit');
	});
	it('gagal teknis → error & BOLEH coba lagi (tidak terkunci)', () => {
		expect(describePingResult({ sent: false, error: 'Tidak dapat menghubungi admin saat ini.' })).toMatchObject({ tone: 'error', lock: false });
		expect(describePingResult({ sent: false, reason: 'history_unreadable' }).lock).toBe(false);
		expect(describePingResult({ sent: false, reason: 'no_approver' }).lock).toBe(false);
	});
	it('alasan bisnis permanen → terkunci', () => {
		for (const reason of ['not_pending', 'no_request', 'disabled', 'wrong_project']) expect(describePingResult({ sent: false, reason }).lock).toBe(true);
	});
	it('null / alasan tak dikenal aman', () => {
		expect(describePingResult(null)).toMatchObject({ tone: 'error', lock: false });
		expect(describePingResult({ sent: false, reason: 'aneh' })).toMatchObject({ tone: 'error', lock: false });
	});
});

describe('groupPendingItems', () => {
	it('memisahkan birokrasi vs pipeline, urutan asli dipertahankan', () => {
		const g = groupPendingItems([{ kind: 'pipeline', n: 1 }, { kind: 'birokrasi', n: 2 }, { kind: 'birokrasi', n: 3 }]);
		expect(g.birokrasi.map((i: any) => i.n)).toEqual([2, 3]);
		expect(g.pipeline.map((i: any) => i.n)).toEqual([1]);
	});
	it('null aman', () => {
		expect(groupPendingItems(null)).toEqual({ birokrasi: [], pipeline: [] });
	});
});
