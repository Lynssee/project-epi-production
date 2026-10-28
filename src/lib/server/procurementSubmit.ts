// src/lib/server/procurementSubmit.ts
// SERVER-ONLY. Submit Permintaan Pembelian (PR) dari dashboard lapangan (project-epi).
//
// Fase 0 (Pertajam Pengajuan Pembelian v2, 23 Agu 2026) — memperbaiki 5 bug jalur
// submit lama (client-side, procurementApi.ts::submitPengajuanLapangan):
//   B1 stock_gate_status sekarang diturunkan dari is_non_stock (dulu selalu
//      'menunggu_cek_stok' walau jasa/non-stok)
//   B2 PR sekarang didaftarkan ke master_pengajuan (dulu tidak sama sekali)
//   B3 status_kanonik diisi lewat pengajuan_status_mapping saat submit
//   B5 idempotensi via client_txn_id (dulu tidak ada sama sekali)
// department_id diisi lewat pencocokan case-insensitive ke master department
// (exact match, sama pola dengan erp-epi-1 AjukanPengajuanModal.svelte).

import { saveItemsAtomically } from '../services/saveItemsAtomically';
import { directusServerJson } from './directus';
import { createApprovalRequest } from './approvalSubmit';
import { createMasterPengajuanEntry } from './masterPengajuanSubmit';
import { getPatrolControlSettings } from './patrolControlSettings';
import { resolveGateMode } from './gateDefinitionsMode';

const num = (v: any) => parseFloat(v || 0) || 0;

/**
 * G_PR_CHECKLIST_AREA_NOT_DONE (Fase 3+4.3 Kontrol Patroli, 15 Sep 2026) — bila pengajuan
 * dikaitkan ke sebuah ruangan (area_id) dan checklist kebersihan area itu hari ini
 * belum ada / skornya di bawah ambang (default 70%, app_settings module=patrol_control):
 *   shadow = catat saja, tidak berpengaruh ke submit (default aman, Aturan #3).
 *   soft   = tetap izinkan submit, tandai pengajuan.checklist_gate_status='peringatan'.
 *   hard   = tolak submit — LEMPAR error (pemanggil harus tangkap & tampilkan ke user).
 * Keputusan Lead (15 Sep 2026, Q3/Q5): ambang 70%, hold per-area (bukan blokade global).
 * Mode dibaca dari gate_definitions+gate_enforcement (erp-epi /settings/gates) — admin
 * bisa ubah tanpa redeploy, sama seperti gate lain di admin panel (Fase 4.3).
 */
async function checkChecklistAreaGate(areaId: number | null): Promise<'ok' | 'peringatan' | null> {
	if (!areaId) return null;
	const mode = await resolveGateMode('G_PR_CHECKLIST_AREA_NOT_DONE', 'pr');
	if (mode === 'shadow') return null;

	let gagal: boolean;
	try {
		const settings = await getPatrolControlSettings();
		const today = new Date().toISOString().slice(0, 10);
		const res: any = await directusServerJson(
			`/items/ga_checklist_responses?${new URLSearchParams({
				'filter[area_id][_eq]': String(areaId),
				'filter[submitted_at][_gte]': `${today}T00:00:00`,
				'filter[status][_neq]': 'rejected',
				sort: '-submitted_at',
				limit: '1',
				fields: 'scoring_result'
			}).toString()}`
		);
		const latest = res?.data?.[0];
		gagal = !latest || Number(latest.scoring_result) < settings.failedChecklistThreshold;
	} catch (err) {
		// Aturan #1: jangan telan diam-diam. Gagal baca data gate -> jangan blokir
		// pengajuan (fail-open), tapi catat jelas.
		console.error('[procurementSubmit] gagal evaluasi G_PR_CHECKLIST_AREA_NOT_DONE, dilewati:', err);
		return null;
	}
	if (!gagal) return 'ok';
	if (mode === 'hard') {
		throw new Error(
			'Pengajuan untuk ruangan ini ditahan — checklist kebersihan area belum selesai/gagal hari ini. Selesaikan checklist terlebih dulu.'
		);
	}
	return 'peringatan';
}

