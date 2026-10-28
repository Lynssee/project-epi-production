<script lang="ts">
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
import { authStore, getUserDisplay, getUserInitials, shouldFilterProjectsByLeader } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getProjectsForCurrentUser, getProjectScope } from '$lib/services/projectScope';
	import { getPengajuanAnggaran } from '$lib/services/finance';
	import { getReports, getBatchedReports, getBatchedTodayReports } from '$lib/services/reports';
	import {
		IconBuildingFactory2, IconLogout, IconBell, IconApps,
		IconClipboardList, IconReceipt2, IconStack, IconBuilding,
		IconChevronRight, IconClock, IconLoader2, IconShieldLock, IconPackage,
		IconSearch, IconUser, IconX, IconHelmet, IconCalendarTime, IconAlertCircle,
		IconAlertTriangle, IconShoppingCart, IconMenu2, IconEye, IconUserCircle
	} from '@tabler/icons-svelte';
	import { goto } from '$app/navigation';
	import { signOut } from 'firebase/auth';
	import { auth } from '$lib/firebase';
	import { getIdToken } from '$lib/services/secureDirectus';
	import FilterSort from '$lib/components/FilterSort.svelte';
	import InfiniteScroll from '$lib/components/InfiniteScroll.svelte';
	import KpiSummary from '$lib/components/KpiSummary.svelte';
	import NotificationPanel from '$lib/components/NotificationPanel.svelte';
	import { fetchMitraWidgetSummary, type MitraWidgetSummary } from '$lib/services/kemitraan';
	import { getBatchedProjectSummaries, type ProjectSummary } from '$lib/services/projectSummary';
	import { getUpcomingSubtasks } from '$lib/utils/lookAhead';
	import directus from '$lib/services/directus';
	import { readItems } from '@directus/sdk';
	import { fetchProductionKpiSummary, type ProductionKpiSummary } from '$lib/services/productionKpiWidget';
	import { getMyProspects, buildMyPipelineSummary, PROSPECT_STAGES } from '$lib/services/sales';
	import { getMyPaintOrders } from '$lib/services/paintOrderStatus';
	import { fetchSewaAlatSiteSaya } from '$lib/services/sewaAlatLapanganApi';
	import { getMyWorkloadSummary, type WorkloadSummary } from '$lib/services/plDelegation';
	import PersonalWidget from '$lib/components/ess/PersonalWidget.svelte';
	import KesiapanProyekWidget from '$lib/components/anggaran/KesiapanProyekWidget.svelte';
	import GateChangeBanner from '$lib/components/anggaran/GateChangeBanner.svelte';
	import DisiplinKesiapanWidget from '$lib/components/DisiplinKesiapanWidget.svelte';
	import PengecualianProyekWidget from '$lib/components/PengecualianProyekWidget.svelte';
	import GateKpiBannerMendesak from '$lib/components/ess/GateKpiBannerMendesak.svelte';
	import TunggakanFisikWidget from '$lib/components/TunggakanFisikWidget.svelte';
	import {
		getBudgetStatusLabel,
		getBudgetStatusClass,
		getBudgetStatusHint
	} from '$lib/constants/status';

	const DONE_STATUSES = new Set(['complete', 'done', 'closed', 'cancel', 'cancelled']);

	function formatRupiah(value: number): string {
		return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value || 0);
	}

	let projects = $state<any[]>([]);
	// SPL-01/02 — penanda "progres perlu ditinjau" per proyek (konflik isian manual / laporan belum terpetakan).
	let progressIssues = $state<Record<number, { message: string; created_at: string }>>({});
	async function loadProgressIssues(ids: number[]) {
		if (!ids.length) return;
		try {
			const token = await getIdToken();
			const res = await fetch('/api/proyek/progress-issues?ids=' + ids.join(','), {
				headers: { Authorization: 'Bearer ' + token }
			});
			if (!res.ok) throw new Error('HTTP ' + res.status);
			const data = await res.json();
			// Proyek yang ditanya tapi tidak ada di respons = sudah beres -> hapus penandanya.
			const next = { ...progressIssues };
			ids.forEach((id) => delete next[id]);
			progressIssues = { ...next, ...data };
		} catch (err) {
			console.error('Gagal memuat penanda progres perlu ditinjau:', err);
		}
	}
	let budgets = $state<any[]>([]);
	let todayReports = $state<Record<number, boolean>>({});
	let projectSummaries = $state<Record<number, ProjectSummary>>({});
	let summariesLoading = $state<Record<number, boolean>>({});
	let loading = $state(true);
	let currentDate = '';

	// KPI & Notifikasi
	let pendingAnggaran = $state<any[]>([]);
	let kpiProjects = $state<any[]>([]);
	let kpiReports = $state<Record<number, boolean>>({});
	let kpiLoading = $state(true);
	let showNotifications = $state(false);

	// Modul Kemitraan v2.0 Bab 07.4 — Widget Mitra di Beranda Lapangan. Dimuat
	// terpisah (non-blocking) dari pipeline KPI utama supaya tidak menambah
	// waktu tunggu render dashboard jika Directus lambat.
	let mitraWidget = $state<MitraWidgetSummary | null>(null);
	let mitraWidgetLoading = $state(true);

	// Fase 8 (Pertajam KPI Marketing & Manufaktur v2) — widget "My KPI" beranda.
	let productionKpiWidget = $state<ProductionKpiSummary | null>(null);
	let productionKpiLoading = $state(true);
	let myPipelineSummary = $state<ReturnType<typeof buildMyPipelineSummary> | null>(null);
	let myPipelineLoading = $state(true);

	// Fase 6 (Lapangan) — Kartu "Pesanan Saya": status produksi pesanan milik sales yang
	// login, via so_customer.karyawan_id. Kosong bila tidak punya karyawanId (least-privilege),
	// bukan menampilkan semua pesanan.
	let myPaintOrders = $state<Awaited<ReturnType<typeof getMyPaintOrders>>>([]);
	let myPaintOrdersLoading = $state(true);

	// Fase 6, Rencana Pertajam Rental Order v2 §9.2 L3 — widget countdown "N alat sewa harus
	// kembali dalam ≤3 hari" di proyek milik leader yang login. Non-blocking, sama pola dgn
	// myPaintOrders di atas.
	let sewaAlatMendekatiTenggat = $state<Awaited<ReturnType<typeof fetchSewaAlatSiteSaya>>>([]);
	let sewaAlatLoading = $state(true);

	// Sistem Delegasi Project Leader (Fase 2) — "Kapasitas Saya": X dari Y slot proyek terisi.
	// Hanya relevan untuk Project Leader beneran (karyawanId terisi + role difilter per-leader).
	let kapasitasWidget = $state<WorkloadSummary | null>(null);
	let kapasitasLoading = $state(true);

	// Fase 1 (Maksimalisasi Notifikasi Sales, 13 Agustus 2026): notifikasi sales personal
	// (visit diverifikasi/ditolak, laporan harian, dll) — app_notifications yang karyawan_id-nya
	// cocok dengan user sales yang login. Dikirim dari erp-epi-1 via salesNotify.js.
	let salesNotifications = $state<any[]>([]);

	// Fase 7 (Revamp Project Management v2, 3 Agustus 2026): kartu mini QCTS Health Score.
	// Murni baca cache projects.health_score (diisi manual/n8n dari admin) — tidak menghitung ulang
	// di lapangan. Kartu tidak muncul sendiri bila belum ada proyek dengan skor (jujur, bukan N/A dipaksa).
	let qctsScoredProjects = $derived(kpiProjects.filter((p) => p.health_score != null));
	let qctsAverageScore = $derived(
		qctsScoredProjects.length > 0
			? Math.round((qctsScoredProjects.reduce((s, p) => s + (p.health_score || 0), 0) / qctsScoredProjects.length) * 10) / 10
			: null
	);
	function qctsBand(score: number): { label: string; color: string } {
		if (score >= 90) return { label: 'Excellent', color: 'var(--g)' };
		if (score >= 70) return { label: 'Good', color: 'var(--b)' };
		if (score >= 50) return { label: 'Warning', color: 'var(--am)' };
		return { label: 'Critical', color: 'var(--re)' };
	}

	let kpiTotalAktif = $derived(kpiProjects.length);
	let kpiBelumLapor = $derived(kpiProjects.filter(p => !kpiReports[p.id]).length);
	let kpiAnggaranPending = $derived(pendingAnggaran.length);
	let kpiBerisiko = $derived(
		kpiProjects.filter(p => {
			if (!p.end_date) return false;
			const today = new Date(); today.setHours(0, 0, 0, 0);
			return new Date(p.end_date) < today && !DONE_STATUSES.has((p.status || '').toLowerCase().trim());
		}).length
	);
	let belumLaporKpiProjects = $derived(kpiProjects.filter(p => !kpiReports[p.id]));
	let deadlineProjects = $derived(
		kpiProjects.filter(p => {
			if (!p.end_date) return false;
			const today = new Date(); today.setHours(0, 0, 0, 0);
			return new Date(p.end_date) < today && !DONE_STATUSES.has((p.status || '').toLowerCase().trim());
		})
	);
	// Proyek yang deadline-nya dalam 7 hari ke depan (belum terlewat)
	let upcomingDeadlines = $derived(
		kpiProjects
			.filter(p => {
				if (!p.end_date) return false;
				const today = new Date(); today.setHours(0, 0, 0, 0);
				const deadline = new Date(p.end_date); deadline.setHours(0, 0, 0, 0);
				const daysLeft = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
				return daysLeft >= 0 && daysLeft <= 7 && !DONE_STATUSES.has((p.status || '').toLowerCase().trim());
			})
			.map(p => {
				const today = new Date(); today.setHours(0, 0, 0, 0);
				const deadline = new Date(p.end_date); deadline.setHours(0, 0, 0, 0);
				const daysLeft = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
				return { ...p, daysLeft };
			})
	);
	let totalNotifCount = $derived(kpiAnggaranPending + kpiBelumLapor + kpiBerisiko + upcomingDeadlines.length + salesNotifications.length);

	// Fase 5 (Penajaman Finance Project v2, 10 Agustus 2026): kartu ringkasan finance
	// lapangan — status budget (%), BUKAN nominal, konsisten dgn getProjectBudgetHealth
	// yang sengaja menyembunyikan angka Rupiah dari view leader.
	let budgetStatusCounts = $derived.by(() => {
		const counts = { sehat: 0, waspada: 0, kritis: 0, unknown: 0 };
		for (const pid of kpiProjects.map((p) => p.id)) {
			const status = projectSummaries[pid]?.budgetStatus ?? 'unknown';
			counts[status]++;
		}
		return counts;
	});
	
	let searchQuery = $state('');
	let sortOption = $state('');
	let filterOption = $state('active,on progress,waiting,repair,hold');
	
	let limit = 10;
	let offset = 0;
	let hasMore = true;
	let loadingMore = false;

	const sortOptions = [
		{ value: '-date_created', label: 'Paling Baru' },
		{ value: 'date_created', label: 'Paling Lama' },
		{ value: 'name', label: 'Nama (A-Z)' },
		{ value: '-name', label: 'Nama (Z-A)' },
	];

	const filterOptions = [
		{ value: 'active', label: 'Aktif' },
		{ value: 'on progress', label: 'On Progress' },
		{ value: 'waiting', label: 'Waiting' },
		{ value: 'hold', label: 'Hold' },
		{ value: 'repair', label: 'Repair' },
		{ value: 'closed', label: 'Closed' },
		{ value: 'complete', label: 'Selesai' }
	];

	let isSuperAdmin = $derived($authStore.roleId === 'super_admin');
	// Rencana RBAC v2, Bagian 11 ("Menu dibangun dari izin"): tombol Manpower
	// dulu digerbangi NAMA role ('leader') -- role baru buatan admin (mis.
	// "Koordinator Proyek") yang seharusnya juga lihat data manpower tidak akan
	// pernah muncul menunya sampai kode ini diubah manual. Diganti ke izin
	// view_manpower (hasPermission() sudah menangani bypass super_admin sendiri).
	let canViewManpower = $derived(hasPermission($authStore.roleId, 'view_manpower', $rolesStore));
	// Regu Saya hanya muncul untuk orang yang benar-benar memegang kursi Manpower
	// Leader/Wakil di suatu proyek — izin saja tidak cukup, karena izin tidak
	// mengikat seseorang ke proyek tertentu.
	let canAksesRegu = $derived(
		$authStore.manpowerLeaderProjectIds.length > 0 &&
		(hasPermission($authStore.roleId, 'absensi_tim_lapangan', $rolesStore) ||
			hasPermission($authStore.roleId, 'verifikasi_absensi_tim', $rolesStore))
	);
	let canAccessProcurement = $derived(
		hasPermission($authStore.roleId, 'submit_pengajuan_pembelian', $rolesStore) ||
		hasPermission($authStore.roleId, 'approve_pengajuan_pembelian', $rolesStore) ||
		hasPermission($authStore.roleId, 'terima_barang_po', $rolesStore)
	);
	let canAccessEss = $derived(
		hasPermission($authStore.roleId, 'access_ess', $rolesStore, $authStore.roleIds) &&
		(!!$authStore.karyawanId || $authStore.roleId === 'super_admin')
	);
	let userRoleLabel = $derived($authStore.roleId ? ($authStore.roleId === 'super_admin' ? 'Super Admin' : $authStore.roleId === 'leader' ? 'Leader' : $authStore.roleId) : '');

	onMount(async () => {
		currentDate = new Intl.DateTimeFormat('id-ID', {
			weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
		}).format(new Date());

		loading = true;
		await loadKpiData();
		await Promise.all([
			fetchProjects(),
			loadBudgets()
		]);
		loading = false;

		fetchMitraWidgetSummary()
			.then((r) => { mitraWidget = r; })
			.catch(() => {})
			.finally(() => { mitraWidgetLoading = false; });

		if (hasPermission($authStore.roleId, 'input_produksi_harian', $rolesStore)) {
			fetchProductionKpiSummary()
				.then((r) => { productionKpiWidget = r; })
				.finally(() => { productionKpiLoading = false; });
		} else {
			productionKpiLoading = false;
		}

		if (hasPermission($authStore.roleId, 'input_sales', $rolesStore, $authStore.roleIds)) {
			const isSuper = $authStore.roleId === 'super_admin' || $authStore.roleIds?.includes('super_admin');
			getMyProspects(isSuper ? null : $authStore.karyawanName)
				.then((rows) => { myPipelineSummary = buildMyPipelineSummary(rows); })
				.finally(() => { myPipelineLoading = false; });
			loadSalesNotifications();

			// Fase 6 (Lapangan) — Kartu "Pesanan Saya"
			getMyPaintOrders()
				.then((rows) => { myPaintOrders = rows; })
				.finally(() => { myPaintOrdersLoading = false; });
		} else {
			myPipelineLoading = false;
			myPaintOrdersLoading = false;
		}

		if ($authStore.karyawanId && shouldFilterProjectsByLeader($authStore.roleId)) {
			getMyWorkloadSummary($authStore.karyawanId, $authStore.karyawanName ?? undefined)
				.then((r) => { kapasitasWidget = r; })
				.finally(() => { kapasitasLoading = false; });
		} else {
			kapasitasLoading = false;
		}

		// Fase 6, Rencana Pertajam Rental Order v2 §9.2 L3 — countdown alat sewa. Query sendiri
		// menangani scope "tidak punya pegangan proyek → kosong" (least-privilege), jadi aman
		// dipanggil tanpa gate permission tambahan di sini.
		fetchSewaAlatSiteSaya()
			.then((rows) => { sewaAlatMendekatiTenggat = rows.filter((r) => r.hariTersisa != null && r.hariTersisa <= 3); })
			.catch(() => {})
			.finally(() => { sewaAlatLoading = false; });
	});

	// Fase 1 (Maksimalisasi Notifikasi Sales): notifikasi personal untuk sales rep yang login
	// (unread saja, 20 terbaru) — type diawali 'sales_' (lihat SALES_EVENTS di salesNotify.js).
	async function loadSalesNotifications() {
		if (!$authStore.karyawanId) return;
		try {
			salesNotifications = await directus.request(
				readItems('app_notifications', {
					filter: {
						karyawan_id: { _eq: $authStore.karyawanId },
						type: { _starts_with: 'sales_' },
						read: { _eq: false }
					},
					sort: ['-created_at'],
					limit: 20
				})
			);
		} catch (error) {
			console.error(error);
		}
	}

	async function loadBudgets() {
		try {
			const needsLeaderFilter = !getProjectScope().unrestricted;
			let projectIdsOpt = undefined;

			if (needsLeaderFilter) {
				if (kpiProjects.length === 0) {
					budgets = [];
					pendingAnggaran = [];
					return;
				}
				projectIdsOpt = kpiProjects.map(p => p.id);
			}

			const [budgResult, pendingResult] = await Promise.all([
				getPengajuanAnggaran(3, { projectIds: projectIdsOpt }),
				getPengajuanAnggaran(50, { filterStatus: 'menunggu', projectIds: projectIdsOpt })
			]);
			budgets = budgResult || [];
			pendingAnggaran = pendingResult || [];
		} catch (error) {
			console.error(error);
		}
	}

	// Timeline & Scope Management Fase 3 — Look-Ahead rolling 2/4 minggu, lintas proyek PL yang login.
	let lookAheadRows = $state<any[]>([]);
	let lookAheadWindowDays = $state(14);
	let lookAheadLoading = $state(false);

	async function loadLookAhead(projectIds: number[]) {
		if (projectIds.length === 0) { lookAheadRows = []; return; }
		lookAheadLoading = true;
		try {
			const rows = await directus.request(
				readItems('projects', {
					filter: { id: { _in: projectIds } },
					fields: ['id', 'name', 'timeline_planning'],
					limit: -1
				})
			);
			const result: any[] = [];
			for (const p of rows as any[]) {
				let tp = p.timeline_planning;
				if (typeof tp === 'string') { try { tp = JSON.parse(tp); } catch { tp = null; } }
				const upcoming = getUpcomingSubtasks(tp?.categories || [], lookAheadWindowDays);
				for (const u of upcoming) result.push({ ...u, projectId: p.id, projectName: p.name });
			}
			lookAheadRows = result.sort((a, b) => a.firstPlanDate.localeCompare(b.firstPlanDate));
		} catch (err) {
			console.error('Gagal memuat Look-Ahead:', err);
		} finally {
			lookAheadLoading = false;
		}
	}

	async function loadKpiData() {
		if (getProjectScope().kosong) { kpiLoading = false; return; }

		kpiLoading = true;
		try {
			const allActive = await getProjectsForCurrentUser(false, {
				limit: -1,
				filterStatus: 'active'
			});
			kpiProjects = allActive;
			loadLookAhead(allActive.map((p: any) => p.id));

			if (allActive.length > 0) {
				const tzOffset = (new Date()).getTimezoneOffset() * 60000;
				const today = new Date(Date.now() - tzOffset).toISOString().split('T')[0];
				const ids = allActive.map((p: any) => p.id);
				const reports = await getBatchedTodayReports(ids, today);
				const reportMap: Record<number, boolean> = {};
				for (const p of allActive) {
					const pr = (reports as any[]).filter(r => r.project_id === p.id);
					reportMap[p.id] = pr.some(r => (r.date || '').split('T')[0] === today);
				}
				kpiReports = reportMap;
			}
		} catch (err) {
			console.error('KPI load error:', err);
		} finally {
			kpiLoading = false;
		}
	}

	async function fetchProjects(isLoadMore = false) {
		if (getProjectScope().kosong) {
			if (!isLoadMore) projects = [];
			hasMore = false;
			return;
		}

		if (isLoadMore) {
			loadingMore = true;
		} else {
			offset = 0;
			hasMore = true;
		}

		try {
			const options = {
				limit,
				offset,
				search: searchQuery,
				sort: sortOption,
				filterStatus: filterOption
			};

			const newProjects = await getProjectsForCurrentUser(false, options);
			
			if (newProjects.length < limit) {
				hasMore = false;
			}

			if (isLoadMore) {
				projects = [...projects, ...newProjects];
			} else {
				projects = newProjects;
			}
			offset += limit;

			const tzOffset = (new Date()).getTimezoneOffset() * 60000;
			const today = new Date(Date.now() - tzOffset).toISOString().split('T')[0];
			if (newProjects.length > 0) {
				const projectIds = newProjects.map(p => p.id);
				loadProgressIssues(projectIds);
				const thirtyDaysAgo = new Date();
				thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
				const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().split('T')[0];

				const batchedReports = await getBatchedReports(projectIds, { startDate: thirtyDaysAgoStr });

				newProjects.forEach(p => {
					const projectReports = batchedReports.filter((r: any) => r.project_id === p.id);
					const hasToday = projectReports.some((r: any) => {
						const rDate = r.date ? r.date.split('T')[0] : '';
						return rDate === today;
					});
					todayReports[p.id] = hasToday;
				});

				projectIds.forEach(id => { summariesLoading[id] = true; });
				getBatchedProjectSummaries(projectIds, batchedReports)
					.then(summaries => {
						projectSummaries = { ...projectSummaries, ...summaries };
					})
					.catch(err => console.error('getBatchedProjectSummaries error:', err))
					.finally(() => {
						projectIds.forEach(id => { summariesLoading[id] = false; });
					});
			}
		} catch (error) {
			console.error('Gagal memuat data:', error);
		} finally {
			loadingMore = false;
		}
	}

	function handleSearchChange() {
		fetchProjects();
	}

	async function handleLogout() {
		await signOut(auth);
		goto('/login');
	}

	function getStatusLabel(projectId: number) {
		return todayReports[projectId] ? 'Sudah lapor' : 'Belum lapor';
	}

	function getStatusClass(projectId: number) {
		return todayReports[projectId] ? 'ok' : 'warn';
	}

	// getBudgetStatusLabel & getBudgetStatusClass diimpor dari $lib/constants/status.
	// Versi lokal di sini sebelumnya tidak mengenal 'Approved'/'Completed'/'Partial'
	// sehingga semua pengajuan yang sudah disetujui/dibayar tampil "Menunggu".

	/** Ikon hijau untuk pengajuan yang sudah beres (disetujui atau sudah dibayar). */
	function isBudgetSettled(status: string) {
		const c = getBudgetStatusClass(status);
		return c === 'ok' || c === 'paid';
	}

	function getProjectStatusLabel(status: string | null): string {
		if (!status) return '-';
		const s = status.toLowerCase().trim();
		if (s === 'on progress' || s === 'on_progress') return 'On Progress';
		if (s === 'repair') return 'Repair';
		if (s === 'waiting') return 'Waiting';
		if (s === 'prepare') return 'Persiapan';
		if (s === 'draft') return 'Draft';
		if (s === 'hold') return 'Hold';
		if (s === 'closed') return 'Closed';
		if (s === 'complete') return 'Selesai';
		if (s === 'done') return 'Selesai';
		return status;
	}

	function getProjectStatusClass(status: string | null): string {
		if (!status) return 'pend';
		const s = status.toLowerCase().trim();
		if (s === 'on progress' || s === 'on_progress' || s === 'repair') return 'ok';
		if (s === 'waiting' || s === 'prepare' || s === 'draft') return 'pend';
		if (s === 'hold' || s === 'closed') return 'warn';
		if (s === 'complete' || s === 'done') return 'done';
		return 'pend';
	}

	function isProjectAtRisk(project: any): boolean {
		if (!project.end_date) return false;
		const today = new Date(); today.setHours(0, 0, 0, 0);
		return new Date(project.end_date) < today && !DONE_STATUSES.has((project.status || '').toLowerCase().trim());
	}
