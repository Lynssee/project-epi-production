<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { signOut } from 'firebase/auth';
	import { auth } from '$lib/firebase';
	import { authStore, getUserDisplay, getUserInitials } from '$lib/stores/auth';
	import { rolesStore, getRoleLabel } from '$lib/stores/roles';
	import { startSiteCheckinSync } from '$lib/utils/siteCheckinSync';
	import { hasPermission, type FeatureKey } from '$lib/constants/permissions';
	import { getPengumumanList } from '$lib/services/ess/pengumuman';
	import { getKursusList } from '$lib/services/ess/training';
	import { getNotifikasiList } from '$lib/services/notifikasiApi';
	import GuidedTour from '$lib/components/shared/GuidedTour.svelte';
	import { tourState, finishTour } from '$lib/stores/tourStore.svelte';
	import {
		IconBuildingFactory2,
		IconClipboardList,
		IconReceipt2,
		IconPackage,
		IconHelmet,
		IconShieldLock,
		IconLogout,
		IconHome,
		IconLayoutDashboard,
		IconTool,
		IconHeadset,
		IconMapPin,
		IconClock,
		IconCalendarEvent,
		IconUserCheck,
		IconDroplet,
		IconUserCircle,
		IconTrophy,
		IconSpeakerphone,
		IconHourglass,
		IconFlame,
		IconCash,
		IconTruck,
		IconShieldCheck,
		IconSettings,
		IconBook,
		IconSearch,
		IconX,
		IconQrcode,
		IconLoader2,
		IconMenu2,
		IconBell,
		IconBuildingSkyscraper,
		IconMessageDots,
		IconCar,
		IconChecklist,
		IconGavel,
		IconFlask,
		IconArrowLeft,
		IconFileText,
		IconChevronRight,
		IconSun,
		IconMoon,
		IconEye,
		IconEyeOff,
		IconLayoutGrid,
		IconLayoutList,
		IconBatteryEco
	} from '@tabler/icons-svelte';

	import { fade } from 'svelte/transition';
	import QuickSupportModal from '$lib/components/support/QuickSupportModal.svelte';
	import AsistenSheet from '$lib/components/asisten/AsistenSheet.svelte';
	import CommHubSheet from '$lib/components/shared/CommHubSheet.svelte';
	import OutboxBadge from '$lib/components/shared/OutboxBadge.svelte';
	import ReadinessBadge from '$lib/components/shared/ReadinessBadge.svelte';
	import P2HQueueSync from '$lib/components/fleet/P2HQueueSync.svelte';
	import ScanSjQueueSync from '$lib/components/ScanSjQueueSync.svelte';
	import HelpMenuButton from '$lib/components/help/HelpMenuButton.svelte';
	import SmartOnboardingBanner from '$lib/components/help/SmartOnboardingBanner.svelte';
	import ActiveCheckinBar from '$lib/components/site-checkin/ActiveCheckinBar.svelte';
	import BelumAbsenPulangBar from '$lib/components/attendance/BelumAbsenPulangBar.svelte';
	import { resolveCheckpoint } from '$lib/services/gaChecklist';
	import { routeCheckpointScan } from '$lib/utils/checkpointScanRoute';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import { resolveSjQr } from '$lib/services/scanResolve';
	import { getBreadcrumbAndTitle } from '$lib/utils/breadcrumbs';
	import { themeMode, toggleThemeMode } from '$lib/stores/themeStore';
	import { density, toggleDensity } from '$lib/stores/densityStore';
	import { hematMode, toggleHematMode } from '$lib/stores/hematStore';
	import { previewMode, showToolbar, setPreviewMode, setShowToolbar, toggleToolbar } from '$lib/stores/previewStore';
	import QrScannerModal from '$lib/components/scanner/QrScannerModal.svelte';
	import QuickActionFab from '$lib/components/shared/QuickActionFab.svelte';
	import { prefetchProjectsForCurrentUser } from '$lib/services/projectScope';
	import CrashRecoveryCard from '$lib/components/shared/CrashRecoveryCard.svelte';
	import AbnormalSessionBanner from '$lib/components/shared/AbnormalSessionBanner.svelte';
	import { initSessionCleanlinessTracking } from '$lib/utils/sessionCleanliness';
	import { initGlobalAutoDraft } from '$lib/utils/autoDraftGlobal';
	import * as Sentry from '@sentry/sveltekit';

	let { children } = $props();
	let isFrame = $state(false);

	// Fase 2 (rencana Draf Otomatis Universal & Anti-White-Screen): <svelte:boundary>
	// menangkap error RENDER komponen yang sebelumnya = layar putih total.
	function onErrorBoundary(error: unknown) {
		console.error('[SVELTE BOUNDARY]', error);
		try {
			Sentry.captureException(error);
		} catch {
			// Sentry belum diinisialisasi (PUBLIC_SENTRY_DSN kosong) — abaikan, sudah di-log ke console.
		}
	}

	let showAbnormalBanner = $state(false);
	let abnormalSessionDraftCount = $state(0);

	$effect(() => {
		const result = initSessionCleanlinessTracking();
		if (result.abnormal) {
			abnormalSessionDraftCount = result.draftCount;
			showAbnormalBanner = true;
		}
		// Fase 4 (rencana Draf Otomatis Universal v2) — rollout Lapis 1 menyeluruh,
		// config-gated (default OFF).
		initGlobalAutoDraft();
	});

	let unreadPengumuman = $state(0);
	let pendingTraining = $state(0);
	let unreadNotifikasi = $state(0);
	let mobileMenuOpen = $state(false);
	let navigationSettingsOpen = $state(false);
	let hiddenModules = $state<string[]>([]);
	let navSettingsSearchQuery = $state("");

	let showSupportModal = $state(false);
	let supportModalTab = $state<'create' | 'list'>('create');

	let routeInfo = $derived(getBreadcrumbAndTitle(page.url.pathname));
	let breadcrumbTrail = $derived(routeInfo.breadcrumb);
	let currentPageTitle = $derived(routeInfo.title);
	let isNotRootPage = $derived(page.url.pathname !== '/' && page.url.pathname !== '');

	function handleNavigateBack() {
		if (typeof window !== 'undefined') {
			if (routeInfo.parentHref && routeInfo.parentHref !== page.url.pathname) {
				goto(routeInfo.parentHref);
			} else if (window.history.length > 1) {
				window.history.back();
			} else {
				goto('/');
			}
		}
	}

	$effect(() => {
		if (typeof window !== 'undefined') {
			isFrame = window.self !== window.top;
		}
	});

	$effect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.altKey && e.key === 'ArrowLeft') {
				if (isNotRootPage) {
					e.preventDefault();
					handleNavigateBack();
				}
			}
		};
		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	});

	// Tombol Scan universal (rencana konsolidasi GA/Security 2026-07-13, Fase 2).
	let showUniversalScanner = $state(false);
	let universalScanResolving = $state(false);
	let universalScanError = $state('');

	async function onUniversalScanDetect(code: string) {
		showUniversalScanner = false;
		universalScanResolving = true;
		universalScanError = '';
		try {
			// QR Surat Jalan (EPI:SJ:<id>:<token>, Keputusan D1) — resolver tunggal menentukan
			// peran & aksi yang diizinkan di server (Bab 6.2).
			const epi = parseEpiQr(code);
			if (epi && epi.type === 'SJ') {
				const result = await resolveSjQr(code);
				if (result.allowedActions.includes('gate_scan')) {
					goto(`/satpam/gate?sj=${(result as any).suratJalan?.id ?? ''}`);
				} else if (result.allowedActions.includes('goods_receipt')) {
					goto('/stock-lapangan/masuk');
				} else {
					goto(`/scan/${encodeURIComponent(code)}`);
				}
				universalScanResolving = false;
				return;
			}

			const result = await resolveCheckpoint(code);
			// Tujuan dipusatkan di routeCheckpointScan (dipakai juga di /scan/[code]).
			const { url } = routeCheckpointScan(result, { scanRouteMode: result.scan_route_mode });
			goto(url);
		} catch (err) {
			universalScanError = err instanceof Error ? err.message : 'Gagal memindai QR.';
		}
		universalScanResolving = false;
	}

	$effect(() => {
		const handleOpenQuickSupport = () => {
			supportModalTab = 'create';
			showSupportModal = true;
		};
		window.addEventListener('open-quick-support', handleOpenQuickSupport);
		return () => {
			window.removeEventListener('open-quick-support', handleOpenQuickSupport);
		};
	});

	$effect(() => {
		const handleOpenMenu = () => mobileMenuOpen = true;
		const handleToggleMenu = () => mobileMenuOpen = !mobileMenuOpen;
		const handleOpenNavSettings = () => navigationSettingsOpen = true;
		window.addEventListener('open-mobile-menu', handleOpenMenu);
		window.addEventListener('toggle-mobile-menu', handleToggleMenu);
		window.addEventListener('open-navigation-settings', handleOpenNavSettings);
		return () => {
			window.removeEventListener('open-mobile-menu', handleOpenMenu);
			window.removeEventListener('toggle-mobile-menu', handleToggleMenu);
			window.removeEventListener('open-navigation-settings', handleOpenNavSettings);
		};
	});

	$effect(() => {
		const path = page.url.pathname;
		mobileMenuOpen = false;
	});

	$effect(() => {
		if (!navigationSettingsOpen) {
			navSettingsSearchQuery = "";
		}
	});

	$effect(() => {
		try {
			const saved = localStorage.getItem('epi_hidden_modules');
			if (saved) {
				hiddenModules = JSON.parse(saved);
			}
		} catch {}
	});
	let canAccessEss = $derived(hasPermission($authStore.roleId, 'access_ess', $rolesStore, $authStore.roleIds) && (!!$authStore.karyawanId || $authStore.roleId === 'super_admin'));

	// Paket 02 Site Visit Release §3.5 — sinkronisasi GLOBAL antrean site check-in, aktif di
	// SELURUH aplikasi (bukan hanya saat halaman /site-checkin terbuka — worst case D di
	// dokumen: sinyal pulih saat user ada di menu lain, antrean sebelumnya tertahan selamanya).
	// Idempoten (startSiteCheckinSync menjaga flag internal) — aman walau $effect ini re-run
	// tiap kali $authStore berubah. Menunggu $authStore.checked supaya tidak mencoba kirim
	// sebelum sesi Firebase siap (getIdToken() akan gagal permanen, bukan retryable, sebelum itu).
	$effect(() => {
		if ($authStore.checked && $authStore.user) {
			startSiteCheckinSync();
		}
	});

	$effect(() => {
		if (!canAccessEss) return;
		const fetchPengumuman = () => {
			getPengumumanList()
				.then((res) => (unreadPengumuman = res.unreadCount))
				.catch(() => {});
		};
		// Ditunda ke idle time agar tidak bersaing dengan render pertama (rencana v2, Jalur B).
		if ('requestIdleCallback' in window) {
			const idleId = requestIdleCallback(fetchPengumuman);
			return () => cancelIdleCallback(idleId);
		}
		const timeoutId = setTimeout(fetchPengumuman, 1);
		return () => clearTimeout(timeoutId);
	});

	$effect(() => {
		if (!canAccessEss) return;
		const fetchNotifikasi = () => {
			getNotifikasiList({ read: false, page: 1 })
				.then((res) => (unreadNotifikasi = res.unreadCount))
				.catch(() => {});
		};
		if ('requestIdleCallback' in window) {
			const idleId = requestIdleCallback(fetchNotifikasi);
			return () => cancelIdleCallback(idleId);
		}
		const timeoutId = setTimeout(fetchNotifikasi, 1);
		return () => clearTimeout(timeoutId);
	});

	$effect(() => {
		if (!canAccessEss) return;
		const fetchPendingTraining = () => {
			getKursusList()
				.then((res) => {
					pendingTraining = res.kursus.filter((k) => k.program.wajib && k.enrollment?.status !== 'Lulus').length;
				})
				.catch(() => {});
		};
		if ('requestIdleCallback' in window) {
			const idleId = requestIdleCallback(fetchPendingTraining);
			return () => cancelIdleCallback(idleId);
		}
		const timeoutId = setTimeout(fetchPendingTraining, 1);
		return () => clearTimeout(timeoutId);
	});

	interface MenuItem {
		title: string;
		icon?: any;
		href?: string;
		exact?: boolean;
		permissions?: FeatureKey[];
		roles?: string[];
		activePrefixes?: string[];
		children?: MenuItem[];
		badge?: number;
	}

	interface NavSection {
		title: string;
		permissions?: FeatureKey[];
		items: MenuItem[];
	}

	let navSections: NavSection[] = $derived([
		{
			title: 'Menu Utama',
			items: [
				{
					title: 'Beranda',
					icon: IconHome,
					href: '/',
					exact: true
				},
				{
					title: 'Command Center',
					icon: IconLayoutDashboard,
					href: '/command-center',
					exact: true
				},
				{
					title: 'Pusat Pengajuan',
					icon: IconHourglass,
					href: '/pusat-pengajuan',
					exact: true,
					permissions: ['access_ess', 'access_requisition', 'manage_packing']
				},
				{
					title: 'Omnichannel',
					icon: IconMessageDots,
					href: '/omnichannel',
					exact: true
				},
				{
					title: 'Portal Karyawan',
					icon: IconUserCircle,
					href: '/ess',
					activePrefixes: ['/ess', '/sji', '/sj-manual', '/site-checkin'],
					permissions: ['access_ess'],
					badge: pendingTraining + unreadPengumuman,
					children: [
						{ title: 'Beranda ESS', href: '/ess', exact: true },
						{ title: 'Absensi Masuk / Pulang', href: '/ess/absen', permissions: ['access_ess'] },
						{ title: 'Site Check-in Proyek', href: '/site-checkin', permissions: ['access_site_checkin'] },
						{ title: 'Cuti & Izin Saya', href: '/ess/cuti', permissions: ['access_ess'] },
						{ title: 'Lembur & Shift', href: '/ess/lembur', permissions: ['access_ess'] },
						{ title: 'Peminjaman Kendaraan', href: '/ess/kendaraan', permissions: ['access_fleet_booking'] },
						{ title: 'Keuangan & Kasbon', href: '/ess/keuangan', permissions: ['access_ess'] },
						{ title: 'Pelatihan E-Learning', href: '/ess/pelatihan', permissions: ['access_ess'] },
						{ title: 'Kinerja & Gamifikasi', href: '/ess/kinerja', permissions: ['access_ess'] },
						{ title: 'Dokumen Karyawan', href: '/ess/dokumen-saya', permissions: ['access_ess'] },
						{ title: 'Surat Jalan Internal', href: '/sji', permissions: ['access_ess', 'view_sji', 'input_sji'] },
						{ title: 'Surat Jalan Manual', href: '/sj-manual', permissions: ['access_ess', 'view_sji', 'input_sji'] },
						{ title: 'Pengumuman Perusahaan', href: '/ess/pengumuman', permissions: ['access_ess'] }
					]
				}
			]
		},
		{
			title: 'Departemen',
			items: [
				{
					title: 'Project',
					icon: IconBuildingFactory2,
					href: '/proyek/hub',
					activePrefixes: ['/proyek', '/laporan', '/anggaran', '/biaya-lapangan', '/packing-list', '/rap-aktual', '/timeline', '/leader', '/regu', '/inventory-proyek', '/mutasi-barang', '/kontrak-terpusat', '/spk-terpusat', '/manpower-rencana-realisasi', '/manpower-dobel-override-log', '/kasbon-terpusat', '/todo-terpusat', '/closing-evaluasi-terpusat', '/pengiriman-workshop', '/workshop'],
					permissions: ['view_all_projects', 'view_own_projects', 'input_laporan', 'approve_laporan', 'request_budget', 'approve_budget', 'view_manpower', 'view_rap', 'manage_packing'],
					children: [
						{ title: 'Hub Project', href: '/proyek/hub', exact: true },
						{ title: 'List Project', href: '/proyek', permissions: ['view_all_projects', 'view_own_projects'] },
						{ title: 'Workshop Ops (Ciketing & Balaraja)', href: '/workshop', permissions: ['view_all_projects', 'view_own_projects'] },
						{ title: 'Pengiriman Workshop', href: '/pengiriman-workshop', permissions: ['view_all_projects', 'view_own_projects'] },
						{ title: 'Mutasi Barang', href: '/mutasi-barang', permissions: ['view_all_projects', 'view_own_projects'] },
						{ title: 'Laporan Harian', href: '/laporan', permissions: ['input_laporan', 'approve_laporan'] },
						{ title: 'Leader & Regu', href: '/leader', permissions: ['view_all_projects', 'view_own_projects'] },
						{ title: 'Timeline & Jadwal', href: '/timeline', permissions: ['view_all_projects', 'view_own_projects'] },
						{ title: 'Keuangan & Anggaran', href: '/anggaran', permissions: ['request_budget', 'approve_budget'] },
						{ title: 'Biaya Lapangan', href: '/biaya-lapangan', permissions: ['access_ess'] },
						{ title: 'RAP vs Realisasi', href: '/rap-aktual', permissions: ['view_rap'] },
						{ title: 'RAP & Realisasi Terpusat', href: '/rap-aktual/terpusat', permissions: ['view_rap'] },
						{ title: 'Kontrak Jatuh Tempo', href: '/kontrak-terpusat', permissions: ['view_all_projects', 'view_own_projects'] },
						{ title: 'SPK Jatuh Tempo', href: '/spk-terpusat', permissions: ['view_all_projects', 'view_own_projects', 'view_manpower'] },
						{ title: 'Manpower Rencana vs Realisasi', href: '/manpower-rencana-realisasi', permissions: ['view_all_projects', 'view_own_projects', 'view_manpower'] },
						{ title: 'Audit Log Override Dobel-Proyek', href: '/manpower-dobel-override-log', permissions: ['view_all_projects', 'view_own_projects', 'view_manpower'] },
						{ title: 'Packing List Proyek', href: '/packing-list', permissions: ['manage_packing'] },
						{ title: 'Opname Inventaris', href: '/inventory-proyek/opname', permissions: ['view_all_projects', 'view_own_projects'] },
						{ title: 'Stok Kritis Terpusat', href: '/inventory-proyek/kritis-terpusat', permissions: ['view_all_projects', 'view_own_projects'] },
						{ title: 'Barang Menganggur Lintas Proyek', href: '/inventory-proyek/barang-menganggur', permissions: ['view_all_projects', 'view_own_projects'] },
						{ title: 'Saldo Stok Semua Proyek', href: '/inventory-proyek/saldo-semua', permissions: ['view_all_projects', 'view_own_projects'] },
						{ title: 'Kasbon Manpower Terpusat', href: '/kasbon-terpusat', permissions: ['view_manpower'] },
						{ title: 'To-Do Terpusat', href: '/todo-terpusat', permissions: ['view_all_projects', 'view_own_projects'] },
						{ title: 'Closing/Evaluasi Terpusat', href: '/closing-evaluasi-terpusat', permissions: ['view_all_projects', 'view_own_projects'] },
						{ title: 'Manpower & Tim', href: '/manpower', permissions: ['view_manpower'] }
					]
				},
				{
					title: 'Maintenance & Bengkel',
					icon: IconTool,
					href: '/perawatan',
					activePrefixes: ['/perawatan', '/preventive', '/maintenance', '/support'],
					permissions: ['input_preventive', 'input_maintenance', 'input_support'],
					children: [
						{ title: 'Hub Perawatan', href: '/perawatan', exact: true },
						{ title: 'Preventive Maintenance', href: '/preventive', permissions: ['input_preventive'] },
						{ title: 'Work Order Saya', href: '/maintenance/work-order', permissions: ['input_maintenance'] },
						{ title: 'Survey & Tiket Saya', href: '/maintenance/survey', permissions: ['input_maintenance'] },
						{ title: 'Dashboard Maintenance', href: '/maintenance', permissions: ['input_maintenance'] },
						{ title: 'Support & Tiket Lapangan', href: '/support', permissions: ['input_support'] }
					]
				},
				{
					title: 'Inventory & Logistik',
					icon: IconPackage,
					href: '/barang',
					activePrefixes: ['/barang', '/stock-lapangan', '/komplain-customer', '/requisition', '/packing-list/pick', '/sji', '/sj-manual', '/driver', '/procurement', '/field-report'],
					permissions: ['view_field_report', 'view_stock_lapangan', 'input_stock_lapangan', 'view_sji', 'input_sji', 'manage_inventory_picking', 'submit_pengajuan_pembelian', 'access_requisition', 'terima_barang_po', 'access_driver', 'input_komplain_customer'],
					children: [
						{ title: 'Hub Barang & Logistik', href: '/barang', exact: true },
						{ title: 'Stok Lapangan', href: '/stock-lapangan', permissions: ['view_stock_lapangan', 'input_stock_lapangan'] },
						{ title: 'Lapor Komplain Mutu/Barang', href: '/komplain-customer', permissions: ['view_stock_lapangan', 'input_stock_lapangan', 'input_komplain_customer'] },
						{ title: 'Requisition Proyek', href: '/requisition', permissions: ['access_requisition'] },
						{ title: 'Ringkasan Barang', href: '/field-report', permissions: ['view_field_report'] },
						{ title: 'Picking Barcode', href: '/packing-list/pick', permissions: ['manage_inventory_picking'] },
						{ title: 'Surat Jalan Internal', href: '/sji', permissions: ['view_sji', 'input_sji'] },
						{ title: 'Surat Jalan Manual', href: '/sj-manual', permissions: ['view_sji', 'input_sji'] },
						{ title: 'Driver App (Logistik)', href: '/driver', permissions: ['access_driver'] },
						{ title: 'Pengajuan Beli (Procurement)', href: '/procurement', permissions: ['submit_pengajuan_pembelian'] },
						{ title: 'Approval Pembelian', href: '/procurement/approval', permissions: ['approve_pengajuan_pembelian'] },
						{ title: 'Konfirmasi Terima PO', href: '/procurement/terima', permissions: ['terima_barang_po'] }
					]
				},
				{
					title: 'Sales & Marketing',
					icon: IconMapPin,
					href: '/sales/hub',
					activePrefixes: ['/sales', '/kemitraan', '/komplain-customer', '/csr', '/atribusi'],
					permissions: ['input_sales', 'verify_sales', 'input_komplain_customer', 'access_csr', 'view_all_projects'],
					children: [
						{ title: 'Hub Sales & Marketing', href: '/sales/hub', exact: true },
						{ title: 'Log Kunjungan Sales', href: '/sales', permissions: ['input_sales'] },
						{ title: 'PO Customer', href: '/sales/po', permissions: ['input_sales'] },
						{ title: 'Prospek Sales', href: '/sales/prospek', permissions: ['input_sales'] },
						{ title: 'Input Kunjungan Baru', href: '/sales/baru', permissions: ['input_sales'] },
						{ title: 'Komplain Customer', href: '/komplain-customer', permissions: ['input_komplain_customer'] },
						{ title: 'Kemitraan & Atribusi', href: '/kemitraan', permissions: ['view_all_projects', 'input_sales'] },
						{ title: 'CSR & TJSL', href: '/csr', permissions: ['access_csr'] }
					]
				},
				{
					title: 'Produksi & R&D',
					icon: IconFlame,
					href: '/produksi/hub',
					activePrefixes: ['/produksi', '/rnd', '/produk'],
					permissions: ['input_produksi_harian', 'access_rnd'],
					children: [
						{ title: 'Hub Produksi & R&D', href: '/produksi/hub', exact: true },
						{ title: 'Input Produksi Harian', href: '/produksi/input-harian', permissions: ['input_produksi_harian'] },
						{ title: 'Monitoring Produksi', href: '/produksi', permissions: ['input_produksi_harian'] },
						{ title: 'R&D — Dokumen TDS/MSDS', href: '/rnd', permissions: ['access_rnd'] },
						{ title: 'Katalog Produk', href: '/produk', permissions: ['access_rnd'] }
					]
				},
				{
					title: 'HRD & GA',
					icon: IconBuildingSkyscraper,
					href: '/hrga/hub',
					activePrefixes: ['/hrga', '/ga-checklist', '/ga-request', '/satpam', '/fleet-booking', '/manpower', '/legal'],
					permissions: ['access_ga_checklist', 'access_security', 'access_fleet_booking', 'input_support', 'view_manpower', 'access_ess'],
					children: [
						{ title: 'Hub HRD & GA', href: '/hrga/hub', exact: true },
						{ title: 'GA Checklist Fasilitas', href: '/ga-checklist', permissions: ['access_ga_checklist'] },
						{ title: 'Permintaan Layanan GA', href: '/ga-request', permissions: ['access_ess'] },
						{ title: 'Peminjaman Kendaraan (Fleet)', href: '/fleet-booking', permissions: ['access_fleet_booking', 'access_ess'] },
						{ title: 'Peminjaman Kendaraan (ESS)', href: '/ess/kendaraan', permissions: ['access_fleet_booking'] },
						{ title: 'Keamanan & Satpam', href: '/satpam', permissions: ['access_security'] },
						{ title: 'Manpower & Tim Regu', href: '/manpower', permissions: ['view_manpower'] },
						{ title: 'Legal & Hak Cipta', href: '/legal/hak-cipta' }
					]
				},
				{
					title: 'HSE & Mutu',
					icon: IconShieldCheck,
					href: '/hse/hub',
					activePrefixes: ['/hse', '/jsa', '/toolbox', '/inspection'],
					permissions: ['access_hse', 'input_inspection', 'hse_jsa_create', 'hse_toolbox_lead'],
					children: [
						{ title: 'Hub HSE & Mutu', href: '/hse/hub', exact: true },
						{ title: 'Dashboard HSE & Insiden', href: '/hse', permissions: ['access_hse'] },
						{ title: 'Job Safety Analysis (JSA)', href: '/jsa', permissions: ['access_hse', 'hse_jsa_create'] },
						{ title: 'Toolbox Meeting', href: '/toolbox', permissions: ['access_hse', 'hse_toolbox_lead'] },
						{ title: 'Inspection Report (BPIR)', href: '/inspection', permissions: ['input_inspection'] }
					]
				}
			]
		},
		{
			title: 'Dokumen & SOP',
			items: [
				{
					title: 'Panduan & SOP',
					icon: IconBook,
					href: '/panduan',
					activePrefixes: ['/panduan', '/bantuan'],
					children: [
						{ title: 'Panduan Lengkap', href: '/panduan', exact: true },
						{ title: 'Bantuan Untuk Anda', href: '/bantuan' }
					]
				}
			]
		}
	]);

	let filteredSections = $derived.by(() => {
		return navSections.map((section) => {
			if (section.permissions && !canView(section.permissions)) {
				return { ...section, items: [] };
			}
			const visibleItems = section.items.filter((item) => {
				if (!canView(item.permissions)) return false;
				if (hiddenModules.includes(item.title)) return false;
				if (!navSettingsSearchQuery.trim()) return true;
				const query = navSettingsSearchQuery.trim().toLowerCase();
				const matchTitle = item.title.toLowerCase().includes(query);
				const matchChildren = item.children?.some(c => c.title.toLowerCase().includes(query));
				return matchTitle || matchChildren;
			});
			return {
				...section,
				items: visibleItems
			};
		}).filter(section => section.items.length > 0);
	});

	let allAvailableItems = $derived.by(() => {
		const items: MenuItem[] = [];
		for (const s of navSections) {
			for (const item of s.items) {
				if (canView(item.permissions)) {
					if (!navSettingsSearchQuery.trim() || item.title.toLowerCase().includes(navSettingsSearchQuery.trim().toLowerCase())) {
						items.push(item);
					}
				}
			}
		}
		return items;
	});

	function canView(permissions?: FeatureKey[], roles?: string[]): boolean {
		if ($authStore.roleId === 'super_admin' || $authStore.roleIds?.includes('super_admin')) return true;
		if (roles && roles.length > 0 && !roles.includes($authStore.roleId || '')) return false;
		if (!permissions || permissions.length === 0) return true;
		return permissions.some(p => hasPermission($authStore.roleId, p, $rolesStore, $authStore.roleIds));
	}

	function isItemActive(item: MenuItem): boolean {
		if (item.activePrefixes) {
			const current = page.url.pathname;
			if (item.activePrefixes.some(p => p === '/' ? current === '/' : current.startsWith(p))) {
				return true;
			}
		}
		if (item.href && isActive(item.href, item.exact)) return true;
		if (item.children) {
			return item.children.some(child => isActive(child.href || '', child.exact));
		}
		return false;
	}

	/** Anchor untuk GuidedTour (Fase 2, tutorial per role) — 'nav-<slug>' dari href. */
	function navSlug(href?: string): string {
		return 'nav-' + ((href || '').split('/').filter(Boolean)[0] || '');
	}

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const path = page.url.pathname;
		const roles = $rolesStore;
		
		if (checked && roleId) {
			if (path.startsWith('/manpower')) {
				if (!hasPermission(roleId, 'view_manpower', roles, $authStore.roleIds)) {
					goto('/');
				}
			}
		}
	});

	function toggleModuleVisibility(title: string) {
		if (hiddenModules.includes(title)) {
			hiddenModules = hiddenModules.filter((t) => t !== title);
		} else {
			hiddenModules = [...hiddenModules, title];
		}
		localStorage.setItem('epi_hidden_modules', JSON.stringify(hiddenModules));
	}

	function resetModuleVisibility() {
		hiddenModules = [];
		localStorage.removeItem('epi_hidden_modules');
	}

	function hideAllModules() {
		const viewableTitles: string[] = [];
		for (const s of navSections) {
			for (const item of s.items) {
				if (canView(item.permissions)) {
					viewableTitles.push(item.title);
				}
			}
		}
		hiddenModules = viewableTitles;
		localStorage.setItem('epi_hidden_modules', JSON.stringify(hiddenModules));
	}

	function isBaseNavItemHidden(href: string): boolean {
		if (hiddenModules.includes('Beranda') && href === '/') return true;
		if (hiddenModules.includes('Project') && (href === '/proyek' || href === '/proyek/hub' || href === '/laporan' || href === '/anggaran' || href === '/rap-aktual' || href === '/biaya-lapangan' || href === '/timeline' || href === '/leader')) return true;
		if (hiddenModules.includes('Inventory & Logistik') && (href === '/barang' || href.startsWith('/field-report') || href.startsWith('/stock-lapangan') || href.startsWith('/packing-list') || href.startsWith('/procurement') || href.startsWith('/sji') || href.startsWith('/sj-manual') || href.startsWith('/requisition') || href.startsWith('/driver'))) return true;
		if (hiddenModules.includes('Maintenance & Bengkel') && (href === '/perawatan' || href === '/preventive' || href.startsWith('/maintenance') || href === '/support')) return true;
		if (hiddenModules.includes('Sales & Marketing') && (href === '/sales' || href === '/sales/hub' || href === '/komplain-customer' || href === '/csr' || href === '/kemitraan' || href === '/atribusi')) return true;
		if (hiddenModules.includes('Produksi & R&D') && (href.startsWith('/produksi') || href === '/rnd')) return true;
		if (hiddenModules.includes('HRD & GA') && (href.startsWith('/hrga') || href === '/ga-checklist' || href === '/ga-request' || href === '/satpam' || href === '/fleet-booking' || href === '/manpower' || href === '/legal')) return true;
		if (hiddenModules.includes('Portal Karyawan') && href.startsWith('/ess')) return true;
		if (hiddenModules.includes('HSE & Mutu') && (href.startsWith('/hse') || href === '/jsa' || href === '/toolbox' || href === '/inspection')) return true;
		if (hiddenModules.includes('Panduan & SOP') && href === '/panduan') return true;
		if (hiddenModules.includes('Omnichannel') && href === '/omnichannel') return true;
		return false;
	}

	async function handleLogout() {
		await signOut(auth);
		goto('/login');
	}

	let baseNavItems = $derived([
		{ href: '/', label: 'Beranda', icon: IconHome },
		// Fase 6 (Lapangan): sebelumnya cuma ada di sidebar desktop, 2 level tersembunyi di
		// grup "Produksi & R&D" — nol adopsi karena operator lapangan (mobile) tidak pernah
		// melihatnya. Sekarang tampil langsung di bottom nav mobile.
		...(canView(['input_produksi_harian']) ? [{ href: '/produksi/input-harian', label: 'Input Harian', icon: IconDroplet }] : []),
		...(canView(['access_driver']) ? [{ href: '/driver', label: 'Driver', icon: IconTruck }] : []),
		...(canView(['access_security']) ? [{ href: '/satpam', label: 'Security', icon: IconShieldCheck }] : []),
		...(canView(['input_sales']) ? [{ href: '/sales/hub', label: 'Sales', icon: IconMapPin }] : []),
		...(canView(['input_maintenance']) ? [{ href: '/perawatan', label: 'Maintenance', icon: IconTool }] : []),
		...(canView(['view_stock_lapangan', 'input_stock_lapangan', 'manage_packing']) ? [{ href: '/barang', label: 'Barang', icon: IconPackage }] : []),
		...(canView(['input_laporan', 'approve_laporan']) ? [{ href: '/laporan', label: 'Laporan', icon: IconClipboardList }] : []),
		...(canView(['view_all_projects', 'view_own_projects']) ? [{ href: '/proyek/hub', label: 'Project', icon: IconBuildingFactory2 }] : []),
		// PRJ-29: satu pintu uang keluar (wizard merutekan ke kanal yang benar) — dulu hanya tertaut dari halaman Procurement.
		...(canView(['view_all_projects', 'view_own_projects']) ? [{ href: '/procurement/keluar-uang', label: 'Keluar Uang', icon: IconCash }] : []),
		...(canView(['access_ess']) ? [{ href: '/ess', label: 'Absensi', icon: IconClock }] : []),
		{ href: '/panduan', label: 'Panduan', icon: IconBook },
	].filter(item => !isBaseNavItemHidden(item.href)));

	function isActive(href: string, exact?: boolean) {
		if (href === '/') return page.url.pathname === '/';
		if (exact) return page.url.pathname === href || page.url.pathname === href + '/';
		return page.url.pathname.startsWith(href);
	}