/**
 * G_PR_MAINTENANCE_P2H_NOT_DONE (Fase 3.3+4.3 Kontrol Patroli, 15 Sep 2026) — bila
 * pengajuan sparepart dikaitkan ke sebuah unit (equipment_id, terdeteksi dari field
 * lookup source='equipment' di kategori pembelian) dan P2H unit itu belum diisi hari
 * ini: shadow = catat saja. soft = izinkan, tandai pengajuan.p2h_gate_status='peringatan'.
 * hard = tolak submit. Mode dibaca dari gate_definitions+gate_enforcement (Fase 4.3).
 */
async function checkP2hGate(equipmentId: string | null): Promise<'ok' | 'peringatan' | null> {
	if (!equipmentId) return null;
	const mode = await resolveGateMode('G_PR_MAINTENANCE_P2H_NOT_DONE', 'pr');
	if (mode === 'shadow') return null;

	let belumP2h: boolean;
	try {
		const today = new Date().toISOString().slice(0, 10);
		const res: any = await directusServerJson(
			`/items/p2h_session?${new URLSearchParams({
				'filter[equipment_id][_eq]': equipmentId,
				'filter[date][_eq]': today,
				limit: '1'
			}).toString()}`
		);
		belumP2h = !res?.data?.length;
	} catch (err) {
		console.error('[procurementSubmit] gagal evaluasi G_PR_MAINTENANCE_P2H_NOT_DONE, dilewati:', err);
		return null;
	}
	if (!belumP2h) return 'ok';
	if (mode === 'hard') {
		throw new Error('Pengajuan sparepart untuk unit ini ditahan — P2H unit belum dilakukan hari ini. Selesaikan P2H terlebih dulu.');
	}
	return 'peringatan';
}

/**
 * G_PR_PATROL_MIN_COMPLIANCE (Fase 3+4.3 Kontrol Patroli, 15 Sep 2026) — bila pengajuan
 * dikaitkan ke sebuah ruangan dan skor kepatuhan ronda TERAKHIR yang mencakup checkpoint
 * area itu di bawah ambang (reuse failedChecklistThreshold): shadow = catat saja. soft =
 * izinkan, tandai peringatan. hard = tolak. Tidak ada ronda yang pernah mencakup area ini
 * -> dianggap tidak berlaku (bukan otomatis gagal, area mungkin memang tidak dipatroli).
 */
async function checkPatrolMinComplianceGate(areaId: number | null): Promise<'ok' | 'peringatan' | null> {
	if (!areaId) return null;
	const mode = await resolveGateMode('G_PR_PATROL_MIN_COMPLIANCE', 'pr');
	if (mode === 'shadow') return null;

	let gagal = false;
	try {
		const settings = await getPatrolControlSettings();
		const cpRes: any = await directusServerJson(
			`/items/security_checkpoint?${new URLSearchParams({ 'filter[area_id][_eq]': String(areaId), fields: 'id', limit: '-1' }).toString()}`
		);
		const checkpointIds: number[] = (cpRes?.data || []).map((c: any) => c.id);
		if (!checkpointIds.length) return null;

		const scanRes: any = await directusServerJson(
			`/items/security_patrol_scan?${new URLSearchParams({
				'filter[checkpoint_id][_in]': checkpointIds.join(','),
				sort: '-waktu',
				limit: '1',
				fields: 'patrol_log_id'
			}).toString()}`
		);
		const lastLogId = scanRes?.data?.[0]?.patrol_log_id;
		if (!lastLogId) return null;

		const logRes: any = await directusServerJson(`/items/security_patrol_log/${lastLogId}?fields=skor_kepatuhan`);
		const skor = logRes?.data?.skor_kepatuhan;
		gagal = skor != null && skor < settings.failedChecklistThreshold;
	} catch (err) {
		console.error('[procurementSubmit] gagal evaluasi G_PR_PATROL_MIN_COMPLIANCE, dilewati:', err);
		return null;
	}
	if (!gagal) return 'ok';
	if (mode === 'hard') {
		throw new Error('Pengajuan untuk ruangan ini ditahan — skor kepatuhan ronda terakhir area ini di bawah ambang.');
	}
	return 'peringatan';
}

