// src/lib/utils/fieldSafeSpend.ts
// Presentasi indikator Safe-Spend untuk Project Leader (PERSEN saja — tanpa rupiah, tanpa nama dokumen yang tertahan).
// State dihitung di server admin (computeSafeSpend, erp-epi); di sini hanya diterjemahkan ke label, nada, dan teks bantuan.
import type { FieldBudgetPct, SafeSpendState } from '$lib/services/projectFinancePct';

export interface SafeSpendView {
	state: SafeSpendState;
	label: string;
	tone: 'ok' | 'warn' | 'danger' | 'neutral';
	/** Kalimat utama, bahasa yang bisa ditindaklanjuti. */
	message: string;
	/** Penjelasan arti status (tooltip / teks bantuan). */
	hint: string;
	/** Rincian kecil: "Birokrasi 12% · Draft/Akrual 8% · 5 item". */
	detail: string | null;
}

const fmt = (n: number | null | undefined): string => (n == null || !Number.isFinite(n) ? '—' : `${Number(n).toFixed(1)}%`);

const HINT =
	'Safe-Spend menilai apakah pagu RAP masih aman dipakai membuat pengeluaran baru, dengan memperhitungkan dana yang masih tertahan di kantor pusat ' +
	'(pengajuan menunggu approval, Packing List, Surat Jalan belum bernilai, akrual alat & upah). Indikator memakai persen; nama item yang tertahan bisa dibuka lewat "Lihat daftar item tertahan" (tanpa nominal).';

/** @returns null bila fitur tidak aktif / data belum ada sehingga tidak ada yang perlu ditampilkan. */
export function buildSafeSpendView(pagu: FieldBudgetPct | null | undefined): SafeSpendView | null {
	if (!pagu || pagu.safe_spend === undefined) return null; // server mematikan fitur (atau pre-flight) → sembunyikan
	const ss = pagu.safe_spend;
	const un = pagu.unrealized ?? null;
	const detail = un
		? `Birokrasi ${fmt(un.birokrasi_pct)} · Draft/Akrual ${fmt(un.pipeline_pct)} · ${un.item_count} item`
		: null;

	switch (ss.state) {
		case 'safe':
			return {
				state: 'safe', tone: 'ok', label: 'Aman Digunakan',
				message: `Pagu efektif terpakai ${fmt(ss.projected_pct)} (sudah termasuk dana tertahan). Aman untuk pengeluaran berikutnya.`,
				hint: HINT, detail
			};
		case 'held':
			return {
				state: 'held', tone: 'warn', label: 'Tertahan di Pusat',
				message: `Ada pengajuan/akrual belum cair sebesar ${fmt(un?.pct)} dari RAP. Sisa pagu efektif menipis (terpakai ${fmt(ss.projected_pct)}).`,
				hint: HINT, detail
			};
		case 'tight':
			return {
				state: 'tight', tone: 'warn', label: 'Menipis',
				message: `Realisasi sudah ${fmt(ss.projected_pct)} dari RAP. Atur pengeluaran berikutnya dengan hati-hati.`,
				hint: HINT, detail
			};
		case 'locked':
			return {
				state: 'locked', tone: 'danger', label: 'Terkunci',
				message: `Bila seluruh dana tertahan cair, pagu terpakai ${fmt(ss.projected_pct)} (melewati RAP). Hubungi Admin/PM sebelum mengajukan pengeluaran baru.`,
				hint: HINT + ' Status ini hanya peringatan, bukan pemblokiran.', detail
			};
		default:
			return {
				state: 'unknown', tone: 'neutral', label: 'Belum Ada Data',
				message: pagu.status === 'ok'
					? 'Dana tertahan belum bisa dibaca saat ini. Angka realisasi di atas tetap berlaku.'
					: 'RAP proyek belum disusun, jadi sisa pagu belum bisa dinilai.',
				hint: HINT, detail: null
			};
	}
}

/**
 * Skenario terburuk Sisa Jatah: bila SEMUA dana tertahan cair. Persen saja.
 * @returns null bila data tidak lengkap (jangan menebak 0).
 */
export function worstCaseRemaining(pagu: FieldBudgetPct | null | undefined): { usedPct: number; remainingPct: number; over: boolean } | null {
	if (!pagu || pagu.status !== 'ok') return null;
	const projected = pagu.safe_spend?.projected_pct;
	if (projected == null || !Number.isFinite(projected)) return null;
	return { usedPct: projected, remainingPct: Math.round((100 - projected) * 100) / 100, over: projected > 100 };
}

/**
 * Posisi impas proyek (BEP) pada SKENARIO TERBURUK: seluruh dana tertahan di pusat cair sebagai biaya.
 * Rumus posisi sama dgn projectCostBehaviorApi: (tertagih − biaya terealisasi) ÷ overhead teralokasi (≥ 1 = di atas impas).
 * Nominal dana tertahan TIDAK dikirim ke lapangan (hanya persen terhadap RAP admin), jadi diperkirakan = persen × plafon RAP lokal
 * → hasilnya PERKIRAAN (basis RAP admin & lokal bisa sedikit beda, mis. budget Packing List). Hanya rasio/persen yang ditampilkan.
 * @returns null bila data tak cukup (tanpa overhead / tanpa RAP / dana tertahan tak terbaca) — jangan menebak.
 */
