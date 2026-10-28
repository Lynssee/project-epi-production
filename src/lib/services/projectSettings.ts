// src/lib/services/projectSettings.ts
// Modul pembaca system_settings namespace project.* (Revamp Project Management v2, Fase 0).
// Sama polanya dengan inventorySettings.ts: default di kode wajib ada untuk setiap kunci,
// cache in-memory 5 menit, gagal-lunak ke default bila Directus tak terjangkau/kunci belum ada.
// Ditulis terpisah dari versi admin (JS) — bukan copy-paste — karena repo ini TypeScript.

import { writable, get } from 'svelte/store';
import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';

const NAMESPACE = 'project.';
const CACHE_TTL_MS = 5 * 60 * 1000;

export type ProjectSettingsMap = Record<string, any>;

// Default bawaan — nilai status/label WAJIB identik dengan projectUtils STATUS_CANONICAL_ORDER/STATUS_LABEL_MAP
// di admin (erp-epi-1). Ini hanya salinan operasional untuk fallback; sumber kebenaran tetap Directus.
export const PROJECT_SETTINGS_DEFAULTS: ProjectSettingsMap = {
	'project.status.canonical_order': ['on progress', 'waiting', 'hold', 'repair', 'draft', 'selesai', 'closed'],
	'project.status.labels': {
		'on progress': 'On Progress',
		waiting: 'Waiting',
		hold: 'Hold',
		repair: 'Repair',
		draft: 'Draft',
		selesai: 'Selesai',
		closed: 'Closed'
	},
	'project.status.colors': {},
	'project.status.done_set': ['selesai', 'closed', 'cancel', 'cancelled'],
	'project.list.page_size': 25,
	'project.list.auto_refresh_ms': 60000,
	'project.list.search_debounce_ms': 300,
	'project.list.filter_debounce_ms': 400,
	'project.deadline.warning_days': 7,
	// Fase 5b (audit hidden cost #1051): alat pinjaman aktif yang tidak muncul di laporan harian selama N hari ditandai
	// "menganggur" (tetap menanggung biaya penyusutan harian). ≤ 0 = peringatan dimatikan. Diatur di Setelan Project Management.
	'project.alat.idle_days': 5,
	'project.ciketing.keywords': ['sandblasting', 'sandblast', 'power tool', 'blasting'],
	'project.visibility.leader_rule': { require_charter_approved: true, require_rap_gt_zero: true },
	// Koordinator workshop: jabatan/posisi yang boleh melihat SELURUH proyek di satu
	// workshop, bukan hanya proyek yang leader-nya dia. Kunci = nilai kolom
	// projects.workshop; nilai = daftar nama posisi / roleId (dicocokkan case-insensitive,
	// harus persis). Tambah baris di system_settings untuk workshop/jabatan baru —
	// tanpa ubah kode.
	'project.scope.workshop_coordinators': {
		ciketing: ['CIKETING PROJECT COORDINATOR'],
		balaraja: ['BALARAJA PROJECT COORDINATOR']
	},
	'project.qcts.weights': { scope: 25, time: 30, cost: 25, quality: 20 },
	'project.qcts.bands': { excellent: 90, good: 70, warning: 50, critical: 30 },
	'project.evm.warning': { cpi: 0.9, spi: 0.9 },
	'project.evm.period': 'weekly',
	'project.workdays_per_week': 6,
	'project.feature.qcts_enabled': false,
	'project.feature.evm_enabled': false,
	'project.feature.wbs_enabled': false,
	'project.feature.quality_enabled': false,
	// Fase 5.3 — default TRUE, sinkron dgn admin (erp-epi-1) projectSettings.js.
	'project.feature.risk_enabled': true,
	'project.feature.sj_equipment_gate_enabled': false,
	'project.wbs.max_depth': 4,
	'project.quality.pass_rate_penalty_per_capa': 5,

	// --- Penajaman Finance CVP, Fase 5 (Dashboard Lapangan) ---
	// Kartu posisi biaya proyek untuk Project Leader. Konsisten dgn pola app ini: nominal
	// rupiah DISEMBUNYIKAN dari view leader secara default (persen & rasio saja). Admin
	// membuka nominal per-kebijakan lewat system_settings tanpa ubah kode.
	'project.field_bep.enabled': true,
	'project.field_bep.show_rupiah': false,
	'project.field_bep.show_overhead_nominal': false,
	'project.field_bep.burn_rate_window_days': 7,
	'project.field_bep.over_plafon_warn_pct': 100,
	// Biaya Belum Terealisasi di Dashboard Lapangan (chip "dana tertahan di pusat" + Safe-Spend + skenario terburuk di kartu BEP).
	// PERSEN saja. Sinkron dengan admin (erp-epi) projectSettings.js; false = disembunyikan dan server admin tidak memuat komitmen.
	'project.field_finance.show_unrealized': true,

	// --- Forecast Keuangan Global Fase 4 (Visibilitas AR Lapangan) ---
	// Status penagihan termin proyek untuk Project Leader. Sama pola dgn field_bep:
	// nominal rupiah DISEMBUNYIKAN dari view leader secara default — hanya status
	// (Lunas/Menunggu Bayar/Sudah Terbit Invoice/Belum Ditagih). Admin membuka nominal
	// lewat system_settings tanpa ubah kode bila kebijakan berubah.
	'project.field_penagihan.enabled': true,
	'project.field_penagihan.show_rupiah': false,

	'project.risk.likelihood_labels': ['Sangat Jarang', 'Jarang', 'Kadang', 'Sering', 'Sangat Sering'],
	'project.risk.severity_labels': ['Sangat Rendah', 'Rendah', 'Sedang', 'Tinggi', 'Sangat Tinggi'],
	'project.dashboard.widgets': [
		{ id: 'summary_band', label: 'Ringkasan Band Kesehatan', visible: true, order: 1 },
		{ id: 'project_table', label: 'Tabel Proyek', visible: true, order: 2 }
	],

	// --- Site Survey & Mobilisasi (Pertajam Perencanaan & Persiapan Proyek v2, Fase 5) —
	// SATU sumber, sama persis dgn admin (erp-epi-1) projectSettings.js: ubah sekali, berlaku 2 sisi.
	'project.mobilization.checklist': [
		{ id: 'apd', label: 'APD lengkap', wajib: true },
		{ id: 'izin_kerja', label: 'Izin kerja/dokumen K3 ada', wajib: true },
		{ id: 'akomodasi', label: 'Akomodasi & transportasi tim siap', wajib: false },
		{ id: 'alat_berangkat', label: 'Alat & material sudah dimuat', wajib: false }
	],

	// --- Navigasi (Pertajam Navigasi Project v2, Fase 0) ---
	'project.nav.field_tabs': [
		{ id: 'informasi', label: 'Informasi', emoji: 'ℹ️', order: 1 },
		{ id: 'keuangan', label: 'Keuangan', emoji: '💰', order: 2 },
		{ id: 'laporan', label: 'Laporan', emoji: '📋', order: 3 },
		{ id: 'progress', label: 'Progress', emoji: '📅', order: 4 },
		{ id: 'manpower', label: 'Manpower', emoji: '👷', order: 5 },
		{ id: 'barang', label: 'Barang', emoji: '📦', order: 6 },
		{ id: 'hse', label: 'HSE', emoji: '🦺', order: 7 },
		{ id: 'dokumen', label: 'Dokumen', emoji: '📁', order: 8 },
		{ id: 'kirim', label: 'Kirim', emoji: '📤', order: 9 }
	],
	'project.nav.field_subtabs': {
		informasi: [
			{ id: 'charter', label: 'Charter', emoji: '📋' },
			{ id: 'info', label: 'Info', emoji: 'ℹ️' }
		],
		laporan: [
			{ id: 'report', label: 'Report', emoji: '📋' },
			{ id: 'laporan-harian', label: 'Laporan Harian', emoji: '📆' }
		],
		progress: [
			{ id: 'timeline', label: 'Timeline', emoji: '📅' },
			{ id: 'wbs', label: 'WBS', emoji: '🌳' },
			{ id: 'list-pekerjaan', label: 'List Pekerjaan', emoji: '📝' },
			{ id: 'packing-list', label: 'Packing List', emoji: '📦' }
		],
		manpower: [
			{ id: 'manpower-spk', label: 'Manpower & SPK', emoji: '👷' },
			{ id: 'project-leader', label: 'Project Leader', emoji: '👨‍💼' },
			{ id: 'absensi', label: 'Absensi', emoji: '🕒' }
		],
		barang: [
			{ id: 'list-permintaan', label: 'List Permintaan', emoji: '📦' },
			{ id: 'status-permintaan', label: 'Status Permintaan', emoji: '📊' },
			{ id: 'stock-management', label: 'Stock Management', emoji: '🏢' }
		],
		hse: [],
		dokumen: [],
		kirim: []
	},
	'project.nav.leader_hidden_tabs': ['gajian'],
	'project.nav.breadcrumb_enabled': true,
	'project.nav.deep_link_enabled': true,

	// --- Evaluasi & Closing Proyek (Pertajam Tahap Evaluasi & Closing v1, Fase 0) ---
	'project.closure.workflow_enabled': false, // master switch — mati dulu sampai diuji
	'project.closure.auto_final_report_enabled': true,
	'project.closure.evaluation_required': true,
	'project.closure.presentation_required': true,
	'project.closure.approval_required': true,
	'project.closure.kpi_bridge_enabled': true,
	'project.closure.gate_statuses': ['selesai', 'closed'],
	'project.closure.eval_dimensions': [
		{ key: 'scope', label: 'Scope / Kesesuaian', weight: 20 },
		{ key: 'time', label: 'Ketepatan Waktu', weight: 25 },
		{ key: 'cost', label: 'Kendali Biaya', weight: 25 },
		{ key: 'quality', label: 'Kualitas / QC', weight: 20 },
		{ key: 'hse', label: 'HSE', weight: 10 }
	],
	'project.closure.grade_bands': { A: 85, B: 70, C: 55, D: 0 },
	'project.closure.presentation_presenter_roles': ['project_leader'],
	'project.closure.presentation_approver_roles': ['manager', 'director'],
	'project.closure.kpi_template_name': 'Kinerja Proyek',
	'project.closure.kpi_indicator_name': 'Skor Evaluasi Proyek',
	'project.closure.kpi_aggregation': 'average',
	'project.closure.reminder_enabled': false,
	'project.closure.presentation_reminder_days': 3,
	'project.closure.leader_checklist': [
		{ id: 'dokumen_lengkap', label: 'Dokumen proyek lengkap (kontrak, BAST, dsb)', wajib: true },
		{ id: 'qc_selesai', label: 'QC/QCTS proyek selesai', wajib: true },
		{ id: 'foto_lengkap', label: 'Foto progress akhir & serah terima ada', wajib: true },
		{ id: 'material_kembali', label: 'Sisa material/alat sudah dikembalikan', wajib: false }
	],

	// --- Eksekusi & Monitoring Proyek — Fase 1 (satu sumber kebenaran progres),
	// SATU sumber dengan admin (erp-epi-1) projectSettings.js: nilai sama, jangan diubah sepihak. ---
	'project.progress.source': 'weighted', // 'weighted' | 'fisik' | 'manual'
	'project.progress.weights': { fisik: 0.5, biaya: 0.3, waktu: 0.2 },

	// --- Eksekusi & Monitoring Proyek — Fase 2 (cockpit monitoring, dibaca admin) ---
	'project.feature.monitor_cockpit_enabled': false,
	'project.monitor.refresh_ms': 60000,
	// PRJ-12 — kategori RAP yang boleh dikirim lewat Packing List (BARANG saja; jasa/man_power/operasional
	// bukan barang). Diubah lewat setelan project (tanpa ubah kode).
	// PRJ-24 — field "Pos RAP" di form PA. MATI sampai kolom items_pengajuan_anggaran.rab_budget_id diterapkan di Directus
	// (mengirim kolom yang belum ada = 403 untuk SELURUH pengajuan). Nyalakan di setelan project setelah skema siap.
	'project.pa.rab_link_enabled': false,
	// PRJ-25: nominal PA di atas ini + pemeriksa gate tak terjangkau => wajib alasan tertulis (fail-open bertingkat). Rupiah.
	'project.pa.fail_open_threshold': 5000000,
	// PRJ-29: aturan routing wizard "Keluar Uang" yang boleh diubah Finance tanpa deploy. Kunci = jenis hasil routing
	// (bbm | jasa | gaji | pa_proyek | pa_kaskecil | beli_lokal | reimburse | kasbon | kaskecil_ess); nilai = { href?, label?, why? }.
	// Kosong = pakai default di wizard.
	'project.money_routing': {},
	// PRJ-29 §4.5: siapa boleh input Aktualisasi manual. { mode:'warn'|'restrict', allowed_roles:[roleId] }. Bawaan warn = semua boleh (+peringatan, cek duplikat).
	'project.aktualisasi.manual': { mode: 'warn', allowed_roles: [] },
	// PRJ-26: master satuan / kata kunci kategori PL / chip barang cepat per jenis pekerjaan. null/{} = pakai default di kode
	// (shared/unitMaster.ts, shared/plCategoryGuess.ts, shared/plQuickItems.ts). Bentuk: units [{code,label,aliases}],
	// category_keywords { packing_supplier:[kata…] }, quick_items { "<jenis_project>": [{name,category,unit}], "*": [...] }.
	'project.units': null,
	'project.pl.category_keywords': null,
	'project.pl.quick_items': {},
	'project.pl.allowed_rap_categories': ['supplier', 'consumable', 'safety', 'sewa_alat', 'material'],
	'project.monitor.thresholds': {
		cost_pct_warning: 90,
		cost_pct_critical: 100,
		report_stale_days_warning: 3,
		report_stale_days_critical: 7
	},

	// --- Eksekusi & Monitoring Proyek — Fase 3 (input lapangan). Scaffold kunci saja —
	// BELUM disambung ke validasi form laporan/[project_id] (perilaku wajib-isi saat ini
	// tetap hardcode di form, sengaja tidak diubah dulu sampai ada keputusan eksplisit
	// field mana yang boleh dimatikan per-proyek). Nilai default di bawah mencerminkan
	// aturan wajib yang SUDAH berlaku di form saat ini, bukan aturan baru.
	'project.report.required_fields': [
		'schedule', 'tomorrow_plan', 'progress', 'material_used', 'manpower_worker',
		'attendance_photo', 'progress_photo'
	],
	'project.report.late_after_hours': 20,

	// --- Project Phase Wizard (Alur Proyek End-to-End, Fase A) — SATU sumber dengan admin
	// (erp-epi-1) projectSettings.js: nilai sama, jangan diubah sepihak. Additive murni —
	// hanya memvisualisasikan gate yang sudah ada, tidak menambah gate baru. Default OFF.
	'project.wizard.enabled': false,
	'project.wizard.phases': [
		{
			phase_key: 'inisiasi', phase_order: 1, phase_label: 'Inisiasi', phase_icon: '🚀', phase_color: '#3B82F6',
			description: 'Proyek dibuat dari SO, leader dan customer ditentukan',
			hint_text: 'Pastikan SO sudah terhubung, customer terisi, dan jenis pekerjaan ditentukan',
			gate_type: 'auto',
			checklist_items: [
				{ id: 'so_linked', label: 'SO terhubung', source: 'auto', wajib: true },
				{ id: 'customer_set', label: 'Customer terisi', source: 'auto', wajib: true }
			],
			pic_roles: ['admin', 'sales'], target_duration_days: 3, enabled: true
		},
		{
			phase_key: 'perencanaan', phase_order: 2, phase_label: 'Perencanaan', phase_icon: '📝', phase_color: '#8B5CF6',
			description: 'Charter, RAB, dan timeline proyek disusun',
			hint_text: 'Lengkapi Charter, RAB, dan Timeline Planning — ini yang dicek Readiness Gate sebelum proyek boleh mulai',
			gate_type: 'readiness', checklist_items: [], pic_roles: ['pm', 'admin'], target_duration_days: 5, enabled: true
		},
		{
			phase_key: 'persiapan', phase_order: 3, phase_label: 'Persiapan & Mobilisasi', phase_icon: '🧰', phase_color: '#F59E0B',
			description: 'Site survey dan mobilisasi tim ke lokasi',
			hint_text: 'Selesaikan checklist mobilisasi (APD, izin kerja, dsb) sebelum tim berangkat ke site',
			gate_type: 'mobilization', checklist_items: [], pic_roles: ['leader'], target_duration_days: 5, enabled: true
		},
		{
			phase_key: 'eksekusi', phase_order: 4, phase_label: 'Eksekusi & Monitoring', phase_icon: '⚙️', phase_color: '#10B981',
			description: 'Pekerjaan berjalan, progress dan laporan harian dipantau',
			hint_text: 'Isi laporan harian secara rutin — progress fisik 100% atau tanggal akhir tercapai akan membuka fase Evaluasi',
			gate_type: 'closure_eligibility', checklist_items: [], pic_roles: ['leader', 'admin'], target_duration_days: null, enabled: true
		},
		{
			phase_key: 'evaluasi', phase_order: 5, phase_label: 'Evaluasi', phase_icon: '📊', phase_color: '#6366F1',
			description: 'Laporan akhir, evaluasi 5 dimensi, dan presentasi ke manajemen',
			hint_text: 'Generate laporan akhir, isi evaluasi 5 dimensi (Scope/Time/Cost/Quality/HSE), lalu jadwalkan presentasi',
			gate_type: 'evaluation', checklist_items: [], pic_roles: ['pm', 'manager'], target_duration_days: 7, enabled: true
		},
		{
			phase_key: 'closing', phase_order: 6, phase_label: 'Closing', phase_icon: '✅', phase_color: '#059669',
			description: 'BAST, QC, dan approval closing oleh manajemen',
			hint_text: 'Pastikan BAST, QC/QCTS, dan foto serah terima lengkap sebelum minta approval closing',
			gate_type: 'closure_approval', checklist_items: [], pic_roles: ['admin', 'leader'], target_duration_days: 3, enabled: true
		}
	],

	// --- Standarisasi Spek Teknis Subtask, BOM & Equipment per Fase, Forecast Kebutuhan ke
	// Admin Dept, Mobilisasi Bertahap v2 (TAJAM), Fase 6 (dashboard lapangan) — SATU sumber,
	// sama persis dgn admin (erp-epi-1) projectSettings.js. Lapangan HANYA butuh mob_stages
	// (label tahap mobilisasi untuk badge & sheet) dan master switch — katalog BOM lengkap
	// (project.timeline.task_standards) tidak dibaca di sini, itu urusan drawer admin.
	'project.forecast.enabled': false,
	'project.forecast.mob_stages': [
		{ key: 'tahap_1', label: 'Tahap 1 — Persiapan & Blasting' },
		{ key: 'tahap_2', label: 'Tahap 2 — Coating & Finishing' }
	],

	// --- Back-to-Back Payment Scheme (Rencana B2B Payment, Fase 2, 3 Okt 2026) — SATU sumber,
	// sama persis dgn admin (erp-epi-1) projectSettings.js. Lapangan HANYA butuh master switch
	// (tampilkan/sembunyikan section B2B) — keputusan Lead: PL TIDAK lihat nama vendor/subkon,
	// hanya jumlah item + label generik termin (privasi komersial vendor).
	'project.b2b.enabled': false,
	'project.b2b.field_show_b2b_status': true
};