/**
 * G_PR_CHECKLIST_CRITICAL_OPEN (Fase 3+4.3 Kontrol Patroli, 15 Sep 2026) — bila pengajuan
 * dikaitkan ke sebuah ruangan dan ada temuan kritis checklist area itu yang masih terbuka
 * (status != closed): shadow = catat saja. soft = izinkan, tandai peringatan. hard = tolak.
 * Default dokumen rencana = hard, tapi diberi enforce_from 2 minggu (Aturan #3) — otomatis
 * shadow sampai tanggal itu, lihat gateDefinitionsMode.ts::resolveGateMode.
 */
async function checkCriticalOpenGate(areaId: number | null): Promise<'ok' | 'peringatan' | null> {
	if (!areaId) return null;
	const mode = await resolveGateMode('G_PR_CHECKLIST_CRITICAL_OPEN', 'pr');
	if (mode === 'shadow') return null;

	let adaTerbuka = false;
	try {
		const respRes: any = await directusServerJson(
			`/items/ga_checklist_responses?${new URLSearchParams({ 'filter[area_id][_eq]': String(areaId), fields: 'id', limit: '-1' }).toString()}`
		);
		const responseIds: number[] = (respRes?.data || []).map((r: any) => r.id);
		if (!responseIds.length) return null;

		const findRes: any = await directusServerJson(
			`/items/ga_checklist_findings?${new URLSearchParams({
				'filter[response_id][_in]': responseIds.join(','),
				'filter[severity][_eq]': 'critical',
				'filter[status][_neq]': 'closed',
				fields: 'id',
				limit: '1'
			}).toString()}`
		);
		adaTerbuka = (findRes?.data?.length || 0) > 0;
	} catch (err) {
		console.error('[procurementSubmit] gagal evaluasi G_PR_CHECKLIST_CRITICAL_OPEN, dilewati:', err);
		return null;
	}
	if (!adaTerbuka) return 'ok';
	if (mode === 'hard') {
		throw new Error('Pengajuan untuk ruangan ini ditahan — ada temuan kritis checklist area ini yang masih terbuka. Tutup temuan kritis terlebih dulu.');
	}
	return 'peringatan';
}

// Fase 3 (23 Agu 2026): validasi kategori_pembelian + custom_fields_data. Salinan tipis
// dari erp-epi-1/src/lib/server/purchaseCategoryValidator.js (kedua app berbagi Directus
// yang sama) — server tetap satu-satunya otoritas, klien tidak pernah jadi otoritas.
const LOOKUP_SOURCE_WHITELIST = ['equipment', 'karyawan', 'identitas_barang'];
const FIELD_TYPE_WHITELIST = ['text', 'textarea', 'number', 'currency', 'date', 'select', 'boolean', 'image', 'lookup'];

function mergeFormSchema(parentSchema: any, childSchema: any): any[] {
	const safe = (s: any) => (Array.isArray(s) ? s : []);
	const byKey = new Map<string, any>(safe(parentSchema).map((f: any) => [f.key, f]));
	for (const f of safe(childSchema)) if (f?.key) byKey.set(f.key, f);
	return [...byKey.values()];
}

