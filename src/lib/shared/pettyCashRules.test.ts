import { describe, it, expect } from 'vitest';
import { checkRequestAgainstFund, collectDecisionNotes, duplicateWindowStartIso } from './pettyCashRules';

describe('checkRequestAgainstFund (BUG-01, PUT/POST lapangan)', () => {
	const fund = { id: 1, fund_name: 'Dana Inventory', status: 'ACTIVE', ceiling_per_transaksi: '1000000' };
	it('lolos ≤ ceiling', () => {
		expect(checkRequestAgainstFund(fund, 1_000_000)).toBeNull();
	});
	it('tolak > ceiling & arahkan ke Pengajuan Anggaran', () => {
		expect(checkRequestAgainstFund(fund, 1_000_001)).toMatch(/Pengajuan Anggaran/);
	});
	it('tolak fund nonaktif / tidak ada', () => {
		expect(checkRequestAgainstFund({ ...fund, status: 'SUSPENDED' }, 1000)).toMatch(/tidak aktif/);
		expect(checkRequestAgainstFund(null, 1000)).toMatch(/tidak ditemukan/);
	});
	it('ceiling kosong = tanpa batas', () => {
		expect(checkRequestAgainstFund({ ...fund, ceiling_per_transaksi: null }, 9e9)).toBeNull();
	});
});

describe('collectDecisionNotes (BUG-15)', () => {
	it('menampilkan catatan revisi dari ketiga peran', () => {
		const n = collectDecisionNotes({
			atasan_action: 'revisi', atasan_note: 'Nota buram',
			finance_action: 'revisi', finance_note: 'Lampirkan NPWP',
			kasir_action: 'revisi', kasir_note: 'Nominal tak cocok'
		});
		expect(n.map((x) => x.role)).toEqual(['atasan', 'finance', 'kasir']);
	});
	it('tiket lapangan lama (tanpa atasan_action) tetap menampilkan atasan_note saat revisi', () => {
		const n = collectDecisionNotes({ status: 'revisi', atasan_note: 'Foto kurang jelas' });
		expect(n).toEqual([{ role: 'atasan', label: 'Atasan', text: 'Foto kurang jelas' }]);
	});
	it('atasan_note pada tiket yang disetujui bukan alasan masalah', () => {
		expect(collectDecisionNotes({ status: 'menunggu_kasir', atasan_action: 'approved', atasan_note: 'oke' })).toEqual([]);
	});
	it('tanpa dobel dengan reject_reason & aman untuk null', () => {
		const n = collectDecisionNotes({ status: 'rejected', atasan_action: 'rejected', atasan_note: 'Tidak sesuai', reject_reason: 'Tidak sesuai' });
		expect(n).toHaveLength(1);
		expect(collectDecisionNotes(null)).toEqual([]);
	});
});

describe('duplicateWindowStartIso', () => {
	it('10 menit ke belakang', () => {
		const now = new Date('2026-09-21T10:00:00.000Z');
		expect(duplicateWindowStartIso(now, 10)).toBe('2026-09-21T09:50:00.000Z');
	});
});

