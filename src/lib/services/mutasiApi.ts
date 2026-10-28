// src/lib/services/mutasiApi.ts
// RSM-13 — klien e-SJ Mutasi untuk lapangan. Semua lewat /api/mutasi-barang (jembatan ke mesin di erp-epi); tidak ada
// logika status/approval di sini selain pemetaan tampilan (label, siapa boleh melihat tombol apa) — server tetap memutuskan.
import { getIdToken } from './secureDirectus';

export type MutasiItem = { id: number; item_id: number; nama: string; qty: number; unit: string | null; qty_diterima: number | null; alasan_selisih: string | null };
export type Mutasi = {
	id: number;
	nomor_mutasi: string;
	jenis: string;
	status: string;
	rute: 'langsung_site' | 'via_gudang';
	asal_tipe: string;
	asal_id: number;
	asal_nama: string;
	tujuan_tipe: string;
	tujuan_id: number;
	tujuan_nama: string;
	diajukan_oleh: number | null;
	alasan: string;
	items: MutasiItem[];
	langkah: { urut: number; total: number; role: string; label?: string; hint?: string } | null;
	aksi: string[];
	shipped_at?: string | null;
	riwayat?: Array<{ keputusan: string; oleh_nama?: string; waktu?: string; catatan?: string | null }>;
};

export const LABEL_STATUS: Record<string, string> = {
	diajukan: 'Menunggu persetujuan',
	disetujui_tujuan: 'Disetujui, siap dikirim',
	ditolak: 'Ditolak',
	dikirim: 'Dalam perjalanan',
	lolos_gerbang: 'Lolos gerbang',
	diterima: 'Diterima',
	diterima_sebagian: 'Diterima sebagian',
	batal: 'Dibatalkan'
};

async function authed<T>(path: string, init: RequestInit = {}): Promise<T> {
	const token = await getIdToken();
	const res = await fetch(path, {
		...init,
		headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers || {}) }
	});
	const text = await res.text();
	let parsed: any = null;
	try {
		parsed = text ? JSON.parse(text) : null;
	} catch {
		/* non-JSON */
	}
	if (!res.ok) throw new Error(parsed?.message || `Permintaan gagal (${res.status})`);
	return parsed as T;
}

export const getMutasiStatus = () => authed<{ tersedia: boolean; alasan: string | null; projectIds: number[] }>('/api/mutasi-barang/status');

export async function listMutasi(opts: { projectId?: number | null; aktif?: boolean } = {}): Promise<{ data: Mutasi[]; aktor: { karyawanId: number; projectIds: number[] } }> {
	const q = new URLSearchParams();
	if (opts.projectId) q.set('project_id', String(opts.projectId));
	if (opts.aktif === false) q.set('aktif', '0');
	return authed(`/api/mutasi-barang${q.toString() ? `?${q}` : ''}`);
}

export type AjukanInput = {
	jenis: 'proyek_ke_proyek';
	asal_id: number;
	tujuan_id: number;
	rute: 'langsung_site' | 'via_gudang';
	alasan: string;
	items: Array<{ item_id: number; qty: number }>;
	client_txn_id: string;
	alasan_gate?: string;
};
export const ajukanMutasi = (input: AjukanInput) => authed<{ success: boolean; data: Mutasi; idempoten: boolean; peringatan?: string[] }>('/api/mutasi-barang', { method: 'POST', body: JSON.stringify(input) });

export type AksiMutasi = 'setujui' | 'tolak' | 'kirim' | 'terima' | 'batal';
export const aksiMutasi = (id: number, aksi: AksiMutasi, body: Record<string, unknown> = {}) =>
	authed<{ success: boolean; data: Mutasi }>(`/api/mutasi-barang/${id}/aksi`, { method: 'POST', body: JSON.stringify({ ...body, aksi }) });

/** item_id → qty terkunci mutasi (belum berangkat) pada proyek; kegagalan dicatat & dianggap kosong (tidak memblokir layar). */
export async function getQtyTerkunci(projectId: number): Promise<Record<number, number>> {
	try {
		const r = await authed<{ terkunci: Record<string, number> }>(`/api/mutasi-barang/terkunci?project_id=${projectId}`);
		return Object.fromEntries(Object.entries(r.terkunci || {}).map(([k, v]) => [Number(k), Number(v) || 0]));
	} catch (e) {
		console.error('[mutasiApi] qty terkunci tak terbaca (dianggap 0):', e);
		return {};
	}
}

// ── Murni (diuji) ─────────────────────────────────────────────────────────────

/** Tombol aksi yang MASUK AKAL untuk pengguna ini (server tetap memutuskan hak). */
export function aksiUntukSaya(m: Pick<Mutasi, 'aksi' | 'status' | 'asal_tipe' | 'asal_id' | 'tujuan_tipe' | 'tujuan_id' | 'diajukan_oleh' | 'langkah' | 'rute'>, me: { karyawanId: number; projectIds: number[] }): AksiMutasi[] {
	const p = new Set(me.projectIds.map(Number));
	const diAsal = m.asal_tipe === 'project' && p.has(Number(m.asal_id));
	const diTujuan = m.tujuan_tipe === 'project' && p.has(Number(m.tujuan_id));
	const pengaju = Number(m.diajukan_oleh) === Number(me.karyawanId);
	const out: AksiMutasi[] = [];
	for (const a of m.aksi || []) {
		if ((a === 'setujui' || a === 'tolak') && m.langkah?.role === 'proyek_tujuan' && diTujuan) out.push(a); // pengaju yang juga memimpin tujuan: server menjawab SELF_APPROVAL + jalur eskalasi
		else if (a === 'kirim' && (diAsal || pengaju)) out.push(a);
		else if (a === 'terima' && diTujuan && !(m.rute === 'via_gudang' && m.status === 'dikirim')) out.push(a);
		else if (a === 'batal' && (pengaju || diAsal)) out.push(a);
	}
	return out;
}

/** Perlu tindakan saya = ada minimal satu aksi selain 'batal'. */
export const perluTindakanSaya = (m: Parameters<typeof aksiUntukSaya>[0], me: { karyawanId: number; projectIds: number[] }): boolean =>
	aksiUntukSaya(m, me).some((a) => a !== 'batal');

/** Saldo yang boleh dimutasi = saldo − terkunci pengajuan lain (tidak negatif). */
export const qtyBolehDimutasi = (saldo: number, terkunci: number): number => Math.max(0, (Number(saldo) || 0) - (Number(terkunci) || 0));

/** Validasi ringan di klien (server tetap yang berwenang). Mengembalikan pesan error atau null. */
export function validasiFormAjukan(f: { asal: number | ''; tujuan: number | ''; alasan: string; items: Array<{ item_id: number; qty: number; maks: number }> }): string | null {
	if (!f.asal) return 'Pilih proyek asal.';
	if (!f.tujuan) return 'Pilih proyek tujuan.';
	if (f.asal === f.tujuan) return 'Proyek tujuan tidak boleh sama dengan proyek asal.';
	if (!f.items.length) return 'Pilih minimal satu barang.';
	const lebih = f.items.find((i) => !(i.qty > 0) || i.qty > i.maks + 0.0001);
	if (lebih) return 'Jumlah tiap barang harus > 0 dan tidak melebihi saldo yang tersedia.';
	if (f.alasan.trim().length < 20) return 'Alasan wajib diisi minimal 20 karakter.';
	return null;
}
