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
// `overrideAllowed` (super admin ATAU GM jabatan_id=4) mengubah gate mode hard yang
// gagal dari blocking jadi peringatan yang ditandai `overridden` (untuk pencatatan).
//
// Mode tiap gate di file ini mengikuti Kalibrasi Gate di erp-epi (gate_definitions +
// gate_enforcement jenis 'PL'), dipasok lewat `resolveMode` — CLAUDE.md Aturan #11.
//   shadow      : tidak tampil & tidak memblokir, dicatat di `shadowed`.
//   soft / warn : peringatan, pengajuan tetap terkirim.
//   hard        : memblokir; super admin/GM menembus sebagai peringatan `overridden`.
// G_PKL_STOK tetap maksimal peringatan walau diset hard: keputusan Path A, Gudang yang
// menindaklanjuti kekurangan stok.

// WAJIB identik dengan PROJECT_STATUS_INACTIVE di erp-epi-1/src/lib/server/gates/plGates.js
// (dijaga test kontrak lintas repo di erp-epi-1: plGates.crossRepoContract.test.js).
// 'cancelled' ditambahkan 9 Okt 2026: proyek dibatalkan (20 proyek) sebelumnya lolos gate.
// Aman terhadap Aturan #3: gate hanya mengevaluasi pengajuan BARU; saat ditambahkan tidak ada
// item PL aktif (requested/queued/notified/approved/partial/draft) di proyek berstatus cancelled.
import { isPaintItem, cleanColor } from '$lib/shared/paintColorUtils';
import type { GateMode } from '$lib/utils/gateModeResolver';
import type { FieldCoverage } from './plFieldCoverageLoader';
import { evaluateCoverage, evaluateRunRate, evaluateSiteStockRecon } from '$lib/shared/materialCoverageEngine';

const PROJECT_STATUS_INACTIVE = ['selesai', 'closed', 'cancelled'];
const num = (v: any) => parseFloat(v ?? 0) || 0;
export const isTruth = (v: any) => v === true || v === 1 || v === '1' || v === 'true';

// Gate Rasionalitas Qty (4 Nov 2026, Fase 4): COVERAGE_M2, TIMELINE_RUNRATE, SITE_STOCK_RECON. G_PKL_RAB_QUOTA SENGAJA tidak ada di sisi
// lapangan: baris pengajuan lapangan = baris RAB itu sendiri (dibandingkan dengan dirinya sendiri), kuota RAB ditegakkan di sisi admin.
// needed_date tidak ditangkap form lapangan => pemeriksaan jendela jadwal (bagian G_PKL_TIMELINE_RUNRATE) tidak berlaku di sini.
export const FIELD_PL_GATE_KEYS = [
	'G_PKL_PROJECT',
	'G_PKL_STOK',
	'G_PKL_INVENTORY_LINK',
	'G_PKL_CAT_WARNA',
	'G_PKL_MASTER_PRICE',
	'G_PKL_COVERAGE_M2',
	'G_PKL_TIMELINE_RUNRATE',
	'G_PKL_SITE_STOCK_RECON'
] as const;
export type FieldPLGateKey = (typeof FIELD_PL_GATE_KEYS)[number];
export type FieldPLGateModes = Partial<Record<FieldPLGateKey, GateMode>>;

// Hanya dipakai bila mode tidak dipasok (pemanggilan murni/test). Jalur produksi lewat
// evaluateFieldPLGatesWithDisiplin selalu memasok `resolveMode` dari Kalibrasi Gate.
const FALLBACK_MODES: Record<FieldPLGateKey, GateMode> = {
	G_PKL_PROJECT: 'hard',
	G_PKL_STOK: 'soft',
	G_PKL_INVENTORY_LINK: 'hard',
	G_PKL_CAT_WARNA: 'hard',
	G_PKL_MASTER_PRICE: 'soft',
	// Gate baru lahir shadow (CLAUDE.md #3/#11) — naik lewat /settings/gates, bukan kode.
	G_PKL_COVERAGE_M2: 'shadow',
	G_PKL_TIMELINE_RUNRATE: 'shadow',
	G_PKL_SITE_STOCK_RECON: 'shadow'
};