import { isPettyCashWriteBlocked, isPettyCashReadBlocked } from './pettyCashRules';
describe('isPettyCashWriteBlocked (SEC-01)', () => {
	it('menolak tulis ke tiket, log, dan saldo fund', () => {
		for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) {
			expect(isPettyCashWriteBlocked('items/petty_cash_requests/9', m)).toBe(true);
			expect(isPettyCashWriteBlocked('items/petty_cash_request_logs', m)).toBe(true);
			expect(isPettyCashWriteBlocked('items/petty_cash_funds/1', m)).toBe(true);
		}
	});
	it('PC3-05: tulis ke kategori, aturan kategori, period_close juga ditolak', () => {
		for (const c of ['petty_cash_categories', 'petty_cash_category_rules', 'petty_cash_period_close']) {
			for (const m of ['POST', 'PATCH', 'PUT', 'DELETE']) expect(isPettyCashWriteBlocked(`items/${c}/1`, m)).toBe(true);
		}
	});
	it('PC3-05: path dengan slash awal / huruf besar tetap diblok; nama mirip tidak', () => {
		expect(isPettyCashWriteBlocked('/items/PETTY_CASH_FUNDS/5', 'patch')).toBe(true);
		expect(isPettyCashWriteBlocked('items/petty_cash_fundsX', 'PATCH')).toBe(false);
		expect(isPettyCashWriteBlocked('items/petty_cash_funds_archive/1', 'PATCH')).toBe(false);
	});
	it('PC3-05: baca (GET/HEAD) koleksi kas kecil diblok; koleksi lain & tulis tidak terkena blok baca', () => {
		for (const m of ['GET', 'HEAD', 'get']) {
			expect(isPettyCashReadBlocked('items/petty_cash_requests', m)).toBe(true);
			expect(isPettyCashReadBlocked('items/petty_cash_funds/5', m)).toBe(true);
			expect(isPettyCashReadBlocked('items/reports', m)).toBe(false);
		}
		expect(isPettyCashReadBlocked('items/petty_cash_requests', 'PATCH')).toBe(false);
	});
	it('GET & koleksi lain lolos untuk guard TULIS', () => {
		expect(isPettyCashWriteBlocked('items/petty_cash_requests', 'GET')).toBe(false);
		expect(isPettyCashWriteBlocked('items/petty_cash_requests_archive', 'POST')).toBe(false);
		expect(isPettyCashWriteBlocked('items/reports', 'POST')).toBe(false);
	});
});

describe('collectDecisionNotes — LPJ dikembalikan kasir (PC3-13, kontrak identik dengan admin)', () => {
	it('menampilkan catatan pengembalian LPJ hanya saat status LPJ revisi', () => {
		const r = collectDecisionNotes({ status: 'posted', advance_settlement_status: 'revisi', lpj_reject_note: 'Nota bensin belum dilampirkan' });
		expect(r).toEqual([{ role: 'kasir_lpj', label: 'LPJ dikembalikan kasir', text: 'Nota bensin belum dilampirkan' }]);
	});
	it('catatan usang (LPJ sudah dikirim ulang / selesai) tidak ditampilkan', () => {
		expect(collectDecisionNotes({ advance_settlement_status: 'lpj_diajukan', lpj_reject_note: 'lama' })).toEqual([]);
		expect(collectDecisionNotes({ advance_settlement_status: 'selesai', lpj_reject_note: 'lama' })).toEqual([]);
	});
	it('spasi saja → kosong; tidak mengganggu catatan tahap lain', () => {
		expect(collectDecisionNotes({ advance_settlement_status: 'revisi', lpj_reject_note: '   ' })).toEqual([]);
		const both = collectDecisionNotes({ kasir_action: 'revisi', kasir_note: 'x', advance_settlement_status: 'revisi', lpj_reject_note: 'y' });
		expect(both.map((n) => n.role)).toEqual(['kasir', 'kasir_lpj']);
	});
});

// ── PC3-14 — kontrak aturan LPJ: tabel IDENTIK dengan erp-epi pettyCashPolicy.test.js ──────────────────────────
import { effectiveRulesMode, evaluateLpjRules, isLpjOutlier } from './pettyCashRules';

describe('evaluateLpjRules — kontrak dengan admin (Q-H)', () => {
	it('wajib bukti bila realisasi ≥ ambang & tanpa lampiran', () => {
		expect(evaluateLpjRules({ advance: 500000, settlement: 150000, buktiCount: 0, wajibBuktiDiatas: 100000 })[0].code).toBe('LPJ_BUKTI');
		expect(evaluateLpjRules({ advance: 500000, settlement: 150000, buktiCount: 1, wajibBuktiDiatas: 100000 })).toEqual([]);
		expect(evaluateLpjRules({ advance: 500000, settlement: 50000, buktiCount: 0, wajibBuktiDiatas: 100000 })).toEqual([]);
	});
	it('kelebihan melewati batas % butuh alasan', () => {
		const r = { advance: 100000, settlement: 130000, buktiCount: 1, maxOveragePct: 20 };
		expect(evaluateLpjRules(r)[0].code).toBe('LPJ_OVERAGE');
		expect(evaluateLpjRules({ ...r, overageReason: 'Harga naik mendadak' })).toEqual([]);
		expect(evaluateLpjRules({ ...r, settlement: 110000 })).toEqual([]);
	});
	it('batas 0/kosong = nonaktif', () => {
		expect(evaluateLpjRules({ advance: 100000, settlement: 900000, buktiCount: 1, maxOveragePct: 0 })).toEqual([]);
	});
});