async function validateKategoriPembelian({
	kategoriKode, projectId = null, hasAttachment = false, customFieldsData = {}
}: { kategoriKode: string | null; projectId?: number | null; hasAttachment?: boolean; customFieldsData?: Record<string, any> }): Promise<{ valid: boolean; errors: string[]; equipmentId: string | null }> {
	// Fase 0 Penajaman PR (24 Agu 2026): kategori_pembelian wajib — sebelumnya opsional (Fase 3).
	if (!kategoriKode) return { valid: false, errors: ['Kategori pembelian wajib dipilih'], equipmentId: null };
	const errors: string[] = [];

	const res: any = await directusServerJson(
		`/items/purchase_category_config?filter[kode][_eq]=${encodeURIComponent(kategoriKode)}&limit=1`
	);
	const cat = res?.data?.[0];
	if (!cat) return { valid: false, errors: [`Kategori "${kategoriKode}" tidak ditemukan`], equipmentId: null };
	if (cat.status !== 'active') errors.push(`Kategori "${cat.nama}" sudah tidak aktif`);
	if (cat.requires_project && !projectId) errors.push(`Kategori "${cat.nama}" wajib terkait proyek`);
	if (cat.requires_attachment && !hasAttachment) errors.push(`Kategori "${cat.nama}" wajib lampiran`);

	let effectiveSchema = Array.isArray(cat.form_schema) ? cat.form_schema : [];
	if (cat.parent_id) {
		const parentRes: any = await directusServerJson(`/items/purchase_category_config/${cat.parent_id}`);
		effectiveSchema = mergeFormSchema(parentRes?.data?.form_schema, cat.form_schema);
	}

	const knownKeys = new Set(effectiveSchema.map((f: any) => f.key));
	const data = customFieldsData && typeof customFieldsData === 'object' ? customFieldsData : {};
	for (const f of effectiveSchema) {
		if (!FIELD_TYPE_WHITELIST.includes(f.type)) { errors.push(`Field "${f.key}" bertipe tidak dikenal`); continue; }
		if (f.type === 'lookup' && !LOOKUP_SOURCE_WHITELIST.includes(f.source)) { errors.push(`Field "${f.key}" sumber lookup tidak di-whitelist`); continue; }
		if (f.required) {
			const v = (data as any)[f.key];
			const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
			if (empty && f.type !== 'boolean') errors.push(`Field "${f.label || f.key}" wajib diisi`);
		}
	}
	for (const key of Object.keys(data)) {
		if (!knownKeys.has(key)) errors.push(`Kunci "${key}" tidak dikenal skema kategori ini`);
	}

	// Fase 3.3 Kontrol Patroli (15 Sep 2026): deteksi field lookup source='equipment' —
	// dasar GATE.MAINTENANCE.P2H_NOT_DONE (hold sparepart bila P2H unit belum dilakukan).
	const equipmentField = effectiveSchema.find((f: any) => f.type === 'lookup' && f.source === 'equipment');
	const equipmentId = equipmentField ? (data as any)[equipmentField.key] || null : null;

	return { valid: errors.length === 0, errors, equipmentId: equipmentId ? String(equipmentId) : null };
}

// Cache pendek pengajuan_status_mapping (jarang berubah), TTL 5 menit — sama pola
// dengan katalogCache di masterPengajuanSubmit.ts.
let statusMapCache: Map<string, string> | null = null;
let statusMapCacheAt = 0;
const STATUS_MAP_CACHE_TTL_MS = 5 * 60 * 1000;

async function resolveStatusKanonik(statusLama: string): Promise<string | null> {
	const now = Date.now();
	if (!statusMapCache || now - statusMapCacheAt >= STATUS_MAP_CACHE_TTL_MS) {
		const res: any = await directusServerJson(
			'/items/pengajuan_status_mapping?fields=status_lama,status_kanonik&limit=-1'
		).catch(() => null);
		const map = new Map<string, string>();
		for (const row of res?.data || []) map.set(row.status_lama, row.status_kanonik);
		statusMapCache = map;
		statusMapCacheAt = now;
	}
	return statusMapCache.get(statusLama) || null;
}

