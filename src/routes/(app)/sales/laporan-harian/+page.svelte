<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		getTodayDailyReport,
		getMyDailyReports,
		getMyVisits,
		getMySurveys,
		submitDailyReport,
		getTodaySalesExpenses,
		addDailySalesExpense,
		type DailyReportRow,
		type VisitSalesRow,
		type SurveyRow,
		type VisitExpenseItem
	} from '$lib/services/sales.ts';
	import { listMyPenawaran, type QuotationHeader } from '$lib/services/kalkulatorPenawaran.ts';
	import { getUpcomingFollowUps, getSalesVisitKpis } from '$lib/services/sales.ts';
	import { getMyPoStatusSummary } from '$lib/services/salesPo.ts';
	import SalesNavTabs from '$lib/components/sales/SalesNavTabs.svelte';
	import FieldExportButton from '$lib/components/sales/FieldExportButton.svelte';
	import CameraCaptureModal from '$lib/components/scanner/CameraCaptureModal.svelte';
	import { compressPhoto } from '$lib/utils/photoCompress.ts';
	import {
		IconArrowLeft,
		IconLoader2,
		IconCircleCheck,
		IconCircleX,
		IconClock,
		IconCalendar,
		IconMapPin,
		IconClipboardList,
		IconAlertCircle,
		IconSparkles,
		IconCheck,
		IconFileDollar,
		IconClipboardCheck,
		IconSearch,
		IconX,
		IconChevronDown,
		IconChevronUp,
		IconBuildingStore,
		IconReceipt,
		IconPlus
	} from '@tabler/icons-svelte';
	import { dailyReportSchema } from '$lib/schemas/dailyReport.ts';

	const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];

	let loading = $state(true);
	let submitting = $state(false);
	let errorMsg = $state('');
	let loadErrorMsg = $state('');

	let activeTab = $state<'today' | 'history'>('today');

	let existing = $state<DailyReportRow | null>(null);
	let pastReports = $state<DailyReportRow[]>([]);
	let todayVisits = $state<VisitSalesRow[]>([]);
	let todaySurveys = $state<SurveyRow[]>([]);
	let todayPenawaran = $state<QuotationHeader[]>([]);

	// Fase 2 Ops Sales Expenses & Bon Hari Ini
	let todayExpenses = $state<VisitExpenseItem[]>([]);
	let totalExpensesToday = $state(0);
	let showExpenseModal = $state(false);
	let selectedExpenseVisitId = $state<string>('');
	let selectedExpenseCategory = $state<'bbm' | 'tol' | 'parkir' | 'konsumsi' | 'lain'>('bbm');
	let expenseNominal = $state('');
	let expenseCatatan = $state('');
	let expenseReceiptFile = $state<File | null>(null);
	let expenseReceiptPreview = $state<string | null>(null);
	let savingExpense = $state(false);
	let expenseError = $state('');
	let showExpenseCamera = $state(false);
	let compressingExpensePhoto = $state(false);
	let zoomReceiptUrl = $state<string | null>(null);

	let showActivityDetails = $state(false);

	let totalOrder = $state('');
	let ringkasan = $state('');
	let kendala = $state('');
	let submitted = $state(false);

	// Filters in Riwayat
	let historySearch = $state('');
	let historyStatusFilter = $state<string>('all');

	let remindersCount = $state(0);
	let poNeedsAttention = $state(0);
	let pendingVisits = $state(0);

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && roles.length > 0 && !hasPermission(roleId, 'input_sales', roles, $authStore.roleIds)) {
			goto('/');
		}
	});

	async function loadAllData() {
		const isSuper = $authStore.roleId === 'super_admin' || $authStore.roleIds?.includes('super_admin');
		const salesId = $authStore.karyawanId;
		const salesName = $authStore.karyawanName;
		if (!salesId && !isSuper) {
			loadErrorMsg = 'Profil karyawan tidak ditemukan di sesi login. Hubungi admin.';
			loading = false;
			return;
		}

		loading = true;
		try {
			const [todayRep, pastList, allVisits, allSurveys, allPenawaran, reminderList, kpiData, expData] = await Promise.all([
				salesId ? getTodayDailyReport(salesId, today) : Promise.resolve(null),
				salesId ? getMyDailyReports(salesId) : Promise.resolve([]),
				getMyVisits(salesId),
				getMySurveys(isSuper ? null : salesName),
				listMyPenawaran(isSuper ? null : salesName),
				getUpcomingFollowUps(salesName),
				getSalesVisitKpis(salesId),
				getTodaySalesExpenses(today).catch(() => ({ expenses: [], totalNominal: 0, totalCount: 0 }))
			]);

			existing = todayRep;
			pastReports = pastList;
			todayVisits = allVisits.filter((v) => v.tanggal_kunjungan === today);
			todaySurveys = allSurveys.filter((s) => (s.tanggal_survey || '').slice(0, 10) === today);
			todayPenawaran = allPenawaran.filter((p) => (p.tanggal || '').slice(0, 10) === today);
			todayExpenses = expData.expenses || [];
			totalExpensesToday = expData.totalNominal || 0;

			remindersCount = reminderList.length;
			pendingVisits = kpiData.menungguVerifikasi;

			if ($authStore.karyawanId) {
				try {
					const poSummary = await getMyPoStatusSummary($authStore.karyawanId);
					poNeedsAttention = (poSummary.belum_ada || 0) + (poSummary.revisi || 0);
				} catch {}
			}
		} catch (err: any) {
			console.error('[laporan-harian] load error:', err);
			loadErrorMsg = err?.message || 'Gagal memuat data laporan harian.';
		} finally {
			loading = false;
		}
	}

	onMount(loadAllData);

	function formatRupiah(n: number | null | undefined) {
		if (!n) return 'Rp 0';
		return 'Rp ' + Math.round(Number(n)).toLocaleString('id-ID');
	}

	function generateAutoSummary() {
		const parts: string[] = [];
		if (todayVisits.length > 0) {
			const names = todayVisits
				.map((v) => v.customer_name || v.tujuan)
				.filter(Boolean)
				.slice(0, 3)
				.join(', ');
			parts.push(`• Kunjungan: ${todayVisits.length} lokasi (${names}${todayVisits.length > 3 ? ' dll.' : ''})`);
		}
		if (todaySurveys.length > 0) {
			const srvNames = todaySurveys.map((s) => `${s.customer_name || s.lokasi_project} (${s.nomor_survey})`).join(', ');
			parts.push(`• Survey Teknis: ${todaySurveys.length} survey (${srvNames})`);
		}
		if (todayPenawaran.length > 0) {
			const totalPnw = todayPenawaran.reduce((s, p) => s + (Number(p.grand_total) || 0), 0);
			parts.push(`• Penawaran: ${todayPenawaran.length} penawaran dibuat (Total estimasi: ${formatRupiah(totalPnw)})`);
		}
		if (todayExpenses.length > 0) {
			parts.push(`• Biaya Operasional: ${formatRupiah(totalExpensesToday)} (${todayExpenses.length} bon/struk tercatat)`);
		}

		if (parts.length === 0) {
			ringkasan = 'Melakukan koordinasi dan follow-up kebutuhan customer/prospek.';
		} else {
			ringkasan = parts.join('\n');
		}

		// Auto-suggest omzet jika ada penawaran accepted hari ini
		const wonToday = todayPenawaran.filter((p) => p.status === 'accepted');
		if (wonToday.length > 0 && (!totalOrder || totalOrder === '0')) {
			const sumWon = wonToday.reduce((s, p) => s + (Number(p.grand_total) || 0), 0);
			totalOrder = String(Math.round(sumWon));
		}
	}

	const EXPENSE_CATEGORIES = [
		{ id: 'bbm', label: 'BBM', directusJenis: 'bbm', emoji: '⛽' },
		{ id: 'tol', label: 'Tol', directusJenis: 'tol', emoji: '🛣️' },
		{ id: 'parkir', label: 'Parkir', directusJenis: 'parkir', emoji: '🅿️' },
		{ id: 'konsumsi', label: 'Konsumsi', directusJenis: 'lain', emoji: '🍽️' },
		{ id: 'lain', label: 'Lainnya', directusJenis: 'lain', emoji: '📋' }
	] as const;

	function resetExpenseModal() {
		showExpenseModal = false;
		selectedExpenseVisitId = '';
		selectedExpenseCategory = 'bbm';
		expenseNominal = '';
		expenseCatatan = '';
		expenseReceiptFile = null;
		expenseReceiptPreview = null;
		expenseError = '';
	}

	async function handleCameraExpenseCapture(file: File) {
		showExpenseCamera = false;
		compressingExpensePhoto = true;
		try {
			const compressed = await compressPhoto(file);
			expenseReceiptFile = compressed;
			expenseReceiptPreview = URL.createObjectURL(compressed);
		} catch (e) {
			expenseReceiptFile = file;
			expenseReceiptPreview = URL.createObjectURL(file);
		} finally {
			compressingExpensePhoto = false;
		}
	}

	function handleExpenseFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (file) handleCameraExpenseCapture(file);
	}

	async function handleSaveDailyExpense() {
		const rawNominal = expenseNominal.replace(/\D/g, '');
		const nominal = Number(rawNominal);
		if (!Number.isFinite(nominal) || nominal <= 0) {
			expenseError = 'Nominal biaya harus lebih dari 0.';
			return;
		}

		const catObj = EXPENSE_CATEGORIES.find((c) => c.id === selectedExpenseCategory) || EXPENSE_CATEGORIES[0];
		const directusJenis = catObj.directusJenis;
		const defaultCatatan = selectedExpenseCategory === 'konsumsi' ? 'Konsumsi/Entertain Meeting' : catObj.label;
		const finalCatatan = expenseCatatan.trim() || defaultCatatan;

		savingExpense = true;
		expenseError = '';

		try {
			const fd = new FormData();
			fd.append('jenis', directusJenis);
			fd.append('nominal', String(nominal));
			fd.append('catatan', finalCatatan);
			if (selectedExpenseVisitId) {
				fd.append('visit_sales_id', selectedExpenseVisitId);
			}
			if (expenseReceiptFile) {
				fd.append('foto_struk', expenseReceiptFile);
			}

			await addDailySalesExpense(fd);
			resetExpenseModal();

			// Reload expenses
			const expData = await getTodaySalesExpenses(today);
			todayExpenses = expData.expenses || [];
			totalExpensesToday = expData.totalNominal || 0;
		} catch (err: any) {
			expenseError = err?.message || 'Gagal menyimpan biaya operasional.';
		} finally {
			savingExpense = false;
		}
	}

	function getExpenseBadge(jenis: string, catatan: string | null) {
		const catLower = (catatan || '').toLowerCase();
		if (catLower.includes('konsumsi') || catLower.includes('makan') || catLower.includes('entertain')) {
			return { label: 'Konsumsi', emoji: '🍽️', color: 'text-amber-700 bg-amber-500/10 border-amber-500/20' };
		}
		if (jenis === 'bbm') {
			return { label: 'BBM', emoji: '⛽', color: 'text-rose-700 bg-rose-500/10 border-rose-500/20' };
		}
		if (jenis === 'tol') {
			return { label: 'Tol', emoji: '🛣️', color: 'text-blue-700 bg-blue-500/10 border-blue-500/20' };
		}
		if (jenis === 'parkir') {
			return { label: 'Parkir', emoji: '🅿️', color: 'text-purple-700 bg-purple-500/10 border-purple-500/20' };
		}
		return { label: 'Lainnya', emoji: '📋', color: 'text-zinc-700 bg-zinc-500/10 border-zinc-500/20' };
	}


	async function handleSubmit() {
		const salesId = $authStore.karyawanId;
		const salesName = $authStore.karyawanName;
		if (!salesId || !salesName || submitting) return;

		const parsed = dailyReportSchema.safeParse({ totalOrder, ringkasan, kendala });
		if (!parsed.success) {
			errorMsg = parsed.error.issues[0]?.message || 'Data laporan tidak valid.';
			return;
		}

		submitting = true;
		errorMsg = '';
		try {
			const row = await submitDailyReport({
				salesId,
				salesName,
				tanggal: today,
				totalKunjungan: todayVisits.length,
				totalOrder: parsed.data.totalOrder,
				ringkasan: parsed.data.ringkasan,
				kendala: parsed.data.kendala
			});
			existing = row;
			submitted = true;
			pastReports = await getMyDailyReports(salesId);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal submit laporan harian.';
		} finally {
			submitting = false;
		}
	}

	function badgeStyle(status: string) {
		if (status === 'verified') return 'background:var(--gg); color:var(--ggd)';
		if (status === 'rejected') return 'background:var(--rel); color:var(--red)';
		if (status === 'submitted') return 'background:var(--aml); color:var(--amd)';
		return 'background:var(--sys-fill); color:var(--sys-label3)';
	}

	function badgeLabel(status: string) {
		if (status === 'verified') return 'Disetujui SPV';
		if (status === 'rejected') return 'Ditolak SPV';
		if (status === 'submitted') return 'Menunggu Verifikasi SPV';
		return 'Draft';
	}

	// Filtered past reports
	let filteredPastReports = $derived.by(() => {
		let list = pastReports;
		if (historyStatusFilter !== 'all') {
			list = list.filter((r) => r.verifikasi_status === historyStatusFilter);
		}
		if (historySearch.trim()) {
			const q = historySearch.trim().toLowerCase();
			list = list.filter(
				(r) =>
					(r.ringkasan && r.ringkasan.toLowerCase().includes(q)) ||
					(r.kendala && r.kendala.toLowerCase().includes(q)) ||
					(r.catatan_spv && r.catatan_spv.toLowerCase().includes(q)) ||
					(r.tanggal && r.tanggal.includes(q))
			);
		}
		return list;
	});

	let exportRows = $derived(
		filteredPastReports.map((r) => ({
			tanggal: (r.tanggal ?? '').slice(0, 10),
			total_kunjungan: r.total_kunjungan ?? 0,
			total_order: r.total_order ?? 0,
			ringkasan: r.ringkasan ?? '',
			kendala: r.kendala ?? '',
			status_verifikasi: r.verifikasi_status ?? '',
			catatan_spv: r.catatan_spv ?? ''
		}))
	);
