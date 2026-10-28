// src/lib/server/gates/plFieldGates.ts
// SERVER-ONLY. Path A — Audit & Hardening Gate Approval v2 (30 Agu 2026), Fase F0.
//
// Alur "packing list" dashboard lapangan (project-epi) = sekumpulan baris
// `project_budgets` ber-`packing_status`, BUKAN koleksi `packing_list` milik admin.
// Karena itu hanya 2 dari 13 gate PL (lihat erp-epi-1/src/lib/server/gates/plGates.js)
// yang punya input di alur ini:
//
//   G_PKL_PROJECT (hard)      — tiap baris wajib `project_id` valid, proyek tidak
//                               berstatus selesai/closed/cancelled. Ini SATU-SATUNYA gate yang
//                               memblokir submit dari lapangan.
//   G_PKL_STOK    (peringatan) — baris bertaut `identitas_barang_id`: bila stok < qty,
//                               tampilkan peringatan. TIDAK pernah memblokir dari
//                               lapangan (keputusan Path A / Q1 lanjutan) — Gudang yang
//                               menindaklanjuti kekurangan.
//
// Gate lain (TUJUAN, KLASIFIKASI pinjam/habis-pakai, RETURN_DATE, LAMPIRAN, SJ_LINK,
// dst.) STRUKTURAL tidak bisa dipenuhi di sini — form lapangan tidak pernah menangkap
// alamat/PIC tujuan, klasifikasi pinjam, tanggal kembali, dll. Gate-gate itu tetap
// ditegakkan di form admin (PackingListForm.svelte + /api/packing-list/validate).
//
// Doktrin sama dengan plGates.js: data kosong = 'not_applicable', bukan 'failed'.
// `overrideAllowed` (super admin ATAU GM jabatan_id=4) mengubah G_PKL_PROJECT yang
// gagal dari blocking jadi peringatan yang ditandai `overridden` (untuk pencatatan).

// WAJIB identik dengan PROJECT_STATUS_INACTIVE di erp-epi-1/src/lib/server/gates/plGates.js
// (dijaga test kontrak lintas repo di erp-epi-1: plGates.crossRepoContract.test.js).
// 'cancelled' ditambahkan 9 Okt 2026: proyek dibatalkan (20 proyek) sebelumnya lolos gate.
// Aman terhadap Aturan #3: gate hanya mengevaluasi pengajuan BARU; saat ditambahkan tidak ada
// item PL aktif (requested/queued/notified/approved/partial/draft) di proyek berstatus cancelled.
import { isPaintItem, cleanColor } from '$lib/shared/paintColorUtils';

const PROJECT_STATUS_INACTIVE = ['selesai', 'closed', 'cancelled'];
const num = (v: any) => parseFloat(v ?? 0) || 0;

export interface FieldPLRow {
	id: number;
	project_id: number | null;
	qty: number;
	identitas_barang_id?: number | null;
	material_name?: string | null;
	material_color?: string | null;
	/** Hanya tersedia untuk baris project_budgets asli (Jalur 1) — item baru/template
	 *  (Jalur 2) tidak membawa flag ini, jadi baris tsb DIKECUALIKAN dari G_PKL_INVENTORY_LINK
	 *  (lebih aman under-warn daripada salah tandai jasa/kas/manpower sebagai "belum tertaut"). */
	no_item_needed?: boolean;
	is_manpower?: boolean;
}

export interface FieldPLCtx {
	rows: FieldPLRow[];
	/** projectId (string) -> projects.status; `undefined`/`null` = tidak ditemukan */
	projectStatusById: Map<string, string | null | undefined>;
	/** identitas_barang_id (string) -> stok_tersedia (number) */
	stockById: Map<string, number>;
}

export interface FieldGate {
	gate_key: string;
	label: string;
	severity: 'WAJIB' | 'SEMI';
	status: 'passed' | 'failed' | 'not_applicable';
	message: string;
	overridden?: boolean;
	/** G_PKL_INVENTORY_LINK — baris project_budgets yang belum tertaut identitas_barang_id,
	 *  dipakai wizard untuk menampilkan tombol "Usulkan Tautan" per baris (Aksi Benahi C). */
	affected_items?: Array<{ id: number; label: string }>;
	/** Gate disiplin proyek (lihat plDisiplinFieldGates.ts) — tautan perbaikan cepat ke halaman lapangan. */
	fix_links?: Array<{ label: string; href: string }>;
}

export interface FieldPLResult {
	gates: FieldGate[];
	status: 'passed' | 'soft_warning' | 'blocked';
	blocking: string[];
	warnings: string[];
	overridden: string[];
	override_allowed: boolean;
}