describe('effectiveRulesMode — kontrak dengan admin', () => {
	it('hard hanya berlaku sejak enforce_from; mode tak dikenal = shadow', () => {
		expect(effectiveRulesMode('hard', '2026-10-01', '2026-09-29')).toBe('shadow');
		expect(effectiveRulesMode('hard', '2026-10-01', '2026-10-01')).toBe('hard');
		expect(effectiveRulesMode('hard', null, '2026-09-29')).toBe('hard');
		expect(effectiveRulesMode('off', null, '2026-09-29')).toBe('off');
		expect(effectiveRulesMode('aneh', null, '2026-09-29')).toBe('shadow');
		expect(effectiveRulesMode(undefined, null, '2026-09-29')).toBe('shadow');
	});
});

describe('isLpjOutlier — 1%–150% uang muka (kontrak dengan admin)', () => {
	it('batas dan salah ketik', () => {
		expect(isLpjOutlier(800000, 650)).toBe(true); // "650.000" terbaca 650
		expect(isLpjOutlier(800000, 8000)).toBe(false); // tepat 1%
		expect(isLpjOutlier(800000, 7999)).toBe(true);
		expect(isLpjOutlier(800000, 1200000)).toBe(false); // tepat 150%
		expect(isLpjOutlier(800000, 1200001)).toBe(true);
		expect(isLpjOutlier(800000, 650000)).toBe(false);
		expect(isLpjOutlier(0, 999999)).toBe(false); // tanpa acuan uang muka → tak dinilai
	});
});

// ── PC3-15 — kontrak dengan erp-epi pettyCashUi.test.js ─────────────────────────────────────────────────────
import { businessDaysSince, waitingInfo, oldestWaitDays, extractDelegatedFrom } from './pettyCashRules';

describe('waitingInfo / oldestWaitDays (PC3-15)', () => {
	const NOW = new Date('2026-09-29T05:00:00Z'); // Selasa
	it('hari kerja: Jumat → Selasa = 2', () => expect(businessDaysSince('2026-09-25T05:00:00Z', NOW)).toBe(2));
	it('label hanya untuk tiket yang sedang menunggu seseorang, ≥ 1 hari kerja', () => {
		expect(waitingInfo({ status: 'menunggu_atasan', date_updated: '2026-09-25T05:00:00Z' }, NOW)).toEqual({ days: 2, label: 'Menunggu atasan 2 hari kerja · pengingat otomatis dikirim' });
		expect(waitingInfo({ status: 'menunggu_kasir', date_updated: '2026-09-28T05:00:00Z' }, NOW)?.label).toMatch(/^Menunggu kasir 1 hari kerja/);
		expect(waitingInfo({ status: 'menunggu_atasan', date_updated: NOW.toISOString() }, NOW)).toBeNull();
		expect(waitingInfo({ status: 'posted', date_updated: '2026-09-01T00:00:00Z' }, NOW)).toBeNull();
		expect(waitingInfo({ status: 'menunggu_kasir', hold_reason: 'saldo_kurang', date_updated: '2026-09-01T00:00:00Z' }, NOW)).toBeNull();
	});
	it('umur tertua antrean', () => {
		expect(oldestWaitDays([{ date_updated: '2026-09-28T05:00:00Z' }, { date_updated: '2026-09-24T05:00:00Z' }], NOW)).toBe(3);
		expect(oldestWaitDays([], NOW)).toBe(0);
	});
});

