// src/lib/services/projectFinancePct.ts
// UPFE Fase 3 — klien status pagu RAP (persen saja) dari engine keuangan tunggal di admin, lewat proxy lokal.
// Cache modul 60 dtk per proyek. Gagal → null (pemanggil menampilkan fallback / "belum ada data", BUKAN 0%).
import { getIdToken } from './secureDirectus';

export type SafeSpendState = 'safe' | 'tight' | 'held' | 'locked' | 'unknown';

export interface FieldBudgetPct {
	status: 'ok' | 'unknown';
	/** Hanya ada bila diminta dengan nominal pengajuan (pre-flight): level & flag lewat, tanpa angka. */
	after?: { level: 'none' | 'safe' | 'warn' | 'danger'; over: boolean } | null;
	level: 'none' | 'safe' | 'warn' | 'danger';
	used_pct: number | null;
	actual_pct: number | null;
	commitment_pct: number | null;
	remaining_pct: number | null;
	/**
	 * Biaya Belum Terealisasi (dana tertahan di pusat: pengajuan/PL/akrual yang belum cair) — PERSEN terhadap RAP saja.
	 * `undefined` = fitur dimatikan di server (project.field_finance.show_unrealized=false); `null` = gagal terbaca.
	 */
	unrealized?: { pct: number | null; birokrasi_pct: number | null; pipeline_pct: number | null; item_count: number; names_enabled?: boolean } | null;
	safe_spend?: { state: SafeSpendState; projected_pct: number | null };
	thresholds: { warnPct: number; dangerPct: number };
	note: string;
	warnings: string[];
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; promise: Promise<FieldBudgetPct | null> }>();

export function fetchFieldBudgetPct(projectId: number | string, force = false): Promise<FieldBudgetPct | null> {
	const key = String(projectId);
	const hit = cache.get(key);
	if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.promise;
	const promise = (async () => {
		try {
			const token = await getIdToken();
			const res = await fetch(`/api/project-finance-pct/${key}${force ? '?force=1' : ''}`, { headers: { Authorization: `Bearer ${token}` } });
			const body = await res.json().catch(() => null);
			return body?.available ? (body.data as FieldBudgetPct) : null;
		} catch (e) {
			console.warn('[projectFinancePct] gagal:', e);
			return null;
		}
	})().then((v) => {
		if (v === null) cache.delete(key); // jangan cache kegagalan
		return v;
	});
	cache.set(key, { at: Date.now(), promise });
	return promise;
}

/** Pre-flight form pengajuan: tanpa cache (nominal berubah-ubah); pemanggil wajib men-debounce. Gagal → null. */
export async function previewFieldBudgetAfter(projectId: number | string, amount: number): Promise<FieldBudgetPct['after'] | null> {
	if (!(amount > 0)) return null;
	try {
		const token = await getIdToken();
		const res = await fetch(`/api/project-finance-pct/${projectId}?amount=${Math.round(amount)}`, { headers: { Authorization: `Bearer ${token}` } });
		const body = await res.json().catch(() => null);
		return body?.available ? (body.data?.after ?? null) : null;
	} catch {
		return null;
	}
}

// ── Fase 3b: daftar nama item yang tertahan di pusat (tanpa rupiah), dimuat HANYA saat Leader membukanya ──
export interface FieldPendingItem {
	id: string;
	channel: string;
	channel_label: string;
	kind: 'birokrasi' | 'pipeline';
	nomor_dokumen: string;
	judul: string;
	status_label: string;
	tahap: string | null;
	approver: string | null;
	age_hours: number | null;
	overdue: boolean;
	overdue_hours: number;
	qty_label: string | null;
	unpriced: boolean;
	/** true = PA Pending & fitur pengingat aktif → tampilkan tombol "Ingatkan approver". ref_id = id PA. */
	pingable?: boolean;
	ref_id?: number | null;
}

export interface FieldPendingItems {
	/** false = dimatikan Superadmin (project.field_finance.show_item_names) — tampilkan hanya persen. */
	enabled: boolean;
	items: FieldPendingItem[];
	total: number;
	truncated: boolean;
}

const itemsCache = new Map<string, { at: number; promise: Promise<FieldPendingItems | null> }>();

/** Gagal → null (pemanggil menampilkan "tidak dapat dimuat", BUKAN daftar kosong). Cache 60 dtk. */
export function fetchFieldPendingItems(projectId: number | string, force = false): Promise<FieldPendingItems | null> {
	const key = String(projectId);
	const hit = itemsCache.get(key);
	if (!force && hit && Date.now() - hit.at < TTL_MS) return hit.promise;
	const promise = (async () => {
		try {
			const token = await getIdToken();
			const res = await fetch(`/api/project-finance-pct/${key}/items${force ? '?force=1' : ''}`, { headers: { Authorization: `Bearer ${token}` } });
			const body = await res.json().catch(() => null);
			return body?.available ? (body.data as FieldPendingItems) : null;
		} catch (e) {
			console.warn('[projectFinancePct] gagal memuat daftar item:', e);
			return null;
		}
	})().then((v) => {
		if (v === null) itemsCache.delete(key);
		return v;
	});
	itemsCache.set(key, { at: Date.now(), promise });
	return promise;
}

// ── Pengingat approver (Fase 5): Leader mengingatkan approver yang sedang giliran atas satu PA yang tertahan ──
export interface PingResult {
	/** true = pengingat terkirim. false + reason = ditolak secara bisnis (cooldown dst.) → tampilkan pesan, bukan error teknis. */
	sent: boolean;
	reason?: string;
	retry_after_minutes?: number;
	recipients?: number;
	/** Hanya bila gagal teknis (jaringan/admin tidak terjangkau). */
	error?: string;
}

/** Tidak pernah melempar: kegagalan teknis dikembalikan sebagai { sent:false, error }. */
export async function pingApprover(projectId: number | string, paId: number): Promise<PingResult> {
	try {
		const token = await getIdToken();
		const res = await fetch(`/api/project-finance-pct/${projectId}/ping`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ pa_id: paId })
		});
		const body = await res.json().catch(() => null);
		if (!body?.available) return { sent: false, error: body?.reason || 'Pengingat tidak dapat dikirim saat ini.' };
		return body.data as PingResult;
	} catch (e) {
		console.warn('[projectFinancePct] gagal mengirim pengingat:', e);
		return { sent: false, error: 'Pengingat tidak dapat dikirim saat ini. Periksa koneksi lalu coba lagi.' };
	}
}
