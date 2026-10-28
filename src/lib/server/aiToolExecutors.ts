// src/lib/server/aiToolExecutors.ts
// SERVER-ONLY. Pelaksana tool Asisten AI (dashboard lapangan). Fase 1 —
// Rencana Implementasi Asisten Eltama v2.0 §7/§19.2.
//
// `cari_lintas_modul` membungkus runSearch() (searchService.ts) yang sudah
// menjangkau Proyek/WO/Equipment/Tiket/Stok/Panduan dengan penyaringan izin
// bawaan — bukan query baru. `status_p2h` dan `riwayat_perbaikan` adalah
// query baru tapi grounded pada skema nyata (lihat
// routes/api/preventive/p2h/submit/+server.ts untuk bentuk p2h_session/p2h_log,
// searchService.ts untuk bentuk work_order/equipment) — bukan tebakan.
// Setiap hasil menyertakan `referensi` (petunjuk modul, bukan URL — app ini
// belum punya deep-link per-record) supaya jawaban asisten bisa
// diverifikasi (§6/§11).

import { runSearch } from './searchService';
import { directusServerJson } from './directus';
import { isProjectAllowed, resolveEquipmentActiveProjectIds } from './aiProjectScope';
import { resolveKaryawanByEmail } from './ess/karyawan';

/** Resolve satu proyek (id+name) dari kata kunci nama/kode, TIDAK memfilter izin — panggil isProjectAllowed setelahnya. */
async function resolveProjectByName(q: string): Promise<{ id: number; name: string } | null> {
	const qs = new URLSearchParams({
		filter: JSON.stringify({ _or: [{ name: { _icontains: q } }, { code: { _icontains: q } }] }),
		fields: 'id,name',
		limit: '1'
	});
	const res = await directusServerJson<{ data: any[] }>(`/items/projects?${qs.toString()}`);
	const row = res?.data?.[0];
	return row ? { id: row.id, name: row.name } : null;
}

// Duplikat sengaja dari REQUISITION_STATUS_LABEL di lib/services/requisitionApi.ts
// (file client-side, tidak boleh diimpor dari kode server-only) — sama seperti
// kontrak tool yang disalin terkendali dari erp-epi-1 (lihat aiToolRegistry.ts).
const REQUISITION_STATUS_LABEL: Record<string, string> = {
	draft: 'Draft',
	submitted_dept: 'Diajukan ke Atasan',
	pending_direktur: 'Menunggu Direktur',
	approved_pending_inventory: 'Disetujui - Menunggu Inventory',
	inventory_processing: 'Diproses Inventory',
	partially_fulfilled: 'Terpenuhi Sebagian',
	fulfilled: 'Terpenuhi',
	needs_purchase_pending: 'Menunggu Pembelian',
	rejected: 'Ditolak',
	cancelled: 'Dibatalkan'
};

export interface ToolExecCtx {
	permissions: string[];
	roleId: string | null;
	userEmail: string | null;
	/** null = tak dibatasi (admin/view_all_projects). Lihat aiProjectScope.ts. */
	projectIds: number[] | null;
}

/**
 * Gerbang project-scoping (Fase 2 lanjutan) untuk tool berbasis equipment:
 * bila equipment sedang aktif dipakai proyek TERTENTU dan proyek itu bukan
 * salah satu proyek yang boleh dilihat user, tolak. Equipment tanpa proyek
 * aktif (aset bersama/bengkel) tidak dibatasi.
 */
async function checkEquipmentProjectAccess(equipmentId: string, projectIds: number[] | null): Promise<string | null> {
	if (projectIds === null) return null; // admin/view_all_projects — tak dibatasi
	const activeProjectIds = await resolveEquipmentActiveProjectIds(equipmentId);
	if (activeProjectIds.length === 0) return null; // aset bersama, tak terikat proyek
	if (activeProjectIds.some((id) => isProjectAllowed(projectIds, id))) return null;
	return 'Equipment ini sedang berada di proyek yang bukan tanggung jawab Anda.';
}

/**
 * Project-scoping untuk hasil cari_lintas_modul grup Equipment/Work Order —
 * runSearch() (searchService.ts) sendiri HANYA menyaring izin RBAC, tidak per-proyek
 * (lihat catatan project-ai-assistant-bubble). Disaring di SINI, bukan di
 * searchService.ts, supaya Global Deep Search (konsumen lain runSearch — UI
 * pencarian global lapangan, bukan cuma Asisten AI) tidak ikut terdampak
 * perubahan filter yang seharusnya spesifik untuk tool AI ini.
 */