</script>

<div class="flex-1 flex flex-col h-full">

	{#if loading}
		<div class="flex-1 flex items-center justify-center" style="background: var(--sys-bg)">
			<div class="flex flex-col items-center gap-4">
				<div class="relative w-10 h-10">
					<div class="absolute inset-0 rounded-full border-2 border-[var(--gl)]"></div>
					<div class="absolute inset-0 rounded-full border-2 border-t-[var(--g)] border-r-transparent border-b-transparent border-l-transparent animate-spin"></div>
				</div>
				<p class="text-[13px] font-medium" style="color: var(--sys-label3)">Memuat data...</p>
			</div>
		</div>
	{:else}
		<div class="scroll-body px-4 sm:px-6 lg:px-8 py-6 w-full lg:max-w-none" style="background: var(--sys-bg)">
			<!-- User greeting card -->
			<div class="rounded-xl p-4 mb-6 flex items-center gap-4" style="background: var(--sys-bg2); border: 1px solid var(--sys-sep); box-shadow: 0 1px 2px rgba(0,0,0,0.04)">
				<div class="w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-bold text-white shrink-0" style="background: linear-gradient(135deg, var(--p) 0%, var(--pd) 100%); box-shadow: 0 2px 8px rgba(83,74,183,0.3)">
					{getUserInitials($authStore.user)}
				</div>
				<div class="flex-1 min-w-0">
					<p class="text-[15px] font-semibold truncate" style="color: var(--sys-label); letter-spacing: -0.3px">Halo, {getUserDisplay($authStore.user)}</p>
					<p class="text-[12px] mt-0.5 truncate" style="color: var(--sys-label3)">{currentDate}</p>
				</div>
				<button
					class="relative p-2 rounded-xl transition-colors hover:bg-[var(--sys-fill2)] active:scale-95"
					style="background: var(--sys-fill)"
					onclick={() => (showNotifications = !showNotifications)}
					title="Notifikasi"
				>
					<IconBell size={19} style="color: {totalNotifCount > 0 ? 'var(--p)' : 'var(--sys-label3)'}" />
					{#if totalNotifCount > 0}
						<div class="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-white px-1" style="background: var(--re)">
							{totalNotifCount > 9 ? '9+' : totalNotifCount}
						</div>
					{:else}
						<div class="absolute top-1.5 right-1.5 w-2 h-2 rounded-full border-2 border-white" style="background: var(--sys-label3); opacity: 0.3"></div>
					{/if}
				</button>
			</div>

			<!-- KPI Ringkasan Lintas Proyek -->
			<KpiSummary
				totalAktif={kpiTotalAktif}
				belumLapor={kpiBelumLapor}
				anggaranPending={kpiAnggaranPending}
				proyekBerisiko={kpiBerisiko}
				loading={kpiLoading}
			/>

			<!-- Fitur Personal Karyawan v2 Fase 4 — komponen mandiri, onMount sendiri,
			     tidak menumpang pipeline loading di atas (non-blocking by construction). -->
			<PersonalWidget />

			<!-- Fase 4 (Rencana v2 Shift-Left Gate Anggaran, 25 Sep 2026) — komponen mandiri,
			     pola sama PersonalWidget. Nol tampil bila tidak ada proyek/semua sudah siap. -->
			<KesiapanProyekWidget />

			<!-- L1 (Rencana Pertajam ERP) — banner kenaikan keketatan gate; komponen mandiri, nol tampil bila tidak ada. -->
			<GateChangeBanner />

			<!-- Fase 5 "Gate Disiplin Lapangan" (5 Okt 2026) — komponen mandiri, pola sama
			     PersonalWidget/KesiapanProyekWidget. Nol tampil bila profil mobile_role_policy
			     tidak mewajibkan apa pun untuk karyawan ini (default aman). -->
			<DisiplinKesiapanWidget />

			<!-- Unified KPI Gate Fase 4: peringatan dokumen mendekati batas jam (nol tampil bila tidak ada). -->
			<GateKpiBannerMendesak />

			<!-- PRJ-31 — Pengecualian Hari Ini (ringkas) untuk Leader/PM; komponen mandiri, nol tampil bila tidak ada masalah. -->
			<PengecualianProyekWidget />

			<!-- Penajaman Gate SJ Fase 3 — Tunggakan Fisik Saya; nol tampil bila tidak ada SJ menunggak. -->
			<TunggakanFisikWidget />

			<!-- PRJ-29 — satu pintu uang keluar; wizard menanyakan jenisnya lalu merutekan ke form yang benar. -->
			{#if projects.length > 0}
				<button
					class="w-full my-3 flex items-center gap-3 p-4 rounded-xl text-left active:scale-[0.98] transition-all"
					style="background: var(--pl);"
					onclick={() => goto('/procurement/keluar-uang')}
					title="Bingung harus lewat form mana? Jawab beberapa pertanyaan, kami arahkan."
				>
					<span class="text-2xl">💸</span>
					<span class="flex-1">
						<span class="block text-[14px] font-bold" style="color: var(--sys-label)">Keluar Uang</span>
						<span class="block text-[11px]" style="color: var(--sys-label3)">BBM, belanja, jasa, reimburse — pilih jenisnya, kami arahkan ke form yang benar.</span>
					</span>
				</button>
			{/if}

			<!-- Modul Kemitraan v2.0 Bab 07.4 — Widget Mitra -->
			<!-- Sistem Delegasi Project Leader (Fase 2) — Widget Kapasitas Saya -->
			{#if !kapasitasLoading && kapasitasWidget}
				{@const pctUsed = kapasitasWidget.maxProyekSimultan > 0 ? Math.min(100, Math.round((kapasitasWidget.proyekAktif / kapasitasWidget.maxProyekSimultan) * 100)) : 0}
				{@const barColor = pctUsed >= 100 ? 'var(--re)' : pctUsed >= 66 ? 'var(--am)' : 'var(--g)'}
				<div class="rounded-xl p-3 mb-4" style="background: var(--sys-fill2); border: 1px solid var(--sys-sep)">
					<div class="flex items-center justify-between mb-2">
						<p class="text-[12px] font-semibold" style="color: var(--sys-label)">🎯 Kapasitas Saya</p>
						<span class="text-[11px] font-medium" style="color: var(--sys-label)">{kapasitasWidget.proyekAktif} / {kapasitasWidget.maxProyekSimultan} proyek</span>
					</div>
					<div class="w-full h-2.5 rounded-full overflow-hidden" style="background: var(--sys-fill)">
						<div class="h-full rounded-full" style="width: {pctUsed}%; background: {barColor}"></div>
					</div>
					{#if kapasitasWidget.spesialisasiUtama}
						<p class="text-[11px] mt-2" style="color: var(--sys-label-2)">Spesialisasi: {kapasitasWidget.spesialisasiUtama}</p>
					{/if}
					{#if pctUsed >= 100}
						<p class="text-[11px] mt-1" style="color: var(--re)">⚠️ Kapasitas penuh — koordinasikan dengan Manajer Proyek sebelum menerima proyek baru.</p>
					{/if}
				</div>
			{/if}

			{#if !mitraWidgetLoading && mitraWidget}
				<div class="rounded-xl p-3 mb-4" style="background: var(--sys-fill2); border: 1px solid var(--sys-sep)">
					<div class="flex items-center justify-between mb-2">
						<p class="text-[12px] font-semibold" style="color: var(--sys-label)">🤝 Mitra di Lapangan</p>
						{#if mitraWidget.dokumenPerluPerhatian > 0}
							<span class="text-[10px] px-2 py-0.5 rounded-full" style="background: var(--re); color: white">
								⚠️ {mitraWidget.dokumenPerluPerhatian} dokumen perlu perhatian
							</span>
						{/if}
					</div>
					{#if mitraWidget.pekerjaMitraAktif === 0}
						<p class="text-[11px]" style="color: var(--sys-label-2)">
							Belum ada pekerja yang tertaut ke mitra (penautan manpower→mitra masih berjalan bertahap).
						</p>
					{:else}
						<p class="text-[11px] mb-1" style="color: var(--sys-label-2)">
							{mitraWidget.pekerjaMitraAktif} pekerja mitra aktif hari ini
						</p>
						<div class="flex flex-wrap gap-1.5">
							{#each mitraWidget.mitraTerlibat.slice(0, 5) as m (m.id)}
								<span class="text-[10px] px-2 py-0.5 rounded-full" style="background: var(--sys-fill); color: var(--sys-label)">
									{m.nama} ({m.jumlahPekerja})
								</span>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Fase 8 (Pertajam KPI Marketing & Manufaktur v2) — Widget My Manufacturing KPI.
			     Bukan personal per-supervisor (spk tidak punya field pemilik) — menampilkan
			     KPI departemen Production apa adanya, sesuai keputusan user 12 Agu 2026. -->
			{#if !productionKpiLoading && productionKpiWidget}
				<div class="rounded-xl p-3 mb-4" style="background: var(--sys-fill2); border: 1px solid var(--sys-sep)">
					<div class="flex items-center justify-between mb-2">
						<p class="text-[12px] font-semibold" style="color: var(--sys-label)">🏭 KPI Produksi ({productionKpiWidget.periodLabel})</p>
					</div>
					<div class="grid grid-cols-3 gap-2 text-center">
						<div>
							<p class="text-[16px] font-bold" style="color: var(--sys-label)">{productionKpiWidget.efficiency}%</p>
							<p class="text-[10px]" style="color: var(--sys-label-2)">Efisiensi</p>
						</div>
						<div>
							<p class="text-[16px] font-bold" style="color: var(--sys-label)">{productionKpiWidget.defectRate}%</p>
							<p class="text-[10px]" style="color: var(--sys-label-2)">Defect Rate</p>
						</div>
						<div>
							<p class="text-[16px] font-bold" style="color: var(--sys-label)">{productionKpiWidget.onTimeDelivery}%</p>
							<p class="text-[10px]" style="color: var(--sys-label-2)">On-Time</p>
						</div>
					</div>
				</div>
			{/if}

			<!-- Fase 8 (Pertajam KPI Marketing & Manufaktur v2) — Widget My Sales Pipeline.
			     Genuinely personal (prospects.assigned_name). Tanpa countdown target —
			     sistem ini belum punya target JUMLAH LEAD mingguan, hanya target revenue
			     bulanan (sales_target), jadi tidak ditampilkan angka target yang dikarang. -->
			{#if !myPipelineLoading && myPipelineSummary && myPipelineSummary.totalCount > 0}
				<div class="rounded-xl p-3 mb-4" style="background: var(--sys-fill2); border: 1px solid var(--sys-sep)">
					<div class="flex items-center justify-between mb-2">
						<p class="text-[12px] font-semibold" style="color: var(--sys-label)">📈 Pipeline Saya</p>
						<span class="text-[10px] px-2 py-0.5 rounded-full" style="background: var(--sys-fill); color: var(--sys-label)">
							{myPipelineSummary.openCount} aktif
						</span>
					</div>
					<div class="flex flex-wrap gap-1.5">
						{#each PROSPECT_STAGES as s (s.value)}
							<span class="text-[10px] px-2 py-0.5 rounded-full" style="background: var(--sys-fill); color: var(--sys-label)">
								{s.label}: {myPipelineSummary.byStage[s.value]}
							</span>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Fase 6 (Lapangan, Paint Manufacturing Pipeline v2) — Kartu "Pesanan Saya":
			     status produksi pesanan cat yang saya (sales) tangani, plus ETA. Sumber data
			     paint_order dibangun di erp-epi-1 (Fase 0); di sini murni baca read-only. -->
			{#if !myPaintOrdersLoading && myPaintOrders.length > 0}
				<div class="rounded-xl p-3 mb-4" style="background: var(--sys-fill2); border: 1px solid var(--sys-sep)">
					<div class="flex items-center justify-between mb-2">
						<p class="text-[12px] font-semibold" style="color: var(--sys-label)">🎨 Pesanan Saya</p>
						<span class="text-[10px] px-2 py-0.5 rounded-full" style="background: var(--sys-fill); color: var(--sys-label)">
							{myPaintOrders.filter((o) => !o.is_selesai).length} berjalan
						</span>
					</div>
					<div class="space-y-2">
						{#each myPaintOrders.slice(0, 5) as order (order.id)}
							<div class="flex items-center justify-between text-[11px]">
								<div class="min-w-0 flex-1">
									<p class="font-medium truncate" style="color: var(--sys-label)">
										{order.customer_name || order.kode}
										{#if order.has_rework_batch}
											<!-- Fase 6.2: sinyal untuk leader proyek yang menunggu cat -- batch ini
											     sempat/sedang di-rework, ETA bisa mundur dari jadwal normal. -->
											<span class="text-[9px] px-1.5 py-0.5 rounded-full ml-1" style="background: var(--aml); color: var(--amd)">Batch rework</span>
										{/if}
									</p>
									<p class="truncate" style="color: var(--sys-label-2)">{order.kode}{order.target_kirim ? ` · target ${new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short' }).format(new Date(order.target_kirim))}` : ''}</p>
								</div>
								<span
									class="text-[10px] px-2 py-0.5 rounded-full shrink-0 ml-2"
									style="background: {order.is_selesai ? 'var(--gl)' : 'var(--sys-fill)'}; color: {order.is_selesai ? 'var(--g)' : 'var(--sys-label)'}"
								>
									{order.stage_label}
								</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Fase 6, Rencana Pertajam Rental Order v2 §9.2 L3 — countdown alat sewa dari vendor
			     yang wajib kembali ≤3 hari (atau sudah lewat tenggat), di proyek milik leader ini. -->
			{#if !sewaAlatLoading && sewaAlatMendekatiTenggat.length > 0}
				<div class="rounded-xl p-3 mb-4 border-l-4" style="background: #fff7ed; border-color: #ea580c;">
					<div class="flex items-center justify-between mb-2">
						<p class="text-[12px] font-bold" style="color: #9a3412">🔶 Alat Sewa Harus Kembali</p>
						<button
							type="button"
							class="text-[10px] px-2 py-0.5 rounded-full font-semibold"
							style="background: #fed7aa; color: #9a3412"
							onclick={() => goto('/sewa-alat')}
						>
							Lihat Semua
						</button>
					</div>
					<div class="space-y-1.5">
						{#each sewaAlatMendekatiTenggat.slice(0, 3) as row (row.id)}
							<div class="flex items-center justify-between text-[11px]">
								<p class="truncate flex-1" style="color: #9a3412">
									{row.items.map((it) => it.nama_barang).join(', ') || 'Alat sewa'} · {row.project_name}
								</p>
								<span class="shrink-0 ml-2 font-semibold" style="color: {row.hariTersisa != null && row.hariTersisa < 0 ? '#dc2626' : '#ea580c'}">
									{row.hariTersisa != null && row.hariTersisa < 0
										? `Terlambat ${Math.abs(row.hariTersisa)}h`
										: row.hariTersisa === 0
											? 'Hari ini'
											: `${row.hariTersisa}h lagi`}
								</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Fase 7 (Revamp Project Management v2) — Kartu mini QCTS Health Score -->
			{#if qctsScoredProjects.length > 0}
				{@const band = qctsBand(qctsAverageScore ?? 0)}
				<div class="rounded-xl p-3 mb-4" style="background: var(--sys-fill2); border: 1px solid var(--sys-sep)">
					<div class="flex items-center justify-between">
						<p class="text-[12px] font-semibold" style="color: var(--sys-label)">📊 Kesehatan Proyek Saya</p>
						<span class="text-[10px] px-2 py-0.5 rounded-full font-bold" style="background: {band.color}; color: white">
							{qctsAverageScore} · {band.label}
						</span>
					</div>
					<p class="text-[11px] mt-1" style="color: var(--sys-label-2)">
						Rata-rata {qctsScoredProjects.length} dari {kpiProjects.length} proyek aktif Anda sudah punya skor Cost —
						dimensi lain (Scope/Time/Quality) masih N/A sampai fasenya tersedia.
					</p>
				</div>
			{/if}

			<!-- Timeline & Scope Management Fase 3 -- Look-Ahead rolling 2/4 minggu, lintas proyek saya -->
			<div class="rounded-xl p-3 mb-4" style="background: var(--sys-fill2); border: 1px solid var(--sys-sep)">
				<div class="flex items-center justify-between mb-1.5">
					<p class="text-[12px] font-semibold flex items-center gap-1.5" style="color: var(--sys-label)">
						<IconCalendarTime size={14} /> Look-Ahead
					</p>
					<select
						class="text-[10px] px-2 py-1 rounded-lg border-0"
						style="background: var(--sys-fill); color: var(--sys-label)"
						bind:value={lookAheadWindowDays}
						onchange={() => loadLookAhead(kpiProjects.map((p) => p.id))}
					>
						<option value={14}>2 Minggu</option>
						<option value={28}>4 Minggu</option>
					</select>
				</div>
				{#if lookAheadLoading}
					<p class="text-[11px] py-2" style="color: var(--sys-label3)">Memuat...</p>
				{:else if lookAheadRows.length === 0}
					<p class="text-[11px] py-2" style="color: var(--sys-label3)">Tidak ada aktivitas dalam rentang ini.</p>
				{:else}
					<div class="flex flex-col gap-1.5 mt-1">
						{#each lookAheadRows.slice(0, 8) as row (row.projectId + '-' + row.subtaskId)}
							<div class="flex items-center justify-between text-[11px] py-1" style="border-bottom: 1px solid var(--sys-sep)">
								<div class="min-w-0 flex-1">
									<span class="font-medium truncate" style="color: var(--sys-label)">{row.subtaskName}</span>
									<span style="color: var(--sys-label3)"> -- {row.projectName}</span>
								</div>
								<span class="shrink-0 ml-2" style="color: var(--sys-label3)">{row.firstPlanDate} → {row.lastPlanDate}</span>
							</div>
						{/each}
						{#if lookAheadRows.length > 8}
							<p class="text-[10px] mt-1" style="color: var(--sys-label3)">+{lookAheadRows.length - 8} aktivitas lainnya</p>
						{/if}
					</div>
				{/if}
			</div>

			<div class="flex flex-col lg:flex-row lg:gap-8 gap-6">
				<!-- Kolom Utama (Kiri di Desktop) -->
				<div class="flex-1 min-w-0 flex flex-col gap-8">
					<!-- Menu Utama -->
					<div>
						<div class="section-header mt-0 mb-4 text-[14px]">
							<IconApps size={16} class="mr-1.5" /> Menu Utama
						</div>
						<div class="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-4">
							<button
								class="rounded-2xl p-4 flex sm:flex-row text-center sm:text-left flex-col items-center gap-3 transition-all hover:shadow-md active:scale-[0.98]"
								style="background: var(--sys-bg2); box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
								onclick={() => goto('/laporan')}
							>
								<div class="w-10 h-10 sm:w-9 sm:h-9 mx-auto sm:mx-0 rounded-xl flex items-center justify-center shrink-0" style="background: var(--gl)">
									<IconClipboardList size={19} style="color: var(--g)" />
								</div>
								<div class="flex-1 min-w-0">
									<h3 class="text-[13px] font-semibold truncate" style="color: var(--sys-label); letter-spacing: -0.2px">Lap. Harian</h3>
									<p class="text-[11px] truncate mt-0.5 hidden sm:block" style="color: var(--sys-label3)">Input progres</p>
								</div>
							</button>
							<button
								class="rounded-2xl p-4 flex sm:flex-row text-center sm:text-left flex-col items-center gap-3 transition-all hover:shadow-md active:scale-[0.98]"
								style="background: var(--sys-bg2); box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
								onclick={() => goto('/anggaran')}
							>
								<div class="w-10 h-10 sm:w-9 sm:h-9 mx-auto sm:mx-0 rounded-xl flex items-center justify-center shrink-0" style="background: var(--pl)">
									<IconReceipt2 size={19} style="color: var(--p)" />
								</div>
								<div class="flex-1 min-w-0">
									<h3 class="text-[13px] font-semibold truncate" style="color: var(--sys-label); letter-spacing: -0.2px">Anggaran</h3>
									<p class="text-[11px] truncate mt-0.5 hidden sm:block" style="color: var(--sys-label3)">Kebutuhan dana</p>
								</div>
							</button>
							<button
								class="rounded-2xl p-4 flex sm:flex-row text-center sm:text-left flex-col items-center gap-3 transition-all hover:shadow-md active:scale-[0.98]"
								style="background: var(--sys-bg2); box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
								onclick={() => goto('/packing-list')}
							>
								<div class="w-10 h-10 sm:w-9 sm:h-9 mx-auto sm:mx-0 rounded-xl flex items-center justify-center shrink-0" style="background: var(--gl)">
									<IconPackage size={19} style="color: var(--g)" />
								</div>
								<div class="flex-1 min-w-0">
									<h3 class="text-[13px] font-semibold truncate" style="color: var(--sys-label); letter-spacing: -0.2px">Packing List</h3>
									<p class="text-[11px] truncate mt-0.5 hidden sm:block" style="color: var(--sys-label3)">Inventory</p>
								</div>
							</button>
							{#if canAccessProcurement}
								<button
									class="rounded-2xl p-4 flex sm:flex-row text-center sm:text-left flex-col items-center gap-3 transition-all hover:shadow-md active:scale-[0.98]"
									style="background: var(--sys-bg2); box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
									onclick={() => goto('/procurement')}
								>
									<div class="w-10 h-10 sm:w-9 sm:h-9 mx-auto sm:mx-0 rounded-xl flex items-center justify-center shrink-0" style="background: var(--pl)">
										<IconShoppingCart size={19} style="color: var(--p)" />
									</div>
									<div class="flex-1 min-w-0">
										<h3 class="text-[13px] font-semibold truncate" style="color: var(--sys-label); letter-spacing: -0.2px">Procurement</h3>
										<p class="text-[11px] truncate mt-0.5 hidden sm:block" style="color: var(--sys-label3)">Ajukan & terima barang</p>
									</div>
								</button>
							{/if}
							{#if canViewManpower}
								<button
									class="rounded-2xl p-4 flex sm:flex-row text-center sm:text-left flex-col items-center gap-3 transition-all hover:shadow-md active:scale-[0.98]"
									style="background: var(--sys-bg2); box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
									onclick={() => goto('/manpower')}
								>
									<div class="w-10 h-10 sm:w-9 sm:h-9 mx-auto sm:mx-0 rounded-xl flex items-center justify-center shrink-0" style="background: var(--gl)">
										<IconHelmet size={19} style="color: var(--g)" />
									</div>
									<div class="flex-1 min-w-0">
										<h3 class="text-[13px] font-semibold truncate" style="color: var(--sys-label); letter-spacing: -0.2px">Manpower</h3>
										<p class="text-[11px] truncate mt-0.5 hidden sm:block" style="color: var(--sys-label3)">Data pekerja</p>
									</div>
								</button>
							{/if}
							{#if canAksesRegu}
								<button
									class="rounded-2xl p-4 flex sm:flex-row text-center sm:text-left flex-col items-center gap-3 transition-all hover:shadow-md active:scale-[0.98]"
									style="background: var(--sys-bg2); box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
									onclick={() => goto('/regu')}
								>
									<div class="w-10 h-10 sm:w-9 sm:h-9 mx-auto sm:mx-0 rounded-xl flex items-center justify-center shrink-0" style="background: var(--gl)">
										<IconHelmet size={19} style="color: var(--g)" />
									</div>
									<div class="flex-1 min-w-0">
										<h3 class="text-[13px] font-semibold truncate" style="color: var(--sys-label); letter-spacing: -0.2px">Regu Saya</h3>
										<p class="text-[11px] truncate mt-0.5 hidden sm:block" style="color: var(--sys-label3)">Absen & verifikasi regu</p>
									</div>
								</button>
							{/if}
							{#if canAccessEss}
								<button
									class="rounded-2xl p-4 flex sm:flex-row text-center sm:text-left flex-col items-center gap-3 transition-all hover:shadow-md active:scale-[0.98]"
									style="background: var(--sys-bg2); box-shadow: 0 1px 4px rgba(0,0,0,0.06);"
									onclick={() => goto('/ess')}
								>
									<div class="w-10 h-10 sm:w-9 sm:h-9 mx-auto sm:mx-0 rounded-xl flex items-center justify-center shrink-0" style="background: var(--pl)">
										<IconUserCircle size={19} style="color: var(--p)" />
									</div>
									<div class="flex-1 min-w-0">
										<h3 class="text-[13px] font-semibold truncate" style="color: var(--sys-label); letter-spacing: -0.2px">Portal Karyawan</h3>
										<p class="text-[11px] truncate mt-0.5 hidden sm:block" style="color: var(--sys-label3)">Absensi, cuti & profil</p>
									</div>
								</button>
							{/if}
						</div>
					</div>

					<!-- Proyek Saya -->
					<div>
						<div class="section-header mt-0 mb-4 text-[14px]">
							<IconStack size={16} class="mr-1.5" /> Proyek Saya
						</div>

						<div class="mb-4">
							<FilterSort 
								bind:searchQuery
								bind:sortOption
								bind:filterOption
								{sortOptions}
								{filterOptions}
								multiple={true}
								placeholder="Cari proyek, lokasi, leader..."
								onSearch={handleSearchChange}
								onSortChange={handleSearchChange}
								onFilterChange={handleSearchChange}
							/>
						</div>

						{#if projects.length === 0}
							<div class="text-center py-8 text-[13px]" style="color: var(--sys-label3)">
								{#if searchQuery || filterOption}
									Tidak ada proyek yang cocok dengan filter / pencarian.
								{:else}
									Belum ada proyek.
								{/if}
							</div>
						{:else}
							<div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
								{#each projects as project}
									<div class="rounded-xl overflow-hidden flex flex-col transition-all hover:shadow-md" style="background: var(--sys-bg2); border: 1px solid var(--sys-sep); box-shadow: 0 1px 2px rgba(0,0,0,0.04);">
										<button
											class="flex-1 flex items-start gap-4 text-left cursor-pointer active:scale-[0.99] p-4 min-w-0 w-full"
											onclick={() => goto(`/proyek/${project.id}`)}
										>
											<div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-1" style="background: var(--gl)">
												<IconBuilding size={19} style="color: var(--g)" />
											</div>
											<div class="flex-1 min-w-0">
												<div class="flex items-start justify-between gap-2 mb-1.5">
													<h3 class="text-[13px] font-semibold line-clamp-2" style="color: var(--sys-label); letter-spacing: -0.2px">{project.name}</h3>
													<div class="flex items-center gap-1 shrink-0 mt-0.5">
														{#if isProjectAtRisk(project)}
															<span title="Deadline terlewat">
																<IconAlertTriangle size={14} style="color: #D97706" />
															</span>
														{/if}
														<span class="badge {getProjectStatusClass(project.status)}" style="font-size: 10px; padding: 2px 7px">{getProjectStatusLabel(project.status)}</span>
													</div>
												</div>
												<p class="text-[11px] truncate mb-2" style="color: var(--sys-label3)">
													{project.lokasi || '-'} · ID-{project.id}
													{#if project.leader && project.leader !== '-'} <br/> {project.leader}{/if}
												</p>
												{#if progressIssues[project.id]}
													<div
														class="mb-2 rounded-lg px-2.5 py-1.5 text-[11px] font-bold flex items-start gap-1.5 animate-pulse"
														style="background: var(--rel); color: var(--re); border: 2px solid var(--re)"
														title="{progressIssues[project.id].message} Hubungi Admin Project / PM untuk meninjau Timeline."
													>
														<IconAlertTriangle size={14} class="shrink-0 mt-px" />
														<span>Progres proyek perlu ditinjau — ada laporan yang belum terhitung. Hubungi Admin Project.</span>
													</div>
												{/if}
												<div class="flex items-center gap-1.5 flex-wrap">
													<span class="badge {getStatusClass(project.id)}" style="font-size: 10px; padding: 2px 7px">{getStatusLabel(project.id)}</span>
													{#if hasPermission($authStore.roleId, 'request_budget', undefined, $authStore.roleIds)}
														{@const bStatus = projectSummaries[project.id]?.budgetStatus}
														{#if bStatus && bStatus !== 'unknown'}
															{@const bCfg = { sehat: { label: 'Budget Sehat', color: 'var(--g)', bg: 'var(--gl)' }, waspada: { label: 'Budget Waspada', color: 'var(--amd)', bg: 'var(--aml)' }, kritis: { label: 'Budget Kritis', color: 'var(--re)', bg: 'var(--rel)' } }[bStatus]}
															<span class="badge" style="font-size: 10px; padding: 2px 7px; color: {bCfg.color}; background: {bCfg.bg}">💰 {bCfg.label}</span>
														{/if}
													{/if}
												</div>
											</div>
										</button>
										<div class="border-t px-4 py-2 flex gap-2" style="border-color: var(--sys-sep); background: var(--sys-fill)">
											<button
												class="flex-1 flex items-center justify-center gap-1.5 text-[12px] font-medium py-1.5 rounded-lg transition-all active:scale-95 hover:bg-black/5 dark:hover:bg-white/10"
												style="color: var(--g)"
												onclick={() => goto(`/timeline/${project.id}`)}
											>
												<IconCalendarTime size={15} /> Timeline
											</button>
											<button
												class="flex-1 flex items-center justify-center gap-1.5 text-[12px] font-medium py-1.5 rounded-lg transition-all active:scale-95 hover:bg-black/5 dark:hover:bg-white/10"
												style="color: var(--p)"
												onclick={() => goto(`/proyek/${project.id}`)}
											>
												Detail <IconChevronRight size={15} />
											</button>
										</div>
									</div>
								{/each}
							</div>
							<InfiniteScroll {hasMore} loading={loadingMore} onloadmore={() => fetchProjects(true)} />
						{/if}
					</div>
				</div>

				<!-- Kolom Sidebar (Kanan di Desktop) -->
				<div class="w-full lg:w-[320px] xl:w-[380px] shrink-0 flex flex-col gap-8">
					<!-- Info Payroll -->
					<div class="rounded-2xl p-4 flex gap-3 items-start" style="background: var(--rel); color: var(--re);">
						<IconAlertCircle size={20} class="shrink-0 mt-0.5" />
						<div class="flex-1">
							<p class="text-[13px] leading-relaxed" style="color: var(--re); letter-spacing: -0.2px">
								<strong class="font-bold">Info:</strong> Laporan ngelink dengan payroll yang berdampak pada penggajian leader. Harap diperhatikan kualitas dan kepatuhan laporan serta kedisiplinan.
							</p>
						</div>
					</div>

					<!-- Kepatuhan Laporan Hari Ini -->
					{#if !kpiLoading && kpiProjects.length > 0}
						{@const sudahLapor = kpiProjects.length - kpiBelumLapor}
						{@const pct = Math.round((sudahLapor / kpiProjects.length) * 100)}
						<div class="rounded-2xl p-4" style="background: var(--sys-bg2); border: 1px solid var(--sys-sep); box-shadow: 0 1px 4px rgba(0,0,0,0.05)">
							<p class="text-[11px] font-semibold uppercase tracking-wide mb-3" style="color: var(--sys-label3)">Laporan Hari Ini</p>
							<div class="flex items-end justify-between mb-2">
								<div>
									<span class="text-[28px] font-bold leading-none" style="color: {kpiBelumLapor > 0 ? 'var(--re)' : 'var(--g)'}; letter-spacing: -0.5px">{sudahLapor}</span>
									<span class="text-[14px]" style="color: var(--sys-label3)">/{kpiProjects.length}</span>
								</div>
								<div class="text-right">
									<p class="text-[12px] font-medium" style="color: var(--sys-label)">sudah lapor</p>
									{#if kpiBelumLapor > 0}
										<p class="text-[11px] mt-0.5" style="color: var(--re)">{kpiBelumLapor} belum lapor</p>
									{:else}
										<p class="text-[11px] mt-0.5" style="color: var(--g)">Semua sudah lapor ✓</p>
									{/if}
								</div>
							</div>
							<div class="rounded-full overflow-hidden h-1.5" style="background: var(--sys-fill2)">
								<div class="h-full rounded-full transition-all" style="width: {pct}%; background: {kpiBelumLapor > 0 ? 'var(--re)' : 'var(--g)'}"></div>
							</div>
						</div>
					{/if}

					<!-- Ringkasan Finance Proyek (Fase 5) — status budget %, bukan nominal -->
					{#if hasPermission($authStore.roleId, 'request_budget', undefined, $authStore.roleIds) && !kpiLoading && kpiProjects.length > 0}
						<div class="rounded-2xl p-4" style="background: var(--sys-bg2); border: 1px solid var(--sys-sep); box-shadow: 0 1px 4px rgba(0,0,0,0.05)">
							<p class="text-[11px] font-semibold uppercase tracking-wide mb-3" style="color: var(--sys-label3)">Ringkasan Finance Proyek</p>
							<div class="flex items-end justify-between mb-2">
								<div>
									<span class="text-[28px] font-bold leading-none" style="color: {kpiAnggaranPending > 0 ? '#d97706' : 'var(--g)'}; letter-spacing: -0.5px">{kpiAnggaranPending}</span>
								</div>
								<div class="text-right">
									<p class="text-[12px] font-medium" style="color: var(--sys-label)">pengajuan menunggu ACC</p>
								</div>
							</div>
							{#if budgetStatusCounts.kritis + budgetStatusCounts.waspada + budgetStatusCounts.sehat > 0}
								<div class="flex items-center gap-3 pt-2 mt-1 border-t" style="border-color: var(--sys-sep)">
									<div class="flex items-center gap-1.5 text-[11px]" style="color: var(--sys-label3)">
										<span class="w-2 h-2 rounded-full" style="background: var(--g)"></span> {budgetStatusCounts.sehat} sehat
									</div>
									<div class="flex items-center gap-1.5 text-[11px]" style="color: var(--sys-label3)">
										<span class="w-2 h-2 rounded-full" style="background: #d97706"></span> {budgetStatusCounts.waspada} waspada
									</div>
									<div class="flex items-center gap-1.5 text-[11px]" style="color: var(--sys-label3)">
										<span class="w-2 h-2 rounded-full" style="background: var(--re)"></span> {budgetStatusCounts.kritis} kritis
									</div>
								</div>
							{/if}
						</div>
					{/if}

					<!-- Pengajuan Terakhir -->
					{#if budgets.length > 0}
						<div>
							<div class="section-header mt-0 mb-4 text-[14px]">
								<IconClock size={16} class="mr-1.5" /> Pengajuan Terakhir
							</div>
							<div class="rounded-2xl overflow-hidden" style="background: var(--sys-bg2); box-shadow: 0 1px 4px rgba(0,0,0,0.05)">
								{#each budgets as budget, i}
									<button
										class="w-full flex items-center gap-4 px-5 py-4 text-left transition-colors hover:bg-[var(--sys-fill)] active:bg-[var(--sys-fill2)]"
										style="border-bottom: {i < budgets.length - 1 ? '1px solid var(--sys-sep)' : 'none'}"
										onclick={() => goto(`/anggaran/${budget.id}`)}
									>
										<div class="w-8 h-8 rounded-xl flex items-center justify-center shrink-0" style="background: {isBudgetSettled(budget.status) ? 'var(--gl)' : 'var(--pl)'}">
											<IconReceipt2 size={16} style="color: {isBudgetSettled(budget.status) ? 'var(--g)' : 'var(--p)'}" />
										</div>
										<div class="flex-1 min-w-0">
											<p class="text-[13px] font-medium truncate" style="color: var(--sys-label)">{budget.tujuan_pengajuan || 'Pengajuan Anggaran'}</p>
											<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">{new Intl.DateTimeFormat('id-ID', { month: 'short', day: 'numeric' }).format(new Date(budget.date_created))}</p>
										</div>
										<span class="badge {getBudgetStatusClass(budget.status)}" title={getBudgetStatusHint(budget.status)}>{getBudgetStatusLabel(budget.status)}</span>
									</button>
								{/each}
							</div>
						</div>
					{/if}
				</div>
			</div>

			<div class="h-6"></div>
		</div>
	{/if}

	<NotificationPanel
		bind:open={showNotifications}
		pendingAnggaran={pendingAnggaran}
		belumLaporProjects={belumLaporKpiProjects}
		deadlineProjects={deadlineProjects}
		upcomingDeadlines={upcomingDeadlines}
		salesNotifications={salesNotifications}
	/>
</div>