/**
 * Cocokkan nama department (teks bebas dari form) ke master `department`
 * (exact match, case-insensitive, hanya baris is_active=true). Null bila tak
 * ada yang cocok — best-effort, tidak memblokir submission (sama pola dengan
 * resolveDepartmentId di requisitionSubmit.ts).
 */
async function resolveDepartmentIdExact(departmentName: string): Promise<number | null> {
	if (!departmentName) return null;
	const target = departmentName.trim().toLowerCase();
	const res: any = await directusServerJson(
		`/items/department?filter[is_active][_eq]=true&fields=id,nama_department&limit=-1`
	);
	const rows = res?.data || [];
	const match = rows.find((d: any) => String(d.nama_department || '').trim().toLowerCase() === target);
	return match?.id ?? null;
}

export interface PengajuanLapanganItemInput {
	nama_barang: string;
	identitas_barang_id?: number | null;
	quantity: number;
	units: string;
	harga?: number | null;
	/** PR-09: paritas dengan admin — dipakai bila form mengirimnya (semuanya opsional). */
	notes?: string | null;
	is_sparepart?: boolean;
	ciketing_item_id?: number | null;
}

export interface CreatePengajuanLapanganInput {
	requesterId: number | null;
	namaPengaju: string;
	department: string;
	urgency: string;
	tujuanPengajuan: string;
	tanggalDibutuhkan?: string | null;
	isNonStock: boolean;
	items: PengajuanLapanganItemInput[];
	clientTxnId?: string | null;
	kategoriPembelian?: string | null;
	projectId?: number | null;
	customFieldsData?: Record<string, any> | null;
	/** Uji Kebutuhan Beli Fase 4.2: prefill dari WO auto-created oleh P2H No-Go. */
	workOrderId?: number | string | null;
	/** Fase 3 Kontrol Patroli (15 Sep 2026): ruangan tujuan (opsional) — dasar GATE.CHECKLIST.AREA_NOT_DONE. */
	areaId?: number | null;
	/** Fase 5 (Pertajam Modul Ciketing & MB v2) — workshop tujuan Umum Workshop (projectId null). */
	workshopId?: number | null;
	/**
	 * Pengajuan Darurat Atas Nama (dari lapangan). SUDAH diotorisasi route (Leader/Wakil/Supervisor +
	 * pemohon anggota proyek). requesterId/namaPengaju = PEMOHON. PR ditahan "Menunggu Konfirmasi Pemohon"
	 * — belum masuk approval/katalog; keduanya didaftarkan admin saat pemohon konfirmasi.
	 */
	atasNama?: { pengisiKaryawanId: number; alasan: string } | null;
}