/** Store reaktif untuk komponen Svelte — selalu berisi default + override, tidak pernah kosong. */
export const projectSettingsStore = writable<ProjectSettingsMap>({ ...PROJECT_SETTINGS_DEFAULTS });

let cache: ProjectSettingsMap | null = null;
let cachedAt = 0;
let inflight: Promise<ProjectSettingsMap> | null = null;

function parseValue(setting_type: string, raw: string | null | undefined, fallback: any): any {
	if (raw == null) return fallback;
	try {
		switch (setting_type) {
			case 'number':
				return Number(JSON.parse(raw));
			case 'boolean':
				return Boolean(JSON.parse(raw));
			case 'json':
			case 'list':
				return JSON.parse(raw);
			case 'enum':
				try {
					return JSON.parse(raw);
				} catch {
					return raw;
				}
			default:
				try {
					return JSON.parse(raw);
				} catch {
					return raw;
				}
		}
	} catch (err) {
		console.warn(`[projectSettings] Gagal parse "${raw}", pakai default.`, err);
		return fallback;
	}
}

/**
 * Muat setelan project.* dari Directus. Aman dipanggil berkali-kali — di-cache 5 menit
 * dan gagal-lunak ke default bila Directus tak terjangkau. Kontrak: tidak pernah blank.
 * @param force - lewati cache
 */
