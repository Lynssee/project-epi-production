<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { rowUiVolume, rowExtra, applyRowExtra } from '$lib/utils/progressRowPreserve';
	import {
		IconArrowLeft, IconHistory, IconCalendarTime, IconChartLine,
		IconPackage, IconUsers, IconAlertCircle, IconDeviceFloppy,
		IconSend, IconPlus, IconTrash, IconLoader2, IconListCheck,
		IconStack2, IconAlertTriangle, IconTool, IconReceipt, IconCamera,
		IconLock, IconPencil, IconCheck, IconTrendingUp, IconSparkles,
		IconZoomIn, IconPhoto, IconX, IconTarget, IconInfoCircle,
		IconUserCheck, IconClock, IconSearch, IconMinus, IconCalendarEvent, IconTimeline,
		IconCash, IconCreditCard, IconBuildingBank, IconWallet, IconFileInvoice, IconArrowUpRight,
		IconBolt, IconCoffee, IconShieldCheck, IconCopy, IconFilter,
		IconSun, IconMoon, IconCircleCheck, IconCircleDashed, IconAdjustmentsHorizontal, IconArrowRight, IconBulb,
		IconRefresh, IconEye, IconExternalLink, IconGauge, IconLayoutDashboard, IconChartBar, IconCalendar,
		IconMapPin, IconBuilding, IconActivity, IconCircleX, IconBriefcase, IconFlame, IconFileText,
		IconChevronRight, IconTrendingDown, IconEraser, IconChevronUp, IconChevronDown,
		IconFileExport
	} from '@tabler/icons-svelte';
	import { onMount } from 'svelte';
	import { slide, fade } from 'svelte/transition';
	import { get } from 'svelte/store';
	import ProjectDetailModal from '$lib/components/project/ProjectDetailModal.svelte';
	import ProjectExportSheet from '$lib/components/project/ProjectExportSheet.svelte';
	let showExportSheet = $state(false);
	let metadataExpanded = $state(true);
	let soCustomer = $state<any>(null);
	let soDetails = $state<any[]>([]);
	let showProjectDetailModal = $state(false);
	import { getProjectById, getSoCustomerById, getSoCustomerByProjectId, getSoCustomerDetails, getProjectSoIds, getSoCustomerDetailsForSos, getProjectActualMaterials, updateProjectExpenseQty, getProjectBudgetExpenses, createProjectExpense, createPurchaseInvoice, updateProjectStatus, updateProject, getScurveBaselineBySoCustomer, getPlanningLossFactorPct } from '$lib/services/projects';
	import { getLatestProjectInspectionSummary, type ProjectInspectionSummary } from '$lib/services/inspectionApi';
	import { fetchProjectStockBalance, type ProjectStockBalanceRow } from '$lib/services/inventoryProyekOpname';
	import FieldSCurve from '$lib/components/shared/FieldSCurve.svelte';
	import KnowledgeCard from '$lib/components/inventory360/KnowledgeCard.svelte';
	import { submitReport, updateReport, uploadFile, getReports, getReportById } from '$lib/services/reports';
	import { getActiveCheckin, triggerAutoCheckout, getSiteCheckinSettings } from '$lib/services/siteCheckin';
	import GateCompletionWizard from '$lib/components/shared/GateCompletionWizard.svelte';
	import { evaluateLaporanHarianGates } from '$lib/utils/laporanHarianGates';
	import { fetchGateHints, applyGateHints } from '$lib/services/gateHintClient';
	import { checkTolerance, findMeasurableSpecFields } from '$lib/utils/qcToleranceChecker';
	import { computeDailyProductivity } from '$lib/utils/manpowerProductivity';

	// Wizard Kelengkapan Gate (26 Agu 2026) — pengganti alert() tunggal di sendReport()
	// untuk menampilkan seluruh bagian yang belum lengkap sekaligus, bisa diklik langsung
	// ke tabnya masing-masing. Fase 2 (Gate Transparan & Popup Benahi Data, 16 Sep 2026):
	// gate ditempeli hint dari admin (gateHintClient.ts) sebelum wizard dibuka.
	let gateWizardOpen = $state(false);
	let gateWizardGates = $state<any[]>([]);
	let gateWizardHintsUnavailable = $state(false);

	// UX-05 (correction plan site-visit-payroll, 27 Sep 2026): dulu submit laporan LANGSUNG
	// menutup check-in aktif diam-diam (lihat reports.ts) walau leader masih di lapangan.
	// Sekarang tanya eksplisit — leader yang memutuskan, bukan sistem menebak.
	let masihDiLokasiPromptOpen = $state(false);
	let masihDiLokasiReportId = $state<number | string | null>(null);
	let masihDiLokasiClosing = $state(false);
	// Paket 10 Site Visit Release §2.3 (SVR-29) — kunjungan aktif TERNYATA di proyek lain
	// (leader mengirim laporan proyek A saat masih tercatat di proyek B): info netral, TANPA
	// tombol tutup — laporan proyek A tidak boleh menutup kunjungan proyek B.
	let aktifDiLokasiLain = $state<string | null>(null);

	async function cekPromptMasihDiLokasi(reportId: number | string | undefined) {
		try {
			const [{ settings }, { record: activeCheckin }] = await Promise.all([
				getSiteCheckinSettings(),
				getActiveCheckin()
			]);
			if (!settings.auto_checkout_on_report || !activeCheckin) return;
			const proyekSama = activeCheckin.tipe_checkin === 'proyek' && String(activeCheckin.referensi_id) === String(projectId);
			if (proyekSama) {
				masihDiLokasiReportId = reportId ?? null;
				masihDiLokasiPromptOpen = true;
			} else {
				aktifDiLokasiLain = activeCheckin.nama_lokasi || 'lokasi lain';
				setTimeout(() => (aktifDiLokasiLain = null), 6000);
			}
		} catch {
			// Fail-soft mutlak — laporan yang sudah tersimpan tidak boleh terganggu oleh ini.
		}
	}

	async function handleCheckoutSekarang() {
		masihDiLokasiClosing = true;
		try {
			await triggerAutoCheckout(masihDiLokasiReportId, projectId);
		} finally {
			masihDiLokasiClosing = false;
			masihDiLokasiPromptOpen = false;
		}
	}

	// Post-Report WhatsApp Snapshot Prompt (Integrasi n8n Lapangan)
	let postReportSnapshotPromptOpen = $state(false);
	let sendingSnapshot = $state(false);
	let snapshotStatusMessage = $state<string | null>(null);
	// Audit hidden cost #1051: pemakaian material yang TIDAK masuk stok proyek (diketik manual / gagal tulis ledger)
	// sebelumnya hilang diam-diam. Diisi setelah simpan laporan; ditampilkan di dialog sukses sebagai peringatan non-blokir.
	let usageStockWarnings = $state<string[]>([]);

	async function handleSendPostReportSnapshot() {
		if (sendingSnapshot || !projectId) return;
		sendingSnapshot = true;
		snapshotStatusMessage = null;
		try {
			const res = await fetch('/api/automation/grand-po-dossier-snapshot', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					projectId: Number(projectId),
					stakeholder: 'operasional',
					reportId: savedReportId || null
				})
			});
			const data = await res.json().catch(() => ({}));
			if (res.ok && data?.success) {
				snapshotStatusMessage = `✅ Berhasil dikirim ke ${data.sentCount || 1} kontak WhatsApp via n8n!`;
				setTimeout(() => {
					postReportSnapshotPromptOpen = false;
					snapshotStatusMessage = null;
				}, 2500);
			} else {
				snapshotStatusMessage = `⚠️ ${data?.message || 'Gagal mengirim snapshot'}`;
			}
		} catch (e: any) {
			snapshotStatusMessage = `⚠️ Galat koneksi: ${e?.message || 'Server tidak merespons'}`;
		} finally {
			sendingSnapshot = false;
		}
	}
	function handleGateWizardGoToField(_fieldHint: string, tab: string | undefined) {
		// tab 'umum' (cuaca/jml tenaga/narasi) dirender di atas tab bar sebagai header — arahkan ke 'summary'
		if (tab) {
			if (tab === 'umum') activeTab = 'summary';
			else if (tab === 'toolbox' || tab === 'hse') activeTab = 'hse';
			else if (tab === 'area_kerja') activeTab = 'lainnya';
			else activeTab = tab;
		}
	}
	import { listManualActualByProject } from '$lib/services/timelineManualActual';
	import { authStore, getUserDisplay, shouldFilterProjectsByLeader } from '$lib/stores/auth';
	import { auth } from '$lib/firebase';
	import { pegangKursiLapangan, bolehAksesProyek, fetchDemisionerProjectIds, isDemisionerLeader } from '$lib/services/projectScope';
	import { createManpower } from '$lib/services/manpower';
	import { getAssignments } from '$lib/services/manpowerAssignment';
	import { idNum } from '$lib/shared/manpowerGroups';
	import { hariMundur, DEFAULT_DISIPLIN } from '$lib/shared/laporanKualitasRules';
	import { upsertTimesheetAbsensi, findAbsensiTodayOtherProject } from '$lib/services/manpowerAbsensi';
	import { reportUsageDeltas } from '$lib/services/projectUsageLedger';
	import { findMatchingMaterial, realUsageSkips, manualUsageItems } from '$lib/utils/materialManualMatch';
	import FilterSort from '$lib/components/FilterSort.svelte';
	import InfiniteScroll from '$lib/components/InfiniteScroll.svelte';
	import HistoryDetailModal from '$lib/components/project/HistoryDetailModal.svelte';
	import PdfBlobViewer from '$lib/components/project/PdfBlobViewer.svelte';
	import SubtaskPicker from '$lib/components/project/SubtaskPicker.svelte';
	import QuickSubtaskScheduleModal from '$lib/components/project/QuickSubtaskScheduleModal.svelte';
	import { hasValidSchedule } from '$lib/utils/timelineDisiplin.js';
	import { calculateProjectProgressPercentage, calculateCumulativeProjectProgress } from '$lib/utils/projectProgress';
	import { computeDailyTarget } from '$lib/utils/dailyTarget';
	import { FIELD_SERVICE_TYPES, fieldServiceTypeLabel } from '$lib/utils/fieldServiceTypes';
	import { vibrateTap } from '$lib/utils/haptic';
	import { getProjectEquipmentP2hStatus, type ProjectEquipmentP2hStatus } from '$lib/services/preventive';
	import HseGateWarning from '$lib/components/project/HseGateWarning.svelte';
	import { getProjectHseCompleteness, type ProjectHseCompleteness } from '$lib/services/hse';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { getCurrentPosition, type DevicePosition } from '$lib/utils/geoClient';
	import { watermarkPhoto, compressImageFile } from '$lib/utils/photoWatermark';
	import {
		saveReportDraft, loadReportDraft, clearReportDraft, hasAnyPhoto,
		type ReportDraftPhoto, type ReportDraftRecord
	} from '$lib/utils/offlineReportDraft';
	import { saveProjectMasterCache, loadProjectMasterCache, clearProjectMasterCache } from '$lib/utils/offlineProjectCache';
	import { secureAssetSrc, secureAssetHref, getSecureAssetUrl } from '$lib/actions/secureAsset';

	// Peta lokasi (Fase 6 open-source plan, MapLibre) — reportPosition sudah ditangkap
	// diam-diam untuk watermark foto, sebelumnya tidak pernah ditampilkan ke user.
	// Lazy-load (tombol, bukan otomatis) supaya maplibre-gl (~200KB) tidak membebani
	// halaman ini yang sudah berat & sering dibuka di lapangan dengan sinyal lemah.
	let showLocationMap = $state(false);
	let LocationMap = $state<any>(null);
	async function toggleLocationMap() {
		if (!LocationMap) LocationMap = (await import('$lib/components/shared/LocationMap.svelte')).default;
		showLocationMap = !showLocationMap;
	}
	import { SectionGuide, FieldHint, HelpIcon, StatusExplainer } from '$lib/components/hints';
	import ProcessGuideLink from '$lib/components/help/ProcessGuideLink.svelte';
	// Impor modul hint langsung (bukan lewat barrel $lib/data/hints) supaya hanya data
	// Laporan yang ikut bundle — penting di lapangan dengan koneksi lemah.
	import { laporanHints } from '$lib/data/hints/laporan';
	import { getHint } from '$lib/data/hints/getHint';

	/** Pintasan pembaca hint modul Laporan; memperingatkan kunci salah-ketik saat DEV. */
	const h = (key: string) => getHint(laporanHints, key, 'laporan-harian');

	// Satu baris tipe tenaga kerja (BORONGAN/HARIAN/dll) di form Manpower. Field newWorker*
	// adalah input sementara untuk menambah pekerja berikutnya (jam/lembur/standby per orang,
	// diambil dari fitur granular TimesheetForm.svelte yang sebelumnya tidak pernah dipakai).
	function freshManpowerGroup(role: string, notes: string = '') {
		return {
			role,
			count: 0,
			notes,
			workers: [] as any[],
			newWorkerInput: '',
			showDropdown: false,
			newWorkerJam: 8,
			newWorkerOtHours: 0,
			newWorkerStandby: false,
			newWorkerHoliday: false
		};
	}

	let projectId = $derived($page.params.project_id as string);
	let project = $state<any>(null);
	let isDemisioner = $derived(isDemisionerLeader(project));
	// Leader lama diizinkan merevisi laporannya sendiri bila statusnya revision_requested
	let canReviseOwnReport = $derived(
		isDemisioner && 
		savedReportId != null && 
		(reportStatus === 'revision_requested' || priorReportStatus === 'revision_requested')
	);
	let scurveBaseline = $state<{ d: string; p: number }[] | null>(null); // Fase 6/6.3 — baseline Kurva S dari penawaran
	let loading = $state(true);
	let submitting = $state(false);
	let uploadStatusText = $state('');
	let activeTab = $state('summary');
	let userName = $state('LEADER');
	let timelineCategories = $state<any[]>([]);
	// Modal Quick Auto-Schedule (Fase 3 Mitigasi Disiplin Jadwal)
	let quickScheduleModalOpen = $state(false);
	let quickScheduleSubtask = $state<any>(null);

	function openQuickSchedule(subtask: any) {
		quickScheduleSubtask = subtask;
		quickScheduleModalOpen = true;
	}

	function handleQuickScheduleSaved(updatedSubtask: any) {
		for (const cat of timelineCategories) {
			for (let i = 0; i < (cat.subtasks || []).length; i++) {
				if (String(cat.subtasks[i].id) === String(updatedSubtask.id)) {
					cat.subtasks[i] = { ...cat.subtasks[i], ...updatedSubtask };
					break;
				}
			}
		}
		timelineCategories = [...timelineCategories];
		vibrateTap();
	}
	let availableSubtasks = $state<any[]>([]);
	let actualMaterials = $state<any[]>([]);
	let loadingMaterials = $state(false);
	// Fase 3 (Rencana "Integrasi Status Stok Site Proyek & Log Penggunaan Material"): saldo fisik
	// project_stock_balance per item, TERPISAH dari "Info Stok RAP" (project_expenses.qty_remaining
	// di atas, anggaran) — ini sisa fisik hasil mutasi Surat Jalan masuk dikurangi laporan pemakaian.
	let siteStockByItemId = $state<Record<number, ProjectStockBalanceRow>>({});
	let loadingSiteStock = $state(false);
	let availableManpower = $state<any[]>([]);
	let isAddingWorker = $state(false);
	let activeWorkerRow = $state(-1);
	let budgetExpenses = $state<any[]>([]);
	let previousSpentMap = $state<Record<string | number, number>>({});
	let budgetReceiptFile = $state<{ file: File; name: string; url: string; uploadedId?: string | null } | null>(null);
	let isLocked = $state(false);
	let reportStatus = $state('draft');
	let savedReportId = $state<number | null>(null);
	// Fase 3 (Loop Perbaikan) — status & revisi_count SAAT laporan dimuat untuk diedit,
	// dipakai sendReport() mendeteksi resubmit atas laporan revision_requested.
	let priorReportStatus = $state('draft');
	let priorRevisiCount = $state(0);
	// Snapshot of material_used as loaded from the server, used to compute a delta
	// against the edited values so re-saving a report doesn't double-deduct RAB stock.
	let originalMaterialUsed = $state<any[]>([]);
	let updatingStatus = $state(false);
	let existingAttendancePhotos = $state<string[]>([]);
	let existingProgressPhotos = $state<string[]>([]);
	let existingIssuePhotos = $state<string[]>([]);
	let existingToolboxPhotos = $state<string[]>([]);
	let existingAreaKerjaPhotos = $state<string[]>([]);
	let existingBudgetReceipt = $state<string | null>(null);
	let existingWeekendPhotos = $state<string[]>([]);
	// Eksekusi & Monitoring Fase 3: GPS auto-tag foto (opsional, fail-soft — kalau lokasi
	// tak tersedia/ditolak, foto tetap tersimpan tanpa watermark seperti perilaku lama).
	let reportPosition = $state<DevicePosition | null>(null);
	// Eksekusi & Monitoring Fase 3: indikator "belum lapor hari ini" — true hanya setelah
	// pengecekan todayReport selesai dan memang belum ada laporan untuk tanggal ini.
	let hasReportedToday = $state(true);

	// Fase 1 Laporan Lapangan & Paritas ERP (16 Okt 2026) — ringkasan auto-pull untuk tab
	// HSE & K3 (PTW aktif, TBM hari ini, insiden terbuka, JSA berlaku). Sama persis dengan
	// yang dipakai <HseGateWarning> (Aturan #2: query per-relasi terpisah, sudah ada di
	// $lib/services/hse.ts) — dipanggil sekali per buka halaman, BUKAN per keystroke.
	let hseSummary = $state<ProjectHseCompleteness | null>(null);
	let loadingHseSummary = $state(false);

	async function loadHseSummary() {
		if (!projectId) return;
		loadingHseSummary = true;
		try {
			hseSummary = await getProjectHseCompleteness(projectId);
		} finally {
			loadingHseSummary = false;
		}
	}

	// Fase 2 Laporan Lapangan & Paritas ERP (16 Okt 2026) — ringkasan auto-pull untuk kartu
	// Kondisi Ambient & QC di tab Progress (hanya proyek kategori Coating/Blasting), ditambah
	// toleransi Rasio Material (reuse app_settings project/planning.loss_factor_pct).
	let inspectionSummary = $state<ProjectInspectionSummary | null>(null);
	let loadingInspectionSummary = $state(false);
	let lossFactorPct = $state(20);

	async function loadInspectionSummary() {
		if (!projectId) return;
		loadingInspectionSummary = true;
		try {
			inspectionSummary = await getLatestProjectInspectionSummary(projectId);
		} finally {
			loadingInspectionSummary = false;
		}
	}

	async function loadLossFactorPct() {
		lossFactorPct = await getPlanningLossFactorPct();
	}

	// Modal preview untuk nota/bukti pengeluaran
	let receiptPreviewModal = $state<{ open: boolean; url: string; title: string; isDirectusId?: boolean } | null>(null);

	function openReceiptModal(url: string, title: string, isDirectusId = false) {
		receiptPreviewModal = { open: true, url, title, isDirectusId };
	}

	function closeReceiptModal() {
		receiptPreviewModal = null;
	}

	// Metrik finansial real-time
	let totalAvailableBudgetPool = $derived(budgetExpenses.reduce((sum, exp) => {
		const rem = Math.max(0, (Number(exp.debit_amount) || Number(exp.expense_amount) || 0) - (previousSpentMap[exp.id] || 0));
		return sum + rem;
	}, 0));


	function parseField<T>(val: any, fallback: T): T {
		if (!val) return fallback;
		if (typeof val === 'string') {
			try { return JSON.parse(val); } catch { return fallback; }
		}
		return val as T;
	}

	const statusOptions = [
		{ value: 'draft', label: 'Draft' },
		{ value: 'submitted', label: 'Terkirim' },
		{ value: 'approved', label: 'Disetujui' },
		{ value: 'rejected', label: 'Ditolak' },
		// Fase 3 (Loop Perbaikan, 17 Sep 2026, menutup C6) — sebelumnya status ini ADA di
		// database (reports.status sudah menerima nilainya sejak lama) tapi tidak pernah
		// dipetakan di sini, sehingga badge diam-diam jatuh ke fallback 'Draft' — leader
		// tidak bisa membedakan laporannya diminta revisi atau memang belum dikirim.
		{ value: 'revision_requested', label: 'Perlu Diperbaiki' }
	];

	let statusBadgeClass = $derived(
		reportStatus === 'approved' ? 'ok' :
		reportStatus === 'rejected' ? 'err' :
		reportStatus === 'revision_requested' ? 'warn' :
		reportStatus === 'submitted' ? 'info' : 'warn'
	);
	let statusLabel = $derived(
		statusOptions.find(o => o.value === reportStatus)?.label ?? 'Draft'
	);

	const unsubAuth = authStore.subscribe((s) => {
		if (s.user) userName = getUserDisplay(s.user);
	});

	const tabs = [
		{ id: 'jadwal', label: 'Jadwal' },
		{ id: 'progress', label: 'Progress' },
		{ id: 'material', label: 'Material' },
		{ id: 'tenaga', label: 'Tenaga' },
		{ id: 'peralatan', label: 'Peralatan' },
		{ id: 'keuangan', label: 'Keuangan' },
		{ id: 'hse', label: 'HSE & K3' },
		{ id: 'lainnya', label: 'Lainnya' },
		{ id: 'history', label: 'History Laporan' }
	];

	let equipmentStats = $derived.by(() => {
		const total = projectEquipmentP2h.length;
		const checked = projectEquipmentP2h.filter(e => e.hasSession).length;
		const unChecked = total - checked;
		const go = projectEquipmentP2h.filter(e => e.hasSession && e.result === 'Go').length;
		const noGo = projectEquipmentP2h.filter(e => e.hasSession && e.result === 'No-Go').length;
		const sesiTerbuka = projectEquipmentP2h.filter(e => e.sesiTerbuka).length;
		return { total, checked, unChecked, go, noGo, sesiTerbuka };
	});

	async function refreshEquipmentP2h() {
		vibrateTap();
		await loadProjectEquipmentP2h();
	}

	function getOperationalStatusBadge(status?: string | null) {
		const s = (status || '').toLowerCase();
		if (s === 'operasional') return { label: 'Operasional', bg: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800' };
		if (s === 'maintenance') return { label: 'Maintenance', bg: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 border-blue-300 dark:border-blue-800' };
		if (s === 'rusak') return { label: 'Rusak', bg: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300 border-red-300 dark:border-red-800' };
		if (s === 'standby') return { label: 'Standby', bg: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300 dark:border-amber-800' };
		return { label: status || 'Siap', bg: 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300 border-gray-200 dark:border-slate-700' };
	}

	function getUnitConditionLabel(statusUnit?: string | null) {
		const s = (statusUnit || '').toLowerCase();
		if (s === 'baik') return { label: 'Baik / Siap Digunakan', color: 'text-emerald-600 dark:text-emerald-400' };
		if (s === 'perlu_periksa') return { label: 'Perlu Diperiksa Maintenance', color: 'text-amber-600 dark:text-amber-400' };
		if (s === 'dilarang') return { label: 'Dilarang Digunakan', color: 'text-red-600 dark:text-red-400' };
		return { label: 'Sesuai Standar', color: 'text-gray-500' };
	}

	const itemCategories = [
		{ value: 'operasional', label: 'Biaya Operasional' },
		{ value: 'supplier', label: 'Supplier / Material' },
		{ value: 'consumable', label: 'Consumables' },
		{ value: 'jasa', label: 'Jasa / Subkon' },
		{ value: 'safety', label: 'Safety' },
		{ value: 'sewa_alat', label: 'Sewa Alat Internal' },
		{ value: 'lain_lain', label: 'Biaya Lain-Lain' }
	];

	const DEFAULT_TIME_SLOTS = [
		{ start_time: '05:00', end_time: '06:00' },
		{ start_time: '06:00', end_time: '07:00' },
		{ start_time: '07:00', end_time: '08:00' },
		{ start_time: '08:00', end_time: '09:00' },
		{ start_time: '09:00', end_time: '10:00' },
		{ start_time: '10:00', end_time: '11:00' },
		{ start_time: '11:00', end_time: '12:00' },
		{ start_time: '12:00', end_time: '13:00' },
		{ start_time: '13:00', end_time: '14:00' },
		{ start_time: '14:00', end_time: '15:00' },
		{ start_time: '15:00', end_time: '16:00' },
		{ start_time: '16:00', end_time: '17:00' },
		{ start_time: '17:00', end_time: '18:00' },
		{ start_time: '18:00', end_time: '19:00' },
		{ start_time: '19:00', end_time: '20:00' },
		{ start_time: '20:00', end_time: '21:00' },
		{ start_time: '21:00', end_time: '22:00' },
		{ start_time: '22:00', end_time: '23:00' },
		{ start_time: '23:00', end_time: '24:00' }
	];

	function getInitialSchedule() {
		return DEFAULT_TIME_SLOTS.map(slot => ({
			start_time: slot.start_time,
			end_time: slot.end_time,
			activity: '',
			status: 'pending'
		}));
	}

	function mergeSchedule(savedSchedule: any[]) {
		const result = DEFAULT_TIME_SLOTS.map(slot => {
			const saved = (savedSchedule || []).find(item => {
				const sStart = (item.start_time || '').substring(0, 5);
				const sEnd = (item.end_time || '').substring(0, 5);
				return sStart === slot.start_time && sEnd === slot.end_time;
			});
			return {
				start_time: slot.start_time,
				end_time: slot.end_time,
				activity: saved ? saved.activity : '',
				status: saved ? saved.status : 'pending'
			};
		});

		if (Array.isArray(savedSchedule)) {
			savedSchedule.forEach(item => {
				const sStart = (item.start_time || '').substring(0, 5);
				const sEnd = (item.end_time || '').substring(0, 5);
				const isDefault = DEFAULT_TIME_SLOTS.some(slot => slot.start_time === sStart && slot.end_time === sEnd);
				if (!isDefault && (item.activity || item.start_time || item.end_time)) {
					result.push({
						start_time: sStart || item.start_time || '',
						end_time: sEnd || item.end_time || '',
						activity: item.activity || '',
						status: item.status || 'pending'
					});
				}
			});
		}
		return result;
	}

	function isDefaultSlot(item: any) {
		const sStart = (item.start_time || '').substring(0, 5);
		const sEnd = (item.end_time || '').substring(0, 5);
		return DEFAULT_TIME_SLOTS.some(slot => slot.start_time === sStart && slot.end_time === sEnd);
	}

	// R2-08: alasan keterlambatan (disimpan di reports.alasan_input_admin). Wajib bila laporan diisi lebih dari H-2 (ambang resmi di server/Setelan Project).
	let alasanTerlambat = $state('');
	const hariTerlambat = $derived(hariMundur(reportData.date, new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)) ?? 0);

	let reportData = $state({
		date: new Date(Date.now() - (new Date()).getTimezoneOffset() * 60000).toISOString().split('T')[0],
		activity_status: 'on_progress',
		project_type: '',
		weather: 'Cerah',
		manpower_count: 0,
		issues_general: '',
		general_notes: '',
		tomorrow_plan_summary: '',
		schedule: [
			{ start_time: '05:00', end_time: '06:00', activity: '', status: 'pending' },
			{ start_time: '06:00', end_time: '07:00', activity: '', status: 'pending' },
			{ start_time: '07:00', end_time: '08:00', activity: '', status: 'pending' },
			{ start_time: '08:00', end_time: '09:00', activity: '', status: 'pending' },
			{ start_time: '09:00', end_time: '10:00', activity: '', status: 'pending' },
			{ start_time: '10:00', end_time: '11:00', activity: '', status: 'pending' },
			{ start_time: '11:00', end_time: '12:00', activity: '', status: 'pending' },
			{ start_time: '12:00', end_time: '13:00', activity: '', status: 'pending' },
			{ start_time: '13:00', end_time: '14:00', activity: '', status: 'pending' },
			{ start_time: '14:00', end_time: '15:00', activity: '', status: 'pending' },
			{ start_time: '15:00', end_time: '16:00', activity: '', status: 'pending' },
			{ start_time: '16:00', end_time: '17:00', activity: '', status: 'pending' },
			{ start_time: '17:00', end_time: '18:00', activity: '', status: 'pending' },
			{ start_time: '18:00', end_time: '19:00', activity: '', status: 'pending' },
			{ start_time: '19:00', end_time: '20:00', activity: '', status: 'pending' },
			{ start_time: '20:00', end_time: '21:00', activity: '', status: 'pending' },
			{ start_time: '21:00', end_time: '22:00', activity: '', status: 'pending' },
			{ start_time: '22:00', end_time: '23:00', activity: '', status: 'pending' },
			{ start_time: '23:00', end_time: '24:00', activity: '', status: 'pending' }
		],
		progress: [{ subtask_id: '', activity: '', progress_value: 0, unit: 'm²', notes: '', category: '', target_volume: 0, service_type: '', is_custom: false, existing_foto_bukti: [] as string[], foto_bukti: [] as { file: File; name: string; url: string; uploadedId?: string | null }[] }] as {
			subtask_id: string;
			activity: string;
			progress_value: number;
			unit: string;
			notes: string;
			category: string;
			target_volume: number;
			service_type: string;
			is_custom: boolean;
			category_only?: boolean;
			category_id?: string | number | null;
			// Field asing dari DB (mis. stages dari form admin) yang wajib ikut tersimpan ulang — lihat progressRowPreserve.ts
			_extra?: Record<string, any>;
			qc_measured?: Record<string, any>;
			existing_foto_bukti?: string[];
			foto_bukti?: { file: File; name: string; url: string; uploadedId?: string | null }[];
			executor_type?: string | null;
			executor_vendor_name?: string | null;
			external_party?: string | null;
			readiness_status?: string | null;
			readiness_checklist?: string[];
		}[],
		material_used: [{ type: '', amount: 0, unit: 'kg', notes: '', expense_id: '', identitas_barang_id: null, is_manual: false }],

		material_stock: [] as { type: string, amount: number, unit: string }[],
		material_needs: [{ type: '', amount: 0, unit: 'kg', notes: '', urgency: 'normal', description: '', date_needed: '', expense_id: '', identitas_barang_id: null, is_manual: false }],
		tomorrow_plan: [{ activity: '', notes: '', description: '' }],
		issues: [{ description: '', existing_foto_kendala: [] as string[], foto_kendala: [] as { file: File; name: string; url: string; uploadedId?: string | null }[] }],
		manpower: [freshManpowerGroup('BORONGAN')],
		attendance_photos: [] as { file: File; name: string; url: string; uploadedId?: string | null }[],
		progress_photos: [] as { file: File; name: string; url: string; uploadedId?: string | null }[],
		issue_photos: [] as { file: File; name: string; url: string; uploadedId?: string | null }[],
		toolbox_photos: [] as { file: File; name: string; url: string; uploadedId?: string | null }[],
		area_kerja_photos: [] as { file: File; name: string; url: string; uploadedId?: string | null }[],
		tools: [{ name: '', amount: 0 }] as {
			name: string;
			amount: number;
			p2h_result?: string | null;
			p2h_checked?: boolean;
			equipment_id?: number | string | null;
			raw_name?: string | null;
			code?: string | null;
			category?: string | null;
			status_unit?: string | null;
			status_operational?: string | null;
			hoursmeter?: number | null;
			operator?: string | null;
			keterangan?: string | null;
			foto_unit?: string | null;
			is_loan?: boolean;
		}[],
		budget_notes: '',
		budget_items: [] as any[],
		weekend_location_recap: '',
		weekend_photos: [] as { file: File; name: string; url: string; uploadedId?: string | null }[],
		// Fase 1 (Gate Keras Disiplin Data & Laporan Harian, 17 Sep 2026) — menutup C2:
		// status Hold tidak lagi lolos gate begitu saja, wajib alasan.
		hold_reason: '',
		// Fase 2 Paritas Field Lengkap (HSE & K3, Jam Henti, QC Ambient, Deviasi Material, Site Instructions)
		hse_daily: {
			apd_compliance: '',
			catatan_k3: '',
			toolbox_jam: '',
			toolbox_topik: ''
		} as { apd_compliance: string; catatan_k3: string; [key: string]: any },
		downtime_log: [] as { durasi_jam: number; penyebab: string; jumlah_pekerja_terdampak: number; catatan: string }[],
		qc_ambient: {
			applicable: false,
			filled_today: false,
			steel_temp: null as number | null,
			dew_point: null as number | null,
			relative_humidity: null as number | null,
			air_temp: null as number | null,
			catatan: ''
		},
		material_variance_note: '',
		client_instructions: [] as { pengawas_klien: string; isi_instruksi: string; berpotensi_vo: boolean }[]
	});

	const DOWNTIME_CAUSE_OPTIONS = [
		{ value: 'cuaca', label: 'Cuaca Buruk / Hujan Deras' },
		{ value: 'izin_klien', label: 'Menunggu Izin Kerja (PTW) / Area Klien Belum Siap' },
		{ value: 'alat_breakdown', label: 'Kerusakan Alat / Breakdown Unit' },
		{ value: 'tunggu_material', label: 'Menunggu Pengiriman Material Site' },
		{ value: 'listrik_utilitas', label: 'Pemadaman Listrik / Pasokan Utilitas Terhenti' },
		{ value: 'safety_standby', label: 'Safety Standby / Bahaya Gas / Evakuasi' },
		{ value: 'lainnya', label: 'Lainnya' }
	];


	function addClientInstructionRow() {
		reportData.client_instructions = [
			...reportData.client_instructions,
			{ pengawas_klien: '', isi_instruksi: '', berpotensi_vo: false }
		];
	}

	function removeClientInstructionRow(index: number) {
		reportData.client_instructions = reportData.client_instructions.filter((_, i) => i !== index);
	}


	async function loadInspectionSummaryAutoPull(forceOverwrite = false) {
		if (!projectId) return;
		loadingInspectionSummary = true;
		try {
			const summary = await getLatestProjectInspectionSummary(projectId, reportData.date);
			inspectionSummary = summary;
			if (summary) {
				const hasExistingValues = reportData.qc_ambient.air_temp !== null && reportData.qc_ambient.air_temp !== undefined &&
					reportData.qc_ambient.steel_temp !== null && reportData.qc_ambient.steel_temp !== undefined;
				if (forceOverwrite || !hasExistingValues) {
					if (summary.airTemp !== null && summary.airTemp !== undefined) reportData.qc_ambient.air_temp = summary.airTemp;
					if (summary.steelTemp !== null && summary.steelTemp !== undefined) reportData.qc_ambient.steel_temp = summary.steelTemp;
					if (summary.rhPct !== null && summary.rhPct !== undefined) reportData.qc_ambient.relative_humidity = summary.rhPct;
					if (summary.dewPoint !== null && summary.dewPoint !== undefined) reportData.qc_ambient.dew_point = summary.dewPoint;
					reportData.qc_ambient.filled_today = true;
				}
			}
		} catch (e) {
			console.warn('Gagal memuat auto-pull QC Ambient:', e);
		} finally {
			loadingInspectionSummary = false;
		}
	}

	let isHold = $derived(reportData.activity_status === 'hold');
	let liveProductivity = $derived(computeDailyProductivity(reportData.progress, reportData.manpower));

	// Metrik finansial real-time
	let totalSpentToday = $derived(reportData.budget_items.reduce((sum, item) => sum + (Number(item.spent_amount) || 0), 0));
	let totalReimburseToday = $derived(reportData.budget_items.filter(i => i.expense_id === 'REIMBURSE').reduce((sum, item) => sum + (Number(item.spent_amount) || 0), 0));
	let totalBudgetExpenseToday = $derived(reportData.budget_items.filter(i => i.expense_id && i.expense_id !== 'REIMBURSE').reduce((sum, item) => sum + (Number(item.spent_amount) || 0), 0));
	let reimburseItemsCount = $derived(reportData.budget_items.filter(i => i.expense_id === 'REIMBURSE').length);
	let budgetExpenseItemsCount = $derived(reportData.budget_items.filter(i => i.expense_id && i.expense_id !== 'REIMBURSE').length);
	let reimburseMissingReceiptCount = $derived(reportData.budget_items.filter(i => i.expense_id === 'REIMBURSE' && !i.receipt_file && !i.receipt_id).length);

	const STANDBY_MANPOWER_ROW = () => freshManpowerGroup('STANDBY', 'Hold - tidak ada aktivitas, manpower standby');

	function handleActivityStatusChange(val: string) {
		reportData.activity_status = val;
		if (val === 'hold') {
			reportData.manpower = [STANDBY_MANPOWER_ROW()];
			reportData.manpower_count = 0;
		} else if (reportData.manpower.length === 1 && reportData.manpower[0].role === 'STANDBY') {
			reportData.manpower = [freshManpowerGroup('BORONGAN')];
			reportData.manpower_count = 0;
		}
	}

	let historyReports = $state<any[]>([]);
	// Semua laporan proyek ini (bukan cuma halaman pertama seperti historyReports),
	// dipakai untuk menghitung overall_progress kumulatif saat submit.
	let allReportsForProgress = $state<any[]>([]);
	// Input actual manual dari Timeline (koleksi timeline_actual_manual) — dipakai
	// sebagai pelengkap "belum diverifikasi" di ringkasan progress subtask, di-skip
	// untuk kombinasi subtask+tanggal yang sudah punya laporan harian resmi (lihat subtaskSummaryList).
	let manualActualEntries = $state<any[]>([]);
	// G1 — checklist alat ditarik dari p2h_session (unit yang ditugaskan ke proyek ini +
	// status P2H hari ini), bukan diketik bebas oleh leader.
	let projectEquipmentP2h = $state<ProjectEquipmentP2hStatus[]>([]);
	let loadingEquipmentP2h = $state(false);

	async function loadProjectEquipmentP2h() {
		loadingEquipmentP2h = true;
		try {
			projectEquipmentP2h = await getProjectEquipmentP2hStatus(projectId, reportData.date);
		} finally {
			loadingEquipmentP2h = false;
		}
	}
	
	// History filtering/pagination state
	let historyLimit = 20;
	let historyOffset = $state(0);
	let historyHasMore = $state(true);
	let historyLoadingMore = $state(false);
	let historySearch = $state('');
	let historySort = $state('-date_created');
	let historyFilter = $state('');
	let selectedHistoryReport = $state<any | null>(null);

	const historySorts = [
		{ value: '-date_created', label: 'Terbaru' },
		{ value: 'date_created', label: 'Terlama' },
	];
	const historyFilters = [
		{ value: '', label: 'Semua Status' },
		{ value: 'draft', label: 'Draft' },
		{ value: 'submitted', label: 'Terkirim' },
		{ value: 'approved', label: 'Disetujui' },
		{ value: 'rejected', label: 'Ditolak' }
	];

	async function loadHistoryReports(loadMore = false) {
		if (loadMore) {
			historyOffset += historyLimit;
			historyLoadingMore = true;
		} else {
			historyOffset = 0;
			historyHasMore = true;
			historyLoadingMore = true;
		}

		try {
			const results = await getReports(projectId, {
				limit: historyLimit,
				offset: historyOffset,
				search: historySearch,
				sort: historySort,
				filterStatus: historyFilter
			});
			if (loadMore) {
				historyReports = [...historyReports, ...results];
			} else {
				historyReports = results;
			}
			if (results.length < historyLimit) {
				historyHasMore = false;
			}
		} catch (e) {
			console.error('Failed to load history reports', e);
		} finally {
			historyLoadingMore = false;
		}
	}

	function loadReportData(sourceReport: any, lock: boolean = true) {
		savedReportId = sourceReport.id;
		reportStatus = sourceReport.status || 'submitted';
		// Fase 3 (Loop Perbaikan) — dibaca sendReport() untuk mendeteksi resubmit atas
		// laporan yang sedang revision_requested (mengisi revisi_selesai_at + revisi_count++).
		priorReportStatus = reportStatus;
		priorRevisiCount = Number(sourceReport.revisi_count) || 0;

		if (sourceReport.date) reportData.date = sourceReport.date.split('T')[0];

		reportData.activity_status = sourceReport.activity_status || 'on_progress';
		reportData.hold_reason = sourceReport.hold_reason || '';
		reportData.project_type = sourceReport.project_type || '';
		reportData.weather = sourceReport.weather || 'Cerah';
		reportData.manpower_count = sourceReport.manpower_count || 0;
		reportData.issues_general = sourceReport.issues_general || '';
		reportData.general_notes = sourceReport.general_notes || '';
		reportData.tomorrow_plan_summary = sourceReport.tomorrow_plan_summary || '';
		reportData.hse_daily = parseField<any>(sourceReport.hse_daily, { apd_compliance: '', catatan_k3: '' });
		reportData.downtime_log = parseField<any[]>(sourceReport.downtime_log, []);
		reportData.material_variance_note = parseField<any>(sourceReport.material_variance, {})?.note || '';
		reportData.client_instructions = parseField<any[]>(sourceReport.client_instructions, []);

		const sched = parseField<any[]>(sourceReport.schedule, []);
		reportData.schedule = mergeSchedule(sched);

		const prog = parseField<any[]>(sourceReport.progress, []);
		reportData.progress = prog.length ? prog.map((p: any) => {
			// Fase 2 — bedakan hasil pilih "kategori tanpa subtask" (category === activity, bukan
			// 'Pekerjaan Tambahan') dari input kustom bebas, supaya saat laporan lama dibuka
			// kembali dropdown-nya tidak salah jatuh ke mode "Pekerjaan Kustom".
			const categoryOnly = !p.subtask_id && !!p.category && p.category === p.activity && p.category !== 'Pekerjaan Tambahan';
			return {
				subtask_id: p.subtask_id || '',
				activity: p.activity || '',
				// Baris form admin: tampilkan VOLUME (stages.pekerjaan), bukan persen di progress_value.
				progress_value: rowUiVolume(p),
				_extra: rowExtra(p),
				unit: p.unit || 'm²',
				notes: p.notes || '',
				category: p.category || '',
				target_volume: p.target_volume || 0,
				service_type: p.service_type || '',
				is_custom: !!p.is_custom || (!p.subtask_id && !!p.activity && !categoryOnly),
				category_only: categoryOnly,
				category_id: categoryOnly ? (timelineCategories.find((c: any) => c.name === p.category)?.id ?? null) : null,
				// Fase 2 Dokumentasi Foto (26 Sep 2026) — foto per baris yang sudah ter-upload
				// (read-only, tampil lewat secureAssetSrc); foto_bukti kosong dipakai untuk
				// capture BARU yang belum di-upload.
				existing_foto_bukti: Array.isArray(p.foto_bukti) ? p.foto_bukti : [],
				foto_bukti: []
			};
		}) : [{ subtask_id: '', activity: '', progress_value: 0, unit: 'm²', notes: '', category: '', target_volume: 0, service_type: '', is_custom: false, category_only: false, category_id: null, existing_foto_bukti: [], foto_bukti: [] }];

		const matUsed = parseField<any[]>(sourceReport.material_used, []);
		reportData.material_used = matUsed.length ? matUsed : [{ type: '', amount: 0, unit: 'kg', notes: '', expense_id: '', identitas_barang_id: null, is_manual: false }];
		originalMaterialUsed = matUsed.length ? JSON.parse(JSON.stringify(matUsed)) : [];

		const matNeeds = parseField<any[]>(sourceReport.material_needs, []);
		reportData.material_needs = matNeeds.length ? matNeeds : [{ type: '', amount: 0, unit: 'kg', notes: '', urgency: 'normal', description: '', date_needed: '', expense_id: '', identitas_barang_id: null, is_manual: false }];

		const tmrPlan = parseField<any[]>(sourceReport.tomorrow_plan, []);
		reportData.tomorrow_plan = tmrPlan.length ? tmrPlan : [{ activity: '', notes: '', description: '' }];

		const issues = parseField<any[]>(sourceReport.issues, []);
		reportData.issues = issues.length ? issues.map((it: any) => ({
			description: it.description || '',
			existing_foto_kendala: Array.isArray(it.foto_kendala) ? it.foto_kendala : [],
			foto_kendala: []
		})) : [{ description: '', existing_foto_kendala: [], foto_kendala: [] }];

		const tools = parseField<any[]>(sourceReport.tools, []);
		reportData.tools = tools.length ? tools : [{ name: '', amount: 0 }];

		const mp = parseField<any[]>(sourceReport.manpower, []);
		reportData.manpower = mp.length ? mp.map((m: any) => ({
			...freshManpowerGroup(m.role, m.notes),
			...m,
			workers: m.workers || [],
			newWorkerInput: '',
			showDropdown: false
		})) : [freshManpowerGroup('BORONGAN')];

		const budgItems = parseField<any[]>(sourceReport.budget_items, []);
		reportData.budget_items = budgItems.length ? budgItems.map((bi: any) => ({
			...bi,
			receipt_file: null
		})) : [];

		reportData.budget_notes = sourceReport.budget_notes || '';

		existingAttendancePhotos = parseField<string[]>(sourceReport.attendance_photos, []);
		existingProgressPhotos = parseField<string[]>(sourceReport.progress_photos, []);
		existingIssuePhotos = parseField<string[]>(sourceReport.issue_photos, []);
		existingToolboxPhotos = parseField<string[]>(sourceReport.toolbox_photos, []);
		existingAreaKerjaPhotos = parseField<string[]>(sourceReport.area_kerja_photos, []);
		existingBudgetReceipt = sourceReport.budget_receipt || null;

		reportData.weekend_location_recap = sourceReport.weekend_location_recap || '';
		existingWeekendPhotos = parseField<string[]>(sourceReport.weekend_photos, []);

		// Fase 2 Paritas Field Lengkap
		reportData.hse_daily = parseField<any>(sourceReport.hse_daily, { apd_compliance: '', catatan_k3: '', toolbox_jam: '', toolbox_topik: '' });
		reportData.downtime_log = parseField<any[]>(sourceReport.downtime_log, []);
		reportData.qc_ambient = parseField<any>(sourceReport.qc_ambient, {
			applicable: false,
			filled_today: false,
			steel_temp: null,
			dew_point: null,
			relative_humidity: null,
			air_temp: null,
			catatan: ''
		});
		reportData.material_variance_note = parseField<any>(sourceReport.material_variance, {})?.note || sourceReport.material_variance_note || '';
		reportData.client_instructions = parseField<any[]>(sourceReport.client_instructions, []);

		reportData.attendance_photos = [];
		reportData.progress_photos = [];
		reportData.issue_photos = [];
		reportData.toolbox_photos = [];
		reportData.area_kerja_photos = [];
		reportData.weekend_photos = [];
		budgetReceiptFile = null;

		isLocked = lock;
		activeTab = 'summary';
		
		setTimeout(() => {
			const scrollBody = document.querySelector('.scroll-body');
			if (scrollBody) scrollBody.scrollTop = 0;
		}, 50);
	}

	onMount(async () => {
		if (typeof window !== 'undefined' && window.innerWidth < 768) {
			metadataExpanded = false;
		}
		// Fire-and-forget: kalau lokasi tersedia, foto berikutnya otomatis di-GPS-tag.
		// Tidak memblokir load form kalau izin ditolak/tidak ada sinyal.
		getCurrentPosition().then(pos => { reportPosition = pos; }).catch(() => {});
		// Fire-and-forget: ringkasan HSE (tab HSE & K3) tidak boleh memblokir load form.
		loadHseSummary();
		// Fire-and-forget: ringkasan QC Ambient (modul Inspection) & toleransi Rasio Material.
		loadInspectionSummary();
		loadLossFactorPct();

		// 1. Offline-First: Muat data master dari cache IndexedDB perangkat terlebih dahulu
		let hasCachedMaster = false;
		try {
			const cachedMaster = await loadProjectMasterCache(projectId);
			if (cachedMaster && cachedMaster.project) {
				hasCachedMaster = true;
				project = cachedMaster.project;
				if (cachedMaster.soCustomer) soCustomer = cachedMaster.soCustomer;
				if (cachedMaster.soDetails?.length) soDetails = cachedMaster.soDetails;
				if (cachedMaster.timelineCategories?.length) timelineCategories = cachedMaster.timelineCategories;
				if (cachedMaster.availableSubtasks?.length) availableSubtasks = cachedMaster.availableSubtasks;
				if (cachedMaster.actualMaterials?.length) actualMaterials = cachedMaster.actualMaterials;
				if (cachedMaster.availableManpower?.length) availableManpower = cachedMaster.availableManpower;
				if (cachedMaster.budgetExpenses?.length) budgetExpenses = cachedMaster.budgetExpenses;
				if (cachedMaster.allReportsForProgress?.length) allReportsForProgress = cachedMaster.allReportsForProgress;
				if (cachedMaster.previousSpentMap) previousSpentMap = cachedMaster.previousSpentMap;
				loading = false;
			}
		} catch (cacheErr) {
			console.warn('Gagal membaca cache master proyek:', cacheErr);
		}

		try {
			const { roleId, karyawanId, karyawanName, directusToken } = get(authStore);

			if (karyawanId) {
				await fetchDemisionerProjectIds(karyawanId).catch(() => {});
			}

			// Gunakan user token jika tersedia (Directus akan return 403 jika proyek bukan miliknya)
			const result = await getProjectById(projectId, directusToken);
			const serverAnswered = !!result;
			if (result) {
				project = result;
				if (!reportData.project_type && project.jenis_project) {
					reportData.project_type = project.jenis_project;
				}
				const isCoatingBlasting = (project?.hse_work_types || []).some((t: string) => t === 'sandblasting' || t === 'coating') ||
					(project?.name || '').toLowerCase().includes('coating') ||
					(project?.name || '').toLowerCase().includes('blasting') ||
					(project?.name || '').toLowerCase().includes('cat') ||
					(project?.name || '').toLowerCase().includes('paint');
				if (isCoatingBlasting) {
					reportData.qc_ambient.applicable = true;
					await loadInspectionSummaryAutoPull(false);
				}
			}

			// Guard aplikasi — cek setelah load, sebagai lapisan kedua sebelum row-level perms aktif
			if (shouldFilterProjectsByLeader(roleId)) {
				// Manpower Leader terikat lewat kursi projects.manpower_leader_id, bukan
				// lewat projects.leader — jadi kursi diperiksa lebih dulu, sebelum
				// pemeriksaan karyawan (yang tidak dimiliki pekerja harian/borongan).
				const pegangKursi = pegangKursiLapangan(projectId);
				if (!pegangKursi && !karyawanId && !karyawanName) {
					goto('/');
					return;
				}
				if (!project && !hasCachedMaster) {
					// getProjectById null → bisa 403 dari Directus row-level perms
					goto('/');
					return;
				}
				// Cache master hanya untuk tampilan OFFLINE: bila SERVER menjawab dan proyek tidak lagi boleh diakses, cache tidak
				// boleh melewati pemeriksaan. (Jawaban kosong/error TIDAK dianggap pencabutan — sinyal lemah di site umum;
				// 403 row-level tak terbedakan dari gangguan jaringan oleh getProjectById.)
				// Kursi lapangan, leader (FK/nama), dan koordinator workshop — satu helper.
				if (!bolehAksesProyek(project) && (!hasCachedMaster || serverAnswered)) {
					if (serverAnswered) await clearProjectMasterCache(projectId);
					goto('/');
					return;
				}
			}

			if (project) {
				if (project.so_customer_id) {
					soCustomer = await getSoCustomerById(project.so_customer_id);
				} else {
					soCustomer = await getSoCustomerByProjectId(project.id);
				}

				if (soCustomer && soCustomer.id) {
					// Grand PO: proyek gabungan -> aktivitas dari SEMUA PO proyek (bukan hanya PO utama). Proyek 1-PO: perilaku lama.
					const soIds = await getProjectSoIds({ ...project, so_customer_id: soCustomer.id });
					soDetails = soIds.length > 1 ? await getSoCustomerDetailsForSos(soIds) : await getSoCustomerDetails(soCustomer.id);
					// Fase 6/6.3 — baseline Kurva S rencana dari penawaran (best-effort, tidak blocking).
					getScurveBaselineBySoCustomer(soCustomer.id)
						.then((b) => { scurveBaseline = b; })
						.catch(() => {});
				}
			}

			// Parse timeline_planning
			let parsedCategories: any[] = [];
			if (project?.timeline_planning) {
				try {
					const parsed = typeof project.timeline_planning === 'string' 
						? JSON.parse(project.timeline_planning) 
						: project.timeline_planning;
					parsedCategories = parsed.categories || [];
				} catch(e) {
					console.error('Error parsing timeline_planning', e);
				}
			}

			// If timelineCategories has been parsed
			if (parsedCategories.length > 0) {
				// Sinkronisasi: Tambahkan SO details yang belum ada di categories (mirip logik Gantt Chart ERP)
				if (soDetails && soDetails.length > 0) {
					soDetails.forEach(det => {
						const exists = parsedCategories.some(c => c.so_detail_id === det.id);
						if (!exists) {
							parsedCategories.push({
								id: `cat_so_${det.id}`,
								so_detail_id: det.id,
								name: det.nama_barang || det.jenis_jasa || 'Aktivitas Sales Order',
								volume: det.qty || det.jumlah_pcs || 0,
								unit: det.input_unit || det.packing || 'm²',
								subtasks: []
							});
						}
					});
				}
			} else {
				// Fallback: Jika timeline_planning kosong, buat categories dari SO details secara langsung
				if (soDetails && soDetails.length > 0) {
					parsedCategories = soDetails.map((det, index) => ({
						id: `cat_so_${det.id}`,
						so_detail_id: det.id,
						name: det.nama_barang || det.jenis_jasa || `Aktivitas ${index + 1}`,
						volume: det.qty || det.jumlah_pcs || 0,
						unit: det.input_unit || det.packing || 'm²',
						subtasks: []
					}));
				}
			}

			// Fase 2 (Subtask Wajib Timeline v2) — TIDAK LAGI mengarang subtask_id
			// (dulu `sub_default_cat_N`/`sub_default_${index}`, ID hantu yang tidak pernah ada
			// di timeline admin -> 72 baris "subtask_id yatim" di produksi, salah satunya akar
			// bug "Mobilisasi Barang — Vol: 53/1 lot"). Kategori tanpa subtask tetap kosong;
			// dibuatkan SATU entri placeholder di availableSubtasks saja (id: null -> saat dipilih
			// laporan dikirim dengan subtask_id kosong + `category` = nama kategori, persis jalur
			// pencocokan-nama-kategori yang sudah dipakai admin, tanpa ID palsu).
			parsedCategories.forEach((cat) => {
				if (!cat.subtasks) cat.subtasks = [];
			});

			if (parsedCategories.length > 0) {
				timelineCategories = parsedCategories;
				const seenNames = new Set<string>();
				const subtasks: any[] = [];
				const normalizeNama = (nama: string) => String(nama || '').trim().toLowerCase().replace(/\s+/g, ' ');

				timelineCategories.forEach(cat => {
					if (cat.subtasks && cat.subtasks.length > 0) {
						cat.subtasks.forEach((sub: any) => {
							const key = normalizeNama(sub.name);
							if (!key || seenNames.has(key)) return; // S7 — dedupe dropdown lapangan
							seenNames.add(key);
							subtasks.push({ ...sub, categoryName: cat.name });
						});
					} else {
						// Kategori belum punya subtask sama sekali -> placeholder tanpa ID palsu.
						const key = normalizeNama(cat.name);
						if (!key || seenNames.has(key)) return;
						seenNames.add(key);
						subtasks.push({
							id: null,
							category_only: true,
							so_detail_id: cat.so_detail_id || null,
							name: cat.name,
							unit: cat.unit || 'm²',
							volume: cat.volume || 0,
							categoryName: cat.name
						});
					}
				});
				availableSubtasks = subtasks;
			}
			
			// Load actual materials (supplier, consumable, safety)
			loadingMaterials = true;
			const freshMaterials = await getProjectActualMaterials(projectId);
			if (freshMaterials && freshMaterials.length > 0) {
				actualMaterials = freshMaterials;
			}

			// Fase 3 — saldo fisik site (project_stock_balance), best-effort: kegagalan di sini
			// TIDAK menggagalkan pemuatan form laporan harian secara keseluruhan.
			loadingSiteStock = true;
			try {
				const balanceRows = await fetchProjectStockBalance(Number(projectId));
				const map: Record<number, ProjectStockBalanceRow> = {};
				for (const row of balanceRows) {
					if (row.item_id?.id) map[row.item_id.id] = row;
				}
				siteStockByItemId = map;
			} catch (e) {
				console.error('Gagal memuat saldo stok site proyek:', e);
			} finally {
				loadingSiteStock = false;
			}

			// Load available manpower — hanya pekerja dengan penugasan aktif (SPK) di proyek ini
			const assignmentsRes = await getAssignments({ project_id: Number(projectId), status: 'aktif' });
			if (assignmentsRes.success && assignmentsRes.data) {
				availableManpower = assignmentsRes.data.map((a: any) => ({
					id: a.manpower_id?.id ?? a.manpower_id,
					nama: a.manpower_id?.nama || '',
					posisi: a.jabatan || a.manpower_id?.posisi || '',
					assignment_id: a.id,
					rate_tipe: (a.rate_tipe || 'HARIAN').toUpperCase(),
					tanggal_selesai: a.tanggal_selesai || '',
					nomor_spk: a.nomor_spk || ''
				}));
			}

			// Load budget expenses (confirmed budget requests)
			const freshBudget = await getProjectBudgetExpenses(projectId);
			if (freshBudget && freshBudget.length >= 0) {
				budgetExpenses = freshBudget;
			}

			// Load previous reports to calculate remaining balances of budget items
			// PRJ-18: hanya kolom yang dipakai perhitungan progres/saldo (tanpa foto & kolom berat lain). Laporan hari ini
			// dimuat PENUH terpisah (di bawah) untuk mengisi form.
			const allPrevReportsForCalc = await getReports(projectId, {
				limit: -1,
				fields: ['id', 'date', 'date_created', 'status', 'progress', 'budget_items', 'manpower', 'material_used']
			});
			if (allPrevReportsForCalc && allPrevReportsForCalc.length >= 0) {
				allReportsForProgress = allPrevReportsForCalc;
				const spentMap: Record<string | number, number> = {};
				allPrevReportsForCalc.forEach((r: any) => {
					if (r.budget_items) {
						try {
							const items = typeof r.budget_items === 'string' 
								? JSON.parse(r.budget_items) 
								: r.budget_items;
							if (Array.isArray(items)) {
								items.forEach((item: any) => {
									if (item.expense_id) {
										spentMap[item.expense_id] = (spentMap[item.expense_id] || 0) + (Number(item.spent_amount) || 0);
									}
								});
							}
						} catch (err) {
							console.error('Error parsing budget_items from previous report:', err);
						}
					}
				});
				previousSpentMap = spentMap;
			}

			// Input actual manual dari Timeline — best-effort, tidak boleh memblokir alur laporan kalau gagal
			try {
				manualActualEntries = await listManualActualByProject(Number(projectId));
			} catch (err) {
				console.error('Gagal memuat input actual manual:', err);
			}

			// Simpan data master proyek ke cache lokal IndexedDB untuk akses offline nanti
			if (project) {
				saveProjectMasterCache({
					projectId,
					cachedAt: Date.now(),
					project,
					soCustomer,
					soDetails,
					timelineCategories,
					availableSubtasks,
					actualMaterials,
					availableManpower,
					budgetExpenses,
					allReportsForProgress,
					previousSpentMap
				});
			}

			await loadHistoryReports();

			// Fase 3 (Loop Perbaikan) — deep-link dari /laporan/perlu-diperbaiki: ?fix=<id>
			// membuka laporan revision_requested/rejected TERTENTU langsung untuk diedit,
			// terlepas dari tanggalnya (bukan cuma laporan hari ini).
			const fixReportId = $page.url.searchParams.get('fix');
			let openedViaFixLink = false;
			if (fixReportId) {
				const fixReport = await getReportById(fixReportId);
				if (fixReport && String(fixReport.project_id) === String(projectId)) {
					loadReportData(fixReport, false);
					openedViaFixLink = true;
					if (fixReport.status === 'revision_requested') {
						alert('Laporan dimuat untuk diperbaiki. Lengkapi bagian yang diminta, lalu kirim ulang.');
					}
				}
			}

			// Detect if today already has a submitted report and pre-fill the form
			const tzOffset = (new Date()).getTimezoneOffset() * 60000;
			const todayStr = new Date(Date.now() - tzOffset).toISOString().split('T')[0];
			const todayReport = (allReportsForProgress || []).find((r: any) => {
				const d = (r.date || r.date_created || '').split('T')[0];
				return d === todayStr;
			});
			hasReportedToday = !!todayReport;
			// Laporan SUSULAN (gate G10_HARIAN pengajuan anggaran): ?tanggal=YYYY-MM-DD (masa lalu)
			// membuka form langsung di tanggal yang bolong; bila sudah ada laporannya, dimuat untuk dilengkapi.
			const tanggalParam = $page.url.searchParams.get('tanggal') || '';
			const susulanDate = /^\d{4}-\d{2}-\d{2}$/.test(tanggalParam) && tanggalParam < todayStr ? tanggalParam : null;
			if (openedViaFixLink) {
				// Sudah dimuat di atas — jangan ditimpa laporan hari ini.
			} else if (susulanDate) {
				const existing = (allReportsForProgress || []).find((r: any) => (r.date || r.date_created || '').split('T')[0] === susulanDate);
				if (existing?.id != null) {
					const full = await getReportById(existing.id).catch(() => null);
					loadReportData(full || existing);
				} else {
					reportData.date = susulanDate;
					await restoreDraftIfAny(susulanDate);
				}
			} else if (todayReport) {
				// Daftar progres bermuatan ringan -> ambil laporan hari ini secara penuh untuk mengisi form.
				const fullToday = todayReport.id != null ? await getReportById(todayReport.id).catch(() => null) : null;
				loadReportData(fullToday || todayReport);
			} else if (await restoreDraftIfAny(todayStr)) {
				// Draft restored
			}

			await loadProjectEquipmentP2h();

		} catch (e) {
			console.warn('Gagal memuat data live proyek (menggunakan data cache/draft lokal):', e);
			const tzOffset = (new Date()).getTimezoneOffset() * 60000;
			const todayStr = new Date(Date.now() - tzOffset).toISOString().split('T')[0];
			await restoreDraftIfAny(todayStr);
		} finally {
			loading = false;
			loadingMaterials = false;
			// Aktifkan auto-save setelah pemuatan awal selesai, supaya restore/prefill
			// dari server tidak langsung dianggap "perubahan" dan menimpa draft.
			reportDraftAutoSaveArmed = true;
		}
	});


	$effect(() => {
		return unsubAuth;
	});
	const DRAFT_FIELDS = [
		'date', 'activity_status', 'hold_reason', 'project_type', 'weather', 'manpower_count',
		'issues_general', 'general_notes', 'tomorrow_plan_summary', 'schedule',
		'progress', 'material_used', 'material_needs', 'tomorrow_plan', 'issues',
		'manpower', 'tools', 'budget_notes', 'budget_items', 'weekend_location_recap',
		'hse_daily', 'downtime_log', 'qc_ambient', 'material_variance_note', 'client_instructions'
	] as const;

	function draftKey(date: string) {
		return `laporan_harian_draft_${projectId}_${date}`;
	}

	// Masa berlaku draf (rencana v2, Fase 3, 3.1) — draf sesi lama tidak boleh
	// nyangkut dan dipulihkan diam-diam berjam-jam kemudian.
	const REPORT_DRAFT_TTL_MS = 12 * 60 * 60 * 1000;
	let reportDraftSavedAt = $state<Date | null>(null);
	// Fase 4 ("Offline-First Daily Report") — status koneksi untuk DraftIndicator, tidak
	// memicu apa pun sendiri (murni tampilan); logika cegah-submit-gagal ada di sendReport().
	let isOffline = $state(typeof navigator !== 'undefined' ? !navigator.onLine : false);

	// Draft LENGKAP di IndexedDB perangkat ini (bukan ke server) — foto & lampiran
	// ikut tersimpan (lihat $lib/utils/offlineReportDraft.ts). Fallback ke localStorage
	// teks-saja kalau IndexedDB tidak tersedia di perangkat (webview lama dsb).
	let reportDraftHasPhotos = $state(false);

	function photoToPacket(photo: { file: File; name: string; uploadedId?: string | null } | null): ReportDraftPhoto | null {
		if (!photo) return null;
		return { name: photo.name, blob: photo.file, uploadedId: photo.uploadedId || null };
	}

	function packetToPhoto(packet: ReportDraftPhoto | null | undefined): { file: File; name: string; url: string; uploadedId?: string | null } | null {
		if (!packet) return null;
		const file = new File([packet.blob], packet.name, { type: packet.blob.type });
		return { file, name: packet.name, url: URL.createObjectURL(file), uploadedId: packet.uploadedId || null };
	}

	async function writeFullDraftToStorage(): Promise<boolean> {
		try {
			// $state.snapshot() penting di sini — reportData adalah Svelte 5 $state (Proxy),
			// dan IndexedDB (structured clone) tidak bisa menyimpan Proxy secara langsung
			// (DataCloneError). Snapshot dulu jadi plain object/array sebelum disimpan.
			const plainReportData = $state.snapshot(reportData) as any;
			const snapshot: Record<string, unknown> = {};
			for (const key of DRAFT_FIELDS) {
				if (key === 'budget_items') {
					snapshot.budget_items = plainReportData.budget_items.map((item: any) => ({ ...item, receipt_file: null }));
				} else {
					snapshot[key] = plainReportData[key];
				}
			}
			const record: ReportDraftRecord = {
				key: draftKey(reportData.date),
				savedAt: Date.now(),
				fields: snapshot,
				photos: {
					attendance_photos: reportData.attendance_photos.map((p: any) => photoToPacket(p)!),
					progress_photos: reportData.progress_photos.map((p: any) => photoToPacket(p)!),
					issue_photos: reportData.issue_photos.map((p: any) => photoToPacket(p)!),
					toolbox_photos: reportData.toolbox_photos.map((p: any) => photoToPacket(p)!),
					area_kerja_photos: reportData.area_kerja_photos.map((p: any) => photoToPacket(p)!),
					weekend_photos: reportData.weekend_photos.map((p: any) => photoToPacket(p)!),
					budget_receipt: photoToPacket(budgetReceiptFile),
					budget_item_receipts: reportData.budget_items.map((item: any) => photoToPacket(item.receipt_file))
				}
			};
			for (const k of Object.keys(snapshot)) {
				try { structuredClone(snapshot[k]); } catch (cloneErr) { console.error('DIAGNOSTIC unclonable field:', k, snapshot[k], cloneErr); }
			}
			try { structuredClone(record.key); } catch (e3) { console.error('DIAGNOSTIC unclonable record.key', e3); }
			for (const pk of Object.keys(record.photos)) {
				try { structuredClone((record.photos as any)[pk]); } catch (cloneErr) { console.error('DIAGNOSTIC unclonable photo field:', pk, (record.photos as any)[pk], cloneErr); }
			}
			await saveReportDraft(record);
			reportDraftSavedAt = new Date(record.savedAt);
			reportDraftHasPhotos = hasAnyPhoto(record.photos);
			// Bersihkan draft localStorage lama (migrasi dari skema teks-saja) supaya tidak nyangkut ganda.
			try { localStorage.removeItem(draftKey(reportData.date)); } catch { /* abaikan */ }
			return true;
		} catch (e) {
			console.error('Gagal menyimpan draft lengkap (IndexedDB):', e);
			// Fallback: draft teks-saja di localStorage, lebih baik daripada tidak ada sama sekali.
			try {
				const snapshot: Record<string, unknown> = {};
				for (const key of DRAFT_FIELDS) snapshot[key] = (reportData as any)[key];
				const savedAt = Date.now();
				localStorage.setItem(draftKey(reportData.date), JSON.stringify({ savedAt, fields: snapshot }));
				reportDraftSavedAt = new Date(savedAt);
				reportDraftHasPhotos = false;
				return true;
			} catch (e2) {
				console.error('Gagal menyimpan draft teks-saja (fallback):', e2);
				return false;
			}
		}
	}

	// Dipanggil user lewat tombol "Draft" — tetap beri konfirmasi eksplisit.
	async function saveDraft() {
		if (isDemisioner && !canReviseOwnReport) {
			alert('Mode Read-Only: Leader demisioner tidak dapat mengubah draft laporan proyek ini.');
			return;
		}
		if (await writeFullDraftToStorage()) {
			alert(reportDraftHasPhotos
				? 'Tersimpan sebagai draft di perangkat ini ✓ (foto & lampiran ikut tersimpan)'
				: 'Tersimpan sebagai draft di perangkat ini ✓');
		} else {
			alert('Gagal menyimpan draft di perangkat ini.');
		}
	}

	// Auto-save senyap dengan jeda (rencana v2, Fase 3, 3.1) — supaya form terpanjang
	// di modul ini tidak hilang kalau tab ter-refresh tak sengaja saat mengisi.
	let reportDraftAutoSaveTimer: ReturnType<typeof setTimeout> | null = null;
	function scheduleReportDraftAutoSave() {
		if (isDemisioner && !canReviseOwnReport) return;
		if (reportDraftAutoSaveTimer) clearTimeout(reportDraftAutoSaveTimer);
		reportDraftAutoSaveTimer = setTimeout(() => { writeFullDraftToStorage(); }, 800);
	}

	async function restoreDraftIfAny(date: string): Promise<boolean> {
		try {
			const record = await loadReportDraft(draftKey(date));
			if (record?.fields) {
				if (record.savedAt && Date.now() - record.savedAt > REPORT_DRAFT_TTL_MS) {
					await clearDraft(date);
					return false;
				}
				Object.assign(reportData, record.fields);
				// Fase 2 Dokumentasi Foto (26 Sep 2026) — foto_bukti/foto_kendala per baris ikut
				// tersimpan sebagai File asli di dalam fields.progress/fields.issues (structured
				// clone IndexedDB mendukung File/Blob langsung, beda dari array foto bernama di
				// atas). Tapi blob: URL lama sudah mati setelah reload — regenerasi di sini.
				for (const row of (reportData as any).progress || []) {
					row.foto_bukti = (row.foto_bukti || []).map((p: any) => p?.file ? { ...p, url: URL.createObjectURL(p.file) } : p);
				}
				for (const row of (reportData as any).issues || []) {
					row.foto_kendala = (row.foto_kendala || []).map((p: any) => p?.file ? { ...p, url: URL.createObjectURL(p.file) } : p);
				}
				(reportData as any).attendance_photos = record.photos.attendance_photos.map(packetToPhoto).filter(Boolean);
				(reportData as any).progress_photos = record.photos.progress_photos.map(packetToPhoto).filter(Boolean);
				(reportData as any).issue_photos = record.photos.issue_photos.map(packetToPhoto).filter(Boolean);
				(reportData as any).toolbox_photos = (record.photos.toolbox_photos || []).map(packetToPhoto).filter(Boolean);
				(reportData as any).area_kerja_photos = (record.photos.area_kerja_photos || []).map(packetToPhoto).filter(Boolean);
				(reportData as any).weekend_photos = record.photos.weekend_photos.map(packetToPhoto).filter(Boolean);
				budgetReceiptFile = packetToPhoto(record.photos.budget_receipt);
				(reportData as any).budget_items = (record.fields.budget_items as any[]).map((item, i) => ({
					...item,
					receipt_file: packetToPhoto(record.photos.budget_item_receipts[i])
				}));
				reportDraftSavedAt = record.savedAt ? new Date(record.savedAt) : null;
				reportDraftHasPhotos = hasAnyPhoto(record.photos);
				return true;
			}
		} catch (e) {
			console.error('Gagal memuat draft (IndexedDB):', e);
		}
		// Fallback: draft lama skema teks-saja di localStorage (migrasi/perangkat lama).
		try {
			const raw = localStorage.getItem(draftKey(date));
			if (!raw) return false;
			const parsed = JSON.parse(raw);
			if (!parsed?.fields) return false;
			if (parsed.savedAt && Date.now() - parsed.savedAt > REPORT_DRAFT_TTL_MS) {
				await clearDraft(date);
				return false;
			}
			Object.assign(reportData, parsed.fields);
			reportDraftSavedAt = parsed.savedAt ? new Date(parsed.savedAt) : null;
			reportDraftHasPhotos = false;
			return true;
		} catch (e) {
			console.error('Gagal memuat draft lokal:', e);
			return false;
		}
	}

	async function clearDraft(date: string) {
		reportDraftSavedAt = null;
		reportDraftHasPhotos = false;
		await clearReportDraft(draftKey(date));
		try { localStorage.removeItem(draftKey(date)); } catch { /* abaikan */ }
	}

	// Auto-save berjalan begitu form sudah dimuat (bukan sebelum, supaya restore/loadReportData
	// awal tidak langsung menimpa draft dengan snapshot kosong).
	let reportDraftAutoSaveArmed = $state(false);
	$effect(() => {
		for (const key of DRAFT_FIELDS) void (reportData as any)[key];
		if (!reportDraftAutoSaveArmed) return;
		scheduleReportDraftAutoSave();
	});

	// Jaring pengaman (rencana v2, Fase 3, 3.1): titik simpan wajib pagehide & visibilitychange,
	// BUKAN beforeunload — tidak diandalkan di Android saat OS mematikan tab karena RAM habis.
	onMount(() => {
		const flush = () => { if (reportDraftAutoSaveArmed) writeFullDraftToStorage(); };
		const onVisibility = () => { if (document.visibilityState === 'hidden') flush(); };
		window.addEventListener('pagehide', flush);
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			window.removeEventListener('pagehide', flush);
			document.removeEventListener('visibilitychange', onVisibility);
		};
	});

	// Fase 4 ("Offline-First Daily Report"): beri tahu (BUKAN auto-kirim, lihat catatan
	// keputusan di sendReport() di atas) saat koneksi kembali dan laporan hari ini belum
	// terkirim — supaya leader tidak lupa menekan "Kirim" lagi setelah sinyal balik.
	onMount(() => {
		const onOnline = () => {
			isOffline = false;
			if (!savedReportId && reportDraftSavedAt) {
				alert('Koneksi internet kembali tersambung. Draft laporan hari ini masih tersimpan — jangan lupa tekan "Kirim" untuk mengirimkannya.');
			}
		};
		const onOffline = () => { isOffline = true; };
		window.addEventListener('online', onOnline);
		window.addEventListener('offline', onOffline);
		return () => {
			window.removeEventListener('online', onOnline);
			window.removeEventListener('offline', onOffline);
		};
	});

	// Kebijakan status otomatis: waiting -> on progress begitu laporan pertama masuk,
	// lalu on progress -> "menunggu verifikasi" begitu overall_progress laporan mencapai
	// 100%. TIDAK auto-final ke "selesai"/"closed" — itu tetap lewat alur Closing/Evaluasi
	// (BAST) di Admin, supaya progress volume 100% tidak melompati approval yang wajib.
	// Status lain (hold/repair/selesai/closed/menunggu verifikasi) sengaja tidak disentuh
	// di sini biar tidak menimpa keputusan manual yang sudah ada.
	async function applyAutoProjectStatusTransition(overallProgress: number | null) {
		if (!project?.id) return;
		const currentStatus = (project.status || '').toLowerCase().trim();
		let nextStatus: string | null = null;
		// overallProgress null artinya target_progress proyek belum diisi — tidak bisa
		// dihitung persentasenya, tapi laporan tetap sudah masuk, jadi status minimal
		// naik dari "waiting" ke "on progress".
		if (overallProgress != null && overallProgress >= 100 && (currentStatus === 'on progress' || currentStatus === 'waiting')) {
			nextStatus = 'menunggu verifikasi';
		} else if (currentStatus === 'waiting') {
			nextStatus = 'on progress';
		}
		if (!nextStatus || nextStatus === currentStatus) return;
		try {
			await updateProjectStatus(project.id, nextStatus);
			project.status = nextStatus;
		} catch (e) {
			console.warn('Gagal memperbarui status proyek otomatis:', e);
		}
	}

	async function sendReport() {
		vibrateTap();
		try {
			if (isDemisioner && !canReviseOwnReport) {
				alert('Anda berstatus sebagai Leader Demisioner pada proyek ini (Akses Read-Only). Pengiriman laporan harian baru hanya dapat dilakukan oleh Project Leader yang sedang aktif.');
				return;
			}
			submitting = true;

			// Prepare clean lists to avoid sending empty/default placeholders
			const cleanSchedule = reportData.schedule
				.filter(item => item.activity && item.activity.trim() !== '')
				.map(item => ({
					activity: item.activity.trim(),
					start_time: item.start_time || '',
					end_time: item.end_time || '',
					status: item.status || 'pending'
				}));

			// SPL-05 / PAKET-2: Wajibkan subtask_id untuk setiap baris progres yang diisi
			const invalidProgressRow = reportData.progress.find((item: any) => {
				const hasProgressValue = (Number(item.progress_value) || 0) > 0;
				const hasActivity = !!(item.activity && item.activity.trim());
				const isFilled = hasProgressValue || hasActivity;
				return isFilled && (!item.subtask_id || !String(item.subtask_id).trim());
			});

			if (invalidProgressRow) {
				alert('Pilih pekerjaan (subtask) dari Timeline supaya progres terhitung di grafik proyek.');
				activeTab = 'progress';
				submitting = false;
				uploadStatusText = '';
				return;
			}

			const cleanProgress = reportData.progress
				.filter(item => (item.activity && item.activity.trim() !== '') || item.subtask_id !== '')
				.map(item => {
					const calc = getSubtaskCalculation(item);
					return applyRowExtra({
						subtask_id: item.subtask_id || '',
						activity: item.activity ? item.activity.trim() : '',
						progress_value: Number(item.progress_value) || 0,
						unit: item.unit || 'm²',
						notes: item.notes || '',
						category: item.category || '',
						target_volume: Number(item.target_volume) || calc.target || 0,
						daily_target: calc.dailyTarget || 0,
						prev_volume: calc.prev || 0,
						cumulative_volume: calc.total || 0,
						persen: calc.totalPct || 0,
						sisa: calc.remaining || 0,
						qc_measured: item.qc_measured || null,
						service_type: item.service_type || '' // R8 v2 — penanda jenis pekerjaan untuk akurasi durasi per fase
					}, item._extra);
				});

			const cleanMaterialUsed = reportData.material_used
				.filter(item => item.type && item.type.trim() !== '')
				.map(item => ({
					type: item.type.trim(),
					amount: Number(item.amount) || 0,
					unit: item.unit || 'kg',
					notes: item.notes || '',
					expense_id: item.expense_id || '',
					identitas_barang_id: item.identitas_barang_id || (item.expense_id ? actualMaterials.find(m => String(m.id) === String(item.expense_id))?.identitas_barang_id : null) || null,
					is_manual: !!item.is_manual
				}));

			const cleanMaterialNeeds = reportData.material_needs
				.filter(item => {
					const name = item.description || item.type || '';
					return name.trim() !== '';
				})
				.map(item => {
					const name = (item.description || item.type || '').trim();
					return {
						type: name,
						amount: Number(item.amount) || 0,
						unit: item.unit || 'kg',
						notes: item.notes || '',
						urgency: item.urgency || 'normal',
						description: name,
						date_needed: item.date_needed || '',
						expense_id: item.expense_id || '',
						identitas_barang_id: item.identitas_barang_id || (item.expense_id ? actualMaterials.find(m => String(m.id) === String(item.expense_id))?.identitas_barang_id : null) || null,
						is_manual: !!item.is_manual
					};
				});

			const cleanTomorrowPlan = reportData.tomorrow_plan
				.filter(item => item.activity && item.activity.trim() !== '')
				.map(item => ({
					activity: item.activity.trim(),
					notes: item.notes || '',
					description: item.description || ''
				}));

			const cleanIssues = reportData.issues
				.filter(item => item.description && item.description.trim() !== '')
				.map(item => ({
					description: item.description.trim()
				}));

			const cleanManpower = reportData.manpower
				.filter(item => item.role === 'STANDBY' || (Number(item.count) || 0) > 0 || (item.workers && item.workers.length > 0))
				.map(item => {
					// R2-11: baris pekerja kosong (tanpa id DAN tanpa nama) dibuang — dulu 15 baris kosong menjadi 10 absensi anonim.
					const workers = (item.workers || [])
						.filter((w: any) => idNum(w?.id) || String(w?.nama || '').trim() !== '')
						.map((w: any) => ({ id: w.id, nama: w.nama, posisi: w.posisi }));
					return {
						role: item.role,
						// jumlah tidak boleh lebih kecil dari pekerja yang sudah dicatat bernama
						count: Math.max(Number(item.count) || 0, workers.length),
						notes: item.notes || '',
						workers
					};
				});
			// R2-11: manpower_count dihitung ulang dari isi (sebelumnya terpisah dari isi grup: #3491 0 vs 15, #3492 2 vs 17).
			const manpowerCountFromContent = cleanManpower.reduce((n: number, g: any) => n + (Number(g.count) || 0), 0);

			// G1 — checklist alat bukan lagi teks bebas, tapi snapshot dari status P2H
			// hari ini (lensa, bukan sumber kedua). Lihat getProjectEquipmentP2hStatus.
			const cleanTools = projectEquipmentP2h.map(eq => ({
				equipment_id: eq.equipmentId,
				name: eq.code ? `${eq.name} (${eq.code})` : eq.name,
				raw_name: eq.name,
				code: eq.code || null,
				category: eq.categoryName || null,
				amount: 1,
				p2h_result: eq.result,
				p2h_checked: eq.hasSession,
				status_unit: eq.statusUnit || null,
				status_operational: eq.statusOperational || null,
				hoursmeter: eq.hoursmeter ?? eq.lastHoursmeter ?? null,
				jam_selesai_pakai: eq.jamSelesaiPakai || null,
				operator: eq.operatorName || null,
				keterangan: eq.keterangan || null,
				foto_unit: eq.fotoUnit || null,
				is_loan: eq.isLoan || false
			}));

			// SPL-05 (opsi B) — draft lama bisa masih membawa baris "kategori saja" (tanpa subtask_id).
			// Cegat dengan pesan spesifik sebelum gate generik "Progress tanpa subtask".
			if (!isHold) {
				const barisKategoriSaja = reportData.progress.filter((p: any) => p.category_only && !p.subtask_id);
				if (barisKategoriSaja.length > 0) {
					activeTab = 'progress';
					alert(`${barisKategoriSaja.length} baris progress memilih kategori yang belum punya rincian pekerjaan di Timeline.\n\nPilih pekerjaan (subtask) dari Timeline supaya progres terhitung di grafik proyek. Bila kategorinya belum punya subtask, minta PM menambah subtask dulu.`);
					submitting = false;
					return;
				}

				// Mitigasi Disiplin Jadwal (G_LAPOR_SUBTASK_SCHEDULE, Fase 3)
				// Deteksi subtask yang dilaporkan tapi belum memiliki jadwal rencana harian
				const unscheduledProgress = cleanProgress.filter((p: any) => {
					if (!p.subtask_id) return false;
					const sub = findSubtaskById(p.subtask_id);
					return sub && !hasValidSchedule(sub);
				});

				if (unscheduledProgress.length > 0) {
					const names = unscheduledProgress.map(p => `• ${p.activity || 'Pekerjaan'}`).join('\n');
					const proceed = confirm(
						`⚠️ PERINGATAN KEDISIPLINAN JADWAL (G_LAPOR_SUBTASK_SCHEDULE):\n\n` +
						`Ada ${unscheduledProgress.length} subtask yang belum dijadwalkan di timeline (rencana harian masih kosong):\n` +
						`${names}\n\n` +
						`Disarankan menentukan jadwal cepat agar progres tercatat akurat pada Kurva S.\n\n` +
						`• Klik "Cancel" untuk menjadwalkan sekarang.\n` +
						`• Klik "OK" jika ingin tetap mengirim laporan.`
					);

					if (!proceed) {
						activeTab = 'progress';
						submitting = false;
						const firstUnscheduled = findSubtaskById(unscheduledProgress[0].subtask_id);
						if (firstUnscheduled) {
							openQuickSchedule(firstUnscheduled);
						}
						return;
					}
				}
			}

			// Fase 1 (Gate Keras Disiplin Data & Laporan Harian, 17 Sep 2026) — gate SELALU
			// dievaluasi, termasuk saat Hold (menutup C2: sebelumnya `if (!isHold)` melewati
			// SELURUH blok ini, jadi laporan Hold kosong total lolos tanpa dicek apa pun).
			// Status Hold sekarang wajib lolos G_LH_HOLD_ALASAN + G_LH_HOLD_FOTO_STANDBY;
			// gate jadwal/progress/material otomatis not_applicable saat Hold (lihat
			// laporanHarianRules.ts — field-field itu memang disembunyikan dari UI Hold).
			{
				const isFriday = new Date(reportData.date).getDay() === 5;
				// Fase 2 Dokumentasi Foto (26 Sep 2026) — gate G_LH_PROGRESS_FOTO_PER_ITEM cuma
				// butuh tahu ADA/TIDAKNYA foto per baris (belum perlu id hasil upload asli, itu
				// baru ada setelah loop upload di bawah). Placeholder non-kosong cukup untuk
				// evaluasi isEmpty() di laporanHarianRules.ts.
				const progressForGateCheck = cleanProgress.map((item, idx) => {
					const row = reportData.progress[idx];
					const fotoCount = (row?.existing_foto_bukti?.length || 0) + (row?.foto_bukti?.length || 0);
					return { ...item, foto_bukti: fotoCount > 0 ? ['ada-foto'] : [] };
				});
				const rawGates = evaluateLaporanHarianGates({
					cleanSchedule, cleanTomorrowPlan, cleanProgress: progressForGateCheck,
					progressPhotosCount: reportData.progress_photos.length + existingProgressPhotos.length,
					cleanMaterialUsed, cleanManpower,
					attendancePhotosCount: reportData.attendance_photos.length + existingAttendancePhotos.length,
					isFriday,
					weekendLocationRecap: reportData.weekend_location_recap,
					weekendPhotosCount: reportData.weekend_photos.length + existingWeekendPhotos.length,
					issuePhotosCount: reportData.issue_photos.length + existingIssuePhotos.length,
					toolboxPhotosCount: reportData.toolbox_photos.length + existingToolboxPhotos.length,
					areaKerjaPhotosCount: reportData.area_kerja_photos.length + existingAreaKerjaPhotos.length,
					date: reportData.date,
					activityStatus: reportData.activity_status,
					holdReason: reportData.hold_reason,
					weather: reportData.weather,
					manpowerCount: reportData.manpower_count,
					generalNotes: reportData.general_notes,
					issuesGeneral: reportData.issues_general,
					tomorrowPlanSummary: reportData.tomorrow_plan_summary,
					karyawanId: get(authStore).karyawanId || null,
					hseDaily: reportData.hse_daily,
					downtimeLog: (reportData.downtime_log || []).filter((d: any) => Number(d.durasi_jam) > 0),
					qcAmbient: {
						applicable: qcAmbientApplicable || !!reportData.qc_ambient?.applicable,
						filled_today: qcAmbientFilledToday || !!(reportData.qc_ambient?.steel_temp !== null || reportData.qc_ambient?.air_temp !== null || reportData.qc_ambient?.relative_humidity !== null)
					},
					materialVariance: {
						flagged: materialVarianceCheck.flagged,
						note: reportData.material_variance_note
					}
				});
				// Seluruh gate foto & kelengkapan (HARD GATES) wajib lolos sebelum submit
				const failedGates = rawGates.filter((g) => g.status === 'failed' && g.severity === 'WAJIB');
				if (failedGates.length > 0) {
					// tab 'umum' (cuaca/jml tenaga/narasi) dirender di atas tab bar, bukan
					// sebagai tab tersendiri — arahkan ke 'summary' supaya isi tab tidak kosong.
					const targetTab = failedGates[0].tab;
					if (targetTab === 'umum') {
						activeTab = 'summary';
					} else if (targetTab === 'toolbox' || targetTab === 'hse') {
						activeTab = 'hse';
					} else if (targetTab === 'area_kerja') {
						activeTab = 'lainnya';
					} else {
						activeTab = targetTab;
					}
					// Fase 2 (Gate Transparan & Popup Benahi Data) — tempeli hint dari admin
					// (gate_definitions G_LH_*, diisi Fase 0). gate_key sudah disamakan di
					// laporanHarianGates.ts supaya nyambung ke sini.
					const hintResult = await fetchGateHints('project_report', 'laporan_harian');
					gateWizardHintsUnavailable = !hintResult.available;
					gateWizardGates = applyGateHints(rawGates, hintResult);
					gateWizardOpen = true;
					submitting = false;
					return;
				}
			}

			// Soft check & pengingat P2H equipment (pre-job & post-job selesai pakai)
			if (projectEquipmentP2h.length > 0) {
				const uncheckedUnits = projectEquipmentP2h.filter(eq => !eq.hasSession);
				const openUnits = projectEquipmentP2h.filter(eq => eq.hasSession && eq.sesiTerbuka);
				if (uncheckedUnits.length > 0) {
					const confirmUnchecked = confirm(
						`⚠️ Perhatian: Ada ${uncheckedUnits.length} unit equipment yang belum dilakukan checklist P2H hari ini (${uncheckedUnits.map(u => u.name).join(', ')}).\n\nTetap kirim laporan harian?`
					);
					if (!confirmUnchecked) {
						submitting = false;
						activeTab = 'equipment';
						return;
					}
				}
				if (openUnits.length > 0) {
					const confirmOpen = confirm(
						`⏳ Pengingat Selesai Pakai: Ada ${openUnits.length} unit (${openUnits.map(u => u.name).join(', ')}) yang belum diisi jam selesai operasi (penutupan sesi P2H).\n\nJika operasional alat sudah selesai, disarankan menutup sesi P2H terlebih dahulu.\n\nTetap kirim laporan harian sekarang?`
					);
					if (!confirmOpen) {
						submitting = false;
						activeTab = 'equipment';
						return;
					}
				}
			}

			// Validate quantities against remaining stock
			for (const item of cleanMaterialUsed) {
				if (!item.is_manual && item.expense_id) {
					const selected = actualMaterials.find(m => String(m.id) === String(item.expense_id));
					if (selected && item.amount > selected.qty_remaining) {
						const confirmUse = confirm(`Jumlah pengeluaran untuk "${item.type}" (${item.amount} ${item.unit}) melebihi sisa stok di RAP Actual (${selected.qty_remaining} ${selected.unit}). Tetap kirim laporan?`);
						if (!confirmUse) {
							submitting = false;
							return;
						}
					}
				}
			}

			// Validate budget items spent amount against remaining balance
			for (const item of reportData.budget_items) {
				if (item.expense_id) {
					if (item.expense_id === 'REIMBURSE') {
						if (!item.spent_amount || item.spent_amount <= 0) {
							alert('Nominal pengeluaran untuk reimbursement harus lebih dari 0.');
							submitting = false;
							return;
						}
						if (!item.description || !item.description.trim()) {
							alert('Deskripsi pengeluaran reimbursement harus diisi.');
							submitting = false;
							return;
						}
						if (!item.receipt_file && !item.receipt_id) {
							alert('Reimbursement wajib melampirkan foto nota/kwitansi.');
							submitting = false;
							return;
						}
					} else {
						const selected = budgetExpenses.find(e => String(e.id) === String(item.expense_id));
						if (selected) {
							const remaining = (Number(selected.debit_amount) || Number(selected.expense_amount) || 0) - (previousSpentMap[selected.id] || 0);
							if (item.spent_amount > remaining) {
								const confirmSpend = confirm(`Nominal pengeluaran untuk "${selected.material_name}" (${formatRupiah(item.spent_amount)}) melebihi sisa anggaran (${formatRupiah(remaining)}). Tetap kirim laporan?`);
								if (!confirmSpend) {
									submitting = false;
									return;
								}
							}
						}
					}
				} else {
					alert('Ada item breakdown budget yang belum dipilih anggarannya.');
					submitting = false;
					return;
				}
			}

			// Fase 4 (implementation_plan_ai_pertajam.md, rekomendasi #2 lapangan "Offline-First
			// Daily Report"): cek koneksi SEBELUM mulai rangkaian upload+tulis (bukan auto-submit
			// saat online kembali — lihat catatan keputusan sengaja di offlineReportDraft.ts:
			// submit ini menghitung delta stok/anggaran terhadap data server SAAT ITU, jadi replay
			// diam-diam bisa salah hitung. Ini HANYA mencegah submit gagal berantakan di tengah
			// jalan saat offline — draft tetap aman tersimpan (auto-save sudah jalan), user yang
			// menekan Kirim lagi sendiri begitu online.
			if (typeof navigator !== 'undefined' && navigator.onLine === false) {
				await writeFullDraftToStorage();
				alert('Tidak ada koneksi internet. Laporan sudah tersimpan sebagai draft di perangkat ini — tekan "Kirim" lagi begitu koneksi kembali.');
				submitting = false;
				uploadStatusText = '';
				return;
			}

			// Helper upload file dengan per-file retry & backoff untuk area sinyal buruk
			const uploadWithRetry = async (file: File, label: string, maxRetries = 3): Promise<any> => {
				let lastError: any = null;
				for (let attempt = 1; attempt <= maxRetries; attempt++) {
					try {
						if (attempt > 1) {
							uploadStatusText = `Mengulang unggah ${label} (${attempt}/${maxRetries})...`;
							await new Promise(r => setTimeout(r, attempt * 800));
						}
						const res = await uploadFile(file);
						if (res && (res.id || (res as any).data?.id)) {
							return res;
						}
						throw new Error('Upload tidak mengembalikan ID file');
					} catch (err) {
						lastError = err;
						console.warn(`Percobaan upload ke-${attempt} gagal untuk ${file.name}:`, err);
					}
				}
				throw lastError || new Error(`Gagal mengunggah ${file.name}`);
			};

			const ensurePhotoUploaded = async (
				photoObj: { file: File; name: string; url: string; uploadedId?: string | null },
				label: string
			): Promise<string> => {
				if (photoObj.uploadedId) {
					return photoObj.uploadedId;
				}
				uploadStatusText = `Mengunggah ${label}...`;
				const uploaded = await uploadWithRetry(photoObj.file, label, 3);
				const uploadedId = uploaded.id || uploaded.data?.id;
				photoObj.uploadedId = uploadedId;
				// Segera simpan snapshot draft terupdate agar tidak upload ulang jika koneksi putus di foto selanjutnya
				writeFullDraftToStorage().catch(() => {});
				return uploadedId;
			};

			const attendance_photos: string[] = [...(existingAttendancePhotos || [])];
			for (let i = 0; i < reportData.attendance_photos.length; i++) {
				const photo = reportData.attendance_photos[i];
				const uploadedId = await ensurePhotoUploaded(photo, `foto absensi (${i + 1}/${reportData.attendance_photos.length})`);
				if (uploadedId) attendance_photos.push(uploadedId);
			}

			const progress_photos: string[] = [...(existingProgressPhotos || [])];
			for (let i = 0; i < reportData.progress_photos.length; i++) {
				const photo = reportData.progress_photos[i];
				const uploadedId = await ensurePhotoUploaded(photo, `foto progress (${i + 1}/${reportData.progress_photos.length})`);
				if (uploadedId) progress_photos.push(uploadedId);
			}

			const issue_photos: string[] = [...(existingIssuePhotos || [])];
			for (let i = 0; i < reportData.issue_photos.length; i++) {
				const photo = reportData.issue_photos[i];
				const uploadedId = await ensurePhotoUploaded(photo, `foto kendala (${i + 1}/${reportData.issue_photos.length})`);
				if (uploadedId) issue_photos.push(uploadedId);
			}

			const toolbox_photos: string[] = [...(existingToolboxPhotos || [])];
			for (let i = 0; i < reportData.toolbox_photos.length; i++) {
				const photo = reportData.toolbox_photos[i];
				const uploadedId = await ensurePhotoUploaded(photo, `foto toolbox meeting (${i + 1}/${reportData.toolbox_photos.length})`);
				if (uploadedId) toolbox_photos.push(uploadedId);
			}

			const area_kerja_photos: string[] = [...(existingAreaKerjaPhotos || [])];
			for (let i = 0; i < reportData.area_kerja_photos.length; i++) {
				const photo = reportData.area_kerja_photos[i];
				const uploadedId = await ensurePhotoUploaded(photo, `foto area kerja (${i + 1}/${reportData.area_kerja_photos.length})`);
				if (uploadedId) area_kerja_photos.push(uploadedId);
			}

			// Fase 2 Dokumentasi Foto (26 Sep 2026) — foto per baris progress (foto_bukti) &
			// per baris kendala (foto_kendala), TAMBAHAN di luar foto_photos/issue_photos umum.
			const progressFotoBuktiByRow: string[][] = [];
			for (let i = 0; i < reportData.progress.length; i++) {
				const row = reportData.progress[i] as any;
				const rowIds: string[] = [...(row.existing_foto_bukti || [])];
				for (let j = 0; j < (row.foto_bukti || []).length; j++) {
					const uploadedId = await ensurePhotoUploaded(row.foto_bukti[j], `foto progress baris ${i + 1} (${j + 1}/${row.foto_bukti.length})`);
					if (uploadedId) rowIds.push(uploadedId);
				}
				progressFotoBuktiByRow.push(rowIds);
			}

			const issueFotoKendalaByRow: string[][] = [];
			for (let i = 0; i < reportData.issues.length; i++) {
				const row = reportData.issues[i] as any;
				const rowIds: string[] = [...(row.existing_foto_kendala || [])];
				for (let j = 0; j < (row.foto_kendala || []).length; j++) {
					const uploadedId = await ensurePhotoUploaded(row.foto_kendala[j], `foto kendala baris ${i + 1} (${j + 1}/${row.foto_kendala.length})`);
					if (uploadedId) rowIds.push(uploadedId);
				}
				issueFotoKendalaByRow.push(rowIds);
			}

			// Gabungkan id foto per baris (foto_bukti/foto_kendala) ke progress/issues final —
			// filter/map SAMA PERSIS dengan cleanProgress/cleanIssues di atas supaya urutan baris
			// yang lolos filter tetap sinkron dengan progressFotoBuktiByRow/issueFotoKendalaByRow
			// (diindeks dari reportData.progress/issues MENTAH, sebelum difilter).
			const finalProgressWithFoto = reportData.progress
				.map((item: any, idx: number) => ({ item, idx }))
				.filter(({ item }) => (item.activity && item.activity.trim() !== '') || item.subtask_id !== '')
				.map(({ item, idx }) => {
					const calc = getSubtaskCalculation(item);
					return applyRowExtra({
						subtask_id: item.subtask_id || '',
						activity: item.activity ? item.activity.trim() : '',
						progress_value: Number(item.progress_value) || 0,
						unit: item.unit || 'm²',
						notes: item.notes || '',
						category: item.category || '',
						target_volume: Number(item.target_volume) || calc.target || 0,
						daily_target: calc.dailyTarget || 0,
						prev_volume: calc.prev || 0,
						cumulative_volume: calc.total || 0,
						persen: calc.totalPct || 0,
						sisa: calc.remaining || 0,
						qc_measured: item.qc_measured || null,
						service_type: item.service_type || '',
						foto_bukti: progressFotoBuktiByRow[idx] || [],
						// Executor Partitioning Fase 3 — snapshot pelaksana ikut tersimpan per baris progres.
						executor_type: item.executor_type || null, 
						executor_vendor_name: item.executor_vendor_name || null,
						external_party: item.external_party || null,
						readiness_status: item.readiness_status || null,
						readiness_checklist: item.readiness_checklist || []
					}, item._extra);
				});

			const finalIssuesWithFoto = reportData.issues
				.map((item: any, idx: number) => ({ item, idx }))
				.filter(({ item }) => item.description && item.description.trim() !== '')
				.map(({ item, idx }) => ({
					description: item.description.trim(),
					foto_kendala: issueFotoKendalaByRow[idx] || []
				}));
			const weekend_photos: string[] = [...(existingWeekendPhotos || [])];
			for (let i = 0; i < reportData.weekend_photos.length; i++) {
				const photo = reportData.weekend_photos[i];
				const uploadedId = await ensurePhotoUploaded(photo, `foto weekend (${i + 1}/${reportData.weekend_photos.length})`);
				if (uploadedId) weekend_photos.push(uploadedId);
			}

			// Upload main budget receipt
			let budget_receipt = existingBudgetReceipt || null;
			if (budgetReceiptFile) {
				const uploadedId = await ensurePhotoUploaded(budgetReceiptFile, 'nota pengeluaran');
				if (uploadedId) budget_receipt = uploadedId;
			}

			// Upload per-item budget receipts and format budget_items
			const finalBudgetItems = [];
			for (let i = 0; i < reportData.budget_items.length; i++) {
				const item = reportData.budget_items[i];
				let receipt_id = item.receipt_id || null;
				if (item.receipt_file) {
					const uploadedId = await ensurePhotoUploaded(item.receipt_file, `nota item #${i + 1}`);
					if (uploadedId) receipt_id = uploadedId;
				}

				if (item.expense_id === 'REIMBURSE') {
					uploadStatusText = 'Menyiapkan klaim reimbursement...';
					// Generate unique reference number and invoice number matching ERP patterns
					const dateObj = new Date();
					const tzOffset = dateObj.getTimezoneOffset() * 60000;
					const localDateStr = new Date(dateObj.getTime() - tzOffset).toISOString().split('T')[0];
					const yearStr = dateObj.getFullYear();
					const monthStr = String(dateObj.getMonth() + 1).padStart(2, '0');
					const randomStr = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
					const reference_number = `RM-${yearStr}${monthStr}-${randomStr}`;
					const invoice_number = `RMB-${yearStr}${monthStr}-${randomStr}`;

					// Create project_expenses entry (costing)
					const newExpense = await createProjectExpense({
						project_id: Number(projectId),
						expense_date: localDateStr,
						expense_type: 'reimbursement',
						expense_category: item.expense_category || 'operasional',
						pic: userName,
						reference_number,
						material_name: item.description,
						qty: 1,
						unit: 'lot',
						unit_price: Number(item.spent_amount) || 0,
						expense_amount: Number(item.spent_amount) || 0,
						debit_amount: 0,
						credit_amount: 0,
						description: item.description,
						source: 'daily_report'
					});

					if (newExpense && newExpense.id) {
						// Create purchase_invoices entry (ERP Finance AP)
						await createPurchaseInvoice({
							invoice_number,
							payable_type: 'REIMBURSEMENT',
							invoice_date: localDateStr,
							due_date: localDateStr,
							supplier_name: userName,
							description: `[REIMBURSEMENT] - ${item.description}`,
							subtotal: Number(item.spent_amount) || 0,
							total_amount: Number(item.spent_amount) || 0,
							paid_amount: 0,
							outstanding_amount: Number(item.spent_amount) || 0,
							payment_status: 'UNPAID',
							project_id: Number(projectId),
							expense_id: newExpense.id
						});

						finalBudgetItems.push({
							expense_id: newExpense.id,
							reference_number,
							description: item.description,
							spent_amount: Number(item.spent_amount) || 0,
							receipt_id
						});
					}
				} else {
					finalBudgetItems.push({
						expense_id: item.expense_id,
						reference_number: item.reference_number,
						description: item.description,
						spent_amount: Number(item.spent_amount) || 0,
						receipt_id
					});
				}
			}

			// Progress fisik proyek dihitung per-subtask (unit-aware) dari timeline_planning,
			// BUKAN sum raw progress_value ÷ target_progress — target_progress bisa satuan
			// komersial SO berbeda (mis. "1 lot") dari satuan progres fisik subtask (m²), yang
			// menyebabkan overflow >100% & status proyek salah lompat ke menunggu verifikasi
			// (lihat correction_plan_progress_unit_mismatch_lot_vs_m2 di repo erp-epi-1, Fase 6).
			const overallProgressForSubmit = calculateCumulativeProjectProgress(
				project,
				allReportsForProgress,
				finalProgressWithFoto,
				savedReportId
			);
			// Fase 3 (Loop Perbaikan, menutup C6) — mengirim ulang laporan yang sedang
			// revision_requested mengembalikan status ke 'submitted' (baris di bawah sudah
			// melakukan ini apa adanya) DAN mencatat kapan+berapa kali diperbaiki.
			const isResubmitFromRevision = savedReportId && priorReportStatus === 'revision_requested';
			const reportPayload = {
				project_id: Number(projectId),
				date: reportData.date,
				prepared_by: userName,
				karyawan_id: get(authStore).karyawanId || null,
				status: 'submitted',
				...(isResubmitFromRevision
					? { revisi_selesai_at: new Date().toISOString(), revisi_count: priorRevisiCount + 1 }
					: {}),
				activity_status: reportData.activity_status,
				hold_reason: reportData.activity_status === 'hold' ? reportData.hold_reason : null,
				project_type: reportData.project_type,
				weather: reportData.weather,
				manpower_count: manpowerCountFromContent,
				issues_general: reportData.issues_general,
				general_notes: reportData.general_notes,
				tomorrow_plan_summary: reportData.tomorrow_plan_summary,
				// Fase 1 Laporan Lapangan & Paritas ERP (16 Okt 2026) — tab HSE & K3.
				// snapshot cuplikan getProjectHseCompleteness() SAAT submit, untuk jejak audit
				// (sumber kebenarannya tetap koleksi hse_permit/toolbox_meeting/hse_incident/jsa_project).
				hse_daily: {
					apd_compliance: reportData.hse_daily?.apd_compliance || '',
					catatan_k3: reportData.hse_daily?.catatan_k3 || '',
					snapshot: hseSummary ? {
						ptw_aktif: hseSummary.ptwAktif,
						toolbox_hari_ini: hseSummary.toolboxHariIni,
						insiden_belum_selesai: hseSummary.insidenBelumSelesai,
						jsa_berlaku: hseSummary.jsaBerlaku
					} : null
				},
				downtime_log: (reportData.downtime_log || []).filter((d: any) => Number(d.durasi_jam) > 0),
				// Fase 2 Laporan Lapangan & Paritas ERP (16 Okt 2026) — QC Ambient, Rasio Material, SI/VO.
				qc_ambient: {
					applicable: qcAmbientApplicable,
					filled_today: qcAmbientFilledToday,
					snapshot: inspectionSummary ? {
						steel_temp: inspectionSummary.steelTemp,
						dew_point: inspectionSummary.dewPoint,
						rh_pct: inspectionSummary.rhPct,
						hold_point_flag: inspectionSummary.holdPointFlag,
						avg_dft: inspectionSummary.avgDft,
						measured_at: inspectionSummary.measuredAt
					} : null
				},
				material_variance: {
					flagged: materialVarianceCheck.flagged,
					worst_variance_pct: materialVarianceCheck.worstPct,
					note: materialVarianceCheck.flagged ? (reportData.material_variance_note || '') : '',
					items: materialVarianceCheck.items.map((it) => ({
						identitas_barang_id: it.identitasBarangId,
						label: it.label,
						standard_ratio: it.standardRatio,
						actual_ratio: it.actualRatio,
						variance_pct: it.variancePct
					}))
				},
				client_instructions: (reportData.client_instructions || []).filter((ci: any) => (ci.pengawas_klien && ci.pengawas_klien.trim()) || (ci.isi_instruksi && ci.isi_instruksi.trim())),
				overall_progress: overallProgressForSubmit,
				schedule: cleanSchedule,
				progress: finalProgressWithFoto,
				material_used: cleanMaterialUsed,
				material_stock: reportData.material_stock || [],
				material_needs: cleanMaterialNeeds,
				tomorrow_plan: cleanTomorrowPlan,
				issues: finalIssuesWithFoto,
				manpower: cleanManpower,
				tools: cleanTools,
				budget_notes: reportData.budget_notes || '',
				attendance_photos,
				progress_photos,
				issue_photos,
				toolbox_photos,
				area_kerja_photos,
				weekend_location_recap: isFriday ? reportData.weekend_location_recap : '',
				weekend_photos: isFriday ? weekend_photos : [],
				...(alasanTerlambat.trim() ? { alasan_input_admin: alasanTerlambat.trim() } : {}),
				budget_receipt,
				budget_items: finalBudgetItems,
				// Fase 2 Paritas Field Lengkap (reports.* JSON fields)
				hse_daily: {
					apd_compliance: reportData.hse_daily?.apd_compliance || '',
					catatan_k3: reportData.hse_daily?.catatan_k3 || '',
					toolbox_jam: reportData.hse_daily?.toolbox_jam || '',
					toolbox_topik: reportData.hse_daily?.toolbox_topik || ''
				},
				downtime_log: (reportData.downtime_log || []).filter((d: any) => Number(d.durasi_jam) > 0),
				qc_ambient: {
					applicable: reportData.qc_ambient.applicable,
					filled_today: !!(reportData.qc_ambient.steel_temp !== null || reportData.qc_ambient.air_temp !== null || reportData.qc_ambient.relative_humidity !== null),
					snapshot: {
						steel_temp: reportData.qc_ambient.steel_temp,
						dew_point: reportData.qc_ambient.dew_point,
						relative_humidity: reportData.qc_ambient.relative_humidity,
						air_temp: reportData.qc_ambient.air_temp,
						catatan: reportData.qc_ambient.catatan
					}
				},
				material_variance: {
					note: reportData.material_variance_note || ''
				},
				client_instructions: reportData.client_instructions || []
			};

			// Mirror ke Universal Approval Engine SENGAJA DINONAKTIFKAN dulu — approval_matrix
			// 'laporan.harian' belum punya approver yang benar2 bisa login (firebase_uid kosong),
			// jadi mengaktifkannya sekarang hanya akan membuat approval_requests yatim yang
			// tidak pernah muncul di inbox siapapun. Untuk mengaktifkan kembali: submit ke
			// submitApprovalRequest (lihat $lib/services/approvalApi) sekali saat !savedReportId
			// (laporan baru), setelah approver PROJECT (Anwar/Fatin) punya akun Firebase — lihat
			// project-laporan-harian-approval memory.
			let created;
			uploadStatusText = 'Menyimpan laporan ke server...';
			if (savedReportId) {
				// Sengaja TIDAK menulis ulang kapasitas pengirim saat update — itu fakta
				// saat laporan pertama dibuat, bukan saat disunting.
				created = await updateReport(savedReportId, reportPayload);
			} else {
				// Sistem Manpower Leader: catat siapa yang mengirim dan dalam kapasitas apa.
				// Kursi lapangan yang menentukan, bukan role — role tidak mengikat orang
				// ke proyek tertentu.
				const sebagaiManpowerLeader = pegangKursiLapangan(projectId);
				created = await submitReport({
					...reportPayload,
					disubmit_sebagai: sebagaiManpowerLeader ? 'manpower_leader' : 'project_leader',
					disubmit_oleh_manpower_id: sebagaiManpowerLeader
						? get(authStore).manpowerId
						: null
				});
				// Notifikasi Terpusat v2 — Fase 6 rollout Project. Fire-and-forget: kegagalan
				// di sini tidak boleh menggagalkan laporan yang sudah tersimpan di atas.
				const newReportId: number | string | undefined = created?.id;
				if (newReportId) {
					auth.currentUser
						?.getIdToken()
						.then((idToken) =>
							fetch('/api/laporan/notify-submitted', {
								method: 'POST',
								headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
								body: JSON.stringify({
									reportId: newReportId,
									projectId,
									projectName: project?.name,
									// Executor Partitioning Fase 5 — nama vendor dgn progres di laporan ini (dedup),
									// dipakai server buat notifikasi tambahan ke PM. Dihitung client-side (data sudah
									// ada di finalProgressWithFoto), supaya endpoint tidak perlu fetch ulang report.
									vendorNames: [...new Set(
										finalProgressWithFoto
											.filter((p) => p.executor_type === 'vendor')
											.map((p) => p.executor_vendor_name || 'Vendor')
									)],
									// Fase 2 Laporan Lapangan & Paritas ERP (16 Okt 2026) — instruksi klien berpotensi
									// VO di laporan ini memicu notifikasi ke Admin Project. Nama pengawas PERTAMA
									// yang bertanda VO dipakai di pesan notifikasi (cukup untuk konteks awal).
									clientInstructionVoPengawas: (reportData.client_instructions || []).find((ci: any) => ci.berpotensi_vo)?.pengawas_klien || ''
								})
							})
						)
						.catch(() => {});
				}
				// UX-05: ganti auto-checkout diam-diam dengan prompt eksplisit (fail-soft, tidak
				// pernah menggagalkan laporan yang sudah tersimpan).
				cekPromptMasihDiLokasi(newReportId);
			}

			// Update project_expenses quantities in the database.
			// Apply only the delta vs. this report's previous material_used, so re-saving
			// (edit) doesn't re-add the full amount on top of what was already deducted.
			const oldAmountByExpenseId: Record<string, number> = {};
			for (const item of originalMaterialUsed) {
				if (!item.is_manual && item.expense_id) {
					oldAmountByExpenseId[item.expense_id] = (oldAmountByExpenseId[item.expense_id] || 0) + (Number(item.amount) || 0);
				}
			}
			const newAmountByExpenseId: Record<string, number> = {};
			for (const item of cleanMaterialUsed) {
				if (!item.is_manual && item.expense_id) {
					newAmountByExpenseId[item.expense_id] = (newAmountByExpenseId[item.expense_id] || 0) + item.amount;
				}
			}
			const expenseIds = new Set([...Object.keys(oldAmountByExpenseId), ...Object.keys(newAmountByExpenseId)]);
			// Fase 2 (Rencana Implementasi Inventory Proyek v2.0): delta yang sama ini juga jadi
			// OUT-USAGE di project_stock_ledger untuk proyek pilot -- satu sumber kebenaran delta,
			// dua tempat tulis (project_expenses.qty_used seperti biasa + ledger kalau proyeknya pilot).
			const usageLedgerDeltas: { expenseId: string; identitasBarangId: number | null; delta: number; rabBudgetId: number | null }[] = [];
			for (const expenseId of expenseIds) {
				const delta = (newAmountByExpenseId[expenseId] || 0) - (oldAmountByExpenseId[expenseId] || 0);
				if (delta === 0) continue;
				const selected = actualMaterials.find(m => String(m.id) === String(expenseId));
				if (selected) {
					const newQtyUsed = (selected.qty_used || 0) + delta;
					const newQtyRemaining = selected.qty - newQtyUsed;
					await updateProjectExpenseQty(expenseId, {
						qty_used: newQtyUsed,
						qty_remaining: newQtyRemaining
					});
					usageLedgerDeltas.push({
						expenseId,
						identitasBarangId: selected.identitas_barang_id || null,
						delta,
						rabBudgetId: selected.rab_budget_id || null
					});
				}
			}
			originalMaterialUsed = JSON.parse(JSON.stringify(cleanMaterialUsed));

			if (usageLedgerDeltas.length > 0) {
				// Non-blocking secara sengaja: laporan & project_expenses (di atas) adalah sumber
				// kebenaran yang wajib berhasil. Kegagalan tulis ledger tidak boleh membuat leader
				// mengira laporannya gagal tersimpan -- lihat catatan skip di api/inventory-proyek/usage.
				reportUsageDeltas(Number(projectId), created?.id ?? savedReportId ?? null, crypto.randomUUID(), usageLedgerDeltas)
					.then((r) => {
						// Hasil dulu diabaikan: skip karena kegagalan (mis. error tulis ledger) tidak pernah terlihat siapa pun.
						const failed = realUsageSkips(r?.skipped);
						if (failed.length) {
							console.warn('Sebagian pemakaian tidak masuk ledger inventory proyek:', failed);
							usageStockWarnings = [...usageStockWarnings, `${failed.length} pemakaian material tersimpan di laporan tetapi BELUM tercatat di stok proyek. Beri tahu Admin Project agar dicek.`];
						}
					})
					.catch((e) => {
						console.error('Gagal mencatat pemakaian ke ledger inventory proyek:', e);
						usageStockWarnings = [...usageStockWarnings, 'Pemakaian material tersimpan di laporan tetapi BELUM tercatat di stok proyek (koneksi/izin bermasalah). Beri tahu Admin Project agar dicek.'];
					});
			}
			// Entri "Tulis Manual" tidak punya expense_id → tidak mengurangi stok & tidak masuk ledger (lihat materialManualMatch.ts).
			const manualUsed = manualUsageItems(cleanMaterialUsed);
			usageStockWarnings = manualUsed.length
				? [`${manualUsed.length} pemakaian diketik manual (${manualUsed.slice(0, 3).map((m: any) => m.type).join(', ')}${manualUsed.length > 3 ? ', …' : ''}) sehingga TIDAK mengurangi stok proyek. Lain kali pilih dari daftar material kiriman agar stok & biaya akurat.`]
				: [];

			if (created && created.id) {
				savedReportId = created.id;
				await syncManpowerAbsensi(created.id, cleanManpower, reportData.date);
			}
			await applyAutoProjectStatusTransition(overallProgressForSubmit);
			await updateProject(projectId, { total_progress: String(overallProgressForSubmit) }).catch(e => console.warn('Gagal sync total_progress:', e));
			reportStatus = 'submitted';
			isLocked = true;
			await clearDraft(reportData.date);
			postReportSnapshotPromptOpen = true;
		} catch (e: any) {
			console.error('handleSubmit error:', e);
			// Deteksi kegagalan jaringan (bukan error HTTP dari server) — pesan berbeda karena
			// draft (termasuk foto) sudah tersimpan otomatis di perangkat (writeFullDraftToStorage),
			// jadi leader tidak kehilangan isian, tinggal coba kirim ulang saat sinyal kembali.
			// Submit TIDAK di-antri otomatis (beda dari modul lain) karena alur ini membuat
			// invoice reimbursement & menghitung delta stok -- replay offline berisiko pakai
			// snapshot stok/anggaran basi (lihat offlineReportDraft.ts).
			const isNetworkError = e instanceof TypeError &&
				/failed to fetch|networkerror|load failed/i.test(String(e?.message || ''));
			if (isNetworkError) {
				alert('Gagal mengirim laporan — sepertinya koneksi internet terputus. Isian Anda sudah tersimpan otomatis di perangkat ini, coba kirim ulang setelah sinyal kembali.');
			} else {
				alert(e?.message ? `Gagal mengirim laporan: ${e.message}` : 'Gagal mengirim laporan.');
			}
		} finally {
			submitting = false;
			uploadStatusText = '';
		}
	}

	// Menyatukan pekerja yang diisi di tab Tenaga langsung ke manpower_absensi (Modul Gajian),
	// supaya tidak perlu input manual ulang. Hanya pekerja dengan SPK/assignment aktif di proyek
	// ini yang bisa disinkron (assignment menyimpan rate untuk akrual biaya harian).
	async function syncManpowerAbsensi(reportId: number, manpowerGroups: any[], tanggal: string) {
		try {
			const res = await getAssignments({ project_id: Number(projectId), status: 'aktif' });
			const assignments = res.success ? res.data : [];
			// R2-11: penugasan tanpa manpower_id TIDAK BOLEH jadi kunci (String(null) === 'null' akan cocok dengan pekerja ber-id kosong
			// dan menghasilkan absensi anonim). Hanya id numerik positif yang sah.
			const byManpowerId = new Map(
				assignments
					.map((a: any) => [idNum(a.manpower_id), a] as const)
					.filter(([mid]) => mid !== null)
					.map(([mid, a]) => [String(mid), a])
			);

			const skipped: string[] = [];
			for (const group of manpowerGroups) {
				// Grup STANDBY (Hold) selalu standby; grup lain pakai jam/OT/standby per
				// pekerja yang diisi saat ditambahkan (fallback 8 jam untuk data lama sebelum
				// field ini ada).
				const groupIsStandby = group.role === 'STANDBY';
				for (const w of group.workers || []) {
					// R2-11: baris pekerja tanpa id (belum memilih nama) dilewati, bukan dicocokkan ke "null".
					if (!idNum(w?.id)) {
						skipped.push(w?.nama || '(tanpa nama)');
						continue;
					}
					const assignment = byManpowerId.get(String(idNum(w.id)));
					if (!assignment) {
						skipped.push(w.nama || `#${w.id}`);
						continue;
					}
					const isStandby = groupIsStandby || !!w.is_standby;
					const jamKerja = isStandby ? 0 : (w.jam != null ? Number(w.jam) : 8);
					const status = w.status || (isStandby ? 'standby' : (jamKerja === 4 ? 'setengah_hari' : 'hadir'));
					await upsertTimesheetAbsensi({
						assignmentId: assignment.id,
						manpowerId: w.id,
						projectId: Number(projectId),
						tanggal,
						jamKerja,
						notes: group.notes || '',
						dicatatOleh: userName,
						reportId,
						is_holiday: !!w.is_holiday,
						ot_hours: isStandby ? 0 : Number(w.ot_hours) || 0,
						is_standby: isStandby,
						uang_makan: !!w.uang_makan,
						kasbonAmount: Number(w.kasbon_amount || w.kasbon_val || w.kasbon || 0),
						dobelProyekFlag: !!w.dobel_proyek_flag,
						dobelProyekProyekLainId: w.dobel_proyek_proyek_lain_id,
						status
					});
				}
			}

			// Evaluasi defisit manpower lapangan & trigger alert ke n8n jika defisit > 20%
			if (assignments.length > 0) {
				const plan = assignments.length;
				let actual = 0;
				for (const group of manpowerGroups) {
					for (const w of group.workers || []) {
						if (byManpowerId.has(String(w.id)) && ['hadir', 'setengah_hari', 'standby'].includes(w.status || 'hadir')) {
							actual++;
						}
					}
				}
				const deficitPct = Math.round(((plan - actual) / plan) * 100);
				if (deficitPct > 20) {
					auth.currentUser?.getIdToken().then((idToken) => {
						fetch('/api/laporan/notify-submitted', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
							body: JSON.stringify({
								reportId,
								projectId,
								projectName: project?.name,
								headcountActual: actual,
								headcountPlan: plan
							})
						}).catch(() => {});
					});
				}
			}

			if (skipped.length > 0) {
				alert(`Laporan tersimpan. Catatan: ${skipped.join(', ')} belum tercatat otomatis di absensi Gajian karena belum punya SPK/penugasan aktif di proyek ini.`);
			}
		} catch (e) {
			console.error('syncManpowerAbsensi:', e);
		}
	}

	function editReport() {
		if (isDemisioner && !canReviseOwnReport) {
			alert('Mode Read-Only: Leader demisioner tidak dapat mengedit laporan proyek ini.');
			return;
		}
		isLocked = false;
	}

	// Fase 6 (open-source plan, "download PDF laporan sendiri") — render server-side
	// via Gotenberg (VPS, sama instance yang dipakai erp-epi-1). Butuh online (fetch
	// biasa) -- laporan yang sudah terkirim berarti sudah tersimpan di server, jadi
	// tidak perlu jalur offline seperti draft pengisian.
	let downloadingPdf = $state(false);
	let previewPdfBlob = $state<Blob | null>(null);
	let previewPdfTitle = $state<string>('');
	let showPdfPreview = $state(false);

	async function downloadReportPdf(audience: 'internal' | 'customer' = 'internal') {
		if (!savedReportId) return;
		downloadingPdf = true;
		try {
			const user = auth?.currentUser;
			if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
			const token = await user.getIdToken();
			const res = await fetch(`/api/laporan/${savedReportId}/export-pdf?audience=${audience}&whiteLabel=true`, {
				headers: { Authorization: `Bearer ${token}` }
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body?.message || `HTTP ${res.status}`);
			}
			const blob = await res.blob();
			previewPdfBlob = blob;
			previewPdfTitle = `Laporan-Harian-${audience === 'customer' ? 'Customer-' : ''}${reportData.date || savedReportId}.pdf`;
			showPdfPreview = true;
		} catch (e) {
			alert(`Gagal memuat PDF: ${e instanceof Error ? e.message : 'Error'}`);
		} finally {
			downloadingPdf = false;
		}
	}

	async function handleStatusChange(e: Event) {
		if (isDemisioner) {
			alert('Mode Read-Only: Leader demisioner tidak dapat mengubah status laporan.');
			return;
		}
		const val = (e.target as HTMLSelectElement).value;
		reportStatus = val;
		if (!savedReportId) return;
		updatingStatus = true;
		try {
			await updateReport(savedReportId, { status: val });
		} catch {
			alert('Gagal mengubah status');
		} finally {
			updatingStatus = false;
		}
	}

	function addSchedule() {
		reportData.schedule = [...reportData.schedule, { activity: '', start_time: '', end_time: '', status: 'pending' }];
	}
	function removeSchedule(i: number) {
		reportData.schedule = reportData.schedule.filter((_, idx) => idx !== i);
	}

	let scheduleFilterMode = $state<'workhours' | 'filled' | 'all'>('workhours');
	let activeSlotSuggestionsIndex = $state<number | null>(null);

	function isCurrentHourSlot(startTime?: string, endTime?: string): boolean {
		if (!startTime) return false;
		const now = new Date();
		const currentMinutes = now.getHours() * 60 + now.getMinutes();

		const [sh, sm] = startTime.split(':').map(Number);
		const startMinutes = (sh || 0) * 60 + (sm || 0);

		let endMinutes = 24 * 60;
		if (endTime) {
			const [eh, em] = endTime.split(':').map(Number);
			endMinutes = (eh || 0) * 60 + (em || 0);
			if (eh === 24) endMinutes = 24 * 60;
		}

		return currentMinutes >= startMinutes && currentMinutes < endMinutes;
	}

	let scheduleStats = $derived.by(() => {
		const list = reportData.schedule || [];
		let filled = 0;
		let complete = 0;
		let onProgress = 0;
		let pending = 0;
		let totalMinutes = 0;

		for (const item of list) {
			const hasAct = !!(item.activity && item.activity.trim());
			if (hasAct) {
				filled++;
				if (item.status === 'complete') complete++;
				else if (item.status === 'on-progress') onProgress++;
				else pending++;

				if (item.start_time && item.end_time) {
					const [sh, sm] = item.start_time.split(':').map(Number);
					const [eh, em] = item.end_time.split(':').map(Number);
					if (!isNaN(sh) && !isNaN(eh)) {
						let diff = (eh * 60 + (em || 0)) - (sh * 60 + (sm || 0));
						if (diff <= 0 && eh === 24) diff = (24 * 60) - (sh * 60 + (sm || 0));
						if (diff > 0) totalMinutes += diff;
						else totalMinutes += 60;
					} else {
						totalMinutes += 60;
					}
				} else {
					totalMinutes += 60;
				}
			}
		}

		const hours = (totalMinutes / 60).toFixed(1).replace('.0', '');
		return {
			filled,
			complete,
			onProgress,
			pending,
			hours,
			totalMinutes
		};
	});

	function shouldShowScheduleSlot(item: any, mode: 'workhours' | 'filled' | 'all'): boolean {
		const hasActivity = !!(item.activity && item.activity.trim());
		if (mode === 'all') return true;
		if (mode === 'filled') return hasActivity || !isDefaultSlot(item);
		if (mode === 'workhours') {
			if (!isDefaultSlot(item)) return true;
			if (hasActivity) return true;
			const startH = parseInt((item.start_time || '0').split(':')[0], 10);
			return startH >= 7 && startH < 18;
		}
		return true;
	}

	function applyStandardShift() {
		vibrateTap();
		const subtaskNames = availableSubtasks.map(s => s.name).filter(Boolean);
		const mainTask1 = subtaskNames[0] || 'Pekerjaan Utama Sesuai Timeline Proyek';
		const mainTask2 = subtaskNames[1] || subtaskNames[0] || 'Lanjutan Pekerjaan Utama Proyek';

		const presetMap: Record<string, { activity: string; status: string }> = {
			'08:00': { activity: 'Safety Briefing (Tool Box Meeting), Cek APD & Persiapan Alat', status: 'complete' },
			'09:00': { activity: `${mainTask1} (Sesi Pagi)`, status: 'complete' },
			'10:00': { activity: `${mainTask1} (Lanjutan)`, status: 'complete' },
			'11:00': { activity: `${mainTask1} (Lanjutan)`, status: 'complete' },
			'12:00': { activity: 'Istirahat, Makan Siang & Sholat (Ishoma)', status: 'complete' },
			'13:00': { activity: `${mainTask2} (Sesi Siang)`, status: 'complete' },
			'14:00': { activity: `${mainTask2} (Lanjutan)`, status: 'complete' },
			'15:00': { activity: `${mainTask2} (Lanjutan)`, status: 'complete' },
			'16:00': { activity: 'Housekeeping, Pembersihan Area & Evaluasi Harian', status: 'complete' }
		};

		reportData.schedule = reportData.schedule.map(slot => {
			const key = (slot.start_time || '').substring(0, 5);
			if (presetMap[key]) {
				return {
					...slot,
					activity: presetMap[key].activity,
					status: presetMap[key].status
				};
			}
			return slot;
		});
	}

	function applyOvertimeShift() {
		vibrateTap();
		const subtaskNames = availableSubtasks.map(s => s.name).filter(Boolean);
		const mainTask = subtaskNames[0] || 'Pekerjaan Lembur Proyek';

		const overtimeMap: Record<string, { activity: string; status: string }> = {
			'17:00': { activity: 'Istirahat Sore & Safety Briefing Pekerjaan Lembur', status: 'complete' },
			'18:00': { activity: `${mainTask} (Lembur Sesi 1)`, status: 'on-progress' },
			'19:00': { activity: `${mainTask} (Lembur Sesi 2)`, status: 'on-progress' },
			'20:00': { activity: `${mainTask} (Lembur Sesi 3)`, status: 'on-progress' },
			'21:00': { activity: 'Housekeeping, Final Check & Serah Terima Selesai Lembur', status: 'complete' }
		};

		reportData.schedule = reportData.schedule.map(slot => {
			const key = (slot.start_time || '').substring(0, 5);
			if (overtimeMap[key]) {
				return {
					...slot,
					activity: overtimeMap[key].activity,
					status: overtimeMap[key].status
				};
			}
			return slot;
		});
	}

	function importFromProgressTab() {
		vibrateTap();
		const activeProgressItems = reportData.progress
			.filter(p => (p.activity && p.activity.trim()) || p.subtask_id)
			.map(p => p.activity ? p.activity.trim() : (availableSubtasks.find(s => s.id === p.subtask_id)?.name || 'Pekerjaan Lapangan'));

		if (activeProgressItems.length === 0) {
			alert('Belum ada item pekerjaan di tab Progress untuk diimpor. Isi tab Progress terlebih dahulu atau gunakan preset standar.');
			return;
		}

		const targetHours = ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00'];
		reportData.schedule = reportData.schedule.map(slot => {
			const key = (slot.start_time || '').substring(0, 5);
			const idx = targetHours.indexOf(key);
			if (idx !== -1) {
				const itemToAssign = activeProgressItems[idx % activeProgressItems.length];
				return {
					...slot,
					activity: slot.activity && slot.activity.trim() ? slot.activity : itemToAssign,
					status: 'complete'
				};
			}
			if (key === '08:00' && !slot.activity) {
				return { ...slot, activity: 'Safety Briefing (TBM) & Persiapan Alat/Material', status: 'complete' };
			}
			if (key === '12:00' && !slot.activity) {
				return { ...slot, activity: 'Istirahat, Makan Siang & Sholat (Ishoma)', status: 'complete' };
			}
			if (key === '16:00' && !slot.activity) {
				return { ...slot, activity: 'Housekeeping / Pembersihan Area & Evaluasi Harian', status: 'complete' };
			}
			return slot;
		});
	}

	function markAllFilledComplete() {
		vibrateTap();
		reportData.schedule = reportData.schedule.map(s => {
			if (s.activity && s.activity.trim()) {
				return { ...s, status: 'complete' };
			}
			return s;
		});
	}

	function clearAllScheduleSlots() {
		if (!confirm('Kosongkan semua teks kegiatan di jadwal?')) return;
		vibrateTap();
		reportData.schedule = getInitialSchedule();
	}

	const QUICK_ACTIVITY_SUGGESTIONS = [
		{ label: '🛡️ TBM & APD', text: 'Safety Briefing (Tool Box Meeting) & Cek APD' },
		{ label: '🚚 Mobilisasi Alat', text: 'Mobilisasi & Persiapan Alat / Material' },
		{ label: '☕ Ishoma', text: 'Istirahat, Makan Siang & Sholat (Ishoma)' },
		{ label: '🧹 Housekeeping', text: 'Housekeeping / Pembersihan Area Kerja & Evaluasi Harian' },
		{ label: '⚡ QC & Finishing', text: 'Pengecekan Kualitas (QC) & Finishing Pekerjaan' }
	];

	function setSlotActivity(slotIndex: number, text: string) {
		vibrateTap();
		reportData.schedule[slotIndex].activity = text;
		if (reportData.schedule[slotIndex].status === 'pending') {
			reportData.schedule[slotIndex].status = 'complete';
		}
		activeSlotSuggestionsIndex = null;
	}

	function removeTomorrowPlan(index: number) {
		reportData.tomorrow_plan = reportData.tomorrow_plan.filter((_, i) => i !== index);
		if (reportData.tomorrow_plan.length === 0) {
			reportData.tomorrow_plan = [{ activity: '', notes: '', description: '' }];
		}
	}

	function addSubtaskToTomorrowPlan(subtaskName: string) {
		vibrateTap();
		if (reportData.tomorrow_plan.length === 1 && !reportData.tomorrow_plan[0].activity && !reportData.tomorrow_plan[0].description) {
			reportData.tomorrow_plan[0] = {
				description: subtaskName,
				activity: `Lanjutan ${subtaskName}`,
				notes: ''
			};
		} else {
			reportData.tomorrow_plan = [
				...reportData.tomorrow_plan,
				{
					description: subtaskName,
					activity: `Lanjutan ${subtaskName}`,
					notes: ''
				}
			];
		}
	}
	let previewPhotoUrl = $state<string | null>(null);

	async function openPhotoPreview(source: string) {
		if (!source) return;
		if (source.startsWith('blob:') || source.startsWith('data:') || source.startsWith('http')) {
			previewPhotoUrl = source;
		} else {
			try {
				previewPhotoUrl = await getSecureAssetUrl(source);
			} catch {
				previewPhotoUrl = null;
			}
		}
	}

	// Peta akumulasi volume yang telah dikerjakan pada laporan-laporan sebelumnya
	let subtaskHistoricalMap = $derived.by(() => {
		const map: Record<string, number> = {};
		for (const r of allReportsForProgress || []) {
			if (savedReportId != null && String(r.id) === String(savedReportId)) continue;
			let items = r.progress;
			if (typeof items === 'string') {
				try { items = JSON.parse(items); } catch { items = []; }
			}
			if (!Array.isArray(items)) continue;
			for (const pi of items) {
				const val = Number(pi.progress_value) || 0;
				if (pi.subtask_id) {
					map[pi.subtask_id] = (map[pi.subtask_id] || 0) + val;
				}
				if (pi.activity) {
					const actKey = `act_${pi.activity.trim().toLowerCase()}`;
					map[actKey] = (map[actKey] || 0) + val;
				}
			}
		}
		return map;
	});

	function getPreviousProgress(subtaskId: string, activityName: string): number {
		if (subtaskId && subtaskHistoricalMap[subtaskId] != null) {
			return subtaskHistoricalMap[subtaskId];
		}
		if (activityName) {
			const actKey = `act_${activityName.trim().toLowerCase()}`;
			if (subtaskHistoricalMap[actKey] != null) {
				return subtaskHistoricalMap[actKey];
			}
		}
		return 0;
	}

	// Fase 8 (opsional) — Auto-QC Tolerance Checker. Cari objek subtask asli (yang punya
	// `spec` dari drawer admin, Fase 2) dari subtask_id yang dipilih di baris progress ini.
	function findSubtaskById(id: string | null | undefined) {
		if (!id) return null;
		return timelineCategories.flatMap((c: any) => c.subtasks || []).find((s: any) => s.id === id) || null;
	}

	function getSubtaskCalculation(item: any) {
		const prev = getPreviousProgress(item.subtask_id, item.activity);
		const today = Number(item.progress_value) || 0;
		const target = Number(item.target_volume) || 0;
		const total = prev + today;
		const prevPct = target > 0 ? Math.min(100, Math.round((prev / target) * 100)) : 0;
		const totalPct = target > 0 ? Math.round((total / target) * 100) : 0;
		const todayPct = target > 0 ? Math.round((today / target) * 100) : 0;
		const remaining = target > 0 ? Math.max(0, target - total) : 0;
		const remainingBeforeToday = target > 0 ? Math.max(0, target - prev) : 0;
		const isOver = target > 0 && total > target;
		const overAmount = isOver ? total - target : 0;

		// Target Harian dari Kurva S (daily_plan) untuk tanggal laporan ini
		const subtaskObj = findSubtaskById(item.subtask_id);
		const dailyTarget = (subtaskObj?.daily_plan && reportData.date) ? (Number(subtaskObj.daily_plan[reportData.date]) || 0) : 0;
		const dailyTargetPct = dailyTarget > 0 ? Math.round((today / dailyTarget) * 100) : 0;

		return {
			prev,
			today,
			target,
			total,
			prevPct,
			totalPct,
			todayPct,
			remaining,
			remainingBeforeToday,
			isOver,
			overAmount,
			dailyTarget,
			dailyTargetPct
		};
	}

	// Rekomendasi L2 (Site Readiness Checklist) — daftar tetap, cukup untuk dokumentasi
	// kesiapan area sebelum admin ERP menandai resmi "Siap". Bukan gate/blocker (Aturan #6):
	// leader tetap bisa kirim laporan meski checklist belum lengkap.
	const READINESS_CHECKLIST_ITEMS = [
		{ key: 'akses_jalan', label: 'Akses jalan ke area' },
		{ key: 'listrik', label: 'Listrik tersedia' },
		{ key: 'air', label: 'Air tersedia' },
		{ key: 'scaffolding', label: 'Scaffolding/perancah terpasang' },
		{ key: 'area_bersih', label: 'Area bersih dari halangan' }
	];

	// Executor Partitioning Fase 3 — prefix teks (option tidak bisa render badge HTML) supaya
	// leader tahu siapa pelaksana subtask ini sebelum memilih. null/'internal' tanpa prefix
	// (perilaku lama tidak berubah untuk subtask legacy).
	function getExecutorPrefix(sub: any) {
		if (sub.executor_type === 'vendor') return `🤝 [Vendor${sub.executor_vendor_name ? ': ' + sub.executor_vendor_name : ''}] `;
		if (sub.executor_type === 'external_prereq') return `⏳ [Prasyarat Eksternal${sub.external_party ? ': ' + sub.external_party : ''}] `;
		return '';
	}

	function getSubtaskDropdownLabel(sub: any) {
		const prev = getPreviousProgress(sub.id, sub.name);
		const target = Number(sub.volume) || 0;
		const unit = sub.unit || 'm²';
		const prefix = getExecutorPrefix(sub);
		if (target > 0) {
			const pct = Math.round((prev / target) * 100);
			const rem = Math.max(0, target - prev);
			if (pct >= 100) {
				return `${prefix}[✓ Tuntas 100%] ${sub.name} (${prev}/${target} ${unit})`;
			}
			return `${prefix}[${pct}%] ${sub.name} (Selesai ${prev}/${target} ${unit} • Sisa ${rem} ${unit})`;
		}
		return `${prefix}${sub.name} (${prev > 0 ? `Lalu: ${prev} ${unit}` : `Plan: ${target} ${unit}`})`;
	}

	function fillRemainingTarget(item: any, remaining: number) {
		if (remaining > 0) {
			item.progress_value = remaining;
		}
	}

	// Deteksi cerdas jenis pekerjaan dari nama subtask & kategori (R8 v2 / Analisa Estimasi ERP)
	function autoDetectServiceType(activity: string, category: string = ''): string {
		const text = `${activity} ${category}`.toLowerCase();
		if (text.includes('blast') || text.includes('wab') || text.includes('grit') || text.includes('sand')) {
			return 'sandblasting';
		}
		if (text.includes('coat') || text.includes('paint') || text.includes('cat') || text.includes('primer') || text.includes('top coat') || text.includes('intermediate') || text.includes('dft')) {
			return 'painting';
		}
		if (text.includes('floor') || text.includes('epoxy') || text.includes('lantai') || text.includes('screed') || text.includes('coving')) {
			return 'floor_coating';
		}
		if (text.includes('weld') || text.includes('las') || text.includes('sambung') || text.includes('fit up')) {
			return 'welding';
		}
		if (text.includes('sipil') || text.includes('cor') || text.includes('beton') || text.includes('galian') || text.includes('pondasi')) {
			return 'sipil';
		}
		return '';
	}

	function handleSubtaskSelect(item: any, selectedVal: string) {
		if (!selectedVal) {
			item.is_custom = false;
			item.category_only = false;
			item.category_id = null;
			item.subtask_id = '';
			item.category = '';
			item.activity = '';
			item.target_volume = 0;
			item.executor_type = null;
			item.executor_vendor_name = null;
			item.external_party = null;
			item.readiness_status = null;
			item.readiness_checklist = [];
			return;
		}

		// SPL-05 (opsi B): kategori tanpa subtask TIDAK boleh dipilih — progresnya tak punya
		// subtask_id sehingga tidak bisa dihitung server. SubtaskPicker sudah menonaktifkan opsinya;
		// ini pengaman bila ada jalur lain yang memanggil.
		if (selectedVal.startsWith('__CAT__')) {
			alert('Kategori ini belum punya rincian pekerjaan di Timeline. Minta PM menambah subtask dulu.');
			return;
		}

		if (selectedVal === '__CUSTOM__') {
			item.is_custom = true;
			item.category_only = false;
			item.category_id = null;
			item.subtask_id = '';
			item.category = 'Pekerjaan Tambahan';
			item.activity = '';
			item.unit = 'm²';
			item.target_volume = 0;
			item.executor_type = null;
			item.executor_vendor_name = null;
			item.external_party = null;
			item.readiness_status = null;
			item.readiness_checklist = [];
		} else if (selectedVal.startsWith('__CAT__')) {
			// Opsi B (SPL-05): Tolak pilihan kategori tanpa subtask
			alert('Kategori ini belum punya rincian pekerjaan di Timeline. Minta PM menambah subtask dulu.');
			item.is_custom = false;
			item.category_only = false;
			item.category_id = null;
			item.subtask_id = '';
			item.category = '';
			item.activity = '';
			item.target_volume = 0;
			item.executor_type = null;
			item.executor_vendor_name = null;
			item.external_party = null;
			item.readiness_status = null;
			item.readiness_checklist = [];
			return;
		} else {
			item.is_custom = false;
			item.category_only = false;
			item.category_id = null;
			item.subtask_id = selectedVal;
			const selected = timelineCategories.flatMap((c: any) => c.subtasks || []).find((s: any) => s.id === selectedVal);
			if (selected) {
				item.category = timelineCategories.find((c: any) => (c.subtasks || []).some((s: any) => s.id === selectedVal))?.name || '';
				item.activity = selected.name || '';
				item.unit = selected.unit || 'm²';
				item.target_volume = selected.volume || 0;
				// Executor Partitioning Fase 3 — snapshot pelaksana ke draft item, ikut tersimpan
				// ke reports.progress[] (lihat finalProgressWithFoto). Admin-only yang boleh
				// menandai external_prereq "siap" (di ERP) — lapangan hanya membawa info ini.
				item.executor_type = selected.executor_type || null;
				item.executor_vendor_name = selected.executor_vendor_name || null;
				item.external_party = selected.external_party || null;
				item.readiness_status = null;
				item.readiness_checklist = [];
				// external_prereq bobot 0% (bukan lingkup pekerjaan EPI) — progress_value selalu 0,
				// leader hanya melapor status kesiapan (lihat blok UI "Status Kesiapan Area").
				if (item.executor_type === 'external_prereq') {
					item.progress_value = 0;
				}
			}
		}

		// R8 v2: Auto-detect Jenis Pekerjaan jika belum ditandai manual
		if (!item.service_type && item.activity) {
			const detected = autoDetectServiceType(item.activity, item.category);
			if (detected) {
				item.service_type = detected;
			}
		}
	}

	// Pratinjau progres fisik unit-aware: simulasi draft laporan hari ini diterapkan ke
	// salinan timeline_planning (per subtask_id, tanpa menyentuh state project asli), lalu
	// dihitung ulang lewat calculateProjectProgressPercentage() (per-subtask, unit-aware) --
	// BUKAN raw volume ÷ target_progress (bisa satuan komersial SO beda dari fisik subtask,
	// lihat correction_plan_progress_unit_mismatch_lot_vs_m2 erp-epi-1, Fase 6 lanjutan).
	// Item draft TANPA subtask_id (aktivitas custom/freeform) tidak bisa diatribusikan ke
	// subtask manapun -- tidak ikut pratinjau %, konsisten dgn batasan yang sama di
	// overallProjectProgressPct (subtaskSummaryList) di bawah.
	function previewProgressPercentageWithDraft(baseProject: any, draftItems: any[]): number {
		if (!baseProject) return 0;
		const prevPct = calculateProjectProgressPercentage(baseProject);
		if (draftItems.length === 0) return prevPct;

		let planning = baseProject.timeline_planning;
		if (typeof planning === 'string') {
			try { planning = JSON.parse(planning); } catch { planning = null; }
		}
		if (!planning?.categories?.length) return prevPct;

		const clonedCategories = planning.categories.map((cat: any) => ({
			...cat,
			subtasks: (cat.subtasks || []).map((sub: any) => ({ ...sub, daily_actual: { ...(sub.daily_actual || {}) } }))
		}));
		const previewKey = '__draft_preview__';
		for (const pi of draftItems) {
			for (const cat of clonedCategories) {
				const sub = (cat.subtasks || []).find((s: any) => s.id === pi.subtask_id);
				if (sub) {
					sub.daily_actual[previewKey] = (sub.daily_actual[previewKey] || 0) + (Number(pi.progress_value) || 0);
					break;
				}
			}
		}
		return calculateProjectProgressPercentage({ ...baseProject, timeline_planning: { ...planning, categories: clonedCategories } });
	}

	let projectProgressOverview = $derived.by(() => {
		const targetProgress = Number(project?.target_progress) || 0;

		let prevTotalVolume = 0;
		for (const r of allReportsForProgress || []) {
			if (savedReportId != null && String(r.id) === String(savedReportId)) continue;
			let items = r.progress;
			if (typeof items === 'string') {
				try { items = JSON.parse(items); } catch { items = []; }
			}
			if (!Array.isArray(items)) continue;
			for (const pi of items) {
				prevTotalVolume += Number(pi.progress_value) || 0;
			}
		}

		let todayTotalVolume = 0;
		let activeTasksCount = 0;
		const draftItemsWithSubtask: any[] = [];
		for (const pi of reportData.progress) {
			const val = Number(pi.progress_value) || 0;
			if (val > 0 && ((pi.activity && pi.activity.trim()) || pi.subtask_id)) {
				todayTotalVolume += val;
				activeTasksCount++;
				if (pi.subtask_id) draftItemsWithSubtask.push(pi);
			}
		}

		const cumulativeTotal = prevTotalVolume + todayTotalVolume;
		const prevPct = calculateCumulativeProjectProgress(project, allReportsForProgress, [], savedReportId);
		const overallPct = calculateCumulativeProjectProgress(project, allReportsForProgress, reportData.progress, savedReportId);
		const todayDeltaPct = Math.max(0, overallPct - prevPct);

		return {
			targetProgress,
			prevTotalVolume,
			todayTotalVolume,
			cumulativeTotal,
			overallPct,
			prevPct,
			todayDeltaPct,
			activeTasksCount
		};
	});

	// Kartu "Target Hari Ini vs Realisasi" — target dari Kurva S (daily_plan) tanggal laporan.
	let dailyTargetRows = $derived(computeDailyTarget(project, reportData.date, reportData.progress));

	function addProgress() {
		reportData.progress = [...reportData.progress, { subtask_id: '', activity: '', progress_value: 0, unit: 'm²', notes: '', category: '', target_volume: 0, service_type: '', is_custom: false, existing_foto_bukti: [], foto_bukti: [] }];
	}
	function removeProgress(i: number) {
		reportData.progress = reportData.progress.filter((_, idx) => idx !== i);
	}
	async function handleProgressItemPhoto(rowIndex: number, event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			const file = await stampIfPositionAvailable(target.files[0]);
			const url = URL.createObjectURL(file);
			const row = reportData.progress[rowIndex] as any;
			row.foto_bukti = [...(row.foto_bukti || []), { file, name: file.name, url, uploadedId: null }];
			target.value = '';
		}
	}
	function removeProgressItemPhoto(rowIndex: number, photoIndex: number) {
		const row = reportData.progress[rowIndex] as any;
		row.foto_bukti = (row.foto_bukti || []).filter((_: any, idx: number) => idx !== photoIndex);
	}
	function addMaterialUsed() {
		reportData.material_used = [...reportData.material_used, { type: '', amount: 0, unit: 'kg', notes: '', expense_id: '', identitas_barang_id: null, is_manual: false }];
	}
	function removeMaterialUsed(i: number) {
		reportData.material_used = reportData.material_used.filter((_, idx) => idx !== i);
	}
	function handleMaterialSelect(e: Event, item: any) {
		const val = (e.target as HTMLSelectElement).value;
		if (val === 'manual') {
			item.expense_id = '';
			item.identitas_barang_id = null;
			item.is_manual = true;
			item.type = '';
			item.unit = 'kg';
		} else if (val === '') {
			item.expense_id = '';
			item.identitas_barang_id = null;
			item.is_manual = false;
			item.type = '';
			item.unit = 'kg';
		} else {
			const selected = actualMaterials.find(m => String(m.id) === String(val));
			if (selected) {
				item.expense_id = selected.id;
				item.identitas_barang_id = selected.identitas_barang_id || null;
				item.is_manual = false;
				item.type = selected.material_name;
				item.unit = selected.unit || 'kg';
			}
		}
	}
	// Tawaran satu-ketuk: entri "Tulis Manual" yang namanya cocok dengan material kiriman proyek → pakai material itu.
	function useMatchedMaterial(item: any, mat: any) {
		item.expense_id = mat.id;
		item.identitas_barang_id = mat.identitas_barang_id || null;
		item.is_manual = false;
		item.type = mat.material_name;
		item.unit = mat.unit || 'kg';
	}
	function getCategoryLabel(type: string) {
		if (!type) return '-';
		const matched = itemCategories.find(c => c.value === type.toLowerCase());
		if (matched) return matched.label;
		if (type.toLowerCase() === 'supplier') return 'Supplier / Material';
		if (type.toLowerCase() === 'consumable') return 'Consumables';
		if (type.toLowerCase() === 'safety') return 'Safety';
		return type;
	}

	let currentMaterialStock = $derived(
		actualMaterials.map(mat => {
			const usedAmount = reportData.material_used
				.filter(item => !item.is_manual && String(item.expense_id) === String(mat.id))
				.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
			return {
				type: mat.material_name,
				amount: Math.max(0, mat.qty_remaining - usedAmount),
				unit: mat.unit || 'kg',
				qty_remaining: mat.qty_remaining,
				usedAmount
			};
		})
	);

	$effect(() => {
		reportData.material_stock = currentMaterialStock.map(item => ({
			type: item.type,
			amount: item.amount,
			unit: item.unit
		}));
	});
	function addMaterialNeeds() {
		reportData.material_needs = [...reportData.material_needs, { type: '', amount: 0, unit: 'kg', notes: '', urgency: 'normal', description: '', date_needed: '', expense_id: '', identitas_barang_id: null, is_manual: false }];
	}
	function handleMaterialNeedsSelect(e: Event, item: any) {
		const val = (e.target as HTMLSelectElement).value;
		if (val === 'manual') {
			item.expense_id = '';
			item.identitas_barang_id = null;
			item.is_manual = true;
			item.description = '';
			item.type = '';
			item.unit = 'kg';
		} else if (val === '') {
			item.expense_id = '';
			item.identitas_barang_id = null;
			item.is_manual = false;
			item.description = '';
			item.type = '';
			item.unit = 'kg';
		} else {
			const selected = actualMaterials.find(m => String(m.id) === String(val));
			if (selected) {
				item.expense_id = selected.id;
				item.identitas_barang_id = selected.identitas_barang_id || null;
				item.is_manual = false;
				item.description = selected.material_name;
				item.type = selected.material_name;
				item.unit = selected.unit || 'kg';
			}
		}
	}

	// Format tanggal selesai SPK untuk ditampilkan di dropdown pekerja (dd MMM yyyy).
	function fmtSPKEnd(tanggalSelesai: string) {
		if (!tanggalSelesai) return '';
		const d = new Date(tanggalSelesai);
		if (isNaN(d.getTime())) return '';
		return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
	}

	// SPK dianggap mau habis jika sisa waktu <= 7 hari (termasuk yang sudah lewat).
	function isSPKExpiringSoon(tanggalSelesai: string) {
		if (!tanggalSelesai) return false;
		const end = new Date(tanggalSelesai);
		if (isNaN(end.getTime())) return false;
		const diffDays = (end.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
		return diffDays <= 7;
	}

	let manpowerSearchQuery = $state('');

	function getAllPresentWorkers(): any[] {
		const list: any[] = [];
		(reportData.manpower || []).forEach((group: any) => {
			(group.workers || []).forEach((w: any) => {
				if (w && w.id && !list.some(item => String(item.id) === String(w.id))) {
					list.push({
						...w,
						rate_tipe: w.rate_tipe || group.role || 'HARIAN',
						jam: w.jam != null ? Number(w.jam) : (w.is_standby ? 0 : 8),
						ot_hours: Number(w.ot_hours) || 0,
						is_standby: !!w.is_standby,
						is_holiday: !!w.is_holiday,
						notes: w.notes || ''
					});
				}
			});
		});
		return list;
	}

	function findWorkerInAttendance(workerId: number | string): any | null {
		for (const group of reportData.manpower || []) {
			const found = (group.workers || []).find((w: any) => String(w.id) === String(workerId));
			if (found) return found;
		}
		return null;
	}

	function packManpowerData(workerList: any[]) {
		if (!workerList || workerList.length === 0) {
			return [freshManpowerGroup('HARIAN')];
		}
		const groupsMap = new Map<string, any[]>();
		for (const w of workerList) {
			const role = (w.rate_tipe || 'HARIAN').toUpperCase();
			if (!groupsMap.has(role)) {
				groupsMap.set(role, []);
			}
			groupsMap.get(role)!.push({
				...w,
				jam: w.is_standby ? 0 : (w.jam != null ? Number(w.jam) : 8),
				ot_hours: w.is_standby ? 0 : (Number(w.ot_hours) || 0),
				is_standby: !!w.is_standby,
				is_holiday: !!w.is_holiday,
				notes: w.notes || ''
			});
		}
		const groups = [];
		for (const [role, workers] of groupsMap.entries()) {
			groups.push({
				role,
				count: workers.length,
				notes: '',
				workers,
				newWorkerInput: '',
				showDropdown: false,
				newWorkerJam: 8,
				newWorkerOtHours: 0,
				newWorkerStandby: false,
				newWorkerHoliday: false
			});
		}
		return groups;
	}

	function syncManpowerCount() {
		const list = getAllPresentWorkers();
		reportData.manpower_count = list.length;
	}

	let presentWorkersList = $derived(getAllPresentWorkers());
	let presentWorkersMap = $derived(new Map(presentWorkersList.map(w => [String(w.id), w])));
	let totalWorkersHadir = $derived(presentWorkersList.filter(w => !w.is_standby).length);
	let totalWorkersStandby = $derived(presentWorkersList.filter(w => !!w.is_standby).length);
	let totalJamKerja = $derived(presentWorkersList.reduce((sum, w) => sum + (w.is_standby ? 0 : (Number(w.jam) || 0)), 0));
	let totalJamLembur = $derived(presentWorkersList.reduce((sum, w) => sum + (w.is_standby ? 0 : (Number(w.ot_hours) || 0)), 0));

	let filteredAssignedWorkers = $derived(
		availableManpower.filter(m => {
			if (!manpowerSearchQuery.trim()) return true;
			const q = manpowerSearchQuery.toLowerCase();
			return (m.nama && m.nama.toLowerCase().includes(q)) || 
			       (m.posisi && m.posisi.toLowerCase().includes(q)) ||
			       (m.rate_tipe && m.rate_tipe.toLowerCase().includes(q));
		})
	);

	async function toggleWorkerAttendance(worker: any, targetStatus: 'hadir' | 'standby' | 'absen') {
		if (targetStatus === 'absen') {
			removeWorkerFromAttendance(worker.id);
			return;
		}

		const existing = findWorkerInAttendance(worker.id);
		let dobelProyekOverride: { proyekLainId: number; proyekLainNama: string } | null = null;

		if (!existing) {
			const tanggal = reportData.date || new Date().toISOString().split('T')[0];
			const otherProjectAbsen = await findAbsensiTodayOtherProject(worker.id, tanggal, Number(projectId));
			if (otherProjectAbsen) {
				const proyekLainId = otherProjectAbsen.project_id?.id;
				const namaProyekLain = otherProjectAbsen.project_id?.name || `#${proyekLainId}`;
				const lanjut = confirm(`⚠️ ${worker.nama} sudah tercatat absen di proyek "${namaProyekLain}" pada tanggal ${tanggal}. Satu pekerja seharusnya hanya bekerja di satu proyek per hari. Tetap tambahkan ke proyek ini?`);
				if (!lanjut) {
					return;
				}
				dobelProyekOverride = { proyekLainId, proyekLainNama: namaProyekLain };
			}
		}

		const isStandby = targetStatus === 'standby';
		const updatedWorker = {
			...worker,
			jam: isStandby ? 0 : (existing && !existing.is_standby ? Number(existing.jam) || 8 : 8),
			ot_hours: isStandby ? 0 : (existing ? Number(existing.ot_hours) || 0 : 0),
			is_standby: isStandby,
			is_holiday: existing ? !!existing.is_holiday : false,
			notes: existing?.notes || '',
			rate_tipe: worker.rate_tipe || existing?.rate_tipe || 'HARIAN',
			...(dobelProyekOverride ? {
				dobel_proyek_flag: true,
				dobel_proyek_proyek_lain_id: dobelProyekOverride.proyekLainId,
				dobel_proyek_proyek_lain_nama: dobelProyekOverride.proyekLainNama
			} : (existing?.dobel_proyek_flag ? {
				dobel_proyek_flag: true,
				dobel_proyek_proyek_lain_id: existing.dobel_proyek_proyek_lain_id,
				dobel_proyek_proyek_lain_nama: existing.dobel_proyek_proyek_lain_nama
			} : {}))
		};

		saveWorkerToAttendance(updatedWorker);
	}

	function saveWorkerToAttendance(workerObj: any) {
		const allWorkers = getAllPresentWorkers();
		const existingIndex = allWorkers.findIndex(w => String(w.id) === String(workerObj.id));
		if (existingIndex >= 0) {
			allWorkers[existingIndex] = { ...allWorkers[existingIndex], ...workerObj };
		} else {
			allWorkers.push(workerObj);
		}
		reportData.manpower = packManpowerData(allWorkers);
		syncManpowerCount();
	}

	function removeWorkerFromAttendance(workerId: number | string) {
		const allWorkers = getAllPresentWorkers().filter(w => String(w.id) !== String(workerId));
		reportData.manpower = packManpowerData(allWorkers);
		syncManpowerCount();
	}

	function updateWorkerField(workerId: number | string, field: string, value: any) {
		const allWorkers = getAllPresentWorkers();
		const target = allWorkers.find(w => String(w.id) === String(workerId));
		if (target) {
			target[field] = value;
			if (field === 'is_standby') {
				if (value) {
					target.jam = 0;
					target.ot_hours = 0;
				} else {
					target.jam = 8;
				}
			}
			reportData.manpower = packManpowerData(allWorkers);
			syncManpowerCount();
		}
	}

	function stepWorkerHours(workerId: number | string, delta: number) {
		const allWorkers = getAllPresentWorkers();
		const target = allWorkers.find(w => String(w.id) === String(workerId));
		if (target && !target.is_standby) {
			const current = Number(target.jam) || 0;
			const next = Math.max(0, Math.min(24, Math.round((current + delta) * 10) / 10));
			target.jam = next;
			reportData.manpower = packManpowerData(allWorkers);
			syncManpowerCount();
		}
	}

	function setWorkerOtPreset(workerId: number | string, otHours: number) {
		const allWorkers = getAllPresentWorkers();
		const target = allWorkers.find(w => String(w.id) === String(workerId));
		if (target && !target.is_standby) {
			target.ot_hours = Number(target.ot_hours) === otHours ? 0 : otHours;
			reportData.manpower = packManpowerData(allWorkers);
			syncManpowerCount();
		}
	}

	async function markAllWorkersPresent(defaultHours = 8) {
		if (!availableManpower || availableManpower.length === 0) {
			alert('Belum ada pekerja dengan penugasan aktif (SPK) di proyek ini.');
			return;
		}
		const currentWorkers = getAllPresentWorkers();
		const currentMap = new Map(currentWorkers.map(w => [String(w.id), w]));
		const tanggal = reportData.date || new Date().toISOString().split('T')[0];

		// Deteksi apakah ada pekerja yang sudah tercatat di proyek lain hari ini
		const conflictChecks = await Promise.all(
			availableManpower.map(async (mp) => {
				const existing = currentMap.get(String(mp.id));
				if (existing) return null;
				try {
					const other = await findAbsensiTodayOtherProject(mp.id, tanggal, Number(projectId));
					if (other) {
						return {
							mp,
							proyekLainId: other.project_id?.id,
							proyekLainNama: other.project_id?.name || `#${other.project_id?.id}`
						};
					}
				} catch {
					// fail soft
				}
				return null;
			})
		);
		const foundConflicts = conflictChecks.filter(Boolean) as { mp: any; proyekLainId: number; proyekLainNama: string }[];

		let overrideConfirmed = false;
		if (foundConflicts.length > 0) {
			const names = foundConflicts.map(c => `• ${c.mp.nama} (di ${c.proyekLainNama})`).join('\n');
			overrideConfirmed = confirm(
				`⚠️ Peringatan Konflik Penugasan:\n${foundConflicts.length} pekerja berikut sudah tercatat absen di proyek lain pada tanggal ${tanggal}:\n\n${names}\n\nSatu pekerja seharusnya hanya berada di 1 proyek per hari.\nTetap masukkan semua ke proyek ini?`
			);
		}

		const conflictMap = new Map(foundConflicts.map(c => [String(c.mp.id), c]));
		const newWorkersList: any[] = [];

		for (const mp of availableManpower) {
			const conflict = conflictMap.get(String(mp.id));
			if (conflict && !overrideConfirmed) {
				continue;
			}
			const existing = currentMap.get(String(mp.id));
			newWorkersList.push({
				...mp,
				jam: existing && !existing.is_standby ? Number(existing.jam) || defaultHours : defaultHours,
				ot_hours: existing ? Number(existing.ot_hours) || 0 : 0,
				is_standby: false,
				is_holiday: existing ? !!existing.is_holiday : false,
				notes: existing?.notes || '',
				rate_tipe: mp.rate_tipe || existing?.rate_tipe || 'HARIAN',
				...(conflict ? {
					dobel_proyek_flag: true,
					dobel_proyek_proyek_lain_id: conflict.proyekLainId,
					dobel_proyek_proyek_lain_nama: conflict.proyekLainNama
				} : (existing?.dobel_proyek_flag ? {
					dobel_proyek_flag: true,
					dobel_proyek_proyek_lain_id: existing.dobel_proyek_proyek_lain_id,
					dobel_proyek_proyek_lain_nama: existing.dobel_proyek_proyek_lain_nama
				} : {}))
			});
		}
		reportData.manpower = packManpowerData(newWorkersList);
		syncManpowerCount();
	}

	function clearAllWorkersAttendance() {
		reportData.manpower = [freshManpowerGroup('HARIAN')];
		syncManpowerCount();
	}

	function addTomorrowPlan() {
		reportData.tomorrow_plan = [...reportData.tomorrow_plan, { activity: '', notes: '', description: '' }];
	}
	function addIssue() {
		reportData.issues = [...reportData.issues, { description: '', existing_foto_kendala: [], foto_kendala: [] }];
	}
	async function handleIssueItemPhoto(rowIndex: number, event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			const file = await stampIfPositionAvailable(target.files[0]);
			const url = URL.createObjectURL(file);
			const row = reportData.issues[rowIndex] as any;
			row.foto_kendala = [...(row.foto_kendala || []), { file, name: file.name, url, uploadedId: null }];
			target.value = '';
		}
	}
	function removeIssueItemPhoto(rowIndex: number, photoIndex: number) {
		const row = reportData.issues[rowIndex] as any;
		row.foto_kendala = (row.foto_kendala || []).filter((_: any, idx: number) => idx !== photoIndex);
	}
	function addBudgetItem() {
		reportData.budget_items = [
			...reportData.budget_items,
			{
				expense_id: '',
				reference_number: '',
				description: '',
				spent_amount: 0,
				receipt_file: null as { file: File; name: string; url: string } | null,
				expense_category: 'operasional'
			}
		];
	}

	function removeBudgetItem(index: number) {
		reportData.budget_items = reportData.budget_items.filter((_, i) => i !== index);
	}

	function handleBudgetItemSelect(event: Event, index: number) {
		const val = (event.target as HTMLSelectElement).value;
		if (val === 'REIMBURSE') {
			reportData.budget_items[index].expense_id = 'REIMBURSE';
			reportData.budget_items[index].reference_number = 'Reimburse';
			reportData.budget_items[index].expense_category = 'operasional';
		} else {
			const selected = budgetExpenses.find(e => String(e.id) === String(val));
			if (selected) {
				reportData.budget_items[index].expense_id = selected.id;
				reportData.budget_items[index].reference_number = selected.reference_number || '';
				if (!reportData.budget_items[index].description) {
					reportData.budget_items[index].description = selected.material_name || selected.description || '';
				}
				reportData.budget_items[index].expense_category = undefined;
			} else {
				reportData.budget_items[index].expense_id = '';
				reportData.budget_items[index].reference_number = '';
				reportData.budget_items[index].expense_category = undefined;
			}
		}
	}

	async function handleBudgetItemReceipt(event: Event, index: number) {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			const file = await stampIfPositionAvailable(target.files[0]);
			const url = URL.createObjectURL(file);
			reportData.budget_items[index].receipt_file = { file, name: file.name, url, uploadedId: null };
		}
	}

	function removeBudgetItemReceipt(index: number) {
		reportData.budget_items[index].receipt_file = null;
	}

	async function handleMainBudgetReceipt(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			const file = await stampIfPositionAvailable(target.files[0]);
			const url = URL.createObjectURL(file);
			budgetReceiptFile = { file, name: file.name, url, uploadedId: null };
		}
	}

	function addQuickAmount(index: number, delta: number) {
		const current = Number(reportData.budget_items[index].spent_amount) || 0;
		reportData.budget_items[index].spent_amount = Math.max(0, current + delta);
	}

	function setQuickAmount(index: number, val: number) {
		reportData.budget_items[index].spent_amount = Math.max(0, val);
	}

	function formatRupiah(val: number) {
		return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val || 0);
	}

	// Kalau posisi GPS tersedia, foto di-watermark (koordinat+waktu dibakar ke piksel foto & dikompres).
	// Kalau tidak (izin ditolak/tak ada sinyal), foto tetap dikompres otomatis (max 1280px, jpeg 0.80)
	// agar ringan dikirim di area blank spot / sinyal lemah.
	async function stampIfPositionAvailable(file: File): Promise<File> {
		if (!reportPosition) {
			return await compressImageFile(file);
		}
		try {
			return await watermarkPhoto(file, { lat: reportPosition.lat, lng: reportPosition.lng, accuracy: reportPosition.accuracy });
		} catch {
			return await compressImageFile(file);
		}
	}

	async function handleAttendancePhoto(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			const file = await stampIfPositionAvailable(target.files[0]);
			const url = URL.createObjectURL(file);
			reportData.attendance_photos = [...reportData.attendance_photos, { file, name: file.name, url, uploadedId: null }];
		}
	}
	function removeAttendancePhoto(index: number) {
		reportData.attendance_photos = reportData.attendance_photos.filter((_, i) => i !== index);
	}
	async function handleProgressPhoto(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			const newPhotos = [];
			for (let i = 0; i < target.files.length; i++) {
				const file = await stampIfPositionAvailable(target.files[i]);
				const url = URL.createObjectURL(file);
				newPhotos.push({ file, name: file.name, url, uploadedId: null });
			}
			reportData.progress_photos = [...reportData.progress_photos, ...newPhotos];
			target.value = '';
		}
	}
	function removeProgressPhoto(index: number) {
		reportData.progress_photos = reportData.progress_photos.filter((_, i) => i !== index);
	}
	async function handleIssuePhoto(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			const file = await stampIfPositionAvailable(target.files[0]);
			const url = URL.createObjectURL(file);
			reportData.issue_photos = [...reportData.issue_photos, { file, name: file.name, url, uploadedId: null }];
		}
	}
	function removeIssuePhoto(index: number) {
		reportData.issue_photos = reportData.issue_photos.filter((_, i) => i !== index);
	}
	async function handleToolboxPhoto(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			const file = await stampIfPositionAvailable(target.files[0]);
			const url = URL.createObjectURL(file);
			reportData.toolbox_photos = [...reportData.toolbox_photos, { file, name: file.name, url, uploadedId: null }];
		}
	}
	function removeToolboxPhoto(index: number) {
		reportData.toolbox_photos = reportData.toolbox_photos.filter((_, i) => i !== index);
	}
	async function handleAreaKerjaPhoto(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			const file = await stampIfPositionAvailable(target.files[0]);
			const url = URL.createObjectURL(file);
			reportData.area_kerja_photos = [...reportData.area_kerja_photos, { file, name: file.name, url, uploadedId: null }];
		}
	}
	function removeAreaKerjaPhoto(index: number) {
		reportData.area_kerja_photos = reportData.area_kerja_photos.filter((_, i) => i !== index);
	}
	async function handleWeekendPhoto(event: Event) {
		const target = event.target as HTMLInputElement;
		if (target.files && target.files.length > 0) {
			const file = await stampIfPositionAvailable(target.files[0]);
			const url = URL.createObjectURL(file);
			reportData.weekend_photos = [...reportData.weekend_photos, { file, name: file.name, url, uploadedId: null }];
		}
	}
	function removeWeekendPhoto(index: number) {
		reportData.weekend_photos = reportData.weekend_photos.filter((_, i) => i !== index);
	}

	function removeExistingAttendancePhoto(id: string) {
		existingAttendancePhotos = existingAttendancePhotos.filter(x => x !== id);
	}
	function removeExistingProgressPhoto(id: string) {
		existingProgressPhotos = existingProgressPhotos.filter(x => x !== id);
	}
	function removeExistingIssuePhoto(id: string) {
		existingIssuePhotos = existingIssuePhotos.filter(x => x !== id);
	}
	function removeExistingToolboxPhoto(id: string) {
		existingToolboxPhotos = existingToolboxPhotos.filter(x => x !== id);
	}
	function removeExistingAreaKerjaPhoto(id: string) {
		existingAreaKerjaPhotos = existingAreaKerjaPhotos.filter(x => x !== id);
	}
	function removeExistingWeekendPhoto(id: string) {
		existingWeekendPhotos = existingWeekendPhotos.filter(x => x !== id);
	}
	
	let isFriday = $derived(new Date(reportData.date).getDay() === 5);

	let scheduleCount = $derived(reportData.schedule.filter(s => s.activity && s.activity.trim()).length);
	let tomorrowPlanCount = $derived(reportData.tomorrow_plan.filter(t => (t.activity && t.activity.trim()) || (t.description && t.description.trim())).length);
	let progressCount = $derived(reportData.progress.filter(p => (p.activity && p.activity.trim()) || p.subtask_id).length);
	let progressPhotosCount = $derived(reportData.progress_photos.length + existingProgressPhotos.length);
	let materialCount = $derived(reportData.material_used.filter(m => (m.type && m.type.trim()) || m.expense_id).length);
	let totalManpowerWorkers = $derived(reportData.manpower.reduce((sum, g) => sum + (g.workers?.length || 0), 0));
	let attendancePhotosCount = $derived(reportData.attendance_photos.length + existingAttendancePhotos.length);
	let budgetItemsCount = $derived(reportData.budget_items.length);
	let issuesCount = $derived(reportData.issues.filter(i => i.description && i.description.trim()).length);
	let weekendPhotosCount = $derived(reportData.weekend_photos.length + existingWeekendPhotos.length);
	let issuePhotosCount = $derived(reportData.issue_photos.length + existingIssuePhotos.length);
	let toolboxPhotosCount = $derived(reportData.toolbox_photos.length + existingToolboxPhotos.length);
	let areaKerjaPhotosCount = $derived(reportData.area_kerja_photos.length + existingAreaKerjaPhotos.length);

	// Fase 1 Laporan Lapangan & Paritas ERP (16 Okt 2026) — tab HSE & K3 (gate WARN,
	// soft — lihat G_LH_HSE_CHECKLIST/G_LH_DOWNTIME_REASON di laporanHarianRules.ts).
	let hseChecklistFilled = $derived(!!(reportData.hse_daily?.apd_compliance && reportData.hse_daily.apd_compliance.trim()));
	let downtimeNeeded = $derived(!isHold && !!reportData.weather && reportData.weather !== 'Cerah');
	let downtimeLogCount = $derived((reportData.downtime_log || []).length);

	const APD_COMPLIANCE_LABEL: Record<string, string> = {
		lengkap: 'Lengkap — semua pekerja patuh APD',
		sebagian: 'Sebagian — ada yang tidak lengkap',
		tidak_lengkap: 'Tidak lengkap — banyak temuan'
	};
	function apdComplianceLabel(value: string | undefined): string {
		return value ? (APD_COMPLIANCE_LABEL[value] || value) : '-';
	}

	const DOWNTIME_CAUSE_LABEL: Record<string, string> = {
		cuaca: 'Cuaca / Hujan',
		izin_klien: 'Menunggu Izin/Area Klien',
		alat_breakdown: 'Alat Breakdown',
		tunggu_material: 'Tunggu Material',
		listrik_utilitas: 'Listrik/Utilitas Klien',
		lainnya: 'Lainnya'
	};
	function downtimeCauseLabel(value: string | undefined): string {
		return value ? (DOWNTIME_CAUSE_LABEL[value] || value) : '-';
	}

	function addDowntimeRow() {
		reportData.downtime_log = [
			...reportData.downtime_log,
			{ durasi_jam: 0, penyebab: '', jumlah_pekerja_terdampak: 0, catatan: '' }
		];
		vibrateTap();
	}
	function removeDowntimeRow(index: number) {
		reportData.downtime_log = reportData.downtime_log.filter((_: any, i: number) => i !== index);
		vibrateTap();
	}

	// Fase 2 Laporan Lapangan & Paritas ERP (16 Okt 2026) — QC Ambient (tab Progress, gate
	// WARN G_LH_QC_AMBIENT). Hanya relevan untuk proyek kategori Coating/Blasting (project.
	// hse_work_types — field terkontrol, BUKAN tebakan dari teks bebas project_type).
	let qcAmbientApplicable = $derived((project?.hse_work_types || []).some((t: string) => t === 'sandblasting' || t === 'coating'));
	let qcAmbientFilledToday = $derived(!!(inspectionSummary?.measuredAt && inspectionSummary.measuredAt.slice(0, 10) === reportData.date));

	// Fase 2 — Rasio Konsumsi Material (tab Material, gate WARN G_LH_MATERIAL_VARIANCE).
	// Standar dari so_customer_details.qty ÷ luas_m2 (sudah dimuat sebagai soDetails untuk
	// PenawaranEditor/export) dicocokkan via identitas_barang_id ke baris material_used hari
	// ini; aktual dari actualMaterials.qty_used (kumulatif s.d. laporan TERSIMPAN terakhir —
	// BUKAN termasuk draf hari ini yang belum disimpan, supaya tidak ada risiko hitung ganda).
	// Output kumulatif didekati dari overallProjectProgressPct × total_area_m2 (belum per
	// kategori pekerjaan — pendekatan terbaik yang tersedia tanpa query tambahan).
	let materialVarianceCheck = $derived.by(() => {
		const cumulativeM2 = (overallProjectProgressPct / 100) * (Number(project?.total_area_m2) || 0);
		const items: { identitasBarangId: any; label: string; standardRatio: number; actualRatio: number; variancePct: number }[] = [];
		if (cumulativeM2 > 0) {
			const seen = new Set<string>();
			for (const row of reportData.material_used) {
				const pid = (row as any).identitas_barang_id;
				if (!pid || seen.has(String(pid))) continue;
				seen.add(String(pid));
				const soLine = (soDetails || []).find((d: any) =>
					(String(d.item_id) === String(pid) || String(d.product_id) === String(pid)) &&
					Number(d.luas_m2) > 0 && Number(d.qty) > 0
				);
				if (!soLine) continue;
				const actualRow = (actualMaterials || []).find((a: any) => String(a.identitas_barang_id) === String(pid));
				const actualQtyUsed = actualRow ? Number(actualRow.qty_used) || 0 : 0;
				if (actualQtyUsed <= 0) continue;
				const standardRatio = Number(soLine.qty) / Number(soLine.luas_m2);
				const actualRatio = actualQtyUsed / cumulativeM2;
				if (standardRatio <= 0) continue;
				const variancePct = ((actualRatio - standardRatio) / standardRatio) * 100;
				items.push({ identitasBarangId: pid, label: row.type || soLine.nama_barang || `Item #${pid}`, standardRatio, actualRatio, variancePct });
			}
		}
		const worstPct = items.length ? Math.max(...items.map((it) => it.variancePct)) : null;
		const flagged = worstPct !== null && worstPct > lossFactorPct;
		return { items, worstPct, flagged };
	});

	function materialVarianceStatus(variancePct: number): 'hijau' | 'kuning' | 'merah' {
		if (variancePct > lossFactorPct) return 'merah';
		if (variancePct > lossFactorPct / 2) return 'kuning';
		return 'hijau';
	}

	// Fase 2 — Instruksi Klien / Potensi Kerja Tambah (SI/VO), tab Lainnya.
	function addClientInstruction() {
		reportData.client_instructions = [
			...reportData.client_instructions,
			{ pengawas_klien: '', isi_instruksi: '', berpotensi_vo: false }
		];
		vibrateTap();
	}
	function removeClientInstruction(index: number) {
		reportData.client_instructions = reportData.client_instructions.filter((_: any, i: number) => i !== index);
		vibrateTap();
	}

	// Fase 2 — "Salin Roster & Alat Kemarin" (tab Tenaga), 0 API tambahan kalau history
	// kemarin sudah termuat (historyReports), fallback 1 query ringan kalau belum.
	async function salinKomposisiKemarin() {
		if (isLocked) return;
		const kemarin = new Date(reportData.date);
		kemarin.setDate(kemarin.getDate() - 1);
		const tglKemarin = kemarin.toISOString().split('T')[0];
		let sumber = (historyReports || []).find((r: any) => (r.date || '').split('T')[0] === tglKemarin);
		if (!sumber) {
			try {
				const hasil = await getReports(projectId, { date: tglKemarin, limit: 1, fields: ['id', 'date', 'manpower', 'tools'] });
				sumber = hasil?.[0];
			} catch (e) {
				console.error('[salinKomposisiKemarin] gagal ambil laporan kemarin:', e);
			}
		}
		if (!sumber) {
			alert(`Tidak ada laporan tersimpan untuk tanggal ${tglKemarin} (kemarin) di proyek ini.`);
			return;
		}
		if (!confirm('Salin daftar Tenaga & Peralatan dari laporan kemarin? Isian Tenaga/Peralatan hari ini yang belum disimpan akan tertimpa.')) return;
		const mp = parseField<any[]>((sumber as any).manpower, []);
		reportData.manpower = mp.length ? mp.map((m: any) => ({
			...freshManpowerGroup(m.role, m.notes),
			...m,
			workers: m.workers || [],
			newWorkerInput: '',
			showDropdown: false
		})) : [freshManpowerGroup('BORONGAN')];
		const tools = parseField<any[]>((sumber as any).tools, []);
		reportData.tools = tools.length ? tools : [{ name: '', amount: 0 }];
		vibrateTap();
	}

	// ==========================================
	// PROJECT SUMMARY CALCULATIONS & METRICS
	// ==========================================

	// Timeline Countdown & Duration Metrics
	let projectTimelineMetrics = $derived.by(() => {
		if (!project) return { totalDays: 0, elapsedDays: 0, remainingDays: 0, timeElapsedPct: 0, isOverdue: false, startDateStr: '-', endDateStr: '-' };
		const start = project.start_date ? new Date(project.start_date) : null;
		const end = project.end_date ? new Date(project.end_date) : null;
		const now = new Date();

		const startDateStr = start && !isNaN(start.getTime())
			? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(start)
			: '-';
		const endDateStr = end && !isNaN(end.getTime())
			? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(end)
			: '-';

		if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
			return { totalDays: 0, elapsedDays: 0, remainingDays: 0, timeElapsedPct: 0, isOverdue: false, startDateStr, endDateStr };
		}

		const msPerDay = 1000 * 60 * 60 * 24;
		const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / msPerDay) + 1);
		const rawElapsed = Math.round((now.getTime() - start.getTime()) / msPerDay);
		const elapsedDays = Math.max(0, Math.min(rawElapsed, totalDays));
		const rawRemaining = Math.round((end.getTime() - now.getTime()) / msPerDay);
		const remainingDays = Math.max(0, rawRemaining);
		const timeElapsedPct = Math.min(100, Math.max(0, Math.round((elapsedDays / totalDays) * 100)));
		const isOverdue = rawRemaining < 0;

		return { totalDays, elapsedDays, remainingDays, timeElapsedPct, isOverdue, startDateStr, endDateStr };
	});

	// Subtasks Progress Accumulation
	interface SubtaskSummaryItem {
		id: string;
		categoryName: string;
		name: string;
		unit: string;
		targetVolume: number;
		cumulativeVolume: number;
		todayVolume: number;
		manualVolume: number;
		totalInstalledVolume: number;
		remainingVolume: number;
		progressPct: number;
		status: 'not_started' | 'in_progress' | 'completed';
	}

	let subtaskSummaryList = $derived.by((): SubtaskSummaryItem[] => {
		if (!availableSubtasks || availableSubtasks.length === 0) return [];

		// Map volume from past reports, sekaligus catat tanggal yang sudah punya laporan
		// resmi per subtask — dipakai untuk dedup input actual manual di bawah.
		const pastMap = new Map<string, number>();
		const officialDatesByKey = new Map<string, Set<string>>();
		for (const r of allReportsForProgress || []) {
			if (savedReportId != null && String(r.id) === String(savedReportId)) continue;
			let pList = r.progress;
			if (typeof pList === 'string') {
				try { pList = JSON.parse(pList); } catch { pList = []; }
			}
			const reportDate = r.date ? String(r.date).substring(0, 10) : '';
			if (Array.isArray(pList)) {
				for (const p of pList) {
					const key = p.subtask_id ? String(p.subtask_id) : p.activity ? `act_${p.activity}` : '';
					if (key) {
						pastMap.set(key, (pastMap.get(key) || 0) + (parseFloat(p.progress_value) || 0));
						if (reportDate) {
							if (!officialDatesByKey.has(key)) officialDatesByKey.set(key, new Set());
							officialDatesByKey.get(key)!.add(reportDate);
						}
					}
				}
			}
		}

		// Map volume from current report
		const todayMap = new Map<string, number>();
		for (const p of reportData.progress || []) {
			const key = p.subtask_id ? String(p.subtask_id) : p.activity ? `act_${p.activity}` : '';
			if (key) {
				todayMap.set(key, (todayMap.get(key) || 0) + (parseFloat(String(p.progress_value)) || 0));
			}
		}

		// Map volume from manual actual entries (Timeline) — di-skip untuk tanggal yang
		// sudah punya laporan resmi, supaya tidak dobel-hitung begitu laporan resmi masuk.
		const manualMap = new Map<string, number>();
		for (const entry of manualActualEntries || []) {
			const key = entry.subtask_id ? String(entry.subtask_id) : '';
			const tanggal = (entry.tanggal || '').substring(0, 10);
			const val = parseFloat(entry.progress_value) || 0;
			if (!key || !tanggal || val <= 0) continue;
			if (officialDatesByKey.get(key)?.has(tanggal)) continue;
			manualMap.set(key, (manualMap.get(key) || 0) + val);
		}

		return availableSubtasks.map((st) => {
			const key = st.id ? String(st.id) : `act_${st.name}`;
			const past = pastMap.get(key) || 0;
			const today = todayMap.get(key) || 0;
			const manual = manualMap.get(key) || 0;
			const target = parseFloat(st.volume) || 0;
			const totalInstalled = past + today + manual;
			const remaining = Math.max(0, target - totalInstalled);
			const progressPct = target > 0 ? Math.min(100, Math.round((totalInstalled / target) * 100)) : (totalInstalled > 0 ? 100 : 0);

			let status: 'not_started' | 'in_progress' | 'completed' = 'not_started';
			if (progressPct >= 100) status = 'completed';
			else if (totalInstalled > 0) status = 'in_progress';

			return {
				id: key,
				categoryName: st.categoryName || 'Pekerjaan Utama',
				name: st.name || 'Aktivitas Proyek',
				unit: st.unit || 'm²',
				targetVolume: target,
				cumulativeVolume: past,
				todayVolume: today,
				manualVolume: manual,
				totalInstalledVolume: totalInstalled,
				remainingVolume: remaining,
				progressPct,
				status
			};
		});
	});

	// Overall Progress %
	let overallProjectProgressPct = $derived.by(() => {
		if (subtaskSummaryList.length === 0) {
			return calculateCumulativeProjectProgress(project, allReportsForProgress, [], savedReportId) || 0;
		}
		const totalTarget = subtaskSummaryList.reduce((sum, s) => sum + s.targetVolume, 0);
		const totalInstalled = subtaskSummaryList.reduce((sum, s) => sum + s.totalInstalledVolume, 0);
		if (totalTarget > 0) {
			return Math.min(100, Math.round((totalInstalled / totalTarget) * 100));
		}
		const avg = subtaskSummaryList.reduce((sum, s) => sum + s.progressPct, 0) / subtaskSummaryList.length;
		return Math.round(avg);
	});

	// Subtask counts
	let subtasksStats = $derived.by(() => {
		const total = subtaskSummaryList.length;
		const completed = subtaskSummaryList.filter(s => s.status === 'completed').length;
		const inProgress = subtaskSummaryList.filter(s => s.status === 'in_progress').length;
		const notStarted = subtaskSummaryList.filter(s => s.status === 'not_started').length;
		return { total, completed, inProgress, notStarted };
	});

	// Schedule Health Status (Comparing Physical Progress vs Time Elapsed)
	let scheduleHealthStatus = $derived.by((): { label: string; class: string; icon: string; color: string } => {
		const diff = overallProjectProgressPct - projectTimelineMetrics.timeElapsedPct;
		if (projectTimelineMetrics.isOverdue && overallProjectProgressPct < 100) {
			return { label: 'Terlambat (Overdue)', class: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800', icon: '🚨', color: 'var(--re)' };
		}
		if (diff >= 5) {
			return { label: `Lebih Cepat (+${diff}%)`, class: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800', icon: '🚀', color: 'var(--g)' };
		}
		if (diff >= -10) {
			return { label: 'Sesuai Jadwal (On Track)', class: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800', icon: '🟢', color: '#2563EB' };
		}
		return { label: `Perlu Akselerasi (${diff}%)`, class: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800', icon: '🟡', color: 'var(--am)' };
	});

	// Cumulative Man-Days (HOK) from all reports
	let cumulativeManpowerMetrics = $derived.by(() => {
		let totalManDays = 0;
		const reportDates = new Set<string>();
		const uniqueWorkerNames = new Set<string>();

		for (const r of allReportsForProgress || []) {
			if (r.date || r.date_created) {
				reportDates.add((r.date || r.date_created).split('T')[0]);
			}
			let mp = r.manpower;
			if (typeof mp === 'string') {
				try { mp = JSON.parse(mp); } catch { mp = []; }
			}
			if (Array.isArray(mp)) {
				for (const group of mp) {
					totalManDays += Number(group.count) || 0;
					if (Array.isArray(group.workers)) {
						for (const w of group.workers) {
							const name = w?.nama || w?.name || (typeof w === 'string' ? w : null);
							if (name) uniqueWorkerNames.add(name);
						}
					}
				}
			} else if (r.manpower_count) {
				totalManDays += Number(r.manpower_count) || 0;
			}
		}

		// Add today's report
		if (reportData.date) reportDates.add(reportData.date);
		const todayWorkers = totalManpowerWorkers > 0 ? totalManpowerWorkers : (Number(reportData.manpower_count) || 0);
		if (!savedReportId) {
			totalManDays += todayWorkers;
		}

		const totalReportDays = Math.max(1, reportDates.size);
		const avgDailyWorkers = (totalManDays / totalReportDays).toFixed(1);

		return {
			totalManDays,
			totalReportDays: reportDates.size,
			avgDailyWorkers,
			assignedWorkersCount: availableManpower.length,
			activePoolCount: uniqueWorkerNames.size || availableManpower.length
		};
	});

	// Cumulative Material Usage Summary
	let materialSummaryList = $derived.by(() => {
		if (!actualMaterials || actualMaterials.length === 0) return [];

		// Tally used from past reports
		const usedMap = new Map<string, number>();
		for (const r of allReportsForProgress || []) {
			if (savedReportId != null && String(r.id) === String(savedReportId)) continue;
			let mUsed = r.material_used;
			if (typeof mUsed === 'string') {
				try { mUsed = JSON.parse(mUsed); } catch { mUsed = []; }
			}
			if (Array.isArray(mUsed)) {
				for (const m of mUsed) {
					const key = m.expense_id ? String(m.expense_id) : (m.type || '');
					if (key) {
						usedMap.set(key, (usedMap.get(key) || 0) + (parseFloat(String(m.amount)) || 0));
					}
				}
			}
		}

		// Add today
		for (const m of reportData.material_used || []) {
			const key = m.expense_id ? String(m.expense_id) : (m.type || '');
			if (key) {
				usedMap.set(key, (usedMap.get(key) || 0) + (parseFloat(String(m.amount)) || 0));
			}
		}

		return actualMaterials.map(m => {
			const key = m.expense_id ? String(m.expense_id) : (m.name || '');
			const pastAndTodayUsed = usedMap.get(key) || 0;
			const planned = parseFloat(m.qty_planned || m.qty_total || 0);
			const delivered = parseFloat(m.qty_delivered || m.qty_received || planned || 0);
			const remaining = Math.max(0, delivered - pastAndTodayUsed);
			const usagePct = delivered > 0 ? Math.min(100, Math.round((pastAndTodayUsed / delivered) * 100)) : 0;

			return {
				name: m.name || m.nama_barang || 'Material',
				unit: m.unit || m.satuan || 'kg',
				planned,
				delivered,
				used: pastAndTodayUsed,
				remaining,
				usagePct,
				isLow: remaining <= (delivered * 0.15) && delivered > 0
			};
		});
	});

	// Cumulative Financial Summary
	let cumulativeFinancialMetrics = $derived.by(() => {
		let totalCumulativeSpent = 0;
		let totalReimburseClaims = 0;
		let totalBudgetClaims = 0;

		for (const r of allReportsForProgress || []) {
			let bItems = r.budget_items;
			if (typeof bItems === 'string') {
				try { bItems = JSON.parse(bItems); } catch { bItems = []; }
			}
			if (Array.isArray(bItems)) {
				for (const bi of bItems) {
					const amt = Number(bi.spent_amount) || 0;
					totalCumulativeSpent += amt;
					if (bi.expense_id === 'REIMBURSE') totalReimburseClaims += amt;
					else totalBudgetClaims += amt;
				}
			}
		}

		return {
			totalCumulativeSpent,
			totalReimburseClaims,
			totalBudgetClaims
		};
	});

	interface ReportTabItem {
		id: string;
		label: string;
		badge?: string;
		subBadge?: string;
		ok?: boolean;
		warn?: boolean;
	}

	let dynamicTabs = $derived.by((): ReportTabItem[] => {
		if (isHold) {
			return [
				{ id: 'summary', label: 'Summary Proyek', badge: 'Ringkasan', ok: true },
				{ id: 'tenaga', label: 'Tenaga', badge: 'Standby', ok: true },
				{ id: 'history', label: 'History Laporan' }
			];
		}

		const equipmentTotal = projectEquipmentP2h.length;
		const unCheckedP2hCount = projectEquipmentP2h.filter(e => !e.hasSession).length;
		const noGoP2hCount = projectEquipmentP2h.filter(e => e.hasSession && e.result === 'No-Go').length;

		const base: ReportTabItem[] = [
			{
				id: 'summary',
				label: 'Summary Proyek',
				badge: `${overallProjectProgressPct}%`,
				ok: true
			},
			{
				id: 'jadwal',
				label: 'Jadwal',
				badge: scheduleCount > 0 ? `${scheduleCount}` : undefined,
				ok: scheduleCount > 0 && tomorrowPlanCount > 0
			},
			{
				id: 'progress',
				label: 'Progress',
				badge: progressCount > 0 ? `${progressCount}` : undefined,
				subBadge: progressPhotosCount > 0 ? `📸 ${progressPhotosCount}` : undefined,
				ok: progressCount > 0 && progressPhotosCount > 0
			},
			{
				id: 'material',
				label: 'Material',
				badge: materialCount > 0 ? `${materialCount}` : undefined,
				ok: materialCount > 0
			},
			{
				id: 'tenaga',
				label: 'Tenaga',
				badge: totalManpowerWorkers > 0 ? `${totalManpowerWorkers} org` : (reportData.manpower_count > 0 ? `${reportData.manpower_count} org` : undefined),
				subBadge: attendancePhotosCount > 0 ? `📸 ${attendancePhotosCount}` : undefined,
				ok: totalManpowerWorkers > 0 && attendancePhotosCount > 0
			},
			{
				id: 'peralatan',
				label: 'Peralatan',
				badge: equipmentTotal > 0 ? `${equipmentTotal} unit` : undefined,
				subBadge: equipmentTotal > 0
					? (unCheckedP2hCount > 0 ? `⚠️ ${unCheckedP2hCount} belum P2H` : (noGoP2hCount > 0 ? `🚨 ${noGoP2hCount} No-Go` : '✓ Siap'))
					: undefined,
				warn: unCheckedP2hCount > 0 || noGoP2hCount > 0,
				ok: equipmentTotal > 0 && unCheckedP2hCount === 0 && noGoP2hCount === 0
			},
			{
				id: 'keuangan',
				label: 'Keuangan',
				badge: totalSpentToday > 0 ? formatRupiah(totalSpentToday) : (budgetItemsCount > 0 ? `${budgetItemsCount} item` : undefined),
				subBadge: reimburseMissingReceiptCount > 0 ? `⚠️ Nota!` : (budgetItemsCount > 0 ? '✓' : undefined),
				warn: reimburseMissingReceiptCount > 0,
				ok: budgetItemsCount > 0 && reimburseMissingReceiptCount === 0
			},
			{
				id: 'hse',
				label: 'HSE & K3',
				badge: (reportData.downtime_log || []).length > 0
					? `${reportData.downtime_log.length} downtime`
					: (reportData.hse_daily.apd_compliance ? '✓ APD' : 'Wajib'),
				subBadge: toolboxPhotosCount > 0 ? `📸 ${toolboxPhotosCount} TBM` : '⚠️ Foto TBM',
				warn: !isHold && (!reportData.hse_daily.apd_compliance || (reportData.weather !== 'Cerah' && (reportData.downtime_log || []).length === 0) || toolboxPhotosCount === 0),
				ok: isHold || (!!reportData.hse_daily.apd_compliance && (reportData.weather === 'Cerah' || (reportData.downtime_log || []).length > 0) && toolboxPhotosCount > 0)
			},
			{
				id: 'lainnya',
				label: 'Lainnya',
				badge: issuesCount > 0 ? `${issuesCount}` : undefined,
				subBadge: areaKerjaPhotosCount > 0 ? `📸 ${areaKerjaPhotosCount} area` : '⚠️ Area Kerja',
				warn: !isHold && areaKerjaPhotosCount === 0,
				ok: isHold || areaKerjaPhotosCount > 0
			}
		];

		if (isFriday) {
			const weekendComplete = !!(reportData.weekend_location_recap && reportData.weekend_location_recap.trim() && weekendPhotosCount > 0);
			base.push({
				id: 'weekend',
				label: 'Weekend Report',
				badge: weekendComplete ? '✓ Lengkap' : 'Wajib',
				warn: !weekendComplete,
				ok: weekendComplete
			});
		}

		base.push({ id: 'history', label: 'History Laporan' });
		return base;
	});

	$effect(() => {
		if (isHold && !dynamicTabs.some(t => t.id === activeTab)) {
			activeTab = 'summary';
		}
	});
</script>

<div class="flex-1 flex flex-col h-full w-full">

	{#if loading}
		<div class="flex-1 flex items-center justify-center min-h-[50vh] py-20" style="background: var(--sys-bg)">
			<CircularProgressGauge size={80} strokeWidth={6} label="Memuat Laporan Harian..." sublabel="Sinkronisasi proyek, RAP & log Directus" />
		</div>
	{:else}
		<div class="scroll-body w-full" style="background: var(--sys-bg)">
			<!-- Report meta / Top fields (Always accessible above sticky tabs) -->
			<div class="p-4" style="background: var(--sys-bg); border-bottom: 1px solid var(--sys-sep)">
				<div class="flex flex-col gap-3.5 max-w-5xl mx-auto">
					<HseGateWarning projectId={projectId} />
					<SectionGuide
						id="laporan.form.page"
						title={h('laporan.page').sectionGuide?.title}
						steps={h('laporan.page').sectionGuide?.steps ?? []}
					/>
					<div><ProcessGuideLink fokus="proyek_jalan" label="Lihat alur proyek" /></div>
					{#if isDemisioner}
						<div class="p-3 px-4 rounded-xl border text-[12px] font-semibold flex items-start gap-2.5 bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-800 text-purple-900 dark:text-purple-200">
							<span class="text-base leading-none">📁</span>
							<div class="flex-1">
								<p class="font-bold">Mode Leader Demisioner {canReviseOwnReport ? '(Izin Revisi Terbuka)' : '(Akses Read-Only)'}</p>
								<p class="text-[11px] font-normal text-purple-700 dark:text-purple-300 mt-0.5">
									{#if canReviseOwnReport}
										Laporan harian ini berstatus <strong>Perlu Diperbaiki (Revisi)</strong>. Anda diizinkan untuk melengkapi catatan/revisi dan mengirimkannya kembali.
									{:else}
										Anda adalah mantan Project Leader pada proyek ini. Anda dapat melihat riwayat dan arsip laporan harian secara lengkap. Pembuatan laporan baru dilakukan oleh leader aktif ({project?.leader || '-'}).
									{/if}
								</p>
							</div>
						</div>
					{:else if !hasReportedToday && !savedReportId}
						<div class="p-2.5 px-3.5 rounded-xl border text-[12px] font-semibold flex items-center gap-2" style="background: #FEF3C7; border-color: #FDE68A; color: #92400E;">
							<span>⚠️</span>
							<span>Anda belum mengisi laporan harian untuk hari ini.</span>
						</div>
					{/if}

					<!-- Summary & Metadata Card -->
					<div class="card-section">
						<!-- Summary Header Bar -->
						<div class="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 rounded-xl border border-gray-200 dark:border-slate-800 bg-gray-50/70 dark:bg-slate-800/40 gap-3" class:mb-4={metadataExpanded} class:mb-0={!metadataExpanded} style="border-color: var(--sys-sep); background: var(--sys-fill)">
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2 flex-wrap mb-1">
									<h3 class="text-[14px] font-bold text-gray-900 dark:text-white truncate" style="color: var(--sys-label)">{project?.name || 'Laporan Harian'}</h3>
									<span class="badge {isHold ? 'warn' : 'info'}" style="font-size: 9px; padding: 1px 6px;">{isHold ? 'Hold' : 'On Progress'}</span>
									{#if soCustomer?.customer_name}
										<span class="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800/40 truncate max-w-[220px]" title="Klien: {soCustomer.customer_name}">
											🏢 {soCustomer.customer_name}
										</span>
									{/if}
									{#if project?.jenis_project}
										<span class="text-[10px] font-medium px-2 py-0.5 rounded bg-gray-200/60 dark:bg-slate-700/60 text-gray-700 dark:text-slate-300">
											{project.jenis_project}
										</span>
									{/if}
									{#if savedReportId}
										<span class="badge {statusBadgeClass === 'ok' ? 'ok' : statusBadgeClass === 'err' ? 'rej' : statusBadgeClass === 'info' ? 'info' : 'warn'}" style="font-size: 9px; padding: 1px 6px;">{statusLabel}</span>
									{/if}
								</div>
								<div class="text-[11px] flex flex-wrap gap-x-2 gap-y-1 items-center text-slate-500 dark:text-slate-400" style="color: var(--sys-label3)">
									<span>📅 Tanggal: <strong style="color: var(--sys-label2)">{new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(reportData.date))}</strong></span>
									<span class="opacity-40">•</span>
									<span>👥 Tenaga: <strong style="color: var(--sys-label2)">{totalManpowerWorkers > 0 ? totalManpowerWorkers : reportData.manpower_count} org</strong></span>
									{#if !isHold}
										<span class="opacity-40">•</span>
										<span>Cuaca: <strong style="color: var(--sys-label2)">{reportData.weather}</strong></span>
									{/if}
									{#if project?.lokasi}
										<span class="opacity-40">•</span>
										<span class="truncate max-w-[180px]">📍 <strong style="color: var(--sys-label2)">{project.lokasi}</strong></span>
									{/if}
									{#if project?.nomor_po || soCustomer?.nomor_po}
										<span class="opacity-40">•</span>
										<span>PO: <strong style="color: var(--sys-label2)">{project?.nomor_po || soCustomer?.nomor_po}</strong></span>
									{/if}
									<span class="opacity-40">•</span>
									<span>ID: <strong style="color: var(--sys-label2)">#{projectId}</strong></span>
								</div>
							</div>
							<div class="flex items-center gap-2 shrink-0 self-start sm:self-auto flex-wrap">
								<button 
									type="button" 
									class="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 active:scale-95 transition-all shadow-xs cursor-pointer"
									onclick={() => (showProjectDetailModal = true)}
									title="Lihat spesifikasi, jadwal, dan rincian pekerjaan proyek"
								>
									<IconInfoCircle size={14} />
									<span>Detail Proyek</span>
								</button>
								<button 
									type="button" 
									class="text-[11px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-750 active:scale-95 transition-all shadow-2xs cursor-pointer flex items-center gap-1"
									style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label2)"
									onclick={() => (metadataExpanded = !metadataExpanded)}
								>
									{#if metadataExpanded}
										<IconChevronUp size={13} />
										<span>Sembunyikan Form</span>
									{:else}
										<IconChevronDown size={13} />
										<span>Edit Form Metadata</span>
									{/if}
								</button>
							</div>
						</div>

						{#if reportPosition}
							<button
								type="button"
								class="text-[11px] font-semibold flex items-center gap-1 my-2 cursor-pointer"
								style="color: var(--g)"
								onclick={toggleLocationMap}
							>
								📍 {showLocationMap ? 'Sembunyikan peta lokasi' : 'Lihat peta lokasi Anda saat ini'}
							</button>
							{#if showLocationMap && LocationMap}
								<div transition:slide={{ duration: 200 }} class="mb-4">
									<LocationMap lat={reportPosition.lat} lng={reportPosition.lng} label="Lokasi laporan ini" height="200px" />
								</div>
							{/if}
						{/if}

						{#if metadataExpanded}
							<div transition:slide={{ duration: 200 }} class="flex flex-col gap-3.5 pt-2">
								<div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
									<div>
										<div class="flex items-center justify-between mb-1">
											<label class="f-label mb-0">Proyek <span style="color: var(--re)">*</span></label>
											<button
												type="button"
												class="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
												onclick={() => (showProjectDetailModal = true)}
											>
												<IconInfoCircle size={13} /> Popup Detail Proyek
											</button>
										</div>
										<div class="relative flex items-center">
											<input
												type="text"
												value={project?.name || ''}
												class="f-input pr-24 cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
												style="background: var(--sys-fill); color: var(--sys-label)"
												readonly
												required
												onclick={() => (showProjectDetailModal = true)}
												title="Klik untuk membuka popup detail proyek"
											/>
											<button
												type="button"
												class="absolute right-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-white dark:bg-slate-700 border border-gray-200 dark:border-slate-600 text-blue-600 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/50 flex items-center gap-1 shadow-2xs cursor-pointer transition-all active:scale-95"
												onclick={() => (showProjectDetailModal = true)}
												title="Buka Popup Detail Proyek"
											>
												<IconEye size={13} /> Detail
											</button>
										</div>
									</div>
									<div>
										<label class="f-label">Tanggal <span style="color: var(--re)">*</span></label>
										{#if isLocked}
											<input type="date" bind:value={reportData.date} class="f-input cursor-not-allowed" style="background: var(--sys-fill); color: var(--sys-label3)" readonly />
										{:else}
											<input type="date" bind:value={reportData.date} class="f-input" required />
											<p class="text-[11px] mt-1" style="color: var(--sys-label3)">Laporan dikirim di hari yang sama. Laporan susulan lebih dari H-{DEFAULT_DISIPLIN.bebas_hari} wajib alasan.</p>
											{#if hariTerlambat > DEFAULT_DISIPLIN.bebas_hari}
												<label class="f-label mt-2" for="alasan-terlambat">Alasan terlambat ({hariTerlambat} hari) <span style="color: var(--re)">*</span></label>
												<textarea id="alasan-terlambat" class="f-input" rows="2" bind:value={alasanTerlambat} placeholder="Mis. sinyal hilang di site, laporan baru bisa dikirim hari ini"></textarea>
											{/if}
										{/if}
									</div>
								</div>

								<div>
									<label class="f-label">Status Aktivitas <span style="color: var(--re)">*</span></label>
									{#if isLocked}
										<span class="badge {isHold ? 'warn' : 'info'}" style="font-size: 11px">{isHold ? 'Hold' : 'On Progress'}</span>
									{:else}
										<div class="flex gap-2">
											<button
												type="button"
												class="flex-1 py-2 rounded-lg text-[12px] font-semibold border transition-colors cursor-pointer"
												style={!isHold ? 'background: var(--g); color: #fff; border-color: var(--g)' : 'background: var(--sys-fill); color: var(--sys-label3); border-color: var(--sys-sep)'}
												onclick={() => handleActivityStatusChange('on_progress')}
											>On Progress</button>
											<button
												type="button"
												class="flex-1 py-2 rounded-lg text-[12px] font-semibold border transition-colors cursor-pointer"
												style={isHold ? 'background: var(--am); color: #fff; border-color: var(--am)' : 'background: var(--sys-fill); color: var(--sys-label3); border-color: var(--sys-sep)'}
												onclick={() => handleActivityStatusChange('hold')}
											>Hold</button>
										</div>
										{#if isHold}
											<p class="text-[11px] mt-1.5" style="color: var(--sys-label3)">Hold: detail aktivitas hari ini tidak perlu diisi, manpower otomatis standby.</p>
										{/if}
									{/if}
								</div>

								{#if isHold}
									<div>
										<label class="f-label">
											Alasan Hold <span style="color: var(--re)">*</span>
											<HelpIcon text="Wajib diisi minimal 20 karakter — kenapa proyek Hold hari ini? Laporan Hold tanpa alasan tidak bisa dikirim (Gate G_LH_HOLD_ALASAN)." />
										</label>
										{#if isLocked}
											<textarea bind:value={reportData.hold_reason} class="f-textarea cursor-not-allowed" style="background: var(--sys-fill); color: var(--sys-label3); height: 70px; resize: none" readonly></textarea>
										{:else}
											<textarea bind:value={reportData.hold_reason} class="f-textarea" placeholder="Contoh: Menunggu izin pemilik lahan sebelah, material belum datang, dll." style="height: 70px" required></textarea>
											<p class="text-[10px] mt-1" style="color: var(--sys-label3)">{(reportData.hold_reason || '').trim().length}/20 karakter minimal. Foto standby tenaga tetap wajib di tab Tenaga.</p>
										{/if}
									</div>
								{/if}

								{#if !isHold}
									<div class="grid grid-cols-1 md:grid-cols-3 gap-3.5">
										<div>
											<label class="f-label">Jenis Proyek <span style="color: var(--re)">*</span></label>
											{#if isLocked}
												<input type="text" bind:value={reportData.project_type} class="f-input cursor-not-allowed" style="background: var(--sys-fill); color: var(--sys-label3)" readonly />
											{:else}
												<input type="text" bind:value={reportData.project_type} class="f-input" placeholder="-" required />
											{/if}
										</div>
										<div>
											<label class="f-label">Cuaca <span style="color: var(--re)">*</span></label>
											{#if isLocked}
												<input type="text" bind:value={reportData.weather} class="f-input cursor-not-allowed" style="background: var(--sys-fill); color: var(--sys-label3)" readonly />
											{:else}
												<select bind:value={reportData.weather} class="f-select" required>
													<option value="Cerah">Cerah</option>
													<option value="Berawan">Berawan</option>
													<option value="Gerimis">Gerimis</option>
													<option value="Hujan">Hujan</option>
													<option value="Hujan Deras">Hujan Deras</option>
												</select>
												<FieldHint text={h('laporan.form.cuaca').fieldHint} />
											{/if}
										</div>
										<div>
											<label class="f-label">
												Jumlah Tenaga <span style="color: var(--re)">*</span>
												<HelpIcon text={h('laporan.form.manpower').helpIcon} />
											</label>
											{#if isLocked}
												<input type="number" bind:value={reportData.manpower_count} class="f-input cursor-not-allowed" style="background: var(--sys-fill); color: var(--sys-label3)" readonly />
											{:else}
												<input type="number" bind:value={reportData.manpower_count} class="f-input" min="0" required />
												<FieldHint text={h('laporan.form.manpower').fieldHint} />
											{/if}
										</div>
									</div>

									<div class="grid grid-cols-1 md:grid-cols-3 gap-3.5">
										<div>
											<label class="f-label">
												Kendala (umum) <span style="color: var(--re)">*</span>
												<HelpIcon text={h('laporan.form.kendala').helpIcon} />
											</label>
											{#if isLocked}
												<textarea bind:value={reportData.issues_general} class="f-textarea cursor-not-allowed" style="background: var(--sys-fill); color: var(--sys-label3); height: 80px; resize: none" readonly></textarea>
											{:else}
												<textarea bind:value={reportData.issues_general} class="f-textarea" placeholder="Kendala hari ini" style="height: 80px" required></textarea>
												<FieldHint text={h('laporan.form.kendala').fieldHint} type="warning" />
											{/if}
										</div>
										<div>
											<label class="f-label">Catatan Umum <span style="color: var(--re)">*</span></label>
											{#if isLocked}
												<textarea bind:value={reportData.general_notes} class="f-textarea cursor-not-allowed" style="background: var(--sys-fill); color: var(--sys-label3); height: 80px; resize: none" readonly></textarea>
											{:else}
												<textarea bind:value={reportData.general_notes} class="f-textarea" placeholder="Catatan umum" style="height: 80px" required></textarea>
											{/if}
										</div>
										<div>
											<label class="f-label">Rencana Besok <span style="color: var(--re)">*</span></label>
											{#if isLocked}
												<textarea bind:value={reportData.tomorrow_plan_summary} class="f-textarea cursor-not-allowed" style="background: var(--sys-fill); color: var(--sys-label3); height: 80px; resize: none" readonly></textarea>
											{:else}
												<textarea bind:value={reportData.tomorrow_plan_summary} class="f-textarea" placeholder="Rencana untuk besok" style="height: 80px" required></textarea>
											{/if}
										</div>
									</div>
								{:else}
									<div>
										<label class="f-label">Catatan (opsional)</label>
										{#if isLocked}
											<textarea bind:value={reportData.general_notes} class="f-textarea cursor-not-allowed" style="background: var(--sys-fill); color: var(--sys-label3); height: 60px; resize: none" readonly></textarea>
										{:else}
											<textarea bind:value={reportData.general_notes} class="f-textarea" placeholder="Alasan hold (opsional)..." style="height: 60px"></textarea>
										{/if}
									</div>
								{/if}
							</div>
						{/if}

						<div class="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 mt-4 pt-3 border-t border-gray-100 dark:border-slate-800">
							<div><span class="f-label" style="margin-bottom: 2px">Prepared by</span><p class="text-[13px] font-medium" style="color: var(--sys-label)">{userName}</p></div>
							<div><span class="f-label" style="margin-bottom: 2px">Proyek ID</span><p class="text-[13px] font-medium" style="color: var(--sys-label)">#{projectId}</p></div>
							<div>
								<span class="f-label" style="margin-bottom: 2px">Status</span>
								<StatusExplainer
									status={statusLabel}
									explain={h(`laporan.status.${reportStatus}`).explain}
									flow={h(`laporan.status.${reportStatus}`).flow ?? []}
									currentIndex={reportStatus === 'rejected' ? 1 : -1}
								>
									<span class="badge {statusBadgeClass === 'ok' ? 'ok' : statusBadgeClass === 'err' ? 'rej' : statusBadgeClass === 'info' ? 'info' : 'warn'}" style="font-size: 11px">{statusLabel}</span>
								</StatusExplainer>
							</div>
						</div>
					</div>
				</div>
			</div>

			<!-- Sticky Tab Navigation -->
			<div class="px-4 py-2.5 sticky top-0 z-20 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 shadow-xs">
				<div class="tab-bar max-w-5xl mx-auto">
					{#each dynamicTabs as tab}
						<button
							class="tab-item {activeTab === tab.id ? 'active' : ''} flex items-center justify-center gap-1.5"
							onclick={(e) => {
								activeTab = tab.id;
								e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
							}}
						>
							<span>{tab.label}</span>
							{#if tab.badge}
								<span class="text-[9px] px-1.5 py-0.5 rounded-full font-bold {tab.warn ? 'bg-amber-500 text-white' : tab.ok ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'}">
									{tab.badge}
								</span>
							{/if}
						</button>
					{/each}
				</div>
			</div>

			<!-- Tab Content -->
			<div class="px-4 py-4" style="background: var(--sys-bg)">
				{#if activeTab === 'summary'}
					<div class="space-y-4 max-w-5xl mx-auto">
						<!-- 1. HERO PROJECT SNAPSHOT CARD -->
						<div class="bg-white dark:bg-slate-850 rounded-2xl border border-gray-200/90 dark:border-slate-800 p-5 shadow-xs relative overflow-hidden">
							<div class="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-emerald-500 to-indigo-500"></div>

							<div class="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-gray-100 dark:border-slate-800">
								<div class="min-w-0 flex-1">
									<div class="flex items-center gap-2 flex-wrap mb-1.5">
										<span class="text-[11px] font-bold px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800 font-mono">
											#{projectId}
										</span>
										<span class="badge {isHold ? 'warn' : 'ok'}" style="font-size: 10px; padding: 2px 8px;">
											{isHold ? '⏸️ Status: Hold' : '🚀 Status: On Progress'}
										</span>
										{#if savedReportId}
											<span class="badge {statusBadgeClass === 'ok' ? 'ok' : statusBadgeClass === 'err' ? 'rej' : statusBadgeClass === 'info' ? 'info' : 'warn'}" style="font-size: 10px; padding: 2px 8px;">
												Laporan Hari Ini: {statusLabel}
											</span>
										{/if}
										<span class="text-[10px] font-bold px-2 py-0.5 rounded-full border {scheduleHealthStatus.class} flex items-center gap-1">
											<span>{scheduleHealthStatus.icon}</span>
											<span>{scheduleHealthStatus.label}</span>
										</span>
									</div>

									<h2 class="text-lg sm:text-xl font-bold text-gray-900 dark:text-white tracking-tight leading-snug">
										{project?.name || 'Proyek Lapangan'}
									</h2>

									<div class="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-gray-500 dark:text-slate-400">
										{#if project?.customer || project?.customer_name}
											<span class="flex items-center gap-1">
												<IconBuilding size={14} class="text-gray-400" />
												<strong class="text-gray-700 dark:text-slate-200 font-semibold">{project?.customer || project?.customer_name}</strong>
											</span>
										{/if}
										{#if project?.po_number || project?.nomor_po}
											<span class="flex items-center gap-1 font-mono">
												<IconFileInvoice size={14} class="text-gray-400" />
												<span>PO: <strong class="text-gray-700 dark:text-slate-200">{project?.po_number || project?.nomor_po}</strong></span>
											</span>
										{/if}
										{#if project?.lokasi || project?.location}
											<span class="flex items-center gap-1">
												<IconMapPin size={14} class="text-red-400" />
												<span>{project?.lokasi || project?.location}</span>
											</span>
										{/if}
										<span class="flex items-center gap-1">
											<IconUserCheck size={14} class="text-emerald-500" />
											<span>Leader: <strong class="text-gray-700 dark:text-slate-200">{project?.leader || userName}</strong></span>
										</span>
									</div>
								</div>

								<!-- Duration & Countdown Widget -->
								<div class="bg-gray-50/80 dark:bg-slate-800/80 border border-gray-200/80 dark:border-slate-700/80 rounded-xl p-3.5 sm:min-w-[240px] shrink-0">
									<div class="flex items-center justify-between gap-2 mb-1.5">
										<span class="text-[11px] font-semibold text-gray-500 dark:text-slate-400 flex items-center gap-1">
											<IconCalendar size={13} class="text-blue-500" /> Periode Proyek
										</span>
										<span class="text-[10px] font-bold px-1.5 py-0.5 rounded {projectTimelineMetrics.isOverdue ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'}">
											{projectTimelineMetrics.isOverdue ? 'Overdue' : `${projectTimelineMetrics.remainingDays} Hari Lagi`}
										</span>
									</div>
									<div class="text-[11px] font-medium text-gray-700 dark:text-slate-300 flex items-center justify-between">
										<span>{projectTimelineMetrics.startDateStr}</span>
										<span class="text-gray-400">➔</span>
										<span>{projectTimelineMetrics.endDateStr}</span>
									</div>
									<!-- Mini Duration Progress Bar -->
									<div class="mt-2.5">
										<div class="flex justify-between text-[10px] text-gray-500 dark:text-slate-400 mb-1">
											<span>Durasi: {projectTimelineMetrics.elapsedDays} / {projectTimelineMetrics.totalDays} Hari</span>
											<span class="font-bold text-gray-700 dark:text-slate-200">{projectTimelineMetrics.timeElapsedPct}%</span>
										</div>
										<div class="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
											<div
												class="h-1.5 rounded-full transition-all {projectTimelineMetrics.isOverdue ? 'bg-red-500' : 'bg-blue-600'}"
												style="width: {projectTimelineMetrics.timeElapsedPct}%"
											></div>
										</div>
									</div>
								</div>
							</div>

							<!-- 4 Executive Metric Chips Grid -->
							<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4">
								<!-- 1. Progress Fisik -->
								<div class="p-3 rounded-xl bg-gradient-to-br from-emerald-50/70 to-emerald-100/40 dark:from-emerald-950/30 dark:to-emerald-900/20 border border-emerald-200/70 dark:border-emerald-800/60">
									<div class="flex items-center justify-between text-[11px] font-medium text-emerald-800 dark:text-emerald-300 mb-1">
										<span class="flex items-center gap-1"><IconChartLine size={14} /> Progress Fisik</span>
										<span class="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-200/60 dark:bg-emerald-800 text-emerald-900 dark:text-emerald-200">Kumulatif</span>
									</div>
									<div class="text-xl sm:text-2xl font-black text-emerald-700 dark:text-emerald-300 tracking-tight">
										{overallProjectProgressPct}%
									</div>
									<p class="text-[10px] text-emerald-800/80 dark:text-emerald-400/90 mt-0.5 truncate">
										{subtasksStats.completed} dari {subtasksStats.total} subtask tuntas
									</p>
								</div>

								<!-- 2. Manpower / Man-Days -->
								<div class="p-3 rounded-xl bg-gradient-to-br from-blue-50/70 to-blue-100/40 dark:from-blue-950/30 dark:to-blue-900/20 border border-blue-200/70 dark:border-blue-800/60">
									<div class="flex items-center justify-between text-[11px] font-medium text-blue-800 dark:text-blue-300 mb-1">
										<span class="flex items-center gap-1"><IconUsers size={14} /> Man-Days (HOK)</span>
										<span class="text-[10px] font-bold px-1.5 py-0.2 rounded bg-blue-200/60 dark:bg-blue-800 text-blue-900 dark:text-blue-200">Absensi</span>
									</div>
									<div class="text-xl sm:text-2xl font-black text-blue-700 dark:text-blue-300 tracking-tight">
										{cumulativeManpowerMetrics.totalManDays} <span class="text-xs font-semibold">HOK</span>
									</div>
									<p class="text-[10px] text-blue-800/80 dark:text-blue-400/90 mt-0.5 truncate">
										Rata-rata {cumulativeManpowerMetrics.avgDailyWorkers} org / hari
									</p>
								</div>

								<!-- 3. Peralatan / P2H -->
								<div class="p-3 rounded-xl bg-gradient-to-br from-amber-50/70 to-amber-100/40 dark:from-amber-950/30 dark:to-amber-900/20 border border-amber-200/70 dark:border-amber-800/60">
									<div class="flex items-center justify-between text-[11px] font-medium text-amber-800 dark:text-amber-300 mb-1">
										<span class="flex items-center gap-1"><IconTool size={14} /> Kesiapan Alat</span>
										<span class="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-200/60 dark:bg-amber-800 text-amber-900 dark:text-amber-200">P2H Site</span>
									</div>
									<div class="text-xl sm:text-2xl font-black text-amber-700 dark:text-amber-300 tracking-tight">
										{projectEquipmentP2h.filter(e => e.hasSession && e.result === 'Go').length}/{projectEquipmentP2h.length} <span class="text-xs font-semibold">Unit</span>
									</div>
									<p class="text-[10px] text-amber-800/80 dark:text-amber-400/90 mt-0.5 truncate">
										{projectEquipmentP2h.filter(e => e.hasSession && e.result === 'No-Go').length > 0 ? `🚨 ${projectEquipmentP2h.filter(e => e.hasSession && e.result === 'No-Go').length} Unit No-Go` : (projectEquipmentP2h.length > 0 ? '✓ Seluruh alat siap' : 'Tidak ada alat dipinjam')}
									</p>
								</div>

								<!-- 4. Kas Lapangan Terpakai -->
								<div class="p-3 rounded-xl bg-gradient-to-br from-violet-50/70 to-violet-100/40 dark:from-violet-950/30 dark:to-violet-900/20 border border-violet-200/70 dark:border-violet-800/60">
									<div class="flex items-center justify-between text-[11px] font-medium text-violet-800 dark:text-violet-300 mb-1">
										<span class="flex items-center gap-1"><IconWallet size={14} /> Kas Dilaporkan</span>
										<span class="text-[10px] font-bold px-1.5 py-0.2 rounded bg-violet-200/60 dark:bg-violet-800 text-violet-900 dark:text-violet-200">Kumulatif</span>
									</div>
									<div class="text-base sm:text-lg font-black text-violet-700 dark:text-violet-300 tracking-tight truncate">
										{formatRupiah(cumulativeFinancialMetrics.totalCumulativeSpent)}
									</div>
									<p class="text-[10px] text-violet-800/80 dark:text-violet-400/90 mt-0.5 truncate">
										{formatRupiah(cumulativeFinancialMetrics.totalReimburseClaims)} klaim reimburse
									</p>
								</div>
								<!-- 5. Live Productivity Score -->
								<div class="p-3 rounded-xl bg-gradient-to-br from-indigo-50/70 to-indigo-100/40 dark:from-indigo-950/30 dark:to-indigo-900/20 border border-indigo-200/70 dark:border-indigo-800/60">
									<div class="flex items-center justify-between text-[11px] font-medium text-indigo-800 dark:text-indigo-300 mb-1">
										<span class="flex items-center gap-1">⚡ Output Hari Ini</span>
										<span class="text-[10px] font-bold px-1.5 py-0.2 rounded {liveProductivity.statusTone === 'ok' ? 'bg-emerald-200/60 dark:bg-emerald-800 text-emerald-900 dark:text-emerald-200' : liveProductivity.statusTone === 'warn' ? 'bg-amber-200/60 dark:bg-amber-800 text-amber-900 dark:text-amber-200' : liveProductivity.statusTone === 'err' ? 'bg-red-200/60 dark:bg-red-800 text-red-900 dark:text-red-200' : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'}">
											{liveProductivity.statusTone === 'ok' ? 'Normal' : liveProductivity.statusTone === 'warn' ? 'Perhatian' : liveProductivity.statusTone === 'err' ? 'Anomali' : 'Draft'}
										</span>
									</div>
									<div class="text-sm sm:text-base font-black text-indigo-700 dark:text-indigo-300 tracking-tight truncate">
										{#if liveProductivity.volumeBlastingM2 > 0 || liveProductivity.volumePaintingM2 > 0}
											B: {liveProductivity.blasterOutputM2PerDay} | P: {liveProductivity.painterOutputM2PerDay} m²
										{:else}
											{liveProductivity.totalVolumeM2} m²
										{/if}
									</div>
									<p class="text-[10px] text-indigo-800/80 dark:text-indigo-400/90 mt-0.5 truncate">
										Total: {liveProductivity.totalVolumeM2} m² ({liveProductivity.totalWorkers} org)
									</p>
								</div>
							</div>
						</div>

						<!-- 2. PHYSICAL PROGRESS & SUBTASK BREAKDOWN COCKPIT -->
						<div class="card-section">
							<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100 dark:border-slate-800">
								<div>
									<h4 class="flex items-center gap-2 text-base font-bold text-gray-900 dark:text-white m-0">
										<IconChartBar size={18} class="text-[var(--g)]" />
										<span>Realisasi Progress Fisik & Subtask Proyek</span>
									</h4>
									<p class="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5 m-0">
										Rincian akumulasi volume pekerjaan dari seluruh laporan harian terhadap target bill of quantities.
									</p>
								</div>

								<div class="flex items-center gap-2">
									<button
										type="button"
										class="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1 transition-all active:scale-95 cursor-pointer shadow-2xs"
										onclick={() => activeTab = 'progress'}
									>
										<IconPlus size={13} /> Update Progress Hari Ini
									</button>
								</div>
							</div>

							<!-- Dual Progress Comparison Bar -->
							<div class="p-4 rounded-xl bg-gray-50/70 dark:bg-slate-800/50 border border-gray-200/80 dark:border-slate-700/80 my-3 space-y-3">
								<div>
									<div class="flex justify-between text-xs mb-1.5">
										<span class="font-bold text-gray-700 dark:text-slate-200 flex items-center gap-1.5">
											<span class="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
											Realisasi Progress Fisik Kumulatif: <strong>{overallProjectProgressPct}%</strong>
										</span>
										<span class="text-gray-500 dark:text-slate-400">Target Proyek: 100%</span>
									</div>
									<div class="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-3 overflow-hidden">
										<div
											class="h-3 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500 transition-all duration-500"
											style="width: {overallProjectProgressPct}%"
										></div>
									</div>
								</div>

								<div>
									<div class="flex justify-between text-xs mb-1.5">
										<span class="font-bold text-gray-700 dark:text-slate-200 flex items-center gap-1.5">
											<span class="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block"></span>
											Waktu Proyek Berlalu (Time Elapsed): <strong>{projectTimelineMetrics.timeElapsedPct}%</strong>
										</span>
										<span class="text-gray-500 dark:text-slate-400">
											{projectTimelineMetrics.elapsedDays} dari {projectTimelineMetrics.totalDays} hari ({projectTimelineMetrics.remainingDays} hari tersisa)
										</span>
									</div>
									<div class="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
										<div
											class="h-2 rounded-full {projectTimelineMetrics.isOverdue ? 'bg-red-500' : 'bg-blue-500'} transition-all duration-500"
											style="width: {projectTimelineMetrics.timeElapsedPct}%"
										></div>
									</div>
								</div>
							</div>

							<!-- Fase 6/6.3 (Pertajam Modul Penawaran) — Kurva S rencana vs realisasi -->
							<FieldSCurve
								baseline={scurveBaseline}
								reports={allReportsForProgress}
								project={project}
								startDate={project?.start_date}
								endDate={project?.end_date}
							/>

							<!-- Subtask Breakdown Table -->
							{#if subtaskSummaryList.length === 0}
								<div class="text-center py-8 px-4 border border-dashed border-gray-200 dark:border-slate-800 rounded-xl">
									<IconChartLine size={32} class="text-gray-300 dark:text-slate-600 mx-auto mb-2" />
									<p class="text-xs font-semibold text-gray-600 dark:text-slate-400 m-0">Belum ada data subtask atau breakdown timeline untuk proyek ini.</p>
									<p class="text-[11px] text-gray-400 mt-1 m-0">Anda dapat langsung mencatat aktivitas progress kustom di tab Progress.</p>
								</div>
							{:else}
								<div class="overflow-x-auto rounded-xl border border-gray-200/80 dark:border-slate-800">
									<table class="w-full text-left text-[12px]">
										<thead class="bg-gray-50 dark:bg-slate-800 text-gray-600 dark:text-slate-300 font-semibold border-b border-gray-200 dark:border-slate-700">
											<tr>
												<th class="py-2.5 px-3">Item Pekerjaan / Subtask</th>
												<th class="py-2.5 px-3 text-right">Target Volume</th>
												<th class="py-2.5 px-3 text-right">Terpasang (Kumulatif)</th>
												<th class="py-2.5 px-3 text-right">Sisa Volume</th>
												<th class="py-2.5 px-3 text-center min-w-[140px]">Pencapaian (%)</th>
												<th class="py-2.5 px-3 text-center">Status</th>
											</tr>
										</thead>
										<tbody class="divide-y divide-gray-100 dark:divide-slate-800 bg-white dark:bg-slate-850">
											{#each subtaskSummaryList as item}
												<tr class="hover:bg-gray-50/70 dark:hover:bg-slate-800/60 transition-colors">
													<td class="py-2.5 px-3">
														<p class="font-bold text-gray-800 dark:text-slate-100 m-0">{item.name}</p>
														<p class="text-[10.5px] text-gray-400 dark:text-slate-500 m-0">{item.categoryName}</p>
													</td>
													<td class="py-2.5 px-3 text-right font-mono font-medium text-gray-700 dark:text-slate-300">
														{item.targetVolume} {item.unit}
													</td>
													<td class="py-2.5 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
														{item.totalInstalledVolume.toFixed(1)} {item.unit}
														{#if item.todayVolume > 0}
															<span class="text-[9.5px] text-emerald-500 block font-normal">(+{item.todayVolume} hari ini)</span>
														{/if}
														{#if item.manualVolume > 0}
															<span class="text-[9.5px] text-amber-600 dark:text-amber-400 block font-normal">+{item.manualVolume} {item.unit} input manual (belum diverifikasi)</span>
														{/if}
													</td>
													<td class="py-2.5 px-3 text-right font-mono text-gray-500 dark:text-slate-400">
														{item.remainingVolume.toFixed(1)} {item.unit}
													</td>
													<td class="py-2.5 px-3">
														<div class="flex items-center gap-2">
															<div class="flex-1 bg-gray-100 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
																<div
																	class="h-2 rounded-full {item.progressPct >= 100 ? 'bg-emerald-500' : item.progressPct > 0 ? 'bg-blue-500' : 'bg-gray-300'}"
																	style="width: {item.progressPct}%"
																></div>
															</div>
															<span class="text-[11px] font-bold font-mono min-w-[36px] text-right {item.progressPct >= 100 ? 'text-emerald-600' : 'text-gray-700 dark:text-slate-300'}">
																{item.progressPct}%
															</span>
														</div>
													</td>
													<td class="py-2.5 px-3 text-center">
														{#if item.status === 'completed'}
															<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
																✓ Selesai
															</span>
														{:else if item.status === 'in_progress'}
															<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
																On Progress
															</span>
														{:else}
															<span class="text-[10px] font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400">
																Belum Mulai
															</span>
														{/if}
													</td>
												</tr>
											{/each}
										</tbody>
									</table>
								</div>
							{/if}
						</div>

						<!-- 3. TWO-COLUMN LAYOUT: MANPOWER & MATERIAL SUMMARY -->
						<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
							<!-- MANPOWER SUMMARY CARD -->
							<div class="card-section flex flex-col justify-between">
								<div>
									<div class="flex items-center justify-between pb-2.5 border-b border-gray-100 dark:border-slate-800 mb-3">
										<h4 class="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white m-0">
											<IconUsers size={16} class="text-blue-500" />
											<span>Rekap Tenaga Kerja & SPK</span>
										</h4>
										<button
											type="button"
											class="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5 cursor-pointer"
											onclick={() => activeTab = 'tenaga'}
										>
											Lihat Form Absensi ➔
										</button>
									</div>

									<div class="grid grid-cols-3 gap-2 text-center mb-3">
										<div class="bg-gray-50 dark:bg-slate-800/60 p-2 rounded-xl border border-gray-100 dark:border-slate-700/60">
											<span class="text-[10px] text-gray-400 block">Total HOK</span>
											<strong class="text-sm font-bold text-gray-800 dark:text-slate-100">{cumulativeManpowerMetrics.totalManDays}</strong>
										</div>
										<div class="bg-gray-50 dark:bg-slate-800/60 p-2 rounded-xl border border-gray-100 dark:border-slate-700/60">
											<span class="text-[10px] text-gray-400 block">Rata-rata/Hari</span>
											<strong class="text-sm font-bold text-gray-800 dark:text-slate-100">{cumulativeManpowerMetrics.avgDailyWorkers} org</strong>
										</div>
										<div class="bg-gray-50 dark:bg-slate-800/60 p-2 rounded-xl border border-gray-100 dark:border-slate-700/60">
											<span class="text-[10px] text-gray-400 block">SPK Aktif</span>
											<strong class="text-sm font-bold text-gray-800 dark:text-slate-100">{availableManpower.length} org</strong>
										</div>
									</div>

									<!-- Worker Assignment List Preview -->
									{#if availableManpower.length === 0}
										<p class="text-xs text-gray-400 text-center py-4">Belum ada penugasan SPK aktif di proyek ini.</p>
									{:else}
										<div class="space-y-1.5 max-h-[220px] overflow-y-auto pr-1 divide-y divide-gray-50 dark:divide-slate-800/60">
											{#each availableManpower.slice(0, 6) as worker}
												<div class="pt-1.5 flex items-center justify-between text-xs">
													<div class="min-w-0 flex-1">
														<p class="font-bold text-gray-800 dark:text-slate-200 truncate m-0">{worker.nama}</p>
														<p class="text-[10px] text-gray-400 m-0">{worker.posisi || 'Pekerja'} · {worker.nomor_spk || 'SPK Aktif'}</p>
													</div>
													<span class="text-[10px] font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 font-mono">
														{worker.rate_tipe}
													</span>
												</div>
											{/each}
											{#if availableManpower.length > 6}
												<p class="text-[11px] text-center text-gray-400 pt-2 m-0">+ {availableManpower.length - 6} pekerja lainnya</p>
											{/if}
										</div>
									{/if}
								</div>

								<button
									type="button"
									class="btn-action w-full justify-center mt-3 text-[11px] font-bold"
									onclick={() => activeTab = 'tenaga'}
								>
									<IconUserCheck size={14} /> Isi Absensi & Timesheet Hari Ini
								</button>
							</div>

							<!-- MATERIAL USAGE SUMMARY CARD -->
							<div class="card-section flex flex-col justify-between">
								<div>
									<div class="flex items-center justify-between pb-2.5 border-b border-gray-100 dark:border-slate-800 mb-3">
										<h4 class="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white m-0">
											<IconPackage size={16} class="text-emerald-500" />
											<span>Rekap Material Lapangan</span>
										</h4>
										<button
											type="button"
											class="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-0.5 cursor-pointer"
											onclick={() => activeTab = 'material'}
										>
											Catat Material ➔
										</button>
									</div>

									{#if materialSummaryList.length === 0}
										<p class="text-xs text-gray-400 text-center py-8">Belum ada data actual material terdaftar di proyek ini.</p>
									{:else}
										<div class="space-y-2.5 max-h-[260px] overflow-y-auto pr-1">
											{#each materialSummaryList as mat}
												<div class="p-2.5 rounded-xl bg-gray-50/70 dark:bg-slate-800/50 border border-gray-100 dark:border-slate-800 text-xs space-y-1.5">
													<div class="flex items-center justify-between">
														<strong class="text-gray-800 dark:text-slate-200 font-semibold truncate">{mat.name}</strong>
														{#if mat.isLow}
															<span class="text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300">
																⚠️ Menipis
															</span>
														{/if}
													</div>
													<div class="flex justify-between text-[11px] text-gray-500 dark:text-slate-400">
														<span>Terpakai: <strong class="text-gray-700 dark:text-slate-300">{mat.used.toFixed(1)} {mat.unit}</strong></span>
														<span>Sisa: <strong class="{mat.isLow ? 'text-red-600 font-bold' : 'text-emerald-600'}">{mat.remaining.toFixed(1)} {mat.unit}</strong></span>
													</div>
													<div class="w-full bg-gray-200 dark:bg-slate-700 rounded-full h-1.5 overflow-hidden">
														<div
															class="h-1.5 rounded-full {mat.isLow ? 'bg-red-500' : 'bg-emerald-500'} transition-all"
															style="width: {mat.usagePct}%"
														></div>
													</div>
												</div>
											{/each}
										</div>
									{/if}
								</div>

								<button
									type="button"
									class="btn-action w-full justify-center mt-3 text-[11px] font-bold"
									onclick={() => activeTab = 'material'}
								>
									<IconPlus size={14} /> Catat Penggunaan Material Hari Ini
								</button>
							</div>
						</div>

						<!-- 4. TWO-COLUMN LAYOUT: EQUIPMENT (P2H) & FIELD BUDGET -->
						<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
							<!-- EQUIPMENT & P2H SUMMARY -->
							<div class="card-section flex flex-col justify-between">
								<div>
									<div class="flex items-center justify-between pb-2.5 border-b border-gray-100 dark:border-slate-800 mb-3">
										<h4 class="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white m-0">
											<IconTool size={16} class="text-amber-500" />
											<span>Kesiapan Alat & P2H Lapangan</span>
										</h4>
										<button
											type="button"
											class="text-[11px] font-semibold text-amber-600 dark:text-amber-400 hover:underline flex items-center gap-0.5 cursor-pointer"
											onclick={() => activeTab = 'peralatan'}
										>
											Buka Tab Alat ➔
										</button>
									</div>

									{#if projectEquipmentP2h.length === 0}
										<p class="text-xs text-gray-400 text-center py-6">Tidak ada alat pinjaman aktif yang ditugaskan di proyek ini.</p>
									{:else}
										<div class="space-y-2 max-h-[220px] overflow-y-auto pr-1 divide-y divide-gray-50 dark:divide-slate-800">
											{#each projectEquipmentP2h as eq}
												<div class="pt-2 flex items-center justify-between text-xs">
													<div>
														<p class="font-bold text-gray-800 dark:text-slate-200 m-0">{eq.name}</p>
														{#if eq.operatorName}<p class="text-[10.5px] text-gray-400 m-0">Operator: {eq.operatorName}</p>{/if}
													</div>
													{#if !eq.hasSession}
														<span class="text-[10px] font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400">
															Belum P2H
														</span>
													{:else if eq.result === 'Go'}
														<span class="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
															✓ Go (Siap)
														</span>
													{:else}
														<span class="text-[10px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
															🚨 No-Go
														</span>
													{/if}
												</div>
											{/each}
										</div>
									{/if}
								</div>

								<button
									type="button"
									class="btn-action w-full justify-center mt-3 text-[11px] font-bold"
									onclick={() => activeTab = 'peralatan'}
								>
									<IconTool size={14} /> Lihat Detail Checklist Alat
								</button>
							</div>

							<!-- FIELD EXPENSES / KAS LAPANGAN -->
							<div class="card-section flex flex-col justify-between">
								<div>
									<div class="flex items-center justify-between pb-2.5 border-b border-gray-100 dark:border-slate-800 mb-3">
										<h4 class="flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white m-0">
											<IconWallet size={16} class="text-violet-500" />
											<span>Kas Proyek & Reimbursement</span>
										</h4>
										<button
											type="button"
											class="text-[11px] font-semibold text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-0.5 cursor-pointer"
											onclick={() => activeTab = 'keuangan'}
										>
											Input Nota ➔
										</button>
									</div>

									<div class="space-y-2.5 mb-3">
										<div class="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-slate-800/60 border border-gray-100 dark:border-slate-800 text-xs">
											<span class="text-gray-600 dark:text-slate-300">Total Pengeluaran Dilaporkan:</span>
											<strong class="text-sm font-bold text-gray-900 dark:text-white">{formatRupiah(cumulativeFinancialMetrics.totalCumulativeSpent)}</strong>
										</div>
										<div class="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-slate-800/60 border border-gray-100 dark:border-slate-800 text-xs">
											<span class="text-gray-600 dark:text-slate-300">Total Klaim Reimburse:</span>
											<strong class="text-sm font-bold text-amber-600 dark:text-amber-400">{formatRupiah(cumulativeFinancialMetrics.totalReimburseClaims)}</strong>
										</div>
										<div class="flex items-center justify-between p-2.5 rounded-xl bg-gray-50 dark:bg-slate-800/60 border border-gray-100 dark:border-slate-800 text-xs">
											<span class="text-gray-600 dark:text-slate-300">Sisa Plafon Kas Proyek:</span>
											<strong class="text-sm font-bold text-emerald-600 dark:text-emerald-400">{formatRupiah(Math.max(0, totalAvailableBudgetPool - totalBudgetExpenseToday))}</strong>
										</div>
									</div>
								</div>

								<button
									type="button"
									class="btn-action w-full justify-center text-[11px] font-bold"
									onclick={() => activeTab = 'keuangan'}
								>
									<IconPlus size={14} /> Catat Transaksi Pengeluaran / Reimburse
								</button>
							</div>
						</div>

						<!-- 5. QUICK NAVIGATION JUMP BAR -->
						<div class="p-4 rounded-2xl bg-white dark:bg-slate-850 border border-gray-200/80 dark:border-slate-800 shadow-2xs">
							<h5 class="text-xs font-bold text-gray-800 dark:text-slate-200 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
								<IconSparkles size={14} class="text-amber-500" />
								<span>Navigasi Cepat Pengisian Laporan Hari Ini</span>
							</h5>
							<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
								<button
									type="button"
									class="p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50/70 dark:bg-slate-800 hover:bg-gray-100 text-left transition-all active:scale-95 cursor-pointer flex flex-col items-center justify-center gap-1 text-center"
									onclick={() => activeTab = 'jadwal'}
								>
									<IconCalendarTime size={18} class="text-blue-500" />
									<span class="text-[11px] font-bold text-gray-800 dark:text-slate-200">1. Jadwal</span>
								</button>
								<button
									type="button"
									class="p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50/70 dark:bg-slate-800 hover:bg-gray-100 text-left transition-all active:scale-95 cursor-pointer flex flex-col items-center justify-center gap-1 text-center"
									onclick={() => activeTab = 'progress'}
								>
									<IconChartLine size={18} class="text-emerald-500" />
									<span class="text-[11px] font-bold text-gray-800 dark:text-slate-200">2. Progress</span>
								</button>
								<button
									type="button"
									class="p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50/70 dark:bg-slate-800 hover:bg-gray-100 text-left transition-all active:scale-95 cursor-pointer flex flex-col items-center justify-center gap-1 text-center"
									onclick={() => activeTab = 'material'}
								>
									<IconPackage size={18} class="text-amber-500" />
									<span class="text-[11px] font-bold text-gray-800 dark:text-slate-200">3. Material</span>
								</button>
								<button
									type="button"
									class="p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50/70 dark:bg-slate-800 hover:bg-gray-100 text-left transition-all active:scale-95 cursor-pointer flex flex-col items-center justify-center gap-1 text-center"
									onclick={() => activeTab = 'tenaga'}
								>
									<IconUsers size={18} class="text-indigo-500" />
									<span class="text-[11px] font-bold text-gray-800 dark:text-slate-200">4. Tenaga</span>
								</button>
								<button
									type="button"
									class="p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50/70 dark:bg-slate-800 hover:bg-gray-100 text-left transition-all active:scale-95 cursor-pointer flex flex-col items-center justify-center gap-1 text-center"
									onclick={() => activeTab = 'peralatan'}
								>
									<IconTool size={18} class="text-orange-500" />
									<span class="text-[11px] font-bold text-gray-800 dark:text-slate-200">5. Peralatan</span>
								</button>
								<button
									type="button"
									class="p-2.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50/70 dark:bg-slate-800 hover:bg-gray-100 text-left transition-all active:scale-95 cursor-pointer flex flex-col items-center justify-center gap-1 text-center"
									onclick={() => activeTab = 'keuangan'}
								>
									<IconWallet size={18} class="text-violet-500" />
									<span class="text-[11px] font-bold text-gray-800 dark:text-slate-200">6. Keuangan</span>
								</button>
							</div>
						</div>
					</div>
				{/if}
			{#if activeTab === 'jadwal'}
				<!-- Jadwal kegiatan -->
				<div class="card-section">
					<!-- Header with Title & Live Stats -->
					<div class="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
						<div>
							<h4 class="flex items-center gap-2 text-base font-bold text-slate-800 dark:text-slate-100">
								<IconCalendarTime size={18} class="text-[var(--g)]" />
								<span>Jadwal Kegiatan Harian</span>
								<span style="color: var(--re)">*</span>
							</h4>
							<p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
								Catat rincian aktivitas pekerjaan lapangan per rentang waktu jam kerja.
							</p>
						</div>

						<!-- Mini Stats Dashboard -->
						<div class="flex flex-wrap items-center gap-2 bg-slate-50 dark:bg-slate-800/60 p-1.5 sm:p-2 rounded-xl border border-slate-200/80 dark:border-slate-700/80 text-[11px]">
							<div class="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xs">
								<IconClock size={13} class="text-blue-500" />
								<span class="font-semibold text-slate-700 dark:text-slate-200">Terisi: <strong>{scheduleStats.hours} Jam</strong> ({scheduleStats.filled} slot)</span>
							</div>
							<div class="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-700 dark:text-emerald-300">
								<IconCheck size={12} />
								<span class="font-bold">{scheduleStats.complete} Selesai</span>
							</div>
							{#if scheduleStats.onProgress > 0}
								<div class="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800/60 text-blue-700 dark:text-blue-300">
									<IconBolt size={12} />
									<span class="font-bold">{scheduleStats.onProgress} Proses</span>
								</div>
							{/if}
							{#if scheduleStats.pending > 0}
								<div class="flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-700 dark:text-amber-300">
									<IconCircleDashed size={12} />
									<span class="font-bold">{scheduleStats.pending} Pending</span>
								</div>
							{/if}
						</div>
					</div>

					{#if isLocked}
						<!-- VIEW MODE: Sleek Vertical Timeline -->
						{#if scheduleStats.filled === 0}
							<div class="py-10 text-center flex flex-col items-center justify-center text-slate-400">
								<IconCalendarTime size={36} class="opacity-30 mb-2" />
								<p class="text-xs font-medium">Tidak ada jadwal kegiatan yang dicatat.</p>
							</div>
						{:else}
							<div class="py-4 relative pl-4 before:absolute before:top-4 before:bottom-4 before:left-[19px] before:w-[2px] before:bg-slate-200 dark:before:bg-slate-700 space-y-4">
								{#each reportData.schedule as item}
									{#if item.activity && item.activity.trim()}
										<div class="relative flex items-start gap-3.5 group">
											<!-- Node Dot -->
											<div class="relative z-10 w-3 h-3 rounded-full mt-1.5 shrink-0 ring-4 ring-white dark:ring-slate-900 
												{item.status === 'complete' ? 'bg-emerald-500' : item.status === 'on-progress' ? 'bg-blue-500 animate-pulse' : 'bg-amber-500'}">
											</div>

											<!-- Card Content -->
											<div class="flex-1 bg-white dark:bg-slate-800/80 p-3 rounded-xl border border-slate-200 dark:border-slate-700 shadow-2xs hover:border-slate-300 dark:hover:border-slate-600 transition-colors">
												<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5">
													<div class="flex items-center gap-2 flex-wrap">
														<span class="text-[11px] font-mono font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
															{item.start_time || '--:--'} – {item.end_time || '--:--'}
														</span>
														{#if isCurrentHourSlot(item.start_time, item.end_time)}
															<span class="text-[9px] px-1.5 py-0.5 rounded-full font-bold bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-200 animate-pulse">
																● Sekarang
															</span>
														{/if}
													</div>
													<span class="text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 self-start sm:self-auto
														{item.status === 'complete' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 
														 item.status === 'on-progress' ? 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' : 
														 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'}">
														{item.status === 'complete' ? '✓ Selesai' : item.status === 'on-progress' ? '⚡ Dalam Proses' : '⏳ Pending'}
													</span>
												</div>
												<p class="text-xs font-semibold text-slate-800 dark:text-slate-100 mt-1.5 leading-relaxed">
													{item.activity}
												</p>
											</div>
										</div>
									{/if}
								{/each}
							</div>
						{/if}
					{:else}
						<!-- EDIT MODE -->
						<!-- Smart Presets & Quick Tools Bar -->
						<div class="flex flex-col gap-2.5 pt-2 pb-1">
							<!-- Action Buttons Row -->
							<div class="flex flex-wrap items-center justify-between gap-2">
								<!-- Presets Group -->
								<div class="flex flex-wrap items-center gap-1.5">
									<span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400 mr-1 flex items-center gap-1">
										<IconSparkles size={13} class="text-amber-500" /> Preset Cepat:
									</span>
									<button
										type="button"
										class="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors flex items-center gap-1 shadow-2xs active:scale-95"
										onclick={applyStandardShift}
										title="Isi otomatis jadwal kerja standar (08:00 - 17:00)"
									>
										<IconSun size={12} /> Shift Standar (08:00-17:00)
									</button>
									<button
										type="button"
										class="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900 transition-colors flex items-center gap-1 shadow-2xs active:scale-95"
										onclick={applyOvertimeShift}
										title="Isi otomatis jadwal lembur (17:00 - 22:00)"
									>
										<IconMoon size={12} /> Shift Lembur (17:00-22:00)
									</button>
									{#if availableSubtasks.length > 0 || reportData.progress.some(p => p.activity || p.subtask_id)}
										<button
											type="button"
											class="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors flex items-center gap-1 shadow-2xs active:scale-95"
											onclick={importFromProgressTab}
											title="Otomatis salin subtask dari tab Progress ke slot jadwal"
										>
											<IconCopy size={12} /> Salin dari Tab Progress
										</button>
									{/if}
								</div>

								<!-- Secondary Quick Actions -->
								<div class="flex items-center gap-1.5">
									<button
										type="button"
										class="text-[11px] font-semibold px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-750 transition-colors flex items-center gap-1 shadow-2xs"
										onclick={markAllFilledComplete}
										title="Tandai semua slot yang terisi menjadi Selesai"
									>
										<IconCircleCheck size={12} class="text-emerald-600" /> Tandai Selesai
									</button>
									<button
										type="button"
										class="text-[11px] font-semibold px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors flex items-center gap-1 shadow-2xs"
										onclick={clearAllScheduleSlots}
										title="Bersihkan semua kegiatan di jadwal"
									>
										<IconEraser size={12} /> Reset
									</button>
								</div>
							</div>

							<!-- View Filter & Info Banner -->
							<div class="flex flex-wrap items-center justify-between gap-2 p-2 rounded-xl bg-slate-100/70 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/60">
								<!-- Filter Segmented Control -->
								<div class="flex items-center gap-1 bg-white dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700">
									<button
										type="button"
										class="text-[11px] font-semibold px-2.5 py-1 rounded-md transition-all {scheduleFilterMode === 'workhours' ? 'bg-[var(--g)] text-white shadow-xs' : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'}"
										onclick={() => scheduleFilterMode = 'workhours'}
									>
										🌟 Jam Kerja Utama (07:00 - 18:00)
									</button>
									<button
										type="button"
										class="text-[11px] font-semibold px-2.5 py-1 rounded-md transition-all {scheduleFilterMode === 'filled' ? 'bg-[var(--g)] text-white shadow-xs' : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'}"
										onclick={() => scheduleFilterMode = 'filled'}
									>
										📑 Hanya Terisi ({scheduleStats.filled})
									</button>
									<button
										type="button"
										class="text-[11px] font-semibold px-2.5 py-1 rounded-md transition-all {scheduleFilterMode === 'all' ? 'bg-[var(--g)] text-white shadow-xs' : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'}"
										onclick={() => scheduleFilterMode = 'all'}
									>
										🌐 Semua 24 Jam
									</button>
								</div>

								<!-- Quick Guide Hint -->
								<span class="text-[11px] text-slate-500 dark:text-slate-400">
									💡 <em>Klik input untuk memunculkan chip saran cepat</em>
								</span>
							</div>
						</div>

						<!-- Slot Schedule Rows -->
						<div class="space-y-2.5 mt-2">
							{#each reportData.schedule as item, i}
								{#if shouldShowScheduleSlot(item, scheduleFilterMode)}
									{#if isDefaultSlot(item)}
										<!-- Standard 1-Hour Slot Row -->
										<div class="flex flex-col sm:flex-row sm:items-center gap-2 p-2.5 rounded-xl border transition-all relative
											{item.status === 'complete' && item.activity ? 'border-emerald-300/80 bg-emerald-50/20 dark:border-emerald-900/60 dark:bg-emerald-950/10' :
											 item.status === 'on-progress' && item.activity ? 'border-blue-300/80 bg-blue-50/20 dark:border-blue-900/60 dark:bg-blue-950/10' :
											 item.activity ? 'border-amber-300/80 bg-amber-50/20 dark:border-amber-900/60 dark:bg-amber-950/10' :
											 'border-slate-200 dark:border-slate-750 bg-white dark:bg-slate-850 hover:border-slate-300 dark:hover:border-slate-700'}">
											
											<!-- Time Pill -->
											<div class="w-full sm:w-32 shrink-0 flex items-center justify-between sm:justify-start gap-1.5">
												<span class="text-xs font-mono font-bold px-2.5 py-1 rounded-lg inline-block w-full text-center border shadow-2xs
													{isCurrentHourSlot(item.start_time, item.end_time) ? 'bg-blue-600 text-white border-blue-600 ring-2 ring-blue-400/30' :
													 item.activity ? 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-100 border-slate-200 dark:border-slate-600' :
													 'bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-700'}">
													{item.start_time} - {item.end_time}
												</span>
											</div>

											<!-- Activity Input with Clear button & Quick Chips -->
											<div class="flex-1 relative">
												<div class="relative flex items-center">
													<input
														type="text"
														bind:value={item.activity}
														class="f-input pr-8"
														placeholder="Isi kegiatan (mis. Safety briefing, Pengecatan, Ishoma)..."
														style="margin: 0;"
														onfocus={() => activeSlotSuggestionsIndex = i}
													/>
													{#if item.activity}
														<button
															type="button"
															class="absolute right-2 text-slate-400 hover:text-red-500 p-0.5 rounded transition-colors"
															onclick={() => { item.activity = ''; }}
															title="Hapus teks"
														>
															<IconX size={14} />
														</button>
													{/if}
												</div>

												<!-- Quick Suggestions Chips dropdown when active -->
												{#if activeSlotSuggestionsIndex === i}
													<div class="mt-1.5 p-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-md flex flex-wrap items-center gap-1.5 z-10" transition:slide={{ duration: 150 }}>
														<span class="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mr-1">Saran:</span>
														{#each QUICK_ACTIVITY_SUGGESTIONS as sug}
															<button
																type="button"
																class="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-100 hover:bg-blue-100 dark:bg-slate-700 dark:hover:bg-blue-900/60 text-slate-700 dark:text-slate-200 hover:text-blue-700 dark:hover:text-blue-300 transition-colors"
																onclick={() => setSlotActivity(i, sug.text)}
															>
																{sug.label}
															</button>
														{/each}
														{#if availableSubtasks.length > 0}
															<span class="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mx-1">Subtask:</span>
															{#each availableSubtasks.slice(0, 4) as sub}
																<button
																	type="button"
																	class="text-[10px] font-medium px-2 py-0.5 rounded-md bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/80 text-emerald-800 dark:text-emerald-200 transition-colors truncate max-w-[150px]"
																	onclick={() => setSlotActivity(i, sub.name)}
																	title={sub.name}
																>
																	📋 {sub.name}
																</button>
															{/each}
														{/if}
														<button
															type="button"
															class="text-[10px] font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 ml-auto px-1.5 py-0.5"
															onclick={() => activeSlotSuggestionsIndex = null}
														>
															Tutup ✕
														</button>
													</div>
												{/if}
											</div>

											<!-- 1-Click Segmented Status Buttons -->
											<div class="w-full sm:w-auto shrink-0 flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
												<button
													type="button"
													class="flex-1 sm:flex-none text-[11px] font-semibold px-2 py-1 rounded-md transition-all flex items-center justify-center gap-1
														{item.status === 'complete' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-emerald-600'}"
													onclick={() => { item.status = 'complete'; vibrateTap(); }}
													title="Selesai"
												>
													<IconCheck size={12} /> Selesai
												</button>
												<button
													type="button"
													class="flex-1 sm:flex-none text-[11px] font-semibold px-2 py-1 rounded-md transition-all flex items-center justify-center gap-1
														{item.status === 'on-progress' ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-blue-600'}"
													onclick={() => { item.status = 'on-progress'; vibrateTap(); }}
													title="Dalam Proses"
												>
													<IconBolt size={12} /> Proses
												</button>
												<button
													type="button"
													class="flex-1 sm:flex-none text-[11px] font-semibold px-2 py-1 rounded-md transition-all flex items-center justify-center gap-1
														{item.status === 'pending' ? 'bg-amber-600 text-white shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-amber-600'}"
													onclick={() => { item.status = 'pending'; vibrateTap(); }}
													title="Pending / Belum Mulai"
												>
													<IconCircleDashed size={12} /> Pending
												</button>
											</div>
										</div>
									{:else}
										<!-- Custom Slot Card -->
										<div class="border-2 border-dashed border-amber-300 dark:border-amber-700/60 bg-amber-50/30 dark:bg-amber-950/20 rounded-xl p-3.5 relative shadow-xs">
											<div class="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-amber-200 dark:border-amber-800/50">
												<div class="flex items-center gap-1.5 text-xs font-bold text-amber-800 dark:text-amber-300">
													<IconClock size={14} />
													<span>Jadwal Kustom / Fleksibel</span>
												</div>
												<button
													type="button"
													class="text-slate-400 hover:text-red-600 p-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors flex items-center gap-1 text-[11px] font-semibold"
													onclick={() => removeSchedule(i)}
												>
													<IconTrash size={14} /> Hapus
												</button>
											</div>

											<div class="grid grid-cols-1 md:grid-cols-3 gap-2.5">
												<div class="md:col-span-2">
													<label class="f-label text-[11px]">Nama Aktivitas <span style="color: var(--re)">*</span></label>
													<input type="text" bind:value={item.activity} class="f-input" placeholder="Mis. Pengecoran malam, loading semen...">
												</div>
												<div>
													<label class="f-label text-[11px]">Status <span style="color: var(--re)">*</span></label>
													<div class="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700">
														<button
															type="button"
															class="flex-1 text-[10px] font-semibold py-1 rounded transition-all {item.status === 'complete' ? 'bg-emerald-600 text-white' : 'text-slate-600 dark:text-slate-400'}"
															onclick={() => item.status = 'complete'}
														>
															Selesai
														</button>
														<button
															type="button"
															class="flex-1 text-[10px] font-semibold py-1 rounded transition-all {item.status === 'on-progress' ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-400'}"
															onclick={() => item.status = 'on-progress'}
														>
															Proses
														</button>
														<button
															type="button"
															class="flex-1 text-[10px] font-semibold py-1 rounded transition-all {item.status === 'pending' ? 'bg-amber-600 text-white' : 'text-slate-600 dark:text-slate-400'}"
															onclick={() => item.status = 'pending'}
														>
															Pending
														</button>
													</div>
												</div>
											</div>

											<div class="grid grid-cols-2 gap-2.5 mt-2">
												<div>
													<label class="f-label text-[11px]">Jam Mulai <span style="color: var(--re)">*</span></label>
													<input type="time" bind:value={item.start_time} class="f-input">
												</div>
												<div>
													<label class="f-label text-[11px]">Jam Selesai <span style="color: var(--re)">*</span></label>
													<input type="time" bind:value={item.end_time} class="f-input">
												</div>
											</div>
										</div>
									{/if}
								{/if}
							{/each}
						</div>

						<!-- Add Custom Schedule Button -->
						<div class="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
							<button type="button" class="btn-action flex items-center gap-1.5 text-xs font-semibold" onclick={addSchedule}>
								<IconPlus size={15} /> Tambah Jadwal Kustom
							</button>
							<span class="text-[11px] text-slate-400">
								{scheduleStats.filled} dari {reportData.schedule.length} slot terisi
							</span>
						</div>
					{/if}
				</div>

				<!-- Rencana besok -->
				<div class="card-section">
					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
						<div>
							<h4 class="flex items-center gap-2 text-base font-bold text-slate-800 dark:text-slate-100">
								<IconListCheck size={18} class="text-[var(--g)]" />
								<span>Rencana Kerja Besok</span>
								<span style="color: var(--re)">*</span>
							</h4>
							<p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
								Target dan kesiapan aktivitas yang akan dikerjakan pada hari kerja berikutnya.
							</p>
						</div>
						{#if !isLocked && availableSubtasks.length > 0}
							<span class="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
								<IconBulb size={13} /> Pilih dari subtask proyek di bawah
							</span>
						{/if}
					</div>

					{#if isLocked}
						<!-- VIEW MODE -->
						{#if reportData.tomorrow_plan.length === 0 || (reportData.tomorrow_plan.length === 1 && !reportData.tomorrow_plan[0].activity && !reportData.tomorrow_plan[0].description)}
							<p class="text-[12px] text-gray-400 text-center py-4">Tidak ada rencana besok yang dicatat.</p>
						{:else}
							<div class="divide-y divide-slate-100 dark:divide-slate-800">
								{#each reportData.tomorrow_plan as item, i}
									{#if item.activity || item.description}
										<div class="py-3 flex items-start gap-3">
											<span class="w-6 h-6 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
												{i + 1}
											</span>
											<div class="flex-1">
												{#if item.description}
													<p class="text-[13px] font-bold text-slate-800 dark:text-slate-100">{item.description}</p>
												{/if}
												{#if item.activity}
													<p class="text-[12px] text-slate-600 dark:text-slate-300 mt-0.5">{item.activity}</p>
												{/if}
												{#if item.notes}
													<p class="text-[11px] text-slate-400 italic mt-1 bg-slate-50 dark:bg-slate-800/50 p-1.5 rounded-md">
														💬 Catatan: {item.notes}
													</p>
												{/if}
											</div>
										</div>
									{/if}
								{/each}
							</div>
						{/if}
					{:else}
						<!-- EDIT MODE -->
						<!-- Suggestions from timeline subtasks -->
						{#if availableSubtasks.length > 0}
							<div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 my-2">
								<span class="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1.5">
									💡 Rekomendasi Subtask Proyek untuk Rencana Besok:
								</span>
								<div class="flex flex-wrap items-center gap-1.5">
									{#each availableSubtasks as sub}
										<button
											type="button"
											class="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/60 text-slate-700 dark:text-slate-200 hover:text-emerald-700 dark:hover:text-emerald-300 border border-slate-200 dark:border-slate-700 hover:border-emerald-300 transition-colors shadow-2xs flex items-center gap-1"
											onclick={() => addSubtaskToTomorrowPlan(sub.name)}
										>
											<IconPlus size={11} /> {sub.name}
										</button>
									{/each}
								</div>
							</div>
						{/if}

						<div class="space-y-3 mt-2">
							{#each reportData.tomorrow_plan as item, i}
								<div class="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-850 shadow-2xs relative">
									<div class="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-100 dark:border-slate-800">
										<span class="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
											<span class="w-5 h-5 rounded-full bg-[var(--g)] text-white text-[10px] flex items-center justify-center font-bold">
												{i + 1}
											</span>
											Rencana Item #{i + 1}
										</span>
										{#if reportData.tomorrow_plan.length > 1}
											<button
												type="button"
												class="text-slate-400 hover:text-red-500 p-1 rounded transition-colors"
												onclick={() => removeTomorrowPlan(i)}
												title="Hapus rencana ini"
											>
												<IconTrash size={14} />
											</button>
										{/if}
									</div>

									<div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
										<div>
											<label class="f-label text-[11px]">Judul / Subtask Rencana <span style="color: var(--re)">*</span></label>
											<input type="text" bind:value={item.description} class="f-input" placeholder="Mis. Finishing pengecatan lantai, instalasi pipa...">
										</div>
										<div>
											<label class="f-label text-[11px]">Detail Aktivitas <span style="color: var(--re)">*</span></label>
											<input type="text" bind:value={item.activity} class="f-input" placeholder="Mis. Area timur & pengetesan ketebalan...">
										</div>
									</div>
									<div class="mt-2">
										<label class="f-label text-[11px]">Catatan / Kebutuhan Khusus (Opsional)</label>
										<textarea bind:value={item.notes} rows="1" class="f-textarea" placeholder="Mis. Membutuhkan tambahan 2 pekerja lembur dan 3 kaleng epoxy..."></textarea>
									</div>
								</div>
							{/each}
						</div>

						<div class="mt-3 pt-2">
							<button type="button" class="btn-action flex items-center gap-1.5 text-xs font-semibold" onclick={addTomorrowPlan}>
								<IconPlus size={15} /> Tambah Rencana Lain
							</button>
						</div>
					{/if}
				</div>
			{/if}

			{#if activeTab === 'progress'}
				{#if qcAmbientApplicable}
					<!-- Fase 2 Laporan Lapangan & Paritas ERP (16 Okt 2026) — Kondisi Ambient & QC, auto-pull modul Inspection -->
					<div class="card-section mb-4">
						<div class="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
							<h4 class="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
								<IconGauge size={16} class="text-[var(--g)]" />
								<span>Kondisi Ambient & QC</span>
							</h4>
							<span class="text-[10px] px-2 py-0.5 rounded-full font-semibold {qcAmbientFilledToday ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'}">
								{loadingInspectionSummary ? '...' : (qcAmbientFilledToday ? '✓ Terbaca hari ini' : 'Belum diperbarui hari ini')}
							</span>
						</div>
						{#if inspectionSummary}
							<div class="grid grid-cols-2 md:grid-cols-4 gap-2.5 pt-3">
								<div class="rounded-xl border p-2.5 border-slate-200 bg-slate-50 dark:bg-slate-800/60 dark:border-slate-700">
									<p class="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Steel Temp / RH%</p>
									<p class="text-[13px] font-bold text-slate-700 dark:text-slate-200">{inspectionSummary.steelTemp ?? '-'}°C / {inspectionSummary.rhPct ?? '-'}%</p>
								</div>
								<div class="rounded-xl border p-2.5 {inspectionSummary.holdPointFlag ? 'border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800' : 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800'}">
									<p class="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Dew Point Gap (ΔT ≥ 3°C)</p>
									<p class="text-[13px] font-bold {inspectionSummary.holdPointFlag ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}">
										{inspectionSummary.dewPoint ?? '-'}°C {inspectionSummary.holdPointFlag ? '⚠️ Hold Point' : '✓ Aman'}
									</p>
								</div>
								<div class="rounded-xl border p-2.5 border-slate-200 bg-slate-50 dark:bg-slate-800/60 dark:border-slate-700">
									<p class="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Rata-rata DFT</p>
									<p class="text-[13px] font-bold text-slate-700 dark:text-slate-200">{inspectionSummary.avgDft != null ? `${inspectionSummary.avgDft} µm` : '-'}</p>
								</div>
								<div class="rounded-xl border p-2.5 border-slate-200 bg-slate-50 dark:bg-slate-800/60 dark:border-slate-700">
									<p class="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Diukur</p>
									<p class="text-[13px] font-bold text-slate-700 dark:text-slate-200">{inspectionSummary.measuredAt ? inspectionSummary.measuredAt.slice(0, 10) : '-'}</p>
								</div>
							</div>
						{:else if !loadingInspectionSummary}
							<p class="text-[12px] text-slate-400 py-3">Belum ada data Inspeksi (Ambient/DFT) untuk proyek ini — isi di menu Inspection.</p>
						{/if}
						<p class="text-[10px] text-slate-400 mt-2">Diambil otomatis dari modul Inspection (Suhu, RH%, Dew Point, DFT) — bukan input manual di sini. Hanya tampil untuk proyek kategori Sandblasting/Coating.</p>
					</div>
				{/if}

				<!-- Ringkasan Progres Proyek (Executive Project Progress Card) -->
				<div class="card-section mb-4 overflow-hidden border border-emerald-500/20 bg-gradient-to-br from-emerald-950/10 via-slate-900/40 to-slate-900/60 shadow-sm" style="background: var(--sys-fill)">
					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-200/50 dark:border-slate-800">
						<div class="flex items-center gap-2">
							<div class="w-8 h-8 rounded-lg bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
								<IconTrendingUp size={18} />
							</div>
							<div>
								<h4 class="text-[14px] font-bold text-gray-900 dark:text-white m-0 flex items-center gap-1.5" style="color: var(--sys-label)">
									Ringkasan Progres Proyek
								</h4>
								<p class="text-[11px] text-gray-500 dark:text-slate-400 m-0" style="color: var(--sys-label3)">
									Akumulasi seluruh laporan harian vs Target Perencanaan
								</p>
							</div>
						</div>
						<div class="flex items-center gap-2 self-start sm:self-auto">
							<span class="text-xs font-bold px-3 py-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
								{projectProgressOverview.overallPct}% Tercapai
							</span>
						</div>
					</div>

					<!-- Visual Project Progress Bar (Dual Segments) -->
					<div class="mt-3.5 space-y-1.5">
						<div class="flex justify-between text-[11px] font-semibold text-gray-600 dark:text-slate-300">
							<span class="flex items-center gap-1.5">
								<span class="w-2.5 h-2.5 rounded-sm bg-sky-500 inline-block"></span>
								Realisasi Lalu: {projectProgressOverview.prevTotalVolume} vol ({projectProgressOverview.prevPct}%)
							</span>
							{#if projectProgressOverview.todayTotalVolume > 0}
								<span class="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
									<span class="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block animate-pulse"></span>
									Hari Ini: +{projectProgressOverview.todayTotalVolume} vol (+{projectProgressOverview.todayDeltaPct}%)
								</span>
							{/if}
						</div>
						<div class="w-full h-3.5 bg-gray-200 dark:bg-slate-800 rounded-full overflow-hidden flex p-0.5 border border-gray-200 dark:border-slate-700">
							<div 
								class="h-full bg-sky-500 rounded-l-full transition-all duration-300"
								style="width: {projectProgressOverview.prevPct}%"
								title="Selesai Sebelumnya: {projectProgressOverview.prevTotalVolume} vol ({projectProgressOverview.prevPct}%)"
							></div>
							{#if projectProgressOverview.todayTotalVolume > 0}
								<div 
									class="h-full bg-emerald-500 rounded-r-full transition-all duration-300"
									style="width: {projectProgressOverview.todayDeltaPct}%"
									title="Input Hari Ini: +{projectProgressOverview.todayTotalVolume} vol (+{projectProgressOverview.todayDeltaPct}%)"
								></div>
							{/if}
						</div>
					</div>

					<!-- Metrik Ringkas Proyek -->
					<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3.5 pt-3 border-t border-gray-200/50 dark:border-slate-800 text-[11px]">
						<div class="p-2 rounded-lg bg-gray-50/80 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-800">
							<span class="text-gray-400 dark:text-slate-500 block mb-0.5">Target Perencanaan</span>
							<strong class="text-[13px] text-gray-800 dark:text-slate-200">
								{projectProgressOverview.targetProgress ? `${projectProgressOverview.targetProgress} vol` : '-'}
							</strong>
						</div>
						<div class="p-2 rounded-lg bg-gray-50/80 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-800">
							<span class="text-gray-400 dark:text-slate-500 block mb-0.5">Total Realisasi Lalu</span>
							<strong class="text-[13px] text-sky-600 dark:text-sky-400">
								{projectProgressOverview.prevTotalVolume} vol
							</strong>
						</div>
						<div class="p-2 rounded-lg bg-gray-50/80 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-800">
							<span class="text-gray-400 dark:text-slate-500 block mb-0.5">Laporan Hari Ini</span>
							<strong class="text-[13px] text-emerald-600 dark:text-emerald-400">
								+{projectProgressOverview.todayTotalVolume} vol
							</strong>
						</div>
						<div class="p-2 rounded-lg bg-gray-50/80 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-800">
							<span class="text-gray-400 dark:text-slate-500 block mb-0.5">Total Kumulatif Baru</span>
							<strong class="text-[13px] text-gray-900 dark:text-white">
								{projectProgressOverview.cumulativeTotal} vol ({projectProgressOverview.overallPct}%)
							</strong>
						</div>
					</div>
				</div>

				<!-- Target Harian (dari Kurva S) -->
				{#if dailyTargetRows.length > 0}
					<div class="card-section mb-4 border border-sky-500/20" style="background: var(--sys-fill)">
						<h4 class="m-0 text-[13px] font-bold flex items-center gap-1.5" style="color: var(--sys-label)">
							Target Hari Ini
							<span class="text-[11px] font-normal" style="color: var(--sys-label3)" title="Target diambil dari rencana harian (Kurva S) di Timeline untuk tanggal laporan ini. Realisasi = volume yang Anda isi di form di bawah.">ⓘ</span>
						</h4>
						<div class="mt-2 space-y-2">
							{#each dailyTargetRows as row (row.unit)}
								<div>
									<div class="flex justify-between text-[12px] font-semibold text-gray-700 dark:text-slate-200">
										<span>Target: {row.target} {row.unit} | Realisasi: {row.realisasi} {row.unit}</span>
										<span class={row.pct >= 100 ? 'text-emerald-600 dark:text-emerald-400' : ''}>{row.pct}%</span>
									</div>
									<div class="w-full h-2 bg-gray-200 dark:bg-slate-800 rounded-full overflow-hidden mt-1">
										<div class="h-full rounded-full transition-all duration-300 {row.pct >= 100 ? 'bg-emerald-500' : 'bg-sky-500'}" style="width: {row.pct}%"></div>
									</div>
								</div>
							{/each}
						</div>
						<p class="text-[10px] mt-2 mb-0" style="color: var(--sys-label3)">Isi volume per subtask di bagian "Progress Pekerjaan Hari Ini" untuk menaikkan realisasi.</p>
					</div>
				{/if}

				<!-- Section: Form Progress Pekerjaan -->
				<div class="card-section">
					<div class="flex items-center justify-between mb-3">
						<h4 class="m-0 flex items-center gap-1.5">
							<IconChartLine size={16} class="text-[var(--g)]" /> 
							<span>Progress Pekerjaan Hari Ini</span>
							<span style="color: var(--re)">*</span>
						</h4>
						{#if !isLocked}
							<button 
								type="button" 
								class="text-[11px] font-semibold text-[var(--g)] hover:underline flex items-center gap-1 cursor-pointer"
								onclick={addProgress}
							>
								<IconPlus size={13} /> Tambah baris
							</button>
						{/if}
					</div>

					{#if isLocked}
						<!-- VIEW MODE -->
						{#if reportData.progress.length === 0 || (reportData.progress.length === 1 && !reportData.progress[0].activity && !reportData.progress[0].subtask_id && !reportData.progress[0].category)}
							<p class="text-[12px] text-gray-400 text-center py-3">Tidak ada progress yang dicatat.</p>
						{:else}
							<div class="space-y-3">
								{#each reportData.progress as item}
									{@const calc = getSubtaskCalculation(item)}
									{#if item.activity || item.subtask_id || item.category}
										<div class="p-3.5 rounded-xl border border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-850/50 flex flex-col gap-2.5">
											<div class="flex items-start justify-between gap-2">
												<div class="flex-1 min-w-0">
													<div class="flex items-center gap-2 flex-wrap">
														<p class="text-[13px] font-bold text-gray-900 dark:text-white truncate">
															{item.activity || item.category || '-'}
														</p>
														{#if item.category}
															<span class="text-[10px] px-2 py-0.5 rounded-md bg-gray-200 dark:bg-slate-700 text-gray-700 dark:text-slate-300 font-medium">
																{item.category}
															</span>
														{/if}
													</div>
												</div>
												<div class="text-right shrink-0">
													<span class="text-[14px] font-extrabold text-emerald-600 dark:text-emerald-400">
														+{item.progress_value} <span class="text-[11px] font-medium text-gray-500 dark:text-slate-400">{item.unit}</span>
													</span>
												</div>
											</div>

											{#if calc.target > 0}
												<div class="space-y-1">
													<div class="flex flex-wrap items-center justify-between gap-1 text-[10px] text-gray-500 dark:text-slate-400">
														<span>Realisasi s/d Hari ini: <strong>{calc.total} / {calc.target} {item.unit}</strong> ({calc.totalPct}%)</span>
														{#if (item.daily_target || calc.dailyTarget) > 0}
															<span class="text-sky-600 dark:text-sky-400 font-semibold">🎯 Target Hari Ini: {item.daily_target || calc.dailyTarget} {item.unit}</span>
														{/if}
														<span>Sisa: {calc.remaining} {item.unit}</span>
													</div>
													<div class="w-full h-2 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden flex">
														<div class="h-full bg-sky-500" style="width: {calc.prevPct}%"></div>
														<div class="h-full bg-emerald-500" style="width: {calc.todayPct}%"></div>
													</div>
												</div>
											{/if}

											{#if item.notes}
												<p class="text-[11px] text-gray-600 dark:text-slate-400 italic bg-white dark:bg-slate-900 p-2 rounded-lg border border-gray-100 dark:border-slate-800 m-0">
													Catatan: {item.notes}
												</p>
											{/if}
										</div>
									{/if}
								{/each}
							</div>
						{/if}
					{:else}
						<!-- EDIT MODE -->
						<div class="space-y-4">
							{#each reportData.progress as item, i}
								{@const calc = getSubtaskCalculation(item)}
								<div class="border border-gray-200 dark:border-slate-700/80 bg-white dark:bg-slate-850 rounded-xl p-3.5 shadow-2xs relative space-y-3">
									<div class="flex items-center justify-between gap-2 pb-2 border-b border-gray-100 dark:border-slate-800">
										<div class="flex items-center gap-2">
											<span class="text-[11px] font-bold px-2 py-0.5 rounded-md bg-gray-100 dark:bg-slate-750 text-gray-700 dark:text-slate-300">
												#{i + 1}
											</span>
											{#if item.category}
												<span class="text-[10px] font-medium px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/50 dark:border-emerald-800/40">
													{item.category}
												</span>
											{/if}
											{#if calc.dailyTarget > 0}
												<span class="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200/50 dark:border-sky-800/40 flex items-center gap-1">
													<span>🎯</span> Target Hari Ini: <strong>{calc.dailyTarget} {item.unit}</strong>
												</span>
											{/if}
											{#if calc.totalPct >= 100 && !calc.isOver}
												<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500 text-white flex items-center gap-0.5">
													<IconCheck size={11} /> 100%
												</span>
											{/if}
										</div>

										{#if reportData.progress.length > 1}
											<button 
												type="button"
												class="text-gray-400 hover:text-red-500 dark:hover:text-red-400 p-1 rounded-md transition-colors cursor-pointer" 
												onclick={() => removeProgress(i)}
												title="Hapus baris progress ini"
											>
												<IconTrash size={14} />
											</button>
										{/if}
									</div>

									<!-- Dropdown / Picker Pilih Pekerjaan (Pertajam Search) -->
									<div>
										<label class="f-label">
											Pilih Pekerjaan (Dari Timeline) <span style="color: var(--re)">*</span>
										</label>
										<p class="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5 mb-1.5">
											Pilih pekerjaan (subtask) dari Timeline supaya progres terhitung di grafik proyek.
										</p>
										<SubtaskPicker
											{timelineCategories}
											value={item.is_custom ? '__CUSTOM__' : (item.category_only ? `__CAT__${item.category_id}` : item.subtask_id)}
											{item}
											{getPreviousProgress}
											onSelect={(val) => handleSubtaskSelect(item, val)}
										/>
									</div>

									<!-- Peringatan Disiplin Jadwal: Subtask Belum Dijadwalkan (G_LAPOR_SUBTASK_SCHEDULE) -->
									{#if item.subtask_id && !item.is_custom}
										{@const subtaskObj = findSubtaskById(item.subtask_id)}
										{#if subtaskObj && !hasValidSchedule(subtaskObj)}
											<div class="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/80 text-amber-900 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 shadow-2xs">
												<div class="flex items-start gap-2 min-w-0">
													<IconAlertTriangle size={18} class="shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
													<div class="text-[11.5px] leading-relaxed">
														<span class="font-bold">Pekerjaan ini belum memiliki jadwal di timeline!</span>
														<p class="text-[11px] text-amber-800/80 dark:text-amber-300/80 m-0">
															Jadwal rencana (start/end date & daily plan) masih kosong. Tentukan jadwal cepat agar progres tercatat tertib di Kurva S.
														</p>
													</div>
												</div>
												<button
													type="button"
													class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl bg-amber-500 hover:bg-amber-600 text-white shadow-xs transition-colors shrink-0 cursor-pointer"
													onclick={() => openQuickSchedule(subtaskObj)}
												>
													<IconCalendar size={14} />
													<span>Tentukan Jadwal Cepat</span>
												</button>
											</div>
										{/if}
									{/if}
									
									<!-- Executor Partitioning Fase 3 — info pelaksana per baris (read-only, dari drawer
									     admin). Vendor: form tetap sama (opname), hanya diberi hint manpower/material di
									     bawah biasanya bukan tanggung jawab tim kita. Hanya admin ERP yang boleh menandai
									     prasyarat eksternal "Siap" — lapangan cuma melapor status kesiapan di bawah. -->
									{#if item.executor_type === 'vendor'}
										<div class="p-2.5 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200/60 dark:border-orange-900/40 text-[11px] text-orange-800 dark:text-orange-300 flex items-center gap-1.5">
											<span>🤝</span>
											<span>Pekerjaan ini dikerjakan <strong>Vendor: {item.executor_vendor_name || '-'}</strong> — isi volume opname hasil kerja vendor. Manpower/material di bawah biasanya tidak relevan.</span>
										</div>
									{:else if item.executor_type === 'external_prereq'}
										<div class="p-2.5 rounded-lg bg-slate-100 dark:bg-slate-800/40 border border-slate-300/60 dark:border-slate-700/60 text-[11px] text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
											<span>⏳</span>
											<span>Prasyarat pihak ketiga (<strong>{item.external_party || '-'}</strong>) — di luar scope EPI, bobot progres 0%. Hanya admin ERP yang bisa menandai resmi "Siap"; laporan Anda hanya untuk dokumentasi kondisi.</span>
										</div>
									{/if}

									<!-- R8 v2 (Pertajam Modul Penawaran) — jenis pekerjaan per baris, untuk
									     kalibrasi akurasi estimasi durasi per fase di sisi Admin. -->
									<div>
										<div class="flex items-center justify-between">
											<label class="f-label">Jenis Pekerjaan (untuk analisa estimasi)</label>
											{#if item.service_type}
												<span class="text-[10.5px] font-medium text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/40 px-1.5 py-0.5 rounded border border-sky-200/50 dark:border-sky-800/50">
													✓ {fieldServiceTypeLabel(item.service_type)}
												</span>
											{/if}
										</div>
										<select class="f-select" bind:value={item.service_type}>
											<option value="">— tidak ditandai —</option>
											{#each FIELD_SERVICE_TYPES as st}
												<option value={st.id}>{st.label}</option>
											{/each}
										</select>
										<p class="text-[10.5px] text-gray-400 dark:text-slate-500 mt-1 m-0">
											Membantu Admin membandingkan lama rencana vs aktual per jenis pekerjaan.
										</p>
									</div>

									<!-- Fase 8 (opsional) — Auto-QC Tolerance Checker. Hanya tampil bila subtask yang
									     dipilih punya spek terukur (pola *_target/*_tolerance dari drawer admin, Fase 2).
									     PERINGATAN SAJA — tidak pernah memblokir simpan/kirim laporan (Aturan #6). -->
									{#if !item.is_custom}
										{@const specFields = findMeasurableSpecFields(findSubtaskById(item.subtask_id)?.spec)}
										{#if specFields.length > 0}
											<div class="p-3 rounded-lg bg-sky-50/50 dark:bg-sky-950/20 border border-sky-200/60 dark:border-sky-900/40 space-y-2.5">
												<div class="text-[11px] font-semibold text-sky-800 dark:text-sky-300 flex items-center gap-1.5">
													<IconSparkles size={13} />
													<span>Cek QC — Hasil Ukur vs Spek Teknis (opsional)</span>
												</div>
												{#each specFields as sf (sf.key)}
													{@const measured = item.qc_measured?.[sf.key]}
													{@const result = measured != null && measured !== '' ? checkTolerance(Number(measured), sf.target, sf.tolerance) : null}
													<div>
														<label class="f-label">
															{sf.label} Hasil Ukur {sf.tolerance ? `(target ${sf.tolerance[0]}–${sf.tolerance[1]})` : `(target ${sf.target})`}
														</label>
														<input
															type="number"
															step="0.01"
															class="f-input"
															placeholder="Isi bila sudah diukur…"
															value={measured ?? ''}
															oninput={(e) => {
																if (!item.qc_measured) item.qc_measured = {};
																item.qc_measured[sf.key] = (e.target as HTMLInputElement).value;
															}}
														/>
														{#if result && result.status !== 'tidak_ada_spek'}
															<p class="text-[10.5px] mt-1 m-0 font-semibold {result.status === 'sesuai' ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}">
																{result.status === 'sesuai' ? '✓' : '⚠'} {result.message}
															</p>
														{/if}
													</div>
												{/each}
												<p class="text-[10px] text-sky-700/70 dark:text-sky-400/60 m-0">
													Opsional — hanya pengingat, tidak menahan pengiriman laporan. Kosongkan bila belum diukur.
												</p>
											</div>
										{/if}
									{/if}

									<!-- Jika Pekerjaan Kustom -->
									{#if item.is_custom}
										<div class="p-3 rounded-lg bg-amber-50/40 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 space-y-2.5">
											<div class="text-[11px] font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
												<IconSparkles size={13} />
												<span>Pekerjaan Tambahan / Non-Timeline</span>
											</div>
											<!-- SPL-05: peringatan dampak pekerjaan kustom (tidak tertaut subtask timeline) -->
											<p class="text-[10.5px] font-semibold text-red-700 dark:text-red-300 m-0">
												⚠ Pekerjaan kustom tidak tertaut ke Timeline, jadi progresnya TIDAK masuk grafik/progres proyek dan ditandai "progress tanpa subtask" saat kirim laporan. Bila ini bagian dari rencana, minta PM menambah subtask dulu.
											</p>
											<div>
												<label class="f-label">Nama Pekerjaan / Aktivitas <span style="color: var(--re)">*</span></label>
												<input 
													type="text" 
													bind:value={item.activity} 
													class="f-input" 
													placeholder="Contoh: Pemasangan scaffolding tambahan..." 
													required 
												/>
											</div>
											<div class="grid grid-cols-2 gap-2">
												<div>
													<label class="f-label">Target Volume (Opsional)</label>
													<input 
														type="number" 
														bind:value={item.target_volume} 
														class="f-input" 
														min="0" 
														placeholder="0" 
													/>
												</div>
												<div>
													<label class="f-label">Satuan <span style="color: var(--re)">*</span></label>
													<input 
														type="text" 
														bind:value={item.unit} 
														class="f-input" 
														placeholder="m², kg, titik, unit..." 
														required 
													/>
												</div>
											</div>
										</div>
									{/if}

									<!-- Visual Composite Progress Bar & Metrik Komparasi -->
									{#if item.subtask_id || item.activity}
										<div class="p-3 rounded-xl bg-gray-50/80 dark:bg-slate-800/40 border border-gray-200/60 dark:border-slate-700/60 space-y-2.5">
											{#if calc.target > 0}
												<div class="space-y-1.5">
													<div class="flex justify-between text-[11px] font-medium text-gray-600 dark:text-slate-300">
														<span>Akumulasi: <strong>{calc.total} / {calc.target} {item.unit}</strong> ({calc.totalPct}%)</span>
														<span class={calc.remaining === 0 ? 'text-emerald-600 font-bold' : 'text-gray-500'}>
															{calc.remaining === 0 ? '✓ Selesai' : `Sisa: ${calc.remaining} ${item.unit}`}
														</span>
													</div>
													<!-- Dual Progress Bar: Previous (Sky) + Today (Emerald) -->
													<div class="w-full h-2.5 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden flex">
														<div 
															class="h-full bg-sky-500 transition-all duration-300"
															style="width: {calc.prevPct}%"
															title="Lalu: {calc.prev} {item.unit} ({calc.prevPct}%)"
														></div>
														<div 
															class="h-full bg-emerald-500 transition-all duration-300 {calc.today > 0 ? 'animate-pulse' : ''}"
															style="width: {calc.todayPct}%"
															title="Hari ini: +{calc.today} {item.unit} ({calc.todayPct}%)"
														></div>
													</div>
												</div>
											{/if}

											<!-- 5-Kolom Metrik Detail (Termasuk Target Hari Ini dari Kurva S) -->
											<div class="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-[10px]">
												<div class="p-1.5 rounded bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700">
													<span class="text-gray-400 dark:text-slate-500 block">Target Total</span>
													<strong class="text-[11px] text-gray-800 dark:text-slate-200">
														{calc.target > 0 ? `${calc.target} ${item.unit}` : '-'}
													</strong>
												</div>
												<div class="p-1.5 rounded bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700">
													<span class="text-gray-400 dark:text-slate-500 block">Target Hari Ini</span>
													<strong class="text-[11px] {calc.dailyTarget > 0 ? 'text-sky-600 dark:text-sky-400 font-bold' : 'text-gray-500'}">
														{calc.dailyTarget > 0 ? `${calc.dailyTarget} ${item.unit}` : '-'}
													</strong>
												</div>
												<div class="p-1.5 rounded bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700">
													<span class="text-gray-400 dark:text-slate-500 block">Selesai Lalu</span>
													<strong class="text-[11px] text-sky-600 dark:text-sky-400">
														{calc.prev} {item.unit} ({calc.prevPct}%)
													</strong>
												</div>
												<div class="p-1.5 rounded bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700">
													<span class="text-gray-400 dark:text-slate-500 block">Hari Ini</span>
													<strong class="text-[11px] text-emerald-600 dark:text-emerald-400">
														+{calc.today} {item.unit}
													</strong>
												</div>
												<div class="p-1.5 rounded bg-white dark:bg-slate-800 border border-gray-100 dark:border-slate-700">
													<span class="text-gray-400 dark:text-slate-500 block">Total Baru</span>
													<strong class="text-[11px] text-gray-900 dark:text-white">
														{calc.total} {item.unit} ({calc.totalPct}%)
													</strong>
												</div>
											</div>

											<!-- Quick Fill Action & Alerts -->
											<div class="flex flex-wrap items-center justify-between gap-2 pt-1">
												{#if calc.remainingBeforeToday > 0 && calc.remaining > 0}
													<button 
														type="button" 
														class="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-100/70 dark:bg-emerald-950/60 hover:bg-emerald-200/80 border border-emerald-300/60 dark:border-emerald-800 px-2 py-1 rounded-md transition-colors cursor-pointer active:scale-95"
														onclick={() => fillRemainingTarget(item, calc.remainingBeforeToday)}
													>
														<IconSparkles size={12} />
														<span>Selesaikan sisa target ({calc.remainingBeforeToday} {item.unit})</span>
													</button>
												{/if}

												{#if calc.isOver}
													<div class="text-[10px] font-medium text-amber-700 dark:text-amber-300 flex items-center gap-1 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded border border-amber-200 dark:border-amber-800">
														<IconAlertTriangle size={12} />
														<span>Melebihi target awal (+{calc.overAmount} {item.unit})</span>
													</div>
													<p class="basis-full m-0 text-[10px] text-amber-800 dark:text-amber-300">
														Target subtask ini {calc.target} {item.unit}. Isi volume yang dikerjakan <strong>hari ini</strong>, bukan total. Bila satuannya memang berbeda (mis. target 1 ls tetapi Anda mengukur dalam m²), minta Admin Project menyesuaikan satuan subtask di Timeline — nilai yang tidak wajar tidak akan dihitung ke progres proyek.
													</p>
												{/if}
											</div>
										</div>
									{/if}

									<!-- Kolom Input Nilai Progress Hari Ini & Satuan -->
									{#if item.executor_type !== 'external_prereq'}
										<div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
											<div>
												<label class="f-label">
													Nilai Progress Hari Ini <span style="color: var(--re)">*</span>
													<HelpIcon text={h('laporan.form.progress').helpIcon} />
												</label>
												<div class="relative">
													<input 
														type="number" 
														bind:value={item.progress_value} 
														class="f-input font-bold text-[14px]" 
														min="0"
														step="any"
														placeholder="0"
														required 
													/>
												</div>
												<FieldHint
													text={h('laporan.form.progress').fieldHint}
													type={h('laporan.form.progress').type}
												/>
											</div>
											<div>
												<label class="f-label">Satuan <span style="color: var(--re)">*</span></label>
												{#if item.is_custom}
													<input type="text" bind:value={item.unit} class="f-input" placeholder="m²" required />
												{:else}
													<input type="text" value={item.unit || 'm²'} class="f-input bg-gray-50 dark:bg-slate-800 text-gray-500 cursor-not-allowed" readonly />
												{/if}
											</div>
										</div>
									{:else}
										<!-- Executor Partitioning Fase 3 — external_prereq: bobot 0%, tidak ada input volume.
										     Leader hanya melapor status kesiapan area (dokumentasi, bukan keputusan resmi —
										     hanya admin ERP yang boleh menandai "Siap" secara resmi, lihat SubtaskSpecDrawer). -->
										<div class="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
											<label class="f-label">Status Kesiapan Area (Laporan, Bukan Keputusan Resmi)</label>

											<!-- Rekomendasi L2 — checklist kesiapan area, opsional/tidak menghalangi kirim laporan. -->
											<div class="grid grid-cols-1 sm:grid-cols-2 gap-1 mt-1 mb-2">
												{#each READINESS_CHECKLIST_ITEMS as ci (ci.key)}
													{@const checked = (item.readiness_checklist || []).includes(ci.key)}
													<label class="flex items-center gap-1.5 text-[11px] text-gray-600 dark:text-slate-300 cursor-pointer">
														<input
															type="checkbox"
															{checked}
															onchange={(e) => {
																const set = new Set(item.readiness_checklist || []);
																if ((e.target as HTMLInputElement).checked) set.add(ci.key);
																else set.delete(ci.key);
																item.readiness_checklist = [...set];
															}}
														/>
														{ci.label}
													</label>
												{/each}
											</div>
											<div class="flex gap-2 mt-1">
												<button
													type="button"
													class="flex-1 text-[11px] font-semibold px-3 py-2 rounded-lg border transition-colors {item.readiness_status === 'belum_siap' ? 'bg-amber-500 text-white border-amber-500' : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700'}"
													onclick={() => (item.readiness_status = 'belum_siap')}
												>⏳ Belum Siap</button>
												<button
													type="button"
													class="flex-1 text-[11px] font-semibold px-3 py-2 rounded-lg border transition-colors {item.readiness_status === 'sudah_siap' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-slate-300 border-gray-200 dark:border-slate-700'}"
													onclick={() => (item.readiness_status = 'sudah_siap')}
												>✅ Sudah Siap</button>
											</div>
											<p class="text-[10.5px] text-gray-400 dark:text-slate-500 mt-2 m-0">Lampirkan foto kondisi area di bawah. Status resmi tetap ditentukan admin ERP lewat Timeline.</p>
										</div>
									{/if}

									<div>
										<label class="f-label">Catatan Progress (opsional)</label>
										<textarea
											bind:value={item.notes}
											rows="2"
											class="f-textarea"
											placeholder="Catatan pelaksanaan pekerjaan ini (area pengerjaan, layer ke-berapa, dsb)..."
										></textarea>
									</div>

									<!-- Fase 2 Dokumentasi Foto (26 Sep 2026) — foto bukti PER BARIS, tambahan di
									     luar foto progress umum di tab Dokumentasi. Belum wajib. -->
									<div class="border-t border-gray-100 dark:border-slate-800 pt-3">
										<label class="f-label flex items-center gap-1.5"><IconCamera size={13} class="text-gray-400" /> Foto Bukti Baris Ini (opsional)</label>
										<p class="text-[10.5px] text-gray-400 dark:text-slate-500 mb-2 m-0">Foto spesifik untuk pekerjaan baris ini (mis. hasil pasang pipa 20m), beda dari foto progress umum di tab Dokumentasi.</p>
										{#if (item.existing_foto_bukti || []).length > 0 || (item.foto_bukti || []).length > 0}
											<div class="grid grid-cols-3 gap-1.5 mb-2">
												{#each item.existing_foto_bukti || [] as id}
													<div class="aspect-square border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
														<img use:secureAssetSrc={id} alt="Foto bukti progress" class="w-full h-full object-cover" />
													</div>
												{/each}
												{#each item.foto_bukti || [] as photo, pIdx}
													<div class="relative aspect-square border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
														<img src={photo.url} alt="Foto bukti progress" class="w-full h-full object-cover" />
														{#if !isLocked}
															<button class="absolute top-1 right-1 w-6 h-6 bg-black/50 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors" onclick={() => removeProgressItemPhoto(i, pIdx)}>
																<IconTrash size={12} />
															</button>
														{/if}
													</div>
												{/each}
											</div>
										{/if}
										{#if !isLocked}
											<div class="border border-dashed border-gray-300 dark:border-slate-700 rounded-lg p-2.5 text-center cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors relative">
												<input type="file" accept="image/*" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange={(e) => handleProgressItemPhoto(i, e)} />
												<span class="text-[11px] text-gray-500 dark:text-slate-400 inline-flex items-center gap-1"><IconCamera size={13} /> Tap untuk memotret</span>
											</div>
										{/if}
									</div>
								</div>
							{/each}

							<button class="btn-action w-full py-2.5 rounded-xl flex items-center justify-center gap-1.5" onclick={addProgress}>
								<IconPlus size={15} /> Tambah progress
							</button>
						</div>
					{/if}
				</div>

				<!-- Dokumentasi Progress -->
				<div class="card-section mt-4">
					<div class="flex items-center justify-between mb-2">
						<h4 class="m-0 flex items-center gap-1.5">
							<IconCamera size={16} class="text-[var(--g)]" /> 
							<span>Foto Bukti Progress</span>
							<span style="color: var(--re)">*</span>
							<HelpIcon text={h('laporan.form.foto').helpIcon} rich />
						</h4>
						{#if reportPosition}
							<span class="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
								📍 GPS Auto-stamp Aktif
							</span>
						{/if}
					</div>

					<FieldHint
						text={h('laporan.form.foto').fieldHint}
						type={h('laporan.form.foto').type}
					/>

					<!-- Galeri Foto Yang Sudah Diunggah / Tersimpan -->
					{#if existingProgressPhotos.length > 0 || reportData.progress_photos.length > 0}
						<div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 mb-3 mt-2">
							{#each existingProgressPhotos as id}
								<div class="relative group aspect-square border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden bg-gray-50 dark:bg-slate-800">
									<img use:secureAssetSrc={id} alt="Progress" class="w-full h-full object-cover" />
									<button 
										type="button" 
										class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white cursor-pointer"
										onclick={() => openPhotoPreview(id)}
										title="Klik untuk memperbesar"
									>
										<IconZoomIn size={22} />
									</button>
									<span class="absolute bottom-1.5 left-1.5 text-[9px] font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded">
										Tersimpan
									</span>
									{#if !isLocked}
										<button 
											type="button"
											class="absolute top-1.5 right-1.5 w-7 h-7 bg-black/60 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors z-10 cursor-pointer" 
											onclick={() => removeExistingProgressPhoto(id)}
											title="Hapus foto tersimpan"
										>
											<IconTrash size={14} />
										</button>
									{/if}
								</div>
							{/each}

							{#each reportData.progress_photos as photo, idx}
								<div class="relative group aspect-square border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden bg-gray-50 dark:bg-slate-800">
									<img src={photo.url} alt="Progress" class="w-full h-full object-cover" />
									<button 
										type="button" 
										class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white cursor-pointer"
										onclick={() => openPhotoPreview(photo.url)}
										title="Klik untuk memperbesar"
									>
										<IconZoomIn size={22} />
									</button>
									<span class="absolute bottom-1.5 left-1.5 text-[9px] font-semibold bg-emerald-600 text-white px-1.5 py-0.5 rounded">
										Baru
									</span>
									{#if !isLocked}
										<button 
											type="button"
											class="absolute top-1.5 right-1.5 w-7 h-7 bg-black/60 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors z-10 cursor-pointer" 
											onclick={() => removeProgressPhoto(idx)}
											title="Hapus foto"
										>
											<IconTrash size={13} />
										</button>
									{/if}
								</div>
							{/each}
						</div>
					{/if}

					{#if !isLocked}
						<div class="mt-2 border-2 border-dashed border-[var(--g)] bg-[var(--gl)]/20 hover:bg-[var(--gl)]/40 rounded-xl p-5 text-center cursor-pointer transition-colors relative">
							<input 
								type="file" 
								accept="image/*" 
								multiple
								class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" 
								onchange={handleProgressPhoto} 
							/>
							<IconCamera size={26} class="text-[var(--g)] mx-auto" />
							<p class="text-[12px] text-[var(--gd)] mt-1.5 font-bold">
								Tap untuk memotret atau pilih beberapa foto bukti progress
							</p>
							<p class="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">
								Mendukung upload banyak foto sekaligus (JPG, PNG, WebP)
							</p>
						</div>
					{:else if existingProgressPhotos.length === 0 && reportData.progress_photos.length === 0}
						<p class="text-[12px] text-gray-400 text-center py-3">Tidak ada foto yang dilampirkan.</p>
					{/if}
				</div>
			{/if}

			{#if activeTab === 'material'}
				{#if materialVarianceCheck.items.length > 0}
					<!-- Fase 2 Laporan Lapangan & Paritas ERP (16 Okt 2026) — Rasio Konsumsi Material -->
					<div class="card-section mb-4">
						<h4 class="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
							<IconChartBar size={16} class="text-[var(--g)]" />
							<span>Rasio Konsumsi Material</span>
						</h4>
						<p class="text-[11px] text-slate-500 dark:text-slate-400 -mt-1 mb-2">
							Aktual (s.d. laporan tersimpan terakhir) ÷ output kumulatif, dibanding standar dari PO Customer. Toleransi: {lossFactorPct}% (ikut setelan Faktor Kehilangan Cat Superadmin).
						</p>
						<div class="space-y-2">
							{#each materialVarianceCheck.items as item}
								{@const st = materialVarianceStatus(item.variancePct)}
								<div class="flex items-center justify-between gap-2 p-2.5 rounded-xl border {st === 'merah' ? 'border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800' : st === 'kuning' ? 'border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800' : 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800'}">
									<div class="min-w-0">
										<p class="text-[12px] font-semibold text-slate-700 dark:text-slate-200 truncate">{item.label}</p>
										<p class="text-[10px] text-slate-500 dark:text-slate-400">Standar {item.standardRatio.toFixed(3)} vs Aktual {item.actualRatio.toFixed(3)} per m²</p>
									</div>
									<span class="text-[12px] font-bold shrink-0 {st === 'merah' ? 'text-red-700 dark:text-red-300' : st === 'kuning' ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'}">
										{item.variancePct > 0 ? '+' : ''}{item.variancePct.toFixed(0)}% {st === 'merah' ? '🔴' : st === 'kuning' ? '🟡' : '🟢'}
									</span>
								</div>
							{/each}
						</div>
						{#if materialVarianceCheck.flagged}
							<div class="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800">
								<label class="f-label">
									Alasan Deviasi Konsumsi Material <span style="color: var(--re)">*</span>
									<HelpIcon text="Rasio pemakaian melampaui toleransi — jelaskan sebabnya (mis. over-thickness sesuai spesifikasi klien, waste area sulit dijangkau, dll) agar tidak jadi temuan Cost Control tanpa konteks." />
								</label>
								{#if isLocked}
									<textarea value={reportData.material_variance_note} class="f-textarea cursor-not-allowed" style="height: 60px; resize: none; background: var(--sys-fill); color: var(--sys-label3)" readonly></textarea>
								{:else}
									<textarea bind:value={reportData.material_variance_note} class="f-textarea" placeholder="Jelaskan sebab deviasi konsumsi material hari ini" style="height: 60px"></textarea>
								{/if}
							</div>
						{/if}
					</div>
				{/if}

				<!-- Material terpakai -->
				<div class="card-section">
					<h4><IconPackage size={16} class="text-[var(--g)]" /> Material terpakai <span style="color: var(--re)">*</span></h4>
					{#if isLocked}
						<!-- VIEW MODE -->
						{#if reportData.material_used.length === 0 || (reportData.material_used.length === 1 && !reportData.material_used[0].type && !reportData.material_used[0].expense_id)}
							<p class="text-[12px] text-gray-400 text-center py-3">Tidak ada material yang dicatat.</p>
						{:else}
							<div class="divide-y divide-gray-100">
								{#each reportData.material_used as item}
									{#if item.type || item.expense_id}
										<div class="py-2.5 flex items-center justify-between gap-2">
											<div class="flex-1 min-w-0">
												<p class="text-[13px] font-semibold text-gray-800 truncate">{item.type || '-'}</p>
												{#if item.notes}<p class="text-[11px] text-gray-400 italic">{item.notes}</p>{/if}
											</div>
											<span class="text-[13px] font-bold text-gray-800 shrink-0">{item.amount} <span class="text-[10px] font-medium text-gray-500">{item.unit}</span></span>
										</div>
									{/if}
								{/each}
							</div>
						{/if}
					{:else}
						<!-- EDIT MODE -->
						{#each reportData.material_used as item, i}
							<div class="border-b border-gray-100 pb-3 mb-3 last:border-none last:pb-0 last:mb-0 relative">
								{#if reportData.material_used.length > 1}
									<button class="absolute top-0 right-0 text-gray-300 hover:text-red-400 transition-colors" onclick={() => removeMaterialUsed(i)}><IconTrash size={14} /></button>
								{/if}
								<div class="mb-2">
									<label class="f-label">Pilih Barang/Material (RAP Actual)</label>
									{#if loadingMaterials}
										<div class="text-[12px] text-gray-500 py-1 flex items-center gap-1">
											<IconLoader2 size={12} class="animate-spin" /> Memuat data RAP Actual...
										</div>
									{:else}
										<select class="f-select" value={item.expense_id || (item.is_manual ? 'manual' : '')} onchange={(e) => handleMaterialSelect(e, item)}>
											<option value="">-- Pilih Barang --</option>
											{#each actualMaterials as mat}
												<option value={mat.id}>[{getCategoryLabel(mat.expense_type)}] {mat.material_name} {mat.material_color ? `(${mat.material_color})` : ''} - Sisa: {mat.qty_remaining} {mat.unit} {mat.reference_number ? `[Ref: ${mat.reference_number}]` : ''}</option>
											{/each}
											<option value="manual">Tulis Manual (Tidak ada di RAP)</option>
										</select>
									{/if}
								</div>
								{#if item.is_manual}
									<div class="mb-2"><label class="f-label">Nama Barang (Tulis Manual) <span style="color: var(--re)">*</span></label><input type="text" bind:value={item.type} class="f-input" placeholder="Ketik nama barang..."></div>
									{@const matched = findMatchingMaterial(item.type, actualMaterials)}
									{#if matched}
										<div class="mb-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900" data-testid="manual-material-match">
											Barang ini sudah dikirim ke proyek: <strong>{matched.material_name}</strong> (sisa {matched.qty_remaining} {matched.unit}). Tulis manual <strong>tidak mengurangi stok proyek</strong>.
											<button type="button" class="ml-1 underline font-bold" onclick={() => useMatchedMaterial(item, matched)}>Pakai barang ini</button>
										</div>
									{:else if String(item.type || '').trim().length >= 3}
										<div class="mb-2 text-[11px] text-gray-500">Tulis manual tidak mengurangi stok proyek. Gunakan hanya untuk barang yang memang tidak dikirim lewat Surat Jalan.</div>
									{/if}
								{:else if item.expense_id}
									<div class="mb-2"><label class="f-label">Nama Barang <span style="color: var(--re)">*</span></label><input type="text" value={item.type} class="f-input bg-gray-50 text-gray-500 cursor-not-allowed" readonly></div>
								{/if}
								<div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
									<div><label class="f-label">Jumlah <span style="color: var(--re)">*</span></label><input type="number" bind:value={item.amount} class="f-input" min="0" step="any"></div>
									<div><label class="f-label">Satuan <span style="color: var(--re)">*</span></label>
										{#if item.is_manual}<select bind:value={item.unit} class="f-select"><option>kg</option><option>liter</option><option>sak</option><option>pcs</option><option>roll</option><option>m²</option><option>m³</option></select>
										{:else}<input type="text" value={item.unit} class="f-input bg-gray-50 text-gray-500 cursor-not-allowed" readonly>{/if}
									</div>
									<div class="col-span-2 sm:col-span-1"><label class="f-label">Catatan</label><input type="text" bind:value={item.notes} class="f-input" placeholder="..."></div>
								</div>
								{#if !item.is_manual && item.expense_id}
									{@const selected = actualMaterials.find(m => String(m.id) === String(item.expense_id))}
									{#if selected}
										<div class="text-[11px] text-gray-500 mt-1 flex items-center gap-1">
											<span>Info Stok RAP: <strong>{selected.qty_remaining} {selected.unit}</strong></span>
											{#if item.amount > selected.qty_remaining}<span class="text-red-500 font-semibold flex items-center gap-0.5"><IconAlertCircle size={12} /> Melebihi stok yang tersedia!</span>{/if}
										</div>
									{/if}
									{#if selected?.identitas_barang_id}
										<div class="mt-1"><KnowledgeCard itemId={selected.identitas_barang_id} context="usage" label="Cara pakai" /></div>
										{@const siteStock = siteStockByItemId[selected.identitas_barang_id]}
										<div class="text-[11px] mt-0.5 flex items-center gap-1" title="Sisa saldo fisik barang ini yang tercatat berada di lokasi proyek ini saat ini (mutasi Surat Jalan masuk dikurangi laporan pemakaian harian) — beda dari Info Stok RAP di atas yang berbasis anggaran.">
											{#if loadingSiteStock}
												<span class="text-gray-400 flex items-center gap-1"><IconLoader2 size={11} class="animate-spin" /> Memuat sisa stok di site...</span>
											{:else if !siteStock}
												<span class="text-gray-400 italic">Sisa Stok di Site: belum ada catatan mutasi (mungkin belum pernah dikirim, atau menunggu sinkronisasi Surat Jalan).</span>
											{:else}
												<span class="text-gray-500">Sisa Stok di Site: <strong class={siteStock.qty_on_hand <= 0 ? 'text-red-500' : 'text-gray-700'}>{siteStock.qty_on_hand} {selected.unit}</strong></span>
												{#if item.amount > siteStock.qty_on_hand}
													<span class="text-amber-600 font-semibold flex items-center gap-0.5"><IconAlertCircle size={12} /> Melebihi sisa fisik di site — pastikan barang benar ada sebelum lanjut.</span>
												{/if}
											{/if}
										</div>
									{/if}
								{/if}
							</div>
						{/each}
						<button class="btn-action" onclick={addMaterialUsed}><IconPlus size={14} /> Tambah material</button>
					{/if}
				</div>


				<!-- Stok tersisa -->
				<div class="card-section">
					<h4><IconStack2 size={16} class="text-[var(--g)]" /> Stok tersisa</h4>
					{#if loadingMaterials}
						<div class="text-[12px] text-gray-500 py-1 flex items-center gap-1">
							<IconLoader2 size={12} class="animate-spin" /> Memuat data stok tersisa...
						</div>
					{:else if actualMaterials.length === 0}
						<p class="text-[12px] text-gray-400 text-center py-4">Tidak ada data material.</p>
					{:else}
						<div class="divide-y divide-gray-100">
							{#each currentMaterialStock as item}
								<div class="py-2.5 flex items-center justify-between gap-4">
									<div class="flex-1 min-w-0">
										<p class="text-[12px] font-semibold text-gray-700 truncate">{item.type}</p>
										{#if item.usedAmount > 0}
											<p class="text-[10px] text-gray-400">
												Awal: {item.qty_remaining} {item.unit} | Dipakai: {item.usedAmount} {item.unit}
											</p>
										{/if}
									</div>
									<div class="text-right shrink-0">
										<span class="text-[13px] font-bold text-gray-800">{item.amount}</span>
										<span class="text-[10px] text-gray-500 ml-0.5">{item.unit}</span>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Kebutuhan material -->
				<div class="card-section">
					<h4>
						<IconAlertTriangle size={16} class="text-[var(--am)]" /> Kebutuhan material
						<HelpIcon text={h('laporan.form.material').helpIcon} />
					</h4>
					<FieldHint text={h('laporan.form.material').fieldHint} />
					{#if isLocked}
						<!-- VIEW MODE -->
						{#if reportData.material_needs.length === 0 || (reportData.material_needs.length === 1 && !reportData.material_needs[0].type && !reportData.material_needs[0].description)}
							<p class="text-[12px] text-gray-400 text-center py-3">Tidak ada kebutuhan material yang dicatat.</p>
						{:else}
							<div class="divide-y divide-gray-100">
								{#each reportData.material_needs as item}
									{#if item.type || item.description}
										<div class="py-2.5">
											<div class="flex items-center justify-between gap-2">
												<p class="text-[13px] font-semibold text-gray-800 flex-1">{item.description || item.type || '-'}</p>
												<span class="text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 {item.urgency === 'urgent' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}">{item.urgency === 'urgent' ? 'Urgent' : 'Normal'}</span>
											</div>
											<p class="text-[12px] text-gray-600">{item.amount} {item.unit}</p>
											{#if item.date_needed}<p class="text-[11px] text-gray-400">Butuh: {item.date_needed}</p>{/if}
										</div>
									{/if}
								{/each}
							</div>
						{/if}
					{:else}
						<!-- EDIT MODE -->
						{#each reportData.material_needs as item, i}
							<div class="border-b border-gray-100 pb-3 mb-3 last:border-none last:pb-0 last:mb-0">
								<div class="mb-2">
									<label class="f-label">Pilih Barang/Material (RAP Actual)</label>
									{#if loadingMaterials}
										<div class="text-[12px] text-gray-500 py-1 flex items-center gap-1"><IconLoader2 size={12} class="animate-spin" /> Memuat data RAP Actual...</div>
									{:else}
										<select class="f-select" value={item.expense_id || (item.is_manual ? 'manual' : '')} onchange={(e) => handleMaterialNeedsSelect(e, item)}>
											<option value="">-- Pilih Barang --</option>
											{#each actualMaterials as mat}<option value={mat.id}>[{getCategoryLabel(mat.expense_type)}] {mat.material_name} {mat.material_color ? `(${mat.material_color})` : ''} - Sisa: {mat.qty_remaining} {mat.unit}</option>{/each}
											<option value="manual">Tulis Manual (Tidak ada di RAP)</option>
										</select>
									{/if}
								</div>
								{#if item.is_manual}<div class="mb-2"><label class="f-label">Nama Barang (Tulis Manual) <span style="color: var(--re)">*</span></label><input type="text" bind:value={item.description} class="f-input" placeholder="Nama barang..."></div>
								{:else if item.expense_id}<div class="mb-2"><label class="f-label">Nama Barang <span style="color: var(--re)">*</span></label><input type="text" value={item.description} class="f-input bg-gray-50 text-gray-500 cursor-not-allowed" readonly></div>{/if}
								<div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2">
									<div><label class="f-label">Jumlah <span style="color: var(--re)">*</span></label><input type="number" bind:value={item.amount} class="f-input" min="0" step="any"></div>
									<div><label class="f-label">Satuan <span style="color: var(--re)">*</span></label>
										{#if item.is_manual}<select bind:value={item.unit} class="f-select"><option>kg</option><option>liter</option><option>sak</option><option>pcs</option><option>roll</option><option>m²</option><option>m³</option></select>
										{:else}<input type="text" value={item.unit} class="f-input bg-gray-50 text-gray-500 cursor-not-allowed" readonly>{/if}
									</div>
									<div class="col-span-2 sm:col-span-1"><label class="f-label">Urgensi <span style="color: var(--re)">*</span></label><select bind:value={item.urgency} class="f-select" title="Pilih Urgent bila barang dibutuhkan segera: setelah laporan terkirim, sistem otomatis mengajukannya sebagai permintaan Packing List (menunggu approval)."><option value="normal">Normal</option><option value="urgent">Urgent</option></select></div>
								</div>
								<div><label class="f-label">Tanggal dibutuhkan <span style="color: var(--re)">*</span></label><input type="date" bind:value={item.date_needed} class="f-input"></div>
							</div>
						{/each}
						<button class="btn-action" onclick={addMaterialNeeds}><IconPlus size={14} /> Tambah kebutuhan</button>
					{/if}
				</div>

				<!-- Alasan Deviasi Konsumsi Material (Hard Gate) -->
				<div class="card-section">
					<h4><IconAlertTriangle size={16} class="text-[var(--am)]" /> Catatan Deviasi / Alasan Konsumsi Material</h4>
					<p class="text-[11px] text-gray-400 mb-2">Wajib diisi jika pemakaian material melebihi toleransi atau leader ingin memberi catatan pemakaian (Hard Gate: G_LH_MATERIAL_VARIANCE).</p>
					{#if isLocked}
						<p class="text-[13px] text-gray-700 bg-gray-50 dark:bg-slate-850 p-3 rounded-xl border border-gray-100 dark:border-slate-800">
							{reportData.material_variance_note || 'Tidak ada catatan deviasi material.'}
						</p>
					{:else}
						<textarea
							rows="2"
							class="f-textarea"
							placeholder="Jelaskan alasan deviasi pemakaian (mis: profil permukaan baja kasar, overspray angin kencang, perbaikan area rusak, dsb)..."
							bind:value={reportData.material_variance_note}
						></textarea>
					{/if}
				</div>

			{/if}

			{#if activeTab === 'tenaga'}
				<!-- Manpower & Presensi Lapangan -->
				<div class="card-section">
					<div class="flex items-center justify-between mb-3 pb-2 border-b border-gray-100 dark:border-slate-800">
						<h4 class="m-0 flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
							<IconUsers size={18} class="text-[var(--g)]" /> Manpower & Presensi Lapangan <span style="color: var(--re)">*</span>
						</h4>
						<div class="flex items-center gap-2">
							{#if !isLocked && !isHold}
								<button
									type="button"
									class="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 hover:bg-purple-100 dark:hover:bg-purple-900 transition-colors flex items-center gap-1 shadow-2xs active:scale-95"
									onclick={salinKomposisiKemarin}
									title="Salin daftar Tenaga & Peralatan dari laporan kemarin di proyek ini — hemat waktu ketik ulang"
								>
									<IconCopy size={12} /> Salin Komposisi Kemarin
								</button>
							{/if}
							{#if !isLocked && !isHold && availableManpower.length > 0}
								<span class="text-[11px] font-medium text-gray-500 dark:text-slate-400">
									{availableManpower.length} pekerja aktif di SPK
								</span>
							{/if}
						</div>
					</div>
					{#if !isLocked && !isHold}
						<p class="text-[11px] mb-3 px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/20 dark:text-amber-300 dark:border-amber-900/40">
							💡 Pilih nama setiap pekerja dari daftar. Baris pekerja tanpa nama tidak akan masuk absensi dan tidak bisa dibayar.
						</p>
					{/if}

					{#if !isHold}
						<!-- KPI Summary Cards -->
						<div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
							<div class="p-3 rounded-xl border bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900/40">
								<div class="flex items-center justify-between text-emerald-700 dark:text-emerald-400">
									<span class="text-[11px] font-semibold">Total Hadir</span>
									<IconUserCheck size={16} />
								</div>
								<div class="mt-1 flex items-baseline gap-1.5">
									<span class="text-xl font-bold text-emerald-900 dark:text-emerald-200">{totalWorkersHadir}</span>
									<span class="text-[11px] text-emerald-600 dark:text-emerald-400">/ {availableManpower.length} SPK</span>
								</div>
							</div>

							<div class="p-3 rounded-xl border bg-blue-50/70 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/40">
								<div class="flex items-center justify-between text-blue-700 dark:text-blue-400">
									<span class="text-[11px] font-semibold">Total Jam Kerja</span>
									<IconClock size={16} />
								</div>
								<div class="mt-1 flex items-baseline gap-1.5">
									<span class="text-xl font-bold text-blue-900 dark:text-blue-200">{totalJamKerja}</span>
									<span class="text-[11px] text-blue-600 dark:text-blue-400">jam</span>
								</div>
							</div>

							<div class="p-3 rounded-xl border bg-amber-50/70 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/40">
								<div class="flex items-center justify-between text-amber-700 dark:text-amber-400">
									<span class="text-[11px] font-semibold">Total Lembur (OT)</span>
									<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-200/80 text-amber-800 dark:bg-amber-900 dark:text-amber-200">OT</span>
								</div>
								<div class="mt-1 flex items-baseline gap-1.5">
									<span class="text-xl font-bold text-amber-900 dark:text-amber-200">{totalJamLembur}</span>
									<span class="text-[11px] text-amber-600 dark:text-amber-400">jam</span>
								</div>
							</div>

							<div class="p-3 rounded-xl border bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700">
								<div class="flex items-center justify-between text-slate-600 dark:text-slate-400">
									<span class="text-[11px] font-semibold">Standby</span>
									<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">SB</span>
								</div>
								<div class="mt-1 flex items-baseline gap-1.5">
									<span class="text-xl font-bold text-slate-800 dark:text-slate-200">{totalWorkersStandby}</span>
									<span class="text-[11px] text-slate-500">orang</span>
								</div>
							</div>
						</div>
						<!-- Live Productivity Feedback Banner (Fase 3) -->
						{#if liveProductivity.hasData}
							<div class="mb-4 p-3.5 rounded-xl border transition-colors {liveProductivity.statusTone === 'err' ? 'bg-red-50/80 border-red-200 dark:bg-red-950/20 dark:border-red-900/40 text-red-900 dark:text-red-200' : liveProductivity.statusTone === 'warn' ? 'bg-amber-50/80 border-amber-200 dark:bg-amber-950/20 dark:border-amber-900/40 text-amber-900 dark:text-amber-200' : 'bg-indigo-50/80 border-indigo-200 dark:bg-indigo-950/20 dark:border-indigo-900/40 text-indigo-900 dark:text-indigo-200'}">
								<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-black/5 dark:border-white/5">
									<div class="flex items-center gap-2">
										<span class="text-base">⚡</span>
										<span class="text-xs font-bold uppercase tracking-wider">Kalkulator Output Produktivitas Hari Ini</span>
									</div>
									<div class="flex items-center gap-3 text-xs font-semibold">
										<span>Total Volume: <strong>{liveProductivity.totalVolumeM2} m²</strong></span>
										<span>Tenaga Kerja: <strong>{liveProductivity.totalWorkers} Orang</strong></span>
									</div>
								</div>
								<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2.5">
									<div class="flex items-center justify-between p-2 rounded-lg bg-white/70 dark:bg-slate-900/60 border border-black/5 dark:border-white/5 text-xs">
										<div>
											<span class="text-slate-500 dark:text-slate-400 block text-[10px] font-medium">Output Blasting ({liveProductivity.blasters} Blaster)</span>
											<strong class="text-sm font-black">{liveProductivity.blasterOutputM2PerDay} m²</strong> <span class="text-[11px] text-slate-400">/ orang-hari</span>
										</div>
										<div class="text-right">
											<span class="text-[10px] text-slate-400 block">Standar: 20 m²</span>
											<span class="font-bold px-1.5 py-0.5 rounded text-[10px] {liveProductivity.blasterRatioPct >= 100 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : liveProductivity.blasterRatioPct >= 70 ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'}">
												{liveProductivity.blasterRatioPct}% target
											</span>
										</div>
									</div>

									<div class="flex items-center justify-between p-2 rounded-lg bg-white/70 dark:bg-slate-900/60 border border-black/5 dark:border-white/5 text-xs">
										<div>
											<span class="text-slate-500 dark:text-slate-400 block text-[10px] font-medium">Output Painting ({liveProductivity.painters} Painter)</span>
											<strong class="text-sm font-black">{liveProductivity.painterOutputM2PerDay} m²</strong> <span class="text-[11px] text-slate-400">/ orang-hari</span>
										</div>
										<div class="text-right">
											<span class="text-[10px] text-slate-400 block">Standar: 80 m²</span>
											<span class="font-bold px-1.5 py-0.5 rounded text-[10px] {liveProductivity.painterRatioPct >= 100 ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : liveProductivity.painterRatioPct >= 70 ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'}">
												{liveProductivity.painterRatioPct}% target
											</span>
										</div>
									</div>
								</div>
								<p class="text-[11px] mt-2 italic flex items-center gap-1 opacity-90">
									<span>💡</span>
									<span>{liveProductivity.hint}</span>
								</p>
							</div>
						{/if}
					{/if}

					{#if isLocked}
						<!-- VIEW MODE -->
						{#if presentWorkersList.length === 0}
							<p class="text-[12px] text-gray-400 text-center py-4">Tidak ada data tenaga kerja yang tercatat.</p>
						{:else}
							<div class="space-y-2">
								{#each presentWorkersList as worker}
									<div class="p-3 rounded-xl border border-gray-100 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-900/40 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
										<div class="flex items-center gap-3">
											<div class="w-9 h-9 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 flex items-center justify-center font-bold text-xs shrink-0">
												{(worker.nama || 'P').substring(0, 2).toUpperCase()}
											</div>
											<div>
												<div class="flex items-center gap-2 flex-wrap">
													<span class="text-sm font-bold text-gray-900 dark:text-white">{worker.nama}</span>
													{#if worker.rate_tipe}
														<span class="text-[10px] px-2 py-0.5 rounded font-bold uppercase tracking-wider {worker.rate_tipe === 'BORONGAN' ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'}">
															{worker.rate_tipe}
														</span>
													{/if}
													{#if worker.posisi}
														<span class="text-[10px] px-2 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300 font-medium">
															{worker.posisi}
														</span>
													{/if}
												</div>
												{#if worker.notes}
													<p class="text-[11px] text-gray-500 italic mt-0.5">{worker.notes}</p>
												{/if}
											</div>
										</div>
										<div class="flex items-center gap-2 flex-wrap sm:justify-end">
											{#if worker.is_standby}
												<span class="text-xs px-2.5 py-1 rounded-full font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
													STANDBY (0 jam)
												</span>
											{:else}
												<span class="text-xs px-2.5 py-1 rounded-full font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
													{worker.jam} jam
												</span>
												{#if Number(worker.ot_hours) > 0}
													<span class="text-xs px-2.5 py-1 rounded-full font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
														+{worker.ot_hours} jam OT
													</span>
												{/if}
												{#if worker.is_holiday}
													<span class="text-xs px-2.5 py-1 rounded-full font-bold bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300">
														Libur 1.5x
													</span>
												{/if}
											{/if}
											{#if worker.dobel_proyek_flag}
												<span class="text-xs px-2.5 py-1 rounded-full font-bold bg-red-50 text-red-700 border border-red-200" title={`Override: sudah absen di ${worker.dobel_proyek_proyek_lain_nama || 'proyek lain'}`}>
													⚠ Dobel Proyek
												</span>
											{/if}
										</div>
									</div>
								{/each}
							</div>
						{/if}
					{:else if isHold}
						<!-- HOLD: manpower otomatis standby -->
						<div class="flex items-center gap-2.5 py-3.5 px-3.5 rounded-xl border border-amber-200 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-900/40">
							<span class="text-[11px] px-2 py-0.5 rounded font-bold bg-amber-500 text-white">STANDBY</span>
							<p class="text-[12px] text-amber-900 dark:text-amber-200 m-0">Status Proyek Hold — tenaga kerja otomatis tercatat standby, tidak perlu diisi manual.</p>
						</div>
					{:else}
						<!-- EDIT MODE: Presensi Roster Cepat -->
						
						<!-- Quick Actions Bar & Search Filter -->
						<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mb-3.5 pb-3 border-b border-gray-100 dark:border-slate-800">
							<div class="flex items-center gap-2 flex-wrap">
								<button 
									type="button" 
									class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-lg text-[12px] font-semibold flex items-center gap-1.5 transition shadow-xs"
									onclick={() => markAllWorkersPresent(8)}
								>
									<IconCheck size={14} /> Hadirkan Semua (8 Jam)
								</button>
								{#if totalWorkersHadir > 0 || totalWorkersStandby > 0}
									<button 
										type="button" 
										class="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-gray-700 dark:text-slate-300 rounded-lg text-[12px] font-medium transition"
										onclick={clearAllWorkersAttendance}
									>
										Kosongkan Presensi
									</button>
								{/if}
							</div>

							<!-- Search / Filter by Name or Position -->
							<div class="relative w-full sm:w-60">
								<IconSearch size={14} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
								<input 
									type="text" 
									bind:value={manpowerSearchQuery} 
									placeholder="Cari nama / posisi..." 
									class="w-full pl-8 pr-7 py-1.5 bg-gray-50 dark:bg-slate-800 border border-gray-200 dark:border-gray-700 rounded-lg text-[12px] focus:bg-white dark:focus:bg-slate-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 text-gray-800 dark:text-gray-200"
								/>
								{#if manpowerSearchQuery}
									<button 
										type="button" 
										class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
										onclick={() => manpowerSearchQuery = ''}
									>
										<IconX size={12} />
									</button>
								{/if}
							</div>
						</div>

						<!-- Roster List -->
						{#if availableManpower.length === 0}
							<div class="p-4 rounded-xl border border-dashed border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-900/20 text-center">
								<IconUsers size={28} class="mx-auto text-gray-400 mb-1.5" />
								<p class="text-xs font-semibold text-gray-700 dark:text-slate-300">Belum ada pekerja dengan SPK aktif di proyek ini</p>
								<p class="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5 max-w-md mx-auto">
									Pekerja harus ditugaskan oleh Admin melalui SPK (Manpower Assignment) agar dapat diabsenkan di laporan harian.
								</p>
							</div>
						{:else if filteredAssignedWorkers.length === 0}
							<p class="text-xs text-gray-400 text-center py-4 italic">
								Tidak ada pekerja yang cocok dengan kata kunci "{manpowerSearchQuery}".
							</p>
						{:else}
							<div class="space-y-2.5">
								{#each filteredAssignedWorkers as worker}
									{@const activeRecord = presentWorkersMap.get(String(worker.id))}
									{@const isPresent = !!activeRecord}
									{@const isStandby = !!activeRecord?.is_standby}

									<div class="p-3 rounded-xl border transition-all {isPresent ? (isStandby ? 'bg-amber-50/30 border-amber-200 dark:bg-amber-950/10 dark:border-amber-900/40' : 'bg-emerald-50/30 border-emerald-200 dark:bg-emerald-950/10 dark:border-emerald-900/40 shadow-xs') : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800 opacity-80 hover:opacity-100'}">
										<!-- Row Header: Worker Info & Toggle Buttons -->
										<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
											<!-- Worker Identity -->
											<div class="flex items-center gap-3">
												<div class="w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0 {isPresent ? (isStandby ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300') : 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400'}">
													{(worker.nama || 'P').substring(0, 2).toUpperCase()}
												</div>
												<div>
													<div class="flex items-center gap-2 flex-wrap">
														<span class="text-[13px] font-bold text-gray-900 dark:text-white">{worker.nama}</span>
														<span class="text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider {worker.rate_tipe === 'BORONGAN' ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'}">
															{worker.rate_tipe || 'HARIAN'}
														</span>
														{#if worker.posisi}
															<span class="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300 font-medium">
																{worker.posisi}
															</span>
														{/if}
													</div>
													<div class="flex items-center gap-2 mt-0.5">
														{#if worker.tanggal_selesai}
															<span class="text-[10px] {isSPKExpiringSoon(worker.tanggal_selesai) ? 'text-red-500 font-semibold' : 'text-gray-400'}">
																SPK s.d. {fmtSPKEnd(worker.tanggal_selesai)}{isSPKExpiringSoon(worker.tanggal_selesai) ? ' (segera habis)' : ''}
															</span>
														{/if}
														{#if activeRecord?.dobel_proyek_flag}
															<span class="text-[10px] text-red-600 font-semibold flex items-center gap-0.5">
																⚠ Dobel Proyek ({activeRecord.dobel_proyek_proyek_lain_nama || 'proyek lain'})
															</span>
														{/if}
													</div>
												</div>
											</div>

											<!-- Attendance Status Actions -->
											<div class="flex items-center gap-1.5 self-end sm:self-center shrink-0">
												<button 
													type="button"
													class="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition {isPresent && !isStandby ? 'bg-emerald-600 text-white shadow-xs' : 'bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-slate-800 dark:text-slate-300'}"
													onclick={() => toggleWorkerAttendance(worker, 'hadir')}
												>
													<IconCheck size={13} /> Hadir
												</button>
												<button 
													type="button"
													class="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1 transition {isPresent && isStandby ? 'bg-amber-500 text-white shadow-xs' : 'bg-gray-100 hover:bg-gray-200 text-gray-700 dark:bg-slate-800 dark:text-slate-300'}"
													onclick={() => toggleWorkerAttendance(worker, 'standby')}
												>
													Standby
												</button>
												{#if isPresent}
													<button 
														type="button"
														class="p-1 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition"
														title="Tandai tidak hadir / hapus presensi"
														onclick={() => toggleWorkerAttendance(worker, 'absen')}
													>
														<IconTrash size={15} />
													</button>
												{/if}
											</div>
										</div>

										<!-- Expanded Details when Hadir -->
										{#if isPresent && !isStandby}
											<div class="mt-2.5 pt-2.5 border-t border-emerald-100 dark:border-emerald-900/30 grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
												<!-- Jam Kerja Stepper -->
												<div class="sm:col-span-4 flex items-center gap-1.5">
													<span class="text-[11px] font-medium text-gray-600 dark:text-slate-400 w-16 shrink-0">Jam Kerja:</span>
													<div class="flex items-center border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 overflow-hidden">
														<button 
															type="button" 
															class="w-7 h-7 flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition"
															onclick={() => stepWorkerHours(worker.id, -1)}
														>
															<IconMinus size={12} />
														</button>
														<input 
															type="number" 
															value={activeRecord.jam} 
															min="0" 
															max="24" 
															step="0.5" 
															class="w-11 h-7 text-center text-xs font-bold bg-transparent border-x border-gray-200 dark:border-slate-700 text-gray-900 dark:text-white focus:outline-none"
															onchange={(e) => updateWorkerField(worker.id, 'jam', Number(e.currentTarget.value) || 0)}
														/>
														<button 
															type="button" 
															class="w-7 h-7 flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-slate-700 transition"
															onclick={() => stepWorkerHours(worker.id, 1)}
														>
															<IconPlus size={12} />
														</button>
													</div>
													<span class="text-[11px] text-gray-500">jam</span>
												</div>

												<!-- Lembur OT Stepper & Presets -->
												<div class="sm:col-span-5 flex items-center gap-1.5">
													<span class="text-[11px] font-medium text-gray-600 dark:text-slate-400 w-12 shrink-0">Lembur:</span>
													<input 
														type="number" 
														value={activeRecord.ot_hours} 
														min="0" 
														max="24" 
														step="0.5" 
														class="w-12 h-7 px-1 text-center text-xs font-bold border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-white focus:outline-none"
														onchange={(e) => updateWorkerField(worker.id, 'ot_hours', Number(e.currentTarget.value) || 0)}
													/>
													<div class="flex items-center gap-1">
														{#each [1, 2, 3, 4] as otVal}
															<button 
																type="button" 
																class="h-7 px-1.5 rounded text-[10px] font-bold transition {Number(activeRecord.ot_hours) === otVal ? 'bg-amber-500 text-white shadow-xs' : 'bg-gray-100 hover:bg-amber-100 text-gray-600 dark:bg-slate-800 dark:text-slate-300'}"
																onclick={() => setWorkerOtPreset(worker.id, otVal)}
															>
																+{otVal}j
															</button>
														{/each}
													</div>
												</div>

												<!-- Libur Toggle -->
												<div class="sm:col-span-3 flex items-center justify-start sm:justify-end gap-1.5">
													<label class="flex items-center gap-1.5 text-[11px] text-gray-700 dark:text-slate-300 cursor-pointer select-none">
														<input 
															type="checkbox" 
															checked={activeRecord.is_holiday} 
															class="w-3.5 h-3.5 rounded text-emerald-600 focus:ring-emerald-500"
															onchange={(e) => updateWorkerField(worker.id, 'is_holiday', e.currentTarget.checked)}
														/>
														<span>Libur (1.5x)</span>
													</label>
												</div>

												<!-- Notes Input -->
												<div class="sm:col-span-12 mt-1">
													<input 
										type="text" 
														value={activeRecord.notes || ''} 
														placeholder="Catatan aktivitas / penugasan khusus pekerja ini (opsional)..." 
														class="w-full px-2.5 py-1 text-[11px] bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 text-gray-800 dark:text-gray-200"
														oninput={(e) => updateWorkerField(worker.id, 'notes', e.currentTarget.value)}
													/>
												</div>
											</div>
										{/if}

										<!-- Expanded Details when Standby -->
										{#if isPresent && isStandby}
											<div class="mt-2.5 pt-2 border-t border-amber-100 dark:border-amber-900/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
												<span class="text-[11px] text-amber-800 dark:text-amber-300 font-medium">
													Pekerja tercatat Standby (0 jam kerja, standby rate).
												</span>
												<input 
													type="text" 
													value={activeRecord.notes || ''} 
													placeholder="Alasan standby (opsional)..." 
													class="w-full sm:w-64 px-2.5 py-1 text-[11px] bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-900/40 rounded-lg focus:outline-none text-gray-800 dark:text-gray-200"
													oninput={(e) => updateWorkerField(worker.id, 'notes', e.currentTarget.value)}
												/>
											</div>
										{/if}
									</div>
								{/each}
							</div>
							
							<p class="text-[10px] text-gray-500 dark:text-slate-400 mt-2.5 leading-tight">
								Daftar hanya menampilkan pekerja dengan penugasan aktif (SPK) di proyek ini. <span class="text-red-500">Jika nama pekerja tidak muncul, hubungi admin untuk mendaftarkan SPK penugasan baru.</span>
							</p>
						{/if}
					{/if}
				</div>

				<!-- Dokumentasi Absensi -->
				<div class="card-section mt-4">
					<div class="flex items-center justify-between mb-3">
						<h4 class="m-0 flex items-center gap-2 text-sm font-bold text-gray-900 dark:text-white">
							<IconCamera size={16} class="text-[var(--g)]" /> Foto Bukti Absensi <span style="color: var(--re)">*</span>
						</h4>
						{#if existingAttendancePhotos.length + reportData.attendance_photos.length > 0}
							<span class="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
								{existingAttendancePhotos.length + reportData.attendance_photos.length} foto dilampirkan
							</span>
						{/if}
					</div>

					{#if existingAttendancePhotos.length > 0}
						<div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
							{#each existingAttendancePhotos as id}
								<div class="relative group aspect-square border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden bg-gray-50 dark:bg-slate-800 shadow-xs">
									<img use:secureAssetSrc={id} alt="Absensi" class="w-full h-full object-cover" />
									<button 
										type="button" 
										class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white cursor-pointer"
										onclick={() => openPhotoPreview(id)}
										title="Klik untuk memperbesar"
									>
										<IconZoomIn size={22} />
									</button>
									<span class="absolute bottom-1.5 left-1.5 text-[9px] font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded">
										Tersimpan
									</span>
									{#if !isLocked}
										<button 
											type="button"
											class="absolute top-1.5 right-1.5 w-7 h-7 bg-black/60 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors z-10 cursor-pointer" 
											onclick={() => removeExistingAttendancePhoto(id)}
											title="Hapus foto tersimpan"
										>
											<IconTrash size={14} />
										</button>
									{/if}
								</div>
							{/each}
						</div>
					{/if}

					{#if reportData.attendance_photos.length > 0}
						<div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
							{#each reportData.attendance_photos as photo, idx}
								<div class="relative aspect-square border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden bg-gray-50 dark:bg-slate-800 shadow-xs">
									<img src={photo.url} alt="Absensi" class="w-full h-full object-cover" />
									{#if !isLocked}
										<button class="absolute top-1.5 right-1.5 w-7 h-7 bg-black/60 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors" onclick={() => removeAttendancePhoto(idx)}>
											<IconTrash size={14} />
										</button>
									{/if}
								</div>
							{/each}
						</div>
					{/if}

					{#if !isLocked}
						<div class="border-2 border-dashed border-[var(--g)] bg-[var(--gl)]/20 hover:bg-[var(--gl)]/40 rounded-xl p-5 text-center cursor-pointer transition-colors relative">
							<input type="file" accept="image/*" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange={handleAttendancePhoto} />
							<div class="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-300 flex items-center justify-center mx-auto mb-2">
								<IconCamera size={20} />
							</div>
							<p class="text-xs text-[var(--gd)] dark:text-emerald-300 font-semibold mb-0.5">Ambil Foto / Pilih Bukti Absensi</p>
							<p class="text-[10px] text-gray-500 dark:text-slate-400">Foto selfie / presensi fisik pekerja di lapangan</p>
						</div>
					{:else if existingAttendancePhotos.length === 0 && reportData.attendance_photos.length === 0}
						<p class="text-[12px] text-gray-400 text-center py-3">Tidak ada foto yang dilampirkan.</p>
					{/if}
				</div>
			{/if}

			{#if activeTab === 'peralatan'}
				<!-- Ringkasan Peralatan & Checklist P2H (Equipment Overview Card) -->
				<div class="card-section mb-4 overflow-hidden border border-sky-500/20 bg-gradient-to-br from-sky-950/10 via-slate-900/40 to-slate-900/60 shadow-sm" style="background: var(--sys-fill)">
					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-200/50 dark:border-slate-800">
						<div class="flex items-center gap-2">
							<div class="w-8 h-8 rounded-lg bg-sky-500/10 dark:bg-sky-500/20 text-sky-600 dark:text-sky-400 flex items-center justify-center">
								<IconTool size={18} />
							</div>
							<div>
								<h4 class="text-[14px] font-bold text-gray-900 dark:text-white m-0 flex items-center gap-1.5" style="color: var(--sys-label)">
									Kondisi Peralatan & Checklist P2H
								</h4>
								<p class="text-[11px] text-gray-500 dark:text-slate-400 m-0" style="color: var(--sys-label3)">
									Monitoring unit alat proyek & status kelaikan operasional harian
								</p>
							</div>
						</div>
						<div class="flex items-center gap-2 self-start sm:self-auto">
							<button
								type="button"
								class="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-750 flex items-center gap-1.5 shadow-2xs transition-all active:scale-95 cursor-pointer"
								onclick={refreshEquipmentP2h}
								disabled={loadingEquipmentP2h}
								title="Muat ulang status P2H dari server"
							>
								<IconRefresh size={13} class={loadingEquipmentP2h ? 'animate-spin text-sky-500' : ''} />
								<span>{loadingEquipmentP2h ? 'Memperbarui...' : 'Segarkan Status'}</span>
							</button>
						</div>
					</div>

					<!-- Metrik Ringkas Kesiapan Peralatan -->
					<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3.5 pt-1 text-[11px]">
						<div class="p-2.5 rounded-lg bg-gray-50/80 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-800">
							<span class="text-gray-400 dark:text-slate-500 block mb-0.5 font-medium">Total Unit Proyek</span>
							<strong class="text-[14px] text-gray-800 dark:text-slate-100">
								{equipmentStats.total} unit
							</strong>
						</div>
						<div class="p-2.5 rounded-lg bg-gray-50/80 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-800">
							<span class="text-gray-400 dark:text-slate-500 block mb-0.5 font-medium">Sudah Diperiksa (P2H)</span>
							<strong class="text-[14px] {equipmentStats.checked === equipmentStats.total && equipmentStats.total > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-sky-600 dark:text-sky-400'}">
								{equipmentStats.checked} / {equipmentStats.total} unit
							</strong>
						</div>
						<div class="p-2.5 rounded-lg bg-gray-50/80 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-800">
							<span class="text-gray-400 dark:text-slate-500 block mb-0.5 font-medium">Belum P2H Hari Ini</span>
							<strong class="text-[14px] {equipmentStats.unChecked > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400'}">
								{equipmentStats.unChecked} unit
							</strong>
						</div>
						<div class="p-2.5 rounded-lg bg-gray-50/80 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-800">
							<span class="text-gray-400 dark:text-slate-500 block mb-0.5 font-medium">Status Kelaikan</span>
							<div class="flex items-center gap-1.5 mt-0.5">
								<span class="text-[12px] font-bold text-emerald-600 dark:text-emerald-400">
									{equipmentStats.go} Go
								</span>
								{#if equipmentStats.noGo > 0}
									<span class="text-gray-300">•</span>
									<span class="text-[12px] font-bold text-red-600 dark:text-red-400">
										{equipmentStats.noGo} No-Go
									</span>
								{/if}
							</div>
						</div>
					</div>
				</div>

				<!-- Section: Daftar Kartu Peralatan -->
				<div class="card-section">
					<div class="flex items-center justify-between mb-3">
						<h4 class="m-0 flex items-center gap-1.5">
							<IconTool size={16} class="text-[var(--g)]" /> 
							<span>Daftar Unit & Hasil Pemeriksaan</span>
						</h4>
						<span class="text-[11px] text-gray-500 dark:text-slate-400">
							{projectEquipmentP2h.length} unit terdaftar
						</span>
					</div>

					{#if isLocked}
						<!-- VIEW MODE (Laporan Tersimpan) -->
						{#if reportData.tools.length === 0 || (reportData.tools.length === 1 && !reportData.tools[0].name && !reportData.tools[0].equipment_id)}
							<div class="text-center py-8 px-4 rounded-xl border border-dashed border-gray-200 dark:border-slate-800">
								<IconTool size={32} class="text-gray-300 dark:text-slate-600 mx-auto mb-2" />
								<p class="text-[13px] font-semibold text-gray-700 dark:text-slate-300 m-0">Tidak ada data unit peralatan.</p>
								<p class="text-[11px] text-gray-400 mt-1 m-0">Tidak ada unit equipment yang tercatat pada laporan ini.</p>
							</div>
						{:else}
							<div class="space-y-3">
								{#each reportData.tools as item}
									<div class="p-3.5 rounded-xl border border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-850/50 flex flex-col gap-3">
										<div class="flex items-start justify-between gap-2">
											<div>
												<div class="flex items-center gap-2 flex-wrap">
													<p class="text-[14px] font-bold text-gray-900 dark:text-white m-0">
														{item.name || item.raw_name || 'Unit Alat'}
													</p>
													{#if item.category}
														<span class="text-[10px] px-2 py-0.5 rounded-md bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 font-medium">
															{item.category}
														</span>
													{/if}
													{#if item.is_loan}
														<span class="text-[10px] px-2 py-0.5 rounded-md bg-sky-50 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800 font-medium">
															Pinjaman Internal
														</span>
													{/if}
												</div>
												{#if item.operator}
													<p class="text-[11px] text-gray-500 dark:text-slate-400 mt-1 m-0">
														Operator: <strong class="text-gray-700 dark:text-slate-200">{item.operator}</strong>
													</p>
												{/if}
											</div>
											<div class="flex items-center gap-2 shrink-0">
												{#if item.p2h_result}
													<span class="text-[11px] font-bold px-2.5 py-1 rounded-full border {item.p2h_result === 'Go' ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800' : 'bg-red-50 text-red-700 border-red-300 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800'}">
														{item.p2h_result === 'Go' ? '🟢 Go (Siap)' : '🔴 No-Go'}
													</span>
												{:else}
													<span class="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400 border border-gray-200 dark:border-slate-700">
														Belum P2H
													</span>
												{/if}
											</div>
										</div>

										<div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px] pt-2 border-t border-gray-100 dark:border-slate-800">
											{#if item.status_unit}
												<div>
													<span class="text-gray-400 block text-[10px]">Kondisi Unit:</span>
													<strong class={getUnitConditionLabel(item.status_unit).color}>
														{getUnitConditionLabel(item.status_unit).label}
													</strong>
												</div>
											{/if}
											{#if item.hoursmeter != null}
												<div>
													<span class="text-gray-400 block text-[10px]">Jam Kerja (HM):</span>
													<strong class="text-gray-800 dark:text-slate-200">{item.hoursmeter} HM</strong>
												</div>
											{/if}
										</div>

										{#if item.keterangan}
											<div class="p-2 rounded-lg bg-white dark:bg-slate-900 border border-gray-100 dark:border-slate-800 text-[11px] text-gray-600 dark:text-slate-300">
												<span class="font-semibold text-gray-700 dark:text-slate-200">Catatan Temuan:</span> {item.keterangan}
											</div>
										{/if}

										{#if item.equipment_id}
											<div class="pt-1 flex justify-end">
												<a
													href="/preventive/riwayat/{item.equipment_id}"
													target="_blank"
													class="text-[11px] font-semibold text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1"
												>
													<IconEye size={13} />
													<span>Buka Riwayat & Catatan Alat ➔</span>
												</a>
											</div>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
					{:else}
						<!-- EDIT MODE (Form Input Laporan) -->
						{#if loadingEquipmentP2h}
							<div class="py-10 flex justify-center">
								<CircularProgressGauge size={64} strokeWidth={5} label="Memuat Data Equipment & P2H..." sublabel="Sinkronisasi status alat & armada proyek" />
							</div>
						{:else if projectEquipmentP2h.length === 0}
							<div class="text-center py-8 px-4 rounded-xl border border-dashed border-gray-200 dark:border-slate-800 bg-gray-50/50 dark:bg-slate-850/50">
								<IconTool size={36} class="text-gray-300 dark:text-slate-600 mx-auto mb-2" />
								<p class="text-[13px] font-bold text-gray-800 dark:text-slate-200 m-0">Tidak ada unit yang ditugaskan ke proyek ini.</p>
								<p class="text-[11px] text-gray-500 dark:text-slate-400 mt-1 mb-3">
									Unit equipment dapat ditugaskan dari menu Maintenance/Logistik atau melalui Surat Jalan Peminjaman Internal (SJI).
								</p>
								<a
									href="/preventive"
									target="_blank"
									class="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-750 transition-colors"
								>
									<IconExternalLink size={13} />
									<span>Buka Menu Preventive / P2H Umum</span>
								</a>
							</div>
						{:else}
							<div class="space-y-3.5">
								{#each projectEquipmentP2h as eq}
									{@const opBadge = getOperationalStatusBadge(eq.statusOperational)}
									{@const condLabel = getUnitConditionLabel(eq.statusUnit)}
									<div class="border {eq.hasSession ? (eq.result === 'Go' ? 'border-emerald-200 dark:border-emerald-900/60 bg-white dark:bg-slate-850' : 'border-red-200 dark:border-red-900/60 bg-red-50/20 dark:bg-slate-850') : 'border-amber-200 dark:border-amber-900/50 bg-amber-50/20 dark:bg-slate-850'} rounded-xl p-3.5 shadow-2xs relative space-y-3">
										
										<!-- Card Top Header -->
										<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-gray-100 dark:border-slate-800">
											<div class="flex items-center gap-2 flex-wrap min-w-0">
												{#if eq.code}
													<span class="text-[11px] font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
														{eq.code}
													</span>
												{/if}
												<h5 class="text-[14px] font-bold text-gray-900 dark:text-white m-0 truncate">
													{eq.name}
												</h5>
												{#if eq.categoryName}
													<span class="text-[10px] font-medium px-2 py-0.5 rounded-md bg-gray-100 dark:bg-slate-750 text-gray-600 dark:text-slate-300">
														{eq.categoryName}
													</span>
												{/if}
												{#if eq.isLoan}
													<span class="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-sky-50 dark:bg-sky-950/50 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800/60">
														Pinjaman SJI
													</span>
												{/if}
											</div>

											<!-- Status Operasional Tag -->
											<div class="flex items-center gap-2 shrink-0">
												{#if eq.sesiTerbuka}
													<span class="text-[10px] font-bold px-2 py-0.5 rounded-full border bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800" title="P2H sudah diisi tapi belum ditutup di akhir pemakaian">
														⏳ Belum Ditutup
													</span>
												{/if}
												<span class="text-[10px] font-bold px-2 py-0.5 rounded-full border {opBadge.bg}">
													{opBadge.label}
												</span>
											</div>
										</div>

										<!-- Card Info Grid: Operator, HM, Kondisi -->
										<div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
											<div class="p-2 rounded-lg bg-gray-50/80 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-800">
												<span class="text-gray-400 dark:text-slate-500 block text-[10px] mb-0.5">Operator / Pemeriksa:</span>
												<strong class="text-gray-800 dark:text-slate-200 font-semibold truncate block">
													{eq.operatorName || (eq.hasSession ? 'Operator Lapangan' : 'Belum Diperiksa')}
												</strong>
											</div>

											<div class="p-2 rounded-lg bg-gray-50/80 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-800">
												<span class="text-gray-400 dark:text-slate-500 block text-[10px] mb-0.5">Jam Operasi (HM):</span>
												<strong class="text-gray-800 dark:text-slate-200 font-semibold block">
													{#if eq.hoursmeter != null}
														<span class="text-emerald-600 dark:text-emerald-400">{eq.hoursmeter} HM (Hari Ini)</span>
													{:else if eq.lastHoursmeter != null}
														<span>{eq.lastHoursmeter} HM (Terakhir)</span>
													{:else}
														<span class="text-gray-400">-</span>
													{/if}
												</strong>
											</div>

											{#if eq.hasSession && eq.statusUnit}
												<div class="p-2 rounded-lg bg-gray-50/80 dark:bg-slate-800/40 border border-gray-100 dark:border-slate-800 col-span-2 sm:col-span-1">
													<span class="text-gray-400 dark:text-slate-500 block text-[10px] mb-0.5">Hasil Pemeriksaan:</span>
													<strong class="{condLabel.color} font-semibold block truncate">
														{condLabel.label}
													</strong>
												</div>
											{/if}
										</div>

										<!-- P2H Status Banner & Interactive Action -->
										{#if !eq.hasSession}
											<!-- Belum P2H Alert & Action -->
											<div class="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
												<div class="flex items-center gap-2">
													<IconAlertTriangle size={18} class="text-amber-600 dark:text-amber-400 shrink-0" />
													<div>
														<p class="text-[12px] font-bold text-amber-900 dark:text-amber-200 m-0">
															Belum Ada Checklist P2H Hari Ini
														</p>
														<p class="text-[10.5px] text-amber-700 dark:text-amber-400 m-0">
															Lakukan inspeksi harian sebelum alat dioperasikan di lapangan.
														</p>
													</div>
												</div>
												<a
													href="/preventive/p2h/{eq.equipmentId}"
													target="_blank"
													class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-bold text-[12px] shadow-sm transition-all shrink-0 cursor-pointer text-decoration-none"
												>
													<IconListCheck size={14} />
													<span>Isi Checklist P2H ➔</span>
												</a>
											</div>
										{:else}
											<!-- Sudah P2H Card Section -->
											<div class="p-3 rounded-xl {eq.result === 'Go' ? 'bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/60' : 'bg-red-50/60 dark:bg-red-950/30 border border-red-200 dark:border-red-800/60'} flex flex-col gap-2.5">
												<div class="flex items-center justify-between gap-2 flex-wrap">
													<div class="flex items-center gap-2">
														{#if eq.result === 'Go'}
															<span class="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-600 text-white flex items-center gap-1">
																<IconCheck size={12} /> Go (Siap Digunakan)
															</span>
														{:else}
															<span class="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-red-600 text-white flex items-center gap-1">
																<IconX size={12} /> No-Go (Ada Kendala)
															</span>
														{/if}
														<span class="text-[11px] text-gray-600 dark:text-slate-300 font-medium">
															Tercatat untuk tanggal {reportData.date}
														</span>
													</div>

													<a
														href="/preventive/riwayat/{eq.equipmentId}"
														target="_blank"
														class="text-[11px] font-semibold text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1"
													>
														<IconEye size={13} />
														<span>Riwayat Alat ➔</span>
													</a>
												</div>

												{#if eq.keterangan}
													<div class="p-2 rounded-lg bg-white/80 dark:bg-slate-900/80 border border-gray-200/60 dark:border-slate-800 text-[11px] text-gray-700 dark:text-slate-300">
														<strong class="text-gray-900 dark:text-white">Catatan Temuan:</strong> {eq.keterangan}
													</div>
												{/if}

												{#if eq.fotoUnit}
													<div class="flex items-center gap-2 pt-1">
														<div class="relative w-14 h-14 rounded-lg overflow-hidden border border-gray-200 dark:border-slate-700 bg-gray-100 shrink-0 group">
															<img use:secureAssetSrc={eq.fotoUnit} alt="Foto Unit" class="w-full h-full object-cover" />
															<button
																type="button"
																class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white cursor-pointer"
																onclick={() => openPhotoPreview(eq.fotoUnit!)}
																title="Lihat foto unit"
															>
																<IconZoomIn size={16} />
															</button>
														</div>
														<div class="text-[10.5px] text-gray-500 dark:text-slate-400">
															<span>Foto bukti unit terlampir saat inspeksi P2H.</span>
															<button
																type="button"
																class="text-sky-600 dark:text-sky-400 hover:underline block font-semibold cursor-pointer"
																onclick={() => openPhotoPreview(eq.fotoUnit!)}
															>
																Klik untuk perbesar foto
															</button>
														</div>
													</div>
												{/if}
											</div>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
					{/if}
				</div>
			{/if}

			{#if activeTab === 'keuangan'}
				<!-- Catatan Budget & Breakdown Keuangan -->
				<div class="card-section">
					<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 pb-2 border-b border-gray-100 dark:border-slate-800">
						<div>
							<h4 class="m-0 flex items-center gap-2 text-[15px] font-bold text-gray-900 dark:text-white">
								<IconReceipt size={18} class="text-[var(--g)]" />
								Catatan & Breakdown Keuangan Proyek
							</h4>
							<p class="text-[11px] text-gray-500 dark:text-slate-400 mt-0.5 m-0">
								Pencatatan realisasi dana kas proyek (PA/Kasbon) & pengajuan reimbursement harian lapangan.
							</p>
						</div>
						<div class="flex items-center gap-2 self-start sm:self-auto">
							<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-slate-300 border border-gray-200 dark:border-slate-700 font-mono">
								PROYEK #{projectId}
							</span>
						</div>
					</div>

					<!-- 4-KARTU RINGKASAN METRIK KEUANGAN REAL-TIME -->
					<div class="grid grid-cols-2 lg:grid-cols-4 gap-2.5 mb-4">
						<!-- Card 1: Total Hari Ini -->
						<div class="p-3 rounded-xl border bg-white dark:bg-slate-850 shadow-2xs" style="border-color: var(--sys-sep)">
							<div class="flex items-center justify-between gap-1 mb-1">
								<span class="text-[11px] font-semibold text-gray-500 dark:text-slate-400 flex items-center gap-1">
									<IconCash size={14} class="text-blue-500" /> Total Hari Ini
								</span>
								<span class="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/50">
									{reportData.budget_items.length} item
								</span>
							</div>
							<p class="text-[15px] sm:text-[16px] font-extrabold text-gray-900 dark:text-white truncate m-0 font-mono">
								{formatRupiah(totalSpentToday)}
							</p>
							<p class="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5 m-0">Gabungan semua pos</p>
						</div>

						<!-- Card 2: Reimbursement -->
						<div class="p-3 rounded-xl border bg-amber-50/50 dark:bg-amber-950/20 border-amber-200/80 dark:border-amber-900/40 shadow-2xs">
							<div class="flex items-center justify-between gap-1 mb-1">
								<span class="text-[11px] font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-1">
									<IconCreditCard size={14} class="text-amber-600" /> Reimburse (Pribadi)
								</span>
								<span class="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200">
									{reimburseItemsCount}
								</span>
							</div>
							<p class="text-[15px] sm:text-[16px] font-extrabold text-amber-700 dark:text-amber-400 truncate m-0 font-mono">
								{formatRupiah(totalReimburseToday)}
							</p>
							<p class="text-[10px] text-amber-600/80 dark:text-amber-400/70 mt-0.5 m-0">Draft Invoice AP Otomatis</p>
						</div>

						<!-- Card 3: Kas Anggaran Proyek -->
						<div class="p-3 rounded-xl border bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200/80 dark:border-emerald-900/40 shadow-2xs">
							<div class="flex items-center justify-between gap-1 mb-1">
								<span class="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1">
									<IconBuildingBank size={14} class="text-emerald-600" /> Kas Anggaran (PA)
								</span>
								<span class="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200">
									{budgetExpenseItemsCount}
								</span>
							</div>
							<p class="text-[15px] sm:text-[16px] font-extrabold text-emerald-700 dark:text-emerald-400 truncate m-0 font-mono">
								{formatRupiah(totalBudgetExpenseToday)}
							</p>
							<p class="text-[10px] text-emerald-600/80 dark:text-emerald-400/70 mt-0.5 m-0">Pemakaian kasbon proyek</p>
						</div>

						<!-- Card 4: Sisa Kas Tersedia -->
						<div class="p-3 rounded-xl border bg-slate-50 dark:bg-slate-800/60 shadow-2xs" style="border-color: var(--sys-sep)">
							<div class="flex items-center justify-between gap-1 mb-1">
								<span class="text-[11px] font-semibold text-gray-500 dark:text-slate-400 flex items-center gap-1">
									<IconWallet size={14} class="text-purple-500" /> Sisa Kas Anggaran
								</span>
								<span class="text-[10px] px-1.5 py-0.2 rounded-full font-bold bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-300">
									{budgetExpenses.length} pos
								</span>
							</div>
							<p class="text-[15px] sm:text-[16px] font-extrabold text-gray-800 dark:text-slate-100 truncate m-0 font-mono">
								{formatRupiah(Math.max(0, totalAvailableBudgetPool - totalBudgetExpenseToday))}
							</p>
							<p class="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5 m-0">Plafon kas disetujui</p>
						</div>
					</div>

					<!-- BANNER PANDUAN PENDANAAN & SHORTCUT PENGAJUAN BARU -->
					<div class="p-3.5 rounded-xl border border-blue-200/70 bg-blue-50/40 dark:bg-blue-950/20 dark:border-blue-900/40 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
						<div class="flex items-start gap-2.5">
							<div class="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/50 flex items-center justify-center shrink-0 text-blue-600 dark:text-blue-400 mt-0.5">
								<IconInfoCircle size={18} />
							</div>
							<div class="text-[12px] text-gray-600 dark:text-gray-300">
								<p class="font-bold text-gray-900 dark:text-white m-0">Alur Pendanaan Lapangan:</p>
								<ul class="list-disc list-inside mt-1 space-y-0.5 text-[11.5px] text-gray-600 dark:text-gray-300 m-0">
									<li>
										<strong class="text-amber-700 dark:text-amber-400">💳 Uang Pribadi (Reimbursement)</strong>: Talangan dana pribadi oleh leader/pekerja. Otomatis dibuatkan <em>Invoice Reimbursement (AP)</em> ke Finance saat laporan dikirim. <span class="text-red-500 font-semibold">*Wajib foto nota</span>.
									</li>
									<li>
										<strong class="text-emerald-700 dark:text-emerald-400">🏢 Kas Anggaran Proyek (PA)</strong>: Realisasi pemakaian dana kasbon/anggaran proyek yang sudah disetujui Finance sebelumnya.
									</li>
								</ul>
							</div>
						</div>
						<a
							href={`/anggaran/baru?project_id=${projectId}`}
							target="_blank"
							rel="noreferrer"
							class="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold shrink-0 shadow-2xs transition-all active:scale-95 text-center no-underline"
						>
							<IconPlus size={14} /> Ajukan Kasbon / PA Baru <IconArrowUpRight size={13} />
						</a>
					</div>

					<!-- CATATAN UMUM & FOTO NOTA UTAMA (REKAP/GABUNGAN) -->
					<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
						<!-- Catatan Umum -->
						<div>
							<label class="f-label">Catatan Umum Pengeluaran</label>
							{#if isLocked}
								{#if reportData.budget_notes}
									<p class="text-[13px] text-gray-700 dark:text-slate-300 leading-relaxed p-3 bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-750 m-0">
										{reportData.budget_notes}
									</p>
								{:else}
									<p class="text-[12px] text-gray-400 text-center py-4 bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-750 m-0">
										Tidak ada catatan umum.
									</p>
								{/if}
							{:else}
								<textarea
									bind:value={reportData.budget_notes}
									rows="3"
									class="f-textarea"
									placeholder="Contoh: Bensin genset dan konsumsi lembur ditalangi leader via transfer, nota asli fisik terlampir lengkap..."
								></textarea>
							{/if}
						</div>

						<!-- Foto Nota Utama / Rekap Gabungan -->
						<div>
							<label class="f-label">Foto Nota / Kwitansi (Utama / Gabungan)</label>
							{#if existingBudgetReceipt}
								<div class="relative aspect-[16/9] max-w-sm border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden bg-gray-50 dark:bg-slate-800 mb-2 group">
									<img use:secureAssetSrc={existingBudgetReceipt} alt="Nota Utama" class="w-full h-full object-contain" />
									<button
										type="button"
										class="absolute top-2 right-2 px-2 py-1 rounded-lg bg-black/60 hover:bg-black/80 text-white text-[11px] font-semibold flex items-center gap-1 transition-all cursor-pointer"
										onclick={() => openReceiptModal(existingBudgetReceipt!, 'Foto Nota Utama (Tersimpan)', true)}
									>
										<IconZoomIn size={13} /> Zoom
									</button>
								</div>
							{/if}
							{#if budgetReceiptFile}
								<div class="relative aspect-[16/9] max-w-sm border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden bg-gray-50 dark:bg-slate-800 mb-2 group">
									<img src={budgetReceiptFile.url} alt="Nota Utama" class="w-full h-full object-contain" />
									<div class="absolute top-2 right-2 flex items-center gap-1.5">
										<button
											type="button"
											class="px-2 py-1 rounded-lg bg-black/60 hover:bg-black/80 text-white text-[11px] font-semibold flex items-center gap-1 transition-all cursor-pointer"
											onclick={() => openReceiptModal(budgetReceiptFile!.url, budgetReceiptFile!.name, false)}
										>
											<IconZoomIn size={13} /> Zoom
										</button>
										{#if !isLocked}
											<button
												type="button"
												class="w-7 h-7 bg-red-600 hover:bg-red-700 text-white rounded-lg flex items-center justify-center transition-colors cursor-pointer"
												onclick={() => budgetReceiptFile = null}
												title="Hapus foto nota utama"
											>
												<IconTrash size={14} />
											</button>
										{/if}
									</div>
								</div>
							{/if}
							{#if !isLocked}
								<div class="border border-dashed border-[var(--g)] bg-[var(--gl)]/20 dark:bg-emerald-950/20 rounded-xl p-3.5 text-center cursor-pointer hover:bg-[var(--gl)]/40 transition-colors relative">
									<input
										type="file"
										accept="image/*"
										class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
										onchange={handleMainBudgetReceipt}
									/>
									<IconCamera size={22} class="text-[var(--g)] mx-auto" />
									<p class="text-[12px] text-[var(--gd)] dark:text-emerald-400 mt-1 font-semibold m-0">
										{budgetReceiptFile ? 'Ganti Foto Nota Utama' : 'Tap untuk memotret / unggah nota utama'}
									</p>
									<p class="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5 m-0">Otomatis diberi cap GPS & Waktu</p>
								</div>
							{:else if !existingBudgetReceipt && !budgetReceiptFile}
								<p class="text-[12px] text-gray-400 text-center py-4 bg-gray-50 dark:bg-slate-800 rounded-xl border border-gray-100 dark:border-slate-750 m-0">
									Tidak ada nota utama yang dilampirkan.
								</p>
							{/if}
						</div>
					</div>

					<!-- BREAKDOWN RINCIAN PENGELUARAN ANGGARAN -->
					<div class="border-t border-gray-100 dark:border-slate-800 pt-4 mt-4">
						<div class="flex items-center justify-between gap-2 mb-3">
							<h5 class="text-[13px] font-bold text-gray-800 dark:text-slate-200 m-0 flex items-center gap-1.5">
								<IconListCheck size={16} class="text-gray-500 dark:text-slate-400" />
								Rincian Item Pengeluaran
							</h5>
							<div class="flex items-center gap-2">
								<span class="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
									Total: {formatRupiah(totalSpentToday)}
								</span>
							</div>
						</div>

						{#if isLocked}
							<!-- VIEW MODE (LAPORAN TERKUNCI / HISTORI) -->
							{#if reportData.budget_items.length === 0}
								<p class="text-[12px] text-gray-400 text-center py-6 bg-gray-50 dark:bg-slate-800/40 rounded-xl border border-gray-100 dark:border-slate-750">
									Tidak ada rincian pengeluaran yang dicatat.
								</p>
							{:else}
								<div class="space-y-2.5">
									{#each reportData.budget_items as item, idx}
										<div class="p-3.5 rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-850 shadow-2xs">
											<div class="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
												<div class="flex-1 min-w-0">
													<div class="flex items-center gap-2 flex-wrap mb-1">
														<span class="text-[11px] font-bold px-2 py-0.5 rounded-md bg-gray-100 dark:bg-slate-750 text-gray-700 dark:text-slate-300">
															#{idx + 1}
														</span>
														{#if item.expense_id === 'REIMBURSE'}
															<span class="text-[10px] px-2 py-0.5 bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 rounded font-bold border border-amber-200 dark:border-amber-800">
																💳 Reimbursement
															</span>
														{:else}
															<span class="text-[10px] px-2 py-0.5 bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-300 rounded font-bold border border-blue-200 dark:border-blue-800">
																🏢 Kas Anggaran {item.reference_number ? `(${item.reference_number})` : ''}
															</span>
														{/if}
														{#if item.expense_category}
															<span class="text-[10px] px-2 py-0.5 bg-gray-100 dark:bg-slate-750 text-gray-600 dark:text-slate-300 rounded font-medium">
																{getCategoryLabel(item.expense_category)}
															</span>
														{/if}
													</div>
													<p class="text-[13px] font-semibold text-gray-800 dark:text-slate-200 m-0">
														{item.description || '-'}
													</p>
												</div>
												<div class="text-right shrink-0">
													<span class="text-[15px] font-extrabold text-[var(--g)] font-mono">
														{formatRupiah(item.spent_amount || 0)}
													</span>
												</div>
											</div>

											{#if item.receipt_id}
												<div class="mt-2.5 pt-2.5 border-t border-gray-100 dark:border-slate-800 flex items-center gap-3">
													<div class="w-16 h-12 border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden bg-gray-50 dark:bg-slate-800 shrink-0">
														<img use:secureAssetSrc={item.receipt_id} alt="Nota" class="w-full h-full object-cover" />
													</div>
													<button
														type="button"
														class="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
														onclick={() => openReceiptModal(item.receipt_id, `Nota Item #${idx + 1}: ${item.description || ''}`, true)}
													>
														<IconZoomIn size={13} /> Lihat Foto Nota Penuh
													</button>
												</div>
											{/if}
										</div>
									{/each}
								</div>
							{/if}
						{:else}
							<!-- EDIT MODE -->
							{#if budgetExpenses.length === 0}
								<div class="p-3 rounded-xl bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 text-[11px] text-amber-800 dark:text-amber-300 mb-3 flex items-center justify-between gap-2 flex-wrap">
									<span class="flex items-center gap-1.5 font-medium">
										<IconAlertCircle size={15} class="text-amber-600 shrink-0" />
										Belum ada kasbon/PA proyek yang disetujui. Pengeluaran lapangan dapat dicatat sebagai <strong>Uang Pribadi / Reimbursement</strong>.
									</span>
									<a
										href={`/anggaran/baru?project_id=${projectId}`}
										target="_blank"
										rel="noreferrer"
										class="text-blue-600 dark:text-blue-400 font-bold hover:underline inline-flex items-center gap-0.5"
									>
										Ajukan PA Baru <IconArrowUpRight size={12} />
									</a>
								</div>
							{/if}

							{#if reportData.budget_items.length === 0}
								<div class="text-center py-8 px-4 rounded-xl border border-dashed border-gray-200 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-850/50 mb-3">
									<div class="w-12 h-12 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-[var(--g)] flex items-center justify-center mx-auto mb-2">
										<IconCash size={24} />
									</div>
									<p class="text-[13px] font-bold text-gray-800 dark:text-slate-200 m-0">Belum Ada Item Pengeluaran Hari Ini</p>
									<p class="text-[11px] text-gray-500 dark:text-slate-400 mt-1 max-w-sm mx-auto mb-3">
										Catat pengeluaran operasional, bensin, konsumsi lembur, sewa alat, atau material tambahan mendadak.
									</p>
									<button
										type="button"
										class="px-4 py-2 rounded-xl bg-[var(--g)] hover:bg-[var(--gd)] text-white text-[12px] font-bold inline-flex items-center gap-1.5 shadow-2xs transition-all active:scale-95 cursor-pointer"
										onclick={addBudgetItem}
									>
										<IconPlus size={15} /> Tambah Item Pengeluaran Pertama
									</button>
								</div>
							{:else}
								<div class="space-y-4 mb-3">
									{#each reportData.budget_items as item, idx}
										{@const selectedExp = budgetExpenses.find(e => String(e.id) === String(item.expense_id))}
										{@const remaining = selectedExp ? Math.max(0, (Number(selectedExp.debit_amount) || Number(selectedExp.expense_amount) || 0) - (previousSpentMap[selectedExp.id] || 0)) : 0}
										{@const isReimburse = item.expense_id === 'REIMBURSE'}
										{@const hasReceipt = !!(item.receipt_file || item.receipt_id)}
										{@const isOverBudget = !isReimburse && item.expense_id && item.spent_amount > remaining}

										<div class="bg-white dark:bg-slate-850 border border-gray-200 dark:border-slate-700/80 rounded-xl p-3.5 shadow-2xs relative space-y-3">
											<!-- Card Header -->
											<div class="flex items-center justify-between gap-2 pb-2 border-b border-gray-100 dark:border-slate-800">
												<div class="flex items-center gap-2 flex-wrap">
													<span class="text-[11px] font-bold px-2 py-0.5 rounded-md bg-gray-100 dark:bg-slate-750 text-gray-700 dark:text-slate-300 font-mono">
														#{idx + 1}
													</span>
													{#if isReimburse}
														<span class="text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 flex items-center gap-1">
															<IconCreditCard size={12} /> Reimbursement
														</span>
													{:else if item.expense_id}
														<span class="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
															<IconBuildingBank size={12} /> Kas Proyek: {item.reference_number || 'PA'}
														</span>
													{:else}
														<span class="text-[10px] font-medium px-2 py-0.5 rounded-md bg-gray-100 dark:bg-slate-800 text-gray-500">
															Pilih Sumber Pendanaan
														</span>
													{/if}
													{#if isReimburse && !hasReceipt}
														<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800 flex items-center gap-0.5">
															<IconAlertTriangle size={11} /> Wajib Nota
														</span>
													{:else if hasReceipt}
														<span class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 flex items-center gap-0.5">
															<IconCheck size={11} /> Nota Terlampir
														</span>
													{/if}
												</div>

												<button
													type="button"
													class="text-gray-400 hover:text-red-500 dark:hover:text-red-400 p-1 rounded-md transition-colors cursor-pointer"
													onclick={() => removeBudgetItem(idx)}
													title="Hapus baris pengeluaran ini"
												>
													<IconTrash size={15} />
												</button>
											</div>

											<!-- Pilihan Sumber Pendanaan -->
											<div>
												<label class="f-label">
													Sumber Pendanaan <span style="color: var(--re)">*</span>
												</label>
												<select
													class="f-select"
													value={item.expense_id}
													onchange={(e) => handleBudgetItemSelect(e, idx)}
												>
													<option value="">-- Pilih Sumber Pendanaan --</option>
													<option value="REIMBURSE">💳 Uang Pribadi / Reimbursement (Talangan Pribadi Leader/Tim)</option>
													{#if budgetExpenses.length > 0}
														<optgroup label="🏢 Sumber Kas Anggaran Proyek (PA / Kasbon)">
															{#each budgetExpenses as exp}
																{@const expRemaining = Math.max(0, (Number(exp.debit_amount) || Number(exp.expense_amount) || 0) - (previousSpentMap[exp.id] || 0))}
																<option value={exp.id}>
																	[{exp.reference_number}] {exp.material_name} (Sisa Saldo: {formatRupiah(expRemaining)})
																</option>
															{/each}
														</optgroup>
													{/if}
												</select>
											</div>

											<!-- Konfigurasi Kategori jika Reimbursement -->
											{#if isReimburse}
												<div class="p-3 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 space-y-2">
													<div>
														<label class="f-label text-amber-900 dark:text-amber-300">
															Kategori Pengeluaran Reimbursement <span style="color: var(--re)">*</span>
														</label>
														<select class="f-select" bind:value={item.expense_category}>
															{#each itemCategories as cat}
																<option value={cat.value}>{cat.label}</option>
															{/each}
														</select>
													</div>
													<p class="text-[10.5px] text-amber-700 dark:text-amber-400 m-0">
														💡 Saat laporan dikirim, sistem akan otomatis membuat <strong>Purchase Invoice (AP Reimbursement)</strong> atas nama <strong>{userName}</strong> ke divisi Finance.
													</p>
												</div>
											{/if}

											<!-- Info Plafon Kas jika Kas Proyek -->
											{#if selectedExp}
												<div class="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800 border border-gray-200 dark:border-slate-700 text-[11px] text-gray-600 dark:text-slate-300">
													<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
														<div>
															<span class="text-gray-400 dark:text-slate-500 block text-[10px]">Kategori</span>
															<strong class="text-gray-800 dark:text-slate-200 truncate block">
																{getCategoryLabel(selectedExp.expense_category || selectedExp.expense_type)}
															</strong>
														</div>
														<div>
															<span class="text-gray-400 dark:text-slate-500 block text-[10px]">Pengaju / PIC</span>
															<strong class="text-gray-800 dark:text-slate-200 truncate block">
																{selectedExp.pic || '-'}
															</strong>
														</div>
														<div>
															<span class="text-gray-400 dark:text-slate-500 block text-[10px]">Plafon Awal</span>
															<strong class="text-gray-800 dark:text-slate-200 block font-mono">
																{formatRupiah(selectedExp.debit_amount || selectedExp.expense_amount)}
															</strong>
														</div>
														<div>
															<span class="text-gray-400 dark:text-slate-500 block text-[10px]">Sisa Kas Tersedia</span>
															<strong class="text-emerald-600 dark:text-emerald-400 block font-mono">
																{formatRupiah(remaining)}
															</strong>
														</div>
													</div>
												</div>
											{/if}

											<!-- Input Nominal & Quick-Chips -->
											<div class="space-y-1.5">
												<div class="flex items-center justify-between">
													<label class="f-label m-0">
														Nominal Terpakai (Rp) <span style="color: var(--re)">*</span>
													</label>
													{#if item.spent_amount > 0}
														<span class="text-[12px] font-bold text-[var(--g)] font-mono">
															{formatRupiah(item.spent_amount)}
														</span>
													{/if}
												</div>
												<div class="relative">
													<input
														type="number"
														bind:value={item.spent_amount}
														class="f-input font-mono text-[14px] font-bold"
														min="0"
														step="1000"
														placeholder="0"
														required
													/>
												</div>

												<!-- Quick Nominal Adder Chips -->
												<div class="flex flex-wrap gap-1 pt-1">
													<span class="text-[10px] text-gray-400 dark:text-slate-500 self-center mr-1">Tambah cepat:</span>
													<button
														type="button"
														class="px-2 py-0.5 rounded-md text-[10.5px] font-semibold bg-gray-100 dark:bg-slate-750 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700 transition-all cursor-pointer"
														onclick={() => addQuickAmount(idx, 20000)}
													>
														+20rb
													</button>
													<button
														type="button"
														class="px-2 py-0.5 rounded-md text-[10.5px] font-semibold bg-gray-100 dark:bg-slate-750 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700 transition-all cursor-pointer"
														onclick={() => addQuickAmount(idx, 50000)}
													>
														+50rb
													</button>
													<button
														type="button"
														class="px-2 py-0.5 rounded-md text-[10.5px] font-semibold bg-gray-100 dark:bg-slate-750 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700 transition-all cursor-pointer"
														onclick={() => addQuickAmount(idx, 100000)}
													>
														+100rb
													</button>
													<button
														type="button"
														class="px-2 py-0.5 rounded-md text-[10.5px] font-semibold bg-gray-100 dark:bg-slate-750 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700 transition-all cursor-pointer"
														onclick={() => addQuickAmount(idx, 250000)}
													>
														+250rb
													</button>
													<button
														type="button"
														class="px-2 py-0.5 rounded-md text-[10.5px] font-semibold bg-gray-100 dark:bg-slate-750 text-gray-700 dark:text-slate-300 hover:bg-gray-200 dark:hover:bg-slate-700 transition-all cursor-pointer"
														onclick={() => addQuickAmount(idx, 500000)}
													>
														+500rb
													</button>
													{#if item.spent_amount > 0}
														<button
															type="button"
															class="px-2 py-0.5 rounded-md text-[10.5px] font-semibold bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 hover:bg-red-100 transition-all cursor-pointer ml-auto"
															onclick={() => setQuickAmount(idx, 0)}
														>
															Reset
														</button>
													{/if}
												</div>

												{#if isOverBudget}
													<div class="text-[11px] text-red-600 dark:text-red-400 font-semibold mt-1 flex items-center gap-1 p-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/40">
														<IconAlertCircle size={14} class="shrink-0" />
														<span>Nominal melebihi sisa kas yang tersedia ({formatRupiah(remaining)})!</span>
													</div>
												{/if}
											</div>

											<!-- Deskripsi Rincian Pengeluaran -->
											<div>
												<label class="f-label">
													Deskripsi / Rincian Pengeluaran <span style="color: var(--re)">*</span>
												</label>
												<input
													type="text"
													bind:value={item.description}
													class="f-input"
													placeholder="Contoh: Beli bensin genset 15L, konsumsi lembur 4 orang, sewa scaffolding harian..."
													required
												/>
											</div>

											<!-- Upload Nota / Bukti Item -->
											<div>
												<div class="flex items-center justify-between mb-1">
													<label class="f-label m-0">
														Foto Nota / Kwitansi Item
														{#if isReimburse}
															<span class="text-red-500 font-bold">*Wajib</span>
														{:else}
															<span class="text-gray-400">(Opsional)</span>
														{/if}
													</label>
													{#if hasReceipt}
														<span class="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-0.5">
															<IconCheck size={12} /> Foto siap
														</span>
													{/if}
												</div>

												{#if item.receipt_id && !item.receipt_file}
													<div class="relative aspect-[16/9] max-w-xs border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden bg-gray-50 dark:bg-slate-800 mb-2 group">
														<img use:secureAssetSrc={item.receipt_id} alt="Nota Item" class="w-full h-full object-contain" />
														<button
															type="button"
															class="absolute top-2 right-2 px-2 py-1 rounded-lg bg-black/60 hover:bg-black/80 text-white text-[11px] font-semibold flex items-center gap-1 transition-all cursor-pointer"
															onclick={() => openReceiptModal(item.receipt_id, `Nota Item #${idx + 1}`, true)}
														>
															<IconZoomIn size={13} /> Zoom
														</button>
													</div>
												{/if}

												{#if item.receipt_file}
													<div class="relative aspect-[16/9] max-w-xs border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden bg-gray-50 dark:bg-slate-800 mb-2 group">
														<img src={item.receipt_file.url} alt="Nota Item" class="w-full h-full object-contain" />
														<div class="absolute top-2 right-2 flex items-center gap-1.5">
															<button
																type="button"
																class="px-2 py-1 rounded-lg bg-black/60 hover:bg-black/80 text-white text-[11px] font-semibold flex items-center gap-1 transition-all cursor-pointer"
																onclick={() => openReceiptModal(item.receipt_file!.url, `Nota Item #${idx + 1}: ${item.description || ''}`, false)}
															>
																<IconZoomIn size={13} /> Zoom
															</button>
															<button
																type="button"
																class="w-7 h-7 bg-red-600 hover:bg-red-700 text-white rounded-lg flex items-center justify-center transition-colors cursor-pointer"
																onclick={() => removeBudgetItemReceipt(idx)}
																title="Hapus foto nota item ini"
															>
																<IconTrash size={14} />
															</button>
														</div>
													</div>
												{/if}

												<div class="border border-dashed border-gray-300 dark:border-slate-700 bg-gray-50/50 dark:bg-slate-800/50 rounded-xl p-3 text-center cursor-pointer hover:bg-gray-100/60 dark:hover:bg-slate-800 transition-colors relative">
													<input
														type="file"
														accept="image/*"
														class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
														onchange={(e) => handleBudgetItemReceipt(e, idx)}
													/>
													<IconCamera size={20} class="text-gray-400 dark:text-slate-500 mx-auto" />
													<p class="text-[11px] text-gray-600 dark:text-slate-400 mt-1 font-medium m-0">
														{item.receipt_file ? 'Ganti Foto Nota Item' : 'Tap untuk memotret / unggah nota item'}
													</p>
													<p class="text-[9.5px] text-gray-400 dark:text-slate-500 m-0">Watermark GPS & Tanggal otomatis aktif</p>
												</div>
											</div>
										</div>
									{/each}
								</div>

								<button
									type="button"
									class="btn-action w-full justify-center bg-gray-50 hover:bg-gray-100 dark:bg-slate-800 dark:hover:bg-slate-750 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 py-2.5 font-bold cursor-pointer transition-all active:scale-98"
									onclick={addBudgetItem}
								>
									<IconPlus size={15} /> Tambah Item Pengeluaran
								</button>
							{/if}
						{/if}
					</div>
				</div>
			{/if}

			{#if activeTab === 'hse'}
				<!-- Auto-pull summary status HSE -->
				<div class="card-section mb-3">
					<div class="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
						<div>
							<h4 class="flex items-center gap-2 text-base font-bold text-slate-800 dark:text-slate-100">
								<IconShieldCheck size={18} class="text-[var(--g)]" />
								<span>Ringkasan Modul K3 & HSE</span>
							</h4>
							<p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
								Status otomatis dari modul Toolbox Meeting, PTW, Insiden, dan JSA proyek ini.
							</p>
						</div>
					</div>
					<div class="grid grid-cols-2 md:grid-cols-4 gap-2.5 py-3">
						<div class="rounded-xl border p-2.5 {hseSummary?.toolboxHariIni ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800' : 'border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800'}">
							<p class="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Toolbox Meeting</p>
							<p class="text-[13px] font-bold {hseSummary?.toolboxHariIni ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}">
								{loadingHseSummary ? '...' : (hseSummary?.toolboxHariIni ? '✓ Sudah diisi' : 'Belum diisi')}
							</p>
						</div>
						<div class="rounded-xl border p-2.5 {hseSummary?.ptwAktif ? 'border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800' : 'border-slate-200 bg-slate-50 dark:bg-slate-800/60 dark:border-slate-700'}">
							<p class="text-[10px] font-semibold text-slate-500 dark:text-slate-400">PTW Aktif</p>
							<p class="text-[13px] font-bold {hseSummary?.ptwAktif ? 'text-blue-700 dark:text-blue-300' : 'text-slate-500'}">
								{loadingHseSummary ? '...' : (hseSummary?.ptwAktif ? 'Ada izin aktif' : 'Tidak ada')}
							</p>
						</div>
						<div class="rounded-xl border p-2.5 {(hseSummary?.insidenBelumSelesai ?? 0) > 0 ? 'border-red-200 bg-red-50 dark:bg-red-950/30 dark:border-red-800' : 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800'}">
							<p class="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Insiden Terbuka</p>
							<p class="text-[13px] font-bold {(hseSummary?.insidenBelumSelesai ?? 0) > 0 ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}">
								{loadingHseSummary ? '...' : `${hseSummary?.insidenBelumSelesai ?? 0} insiden`}
							</p>
						</div>
						<div class="rounded-xl border p-2.5 {hseSummary?.jsaBerlaku ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800' : 'border-slate-200 bg-slate-50 dark:bg-slate-800/60 dark:border-slate-700'}">
							<p class="text-[10px] font-semibold text-slate-500 dark:text-slate-400">JSA Berlaku</p>
							<p class="text-[13px] font-bold {hseSummary?.jsaBerlaku ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500'}">
								{loadingHseSummary ? '...' : (hseSummary?.jsaBerlaku === null ? 'N/A' : (hseSummary?.jsaBerlaku ? 'Berlaku' : 'Belum ada'))}
							</p>
						</div>
					</div>
				</div>
				<!-- 1. SAFETY BRIEFING & TOOLBOX MEETING (TBM) -->
				<div class="card-section">
					<div class="flex items-center justify-between mb-2">
						<h4 class="m-0 flex items-center gap-2"><IconShieldCheck size={18} class="text-[var(--b)]" /> Safety Briefing & Toolbox Meeting (TBM) <span style="color: var(--re)">*</span></h4>
						<span class="text-[11px] font-bold px-2 py-0.5 rounded-full {toolboxPhotosCount > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}">
							{toolboxPhotosCount > 0 ? `✓ ${toolboxPhotosCount} Foto Terlampir` : 'Hard Gate: Wajib Foto'}
						</span>
					</div>
					<p class="text-[11px] text-gray-400 mb-3">Briefing keselamatan harian sebelum pekerjaan dimulai. Tangkap foto seluruh peserta yang memakai APD lengkap.</p>

					{#if isLocked}
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3 bg-gray-50 dark:bg-slate-850 p-3 rounded-xl border border-gray-100 dark:border-slate-800">
							<div>
								<span class="text-[11px] font-semibold text-gray-500">Jam Pelaksanaan TBM:</span>
								<p class="text-[13px] font-bold text-gray-800 dark:text-gray-200">{reportData.hse_daily.toolbox_jam || '-'}</p>
							</div>
							<div>
								<span class="text-[11px] font-semibold text-gray-500">Topik / Bahasan Keselamatan:</span>
								<p class="text-[13px] font-bold text-gray-800 dark:text-gray-200">{reportData.hse_daily.toolbox_topik || '-'}</p>
							</div>
						</div>
					{:else}
						<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
							<div>
								<label class="f-label">Jam Pelaksanaan TBM</label>
								<input type="text" class="f-input" placeholder="Contoh: 07:30 - 08:00 WIB" bind:value={reportData.hse_daily.toolbox_jam} />
							</div>
							<div>
								<label class="f-label">Topik / Bahasan Keselamatan</label>
								<input type="text" class="f-input" placeholder="Contoh: Bekerja di ketinggian, isolasi energi & LOTO" bind:value={reportData.hse_daily.toolbox_topik} />
							</div>
						</div>
					{/if}

					<!-- Galeri Foto TBM -->
					<div class="mt-3 pt-3 border-t border-gray-100 dark:border-slate-800">
						<label class="f-label flex items-center justify-between mb-2">
							<span>Foto Dokumentasi Toolbox Meeting <span style="color: var(--re)">*</span></span>
							<span class="text-[10px] text-gray-400">Minimal 1 foto wajib</span>
						</label>

						{#if existingToolboxPhotos.length > 0}
							<div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
								{#each existingToolboxPhotos as id}
									<div class="relative group aspect-square border border-gray-200 rounded-xl overflow-hidden bg-gray-50">
										<img use:secureAssetSrc={id} alt="Toolbox Meeting" class="w-full h-full object-cover" />
										<button 
											type="button" 
											class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white cursor-pointer"
											onclick={() => openPhotoPreview(id)}
											title="Klik untuk memperbesar"
										>
											<IconZoomIn size={22} />
										</button>
										<span class="absolute bottom-1.5 left-1.5 text-[9px] font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded">
											Tersimpan
										</span>
										{#if !isLocked}
											<button 
												type="button" 
												class="absolute top-1.5 right-1.5 w-7 h-7 bg-black/60 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors z-10 cursor-pointer" 
												onclick={() => removeExistingToolboxPhoto(id)}
												title="Hapus foto tersimpan"
											>
												<IconTrash size={14} />
											</button>
										{/if}
									</div>
								{/each}
							</div>
						{/if}

						{#if reportData.toolbox_photos.length > 0}
							<div class="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-3">
								{#each reportData.toolbox_photos as photo, idx}
									<div class="relative aspect-square border border-gray-200 rounded-xl overflow-hidden bg-gray-50">
										<img src={photo.url} alt="Toolbox Meeting" class="w-full h-full object-cover" />
										{#if !isLocked}
											<button class="absolute top-1.5 right-1.5 w-7 h-7 bg-black/50 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors" onclick={() => removeToolboxPhoto(idx)}>
												<IconTrash size={14} />
											</button>
										{/if}
									</div>
								{/each}
							</div>
						{/if}

						{#if !isLocked}
							<div class="border border-dashed border-[var(--b)] bg-[var(--bl)]/30 rounded-xl p-4 text-center cursor-pointer hover:bg-[var(--bl)] transition-colors relative">
								<input type="file" accept="image/*" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange={handleToolboxPhoto} />
								<IconCamera size={24} class="text-[var(--b)] mx-auto" />
								<p class="text-[12px] text-[var(--bd)] mt-1.5 font-medium">Tap untuk memotret toolbox meeting</p>
							</div>
						{:else if existingToolboxPhotos.length === 0 && reportData.toolbox_photos.length === 0}
							<p class="text-[12px] text-gray-400 text-center py-3">Tidak ada foto yang dilampirkan.</p>
						{/if}
					</div>
				</div>

				<!-- 2. KEPATUHAN APD & CATATAN K3 (HARD GATE) -->
				<div class="card-section">
					<div class="flex items-center justify-between mb-2">
						<h4 class="m-0 flex items-center gap-2"><IconCheck size={18} class="text-emerald-600" /> Kepatuhan APD & Catatan K3 <span style="color: var(--re)">*</span></h4>
						{#if !isLocked && reportData.hse_daily.apd_compliance !== 'lengkap'}
							<button
								type="button"
								class="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-300 hover:bg-emerald-100 transition cursor-pointer flex items-center gap-1"
								onclick={() => { reportData.hse_daily.apd_compliance = 'lengkap'; }}
							>
								<IconCheck size={13} /> Set Lengkap Sesuai SOP
							</button>
						{/if}
					</div>
					<p class="text-[11px] text-gray-400 mb-3">Wajib memastikan APD mandatory (Helm, Rompi, Sepatu Safety) serta APD khusus (Harness, Kacamata, Masker/Respirator) dipakai tertib.</p>

					{#if isLocked}
						<div class="space-y-2 bg-gray-50 dark:bg-slate-850 p-3 rounded-xl border border-gray-100 dark:border-slate-800">
							<div>
								<span class="text-[11px] font-semibold text-gray-500">Status Kepatuhan APD:</span>
								<p class="text-[13px] font-bold text-gray-800 dark:text-gray-200">
									{reportData.hse_daily.apd_compliance === 'lengkap' ? '✓ Lengkap — Semua pekerja patuh APD' : reportData.hse_daily.apd_compliance === 'sebagian' ? '⚠️ Sebagian — Ada pekerja tidak lengkap APD' : reportData.hse_daily.apd_compliance === 'tidak_lengkap' ? '🚨 Tidak Lengkap — Banyak temuan pelanggaran APD' : '-'}
								</p>
							</div>
							{#if reportData.hse_daily.catatan_k3}
								<div>
									<span class="text-[11px] font-semibold text-gray-500">Catatan Temuan K3 / Near Miss:</span>
									<p class="text-[13px] text-gray-700 dark:text-gray-300">{reportData.hse_daily.catatan_k3}</p>
								</div>
							{/if}
						</div>
					{:else}
						<div class="space-y-3">
							<div>
								<label class="f-label">Status Kepatuhan APD Hari Ini <span style="color: var(--re)">*</span></label>
								<select class="f-select" bind:value={reportData.hse_daily.apd_compliance}>
									<option value="">-- Pilih Status Kepatuhan APD --</option>
									<option value="lengkap">Lengkap — Semua pekerja patuh APD & SOP</option>
									<option value="sebagian">Sebagian — Ada yang tidak lengkap (ditegur/diberi APD)</option>
									<option value="tidak_lengkap">Tidak Lengkap — Banyak temuan / ada kondisi berbahaya</option>
								</select>
							</div>
							<div>
								<label class="f-label">Catatan Temuan K3 / Near Miss (opsional)</label>
								<textarea
									rows="2"
									class="f-textarea"
									placeholder="Catat temuan kondisi tidak aman (unsafe condition), perilaku tidak aman (unsafe act), atau potensi bahaya site..."
									bind:value={reportData.hse_daily.catatan_k3}
								></textarea>
							</div>
						</div>
					{/if}
				</div>

				<!-- 3. JAM HENTI / DOWNTIME LOG (HARD GATE JIKA CUACA BUKAN CERAH) -->
				<div class="card-section">
					<div class="flex items-center justify-between mb-2">
						<h4 class="m-0 flex items-center gap-2"><IconClock size={18} class="text-amber-600" /> Log Jam Henti / Downtime</h4>
						{#if !isLocked}
							<button
								type="button"
								class="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-amber-50 text-amber-800 border border-amber-300 hover:bg-amber-100 transition cursor-pointer flex items-center gap-1"
								onclick={addDowntimeRow}
							>
								<IconPlus size={13} /> Tambah Jam Henti
							</button>
						{/if}
					</div>

					{#if reportData.weather && reportData.weather !== 'Cerah'}
						<div class="p-2.5 px-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 text-[11.5px] font-medium mb-3 flex items-start gap-2">
							<IconAlertTriangle size={16} class="text-amber-700 shrink-0 mt-0.5" />
							<div>
								<strong>Cuaca Dicatat '{reportData.weather}':</strong> Wajib mencatat minimal 1 baris jam henti & penyebab sebagai bukti resmi pengajuan EOT (perpanjangan waktu) atau biaya standby ke klien (Hard Gate: G_LH_DOWNTIME_REASON).
							</div>
						</div>
					{:else}
						<p class="text-[11px] text-gray-400 mb-3">Catat jam kerja yang terhenti akibat faktor eksternal/internal (hujan, menunggu izin klien, genset mati, kerusakan unit) agar produktivitas tim terukur adil.</p>
					{/if}

					{#if (reportData.downtime_log || []).length === 0}
						<p class="text-[12px] text-gray-400 text-center py-3 bg-gray-50/50 dark:bg-slate-850/50 rounded-xl border border-dashed border-gray-200 dark:border-slate-800">
							Tidak ada jam henti / downtime hari ini (pekerjaan berjalan lancar).
						</p>
					{:else}
						<div class="space-y-2.5">
							{#each reportData.downtime_log as item, idx}
								<div class="p-3 rounded-xl border border-gray-200 dark:border-slate-800 bg-gray-50/80 dark:bg-slate-850/80 relative">
									{#if !isLocked}
										<button
											type="button"
											class="absolute top-2 right-2 text-gray-400 hover:text-red-500 transition-colors"
											onclick={() => removeDowntimeRow(idx)}
											title="Hapus baris jam henti"
										>
											<IconTrash size={14} />
										</button>
									{/if}
									<div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-2 pr-6">
										<div>
											<label class="f-label">Durasi Henti (jam) <span style="color: var(--re)">*</span></label>
											{#if isLocked}
												<p class="text-[13px] font-bold text-gray-800 dark:text-gray-200">{item.durasi_jam} jam</p>
											{:else}
												<input type="number" min="0.5" step="0.5" class="f-input" bind:value={item.durasi_jam} />
											{/if}
										</div>
										<div>
											<label class="f-label">Penyebab Henti <span style="color: var(--re)">*</span></label>
											{#if isLocked}
												<p class="text-[13px] font-bold text-gray-800 dark:text-gray-200">
													{DOWNTIME_CAUSE_OPTIONS.find(o => o.value === item.penyebab)?.label || item.penyebab || '-'}
												</p>
											{:else}
												<select class="f-select" bind:value={item.penyebab}>
													<option value="">-- Pilih Penyebab --</option>
													{#each DOWNTIME_CAUSE_OPTIONS as opt}
														<option value={opt.value}>{opt.label}</option>
													{/each}
												</select>
											{/if}
										</div>
										<div>
											<label class="f-label">Pekerja Terdampak (orang)</label>
											{#if isLocked}
												<p class="text-[13px] font-bold text-gray-800 dark:text-gray-200">{item.jumlah_pekerja_terdampak || 0} org</p>
											{:else}
												<input type="number" min="0" class="f-input" bind:value={item.jumlah_pekerja_terdampak} />
											{/if}
										</div>
									</div>
									<div>
										<label class="f-label">Catatan / Detail Jam Henti</label>
										{#if isLocked}
											<p class="text-[12px] text-gray-700 dark:text-gray-300">{item.catatan || '-'}</p>
										{:else}
											<input type="text" class="f-input" placeholder="Contoh: Hujan deras jam 13:00 - 15:00 WIB, pekerjaan sandblasting dihentikan" bind:value={item.catatan} />
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				<!-- 4. QC KONDISI AMBIENT (BLASTING & COATING) -->
				<div class="card-section">
					<div class="flex items-center justify-between mb-2">
						<h4 class="m-0 flex items-center gap-2"><IconGauge size={18} class="text-sky-600" /> QC Kondisi Lingkungan (Ambient Test)</h4>
						{#if !isLocked && reportData.qc_ambient.applicable}
							<button
								type="button"
								class="px-2 py-1 text-[11px] font-bold rounded-lg bg-sky-50 text-sky-700 border border-sky-300 hover:bg-sky-100 transition cursor-pointer flex items-center gap-1"
								onclick={() => loadInspectionSummaryAutoPull(true)}
								disabled={loadingInspectionSummary}
								title="Tarik data pembacaan suhu & RH dari laporan inspeksi BPIR yang diinput tim QC hari ini"
							>
								<IconRefresh size={13} class={loadingInspectionSummary ? 'animate-spin' : ''} />
								{loadingInspectionSummary ? 'Menarik...' : 'Tarik dari Tim QC'}
							</button>
						{/if}
						{#if !isLocked}
							<label class="flex items-center gap-2 text-[12px] font-semibold text-gray-700 dark:text-gray-300 cursor-pointer">
								<input type="checkbox" bind:checked={reportData.qc_ambient.applicable} class="rounded border-gray-300" />
								<span>Proyek Blasting / Coating</span>
							</label>
						{/if}
					</div>
					<p class="text-[11px] text-gray-400 mb-3">Pengukuran parameter lingkungan wajib diisi untuk pekerjaan Sandblasting dan Pengecatan (Protective Coating) sesuai standar ISO 8502-4.</p>

					{#if inspectionSummary}
						<div class="p-2 px-3 rounded-lg bg-sky-50/70 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-800 text-[11px] text-sky-800 dark:text-sky-300 mb-3 flex items-center justify-between">
							<span>🔍 Terhubung dengan Laporan Inspeksi QC BPIR #{inspectionSummary.reportId} ({inspectionSummary.measuredAt ? inspectionSummary.measuredAt.slice(0, 16).replace('T', ' ') : 'Hari ini'})</span>
							<span class="font-bold text-[10px] bg-sky-200/60 dark:bg-sky-800 px-1.5 py-0.5 rounded">Sinkron</span>
						</div>
					{/if}

					{#if reportData.qc_ambient.applicable}
						<div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
							<div>
								<label class="f-label">Suhu Udara (°C)</label>
								{#if isLocked}
									<p class="text-[13px] font-bold text-gray-800 dark:text-gray-200">{reportData.qc_ambient.air_temp ?? '-'} °C</p>
								{:else}
									<input type="number" step="0.1" class="f-input" placeholder="°C" bind:value={reportData.qc_ambient.air_temp} />
								{/if}
							</div>
							<div>
								<label class="f-label">Suhu Substrat / Baja (°C)</label>
								{#if isLocked}
									<p class="text-[13px] font-bold text-gray-800 dark:text-gray-200">{reportData.qc_ambient.steel_temp ?? '-'} °C</p>
								{:else}
									<input type="number" step="0.1" class="f-input" placeholder="°C" bind:value={reportData.qc_ambient.steel_temp} />
								{/if}
							</div>
							<div>
								<label class="f-label">Relative Humidity (%)</label>
								{#if isLocked}
									<p class="text-[13px] font-bold text-gray-800 dark:text-gray-200">{reportData.qc_ambient.relative_humidity ?? '-'} %</p>
								{:else}
									<input type="number" min="0" max="100" step="1" class="f-input" placeholder="Maks 85%" bind:value={reportData.qc_ambient.relative_humidity} />
								{/if}
							</div>
							<div>
								<label class="f-label">Dew Point (°C)</label>
								{#if isLocked}
									<p class="text-[13px] font-bold text-gray-800 dark:text-gray-200">{reportData.qc_ambient.dew_point ?? '-'} °C</p>
								{:else}
									<input type="number" step="0.1" class="f-input" placeholder="°C" bind:value={reportData.qc_ambient.dew_point} />
								{/if}
							</div>
						</div>

						<!-- Evaluasi Toleransi Mutu Otomatis -->
						{#if reportData.qc_ambient.steel_temp !== null && reportData.qc_ambient.dew_point !== null && reportData.qc_ambient.steel_temp !== '' && reportData.qc_ambient.dew_point !== ''}
							{@const delta = Number(reportData.qc_ambient.steel_temp) - Number(reportData.qc_ambient.dew_point)}
							{@const rh = Number(reportData.qc_ambient.relative_humidity) || 0}
							{@const isSafe = delta >= 3 && rh <= 85}
							<div class="p-3 rounded-xl border mt-3 {isSafe ? 'bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-200' : 'bg-red-50 border-red-200 text-red-900 dark:bg-red-950/30 dark:border-red-800 dark:text-red-200'}">
								<div class="flex items-center gap-2 font-bold text-[12px]">
									{#if isSafe}
										<IconCircleCheck size={16} class="text-emerald-600" />
										<span>Kondisi Aman untuk Blasting & Pengecatan (Delta: +{delta.toFixed(1)}°C, RH: {rh}%)</span>
									{:else}
										<IconAlertTriangle size={16} class="text-red-600" />
										<span>Peringatan Mutu: Berisiko Kondensasi & Blistering Cat! (Delta: {delta.toFixed(1)}°C &lt; +3°C atau RH {rh}% &gt; 85%)</span>
									{/if}
								</div>
								<p class="text-[11px] mt-1 opacity-90">Standar ISO 8502-4 / SSPC-PA 1 mensyaratkan suhu permukaan baja minimal 3°C di atas titik embun (dew point) dan kelembaban udara (RH) maksimal 85% sebelum aplikasi cat dimulai.</p>
							</div>
						{/if}
					{:else}
						<div class="p-3 bg-gray-50 dark:bg-slate-850 rounded-xl border border-gray-100 dark:border-slate-800 text-[12px] text-gray-500">
							Proyek ini tidak ditandai sebagai pekerjaan Blasting / Coating. Jika Anda sedang melakukan pekerjaan pengecatan, centang kotak di atas untuk mengaktifkan pencatatan QC Ambient.
						</div>
					{/if}
				</div>
			{/if}

			{#if activeTab === 'lainnya'}
				<!-- Fase 2 Laporan Lapangan & Paritas ERP (16 Okt 2026) — Instruksi Klien / Potensi Kerja Tambah (SI/VO) -->
				<div class="card-section mb-4">
					<div class="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
						<h4 class="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
							<IconFileText size={16} class="text-[var(--g)]" />
							<span>Instruksi Klien / Potensi Kerja Tambah (SI/VO)</span>
							<HelpIcon text="Catat instruksi lisan pengawas klien di lapangan (pekerjaan tambah/kurang) di sini SEGERA — bukti ini sering jadi alasan gagal tagih saat BAST bila tidak didokumentasikan. Centang 'Berpotensi VO' akan memberi tahu Admin Project otomatis saat laporan dikirim." />
						</h4>
					</div>
					{#if isLocked}
						{#if reportData.client_instructions.length === 0}
							<p class="text-[12px] text-gray-400 text-center py-3">Tidak ada instruksi klien yang dicatat.</p>
						{:else}
							<div class="divide-y divide-gray-100 dark:divide-slate-800">
								{#each reportData.client_instructions as item}
									<div class="py-2.5 text-[12px] text-slate-700 dark:text-slate-200">
										<strong>{item.pengawas_klien || '-'}</strong>{#if item.berpotensi_vo}<span class="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 font-bold">Berpotensi VO</span>{/if}
										<p class="text-slate-500 mt-0.5">{item.isi_instruksi}</p>
									</div>
								{/each}
							</div>
						{/if}
					{:else}
						<div class="space-y-2.5 pt-2">
							{#each reportData.client_instructions as item, i}
								<div class="grid grid-cols-1 md:grid-cols-[180px_1fr_120px_36px] gap-2 items-start bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700">
									<div>
										<label class="f-label text-[10px]">Nama Pengawas Klien</label>
										<input type="text" bind:value={item.pengawas_klien} class="f-input" placeholder="Nama" />
									</div>
									<div>
										<label class="f-label text-[10px]">Isi Instruksi</label>
										<input type="text" bind:value={item.isi_instruksi} class="f-input" placeholder="Apa yang diminta klien" />
									</div>
									<div class="flex items-center gap-1.5 pt-5">
										<input type="checkbox" bind:checked={item.berpotensi_vo} id={`vo-${i}`} class="w-4 h-4" />
										<label for={`vo-${i}`} class="text-[11px] font-medium text-amber-700 dark:text-amber-300">Berpotensi VO</label>
									</div>
									<button type="button" class="self-end mb-0.5 p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30" onclick={() => removeClientInstruction(i)} title="Hapus baris">
										<IconTrash size={15} />
									</button>
								</div>
							{/each}
							<button
								type="button"
								class="btn-action w-full justify-center bg-gray-50 hover:bg-gray-100 dark:bg-slate-800 dark:hover:bg-slate-750 border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-200 py-2.5 font-bold cursor-pointer transition-all active:scale-98"
								onclick={addClientInstruction}
							>
								<IconPlus size={15} /> Tambah Instruksi Klien
							</button>
						</div>
					{/if}
				</div>

				<!-- Kendala -->
				<div class="card-section">
					<h4><IconAlertCircle size={16} class="text-[var(--re)]" /> Kendala / isu</h4>
					{#if isLocked}
						<!-- VIEW MODE -->
						{#if reportData.issues.length === 0 || (reportData.issues.length === 1 && !reportData.issues[0].description)}
							<p class="text-[12px] text-gray-400 text-center py-3">Tidak ada kendala yang dilaporkan.</p>
						{:else}
							<div class="divide-y divide-gray-100">
								{#each reportData.issues as item}
									{#if item.description}
										<div class="py-2.5"><p class="text-[13px] text-gray-700 leading-relaxed">{item.description}</p></div>
									{/if}
								{/each}
							</div>
						{/if}
					{:else}
						<!-- EDIT MODE -->
						{#each reportData.issues as item, i}
							<div class="mb-3"><label class="f-label">Deskripsi <span style="color: var(--re)">*</span></label><textarea bind:value={item.description} rows="3" class="f-textarea" placeholder="Tulis kendala..."></textarea></div>

							<!-- Fase 2 Dokumentasi Foto (26 Sep 2026) — foto bukti PER kendala, tambahan di
							     luar foto kendala umum di bawah. Belum wajib. -->
							{#if item.description && item.description.trim()}
								<div class="mb-4 -mt-1">
									<label class="f-label flex items-center gap-1.5"><IconCamera size={13} class="text-gray-400" /> Foto Bukti Kendala Ini (opsional)</label>
									{#if (item.existing_foto_kendala || []).length > 0 || (item.foto_kendala || []).length > 0}
										<div class="grid grid-cols-3 gap-1.5 mb-2">
											{#each item.existing_foto_kendala || [] as id}
												<div class="aspect-square border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
													<img use:secureAssetSrc={id} alt="Foto kendala" class="w-full h-full object-cover" />
												</div>
											{/each}
											{#each item.foto_kendala || [] as photo, pIdx}
												<div class="relative aspect-square border border-gray-200 rounded-lg overflow-hidden bg-gray-50">
													<img src={photo.url} alt="Foto kendala" class="w-full h-full object-cover" />
													{#if !isLocked}
														<button class="absolute top-1 right-1 w-6 h-6 bg-black/50 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors" onclick={() => removeIssueItemPhoto(i, pIdx)}>
															<IconTrash size={12} />
														</button>
													{/if}
												</div>
											{/each}
										</div>
									{/if}
									{#if !isLocked}
										<div class="border border-dashed border-gray-300 dark:border-slate-700 rounded-lg p-2.5 text-center cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-800/50 transition-colors relative">
											<input type="file" accept="image/*" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange={(e) => handleIssueItemPhoto(i, e)} />
											<span class="text-[11px] text-gray-500 dark:text-slate-400 inline-flex items-center gap-1"><IconCamera size={13} /> Tap untuk memotret</span>
										</div>
									{/if}
								</div>
							{/if}
						{/each}
						<button class="btn-action mb-4" onclick={addIssue}><IconPlus size={14} /> Tambah kendala</button>
					{/if}

					<div class="mt-2 border-t border-gray-100 pt-4">
						<h5 class="text-[12px] font-semibold text-gray-700 flex items-center gap-1.5 mb-2"><IconCamera size={14} class="text-gray-400" /> Foto Bukti Kendala <span style="color: var(--re)">*</span></h5>
						<p class="text-[11px] text-gray-400 mb-2">Kalau ada kendala/isu ditulis di atas, wajib melampirkan minimal 1 foto buktinya (Hard Gate).</p>

						{#if existingIssuePhotos.length > 0}
							<div class="grid grid-cols-2 gap-2 mb-3">
								{#each existingIssuePhotos as id}
									<div class="relative group aspect-square border border-gray-200 rounded-xl overflow-hidden bg-gray-50">
										<img use:secureAssetSrc={id} alt="Kendala" class="w-full h-full object-cover" />
										<button 
											type="button" 
											class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white cursor-pointer"
											onclick={() => openPhotoPreview(id)}
											title="Klik untuk memperbesar"
										>
											<IconZoomIn size={22} />
										</button>
										<span class="absolute bottom-1.5 left-1.5 text-[9px] font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded">
											Tersimpan
										</span>
										{#if !isLocked}
											<button 
												type="button"
												class="absolute top-1.5 right-1.5 w-7 h-7 bg-black/60 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors z-10 cursor-pointer" 
												onclick={() => removeExistingIssuePhoto(id)}
												title="Hapus foto tersimpan"
											>
												<IconTrash size={14} />
											</button>
										{/if}
									</div>
								{/each}
							</div>
						{/if}

						{#if reportData.issue_photos.length > 0}
							<div class="grid grid-cols-2 gap-2 mb-3">
								{#each reportData.issue_photos as photo, idx}
									<div class="relative aspect-square border border-gray-200 rounded-xl overflow-hidden bg-gray-50">
										<img src={photo.url} alt="Kendala" class="w-full h-full object-cover" />
										{#if !isLocked}
											<button class="absolute top-1.5 right-1.5 w-7 h-7 bg-black/50 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors" onclick={() => removeIssuePhoto(idx)}>
												<IconTrash size={14} />
											</button>
										{/if}
									</div>
								{/each}
							</div>
						{/if}

						{#if !isLocked}
							<div class="border border-dashed border-[var(--re)] bg-[var(--rel)]/30 rounded-xl p-4 text-center cursor-pointer hover:bg-[var(--rel)] transition-colors relative">
								<input type="file" accept="image/*" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange={handleIssuePhoto} />
								<IconCamera size={24} class="text-[var(--re)] mx-auto" />
								<p class="text-[12px] text-[var(--red)] mt-1.5 font-medium">Tap untuk memotret bukti kendala</p>
							</div>
						{:else if existingIssuePhotos.length === 0 && reportData.issue_photos.length === 0}
							<p class="text-[12px] text-gray-400 text-center py-3">Tidak ada foto yang dilampirkan.</p>
						{/if}
					</div>
				</div>

				<!-- Instruksi Lapangan dari Pengawas Klien (Site Instructions) -->
				<div class="card-section">
					<div class="flex items-center justify-between mb-2">
						<h4 class="m-0 flex items-center gap-2"><IconFileText size={16} class="text-indigo-600" /> Instruksi Pengawas Klien (Site Instruction / VO)</h4>
						{#if !isLocked}
							<button
								type="button"
								class="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition cursor-pointer flex items-center gap-1"
								onclick={addClientInstructionRow}
							>
								<IconPlus size={13} /> Tambah Instruksi
							</button>
						{/if}
					</div>
					<p class="text-[11px] text-gray-400 mb-3">Catat arahan tertulis/lisan dari perwakilan owner/klien di lapangan yang berpotensi menjadi pekerjaan tambah (Variation Order / VO).</p>

					{#if (reportData.client_instructions || []).length === 0}
						<p class="text-[12px] text-gray-400 text-center py-3 bg-gray-50/50 dark:bg-slate-850/50 rounded-xl border border-dashed border-gray-200 dark:border-slate-800">
							Tidak ada instruksi khusus dari klien hari ini.
						</p>
					{:else}
						<div class="space-y-3">
							{#each reportData.client_instructions as item, idx}
								<div class="p-3 rounded-xl border border-gray-200 dark:border-slate-800 bg-gray-50/80 dark:bg-slate-850/80 relative">
									{#if !isLocked}
										<button
											type="button"
											class="absolute top-2 right-2 text-gray-400 hover:text-red-500 transition-colors"
											onclick={() => removeClientInstructionRow(idx)}
											title="Hapus baris instruksi"
										>
											<IconTrash size={14} />
										</button>
									{/if}
									<div class="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2.5 mb-2 pr-6">
										<div>
											<label class="f-label">Nama Pengawas / Perwakilan Klien</label>
											{#if isLocked}
												<p class="text-[13px] font-bold text-gray-800 dark:text-gray-200">{item.pengawas_klien || '-'}</p>
											{:else}
												<input type="text" class="f-input" placeholder="Contoh: Pak Budi (Inspector PT XYZ)" bind:value={item.pengawas_klien} />
											{/if}
										</div>
										<div class="flex items-center gap-2 pt-4">
											{#if isLocked}
												<span class="text-[11px] font-bold px-2 py-0.5 rounded-full {item.berpotensi_vo ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-600'}">
													{item.berpotensi_vo ? '⚡ Potensi VO' : 'Instruksi Biasa'}
												</span>
											{:else}
												<label class="flex items-center gap-1.5 text-[12px] font-semibold text-gray-700 dark:text-gray-300 cursor-pointer">
													<input type="checkbox" bind:checked={item.berpotensi_vo} class="rounded border-gray-300 text-indigo-600" />
													<span>Potensi VO / Tambah Biaya</span>
												</label>
											{/if}
										</div>
									</div>
									<div>
										<label class="f-label">Rincian Instruksi / Arahan Lapangan</label>
										{#if isLocked}
											<p class="text-[12px] text-gray-700 dark:text-gray-300">{item.isi_instruksi || '-'}</p>
										{:else}
											<textarea rows="2" class="f-textarea" placeholder="Tuliskan arahan dari klien secara detail..." bind:value={item.isi_instruksi}></textarea>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Area Kerja (Fase 1 Dokumentasi Foto) -->
				{#if !isHold}
					<div class="card-section">
						<h4><IconCamera size={16} class="text-[var(--g)]" /> Foto Kondisi Area Kerja <span style="color: var(--re)">*</span></h4>
						<p class="text-[11px] text-gray-400 mb-2">Foto area kerja sebelum/sesudah (5R/housekeeping). Wajib dilampirkan (Hard Gate).</p>

						{#if existingAreaKerjaPhotos.length > 0}
							<div class="grid grid-cols-2 gap-2 mb-3">
								{#each existingAreaKerjaPhotos as id}
									<div class="relative group aspect-square border border-gray-200 rounded-xl overflow-hidden bg-gray-50">
										<img use:secureAssetSrc={id} alt="Area Kerja" class="w-full h-full object-cover" />
										<button 
											type="button" 
											class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white cursor-pointer"
											onclick={() => openPhotoPreview(id)}
											title="Klik untuk memperbesar"
										>
											<IconZoomIn size={22} />
										</button>
										<span class="absolute bottom-1.5 left-1.5 text-[9px] font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded">
											Tersimpan
										</span>
										{#if !isLocked}
											<button 
												type="button"
												class="absolute top-1.5 right-1.5 w-7 h-7 bg-black/60 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors z-10 cursor-pointer" 
												onclick={() => removeExistingAreaKerjaPhoto(id)}
												title="Hapus foto tersimpan"
											>
												<IconTrash size={14} />
											</button>
										{/if}
									</div>
								{/each}
							</div>
						{/if}

						{#if reportData.area_kerja_photos.length > 0}
							<div class="grid grid-cols-2 gap-2 mb-3">
								{#each reportData.area_kerja_photos as photo, idx}
									<div class="relative aspect-square border border-gray-200 rounded-xl overflow-hidden bg-gray-50">
										<img src={photo.url} alt="Area Kerja" class="w-full h-full object-cover" />
										{#if !isLocked}
											<button class="absolute top-1.5 right-1.5 w-7 h-7 bg-black/50 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors" onclick={() => removeAreaKerjaPhoto(idx)}>
												<IconTrash size={14} />
											</button>
										{/if}
									</div>
								{/each}
							</div>
						{/if}

						{#if !isLocked}
							<div class="border border-dashed border-[var(--g)] bg-[var(--gl)]/30 rounded-xl p-4 text-center cursor-pointer hover:bg-[var(--gl)] transition-colors relative">
								<input type="file" accept="image/*" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange={handleAreaKerjaPhoto} />
								<IconCamera size={24} class="text-[var(--g)] mx-auto" />
								<p class="text-[12px] text-[var(--gd)] mt-1.5 font-medium">Tap untuk memotret kondisi area kerja</p>
							</div>
						{:else if existingAreaKerjaPhotos.length === 0 && reportData.area_kerja_photos.length === 0}
							<p class="text-[12px] text-gray-400 text-center py-3">Tidak ada foto yang dilampirkan.</p>
						{/if}
					</div>
				{/if}

				<!-- Dokumentasi -->
				<div class="card-section">
					<h4><IconCamera size={16} class="text-[var(--g)]" /> Dokumentasi lapangan <span style="color: var(--re)">*</span></h4>

					{#if existingProgressPhotos.length > 0}
						<div class="grid grid-cols-2 gap-2 mb-3">
							{#each existingProgressPhotos as id}
								<div class="aspect-square border border-gray-200 rounded-xl overflow-hidden bg-gray-50">
									<img use:secureAssetSrc={id} alt="Progress" class="w-full h-full object-cover" />
								</div>
							{/each}
						</div>
					{/if}

					{#if reportData.progress_photos.length > 0}
						<div class="grid grid-cols-2 gap-2 mb-3">
							{#each reportData.progress_photos as photo, idx}
								<div class="relative aspect-square border border-gray-200 rounded-xl overflow-hidden bg-gray-50">
									<img src={photo.url} alt="Progress" class="w-full h-full object-cover" />
									{#if !isLocked}
										<button class="absolute top-1.5 right-1.5 w-7 h-7 bg-black/50 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors" onclick={() => removeProgressPhoto(idx)}>
											<IconTrash size={14} />
										</button>
									{/if}
								</div>
							{/each}
						</div>
					{/if}

					{#if !isLocked}
						<div class="mt-2 border border-dashed border-[var(--g)] bg-[var(--gl)]/30 rounded-xl p-4 text-center cursor-pointer hover:bg-[var(--gl)] transition-colors relative">
							<input type="file" accept="image/*" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange={handleProgressPhoto} />
							<IconCamera size={24} class="text-[var(--g)] mx-auto" />
							<p class="text-[12px] text-[var(--gd)] mt-1.5 font-medium">Tap untuk memotret dokumentasi lapangan</p>
						</div>
					{:else if existingProgressPhotos.length === 0 && reportData.progress_photos.length === 0}
						<p class="text-[12px] text-gray-400 text-center py-3">Tidak ada foto yang dilampirkan.</p>
					{/if}
				</div>
			{/if}

			{#if activeTab === 'weekend' && isFriday}
				<div class="card-section">
					<h4><IconCalendarTime size={16} class="text-[var(--g)]" /> Weekend Report (Wajib Jumat)</h4>
					
					<div class="mb-4">
						<label class="f-label">Rekapan Mingguan Lokasi Absensi <span style="color: var(--re)">*</span></label>
						{#if isLocked}
							<textarea bind:value={reportData.weekend_location_recap} class="f-textarea cursor-not-allowed" style="background: var(--sys-fill); color: var(--sys-label3); height: 80px; resize: none" readonly></textarea>
						{:else}
							<textarea bind:value={reportData.weekend_location_recap} class="f-textarea" placeholder="Tuliskan rekapan lokasi absensi selama minggu ini..." style="height: 80px" required></textarea>
						{/if}
					</div>

					<div class="border-t border-gray-100 pt-4">
						<h5 class="text-[12px] font-semibold text-gray-700 flex items-center gap-1.5 mb-2"><IconCamera size={14} class="text-gray-400" /> File Rekapan Absensi <span style="color: var(--re)">*</span></h5>
						
						{#if existingWeekendPhotos.length > 0}
							<div class="grid grid-cols-2 gap-2 mb-3">
								{#each existingWeekendPhotos as id}
									<a use:secureAssetHref={id} target="_blank" rel="noopener noreferrer" class="aspect-square border border-gray-200 rounded-xl overflow-hidden bg-gray-50 flex items-center justify-center relative group hover:border-[var(--g)] transition-colors">
										<img use:secureAssetSrc={id} alt="Weekend Recap" class="w-full h-full object-cover absolute inset-0" 
										onerror={(e) => {
											const target = e.currentTarget;
											if (target instanceof HTMLElement) {
												target.style.display = 'none';
												if (target.nextElementSibling instanceof HTMLElement) {
													target.nextElementSibling.style.display = 'flex';
												}
											}
										}} />
										<div class="hidden flex-col items-center justify-center w-full h-full p-2 text-center relative z-10">
											<div class="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center mb-1 group-hover:bg-[var(--gl)]/30 group-hover:text-[var(--g)] transition-colors">
												<IconReceipt size={20} class="text-current" />
											</div>
											<span class="text-[10px] text-gray-600 truncate w-full">Lihat File Document</span>
										</div>
									</a>
								{/each}
							</div>
						{/if}

						{#if reportData.weekend_photos.length > 0}
							<div class="grid grid-cols-2 gap-2 mb-3">
								{#each reportData.weekend_photos as photo, idx}
									<a href={photo.url} target="_blank" rel="noopener noreferrer" class="relative aspect-square border border-gray-200 rounded-xl overflow-hidden bg-gray-50 flex flex-col items-center justify-center p-2 text-center group hover:border-[var(--g)] transition-colors">
										{#if photo.name.match(/\.(jpg|jpeg|png|gif|webp)$/i) || (photo.file && photo.file.type.startsWith('image/'))}
											<img src={photo.url} alt="Weekend Recap" class="w-full h-full object-cover absolute inset-0" />
										{:else}
											<div class="w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center mb-1 group-hover:bg-[var(--gl)]/30 group-hover:text-[var(--g)] transition-colors">
												<IconReceipt size={20} class="text-current" />
											</div>
											<span class="text-[10px] text-gray-600 truncate w-full" title={photo.name}>{photo.name}</span>
										{/if}
										{#if !isLocked}
											<button class="absolute top-1.5 right-1.5 w-7 h-7 bg-black/50 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors z-20" onclick={(e) => { e.preventDefault(); e.stopPropagation(); removeWeekendPhoto(idx); }}>
												<IconTrash size={14} />
											</button>
										{/if}
									</a>
								{/each}
							</div>
						{/if}

						{#if !isLocked}
							<div class="mt-2 border border-dashed border-[var(--g)] bg-[var(--gl)]/30 rounded-xl p-4 text-center cursor-pointer hover:bg-[var(--gl)] transition-colors relative">
								<input type="file" accept="image/*,.pdf,.xlsx,.xls" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onchange={handleWeekendPhoto} />
								<IconCamera size={24} class="text-[var(--g)] mx-auto" />
								<p class="text-[12px] text-[var(--gd)] mt-1.5 font-medium">Tap untuk mengunggah file (Foto/PDF/Excel)</p>
							</div>
						{:else if existingWeekendPhotos.length === 0 && reportData.weekend_photos.length === 0}
							<p class="text-[12px] text-gray-400 text-center py-3">Tidak ada foto yang dilampirkan.</p>
						{/if}
					</div>
				</div>
			{/if}

			{#if activeTab === 'history'}
				<div class="card-section">
					<div class="flex items-center justify-between gap-2">
						<h4><IconHistory size={16} class="text-[var(--g)]" /> History Laporan</h4>
						<button
							type="button"
							class="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-gray-200 text-gray-700"
							onclick={() => (showExportSheet = true)}
							title="Unduh laporan harian & data proyek lain (Excel/CSV/PDF)"
						>
							<IconFileExport size={13} /> Export
						</button>
					</div>

					<FilterSort
						bind:searchQuery={historySearch}
						bind:sortOption={historySort}
						bind:filterOption={historyFilter}
						sortOptions={historySorts}
						filterOptions={historyFilters}
						placeholder="Cari laporan..."
						onSearch={() => loadHistoryReports()}
						onSortChange={() => loadHistoryReports()}
						onFilterChange={() => loadHistoryReports()}
					/>

					{#if historyReports.length === 0}
						<p class="text-[12px] text-gray-400 text-center py-4">Belum ada history laporan.</p>
					{:else}
						<div class="divide-y divide-gray-100">
							{#each historyReports as hr}
								<button class="w-full py-3 flex justify-between items-center text-left hover:bg-gray-50 rounded-lg px-1 transition-colors" onclick={() => selectedHistoryReport = hr}>
									<div>
										<p class="text-[13px] font-semibold text-gray-800">{new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(hr.date || hr.date_created))}</p>
										<p class="text-[11px] text-gray-500">Oleh: {hr.prepared_by || '-'}</p>
									</div>
									<div>
										<span class="text-[10px] px-2 py-1 rounded font-semibold {hr.status === 'approved' ? 'bg-green-100 text-green-700' : hr.status === 'rejected' ? 'bg-red-100 text-red-700' : hr.status === 'submitted' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}">
											{hr.status || 'Draft'}
										</span>
									</div>
								</button>
							{/each}
						</div>
						<InfiniteScroll hasMore={historyHasMore} loading={historyLoadingMore} onloadmore={() => loadHistoryReports(true)} />
					{/if}
				</div>
			{/if}
		</div>
		</div><!-- end scroll-body -->

		<!-- Bottom Bar -->
		<div class="bottom-bar">
			{#if isLocked}
				<div class="flex items-center mb-2.5 gap-2">
					<IconLock size={13} style="color: var(--g); flex-shrink: 0" />
					<span class="text-[12px] font-semibold flex-1" style="color: var(--g)">Laporan telah dikirim</span>
					<span class="badge {statusBadgeClass === 'ok' ? 'ok' : statusBadgeClass === 'err' ? 'rej' : statusBadgeClass === 'info' ? 'info' : 'warn'}">{statusLabel}</span>
				</div>
				<div class="flex gap-2">
					{#if !isDemisioner || canReviseOwnReport}
						<button
							class="py-2.5 px-4 rounded-xl text-[13px] font-semibold flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
							style="border: 1.5px solid var(--sys-sep); background: var(--sys-bg); color: var(--sys-label2)"
							onclick={editReport}
						>
							<IconPencil size={15} /> Edit
						</button>
					{/if}
					<button
						class="py-2.5 px-3 rounded-xl text-[12px] font-semibold flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 disabled:opacity-50"
						style="border: 1.5px solid var(--sys-sep); background: var(--sys-bg); color: var(--sys-label2)"
						disabled={downloadingPdf || !savedReportId}
						onclick={() => downloadReportPdf('internal')}
						title="Unduh PDF Laporan Lengkap Lapangan"
					>
						📄 {downloadingPdf ? '...' : 'PDF Internal'}
					</button>
					<button
						class="py-2.5 px-3 rounded-xl text-[12px] font-semibold flex items-center gap-1.5 cursor-pointer transition-all active:scale-95 disabled:opacity-50 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-700"
						disabled={downloadingPdf || !savedReportId}
						onclick={() => downloadReportPdf('customer')}
						title="Unduh PDF Laporan Resmi Customer (Format Sanitasi & Klien)"
					>
						🤝 {downloadingPdf ? '...' : 'PDF Klien'}
					</button>
					<select
						class="f-select flex-1 py-2.5 disabled:opacity-60"
						bind:value={reportStatus}
						onchange={handleStatusChange}
						disabled={updatingStatus || (isDemisioner && !canReviseOwnReport)}
					>
						{#each statusOptions as opt}
							<option value={opt.value}>{opt.label}</option>
						{/each}
					</select>
				</div>
			{:else}
				{#if isDemisioner && !canReviseOwnReport}
					<div class="p-3 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-xs text-purple-800 dark:text-purple-300 flex items-center justify-between gap-2">
						<span class="flex items-center gap-2">
							<span>📁</span>
							<span><strong>Mode Read-Only:</strong> Leader demisioner tidak dapat mengisi laporan harian baru.</span>
						</span>
						{#if savedReportId}
							<div class="flex items-center gap-1.5">
								<button
									class="py-1.5 px-2.5 rounded-lg text-xs font-semibold bg-purple-600 text-white disabled:opacity-50"
									disabled={downloadingPdf}
									onclick={() => downloadReportPdf('internal')}
									title="Unduh PDF Laporan Internal"
								>
									📄 {downloadingPdf ? '...' : 'Internal'}
								</button>
								<button
									class="py-1.5 px-2.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white disabled:opacity-50"
									disabled={downloadingPdf}
									onclick={() => downloadReportPdf('customer')}
									title="Unduh PDF Laporan Klien"
								>
									🤝 {downloadingPdf ? '...' : 'Klien'}
								</button>
							</div>
						{/if}
					</div>
				{:else}
					<div class="flex items-center mb-2.5 gap-2">
						<span class="text-[12px] font-medium flex-1" style="color: var(--sys-label3)">
							{savedReportId ? 'Mode edit — perubahan belum disimpan' : 'Laporan belum dikirim'}
						</span>
						<DraftIndicator savedAt={reportDraftSavedAt} hasPhotos={reportDraftHasPhotos} {isOffline} />
						<span class="badge warn">Draft</span>
					</div>
					{#if gateWizardGates.some((g) => g.status === 'failed')}
						<button
							type="button"
							class="w-full mb-2 py-2 rounded-xl text-[12px] font-bold text-amber-700 bg-amber-50 border border-amber-200"
							onclick={() => (gateWizardOpen = true)}
						>
							🧭 Wizard Kelengkapan ({gateWizardGates.filter((g) => g.status === 'failed').length})
						</button>
					{/if}
					<div class="flex gap-2">
						<button
							class="py-2.5 px-4 rounded-xl text-[13px] font-semibold flex items-center gap-1.5 cursor-pointer transition-all active:scale-95"
							style="border: 1.5px solid var(--sys-sep); background: var(--sys-bg); color: var(--sys-label2)"
							onclick={saveDraft}
						>
							<IconDeviceFloppy size={15} /> Draft
						</button>
						<button
							class="btn-primary flex-1 py-2.5 text-[13px]"
							style="border-radius: 12px"
							onclick={sendReport}
							disabled={submitting}
						>
							{#if submitting}
								<IconLoader2 size={16} class="animate-spin" /> {uploadStatusText || 'Mengirim...'}
							{:else}
								<IconSend size={16} /> {savedReportId ? 'Simpan perubahan' : 'Kirim laporan'}
							{/if}
						</button>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>

{#if selectedHistoryReport}
	<HistoryDetailModal 
		report={selectedHistoryReport} 
		onClose={() => selectedHistoryReport = null} 
		onEdit={() => {
			loadReportData(selectedHistoryReport, false);
			selectedHistoryReport = null;
		}} 
	/>
{/if}

<PdfBlobViewer
	src={previewPdfBlob}
	title={previewPdfTitle}
	show={showPdfPreview}
	onClose={() => {
		showPdfPreview = false;
		previewPdfBlob = null;
	}}
/>

{#if previewPhotoUrl}
	<div 
		class="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
		onclick={() => previewPhotoUrl = null}
		onkeydown={(e) => { if (e.key === 'Escape') previewPhotoUrl = null; }}
		tabindex="0"
		role="dialog"
		aria-label="Preview Foto Bukti Progress"
	>
		<div class="relative max-w-4xl max-h-[90vh] flex flex-col items-center" onclick={(e) => e.stopPropagation()}>
			<button 
				type="button" 
				class="absolute -top-12 right-0 text-white/80 hover:text-white bg-white/10 hover:bg-white/20 p-2 rounded-full transition-colors cursor-pointer"
				onclick={() => previewPhotoUrl = null}
				title="Tutup preview"
			>
				<IconX size={20} />
			</button>
			<img src={previewPhotoUrl} alt="Preview Foto Bukti" class="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl border border-white/10" />
			<div class="mt-3 flex items-center gap-2">
				<a href={previewPhotoUrl} target="_blank" rel="noopener noreferrer" class="text-xs font-semibold text-white/90 bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg border border-white/20 transition-colors flex items-center gap-1.5">
					<IconZoomIn size={14} /> Buka resolusi penuh di tab baru
				</a>
			</div>
		</div>
	</div>
{/if}

{#if receiptPreviewModal && receiptPreviewModal.open}
	<div 
		class="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4"
		onclick={closeReceiptModal}
		onkeydown={(e) => { if (e.key === 'Escape') closeReceiptModal(); }}
		tabindex="0"
		role="dialog"
		aria-label="Preview Foto Nota"
	>
		<div class="relative max-w-4xl max-h-[90vh] w-full flex flex-col items-center" onclick={(e) => e.stopPropagation()}>
			<div class="w-full flex items-center justify-between text-white mb-2 px-1">
				<p class="text-[13px] font-bold truncate flex items-center gap-1.5 m-0">
					<IconReceipt size={16} class="text-[var(--g)]" />
					{receiptPreviewModal.title || 'Foto Bukti Transaksi / Nota'}
				</p>
				<button 
					type="button" 
					class="text-white/80 hover:text-white bg-white/10 hover:bg-white/20 p-2 rounded-full transition-colors cursor-pointer"
					onclick={closeReceiptModal}
					title="Tutup preview"
				>
					<IconX size={18} />
				</button>
			</div>
			<div class="w-full max-h-[75vh] flex items-center justify-center overflow-hidden rounded-xl bg-black/40 border border-white/10">
				{#if receiptPreviewModal.isDirectusId}
					<img use:secureAssetSrc={receiptPreviewModal.url} alt="Nota" class="max-w-full max-h-[75vh] object-contain" />
				{:else}
					<img src={receiptPreviewModal.url} alt="Nota" class="max-w-full max-h-[75vh] object-contain" />
				{/if}
			</div>
			<div class="mt-3 flex items-center gap-2">
				{#if !receiptPreviewModal.isDirectusId}
					<a href={receiptPreviewModal.url} target="_blank" rel="noopener noreferrer" class="text-xs font-semibold text-white/90 bg-white/10 hover:bg-white/20 px-3 py-1.5 rounded-lg border border-white/20 transition-colors flex items-center gap-1.5 no-underline">
						<IconZoomIn size={14} /> Buka resolusi penuh di tab baru
					</a>
				{/if}
			</div>
		</div>
	</div>
{/if}

<ProjectDetailModal
	open={showProjectDetailModal}
	{project}
	{soCustomer}
	{soDetails}
	onClose={() => (showProjectDetailModal = false)}
/>

<GateCompletionWizard
	open={gateWizardOpen}
	gates={gateWizardGates}
	onClose={() => (gateWizardOpen = false)}
	onGoToField={handleGateWizardGoToField}
	hintsUnavailable={gateWizardHintsUnavailable}
/>

<QuickSubtaskScheduleModal
	open={quickScheduleModalOpen}
	subtask={quickScheduleSubtask}
	{project}
	onSaved={handleQuickScheduleSaved}
	onClose={() => { quickScheduleModalOpen = false; quickScheduleSubtask = null; }}
/>

<!-- UX-05: prompt setelah laporan harian tersimpan — ganti auto-checkout diam-diam.
     Sengaja TIDAK ada tombol "tutup"/backdrop-click supaya leader harus memilih salah satu,
     bukan meninggalkan check-in menggantung tanpa keputusan (SV-03). -->
{#if aktifDiLokasiLain}
	<!-- Paket 10 §2.3 (SVR-29) — netral, TANPA tombol tutup: laporan proyek ini tidak boleh
	     menutup kunjungan proyek/lokasi lain yang sedang aktif. -->
	<div class="fixed bottom-20 left-0 right-0 z-[70] px-3" transition:fade={{ duration: 150 }}>
		<div class="mx-auto max-w-sm rounded-xl bg-slate-800 text-white text-xs px-4 py-2.5 text-center shadow-lg">
			Anda masih tercatat di {aktifDiLokasiLain}. Kunjungan itu tidak terpengaruh oleh laporan ini.
		</div>
	</div>
{/if}

{#if masihDiLokasiPromptOpen}
	<div class="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4">
		<div class="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-xl border border-slate-200 dark:border-slate-800">
			<div class="flex items-center gap-2 mb-2">
				<IconMapPin size={20} class="text-blue-600 dark:text-blue-400" />
				<h3 class="text-sm font-bold text-slate-900 dark:text-slate-100">Masih di lokasi proyek?</h3>
			</div>
			<p class="text-xs text-slate-500 dark:text-slate-400 mb-4">
				Laporan harian tersimpan. Check-in Anda masih aktif — pilih "Tetap di lokasi" bila masih bekerja
				di sini (jam kunjungan Anda akan terus terhitung), atau "Check-out sekarang" bila sudah selesai.
			</p>
			<div class="flex gap-2">
				<button
					type="button"
					class="flex-1 py-2.5 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
					onclick={() => (masihDiLokasiPromptOpen = false)}
				>
					Tetap di Lokasi
				</button>
				<button
					type="button"
					class="flex-1 py-2.5 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
					onclick={handleCheckoutSekarang}
					disabled={masihDiLokasiClosing}
				>
					{#if masihDiLokasiClosing}<IconLoader2 size={14} class="animate-spin" />{/if}
					Check-out Sekarang
				</button>
			</div>
		</div>
	</div>
{/if}

{#if showExportSheet && project}
	<ProjectExportSheet
		projectId={project.id}
		projectName={project.name}
		arsip={String(project.status || '').trim().toLowerCase() === 'closed'}
		onClose={() => (showExportSheet = false)}
	/>
{/if}

{#if postReportSnapshotPromptOpen}
	<div class="fixed inset-0 z-[75] flex items-center justify-center bg-black/60 p-4" transition:fade={{ duration: 150 }}>
		<div class="w-full max-w-sm rounded-2xl bg-white dark:bg-slate-900 p-5 shadow-2xl border border-emerald-500/30 text-slate-900 dark:text-slate-100">
			<div class="flex items-center gap-2.5 mb-2.5">
				<div class="w-9 h-9 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-lg shrink-0">
					🚀
				</div>
				<div>
					<h3 class="text-sm font-bold text-slate-900 dark:text-slate-100">Kirim Snapshot WA ke Direksi?</h3>
					<span class="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold uppercase tracking-wider">Automasi n8n Proyek</span>
				</div>
			</div>

			<p class="text-xs text-slate-600 dark:text-slate-300 mb-4 leading-relaxed">
				Laporan harian proyek berhasil disimpan. Apakah Anda ingin langsung mengirimkan ringkasan snapshot dossier & progres pekerjaan hari ini ke WhatsApp Direksi & Manajemen via n8n?
			</p>

			{#if usageStockWarnings.length}
				<div class="mb-3.5 p-2.5 rounded-xl bg-amber-50 text-[11px] leading-relaxed text-amber-900 border border-amber-300 space-y-1" data-testid="usage-stock-warning">
					{#each usageStockWarnings as w}<div>⚠ {w}</div>{/each}
				</div>
			{/if}

			{#if snapshotStatusMessage}
				<div class="mb-3.5 p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold text-center text-emerald-700 dark:text-emerald-300 border border-emerald-500/20">
					{snapshotStatusMessage}
				</div>
			{/if}

			<div class="flex gap-2">
				<button
					type="button"
					class="flex-1 py-2.5 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition cursor-pointer"
					onclick={() => { postReportSnapshotPromptOpen = false; snapshotStatusMessage = null; }}
				>
					Nanti Saja
				</button>
				<button
					type="button"
					class="flex-1 py-2.5 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 flex items-center justify-center gap-1.5 transition shadow-md shadow-emerald-600/20 cursor-pointer"
					onclick={handleSendPostReportSnapshot}
					disabled={sendingSnapshot}
				>
					{#if sendingSnapshot}
						<IconLoader2 size={14} class="animate-spin" />
						<span>Mengirim...</span>
					{:else}
						<span>🚀 Kirim Sekarang</span>
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