</script>

<div class="scroll-body">
	<div class="max-w-4xl mx-auto p-4 md:p-6 pb-24">
		<!-- Header -->
		<div class="flex items-center justify-between gap-3 mb-4">
			<div>
				<h1 class="text-[20px] font-black tracking-tight" style="color: var(--sys-label)">Laporan Harian Sales</h1>
				<p class="text-[12px] font-medium mt-0.5" style="color: var(--sys-label3)">Rekap kegiatan harian, capaian order, survey & kendala lapangan</p>
			</div>
		</div>

		<!-- Nav Tabs Sub-Menu -->
		<SalesNavTabs
			active="laporan"
			{remindersCount}
			poCount={poNeedsAttention}
			pendingCount={pendingVisits}
		/>

		<!-- Sub-tab switcher: Hari Ini vs Riwayat -->
		<div class="flex items-center p-1 rounded-2xl mb-4 border shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-fill)">
			<button
				type="button"
				class="flex-1 py-2 rounded-xl text-[12px] font-bold transition-all {activeTab === 'today'
					? 'bg-white dark:bg-zinc-800 shadow-sm text-[var(--p,var(--g))]'
					: 'text-zinc-500'}"
				onclick={() => (activeTab = 'today')}
			>
				Hari Ini ({new Date(today).toLocaleDateString('id-ID', { day: '2-digit', month: 'short' })})
			</button>
			<button
				type="button"
				class="flex-1 py-2 rounded-xl text-[12px] font-bold transition-all {activeTab === 'history'
					? 'bg-white dark:bg-zinc-800 shadow-sm text-[var(--p,var(--g))]'
					: 'text-zinc-500'}"
				onclick={() => (activeTab = 'history')}
			>
				Riwayat Laporan ({pastReports.length})
			</button>
		</div>

		{#if loading}
		<div class="flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat laporan harian sales..." />
		</div>
		{:else if loadErrorMsg}
			<div class="text-center py-16 text-[13px]" style="color: #DC2626">{loadErrorMsg}</div>
		{:else if activeTab === 'today'}
			<!-- Tab: Laporan Hari Ini -->
			{#if existing}
				<!-- Already submitted today -->
				<div class="rounded-2xl border p-6 shadow-sm mb-4" style="border-color: var(--sys-sep); background: var(--sys-bg)">
					<div class="text-center mb-5">
						<div class="w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto mb-3 border border-emerald-500/20">
							<IconCircleCheck size={32} />
						</div>
						<h2 class="text-[18px] font-extrabold" style="color: var(--sys-label)">Laporan Hari Ini Sudah Terkirim</h2>
						<p class="text-[12px] mt-1" style="color: var(--sys-label3)">
							{new Date(existing.tanggal).toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
						</p>

						<div class="inline-block mt-3">
							<span class="text-[11px] font-bold px-3.5 py-1 rounded-full shadow-sm" style={badgeStyle(existing.verifikasi_status)}>
								{badgeLabel(existing.verifikasi_status)}
							</span>
						</div>
					</div>

					{#if existing.catatan_spv}
						<div class="rounded-2xl p-4 text-left mb-4 text-[12px] border" style="background: var(--rel); border-color: var(--re)">
							<strong style="color: var(--red)">Catatan SPV:</strong>
							<p class="mt-1 font-medium" style="color: #7F1D1D">{existing.catatan_spv}</p>
						</div>
					{/if}

					<!-- Summary Box -->
					<div class="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-4 border-t" style="border-color: var(--sys-sep)">
						<div class="p-4 rounded-xl border" style="border-color: var(--sys-sep); background: var(--sys-fill)">
							<span class="text-[11px] font-bold block" style="color: var(--sys-label3)">Kunjungan Hari Ini:</span>
							<strong class="text-[18px] font-black" style="color: var(--sys-label)">{existing.total_kunjungan} lokasi</strong>
						</div>
						<div class="p-4 rounded-xl border" style="border-color: var(--sys-sep); background: var(--sys-fill)">
							<span class="text-[11px] font-bold block" style="color: var(--sys-label3)">Capaian Order / Omzet:</span>
							<strong class="text-[18px] font-black text-emerald-600 dark:text-emerald-400">{formatRupiah(existing.total_order)}</strong>
						</div>
						<div class="p-4 rounded-xl border col-span-2 sm:col-span-1" style="border-color: var(--sys-sep); background: var(--sys-fill)">
							<span class="text-[11px] font-bold block" style="color: var(--sys-label3)">Biaya & Bon Ops:</span>
							<strong class="text-[18px] font-black text-amber-600 dark:text-amber-400">{formatRupiah(totalExpensesToday)}</strong>
							<span class="text-[10px] block opacity-75">{todayExpenses.length} bon tercatat</span>
						</div>
					</div>

					{#if existing.ringkasan}
						<div class="mt-4 p-4 rounded-xl border text-left" style="border-color: var(--sys-sep); background: var(--sys-fill)">
							<span class="text-[11px] font-bold block mb-1" style="color: var(--sys-label3)">Ringkasan Aktivitas:</span>
							<p class="text-[13px] leading-relaxed whitespace-pre-line" style="color: var(--sys-label)">{existing.ringkasan}</p>
						</div>
					{/if}

					{#if existing.kendala}
						<div class="mt-3 p-4 rounded-xl border text-left" style="border-color: var(--sys-sep); background: var(--sys-fill)">
							<span class="text-[11px] font-bold block mb-1 text-amber-600 dark:text-amber-400">Kendala Lapangan:</span>
							<p class="text-[13px] leading-relaxed" style="color: var(--sys-label)">{existing.kendala}</p>
						</div>
					{/if}
				</div>
			{:else}
				<!-- Form Submit Today's Report -->
				<div class="flex flex-col gap-4">
					<!-- Auto-Aggregated Daily Activity Dashboard (3 Pilar) -->
					<div class="rounded-2xl border p-4 sm:p-5 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
						<div class="flex items-center justify-between gap-2 mb-3 pb-3 border-b" style="border-color: var(--sys-sep)">
							<div>
								<h2 class="text-[15px] font-bold" style="color: var(--sys-label)">Log Aktivitas Otomatis Hari Ini</h2>
								<p class="text-[11px]" style="color: var(--sys-label3)">
									Tanggal: {new Date(today).toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
								</p>
							</div>
							<span class="text-[11px] font-bold px-2.5 py-1 rounded-full bg-blue-500/10 text-[var(--p,var(--g))] border border-blue-500/20">
								Otomatis Terhubung
							</span>
						</div>

						<!-- 4 Metric Cards for Today's Work -->
						<div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
							<!-- Kunjungan -->
							<div class="p-3 rounded-xl border" style="border-color: var(--sys-sep); background: var(--sys-fill)">
								<div class="flex items-center justify-between mb-1">
									<span class="text-[11px] font-bold" style="color: var(--sys-label3)">Kunjungan</span>
									<IconMapPin size={15} class="text-rose-500" />
								</div>
								<p class="text-[18px] font-black" style="color: var(--sys-label)">{todayVisits.length} <span class="text-[12px] font-bold text-zinc-400">Lokasi</span></p>
							</div>

							<!-- Survey -->
							<div class="p-3 rounded-xl border" style="border-color: var(--sys-sep); background: var(--sys-fill)">
								<div class="flex items-center justify-between mb-1">
									<span class="text-[11px] font-bold" style="color: var(--sys-label3)">Survey Teknis</span>
									<IconClipboardCheck size={15} class="text-amber-500" />
								</div>
								<p class="text-[18px] font-black" style="color: var(--sys-label)">{todaySurveys.length} <span class="text-[12px] font-bold text-zinc-400">Survey</span></p>
							</div>

							<!-- Penawaran -->
							<div class="p-3 rounded-xl border" style="border-color: var(--sys-sep); background: var(--sys-fill)">
								<div class="flex items-center justify-between mb-1">
									<span class="text-[11px] font-bold" style="color: var(--sys-label3)">Penawaran</span>
									<IconFileDollar size={15} class="text-emerald-500" />
								</div>
								<p class="text-[18px] font-black" style="color: var(--sys-label)">{todayPenawaran.length} <span class="text-[12px] font-bold text-zinc-400">Item</span></p>
							</div>

							<!-- Biaya Operasional & Bon -->
							<div class="p-3 rounded-xl border" style="border-color: var(--sys-sep); background: var(--sys-fill)">
								<div class="flex items-center justify-between mb-1">
									<span class="text-[11px] font-bold" style="color: var(--sys-label3)">Biaya & Bon Ops</span>
									<IconReceipt size={15} class="text-purple-500" />
								</div>
								<p class="text-[18px] font-black text-amber-600 dark:text-amber-400 truncate">{formatRupiah(totalExpensesToday)}</p>
								<span class="text-[10px] block opacity-75 font-semibold text-zinc-400">{todayExpenses.length} bon</span>
							</div>
						</div>

						<!-- Expandable Activity List Toggle -->
						{#if todayVisits.length > 0 || todaySurveys.length > 0 || todayPenawaran.length > 0 || todayExpenses.length > 0}
							<button
								type="button"
								class="w-full flex items-center justify-between py-2 px-3 rounded-xl text-[11px] font-bold transition-colors hover:bg-black/5 dark:hover:bg-white/5"
								style="color: var(--p, var(--g))"
								onclick={() => (showActivityDetails = !showActivityDetails)}
							>
								<span>{showActivityDetails ? 'Sembunyikan Rincian Log' : 'Tampilkan Rincian Log Aktivitas'}</span>
								{#if showActivityDetails}
									<IconChevronUp size={15} />
								{:else}
									<IconChevronDown size={15} />
								{/if}
							</button>

							{#if showActivityDetails}
								<div class="flex flex-col gap-2.5 mt-2.5 pt-2.5 border-t text-[11px]" style="border-color: var(--sys-sep)">
									{#if todayVisits.length > 0}
										<div>
											<strong class="block mb-1 font-bold" style="color: var(--sys-label2)">Kunjungan Lapangan:</strong>
											<div class="flex flex-col gap-1">
												{#each todayVisits as v (v.id)}
													<div class="p-2 rounded-lg border flex items-center justify-between" style="border-color: var(--sys-sep); background: var(--sys-fill)">
														<span class="font-bold truncate" style="color: var(--sys-label)">{v.customer_name || v.tujuan}</span>
														<span class="text-[10px] opacity-75">{v.kegiatan || v.verifikasi_status}</span>
													</div>
												{/each}
											</div>
										</div>
									{/if}

									{#if todaySurveys.length > 0}
										<div>
											<strong class="block mb-1 font-bold" style="color: var(--sys-label2)">Survey Lapangan:</strong>
											<div class="flex flex-col gap-1">
												{#each todaySurveys as s (s.id)}
													<div class="p-2 rounded-lg border flex items-center justify-between" style="border-color: var(--sys-sep); background: var(--sys-fill)">
														<span class="font-bold truncate" style="color: var(--sys-label)">{s.customer_name || s.lokasi_project}</span>
														<span class="text-[10px] font-mono text-[var(--p,var(--g))]">{s.nomor_survey}</span>
													</div>
												{/each}
											</div>
										</div>
									{/if}

									{#if todayPenawaran.length > 0}
										<div>
											<strong class="block mb-1 font-bold" style="color: var(--sys-label2)">Penawaran Harga:</strong>
											<div class="flex flex-col gap-1">
												{#each todayPenawaran as p (p.id)}
													<div class="p-2 rounded-lg border flex items-center justify-between" style="border-color: var(--sys-sep); background: var(--sys-fill)">
														<span class="font-bold truncate" style="color: var(--sys-label)">{p.customer_name || p.project_name}</span>
														<span class="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">{formatRupiah(p.grand_total)}</span>
													</div>
												{/each}
											</div>
										</div>
									{/if}

									{#if todayExpenses.length > 0}
										<div>
											<strong class="block mb-1 font-bold" style="color: var(--sys-label2)">Biaya Operasional & Bon Struk:</strong>
											<div class="flex flex-col gap-1">
												{#each todayExpenses as exp (exp.id)}
													{@const b = getExpenseBadge(exp.jenis, exp.catatan)}
													<div class="p-2 rounded-lg border flex items-center justify-between gap-2" style="border-color: var(--sys-sep); background: var(--sys-fill)">
														<div class="flex items-center gap-2 min-w-0">
															<span class="text-[9px] font-bold px-1.5 py-0.5 rounded border {b.color}">{b.label}</span>
															<span class="font-bold truncate text-[11px]" style="color: var(--sys-label)">{exp.lokasi_nama || exp.catatan || 'Operasional'}</span>
														</div>
														<span class="text-[11px] font-bold text-amber-600 dark:text-amber-400 shrink-0">{formatRupiah(exp.nominal)}</span>
													</div>
												{/each}
											</div>
										</div>
									{/if}
								</div>
							{/if}
						{/if}
					</div>

					<!-- Card Biaya Operasional Lapangan & Bon Hari Ini -->
					<div class="rounded-2xl border p-4 sm:p-5 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
						<div class="flex items-center justify-between gap-2 mb-3 pb-3 border-b" style="border-color: var(--sys-sep)">
							<div class="flex items-center gap-2.5">
								<div class="w-9 h-9 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center">
									<IconReceipt size={20} />
								</div>
								<div>
									<h2 class="text-[15px] font-bold" style="color: var(--sys-label)">Biaya Operasional Lapangan & Bon Hari Ini</h2>
									<p class="text-[11px]" style="color: var(--sys-label3)">
										{todayExpenses.length} bon tercatat &bull; Total: <strong class="text-emerald-600 dark:text-emerald-400">{formatRupiah(totalExpensesToday)}</strong>
									</p>
								</div>
							</div>

							<button
								type="button"
								class="px-3 py-1.5 rounded-xl text-[11px] font-bold flex items-center gap-1.5 text-white shadow-sm transition-transform active:scale-95 shrink-0"
								style="background: var(--p, var(--g))"
								onclick={() => (showExpenseModal = true)}
							>
								<IconPlus size={14} /> Catat Biaya Hari Ini
							</button>
						</div>

						{#if todayExpenses.length === 0}
							<div class="py-6 text-center rounded-xl border border-dashed" style="border-color: var(--sys-sep)">
								<p class="text-[12px] font-medium" style="color: var(--sys-label3)">
									Belum ada pengeluaran atau struk bon dicatat hari ini.
								</p>
								<p class="text-[10px] mt-0.5 text-zinc-400">
									Catat BBM, Tol, Parkir, atau Konsumsi untuk pengajuan reimbursement mingguan.
								</p>
								<button
									type="button"
									class="mt-2.5 px-3 py-1 rounded-lg text-[11px] font-bold border"
									style="border-color: var(--sys-sep); color: var(--p, var(--g))"
									onclick={() => (showExpenseModal = true)}
								>
									+ Catat Pengeluaran Sekarang
								</button>
							</div>
						{:else}
							<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
								{#each todayExpenses as exp (exp.id)}
									{@const badge = getExpenseBadge(exp.jenis, exp.catatan)}
									<div class="p-3 rounded-xl border flex items-center justify-between gap-3" style="border-color: var(--sys-sep); background: var(--sys-fill)">
										<div class="flex items-center gap-2.5 min-w-0">
											{#if exp.foto_struk}
												<button
													type="button"
													class="w-11 h-11 rounded-lg overflow-hidden border shrink-0 hover:opacity-90 relative"
													style="border-color: var(--sys-sep)"
													onclick={() => (zoomReceiptUrl = `/api/directus/assets/${exp.foto_struk}`)}
													title="Lihat bon"
												>
													<img
														src={`/api/directus/assets/${exp.foto_struk}?width=120&height=120&fit=cover`}
														alt="Bon"
														class="w-full h-full object-cover"
													/>
												</button>
											{:else}
												<div class="w-11 h-11 rounded-lg border border-dashed shrink-0 flex items-center justify-center text-[16px] bg-black/5">
													{badge.emoji}
												</div>
											{/if}

											<div class="min-w-0">
												<div class="flex items-center gap-1.5 mb-0.5">
													<span class="text-[9px] font-bold px-1.5 py-0.2 rounded border {badge.color}">{badge.label}</span>
													<span class="text-[12px] font-black" style="color: var(--sys-label)">{formatRupiah(exp.nominal)}</span>
												</div>
												<p class="text-[11px] font-semibold truncate" style="color: var(--sys-label)">{exp.lokasi_nama || 'Operasional'}</p>
												<p class="text-[10px] truncate text-zinc-400">{exp.catatan || '-'}</p>
											</div>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</div>

					<!-- Form Input Laporan -->
					<div class="rounded-2xl border p-4 sm:p-5 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
						<h2 class="text-[15px] font-bold mb-3" style="color: var(--sys-label)">Isi Form Laporan</h2>

						<div class="flex flex-col gap-3.5">
							<div>
								<label class="text-[11px] font-bold mb-1.5 block" style="color: var(--sys-label2)">
									Total Order / Omzet Hari Ini (opsional)
								</label>
								<div class="relative">
									<input
										type="number"
										class="w-full h-11 px-3.5 rounded-xl border text-[13px]"
										style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
										placeholder="0"
										bind:value={totalOrder}
									/>
									{#if totalOrder && Number(totalOrder) > 0}
										<span class="absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
											{formatRupiah(Number(totalOrder))}
										</span>
									{/if}
								</div>
								<p class="text-[10px] mt-1" style="color: var(--sys-label4)">Diisi bila ada closing deal / PO masuk pada hari ini.</p>
							</div>

							<div>
								<div class="flex items-center justify-between mb-1.5">
									<label class="text-[11px] font-bold" style="color: var(--sys-label2)">
										Ringkasan Aktivitas Hari Ini <span class="text-rose-500">*</span>
									</label>
									<button
										type="button"
										class="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-[var(--p,var(--g))]/10 text-[var(--p,var(--g))] hover:bg-[var(--p,var(--g))]/20 transition-colors"
										onclick={generateAutoSummary}
									>
										<IconSparkles size={12} />
										<span>Generate Draf Otomatis</span>
									</button>
								</div>
								<textarea
									class="w-full rounded-xl border text-[13px] p-3 leading-relaxed"
									style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
									rows="4"
									placeholder="Ringkasan pertemuan prospek, follow-up penawaran, koordinasi project..."
									bind:value={ringkasan}
								></textarea>
							</div>

							<div>
								<label class="text-[11px] font-bold mb-1.5 block" style="color: var(--sys-label2)">
									Kendala di Lapangan (opsional)
								</label>
								<textarea
									class="w-full rounded-xl border text-[13px] p-3 leading-relaxed"
									style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
									rows="2"
									placeholder="Kendala cuaca, perubahan PIC customer, akses perizinan lokasi..."
									bind:value={kendala}
								></textarea>
							</div>

							{#if errorMsg}
								<div class="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 text-[12px] font-bold flex items-center gap-2">
									<IconAlertCircle size={15} />
									<span>{errorMsg}</span>
								</div>
							{/if}

							<button
								type="button"
								class="w-full h-12 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 transition-transform active:scale-[0.99] mt-2"
								style="background: var(--p, var(--g))"
								disabled={submitting}
								onclick={handleSubmit}
							>
								{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
								<span>Kirim Laporan Harian</span>
							</button>
						</div>
					</div>
				</div>
			{/if}
		{:else}
			<!-- Tab: Riwayat Laporan Sebelumnya -->
			<div class="flex flex-col gap-3 mb-4">
				<div class="flex items-center gap-2">
					<div class="relative flex-1">
						<span class="absolute left-3 top-1/2 -translate-y-1/2" style="color: var(--sys-label4)">
							<IconSearch size={15} />
						</span>
						<input
							type="text"
							bind:value={historySearch}
							placeholder="Cari riwayat tanggal, ringkasan, kendala, catatan SPV..."
							class="w-full h-10 pl-9 pr-8 rounded-xl border text-[12px]"
							style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						/>
						{#if historySearch}
							<button
								type="button"
								onclick={() => (historySearch = '')}
								class="absolute right-2.5 top-1/2 -translate-y-1/2 p-1"
								style="color: var(--sys-label4)"
							>
								<IconX size={13} />
							</button>
						{/if}
					</div>

					{#if pastReports.length > 0}
						<FieldExportButton
							rows={exportRows}
							filename="riwayat-laporan-harian-sales"
							title="Riwayat Laporan Harian"
							label="Export CSV"
							offlineNote="Angka = jumlah kunjungan/order, bukan rupiah."
						/>
					{/if}
				</div>

				<!-- Status Filter Pills for Riwayat -->
				<div class="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
					<button
						type="button"
						class="shrink-0 text-[11px] font-bold px-3 py-1 rounded-full transition-colors {historyStatusFilter === 'all'
							? 'bg-[var(--p,var(--g))] text-white shadow-sm'
							: 'border'}"
						style={historyStatusFilter !== 'all' ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label3)' : ''}
						onclick={() => (historyStatusFilter = 'all')}
					>
						Semua ({pastReports.length})
					</button>
					<button
						type="button"
						class="shrink-0 text-[11px] font-bold px-3 py-1 rounded-full transition-colors {historyStatusFilter === 'verified'
							? 'bg-emerald-600 text-white shadow-sm'
							: 'border'}"
						style={historyStatusFilter !== 'verified' ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label3)' : ''}
						onclick={() => (historyStatusFilter = 'verified')}
					>
						Disetujui ({pastReports.filter((r) => r.verifikasi_status === 'verified').length})
					</button>
					<button
						type="button"
						class="shrink-0 text-[11px] font-bold px-3 py-1 rounded-full transition-colors {historyStatusFilter === 'submitted'
							? 'bg-amber-600 text-white shadow-sm'
							: 'border'}"
						style={historyStatusFilter !== 'submitted' ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label3)' : ''}
						onclick={() => (historyStatusFilter = 'submitted')}
					>
						Menunggu ({pastReports.filter((r) => r.verifikasi_status === 'submitted').length})
					</button>
					<button
						type="button"
						class="shrink-0 text-[11px] font-bold px-3 py-1 rounded-full transition-colors {historyStatusFilter === 'rejected'
							? 'bg-rose-600 text-white shadow-sm'
							: 'border'}"
						style={historyStatusFilter !== 'rejected' ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label3)' : ''}
						onclick={() => (historyStatusFilter = 'rejected')}
					>
						Ditolak ({pastReports.filter((r) => r.verifikasi_status === 'rejected').length})
					</button>
				</div>
			</div>

			{#if filteredPastReports.length === 0}
				<div class="text-center py-16 px-4 rounded-2xl border border-dashed my-2" style="border-color: var(--sys-sep)">
					<IconClipboardList size={38} style="color: var(--sys-label4); margin: 0 auto" />
					<p class="text-[13px] font-bold mt-3" style="color: var(--sys-label)">Belum ada riwayat laporan harian yang sesuai filter.</p>
				</div>
			{:else}
				<div class="flex flex-col gap-3">
					{#each filteredPastReports as rep (rep.id)}
						<div
							class="rounded-2xl border p-4 sm:p-5 shadow-sm transition-all hover:border-[var(--p,var(--g))]"
							style="border-color: var(--sys-sep); background: var(--sys-bg)"
						>
							<div class="flex items-start justify-between gap-2 mb-2">
								<div>
									<p class="text-[15px] font-bold" style="color: var(--sys-label)">
										{new Date(rep.tanggal).toLocaleDateString('id-ID', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
									</p>
									<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">
										{rep.total_kunjungan} Kunjungan Lapangan &bull; Capaian: <strong class="text-emerald-600 dark:text-emerald-400">{formatRupiah(rep.total_order)}</strong>
									</p>
								</div>
								<span class="shrink-0 text-[10px] font-bold px-2.5 py-1 rounded-full shadow-sm" style={badgeStyle(rep.verifikasi_status)}>
									{badgeLabel(rep.verifikasi_status)}
								</span>
							</div>

							{#if rep.ringkasan}
								<p class="text-[12px] leading-relaxed mt-2 p-3 rounded-xl whitespace-pre-line" style="background: var(--sys-fill); color: var(--sys-label)">
									{rep.ringkasan}
								</p>
							{/if}

							{#if rep.kendala}
								<p class="text-[11px] mt-2 font-medium" style="color: var(--amd)">
									<strong>Kendala:</strong> {rep.kendala}
								</p>
							{/if}

							{#if rep.catatan_spv}
								<div class="mt-2.5 p-3 rounded-xl border text-[11px]" style="background: var(--rel); border-color: var(--re)">
									<strong style="color: var(--red)">Catatan SPV:</strong>
									<span style="color: #7F1D1D"> {rep.catatan_spv}</span>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
</div>

<!-- Modal Catat Biaya Hari Ini -->
{#if showExpenseModal}
	<div
		class="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
		role="dialog"
		aria-modal="true"
	>
		<div class="relative w-full max-w-md rounded-2xl border shadow-2xl p-5 my-8 flex flex-col gap-3.5" style="border-color: var(--sys-sep); background: var(--sys-bg)">
			<div class="flex items-center justify-between pb-2 border-b" style="border-color: var(--sys-sep)">
				<div class="flex items-center gap-2">
					<div class="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-600 flex items-center justify-center">
						<IconReceipt size={18} />
					</div>
					<h3 class="text-[14px] font-bold" style="color: var(--sys-label)">Catat Biaya Operasional / Bon</h3>
				</div>
				<button
					type="button"
					class="p-1 rounded-lg hover:bg-black/5"
					style="color: var(--sys-label3)"
					onclick={resetExpenseModal}
				>
					<IconX size={18} />
				</button>
			</div>

			<!-- Tautkan Kunjungan (opsional) -->
			<div>
				<label class="text-[11px] font-bold block mb-1" style="color: var(--sys-label2)">
					Tautkan Kunjungan Hari Ini (opsional)
				</label>
				<select
					class="w-full h-10 px-3 rounded-xl border text-[12px]"
					style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
					bind:value={selectedExpenseVisitId}
				>
					<option value="">Operasional Umum (tanpa customer khusus)</option>
					{#each todayVisits as v (v.id)}
						<option value={String(v.id)}>
							Kunjungan: {v.customer_name || v.tujuan}
						</option>
					{/each}
				</select>
				<p class="text-[9px] mt-1" style="color: var(--sys-label4)">
					Menghubungkan bon ke kunjungan site check-in agar lolos gate validasi otomatis.
				</p>
			</div>

			<!-- Kategori Biaya -->
			<div>
				<label class="text-[11px] font-bold block mb-1.5" style="color: var(--sys-label2)">Kategori Pengeluaran</label>
				<div class="flex flex-wrap gap-1.5">
					{#each EXPENSE_CATEGORIES as cat}
						<button
							type="button"
							class="px-2.5 py-1 rounded-lg text-[11px] font-semibold border flex items-center gap-1 transition-all {selectedExpenseCategory === cat.id
								? 'bg-[var(--p,var(--g))] text-white border-transparent font-bold shadow-xs'
								: 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300'}"
							onclick={() => (selectedExpenseCategory = cat.id)}
						>
							<span>{cat.emoji}</span>
							<span>{cat.label}</span>
						</button>
					{/each}
				</div>
			</div>

			<!-- Nominal Input -->
			<div>
				<label class="text-[11px] font-bold block mb-1" style="color: var(--sys-label2)">Nominal Pengeluaran (Rp) *</label>
				<input
					type="text"
					inputmode="numeric"
					class="w-full h-11 px-3.5 rounded-xl border text-[14px] font-bold font-mono"
					style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
					placeholder="cth. 25.000"
					value={expenseNominal}
					oninput={(e) => {
						const val = (e.target as HTMLInputElement).value.replace(/\D/g, '');
						expenseNominal = val ? Number(val).toLocaleString('id-ID') : '';
					}}
				/>
			</div>

			<!-- Bukti Struk / Bon -->
			<div>
				<label class="text-[11px] font-bold block mb-1" style="color: var(--sys-label2)">Foto Bukti Bon / Struk *</label>
				{#if expenseReceiptPreview}
					<div class="relative h-32 rounded-xl overflow-hidden border" style="border-color: var(--sys-sep)">
						<img src={expenseReceiptPreview} alt="Preview Bon" class="w-full h-full object-cover" />
						<button
							type="button"
							class="absolute top-2 right-2 px-2.5 py-1 rounded-lg text-[10px] font-bold bg-black/60 text-white hover:bg-black/80"
							onclick={() => {
								expenseReceiptFile = null;
								expenseReceiptPreview = null;
							}}
						>
							Ganti Foto
						</button>
					</div>
				{:else}
					<div class="flex gap-2">
						<button
							type="button"
							class="flex-1 flex items-center justify-center gap-1.5 h-12 rounded-xl border border-dashed text-[11px] font-semibold hover:bg-black/5"
							style="border-color: var(--sys-sep); color: var(--sys-label)"
							disabled={compressingExpensePhoto}
							onclick={() => (showExpenseCamera = true)}
						>
							{#if compressingExpensePhoto}
								<IconLoader2 size={16} class="animate-spin" />
							{:else}
								<IconCamera size={16} class="text-amber-600" />
							{/if}
							<span>Foto Kamera Langsung</span>
						</button>

						<label
							class="flex-1 flex items-center justify-center gap-1.5 h-12 rounded-xl border border-dashed text-[11px] font-semibold cursor-pointer hover:bg-black/5"
							style="border-color: var(--sys-sep); color: var(--sys-label)"
						>
							<IconFileDollar size={16} class="text-blue-600" />
							<span>Pilih dari File</span>
							<input type="file" accept="image/*" class="hidden" onchange={handleExpenseFileSelect} />
						</label>
					</div>
				{/if}
				<p class="text-[9px] mt-1" style="color: var(--sys-label4)">
					Gunakan foto fisik bon/struk asli agar lolos verifikasi Gate Keuangan (G_OPS_SALES_BON).
				</p>
			</div>

			<!-- Keterangan Tambahan -->
			<div>
				<label class="text-[11px] font-bold block mb-1" style="color: var(--sys-label2)">Keterangan (opsional)</label>
				<input
					type="text"
					class="w-full h-10 px-3 rounded-xl border text-[12px]"
					style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
					placeholder="cth. BBM Shell V-Power, Parkir Mall, Makan siang meeting..."
					bind:value={expenseCatatan}
				/>
			</div>

			{#if expenseError}
				<p class="text-[11px] font-semibold text-rose-600">{expenseError}</p>
			{/if}

			<!-- Actions -->
			<div class="flex items-center gap-2 pt-2 border-t" style="border-color: var(--sys-sep)">
				<button
					type="button"
					class="flex-1 h-11 rounded-xl text-[13px] font-bold text-white flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
					style="background: var(--p, var(--g))"
					disabled={savingExpense}
					onclick={handleSaveDailyExpense}
				>
					{#if savingExpense}
						<IconLoader2 size={16} class="animate-spin" />
					{:else}
						<IconCheck size={16} />
					{/if}
					<span>Simpan Biaya & Bon</span>
				</button>
				<button
					type="button"
					class="px-4 h-11 rounded-xl text-[12px] font-medium border"
					style="border-color: var(--sys-sep); color: var(--sys-label3)"
					onclick={resetExpenseModal}
				>
					Batal
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal Kamera Capture Bon -->
{#if showExpenseCamera}
	<CameraCaptureModal
		facing="environment"
		onCapture={handleCameraExpenseCapture}
		onClose={() => (showExpenseCamera = false)}
	/>
{/if}

<!-- Modal Zoom Bon Struk -->
{#if zoomReceiptUrl}
	<div
		class="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
		onclick={() => (zoomReceiptUrl = null)}
		role="button"
		tabindex="0"
		onkeydown={(e) => e.key === 'Escape' && (zoomReceiptUrl = null)}
	>
		<div class="relative max-w-lg w-full max-h-[90vh] flex flex-col items-center" onclick={(e) => e.stopPropagation()}>
			<img src={zoomReceiptUrl} alt="Bukti Bon Struk" class="max-w-full max-h-[80vh] rounded-2xl object-contain shadow-2xl" />
			<button
				type="button"
				class="mt-3 px-4 py-2 rounded-xl bg-white/20 hover:bg-white/30 text-white text-[12px] font-bold"
				onclick={() => (zoomReceiptUrl = null)}
			>
				Tutup
			</button>
		</div>
	</div>
{/if}