export function worstCasePositionVsBep(p: {
	contract_billed: number;
	variable_realized: number;
	overhead_allocated: number;
	rap_plafon: number;
	unrealized_pct: number | null | undefined;
}): { current: number; worst: number; dropPts: number; belowBep: boolean; crossesBep: boolean } | null {
	const { contract_billed, variable_realized, overhead_allocated, rap_plafon, unrealized_pct } = p || ({} as any);
	if (!(overhead_allocated > 0) || !(rap_plafon > 0)) return null;
	if (unrealized_pct == null || !Number.isFinite(unrealized_pct) || unrealized_pct < 0) return null;
	if (!Number.isFinite(contract_billed) || !Number.isFinite(variable_realized)) return null;
	const unrealizedEst = (unrealized_pct / 100) * rap_plafon;
	const current = (contract_billed - variable_realized) / overhead_allocated;
	const worst = (contract_billed - variable_realized - unrealizedEst) / overhead_allocated;
	return {
		current,
		worst,
		dropPts: Math.round((current - worst) * 100),
		belowBep: worst < 1,
		crossesBep: current >= 1 && worst < 1
	};
}

// ── Fase 3b: daftar nama item tertahan (tanpa rupiah) ──────────────────────────────────────────────

/** "baru saja" / "5 jam" / "3 hari" — bahasa ringkas untuk umur dokumen yang tertahan. null → "—". */
export function formatPendingAge(hours: number | null | undefined): string {
	if (hours == null || !Number.isFinite(hours) || hours < 0) return '—';
	if (hours < 1) return 'baru saja';
	if (hours < 48) return `${Math.floor(hours)} jam`;
	return `${Math.floor(hours / 24)} hari`;
}

/** Pisahkan per jenis: Birokrasi (sedang berjalan di pusat) vs Pipeline (belum diajukan / belum dibukukan). */
export function groupPendingItems<T extends { kind: 'birokrasi' | 'pipeline' }>(items: T[] | null | undefined): { birokrasi: T[]; pipeline: T[] } {
	const out = { birokrasi: [] as T[], pipeline: [] as T[] };
	for (const it of items ?? []) (it.kind === 'birokrasi' ? out.birokrasi : out.pipeline).push(it);
	return out;
}

// ── Fase 5: tombol "Ingatkan approver" ─────────────────────────────────────────────────────────────

export interface PingFeedback {
	tone: 'success' | 'info' | 'error';
	text: string;
	/** true = tombol dinonaktifkan sementara (sudah terkirim / cooldown / tidak berlaku lagi). */
	lock: boolean;
}

const fmtWait = (m: number): string => (m >= 120 ? `${Math.ceil(m / 60)} jam` : m >= 60 ? '1 jam' : `${Math.max(1, Math.round(m))} menit`);

/** Terjemahkan hasil pengingat (dari server) menjadi umpan balik singkat untuk Leader. Tidak melempar. */
export function describePingResult(r: { sent: boolean; reason?: string; retry_after_minutes?: number; recipients?: number; error?: string } | null | undefined): PingFeedback {
	if (!r) return { tone: 'error', text: 'Pengingat tidak dapat dikirim saat ini.', lock: false };
	if (r.sent) return { tone: 'success', text: `Pengingat terkirim ke ${r.recipients ?? 1} approver yang sedang giliran.`, lock: true };
	if (r.error) return { tone: 'error', text: r.error, lock: false }; // gagal teknis → boleh coba lagi
	switch (r.reason) {
		case 'cooldown':
			return { tone: 'info', text: `Pengingat sudah dikirim baru-baru ini. Bisa diingatkan lagi dalam ±${fmtWait(Number(r.retry_after_minutes) || 1)}.`, lock: true };
		case 'not_pending':
			return { tone: 'info', text: 'Pengajuan ini sudah tidak menunggu persetujuan.', lock: true };
		case 'no_request':
			return { tone: 'info', text: 'Pengajuan ini belum masuk alur persetujuan.', lock: true };
		case 'no_approver':
			return { tone: 'error', text: 'Belum ada approver aktif yang bisa diingatkan. Hubungi Admin.', lock: false };
		case 'history_unreadable':
			return { tone: 'error', text: 'Pengingat ditahan sementara (riwayat belum bisa diperiksa). Coba lagi nanti.', lock: false };
		case 'disabled':
			return { tone: 'info', text: 'Fitur pengingat dimatikan oleh Admin.', lock: true };
		case 'wrong_project':
		case 'not_found':
			return { tone: 'error', text: 'Pengajuan tidak ditemukan pada proyek ini.', lock: true };
		default:
			return { tone: 'error', text: 'Pengingat tidak dapat dikirim saat ini.', lock: false };
	}
}