export async function createPengajuanLapangan({
	requesterId,
	namaPengaju,
	department,
	urgency,
	tujuanPengajuan,
	tanggalDibutuhkan = null,
	isNonStock,
	items,
	clientTxnId = null,
	kategoriPembelian = null,
	projectId = null,
	customFieldsData = null,
	workOrderId = null,
	areaId = null,
	workshopId = null,
	atasNama = null
}: CreatePengajuanLapanganInput) {
	// PR-09: tanpa pemilik, hak edit & Self-Approval Lock mati dan katalog menunjuk orang yang salah — tolak di awal.
	if (!requesterId) {
		throw new Error('Akun Anda belum terhubung ke data karyawan — hubungi HR untuk pemetaan identitas sebelum mengajukan pembelian.');
	}

	const cleanItems = (items || []).filter((it) => it.nama_barang?.trim() && num(it.quantity) > 0);
	if (!cleanItems.length) throw new Error('Minimal 1 item diperlukan');

	// Fase 0 Penajaman PR (24 Agu 2026): kategori_pembelian wajib, validasi selalu dijalankan.
	const v = await validateKategoriPembelian({ kategoriKode: kategoriPembelian, projectId, hasAttachment: false, customFieldsData: customFieldsData || {} });
	if (!v.valid) throw new Error(v.errors.join('; '));

	// Fase 3 Kontrol Patroli — GATE.CHECKLIST.AREA_NOT_DONE. Melempar bila mode='hard'
	// dan checklist area gagal; kalau 'soft' hanya menandai (lihat checklistGateStatus di bawah).
	const checklistGateStatus = await checkChecklistAreaGate(areaId);
	// Fase 3.3 — GATE.MAINTENANCE.P2H_NOT_DONE, dari equipment_id yang terdeteksi di v.equipmentId.
	const p2hGateStatus = await checkP2hGate(v.equipmentId);
	// Fase 3 — GATE.PATROL.MIN_COMPLIANCE & GATE.CHECKLIST.CRITICAL_OPEN.
	const patrolGateStatus = await checkPatrolMinComplianceGate(areaId);
	const criticalOpenGateStatus = await checkCriticalOpenGate(areaId);

	// Idempotensi (B5/0.8): submit kedua dengan client_txn_id yang sama mengembalikan
	// baris lama, bukan duplikat — pola sama dengan master_pengajuan.client_txn_id.
	if (clientTxnId) {
		const existing: any = await directusServerJson(
			`/items/pengajuan?filter[client_txn_id][_eq]=${encodeURIComponent(clientTxnId)}&limit=1`
		).catch(() => null);
		if (existing?.data?.length) {
			return { id: existing.data[0].id, reused: true };
		}
	}

	const departmentId = await resolveDepartmentIdExact(department).catch(() => null);

	// B1: stock_gate_status turunan dari is_non_stock — jasa/non-stok lewati Gerbang
	// Stok Inventory sepenuhnya, tidak lagi selalu 'menunggu_cek_stok'.
	const stockGateStatus = isNonStock ? 'tidak_berlaku' : 'menunggu_cek_stok';
	const isOnBehalf = !!atasNama;
	const statusAwal = isOnBehalf ? 'Menunggu Konfirmasi Pemohon' : 'Menunggu Review Inventory';
	const statusKanonik = await resolveStatusKanonik(statusAwal).catch(() => null);

	const totalAmount = cleanItems.reduce((sum, it) => sum + num(it.quantity) * num(it.harga), 0);

	const created: any = await directusServerJson('/items/pengajuan', {
		method: 'POST',
		body: JSON.stringify({
			nama_pengaju: namaPengaju,
			// PR-09: pemilik PR (admin sudah mengisi sejak Fase 3 Penajaman PR); lapangan dulu kosong.
			pengaju_karyawan_id: requesterId,
			department,
			department_id: departmentId,
			urgency: urgency || 'Normal',
			tujuan_pengajuan: tujuanPengajuan,
			tanggal_dibutuhkan: tanggalDibutuhkan || null,
			payment_method: 'Transfer',
			is_non_stock: isNonStock,
			stock_gate_status: stockGateStatus,
			area_id: areaId || null,
			checklist_gate_status: checklistGateStatus,
			p2h_gate_status: p2hGateStatus,
			patrol_gate_status: patrolGateStatus,
			critical_open_gate_status: criticalOpenGateStatus,
			status: statusAwal,
			status_kanonik: statusKanonik,
			...(atasNama ? { is_on_behalf: true, pemohon_status: 'menunggu', pengisi_karyawan_id: atasNama.pengisiKaryawanId, alasan_darurat: atasNama.alasan } : {}),
			client_txn_id: clientTxnId,
			kategori_pembelian: kategoriPembelian,
			project_id: projectId,
			workshop_id: workshopId || null,
			work_order_id: workOrderId || null,
			custom_fields_data: customFieldsData,
			department_manager_approved: false,
			department_manager_rejected: false,
			inventory_approved: false,
			inventory_rejected: false,
			procurement_approved: false,
			procurement_rejected: false,
			finance_approved: false,
			finance_rejected: false,
			direktur_approved: false,
			direktur_rejected: false,
			general_manager_approved: false,
			general_manager_rejected: false,
			hrd_approved: false,
			hrd_rejected: false
		})
	});
	const pengajuanId = created?.data?.id;
	if (!pengajuanId) throw new Error('Gagal membuat pengajuan');

	// PR-08: simpan item secara ATOMIK. Dulu Promise.all + .catch(warn) membuat item yang gagal diam-diam hilang
	// (PR "sukses" kurang/tanpa item). Sekarang satu item gagal = item tersimpan + header PR dibatalkan,
	// error menyebut nama item. Approval request & katalog dibuat SETELAH blok ini.
	await saveItemsAtomically({
		items: cleanItems,
		createItem: (item) =>
			directusServerJson('/items/items_pengajuan', {
				method: 'POST',
				body: JSON.stringify({
					request_id: pengajuanId,
					nama_barang: item.nama_barang,
					identitas_barang_id: item.identitas_barang_id || null,
					quantity: String(num(item.quantity)),
					units: item.units,
					harga: item.harga ?? null,
					ciketing_item_id: item.ciketing_item_id || null,
					notes: String(item.notes || '').trim() || null,
					is_sparepart: !!item.is_sparepart,
					// kategori_item 'sparepart' mengaktifkan rule G_WO_ACTIVE (paritas admin).
					kategori_item: item.is_sparepart ? 'sparepart' : null,
					status: 'Menunggu Pembelian'
				})
			}),
		deleteItem: (id) => directusServerJson(`/items/items_pengajuan/${id}`, { method: 'DELETE' }),
		deleteHeader: () => directusServerJson(`/items/pengajuan/${pengajuanId}`, { method: 'DELETE' }),
		onRollbackError: (what, err) =>
			console.error(`[procurementSubmit] rollback PR #${pengajuanId} gagal (${what}):`, (err as Error)?.message || err)
	});

	// Atas Nama: ditahan sampai pemohon konfirmasi (admin yang mendaftarkan approval + katalog, requester = pemohon).
	if (isOnBehalf) return { id: pengajuanId, reused: false };

	// Approval Engine (mirror/audit, best-effort) — sama moduleKey dengan sisi Admin
	// (procurementApi.js::submitPengajuan) supaya konsisten di Inbox terpusat.
	let approvalRequestId: string | null = null;
	try {
		const approvalResult = await createApprovalRequest({
			moduleKey: 'procurement.po',
			sourceCollection: 'pengajuan',
			sourceId: pengajuanId,
			title: `Pengajuan Pembelian #${pengajuanId}`,
			summary: tujuanPengajuan || null,
			amount: totalAmount || null,
			departmentKey: department || null,
			requesterId
		});
		approvalRequestId = approvalResult?.id || null;
	} catch (e: any) {
		console.warn('[approvalEngine] gagal mendaftarkan PR lapangan ke Inbox terpusat:', e?.message);
	}

	// B2: daftarkan ke katalog master_pengajuan (dulu tidak sama sekali dari lapangan).
	// Best-effort — tidak boleh menggagalkan pengajuan aslinya bila gagal.
	try {
		await createMasterPengajuanEntry({
			kategori: 'procurement',
			jenisPengajuan: 'PR',
			judul: `Pengajuan Pembelian #${pengajuanId}`,
			deskripsi: tujuanPengajuan || null,
			totalAmount: totalAmount || 0,
			// PR-09: dulu `requesterId || pengajuanId` memakai id PR sebagai id karyawan di master_pengajuan.
			pengajuId: requesterId,
			departmentKey: department || null,
			detailRefCollection: 'pengajuan',
			detailRefId: pengajuanId,
			approvalRequestId,
			sourceApp: 'field',
			clientTxnId
		});
	} catch (e: any) {
		console.warn('[masterPengajuanSubmit] gagal mendaftarkan PR lapangan ke katalog:', e?.message);
	}

	return { id: pengajuanId, reused: false };
}