export async function loadProjectSettings(force = false): Promise<ProjectSettingsMap> {
	const now = Date.now();
	if (!force && cache && now - cachedAt < CACHE_TTL_MS) return cache;
	if (inflight) return inflight;

	inflight = (async () => {
		const merged: ProjectSettingsMap = { ...PROJECT_SETTINGS_DEFAULTS };
		try {
			const rows = await directus.request(
				readItems('system_settings' as any, {
					filter: { setting_key: { _starts_with: NAMESPACE } } as any,
					limit: -1
				})
			);
			for (const row of rows as any[]) {
				const key = row.setting_key;
				if (!(key in merged)) continue; // kunci tak dikenal diabaikan, bukan error
				merged[key] = parseValue(row.setting_type, row.setting_value, PROJECT_SETTINGS_DEFAULTS[key]);
			}
		} catch (err) {
			console.warn('[projectSettings] Directus tak terjangkau — pakai default.', err);
			try {
				handleDirectusError(err);
			} catch {
				// sudah di-log di atas; tetap lanjut dengan default
			}
		}
		cache = merged;
		cachedAt = Date.now();
		projectSettingsStore.set(merged);
		inflight = null;
		return merged;
	})();

	return inflight;
}

/** Baca satu kunci secara sinkron dari cache (atau default bila belum pernah dimuat). */
export function getProjectSetting(key: string): any {
	const source = cache || get(projectSettingsStore) || PROJECT_SETTINGS_DEFAULTS;
	return key in source ? source[key] : PROJECT_SETTINGS_DEFAULTS[key];
}

/** Baca seluruh setelan project.* secara sinkron (default + override yang sudah dimuat). */
export function getAllProjectSettings(): ProjectSettingsMap {
	return cache ? { ...cache } : { ...PROJECT_SETTINGS_DEFAULTS };
}

/** Paksa muat ulang dari Directus. */
export function reloadProjectSettings(): Promise<ProjectSettingsMap> {
	return loadProjectSettings(true);
}