describe('extractDelegatedFrom (kontrak dengan admin)', () => {
	it('log terbaru menang; meta string JSON / objek; submit ulang tanpa delegasi menghapus jejak', () => {
		const m = extractDelegatedFrom([
			{ request_id: 1, meta: '{"delegated_from":5}' },
			{ request_id: 2, meta: { delegated_from: 6 } },
			{ request_id: 2, meta: null },
			{ request_id: 3, meta: 'rusak{' }
		]);
		expect(m.get('1')).toBe(5);
		expect(m.get('2')).toBeNull();
		expect(m.get('3')).toBeNull();
	});
});

import { resolveImprestProject } from './pettyCashRules';

describe('resolveImprestProject (PRJ-22)', () => {
	const imprest = { fund_type: 'project_imprest', project_id: 976, fund_name: 'Dana Kerja X' };
	it('dana biasa: proyek mengikuti isian pemohon', () => {
		expect(resolveImprestProject({ fund_type: null }, 12)).toEqual({ projectId: 12 });
		expect(resolveImprestProject(undefined, null)).toEqual({ projectId: null });
	});
	it('imprest: proyek dikunci ke fund.project_id (kosong atau sama)', () => {
		expect(resolveImprestProject(imprest, null)).toEqual({ projectId: 976 });
		expect(resolveImprestProject(imprest, 976)).toEqual({ projectId: 976 });
	});
	it('imprest: proyek lain ditolak; dana tanpa project_id ditolak', () => {
		expect(resolveImprestProject(imprest, 5).error).toContain('hanya untuk satu proyek');
		expect(resolveImprestProject({ fund_type: 'project_imprest', project_id: null }, null).error).toContain('belum terikat');
	});
});

import { canUseFund } from './pettyCashRules';

describe('canUseFund (PRJ-22)', () => {
	const imprest = { fund_type: 'project_imprest', custodian_karyawan_id: 14, backup_custodian_karyawan_id: { id: 20 } };
	it('dana biasa terbuka untuk semua', () => expect(canUseFund({ fund_type: null }, 5)).toBe(true));
	it('imprest hanya untuk pemegang (utama/cadangan)', () => {
		expect(canUseFund(imprest, 14)).toBe(true);
		expect(canUseFund(imprest, 20)).toBe(true);
		expect(canUseFund(imprest, 99)).toBe(false);
		expect(canUseFund(imprest, null)).toBe(false);
	});
});

describe('alur tiket dana kerja proyek — skenario lengkap (PRJ-22 Tahap A)', () => {
	const fund = {
		id: 201, fund_name: 'Dana Kerja Gresik', status: 'ACTIVE', ceiling_per_transaksi: 1_000_000,
		fund_type: 'project_imprest', project_id: 976, custodian_karyawan_id: 14, backup_custodian_karyawan_id: null
	};
	// urutan server (POST /api/ess/petty-cash): batas dana -> hak pakai -> kunci proyek
	const submit = (karyawanId: number, amount: number, requestedProject: number | null) => {
		const msg = checkRequestAgainstFund(fund, amount);
		if (msg) return { ok: false, why: msg };
		if (!canUseFund(fund, karyawanId)) return { ok: false, why: 'bukan pemegang' };
		const pr = resolveImprestProject(fund, requestedProject);
		if (pr.error) return { ok: false, why: pr.error };
		return { ok: true, projectId: pr.projectId };
	};
	it('Leader pemegang: proyek otomatis walau form kosong', () => {
		expect(submit(14, 250_000, null)).toEqual({ ok: true, projectId: 976 });
	});
	it('Leader pemegang memilih proyek lain: ditolak', () => {
		expect(submit(14, 250_000, 12).ok).toBe(false);
	});
	it('Leader lain: ditolak sebelum urusan proyek', () => {
		expect(submit(99, 250_000, 976)).toEqual({ ok: false, why: 'bukan pemegang' });
	});
	it('nominal melewati batas per transaksi dana: ditolak dengan arahan ke PA', () => {
		const r = submit(14, 1_500_000, null);
		expect(r.ok).toBe(false);
		expect(r.why).toContain('Pengajuan Anggaran');
	});
	it('dana nonaktif: ditolak', () => {
		expect(checkRequestAgainstFund({ ...fund, status: 'SUSPENDED' }, 100_000)).toContain('tidak aktif');
	});
});