// Kategori yang memang bukan barang fisik, dengan atau tanpa prefix 'packing_'.
const NON_BARANG_CATEGORIES = new Set(['jasa', 'lain_lain']);
const isNonBarangCategory = (c?: string | null) => NON_BARANG_CATEGORIES.has(String(c || '').toLowerCase().replace(/^packing_/, ''));

export interface FieldPLRow {
	id: number;
	project_id: number | null;
	qty: number;
	identitas_barang_id?: number | null;
	material_name?: string | null;
	material_color?: string | null;
	budget_category?: string | null;
	/** Satuan permintaan (project_budgets.unit) — dipakai gate rasionalitas qty. */
	unit?: string | null;
	/** Dari baris project_budgets asli atau baris template (lihat loadTemplateFlags). Item manual
	 *  tidak boleh menyetel sendiri flag ini: klien tidak dipercaya untuk lolos dari gate. */
	no_item_needed?: boolean;
	is_manpower?: boolean;
	/** Leader menandai barang ini belum ada di Master Katalog dan mengusulkannya ke Admin Logistik (identitas_barang_usulan_baru). */
	usul_baru?: boolean;
	/** Harga satuan RAB/pengajuan baris project_budgets (G_PKL_MASTER_PRICE). Hanya dari server, bukan klien. */
	unit_price?: number | null;
	planned_amount?: number | null;
}

export interface FieldPLCtx {
	rows: FieldPLRow[];
	/** projectId (string) -> projects.status; `undefined`/`null` = tidak ditemukan */
	projectStatusById: Map<string, string | null | undefined>;
	/** identitas_barang_id (string) -> stok_tersedia (number) */
	stockById: Map<string, number>;
	/** identitas_barang_id (string) -> harga master efektif (avg_cost → harga_beli → harga; 0 = kosong). `undefined` = tidak dimuat → G_PKL_MASTER_PRICE tidak dinilai. */
	priceById?: Map<string, number>;
	/** identitas_barang_id (string) yang alat/pinjaman (dinilai tarif sewa di admin, bukan harga master). */
	equipmentById?: Set<string>;
	modes?: FieldPLGateModes;
	/** Baris ber-usulan barang baru tidak dihitung 'belum tertaut' (dibaca dari gate_definitions.action_config.allow_pending_proposal). */
	allowProposal?: boolean;
	/** Konteks rasionalitas qty per proyek (projectId string). Kosong/undefined => 3 gate rasionalitas tidak dievaluasi. */
	coverageByProject?: Map<string, FieldCoverage>;
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
	/** Gate mode shadow yang gagal: tidak ditampilkan ke user, tersedia untuk diagnosis. */
	shadowed?: string[];
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
	const shadowed: string[] = [];
	const modeOf = (key: FieldPLGateKey): GateMode => ctx.modes?.[key] ?? FALLBACK_MODES[key];

	/** Satu pintu perlakuan gate gagal sesuai mode. */
	function reportFailed(key: FieldPLGateKey, label: string, message: string, extra: Partial<FieldGate> = {}, opts: { capAtWarning?: boolean } = {}) {
		const raw = modeOf(key);
		// capAtWarning: gate yang tanggung jawabnya di Admin (mis. harga master) tidak boleh menahan Leader di lapangan, walau diset hard.
		const mode: GateMode = opts.capAtWarning && raw === 'hard' ? 'soft' : raw;
		if (mode === 'shadow') {
			shadowed.push(key);
			return;
		}
		if (mode !== 'hard') {
			gates.push({ gate_key: key, label, severity: 'SEMI', status: 'failed', message: `${message} Pengajuan tetap bisa dikirim.`, ...extra });
			warnings.push(key);
			return;
		}
		if (overrideAllowed) {
			gates.push({ gate_key: key, label, severity: 'SEMI', status: 'failed', message: `${message} — DILEWATI (override super admin/GM)`, overridden: true, ...extra });
			overridden.push(key);
			return;
		}
		gates.push({ gate_key: key, label, severity: 'WAJIB', status: 'failed', message, ...extra });
		blocking.push(key);
	}