async function filterByProjectScope(entity: string, results: any[], projectIds: number[] | null): Promise<any[]> {
	if (projectIds === null || !results.length) return results; // admin/view_all_projects — tak dibatasi

	if (entity === 'Equipment') {
		const checks = await Promise.all(results.map((r) => checkEquipmentProjectAccess(r.id, projectIds)));
		return results.filter((_r, i) => checks[i] === null);
	}

	if (entity === 'Work Order') {
		// searchService.ts tidak mengembalikan equipment_id di hasil pencarian (bentuk
		// generik dipakai semua sumber) — resolve batch di sini, bukan N+1 per baris.
		const ids = results.map((r) => r.id);
		const qs = new URLSearchParams({ filter: JSON.stringify({ id: { _in: ids } }), fields: 'id,equipment_id', limit: '-1' });
		const res = await directusServerJson<{ data: Array<{ id: string; equipment_id: string | null }> }>(
			`/items/work_order?${qs.toString()}`
		).catch(() => null);
		const equipmentByWo = new Map((res?.data || []).map((r) => [r.id, r.equipment_id]));
		const checks = await Promise.all(
			results.map((r) => {
				const equipmentId = equipmentByWo.get(r.id);
				return equipmentId ? checkEquipmentProjectAccess(equipmentId, projectIds) : Promise.resolve(null);
			})
		);
		return results.filter((_r, i) => checks[i] === null);
	}

	return results;
}

/** Resolve satu equipment (id+name) dari kata kunci nama/kode. Null bila tidak ketemu. */
async function resolveEquipment(q: string): Promise<{ id: string; name: string } | null> {
	const qs = new URLSearchParams({
		filter: JSON.stringify({ _or: [{ name: { _icontains: q } }, { code: { _icontains: q } }] }),
		fields: 'id,name',
		limit: '1'
	});
	const res = await directusServerJson<{ data: any[] }>(`/items/equipment?${qs.toString()}`);
	const row = res?.data?.[0];
	return row ? { id: row.id, name: row.name } : null;
}