export function evaluateFieldPLGates(
	ctx: FieldPLCtx,
	opts: { overrideAllowed?: boolean } = {}
): FieldPLResult {
	const overrideAllowed = !!opts.overrideAllowed;
	const rows = ctx.rows || [];
	const gates: FieldGate[] = [];
	const blocking: string[] = [];
	const warnings: string[] = [];
	const overridden: string[] = [];

	// ---------- G_PKL_PROJECT (hard) ----------
	{
		const problems: string[] = [];
		const missingId = rows.filter((r) => !r.project_id);
		if (missingId.length) problems.push(`${missingId.length} baris tanpa proyek`);

		const projIds = [...new Set(rows.map((r) => r.project_id).filter(Boolean).map(String))];
		for (const pid of projIds) {
			const st = ctx.projectStatusById.get(pid);
			if (st === undefined || st === null) {
				problems.push(`proyek #${pid} tidak ditemukan`);
				continue;
			}
			if (PROJECT_STATUS_INACTIVE.includes(String(st).toLowerCase())) {
				problems.push(`proyek #${pid} berstatus "${st}" (tidak aktif)`);
			}
		}

		if (problems.length) {
			const base =
				`Tautan/status proyek bermasalah: ${problems.join('; ')}. ` +
				`Pastikan item diajukan dari proyek yang benar dan proyeknya masih aktif. ` +
				`Bila ini kiriman retensi proyek yang sudah closed, minta Admin/Finance membuka status proyek.`;
			if (overrideAllowed) {
				gates.push({
					gate_key: 'G_PKL_PROJECT',
					label: 'Tautan & status proyek',
					severity: 'SEMI',
					status: 'failed',
					message: `${base} — DILEWATI (override super admin/GM)`,
					overridden: true
				});
				overridden.push('G_PKL_PROJECT');
			} else {
				gates.push({
					gate_key: 'G_PKL_PROJECT',
					label: 'Tautan & status proyek',
					severity: 'WAJIB',
					status: 'failed',
					message: base
				});
				blocking.push('G_PKL_PROJECT');
			}
		} else {
			gates.push({
				gate_key: 'G_PKL_PROJECT',
				label: 'Tautan & status proyek',
				severity: 'WAJIB',
				status: rows.length ? 'passed' : 'not_applicable',
				message: rows.length ? 'Semua baris tertaut proyek aktif' : 'Belum ada item'
			});
		}
	}

	// ---------- G_PKL_STOK (peringatan saja) ----------
	{
		const linked = rows.filter((r) => r.identitas_barang_id);
		const short: string[] = [];
		for (const r of linked) {
			const stok = ctx.stockById.get(String(r.identitas_barang_id));
			if (stok == null) continue; // stok tak diketahui -> jangan tebak
			if (stok < num(r.qty)) {
				short.push(`${r.material_name || `item #${r.id}`} (butuh ${num(r.qty)}, stok ${stok})`);
			}
		}
		if (short.length) {
			gates.push({
				gate_key: 'G_PKL_STOK',
				label: 'Stok mencukupi',
				severity: 'SEMI',
				status: 'failed',
				message:
					`Stok kurang untuk ${short.length} item: ${short.slice(0, 5).join(', ')}` +
					`${short.length > 5 ? `, +${short.length - 5} lainnya` : ''}. ` +
					`Pengajuan tetap bisa dikirim — Gudang memproses pemenuhan sebagian/kekurangannya.`
			});
			warnings.push('G_PKL_STOK');
		} else {
			gates.push({
				gate_key: 'G_PKL_STOK',
				label: 'Stok mencukupi',
				severity: 'SEMI',
				status: linked.length ? 'passed' : 'not_applicable',
				message: linked.length
					? 'Stok mencukupi untuk item yang bertaut master barang'
					: 'Tidak ada item bertaut master barang — stok tidak dicek'
			});
		}
	}

	// ---------- G_PKL_INVENTORY_LINK (Hard Block — Fase 2) ----------
	// Seluruh item fisik di Packing List WAJIB tertaut SKU Master Barang (identitas_barang_id).
	// Pengajuan ditolak langsung bila ada item fisik yang belum tertaut.
	{
		const isTruth = (v: any) => v === true || v === 1 || v === '1' || v === 'true';
		const unlinked = rows.filter((r) => !isTruth(r.no_item_needed) && !isTruth(r.is_manpower) && !r.identitas_barang_id);
		if (unlinked.length > 0) {
			gates.push({
				gate_key: 'G_PKL_INVENTORY_LINK',
				label: 'Tautan barang master',
				severity: 'WAJIB',
				status: 'failed',
				message:
					`[Hard Block] ${unlinked.length} item belum tertaut ke Master Barang: ` +
					`${unlinked.slice(0, 5).map((r) => r.material_name || `item #${r.id}`).join(', ')}` +
					`${unlinked.length > 5 ? `, +${unlinked.length - 5} lainnya` : ''}. ` +
					`Seluruh item Packing List wajib tertaut ke master barang sebelum pengajuan dapat dikirim.`,
				affected_items: unlinked.map((r) => ({ id: r.id, label: r.material_name || `Item #${r.id}` }))
			});
			blocking.push('G_PKL_INVENTORY_LINK');
		} else if (rows.length > 0) {
			gates.push({
				gate_key: 'G_PKL_INVENTORY_LINK',
				label: 'Tautan barang master',
				severity: 'WAJIB',
				status: 'passed',
				message: 'Semua item fisik sudah tertaut barang master'
			});
		}
	}

	// ---------- G_PKL_CAT_WARNA (Standarisasi Cat & Spesifikasi Warna) ----------
	{
		const paintWithoutColor = rows.filter(
			(r) => isPaintItem(r.material_name || '') && !cleanColor(r.material_color)
		);
		if (paintWithoutColor.length > 0) {
			const names = paintWithoutColor.slice(0, 5).map((r) => r.material_name || `item #${r.id}`).join(', ');
			const extra = paintWithoutColor.length > 5 ? `, +${paintWithoutColor.length - 5} lainnya` : '';
			const base =
				`Item cat wajib memiliki spesifikasi warna yang jelas: ${names}${extra}. ` +
				`Pilih dari katalog warna standar atau cantumkan "Clear / Bening" untuk cat transparan.`;
			if (overrideAllowed) {
				gates.push({
					gate_key: 'G_PKL_CAT_WARNA',
					label: 'Spesifikasi warna cat',
					severity: 'SEMI',
					status: 'failed',
					message: `${base} — DILEWATI (override super admin/GM)`,
					overridden: true,
					affected_items: paintWithoutColor.map((r) => ({ id: r.id, label: r.material_name || `Item #${r.id}` }))
				});
				overridden.push('G_PKL_CAT_WARNA');
			} else {
				gates.push({
					gate_key: 'G_PKL_CAT_WARNA',
					label: 'Spesifikasi warna cat',
					severity: 'WAJIB',
					status: 'failed',
					message: base,
					affected_items: paintWithoutColor.map((r) => ({ id: r.id, label: r.material_name || `Item #${r.id}` }))
				});
				blocking.push('G_PKL_CAT_WARNA');
			}
		} else {
			gates.push({
				gate_key: 'G_PKL_CAT_WARNA',
				label: 'Spesifikasi warna cat',
				severity: 'WAJIB',
				status: rows.length ? 'passed' : 'not_applicable',
				message: rows.length ? 'Semua item cat telah memiliki spesifikasi warna' : 'Belum ada item'
			});
		}
	}

	const status = blocking.length ? 'blocked' : warnings.length ? 'soft_warning' : 'passed';
	return { gates, status, blocking, warnings, overridden, override_allowed: overrideAllowed };
}

/**
 * Resolusi konteks (status proyek + stok) untuk sekumpulan baris, lalu evaluasi.
 * `directusServerJson` di-inject supaya modul ini tetap murni & gampang diuji.
 */
export async function evaluateFieldPLGatesFor(
	rows: FieldPLRow[],
	directusServerJson: (path: string, init?: any) => Promise<any>,
	opts: { overrideAllowed?: boolean } = {}
): Promise<FieldPLResult> {
	const projIds = [...new Set(rows.map((r) => r.project_id).filter(Boolean).map(String))];
	const idbIds = [...new Set(rows.map((r) => r.identitas_barang_id).filter(Boolean).map(String))];

	// Kegagalan lookup TIDAK boleh ditelan jadi { data: [] }:
	//  - status proyek (gate memblokir): gagal ambil != "proyek tidak ditemukan". Dilempar dengan
	//    pesan yang jujur supaya user tidak diblokir dengan alasan menyesatkan dan IT melihat penyebab
	//    sebenarnya. Pemanggil (submit/create-items) menerjemahkannya jadi error ke user; pra-cek
	//    (gate-precheck) tetap fail-open di klien.
	//  - stok (hanya peringatan): dilog jelas lalu dilewati — stok tak diketahui = tidak dicek.
	const lookup = async (label: string, path: string, fatal: boolean) => {
		try {
			return await directusServerJson(path);
		} catch (e: any) {
			console.error(`[plFieldGates] Gagal mengambil ${label} dari Directus:`, e);
			if (fatal) {
				throw new Error(
					`Gagal memverifikasi ${label} (gangguan koneksi/query Directus, bukan kesalahan data pengajuan): ${e?.message || e}. Coba lagi sebentar lagi.`
				);
			}
			return { data: [] };
		}
	};

	const [projRes, stockRes] = await Promise.all([
		projIds.length
			? lookup('status proyek', `/items/projects?filter[id][_in]=${projIds.join(',')}&fields=id,status&limit=-1`, true)
			: Promise.resolve({ data: [] }),
		idbIds.length
			? lookup('stok barang', `/items/identitas_barang?filter[id][_in]=${idbIds.join(',')}&fields=id,stok_tersedia&limit=-1`, false)
			: Promise.resolve({ data: [] })
	]);

	const projectStatusById = new Map<string, string | null>();
	for (const p of projRes?.data || []) projectStatusById.set(String(p.id), p.status ?? null);

	const stockById = new Map<string, number>();
	for (const it of stockRes?.data || []) stockById.set(String(it.id), parseFloat(it.stok_tersedia) || 0);

	return evaluateFieldPLGates({ rows, projectStatusById, stockById }, opts);
}