	// ---------- G_PKL_PROJECT ----------
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
			reportFailed('G_PKL_PROJECT', 'Tautan & status proyek', base);
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
		if (short.length && modeOf('G_PKL_STOK') === 'shadow') {
			shadowed.push('G_PKL_STOK');
		} else if (short.length) {
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

	// ---------- G_PKL_INVENTORY_LINK ----------
	// Item fisik sebaiknya tertaut SKU Master Barang (identitas_barang_id): tanpa tautan, stok tidak
	// terpotong saat Surat Jalan terbit. Baris non-barang (no_item_needed, manpower, jasa) dikecualikan.
	{
		const unlinked = rows.filter(
			(r) =>
				!isTruth(r.no_item_needed) &&
				!isTruth(r.is_manpower) &&
				!isNonBarangCategory(r.budget_category) &&
				!r.identitas_barang_id &&
				!(ctx.allowProposal && r.usul_baru)
		);
		if (unlinked.length > 0) {
			reportFailed(
				'G_PKL_INVENTORY_LINK',
				'Tautan barang master',
				`${unlinked.length} item belum tertaut ke Master Barang: ` +
					`${unlinked.slice(0, 5).map((r) => r.material_name || `item #${r.id}`).join(', ')}` +
					`${unlinked.length > 5 ? `, +${unlinked.length - 5} lainnya` : ''}. ` +
					`Pilih barang dari saran Master Katalog atau minta Admin Logistik menautkannya.`,
				{ affected_items: unlinked.map((r) => ({ id: r.id, label: r.material_name || `Item #${r.id}` })) }
			);
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
			reportFailed('G_PKL_CAT_WARNA', 'Spesifikasi warna cat', base, {
				affected_items: paintWithoutColor.map((r) => ({ id: r.id, label: r.material_name || `Item #${r.id}` }))
			});
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

	// ---------- G_PKL_MASTER_PRICE (Valuasi Siklus Penuh, Fase 3) ----------
	// Barang material bertaut master yang harganya KOSONG di RAB maupun master → nilai komitmen/HPP-nya Rp 0. Harga adalah tanggung jawab
	// Purchasing/Logistik, jadi dari lapangan HANYA peringatan (capAtWarning) — Leader tetap bisa mengajukan; sinyal ini menuntun Admin
	// mengisi harga. Alat/pinjaman & item non-katalog tidak dinilai di sini. Tanpa data harga (peta tak dimuat) = tidak dinilai (D2).
	{
		if (ctx.priceById) {
			const priceOf = (r: FieldPLRow) => {
				const direct = num(r.unit_price) || (num(r.planned_amount) > 0 && num(r.qty) > 0 ? num(r.planned_amount) / num(r.qty) : 0);
				return direct || (r.identitas_barang_id ? ctx.priceById!.get(String(r.identitas_barang_id)) ?? -1 : -1);
			};
			const evaluable = rows.filter(
				(r) =>
					r.identitas_barang_id &&
					!isTruth(r.no_item_needed) &&
					!isTruth(r.is_manpower) &&
					!isNonBarangCategory(r.budget_category) &&
					!ctx.equipmentById?.has(String(r.identitas_barang_id)) &&
					priceOf(r) >= 0
			);
			const unpriced = evaluable.filter((r) => priceOf(r) === 0);
			if (unpriced.length > 0) {
				reportFailed(
					'G_PKL_MASTER_PRICE',
					'Harga master barang',
					`${unpriced.length} item belum punya harga di master: ${unpriced.slice(0, 5).map((r) => r.material_name || `item #${r.id}`).join(', ')}${unpriced.length > 5 ? `, +${unpriced.length - 5} lainnya` : ''}. ` +
						`Admin/Purchasing akan melengkapi harganya — pengajuan Anda tetap bisa dikirim.`,
					{ affected_items: unpriced.map((r) => ({ id: r.id, label: r.material_name || `Item #${r.id}` })) },
					{ capAtWarning: true }
				);
			} else if (evaluable.length > 0) {
				gates.push({
					gate_key: 'G_PKL_MASTER_PRICE',
					label: 'Harga master barang',
					severity: 'SEMI',
					status: 'passed',
					message: 'Semua barang bertaut master sudah punya harga'
				});
			}
		}
	}

	// ---------- Rasionalitas qty (G_PKL_COVERAGE_M2 / G_PKL_TIMELINE_RUNRATE / G_PKL_SITE_STOCK_RECON) ----------
	// Engine = salinan identik erp-epi (materialCoverageEngine). Data kurang (luasan kosong, barang belum terpetakan, satuan tak
	// terkonversi, laju harian tak diketahui) => tidak dievaluasi (tidak muncul), BUKAN gagal.
	if (ctx.coverageByProject?.size) {
		const bucket: Record<string, { problems: string[]; evaluated: number; affected: Array<{ id: number; label: string }> }> = {
			G_PKL_COVERAGE_M2: { problems: [], evaluated: 0, affected: [] },
			G_PKL_TIMELINE_RUNRATE: { problems: [], evaluated: 0, affected: [] },
			G_PKL_SITE_STOCK_RECON: { problems: [], evaluated: 0, affected: [] }
		};
		for (const [pid, cov] of ctx.coverageByProject) {
			const prows = rows.filter((r) => String(r.project_id) === pid && !isTruth(r.no_item_needed) && !isTruth(r.is_manpower) && num(r.qty) > 0);
			const items = prows.map((r) => ({
				key: r.id,
				item_id: r.identitas_barang_id ?? null,
				nama_barang: r.material_name || '',
				qty_required: r.qty,
				unit: r.unit || '',
				fill_weight_kg: cov.fillById.get(String(r.identitas_barang_id)) ?? null
			}));
			const label = (key: number | string) => prows.find((r) => String(r.id) === String(key))?.material_name || `item #${key}`;
			const note = (k: string, key: number | string) => {
				const id = Number(key);
				if (!bucket[k].affected.some((a) => a.id === id)) bucket[k].affected.push({ id, label: String(label(key)) });
			};
			if (cov.area) {
				const cr = evaluateCoverage({ areaM2: cov.area.areaM2, items, rates: cov.rates, priorByRateId: cov.priorByRateId, settings: cov.settings });
				bucket.G_PKL_COVERAGE_M2.evaluated += cr.evaluatedCount;
				for (const r of cr.items.filter((x: any) => x.status === 'over')) {
					bucket.G_PKL_COVERAGE_M2.problems.push(`${r.nama_barang} (diminta ${r.qty} ${r.unit}, wajar maks ${r.suggestedQty} ${r.unit} untuk ${Math.round(cov.area.areaM2 * 10) / 10} m²)`);
					note('G_PKL_COVERAGE_M2', r.key);
				}
			if (cov.dailyRate) {
					const rr = evaluateRunRate({ areaM2: cov.area.areaM2, dailyRate: cov.dailyRate, items, rates: cov.rates, siteStockByRateId: cov.siteStockByRateId, settings: cov.settings });
					bucket.G_PKL_TIMELINE_RUNRATE.evaluated += rr.evaluatedCount;
					for (const r of rr.items.filter((x: any) => x.status === 'over')) {
						bucket.G_PKL_TIMELINE_RUNRATE.problems.push(`${r.nama_barang} (diminta ${r.qty} ${r.unit}, kebutuhan ${cov.settings.max_buffer_days} hari kerja maks ${r.suggestedQty} ${r.unit})`);
						note('G_PKL_TIMELINE_RUNRATE', r.key);
					}
				}
			}
			const ss = evaluateSiteStockRecon({ items, rates: cov.rates, dailyRate: cov.dailyRate, siteStockByRateId: cov.siteStockByRateId, settings: cov.settings });
			bucket.G_PKL_SITE_STOCK_RECON.evaluated += ss.evaluatedCount;
			for (const r of ss.items.filter((x: any) => x.status === 'hold')) {
				bucket.G_PKL_SITE_STOCK_RECON.problems.push(`${r.nama_barang} — ${r.reason}`);
				note('G_PKL_SITE_STOCK_RECON', r.key);
			}
		}
		const META: Array<[FieldPLGateKey, string, string]> = [
			['G_PKL_COVERAGE_M2', 'Rasionalitas qty vs luasan (m²)', 'Turunkan qty sampai ≤ batas wajar, atau minta Admin memperbaiki luasan proyek di Charter bila datanya salah.'],
			['G_PKL_TIMELINE_RUNRATE', 'Kesesuaian jadwal & pemakaian harian', 'Ajukan sesuai kebutuhan beberapa hari kerja ke depan; pengiriman berikutnya bisa diajukan menyusul.'],
			['G_PKL_SITE_STOCK_RECON', 'Rekonsiliasi stok site & laporan harian', 'Isi Laporan Harian (pemakaian material) agar saldo stok site akurat, lalu ajukan ulang.']
		];
		for (const [key, label, tip] of META) {
			const b = bucket[key];
			if (b.problems.length) {
				const list = b.problems.slice(0, 5).join('; ') + (b.problems.length > 5 ? `; +${b.problems.length - 5} lainnya` : '');
				reportFailed(key, label, `${b.problems.length} item bermasalah: ${list}. ${tip}`, { affected_items: b.affected });
			} else if (b.evaluated > 0 && modeOf(key) !== 'shadow') {
				gates.push({ gate_key: key, label, severity: 'SEMI', status: 'passed', message: `${b.evaluated} item wajar` });
			}
		}
	}

	const status = blocking.length ? 'blocked' : warnings.length ? 'soft_warning' : 'passed';
	return { gates, status, blocking, warnings, overridden, override_allowed: overrideAllowed, shadowed };
}

export interface TemplateFlags {
	identitas_barang_id: number | null;
	no_item_needed: boolean;
	is_manpower: boolean;
}

/**
 * Tautan & flag baris template dibaca ulang di server dari project_budgets (is_template=true),
 * bukan dipercaya dari klien. Gagal baca dilog lalu dianggap tanpa tautan: gate mengikuti modenya.
 */
export async function loadTemplateFlags(
	templateItemIds: Array<number | string | null | undefined>,
	directusServerJson: (path: string, init?: any) => Promise<any>
): Promise<Map<number, TemplateFlags>> {
	const map = new Map<number, TemplateFlags>();
	const ids = [...new Set(templateItemIds.map(Number).filter((n) => Number.isFinite(n) && n > 0))];
	if (!ids.length) return map;
	try {
		const res: any = await directusServerJson(
			`/items/project_budgets?filter[id][_in]=${ids.join(',')}&filter[is_template][_eq]=true&fields=id,identitas_barang_id,no_item_needed,is_manpower&limit=-1`
		);
		for (const r of res?.data || []) {
			const idb = r.identitas_barang_id && typeof r.identitas_barang_id === 'object' ? r.identitas_barang_id.id : r.identitas_barang_id;
			map.set(Number(r.id), { identitas_barang_id: idb ?? null, no_item_needed: isTruth(r.no_item_needed), is_manpower: isTruth(r.is_manpower) });
		}
	} catch (e: any) {
		console.error('[plFieldGates] Gagal membaca tautan baris template:', e?.message || e);
	}
	return map;
}

/**
 * Resolusi konteks (status proyek + stok) untuk sekumpulan baris, lalu evaluasi.
 * `directusServerJson` di-inject supaya modul ini tetap murni & gampang diuji.
 */
export async function evaluateFieldPLGatesFor(
	rows: FieldPLRow[],
	directusServerJson: (path: string, init?: any) => Promise<any>,
	opts: {
		overrideAllowed?: boolean;
		allowProposal?: boolean;
		resolveMode?: (gateKey: FieldPLGateKey) => Promise<GateMode>;
		/** Pemuat konteks rasionalitas qty per proyek (di-inject; hanya dipanggil bila ada gate rasionalitas non-shadow => hemat API). */
		loadCoverage?: (projectId: string, itemIds: Array<number | null | undefined>) => Promise<FieldCoverage>;
	} = {}
): Promise<FieldPLResult> {
	const projIds = [...new Set(rows.map((r) => r.project_id).filter(Boolean).map(String))];
	const idbIds = [...new Set(rows.map((r) => r.identitas_barang_id).filter(Boolean).map(String))];

	// Kegagalan lookup TIDAK boleh ditelan jadi { data: [] }:
	//  - status proyek (gate memblokir): gagal ambil != "proyek tidak ditemukan". Dilempar dengan
	//    pesan yang jujur supaya user tidak diblokir dengan alasan menyesatkan dan IT melihat penyebab
	//    sebenarnya. Pemanggil (submit/create-items) menerjemahkannya jadi error ke user; pra-cek
	//    (gate-precheck) tetap fail-open di klien.
	//  - stok (hanya peringatan): dilog jelas lalu dilewati — stok tak diketahui = tidak dicek.
	const failedLookups = new Set<string>();
	const lookup = async (label: string, path: string, fatal: boolean) => {
		try {
			return await directusServerJson(path);
		} catch (e: any) {
			console.error(`[plFieldGates] Gagal mengambil ${label} dari Directus:`, e);
			failedLookups.add(label);
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
			? lookup('stok barang', `/items/identitas_barang?filter[id][_in]=${idbIds.join(',')}&fields=id,stok_tersedia,avg_cost,harga_beli,harga,is_borrowable,id_equipment&limit=-1`, false)
			: Promise.resolve({ data: [] })
	]);

	const projectStatusById = new Map<string, string | null>();
	for (const p of projRes?.data || []) projectStatusById.set(String(p.id), p.status ?? null);

	const stockById = new Map<string, number>();
	for (const it of stockRes?.data || []) stockById.set(String(it.id), parseFloat(it.stok_tersedia) || 0);

	// Harga master dari query stok yang sama. Kolom harga tidak ada di respons (mis. mock lama) / lookup gagal → peta tidak diisi.
	let priceById: Map<string, number> | undefined;
	const equipmentById = new Set<string>();
	if (idbIds.length && !failedLookups.has('stok barang')) {
		for (const it of stockRes?.data || []) {
			if (isTruth(it.is_borrowable) || it.id_equipment) equipmentById.add(String(it.id));
			if (it.avg_cost === undefined && it.harga_beli === undefined && it.harga === undefined) continue;
			(priceById ??= new Map()).set(String(it.id), num(it.avg_cost) || num(it.harga_beli) || num(it.harga) || 0);
		}
	}

	const modes: FieldPLGateModes = {};
	if (opts.resolveMode) {
		await Promise.all(FIELD_PL_GATE_KEYS.map(async (k) => { modes[k] = await opts.resolveMode!(k); }));
	}

	// Rasionalitas qty: muat konteks HANYA bila minimal satu dari 3 gate-nya bukan shadow (shadow = tidak tampil => tak perlu biaya API).
	let coverageByProject: Map<string, FieldCoverage> | undefined;
	const covActive = (['G_PKL_COVERAGE_M2', 'G_PKL_TIMELINE_RUNRATE', 'G_PKL_SITE_STOCK_RECON'] as const).some((k) => (modes[k] ?? FALLBACK_MODES[k]) !== 'shadow');
	if (covActive && opts.loadCoverage) {
		coverageByProject = new Map();
		for (const pid of projIds) {
			// proyek tak aktif sudah ditolak G_PKL_PROJECT; tak perlu hitung rasionalitas
			const st = projectStatusById.get(pid);
			if (st == null || PROJECT_STATUS_INACTIVE.includes(String(st).toLowerCase())) continue;
			try {
				const prows = rows.filter((r) => String(r.project_id) === pid);
				coverageByProject.set(pid, await opts.loadCoverage(pid, prows.map((r) => r.identitas_barang_id)));
			} catch (e: any) {
				console.warn(`[plFieldGates] konteks rasionalitas proyek ${pid} gagal (fail-open):`, e?.message || e);
			}
		}
	}

	return evaluateFieldPLGates({ rows, projectStatusById, stockById, priceById, equipmentById, modes, allowProposal: !!opts.allowProposal, coverageByProject }, opts);
}