export const TOOL_EXECUTORS: Record<string, (input: any, ctx: ToolExecCtx) => Promise<any>> = {
	async cari_dokumen_tds_msds(input) {
		const q = String(input?.q || '').trim();
		if (!q) return { error: 'Parameter "q" (nama/kode produk) wajib diisi.' };
		const limit = Math.min(Math.max(Number(input?.limit) || 5, 1), 10);

		const qs = new URLSearchParams({
			fields: 'id,product_code,product_name,category,tds_url,tds_version,tds_issue_date,tds_expiry_date,msds_url,msds_version,msds_issue_date,msds_expiry_date,notes',
			filter: JSON.stringify({
				_or: [{ product_name: { _icontains: q } }, { product_code: { _icontains: q } }]
			}),
			sort: 'product_name',
			limit: String(limit)
		});

		const res = await directusServerJson<{ data?: any[] }>(`/items/tds_msds_documents?${qs.toString()}`).catch(() => null);
		const rawRows = res?.data || [];

		if (!rawRows.length) {
			return {
				count: 0,
				hasil: [],
				catatan: `Dokumen TDS/MSDS untuk produk "${q}" tidak ditemukan.`,
				referensi: 'Dokumen Teknis > TDS & MSDS Produk'
			};
		}

		const rows = rawRows.map((r: any) => ({
			kode_produk: r.product_code || '-',
			nama_produk: r.product_name,
			kategori: r.category || 'Produk Cat',
			tds: {
				tersedia: !!r.tds_url,
				versi: r.tds_version || '-',
				file_url: r.tds_url || null
			},
			msds: {
				tersedia: !!r.msds_url,
				versi: r.msds_version || '-',
				file_url: r.msds_url || null
			},
			referensi: `TDS & MSDS — "${r.product_name || r.product_code}"`
		}));

		return { count: rows.length, hasil: rows };
	},

	async cari_lintas_modul(input, ctx) {
		const q = String(input?.q || '').trim();
		if (!q) return { error: 'Parameter "q" wajib diisi.' };

		const groups = await runSearch({ q, permissions: ctx.permissions, roleId: ctx.roleId, userEmail: ctx.userEmail });

		// Project-scoping (Fase 2 lanjutan) — lihat filterByProjectScope().
		const scopedGroups = await Promise.all(
			groups.map(async (g: any) => ({ ...g, results: await filterByProjectScope(g.entity, g.results || [], ctx.projectIds) }))
		);

		const hasil = scopedGroups.flatMap((g: any) =>
			(g.results || []).slice(0, 5).map((r: any) => ({
				entitas: g.entity,
				judul: r.title,
				keterangan: r.subtitle || '',
				referensi: `${g.entity} — cari "${r.title}"`
			}))
		);
		return { count: hasil.length, hasil: hasil.slice(0, 15) };
	},

	async status_p2h(input, ctx) {
		const q = String(input?.equipment || '').trim();
		if (!q) return { error: 'Parameter "equipment" (nama/kode alat) wajib diisi.' };

		const equipment = await resolveEquipment(q);
		if (!equipment) return { error: `Equipment "${q}" tidak ditemukan.` };

		const denied = await checkEquipmentProjectAccess(equipment.id, ctx.projectIds);
		if (denied) return { error: denied };

		const qs = new URLSearchParams({
			filter: JSON.stringify({ equipment_id: { _eq: equipment.id } }),
			fields: 'id,date,overall_result.name,keterangan_tambahan,hoursmeter',
			sort: '-date',
			limit: '1'
		});
		const res = await directusServerJson<{ data: any[] }>(`/items/p2h_session?${qs.toString()}`);
		const session = res?.data?.[0];
		if (!session) {
			return { equipment: equipment.name, status: 'Belum pernah ada P2H tercatat untuk equipment ini.' };
		}
		return {
			equipment: equipment.name,
			tanggal_p2h_terakhir: session.date,
			hasil: session.overall_result?.name || '(tidak diketahui)',
			keterangan: session.keterangan_tambahan || '',
			hoursmeter: session.hoursmeter,
			referensi: `Preventive > P2H — equipment "${equipment.name}", tanggal ${session.date}`
		};
	},

	async riwayat_perbaikan(input, ctx) {
		const q = String(input?.equipment || '').trim();
		if (!q) return { error: 'Parameter "equipment" (nama/kode alat) wajib diisi.' };
		const limit = Math.min(Math.max(Number.parseInt(String(input?.limit ?? '5'), 10) || 5, 1), 10);

		const equipment = await resolveEquipment(q);
		if (!equipment) return { error: `Equipment "${q}" tidak ditemukan.` };

		const denied = await checkEquipmentProjectAccess(equipment.id, ctx.projectIds);
		if (denied) return { error: denied };

		const qs = new URLSearchParams({
			filter: JSON.stringify({ equipment_id: { _eq: equipment.id } }),
			// `status` BUKAN field asli work_order (koreksi bug pra-eksisting) — status
			// sesungguhnya ada di `order_status` (FK ke category), lihat admin
			// maintenanceApi.js::fetchWorkOrders yang jadi acuan.
			fields: 'id,wo_number,order_status.name,keluhan,tanggal_rusak',
			sort: '-tanggal_rusak',
			limit: String(limit)
		});
		const res = await directusServerJson<{ data: any[] }>(`/items/work_order?${qs.toString()}`);
		const rows = (res?.data || []).map((r: any) => ({
			nomor_wo: r.wo_number,
			status: r.order_status?.name || '(tidak diketahui)',
			keluhan: r.keluhan,
			tanggal_rusak: r.tanggal_rusak,
			referensi: `Maintenance > Work Order — nomor "${r.wo_number}"`
		}));
		return { equipment: equipment.name, count: rows.length, hasil: rows };
	},

	// Fase 2 (§8) — HANYA menyiapkan preview, TIDAK PERNAH menulis apa pun.
	// Penulisan nyata (createRequisition di requisitionSubmit.ts, dipanggil
	// lewat /api/ai-assistant/draft-requisition) hanya terjadi setelah
	// pengguna menekan tombol "Buat Draf" secara eksplisit di AsistenSheet.
	async siapkan_draf_requisition(input) {
		const itemQ = String(input?.item || '').trim();
		const quantity = Number(input?.quantity);
		if (!itemQ) return { error: 'Parameter "item" (nama barang) wajib diisi.' };
		if (!Number.isFinite(quantity) || quantity <= 0) return { error: 'Parameter "quantity" harus angka lebih dari 0.' };

		const qs = new URLSearchParams({
			filter: JSON.stringify({ nama_barang_lengkap: { _icontains: itemQ } }),
			fields: 'id,nama_barang_lengkap,satuan',
			limit: '1'
		});
		const res = await directusServerJson<{ data: any[] }>(`/items/identitas_barang?${qs.toString()}`);
		const item = res?.data?.[0];
		if (!item) return { error: `Barang "${itemQ}" tidak ditemukan di master barang.` };

		const keterangan = String(input?.keterangan || '').trim();
		return {
			draft: {
				type: 'requisition',
				requisitionType: 'general_internal',
				items: [
					{
						identitas_barang_id: item.id,
						nama_barang: item.nama_barang_lengkap,
						quantity_requested: quantity,
						units: item.satuan || null
					}
				],
				tujuanPenggunaan: keterangan
			},
			ringkasan: `Draf pengajuan: ${quantity} ${item.satuan || ''} "${item.nama_barang_lengkap}"${keterangan ? ` — ${keterangan}` : ''}`,
			referensi: 'Requisition Internal Barang — pengajuan barang untuk departemen sendiri'
		};
	},

	// 5B#1 — HANYA menyiapkan preview (resolve equipment), TIDAK PERNAH menulis.
	// Penulisan nyata (work_order quick-create) hanya lewat
	// POST /api/ai-assistant/draft-maintenance-ticket setelah pengguna menekan "Buat Tiket".
	async siapkan_draf_tiket_maintenance(input, ctx) {
		const q = String(input?.equipment || '').trim();
		const keluhan = String(input?.keluhan || '').trim();
		if (!q) return { error: 'Parameter "equipment" (nama/kode alat) wajib diisi.' };
		if (!keluhan) return { error: 'Parameter "keluhan" (deskripsi kerusakan) wajib diisi.' };
		const urgency = input?.urgency === 'darurat' ? 'darurat' : 'minor';

		const equipment = await resolveEquipment(q);
		if (!equipment) return { error: `Equipment "${q}" tidak ditemukan.` };

		const denied = await checkEquipmentProjectAccess(equipment.id, ctx.projectIds);
		if (denied) return { error: denied };

		return {
			draft: {
				type: 'maintenance_ticket',
				equipmentId: equipment.id,
				equipmentName: equipment.name,
				keluhan,
				urgency
			},
			ringkasan: `Draf tiket maintenance: ${equipment.name} — ${keluhan.slice(0, 100)}`,
			referensi: 'Maintenance > Work Order — draf tiket dari Asisten AI (quick-create)'
		};
	},

	// Fase 3 (Tool Expansion, Batch B) — jadwal Preventive Maintenance (pm_due_tracker),
	// bukan p2h_session. Equipment-based, jadi digerbang project-scoping yang sama
	// dengan status_p2h/riwayat_perbaikan (§Fase 2 lanjutan).
	async cek_jadwal_pm(input, ctx) {
		const q = String(input?.equipment || '').trim();
		if (!q) return { error: 'Parameter "equipment" (nama/kode alat) wajib diisi.' };

		const equipment = await resolveEquipment(q);
		if (!equipment) return { error: `Equipment "${q}" tidak ditemukan.` };

		const denied = await checkEquipmentProjectAccess(equipment.id, ctx.projectIds);
		if (denied) return { error: denied };

		const qs = new URLSearchParams({
			filter: JSON.stringify({ equipment_id: { _eq: equipment.id } }),
			fields: 'id,due_date,pm_task_template_id.task_name,status_id.name',
			sort: 'due_date',
			limit: '10'
		});
		const res = await directusServerJson<{ data: any[] }>(`/items/pm_due_tracker?${qs.toString()}`);
		const today = new Date().toISOString().slice(0, 10);
		const rows = (res?.data || []).map((r: any) => ({
			tugas: r.pm_task_template_id?.task_name || 'Tugas PM',
			jatuh_tempo: r.due_date,
			status: r.status_id?.name || '(tidak diketahui)',
			terlambat: typeof r.due_date === 'string' && r.due_date < today,
			referensi: `Preventive > Jadwal PM — equipment "${equipment.name}"`
		}));
		return { equipment: equipment.name, count: rows.length, hasil: rows };
	},

	// Fase 3 (Tool Expansion, Batch B) — "Pengajuan Saya" (requisition), diskop
	// otomatis ke karyawan yang sedang login (resolveKaryawanByEmail), tidak
	// pernah menerima id karyawan lain dari model.
	async cek_status_requisition(input, ctx) {
		const karyawan = ctx.userEmail ? await resolveKaryawanByEmail(ctx.userEmail) : null;
		if (!karyawan) return { error: 'Akun Anda belum terhubung ke data karyawan. Hubungi Admin untuk pemetaan identitas.' };

		const q = String(input?.q || '').trim();
		const filter: any = { requester_user_id: { _eq: karyawan.id } };
		if (q) filter.requisition_number = { _icontains: q };

		const qs = new URLSearchParams({
			filter: JSON.stringify(filter),
			fields: 'id,requisition_number,requisition_type,status,tanggal_dibutuhkan,total_amount,created_at',
			sort: '-created_at',
			limit: '10'
		});
		const res = await directusServerJson<{ data: any[] }>(`/items/requisition?${qs.toString()}`);
		const rows = (res?.data || []).map((r: any) => ({
			nomor: r.requisition_number,
			jenis: r.requisition_type,
			status: REQUISITION_STATUS_LABEL[r.status] || r.status,
			tanggal_dibutuhkan: r.tanggal_dibutuhkan,
			total: r.total_amount,
			referensi: `Requisition > Pengajuan Saya — nomor "${r.requisition_number}"`
		}));
		return { count: rows.length, hasil: rows };
	},

	// Fase 3 — implementation_plan_ai_pertajam.md: tool expansion lapangan.
	async cek_stok_proyek(input, ctx) {
		const q = String(input?.proyek || '').trim();
		if (!q) return { error: 'Parameter "proyek" (nama/kode proyek) wajib diisi.' };
		const itemQ = String(input?.item || '').trim();

		const project = await resolveProjectByName(q);
		if (!project) return { error: `Proyek dengan kata kunci "${q}" tidak ditemukan.` };
		if (!isProjectAllowed(ctx.projectIds, project.id)) {
			return { error: 'Proyek ini bukan tanggung jawab Anda.' };
		}

		const filter: any = { project_id: { _eq: project.id } };
		if (itemQ) filter.item_id = { nama_barang_lengkap: { _icontains: itemQ } };

		const qs = new URLSearchParams({
			filter: JSON.stringify(filter),
			fields: 'id,item_id.nama_barang_lengkap,item_id.satuan,qty_on_hand,qty_received,qty_used,rab_qty,status,last_movement_date',
			sort: 'status',
			limit: '15'
		});
		const res = await directusServerJson<{ data: any[] }>(`/items/project_stock_balance?${qs.toString()}`);
		const rows = (res?.data || []).map((r: any) => ({
			barang: r.item_id?.nama_barang_lengkap || '(tidak diketahui)',
			satuan: r.item_id?.satuan || '-',
			qty_tersisa: r.qty_on_hand,
			qty_diterima: r.qty_received,
			qty_terpakai: r.qty_used,
			qty_rab: r.rab_qty,
			status: r.status,
			terakhir_bergerak: r.last_movement_date,
			referensi: `Proyek > ${project.name} — Stok Lapangan`
		}));
		return { proyek: project.name, count: rows.length, hasil: rows };
	},

	async cek_surat_jalan(input, ctx) {
		const q = String(input?.proyek || '').trim();
		if (!q) return { error: 'Parameter "proyek" (nama/kode proyek) wajib diisi.' };
		const limit = Math.min(Math.max(Number.parseInt(String(input?.limit ?? '5'), 10) || 5, 1), 10);

		const project = await resolveProjectByName(q);
		if (!project) return { error: `Proyek dengan kata kunci "${q}" tidak ditemukan.` };
		if (!isProjectAllowed(ctx.projectIds, project.id)) {
			return { error: 'Proyek ini bukan tanggung jawab Anda.' };
		}

		const qs = new URLSearchParams({
			filter: JSON.stringify({ project_id: { _eq: project.id } }),
			fields: 'id,nomor_sj,type,status,driver,delivery_address,received_at,received_by,total_items_delivered,total_items_required,date_created',
			sort: '-date_created',
			limit: String(limit)
		});
		const res = await directusServerJson<{ data: any[] }>(`/items/surat_jalan?${qs.toString()}`);
		const rows = (res?.data || []).map((r: any) => ({
			nomor_sj: r.nomor_sj,
			jenis: r.type,
			status: r.status,
			driver: r.driver || '-',
			tujuan: r.delivery_address || '-',
			diterima_pada: r.received_at,
			diterima_oleh: r.received_by,
			item_terkirim: r.total_items_delivered,
			item_seharusnya: r.total_items_required,
			referensi: `Proyek > ${project.name} — Surat Jalan "${r.nomor_sj}"`
		}));
		return { proyek: project.name, count: rows.length, hasil: rows };
	},

	// Self-scoped — TIDAK PERNAH menerima karyawan_id dari model, selalu resolve dari
	// email login (pola sama cek_status_requisition).
	async cek_absensi_saya(_input, ctx) {
		const karyawan = ctx.userEmail ? await resolveKaryawanByEmail(ctx.userEmail) : null;
		if (!karyawan) return { error: 'Akun Anda belum terhubung ke data karyawan. Hubungi Admin untuk pemetaan identitas.' };

		const now = new Date();
		const awalBulan = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

		const qs = new URLSearchParams({
			filter: JSON.stringify({ karyawan_id: { _eq: karyawan.id }, tanggal: { _gte: awalBulan } }),
			fields: 'id,tanggal,status,jam_masuk,jam_keluar',
			sort: '-tanggal',
			limit: '31'
		});
		const res = await directusServerJson<{ data: any[] }>(`/items/absensi_harian?${qs.toString()}`);
		const rows = (res?.data || []).map((r: any) => ({
			tanggal: r.tanggal,
			status: r.status,
			jam_masuk: r.jam_masuk,
			jam_keluar: r.jam_keluar
		}));
		return {
			karyawan: karyawan.nama_karyawan,
			periode: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
			count: rows.length,
			hasil: rows,
			referensi: 'ESS > Absensi Saya'
		};
	},

	async cek_saldo_cuti_saya(_input, ctx) {
		const karyawan = ctx.userEmail ? await resolveKaryawanByEmail(ctx.userEmail) : null;
		if (!karyawan) return { error: 'Akun Anda belum terhubung ke data karyawan. Hubungi Admin untuk pemetaan identitas.' };

		const [karyawanRes, cutiRes] = await Promise.all([
			directusServerJson<{ data: any }>(`/items/karyawan/${karyawan.id}?fields=total_cuti,cuti_terpakai`).catch(() => null),
			directusServerJson<{ data: any[] }>(
				`/items/cuti_karyawan?${new URLSearchParams({
					filter: JSON.stringify({ karyawan_id: { _eq: karyawan.id } }),
					fields: 'id,jenis_cuti,tanggal_mulai,tanggal_selesai,jumlah_hari,status',
					sort: '-date_created',
					limit: '5'
				}).toString()}`
			).catch(() => null)
		]);

		const totalCuti = Number(karyawanRes?.data?.total_cuti) || 0;
		const cutiTerpakai = Number(karyawanRes?.data?.cuti_terpakai) || 0;
		const pengajuanTerbaru = (cutiRes?.data || []).map((r: any) => ({
			jenis: r.jenis_cuti,
			tanggal_mulai: r.tanggal_mulai,
			tanggal_selesai: r.tanggal_selesai,
			jumlah_hari: r.jumlah_hari,
			status: r.status
		}));

		return {
			karyawan: karyawan.nama_karyawan,
			total_jatah: totalCuti,
			terpakai: cutiTerpakai,
			sisa: totalCuti - cutiTerpakai,
			pengajuan_terbaru: pengajuanTerbaru,
			referensi: 'ESS > Cuti Saya'
		};
	}
};

export async function execTool(name: string, input: any, ctx: ToolExecCtx): Promise<any> {
	const fn = TOOL_EXECUTORS[name];
	if (!fn) return { error: `Tool tidak dikenal: ${name}` };
	try {
		return await fn(input || {}, ctx);
	} catch (e: any) {
		console.error(`[ai-assistant] tool ${name} gagal:`, e?.message);
		return { error: `Gagal mengambil data: ${e?.message || 'kesalahan tak terduga'}` };
	}
}