</script>

{#if mobileMenuOpen}
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div class="sidebar-backdrop lg:hidden" onclick={() => mobileMenuOpen = false} transition:fade={{ duration: 150 }}></div>
{/if}

<aside class="sidebar {mobileMenuOpen ? 'open' : ''}">
	<!-- Logo -->
	<div class="px-4 py-3.5 flex items-center gap-2.5 border-b border-[var(--sys-sep)]">
		<div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 shadow-xs" style="background: var(--gl)">
			<IconBuildingFactory2 size={18} style="color: var(--g)" />
		</div>
		<div class="flex flex-col min-w-0">
			<h1 class="text-[14px] font-bold leading-tight tracking-tight truncate" style="color: var(--sys-label)">SI-TAMA</h1>
			<p class="text-[9px] font-semibold leading-tight tracking-wider uppercase opacity-75 truncate" style="color: var(--sys-label)">OPERATIONAL DASHBOARD</p>
		</div>
	</div>

	<!-- Nav Links Grouped by Section -->
	<nav class="flex-1 py-2 flex flex-col gap-0.5 px-1 overflow-y-auto">
		{#each filteredSections as section}
			<div class="sidebar-section-title">{section.title}</div>
			{#each section.items as item}
				<a
					class="sidebar-link {isItemActive(item) ? 'active' : ''}"
					href={item.href || ''}
					data-sveltekit-preload-data="hover"
					data-tour={navSlug(item.href)}
					onclick={() => mobileMenuOpen = false}
					onpointerenter={() => {
						if (item.href === '/proyek/hub' || item.href === '/proyek' || item.href === '/laporan') {
							prefetchProjectsForCurrentUser(false);
						}
					}}
				>
					{#if item.icon}
						<item.icon size={16} />
					{/if}
					<span class="flex-1 text-left truncate">{item.title}</span>
					{#if item.badge && item.badge > 0}
						<span class="text-[9px] font-bold text-white rounded-full min-w-[16px] h-4 flex items-center justify-center px-1 shrink-0" style="background: #DC2626">{item.badge}</span>
					{/if}
				</a>
			{/each}
		{/each}
	</nav>

	<!-- User info + compact action buttons -->
	<div class="px-3 py-3 border-t border-[var(--sys-sep)] bg-[var(--sys-bg)]">
		<div class="flex items-center gap-2 mb-2.5">
			<div class="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 shadow-xs" style="background: var(--gl); color: var(--g)">
				{getUserInitials($authStore.user)}
			</div>
			<div class="min-w-0 flex-1">
				<p class="text-[12px] font-semibold truncate leading-tight" style="color: var(--sys-label)">{getUserDisplay($authStore.user)}</p>
				<p class="text-[10px] truncate text-[var(--sys-label3)] mt-0.5">{getRoleLabel($authStore.roleId)}</p>
			</div>
			<div class="flex items-center gap-1 shrink-0">
				<OutboxBadge />
				<P2HQueueSync />
				<ScanSjQueueSync />
				<HelpMenuButton />
				{#if canAccessEss}
					<a
						href="/notifikasi"
						class="relative w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all bg-[var(--sys-fill)] hover:bg-[var(--sys-fill2)] text-[var(--sys-label2)]"
						onclick={() => (mobileMenuOpen = false)}
						title="Notifikasi"
						data-tour="notifikasi-bell"
					>
						<IconBell size={15} />
						{#if unreadNotifikasi > 0}
							<span class="absolute -top-1 -right-1 text-[8px] font-bold text-white rounded-full min-w-[14px] h-3.5 flex items-center justify-center px-0.5" style="background: #DC2626">{unreadNotifikasi > 99 ? '99+' : unreadNotifikasi}</span>
						{/if}
					</a>
				{/if}
			</div>
		</div>
		<div class="grid grid-cols-3 gap-1.5">
			<button
				type="button"
				class="sidebar-footer-btn"
				onclick={() => { navigationSettingsOpen = true; mobileMenuOpen = false; }}
				title="Atur Visibilitas Modul"
			>
				<IconSettings size={13} />
				<span>Atur</span>
			</button>
			<button
				type="button"
				class="sidebar-footer-btn"
				onclick={() => { supportModalTab = 'list'; showSupportModal = true; mobileMenuOpen = false; }}
				title="Tiket Bantuan"
			>
				<IconHeadset size={13} />
				<span>Tiket</span>
			</button>
			<button
				type="button"
				class="sidebar-footer-btn"
				onclick={() => goto('/pusat-draf')}
				title="Lihat & kelola isian form yang tersimpan otomatis di perangkat ini"
			>
				<IconFileText size={13} />
				<span>Draf</span>
			</button>
			<button
				type="button"
				class="sidebar-footer-btn text-rose-600 hover:text-rose-700 hover:bg-rose-50"
				onclick={handleLogout}
				title="Keluar dari Akun"
			>
				<IconLogout size={13} />
				<span>Keluar</span>
			</button>
		</div>
	</div>
</aside>

<div class="main-content flex flex-col flex-1 min-h-screen">
	<!-- Unified Global Header -->
	<header class="bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200/50 dark:border-slate-800 sticky top-0 z-30 transition-colors shrink-0">
		<div class="px-4 py-2.5 md:px-6 md:py-3.5 flex items-center justify-between gap-2 md:gap-4">
			<!-- Left: Hamburger (mobile/tablet) + Back Button + Breadcrumbs & Page Title -->
			<div class="flex items-center gap-2 sm:gap-3 min-w-0">
				<button
					type="button"
					class="lg:hidden p-2 -ml-1 rounded-xl text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
					onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
					aria-label="Buka menu"
					title="Menu"
				>
					<IconMenu2 size={20} />
				</button>

				{#if isNotRootPage}
					<button
						type="button"
						class="p-2 rounded-xl text-slate-600 hover:text-blue-600 dark:text-slate-300 dark:hover:text-blue-400 bg-slate-100/90 hover:bg-blue-50 dark:bg-slate-800/90 dark:hover:bg-blue-950/40 border border-slate-200/80 hover:border-blue-300/80 dark:border-slate-700/80 dark:hover:border-blue-700/80 transition-all shrink-0 active:scale-95 flex items-center justify-center group shadow-2xs"
						onclick={handleNavigateBack}
						aria-label="Kembali"
						title="Kembali ke halaman sebelumnya (Alt + ←)"
					>
						<IconArrowLeft size={18} class="transition-transform group-hover:-translate-x-0.5" />
					</button>
				{/if}

				<div class="flex flex-col min-w-0">
					{#if breadcrumbTrail.length > 1}
						<nav aria-label="Breadcrumb" class="hidden sm:flex items-center gap-1.5 text-[11px] font-medium text-slate-400 dark:text-slate-500 mb-0.5 truncate">
							{#each breadcrumbTrail as crumb, i}
								{#if i > 0}
									<IconChevronRight size={11} class="opacity-40 shrink-0" />
								{/if}
								{#if crumb.href && i < breadcrumbTrail.length - 1}
									<a
										href={crumb.href}
										data-sveltekit-preload-data="hover"
										class="hover:text-blue-600 dark:hover:text-blue-400 hover:underline transition-colors truncate"
									>
										{crumb.label}
									</a>
								{:else}
									<span class={i === breadcrumbTrail.length - 1 ? "text-slate-700 dark:text-slate-200 font-semibold" : ""}>
										{crumb.label}
									</span>
								{/if}
							{/each}
						</nav>
					{/if}
					<h1 class="text-base sm:text-lg md:text-xl font-extrabold text-slate-900 dark:text-slate-100 tracking-tight truncate leading-tight">
						{currentPageTitle}
					</h1>
				</div>
			</div>

			<!-- Right: Action Tools & Controls -->
			<div class="flex items-center gap-1 sm:gap-2 shrink-0">
				<!-- Global Search / Command Palette (⌘K) -->
				<button
					type="button"
					onclick={() => window.dispatchEvent(new CustomEvent('open-global-search'))}
					class="hidden sm:flex items-center gap-2 px-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200/70 dark:border-slate-700/70 rounded-xl text-slate-400 dark:text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:border-slate-300 transition-all"
					aria-label="Cari menu & proyek"
					title="Cari (⌘K / Ctrl+K)"
				>
					<IconSearch size={14} />
					<span class="text-[11px] font-medium hidden md:inline text-slate-500 dark:text-slate-400">Cari...</span>
					<span class="font-mono text-[9px] border border-slate-200 dark:border-slate-700 rounded px-1 py-0.5 text-slate-400">⌘K</span>
				</button>

				<!-- Expanded Toolbar / Preview Controls or Fixed Eye Button -->
				{#if $showToolbar}
					<div class="flex items-center bg-slate-100/90 dark:bg-slate-800/90 border border-slate-200/80 dark:border-slate-700/80 rounded-xl p-0.5 gap-0.5">
						{#if !isFrame}
							<div class="hidden sm:flex items-center bg-white/80 dark:bg-slate-700/80 rounded-lg p-0.5 gap-0.5 shadow-2xs" role="group" aria-label="Device Preview">
								<button
									type="button"
									onclick={() => setPreviewMode('desktop')}
									class="w-6 h-6 flex items-center justify-center rounded transition-colors {$previewMode === 'desktop' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'}"
									title="Tampilan Komputer (Desktop)"
								>
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
								</button>
								<button
									type="button"
									onclick={() => setPreviewMode('tablet')}
									class="w-6 h-6 flex items-center justify-center rounded transition-colors {$previewMode === 'tablet' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'}"
									title="Tampilan Tablet"
								>
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M6 21h12a2 2 0 002-2V5a2 2 0 00-2-2H6a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
								</button>
								<button
									type="button"
									onclick={() => setPreviewMode('mobile')}
									class="w-6 h-6 flex items-center justify-center rounded transition-colors {$previewMode === 'mobile' ? 'bg-blue-600 text-white shadow-2xs' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100'}"
									title="Tampilan HP (Mobile)"
								>
									<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"></path></svg>
								</button>
							</div>
							<div class="hidden sm:block w-[1px] h-4 bg-slate-200 dark:bg-slate-700 mx-0.5"></div>
						{/if}

						<button
							type="button"
							class="w-7 h-7 flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors"
							onclick={toggleDensity}
							title={$density === 'compact' ? 'Mode Nyaman' : 'Mode Kompak'}
						>
							{#if $density === 'compact'}
								<IconLayoutList size={15} />
							{:else}
								<IconLayoutGrid size={15} />
							{/if}
						</button>

						<button
							type="button"
							class="w-7 h-7 flex items-center justify-center rounded-lg transition-colors {$hematMode ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-700/60'}"
							onclick={toggleHematMode}
							title={$hematMode ? 'Matikan Mode Hemat' : 'Mode Hemat (kurangi efek visual & kompresi)'}
						>
							<IconBatteryEco size={15} />
						</button>

						<button
							type="button"
							class="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors"
							onclick={() => setShowToolbar(false)}
							title="Sembunyikan Toolbar"
						>
							<IconEyeOff size={15} />
						</button>
					</div>
				{:else}
					<!-- Fixed Eye Button in Header -->
					<button
						type="button"
						onclick={() => setShowToolbar(true)}
						class="p-2 rounded-xl text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
						title="Tampilkan Toolbar & Preview Tampilan"
						aria-label="Tampilkan Toolbar & Preview Tampilan"
					>
						<IconEye size={18} />
					</button>
				{/if}

				<!-- Theme Mode Toggle (Light/Dark) -->
				<button
					type="button"
					onclick={toggleThemeMode}
					class="p-2 rounded-xl text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
					title={$themeMode === 'dark' ? 'Mode Terang' : 'Mode Gelap'}
					aria-label={$themeMode === 'dark' ? 'Mode Terang' : 'Mode Gelap'}
				>
					{#if $themeMode === 'dark'}
						<IconSun size={18} />
					{:else}
						<IconMoon size={18} />
					{/if}
				</button>

				<!-- Badge kesiapan belanja (laporan harian + MoM) — hanya tampil untuk leader proyek -->
				<ReadinessBadge />

				<!-- Notifications Bell (if authenticated) -->
				{#if canAccessEss}
					<a
						href="/notifikasi"
						class="relative p-2 rounded-xl text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
						title="Notifikasi"
					>
						<IconBell size={18} />
						{#if unreadNotifikasi > 0}
							<span class="absolute top-1 right-1 min-w-[16px] h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white px-1 bg-red-600">
								{unreadNotifikasi > 99 ? '99+' : unreadNotifikasi}
							</span>
						{/if}
					</a>
				{/if}

				<!-- Help / Quick Support Modal -->
				<button
					type="button"
					onclick={() => { supportModalTab = 'create'; showSupportModal = true; }}
					class="p-2 rounded-xl text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
					title="Bantuan & Dukungan"
				>
					<IconHeadset size={18} />
				</button>
			</div>
		</div>
	</header>

	<SmartOnboardingBanner />

	{#if canView(['access_site_checkin'])}
		<ActiveCheckinBar />
	{/if}

	<!-- Denda Prosedural Fase 4 — pengingat pencegahan "belum absen pulang" -->
	<BelumAbsenPulangBar />

	{#if showAbnormalBanner}
		<AbnormalSessionBanner
			draftCount={abnormalSessionDraftCount}
			onDismiss={() => (showAbnormalBanner = false)}
		/>
	{/if}

	<!-- Main Page Slot -->
	<main class="flex-1 w-full pb-[60px] lg:pb-0">
		<svelte:boundary onerror={onErrorBoundary}>
			{@render children()}
			{#snippet failed(error)}
				<CrashRecoveryCard {error} />
			{/snippet}
		</svelte:boundary>
	</main>

	<!-- Standardized Global Footer -->
	<footer class="px-4 md:px-8 lg:px-10 pb-20 lg:pb-6 pt-4 text-[11px] text-slate-400 dark:text-slate-500 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center border-t border-slate-150/60 dark:border-slate-800/60 mt-auto bg-white/40 dark:bg-slate-900/40 shrink-0">
		<span>&copy; {new Date().getFullYear()} PT. Eltama Prima Indo. Seluruh hak cipta dilindungi undang-undang.</span>
		<span class="text-slate-300 dark:text-slate-700">&middot;</span>
		<a href="/legal/hak-cipta" class="hover:text-slate-600 dark:hover:text-slate-300 hover:underline transition-colors">Hak Cipta &amp; Legal</a>
	</footer>
</div>

<QuickSupportModal bind:show={showSupportModal} initialTab={supportModalTab} />

<!-- Asisten AI mengambang (global, dashboard lapangan) -->
<AsistenSheet />

<!-- Pusat Komunikasi (Unified Communication Hub Fase 4): Omnichannel read-only + Chat Tim -->
<CommHubSheet />

<!-- Guided tour (wizard) global — Fase 2, tutorial per role -->
<GuidedTour
	open={tourState.active != null}
	steps={tourState.active?.steps ?? []}
	onFinish={finishTour}
/>

<!-- Mobile Bottom Navigation -->
<nav class="lg:hidden fixed bottom-0 left-1/2 -translate-x-1/2 w-full bg-white/95 dark:bg-slate-900/95 border-t flex items-center justify-around z-40 px-1 backdrop-blur-md" style="border-color: var(--sys-sep); height: 60px;">
	{#each baseNavItems.slice(0, 4) as item}
		<a
			class="flex-1 flex flex-col items-center justify-center gap-1 h-full transition-colors {isActive(item.href) ? 'text-[var(--p)]' : 'text-[var(--sys-label4)] hover:text-[var(--sys-label2)]'}"
			href={item.href}
			data-tour={navSlug(item.href)}
		>
			<item.icon size={20} class={isActive(item.href) ? 'text-[var(--p)]' : ''} />
			<span class="text-[9px] font-bold truncate w-full text-center px-0.5 {isActive(item.href) ? 'text-[var(--p)]' : ''}">{item.label}</span>
		</a>
	{/each}

	<button
		class="flex-1 flex flex-col items-center justify-center gap-1 h-full transition-colors text-[var(--sys-label4)] hover:text-[var(--sys-label2)]"
		onclick={() => { supportModalTab = 'create'; showSupportModal = true; }}
	>
		<IconHeadset size={20} />
		<span class="text-[9px] font-bold truncate w-full text-center px-0.5">Bantuan</span>
	</button>

	<button
		class="flex-1 flex flex-col items-center justify-center gap-1 h-full transition-colors {mobileMenuOpen ? 'text-[var(--p)]' : 'text-[var(--sys-label4)] hover:text-[var(--sys-label2)]'}"
		onclick={() => mobileMenuOpen = !mobileMenuOpen}
	>
		<IconMenu2 size={20} class={mobileMenuOpen ? 'text-[var(--p)]' : ''} />
		<span class="text-[9px] font-bold truncate w-full text-center px-0.5 {mobileMenuOpen ? 'text-[var(--p)]' : ''}">Menu</span>
	</button>
</nav>

<!-- Tombol Scan universal (Fase 2 konsolidasi GA/Security 2026-07-13): satu tombol untuk
     OB/Kebersihan & Security, server yang menentukan checklist mana yang muncul. -->
{#if canView(['access_ga_checklist']) || canView(['access_security'])}
	<button
		type="button"
		class="fixed right-4 bottom-[76px] lg:bottom-6 z-40 w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white transition-transform active:scale-95"
		style="background: var(--g)"
		onclick={() => { universalScanError = ''; showUniversalScanner = true; }}
		title="Scan QR Titik Lokasi"
	>
		{#if universalScanResolving}
			<IconLoader2 size={22} class="animate-spin" />
		{:else}
			<IconQrcode size={22} />
		{/if}
	</button>
{/if}

{#if universalScanError}
	<div class="fixed left-1/2 -translate-x-1/2 bottom-[140px] lg:bottom-24 z-50 rounded-lg px-4 py-2 text-[12px] font-medium text-white shadow-lg max-w-[90vw] text-center" style="background: var(--re)">
		{universalScanError}
	</div>
{/if}

{#if showUniversalScanner}
	<QrScannerModal onDetect={onUniversalScanDetect} onClose={() => (showUniversalScanner = false)} />
{/if}

<!-- L3 Quick Action FAB (kiri, tidak tumpang tindih dengan tombol Scan Universal di kanan) -->
<QuickActionFab />

<!-- Modal Atur Visibilitas Navigasi -->
{#if navigationSettingsOpen}
	<!-- svelte-ignore a11y-click-events-have-key-events -->
	<!-- svelte-ignore a11y-no-static-element-interactions -->
	<div
		class="fixed inset-0 bg-slate-900/40 z-[100] flex items-start justify-center pt-20 px-4"
		onclick={() => (navigationSettingsOpen = false)}
		transition:fade={{ duration: 120 }}
	>
		<div class="w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-200 max-h-[75vh] flex flex-col overflow-hidden" onclick={(e) => e.stopPropagation()}>
			<div class="flex items-center justify-between px-6 py-4 border-b border-slate-100">
				<h3 class="text-sm font-bold text-slate-800">Atur Visibilitas Navigasi</h3>
				<button type="button" onclick={() => (navigationSettingsOpen = false)} class="text-xs font-semibold text-slate-400 hover:text-slate-650">Tutup</button>
			</div>
			<div class="flex-1 overflow-y-auto p-6 space-y-4">
				<p class="text-xs text-slate-500">Centang modul yang ingin ditampilkan di sidebar navigation Anda. Modul yang tidak dicentang akan disembunyikan.</p>
				<div class="relative w-full">
					<span class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
						<IconSearch size={16} />
					</span>
					<input
						type="text"
						bind:value={navSettingsSearchQuery}
						placeholder="Cari modul..."
						class="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 border border-slate-200/70 rounded-xl text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-300 transition-all"
					/>
					{#if navSettingsSearchQuery}
						<button
							type="button"
							onclick={() => (navSettingsSearchQuery = "")}
							class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
							aria-label="Bersihkan pencarian"
						>
							<IconX size={14} />
						</button>
					{/if}
				</div>
				{#if allAvailableItems.length > 0}
					<div class="grid grid-cols-1 gap-2 bg-slate-50 p-3 rounded-xl border border-slate-150">
						{#each allAvailableItems as item}
							<label class="flex items-center space-x-2.5 p-1 cursor-pointer hover:bg-slate-200/45 rounded transition-all">
								<input
									type="checkbox"
									checked={!hiddenModules.includes(item.title)}
									onchange={() => toggleModuleVisibility(item.title)}
									class="rounded text-blue-600 focus:ring-blue-500/30 border-slate-300 w-4 h-4 cursor-pointer"
								/>
								<span class="text-xs font-semibold text-slate-700">{item.title}</span>
							</label>
						{/each}
					</div>
				{:else}
					<div class="flex flex-col items-center justify-center py-8 text-slate-400">
						<IconSearch size={32} class="mb-2" />
						<span class="text-xs font-semibold">Tidak ada modul ditemukan</span>
					</div>
				{/if}
			</div>
			<div class="px-6 py-4 bg-slate-50 border-t border-slate-150 flex items-center justify-end gap-2">
				<button
					type="button"
					onclick={hideAllModules}
					class="px-4 py-2 border border-slate-250 text-slate-600 font-semibold rounded-lg text-xs hover:bg-slate-100 transition-all"
				>
					Sembunyikan Semua
				</button>
				<button
					type="button"
					onclick={resetModuleVisibility}
					class="px-4 py-2 border border-slate-250 text-slate-600 font-semibold rounded-lg text-xs hover:bg-slate-100 transition-all"
				>
					Tampilkan Semua
				</button>
				<button
					type="button"
					onclick={() => (navigationSettingsOpen = false)}
					class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs shadow-sm transition-all"
				>
					Selesai
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.scrollbar-none::-webkit-scrollbar {
		display: none;
	}
</style>
