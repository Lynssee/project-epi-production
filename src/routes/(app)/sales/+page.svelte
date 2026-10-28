<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		getMyVisits,
		getSalesVisitKpis,
		getUpcomingFollowUps,
		getTargetVsRealisasi,
		resolveSalesDisplayName,
		verifyVisit,
		type VisitSalesRow,
		type SalesVisitKpis,
		type UpcomingFollowUp,
		type TargetRealisasi
	} from '$lib/services/sales';
	import { getMyPoStatusSummary } from '$lib/services/salesPo';
	import SalesNavTabs from '$lib/components/sales/SalesNavTabs.svelte';
	import {
		IconPlus,
		IconLoader2,
		IconMapPin,
		IconClock,
		IconCircleCheck,
		IconCircleX,
		IconBell,
		IconTarget,
		IconSearch,
		IconX,
		IconArrowRight,
		IconCalendar,
		IconBuildingStore,
		IconAlertCircle,
		IconUserSearch,
		IconClipboardCheck,
		IconEdit,
		IconPhoto,
		IconBrandWhatsapp,
		IconCheck,
		IconUser
	} from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let visits = $state<VisitSalesRow[]>([]);
	let kpis = $state<SalesVisitKpis>({ kunjunganHariIni: 0, menungguVerifikasi: 0, terverifikasi: 0 });
	let reminders = $state<UpcomingFollowUp[]>([]);
	let target = $state<TargetRealisasi | null>(null);
	let poNeedsAttention = $state(0);

	// Filters & Search
	let searchQuery = $state('');
	let activeStatusFilter = $state<string>('all');
	let selectedSalesRep = $state<string>('all');
	let selectedDateRange = $state<'all' | 'today' | 'last7' | 'thisMonth'>('all');
	let sortBy = $state<'newest' | 'oldest' | 'customer'>('newest');

	// SPV Verification Modal State
	let reviewModalVisit = $state<VisitSalesRow | null>(null);
	let spvCatatan = $state('');
	let isVerifying = $state(false);

	// Photo Lightbox Modal
	let previewPhotoUrl = $state<string | null>(null);

	const todayStr = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];

	function formatRupiah(n: number) {
		return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(n);
	}

	let canVerify = $derived(
		hasPermission($authStore.roleId, 'verify_sales', $rolesStore, $authStore.roleIds) ||
		$authStore.roleId === 'super_admin' ||
		$authStore.roleIds?.includes('super_admin')
	);

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
		const salesId = isSuper ? null : $authStore.karyawanId;
		const salesName = isSuper ? null : $authStore.karyawanName;

		if (!salesId && !isSuper) {
			errorMsg = 'Profil karyawan tidak ditemukan di sesi login. Hubungi admin.';
			loading = false;
			return;
		}

		try {
			const [vList, kpiData, reminderData, targetData] = await Promise.all([
				getMyVisits(salesId, 200),
				getSalesVisitKpis(salesId),
				getUpcomingFollowUps(salesName),
				getTargetVsRealisasi(salesName)
			]);

			visits = vList;
			kpis = kpiData;
			reminders = reminderData;
			target = targetData;

			if ($authStore.karyawanId) {
				try {
					const poSummary = await getMyPoStatusSummary($authStore.karyawanId);
					poNeedsAttention = (poSummary.belum_ada || 0) + (poSummary.revisi || 0);
				} catch {}
			}
		} catch (e: any) {
			console.error('[sales] load error:', e);
			errorMsg = e?.message || 'Gagal memuat data sales.';
		} finally {
			loading = false;
		}
	}

	onMount(loadAllData);

	// Unique list of sales reps for dropdown filter
	let salesRepList = $derived.by(() => {
		const set = new Set<string>();
		for (const v of visits) {
			if (v.sales_name) set.add(v.sales_name);
		}
		return Array.from(set).sort();
	});

	// Filtered visits
	let filteredVisits = $derived.by(() => {
		let list = visits;

		// 1. Status Filter
		if (activeStatusFilter === 'today') {
			list = list.filter((v) => v.tanggal_kunjungan === todayStr);
		} else if (activeStatusFilter === 'draft') {
			list = list.filter((v) => v.verifikasi_status === 'draft');
		} else if (activeStatusFilter === 'submitted') {
			list = list.filter((v) => v.verifikasi_status === 'submitted');
		} else if (activeStatusFilter === 'verified') {
			list = list.filter((v) => v.verifikasi_status === 'verified');
		} else if (activeStatusFilter === 'rejected') {
			list = list.filter((v) => v.verifikasi_status === 'rejected');
		}

		// 2. Sales Rep Filter
		if (selectedSalesRep !== 'all') {
			list = list.filter((v) => v.sales_name === selectedSalesRep);
		}

		// 3. Date Range Filter
		if (selectedDateRange === 'today') {
			list = list.filter((v) => v.tanggal_kunjungan === todayStr);
		} else if (selectedDateRange === 'last7') {
			const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
			list = list.filter((v) => v.tanggal_kunjungan >= sevenDaysAgo);
		} else if (selectedDateRange === 'thisMonth') {
			const monthPrefix = todayStr.slice(0, 7);
			list = list.filter((v) => v.tanggal_kunjungan.startsWith(monthPrefix));
		}

		// 4. Search Query
		if (searchQuery.trim()) {
			const q = searchQuery.trim().toLowerCase();
			list = list.filter(
				(v) =>
					(v.customer_name && v.customer_name.toLowerCase().includes(q)) ||
					(v.customer_kode && v.customer_kode.toLowerCase().includes(q)) ||
					(v.customer_pic && v.customer_pic.toLowerCase().includes(q)) ||
					(v.customer_alamat && v.customer_alamat.toLowerCase().includes(q)) ||
					(v.tujuan && v.tujuan.toLowerCase().includes(q)) ||
					(v.kegiatan && v.kegiatan.toLowerCase().includes(q)) ||
					(v.hasil_kunjungan && v.hasil_kunjungan.toLowerCase().includes(q)) ||
					(v.sales_name && v.sales_name.toLowerCase().includes(q))
			);
		}

		// 5. Sorting
		if (sortBy === 'oldest') {
			list = [...list].sort((a, b) => a.tanggal_kunjungan.localeCompare(b.tanggal_kunjungan) || a.id - b.id);
		} else if (sortBy === 'customer') {
			list = [...list].sort((a, b) => (a.customer_name || a.tujuan || '').localeCompare(b.customer_name || b.tujuan || ''));
		} else {
			// 'newest' default
			list = [...list].sort((a, b) => b.tanggal_kunjungan.localeCompare(a.tanggal_kunjungan) || b.id - a.id);
		}

		return list;
	});

	let rejectedCount = $derived(visits.filter((v) => v.verifikasi_status === 'rejected').length);
	let draftCount = $derived(visits.filter((v) => v.verifikasi_status === 'draft').length);
	// Paket 08e §7.4/§7.5 — auto-close menandai visit_sales.status (BUKAN verifikasi_status)
	// jadi 'belum_dilaporkan' saat sales lupa submit sampai cron tengah malam menutup paksa.
	// Data LAMA (in_progress dari sebelum fitur ini ada) SENGAJA TIDAK diubah otomatis
	// (Aturan #3 — tidak mengunci/mengubah transaksi lama secara retroaktif) — tapi tetap
	// ditampilkan di sini (bukan diam-diam hilang) selama tanggal kunjungannya bukan hari ini,
	// supaya sales bisa melengkapi laporan kapan saja.
	let belumDilaporkanList = $derived(
		visits.filter((v) => v.status === 'belum_dilaporkan' || (v.status === 'in_progress' && v.tanggal_kunjungan < todayStr))
	);

	let hasActiveFilters = $derived(
		searchQuery.trim() !== '' ||
		activeStatusFilter !== 'all' ||
		selectedSalesRep !== 'all' ||
		selectedDateRange !== 'all' ||
		sortBy !== 'newest'
	);

	function resetFilters() {
		searchQuery = '';
		activeStatusFilter = 'all';
		selectedSalesRep = 'all';
		selectedDateRange = 'all';
		sortBy = 'newest';
	}

	function badgeLabel(status: string) {
		if (status === 'verified') return 'Disetujui SPV';
		if (status === 'rejected') return 'Ditolak SPV';
		if (status === 'submitted') return 'Menunggu SPV';
		return 'Draft Laporan';
	}

	function getActivityTheme(text: string) {
		const t = (text || '').toLowerCase();
		if (t.includes('meet') || t.includes('pertemuan')) {
			return { bg: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20', label: 'Meeting' };
		}
		if (t.includes('follow') || t.includes('penawaran')) {
			return { bg: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20', label: 'Followup Penawaran' };
		}
		if (t.includes('survey')) {
			return { bg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20', label: 'Survey Lapangan' };
		}
		if (t.includes('demo') || t.includes('presentasi')) {
			return { bg: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20', label: 'Presentasi / Demo' };
		}
		if (t.includes('clos') || t.includes('deal') || t.includes('po')) {
			return { bg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20', label: 'Closing / Deal' };
		}
		if (t.includes('tagih') || t.includes('invoice')) {
			return { bg: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20', label: 'Penagihan' };
		}
		return { bg: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20', label: text || 'Kunjungan' };
	}

	function cleanWaNumber(phone: string) {
		const digits = phone.replace(/\D/g, '');
		return digits.startsWith('0') ? '62' + digits.slice(1) : digits;
	}

	function formatDuration(checkIn: string | null, checkOut: string | null): string {
		if (!checkIn) return '';
		const inTime = new Date(checkIn).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
		if (!checkOut) return `In: ${inTime}`;
		const outTime = new Date(checkOut).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
		const diffMins = Math.max(1, Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 60000));
		return `${inTime} - ${outTime} (${diffMins} mnt)`;
	}

	async function handleExecuteVerify(status: 'verified' | 'rejected') {
		if (!reviewModalVisit || isVerifying) return;
		if (status === 'rejected' && !spvCatatan.trim()) {
			alert('Wajib mengisi catatan SPV untuk penolakan kunjungan.');
			return;
		}
		isVerifying = true;
		try {
			const updated = await verifyVisit(reviewModalVisit.id, status, spvCatatan.trim() || null);
			if (updated) {
				visits = visits.map((v) => (v.id === updated.id ? { ...v, ...updated } : v));
				const isSuper = $authStore.roleId === 'super_admin' || $authStore.roleIds?.includes('super_admin');
				kpis = await getSalesVisitKpis(isSuper ? null : $authStore.karyawanId);
			}
			reviewModalVisit = null;
			spvCatatan = '';
		} catch (e: any) {
			console.error('[sales] Verifikasi kunjungan gagal:', e);
			alert(e?.message || 'Gagal menyimpan status verifikasi kunjungan.');
		} finally {
			isVerifying = false;
		}
	}
</script>

<div class="scroll-body">
	<div class="max-w-4xl mx-auto p-4 md:p-6 pb-24">
		<!-- Header -->
		<div class="flex items-center justify-between gap-3 mb-4">
			<div>
				<div class="flex items-center gap-2">
					<h1 class="text-[20px] font-black tracking-tight" style="color: var(--sys-label)">Sales Lapangan</h1>
					{#if draftCount > 0}
						<span class="inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
							<IconAlertCircle size={12} />
							{draftCount} draf perlu laporan
						</span>
					{/if}
				</div>
				<p class="text-[12px] font-medium mt-0.5" style="color: var(--sys-label3)">Log kunjungan, follow-up & verifikasi SPV</p>
			</div>
			<button
				type="button"
				class="h-10 px-4 rounded-xl text-[12px] font-bold text-white flex items-center gap-2 shrink-0 shadow-sm shadow-[var(--p,var(--g))]/30 active:scale-95 transition-all hover:brightness-110"
				style="background: var(--p, var(--g))"
				onclick={() => goto('/sales/baru')}
			>
				<IconPlus size={16} stroke={2.5} />
				<span>Check-in Kunjungan</span>
			</button>
		</div>

		<!-- Nav Tabs Sub-Menu -->
		<SalesNavTabs
			active="kunjungan"
			remindersCount={reminders.length}
			poCount={poNeedsAttention}
			pendingCount={kpis.menungguVerifikasi}
		/>

		{#if loading}
		<div class="flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat aktivitas penjualan lapangan..." />
		</div>
		{:else if errorMsg}
			<div class="rounded-2xl border p-4 text-center my-6 shadow-sm" style="background: var(--rel); border-color: var(--re); color: var(--red)">
				<p class="text-[13px] font-semibold mb-2">{errorMsg}</p>
				<button
					class="px-4 py-2 rounded-xl text-[12px] font-bold text-white shadow-sm"
					style="background: var(--re)"
					onclick={loadAllData}
				>
					Coba Lagi
				</button>
			</div>
		{:else}
			<!-- Paket 08e §7.4 — widget paling atas: kunjungan yang ditutup paksa cron tengah
			     malam karena sales lupa menekan "Kirim" di /sales/[id]. Data lama (status
			     in_progress menggantung) SENGAJA TIDAK ikut di sini (Aturan #3, tidak diubah
			     otomatis) — hanya baris yang memang sudah ditandai belum_dilaporkan. -->
			{#if belumDilaporkanList.length > 0}
				<button
					type="button"
					class="w-full text-left rounded-2xl p-3.5 mb-4 flex items-start gap-3 transition-all hover:opacity-95 active:scale-[0.99]"
					style="background: var(--rel); border: 1px solid var(--re)"
					onclick={() => goto(`/sales/${belumDilaporkanList[0].id}`)}
				>
					<div class="w-8 h-8 rounded-xl bg-rose-500/20 flex items-center justify-center shrink-0 mt-0.5" style="color: var(--red)">
						<IconAlertCircle size={18} />
					</div>
					<div class="min-w-0 flex-1">
						<div class="flex items-center justify-between gap-1">
							<p class="text-[12px] font-bold" style="color: var(--red)">
								⏳ {belumDilaporkanList.length} Kunjungan Belum Dilaporkan
							</p>
							<span class="text-[11px] font-bold flex items-center gap-0.5" style="color: var(--red)">
								Isi Sekarang <IconArrowRight size={12} />
							</span>
						</div>
						<p class="text-[11px] mt-0.5 truncate" style="color: var(--red)">
							Ditutup otomatis tengah malam karena belum di-submit — isi hasilnya supaya dicek SPV.
							{belumDilaporkanList.slice(0, 2).map((v) => v.customer_name || v.tujuan).filter(Boolean).join(', ')}
						</p>
					</div>
				</button>
			{/if}

			<!-- KPI Metric Cards (Interactive click-to-filter) -->
			<div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
				<!-- Hari Ini -->
				<button
					type="button"
					class="rounded-2xl border p-3 text-left transition-all active:scale-[0.98] {activeStatusFilter === 'today'
						? 'ring-2 ring-blue-500 bg-blue-50/80 dark:bg-blue-950/30 border-blue-500/40 shadow-sm'
						: 'hover:border-blue-400/50 bg-[var(--sys-bg)]'}"
					style="border-color: var(--sys-sep)"
					onclick={() => (activeStatusFilter = activeStatusFilter === 'today' ? 'all' : 'today')}
				>
					<div class="flex items-center justify-between mb-1.5">
						<span class="text-[11px] font-bold text-blue-600 dark:text-blue-400">Hari Ini</span>
						<div class="w-6 h-6 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-600 dark:text-blue-400">
							<IconCalendar size={14} />
						</div>
					</div>
					<p class="text-[22px] font-black leading-none" style="color: var(--sys-label)">{kpis.kunjunganHariIni}</p>
					<p class="text-[10px] mt-1 font-medium text-blue-600/80 dark:text-blue-400/80">Kunjungan terjadwal</p>
				</button>

				<!-- Draft -->
				<button
					type="button"
					class="rounded-2xl border p-3 text-left transition-all active:scale-[0.98] {activeStatusFilter === 'draft'
						? 'ring-2 ring-amber-500 bg-amber-50/80 dark:bg-amber-950/30 border-amber-500/40 shadow-sm'
						: 'hover:border-amber-400/50 bg-[var(--sys-bg)]'}"
					style="border-color: var(--sys-sep)"
					onclick={() => (activeStatusFilter = activeStatusFilter === 'draft' ? 'all' : 'draft')}
				>
					<div class="flex items-center justify-between mb-1.5">
						<span class="text-[11px] font-bold text-amber-600 dark:text-amber-400">Draft Laporan</span>
						<div class="w-6 h-6 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-600 dark:text-amber-400">
							<IconEdit size={14} />
						</div>
					</div>
					<p class="text-[22px] font-black leading-none text-amber-600 dark:text-amber-400">{draftCount}</p>
					<p class="text-[10px] mt-1 font-medium text-amber-600/80 dark:text-amber-400/80">Perlu diisi hasil</p>
				</button>

				<!-- Menunggu -->
				<button
					type="button"
					class="rounded-2xl border p-3 text-left transition-all active:scale-[0.98] {activeStatusFilter === 'submitted'
						? 'ring-2 ring-indigo-500 bg-indigo-50/80 dark:bg-indigo-950/30 border-indigo-500/40 shadow-sm'
						: 'hover:border-indigo-400/50 bg-[var(--sys-bg)]'}"
					style="border-color: var(--sys-sep)"
					onclick={() => (activeStatusFilter = activeStatusFilter === 'submitted' ? 'all' : 'submitted')}
				>
					<div class="flex items-center justify-between mb-1.5">
						<span class="text-[11px] font-bold text-indigo-600 dark:text-indigo-400">Menunggu SPV</span>
						<div class="w-6 h-6 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
							<IconClock size={14} />
						</div>
					</div>
					<p class="text-[22px] font-black leading-none text-indigo-600 dark:text-indigo-400">{kpis.menungguVerifikasi}</p>
					<p class="text-[10px] mt-1 font-medium text-indigo-600/80 dark:text-indigo-400/80">Antrean validasi</p>
				</button>

				<!-- Disetujui -->
				<button
					type="button"
					class="rounded-2xl border p-3 text-left transition-all active:scale-[0.98] {activeStatusFilter === 'verified'
						? 'ring-2 ring-emerald-500 bg-emerald-50/80 dark:bg-emerald-950/30 border-emerald-500/40 shadow-sm'
						: 'hover:border-emerald-400/50 bg-[var(--sys-bg)]'}"
					style="border-color: var(--sys-sep)"
					onclick={() => (activeStatusFilter = activeStatusFilter === 'verified' ? 'all' : 'verified')}
				>
					<div class="flex items-center justify-between mb-1.5">
						<span class="text-[11px] font-bold text-emerald-600 dark:text-emerald-400">Disetujui</span>
						<div class="w-6 h-6 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
							<IconCircleCheck size={14} />
						</div>
					</div>
					<p class="text-[22px] font-black leading-none text-emerald-600 dark:text-emerald-400">{kpis.terverifikasi}</p>
					<p class="text-[10px] mt-1 font-medium text-emerald-600/80 dark:text-emerald-400/80">Telah diverifikasi</p>
				</button>
			</div>

			<!-- Target Bulanan Card -->
			{#if target}
				<div class="rounded-2xl border p-4 mb-4 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
					<div class="flex items-center justify-between mb-2">
						<div class="flex items-center gap-1.5">
							<div class="w-6 h-6 rounded-lg bg-blue-500/10 flex items-center justify-center text-[var(--p,var(--g))]">
								<IconTarget size={14} />
							</div>
							<div>
								<p class="text-[12px] font-bold" style="color: var(--sys-label)">Target Realisasi Sales</p>
								<p class="text-[10px]" style="color: var(--sys-label3)">Bulan {new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}</p>
							</div>
						</div>
						<div class="text-right">
							<span class="text-[13px] font-extrabold px-2 py-0.5 rounded-lg {target.percentage >= 100 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'}">
								{target.percentage}%
							</span>
						</div>
					</div>

					<div class="w-full h-2.5 rounded-full overflow-hidden mb-2" style="background: var(--sys-fill)">
						<div
							class="h-full rounded-full transition-all duration-500"
							style="width: {Math.min(target.percentage, 100)}%; background: {target.percentage >= 100 ? 'var(--gg)' : 'var(--p, var(--g))'}"
						></div>
					</div>

					<div class="flex items-center justify-between text-[11px]" style="color: var(--sys-label2)">
						<span>Realisasi: <strong>{formatRupiah(target.realisasiAmount)}</strong></span>
						<span style="color: var(--sys-label3)">Target: {formatRupiah(target.targetAmount)}</span>
					</div>
				</div>
			{/if}

			<!-- Reminders Alert Widget -->
			{#if reminders.length > 0}
				<button
					type="button"
					class="w-full text-left rounded-2xl p-3.5 mb-4 flex items-start gap-3 transition-all hover:opacity-95 active:scale-[0.99]"
					style="background: var(--aml); border: 1px solid var(--am)"
					onclick={() => goto('/sales/prospek')}
				>
					<div class="w-8 h-8 rounded-xl bg-amber-500/20 flex items-center justify-center shrink-0 mt-0.5" style="color: var(--amd)">
						<IconBell size={18} />
					</div>
					<div class="min-w-0 flex-1">
						<div class="flex items-center justify-between gap-1">
							<p class="text-[12px] font-bold" style="color: var(--amd)">
								{reminders.length} Follow-up Prospek Jatuh Tempo
							</p>
							<span class="text-[11px] font-bold flex items-center gap-0.5" style="color: var(--amd)">
								Lihat <IconArrowRight size={12} />
							</span>
						</div>
						<p class="text-[11px] mt-0.5 truncate" style="color: var(--amd)">
							{reminders.slice(0, 3).map((r) => r.prospectName || r.prospectCompany).filter(Boolean).join(', ')}
							{reminders.length > 3 ? `, +${reminders.length - 3} lainnya` : ''}
						</p>
					</div>
				</button>
			{/if}

			<!-- Search & Multi-Filter Toolbar -->
			<div class="rounded-2xl border p-3.5 mb-4 flex flex-col gap-3 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<!-- Search bar -->
				<div class="relative w-full">
					<span class="absolute left-3 top-1/2 -translate-y-1/2" style="color: var(--sys-label4)">
						<IconSearch size={16} />
					</span>
					<input
						type="text"
						bind:value={searchQuery}
						placeholder="Cari customer, kode, PIC, lokasi, kegiatan, hasil pertemuan..."
						class="w-full h-10 pl-9 pr-8 rounded-xl border text-[12px] transition-all focus:ring-2 focus:ring-[var(--p,var(--g))]/40 outline-none"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
					/>
					{#if searchQuery}
						<button
							type="button"
							onclick={() => (searchQuery = '')}
							class="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-black/10 dark:hover:bg-white/10"
							style="color: var(--sys-label4)"
							aria-label="Bersihkan"
						>
							<IconX size={14} />
						</button>
					{/if}
				</div>

				<!-- Secondary selectors: Sales Rep, Date Range, Sort -->
				<div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
					<!-- Sales Rep Filter -->
					<div class="flex flex-col gap-1">
						<label class="text-[10px] font-bold tracking-wide uppercase" style="color: var(--sys-label3)">Sales Lapangan</label>
						<select
							bind:value={selectedSalesRep}
							class="h-9 px-2.5 rounded-xl border text-[11px] font-semibold transition-all outline-none"
							style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						>
							<option value="all">Semua Tim Sales ({salesRepList.length})</option>
							{#each salesRepList as sName}
								<option value={sName}>{resolveSalesDisplayName(sName)}</option>
							{/each}
						</select>
					</div>

					<!-- Date Range Filter -->
					<div class="flex flex-col gap-1">
						<label class="text-[10px] font-bold tracking-wide uppercase" style="color: var(--sys-label3)">Rentang Waktu</label>
						<select
							bind:value={selectedDateRange}
							class="h-9 px-2.5 rounded-xl border text-[11px] font-semibold transition-all outline-none"
							style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						>
							<option value="all">Semua Tanggal</option>
							<option value="today">Hari Ini Saja</option>
							<option value="last7">7 Hari Terakhir</option>
							<option value="thisMonth">Bulan Ini</option>
						</select>
					</div>

					<!-- Sort By -->
					<div class="flex flex-col gap-1">
						<label class="text-[10px] font-bold tracking-wide uppercase" style="color: var(--sys-label3)">Urutkan</label>
						<select
							bind:value={sortBy}
							class="h-9 px-2.5 rounded-xl border text-[11px] font-semibold transition-all outline-none"
							style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						>
							<option value="newest">Terbaru (Default)</option>
							<option value="oldest">Terlama</option>
							<option value="customer">Nama Customer (A-Z)</option>
						</select>
					</div>
				</div>

				<!-- Status Filter Pills -->
				<div class="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar border-t pt-2.5" style="border-color: var(--sys-sep)">
					<button
						type="button"
						class="shrink-0 text-[11px] font-semibold px-3 py-1 rounded-full transition-colors {activeStatusFilter === 'all'
							? 'bg-[var(--p,var(--g))] text-white font-bold'
							: 'border'}"
						style={activeStatusFilter !== 'all' ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label3)' : ''}
						onclick={() => (activeStatusFilter = 'all')}
					>
						Semua ({visits.length})
					</button>
					<button
						type="button"
						class="shrink-0 text-[11px] font-semibold px-3 py-1 rounded-full transition-colors {activeStatusFilter === 'today'
							? 'bg-[var(--p,var(--g))] text-white font-bold'
							: 'border'}"
						style={activeStatusFilter !== 'today' ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label3)' : ''}
						onclick={() => (activeStatusFilter = 'today')}
					>
						Hari Ini ({kpis.kunjunganHariIni})
					</button>
					<button
						type="button"
						class="shrink-0 text-[11px] font-semibold px-3 py-1 rounded-full transition-colors {activeStatusFilter === 'draft'
							? 'bg-amber-600 text-white font-bold'
							: 'border'}"
						style={activeStatusFilter !== 'draft' ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label3)' : ''}
						onclick={() => (activeStatusFilter = 'draft')}
					>
						Draft ({draftCount})
					</button>
					<button
						type="button"
						class="shrink-0 text-[11px] font-semibold px-3 py-1 rounded-full transition-colors {activeStatusFilter === 'submitted'
							? 'bg-indigo-600 text-white font-bold'
							: 'border'}"
						style={activeStatusFilter !== 'submitted' ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label3)' : ''}
						onclick={() => (activeStatusFilter = 'submitted')}
					>
						Menunggu ({kpis.menungguVerifikasi})
					</button>
					<button
						type="button"
						class="shrink-0 text-[11px] font-semibold px-3 py-1 rounded-full transition-colors {activeStatusFilter === 'verified'
							? 'bg-emerald-600 text-white font-bold'
							: 'border'}"
						style={activeStatusFilter !== 'verified' ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label3)' : ''}
						onclick={() => (activeStatusFilter = 'verified')}
					>
						Disetujui ({kpis.terverifikasi})
					</button>
					{#if rejectedCount > 0}
						<button
							type="button"
							class="shrink-0 text-[11px] font-semibold px-3 py-1 rounded-full transition-colors {activeStatusFilter === 'rejected'
								? 'bg-rose-600 text-white font-bold'
								: 'border'}"
							style={activeStatusFilter !== 'rejected' ? 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--red)' : ''}
							onclick={() => (activeStatusFilter = 'rejected')}
						>
							Ditolak ({rejectedCount})
						</button>
					{/if}

					{#if hasActiveFilters}
						<button
							type="button"
							onclick={resetFilters}
							class="shrink-0 ml-auto text-[11px] font-bold px-2 py-0.5 rounded-lg text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors flex items-center gap-1"
						>
							<IconX size={12} /> Reset Filter
						</button>
					{/if}
				</div>
			</div>

			<!-- Visit History Header & Counter -->
			<div class="flex items-center justify-between mb-3">
				<p class="text-[13px] font-bold" style="color: var(--sys-label)">
					Riwayat Kunjungan
					<span class="text-[11px] font-normal" style="color: var(--sys-label3)">
						(Menampilkan {filteredVisits.length} dari {visits.length})
					</span>
				</p>
			</div>

			<!-- List of Visits -->
			{#if filteredVisits.length === 0}
				<div class="text-center py-14 px-4 rounded-2xl border border-dashed my-2" style="border-color: var(--sys-sep)">
					<IconMapPin size={36} style="color: var(--sys-label4); margin: 0 auto" />
					<p class="text-[14px] font-bold mt-3" style="color: var(--sys-label)">
						{hasActiveFilters ? 'Tidak ada kunjungan yang cocok dengan filter.' : 'Belum ada kunjungan tercatat.'}
					</p>
					<p class="text-[11px] mt-1 mb-4" style="color: var(--sys-label3)">
						{#if hasActiveFilters}
							Coba sesuaikan filter atau reset untuk melihat semua kunjungan sales.
						{:else}
							Klik tombol di bawah untuk memulai check-in kunjungan lapangan baru.
						{/if}
					</p>
					{#if hasActiveFilters}
						<button
							type="button"
							class="px-4 py-2 rounded-xl text-[12px] font-bold text-white inline-flex items-center gap-1.5 shadow-sm"
							style="background: var(--p, var(--g))"
							onclick={resetFilters}
						>
							<IconX size={14} /> Reset Filter
						</button>
					{:else}
						<button
							type="button"
							class="px-4 py-2 rounded-xl text-[12px] font-bold text-white inline-flex items-center gap-1.5 shadow-sm"
							style="background: var(--p, var(--g))"
							onclick={() => goto('/sales/baru')}
						>
							<IconPlus size={15} /> Check-in Kunjungan
						</button>
					{/if}
				</div>
			{:else}
				<div class="flex flex-col gap-3">
					{#each filteredVisits as v (v.id)}
						{@const actTheme = getActivityTheme(v.kegiatan || v.tujuan)}
						{@const sName = resolveSalesDisplayName(v.sales_name)}
						<div
							class="rounded-2xl border p-4 w-full transition-all hover:border-[var(--p,var(--g))] shadow-sm {v.verifikasi_status === 'draft'
								? 'border-l-4 border-l-amber-500'
								: v.verifikasi_status === 'submitted'
								? 'border-l-4 border-l-indigo-500'
								: v.verifikasi_status === 'verified'
								? 'border-l-4 border-l-emerald-500'
								: 'border-l-4 border-l-rose-500'}"
							style="border-color: var(--sys-sep); background: var(--sys-bg)"
						>
							<!-- Top Row: Customer info & Status badge -->
							<div class="flex items-start justify-between gap-3 mb-2">
								<div class="min-w-0 flex-1">
									<div class="flex items-center flex-wrap gap-1.5">
										<p class="text-[15px] font-extrabold tracking-tight truncate leading-tight" style="color: var(--sys-label)">
											{v.customer_name || v.tujuan || 'Kunjungan Lapangan'}
										</p>
										{#if v.customer_kode}
											<span class="text-[10px] font-bold px-1.5 py-0.2 rounded bg-black/5 dark:bg-white/10" style="color: var(--sys-label3)">
												{v.customer_kode}
											</span>
										{/if}
										<span class="text-[10px] font-bold px-2 py-0.5 rounded-full border {actTheme.bg}">
											{actTheme.label}
										</span>
									</div>

									{#if v.customer_name && v.tujuan && v.tujuan !== v.customer_name}
										<p class="text-[12px] mt-1 font-medium" style="color: var(--sys-label2)">
											{v.tujuan}
										</p>
									{/if}
								</div>

								<!-- Semantic Status Badge -->
								<span class="shrink-0 text-[10px] font-extrabold px-2.5 py-1 rounded-full border flex items-center gap-1 {v.verifikasi_status === 'verified'
									? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
									: v.verifikasi_status === 'submitted'
									? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 border-indigo-500/30'
									: v.verifikasi_status === 'rejected'
									? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30'
									: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30'}">
									{#if v.verifikasi_status === 'verified'}
										<IconCircleCheck size={12} />
									{:else if v.verifikasi_status === 'submitted'}
										<IconClock size={12} />
									{:else if v.verifikasi_status === 'rejected'}
										<IconCircleX size={12} />
									{:else}
										<IconEdit size={12} />
									{/if}
									<span>{badgeLabel(v.verifikasi_status)}</span>
								</span>
							</div>

							<!-- Meta Details: Date, Sales rep, Check-in duration, Location, Photo -->
							<div class="flex items-center flex-wrap gap-x-3.5 gap-y-1.5 text-[11px] mt-2.5 pt-2 border-t" style="border-color: var(--sys-sep); color: var(--sys-label3)">
								<!-- Date -->
								<span class="flex items-center gap-1 font-medium">
									<IconCalendar size={13} style="color: var(--sys-label4)" />
									<strong style="color: var(--sys-label)">{v.tanggal_kunjungan}</strong>
								</span>

								<!-- Sales Representative -->
								{#if v.sales_name}
									<span class="flex items-center gap-1 font-bold px-2 py-0.5 rounded-lg bg-black/5 dark:bg-white/5" style="color: var(--sys-label2)">
										<IconUser size={12} class="text-[var(--p,var(--g))]" />
										{sName}
									</span>
								{/if}

								<!-- Check-in & Duration -->
								{#if v.check_in_at}
									<span class="flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
										<IconClock size={13} />
										{formatDuration(v.check_in_at, v.check_out_at)}
									</span>
								{/if}

								<!-- GPS Location -->
								{#if v.latitude && v.longitude}
									<a
										href={`https://www.google.com/maps?q=${v.latitude},${v.longitude}`}
										target="_blank"
										rel="noopener noreferrer"
										class="flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline font-medium"
									>
										<IconMapPin size={13} />
										<span>GPS Maps</span>
									</a>
								{/if}

								<!-- Photo Attachment -->
								{#if v.foto_id}
									<button
										type="button"
										class="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:underline font-semibold"
										onclick={() => (previewPhotoUrl = `/api/directus/assets/${v.foto_id}`)}
									>
										<IconPhoto size={13} />
										<span>Foto Terlampir</span>
									</button>
								{/if}

								<!-- Customer PIC -->
								{#if v.customer_pic}
									<span class="flex items-center gap-1" style="color: var(--sys-label2)">
										👤 PIC: <strong>{v.customer_pic}</strong>
									</span>
								{/if}
							</div>

							<!-- Customer Alamat if available -->
							{#if v.customer_alamat}
								<p class="text-[11px] mt-1.5 truncate" style="color: var(--sys-label3)">
									📍 {v.customer_alamat}
								</p>
							{/if}

							<!-- Evidence Photo & GPS Map -->
							{#if v.foto_id || (v.latitude && v.longitude)}
								<div class="mt-2.5 pt-2 border-t flex items-start gap-2.5 text-[11px]" style="border-color: var(--sys-sep)">
									{#if v.foto_id}
										<img
											src={`/api/directus/assets/${v.foto_id}?width=100&height=100&fit=cover`}
											alt="Bukti kunjungan"
											class="w-12 h-12 rounded-xl object-cover shrink-0 border"
											style="border-color: var(--sys-sep); background: var(--sys-fill)"
										/>
									{/if}
									<div class="min-w-0 flex-1 space-y-1">
										{#if v.latitude && v.longitude}
											<a
												href={`https://www.google.com/maps?q=${v.latitude},${v.longitude}`}
												target="_blank"
												rel="noopener noreferrer"
												class="inline-flex items-center gap-1 font-semibold text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
											>
												<IconMapPin size={12} class="text-rose-500" />
												<span>Peta GPS ({Number(v.latitude).toFixed(4)}, {Number(v.longitude).toFixed(4)})</span>
											</a>
										{/if}
									</div>
								</div>
							{/if}

							<!-- Outcome / Meeting Summary Context Block -->
							{#if v.hasil_kunjungan}
								<div class="mt-2.5 p-3 rounded-xl border text-[12px] leading-relaxed bg-black/[0.02] dark:bg-white/[0.02]" style="border-color: var(--sys-sep)">
									<div class="flex items-center justify-between mb-1">
										<span class="text-[10px] font-bold uppercase tracking-wider" style="color: var(--sys-label3)">Ringkasan Hasil Pertemuan:</span>
										{#if v.follow_up_date}
											<span class="text-[10px] font-bold text-amber-600 dark:text-amber-400">
												📅 Follow-up: {v.follow_up_date}
											</span>
										{/if}
									</div>
									<p class="font-medium" style="color: var(--sys-label)">{v.hasil_kunjungan}</p>
								</div>
							{:else if v.verifikasi_status === 'draft'}
								<div class="mt-2.5 p-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 text-[11px] flex items-center gap-2 text-amber-700 dark:text-amber-300">
									<IconAlertCircle size={15} class="shrink-0 text-amber-500" />
									<span>Hasil pertemuan belum dilaporkan. Lengkapi laporan dan foto agar dapat diverifikasi oleh SPV.</span>
								</div>
							{/if}

							<!-- SPV Rejection Note Alert -->
							{#if v.verifikasi_status === 'rejected' && v.catatan_spv}
								<div class="rounded-xl p-2.5 mt-2.5 flex items-start gap-2 text-[11px] bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50">
									<IconCircleX size={15} class="text-rose-600 shrink-0 mt-0.5" />
									<div>
										<strong class="text-rose-700 dark:text-rose-400">Catatan Revisi / Alasan Ditolak SPV:</strong>
										<p class="text-rose-900 dark:text-rose-200 mt-0.5">{v.catatan_spv}</p>
									</div>
								</div>
							{/if}

							<!-- Action Buttons -->
							<div class="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t" style="border-color: var(--sys-sep)">
								<!-- Left side actions: Customer History & Direct WhatsApp -->
								<div class="flex items-center gap-2">
									{#if v.masterCustomerId}
										{@const custId = v.masterCustomerId}
										<button
											type="button"
											class="text-[11px] font-bold flex items-center gap-1 hover:underline"
											style="color: var(--p, var(--g))"
											onclick={() => goto(`/sales/customer/${custId}`)}
										>
											<IconBuildingStore size={13} />
											<span>Histori Customer</span>
										</button>
									{/if}

									{#if v.customer_telp}
										<a
											href={`https://wa.me/${cleanWaNumber(v.customer_telp)}`}
											target="_blank"
											rel="noopener noreferrer"
											class="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1"
										>
											<IconBrandWhatsapp size={13} />
											<span>WhatsApp</span>
										</a>
									{/if}
								</div>

								<!-- Right side actions: Draft submit or SPV verification or Details -->
								<div class="flex items-center gap-2">
									{#if v.verifikasi_status === 'draft'}
										<button
											type="button"
											class="px-3.5 py-1.5 rounded-xl text-[11px] font-bold text-white flex items-center gap-1.5 shadow-sm shadow-[var(--p,var(--g))]/20 active:scale-95 transition-transform"
											style="background: var(--p, var(--g))"
											onclick={() => goto(`/sales/${v.id}`)}
										>
											<IconEdit size={13} />
											<span>Input Hasil Laporan</span>
											<IconArrowRight size={12} />
										</button>
									{:else}
										{#if v.verifikasi_status === 'submitted' && canVerify}
											<button
												type="button"
												class="px-3 py-1.5 rounded-xl text-[11px] font-bold text-white bg-indigo-600 hover:bg-indigo-700 flex items-center gap-1 shadow-sm active:scale-95 transition-all"
												onclick={() => {
													reviewModalVisit = v;
													spvCatatan = '';
												}}
											>
												<IconCheck size={13} />
												<span>Verifikasi SPV</span>
											</button>
										{/if}

										<button
											type="button"
											class="px-3 py-1.5 rounded-xl text-[11px] font-semibold border flex items-center gap-1 transition-colors hover:bg-black/5 dark:hover:bg-white/5"
											style="border-color: var(--sys-sep); color: var(--sys-label)"
											onclick={() => goto(`/sales/${v.id}`)}
										>
											<span>Detail</span>
											<IconArrowRight size={12} />
										</button>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
</div>

<!-- Modal Verifikasi Cepat SPV -->
{#if reviewModalVisit}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in">
		<div class="w-full max-w-lg rounded-2xl border p-5 shadow-2xl flex flex-col gap-4" style="background: var(--sys-bg); border-color: var(--sys-sep)">
			<!-- Header -->
			<div class="flex items-start justify-between gap-2 border-b pb-3" style="border-color: var(--sys-sep)">
				<div>
					<h3 class="text-[16px] font-black" style="color: var(--sys-label)">Verifikasi Kunjungan Sales</h3>
					<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">Tinjau hasil laporan lapangan sebelum disetujui atau ditolak.</p>
				</div>
				<button
					type="button"
					class="p-1 rounded-lg hover:bg-black/10 dark:hover:bg-white/10"
					style="color: var(--sys-label3)"
					onclick={() => (reviewModalVisit = null)}
				>
					<IconX size={18} />
				</button>
			</div>

			<!-- Visit Summary -->
			<div class="rounded-xl p-3 border text-[12px] flex flex-col gap-1.5 bg-black/[0.02] dark:bg-white/[0.02]" style="border-color: var(--sys-sep)">
				<div class="flex items-center justify-between">
					<span class="font-bold text-[14px]" style="color: var(--sys-label)">{reviewModalVisit.customer_name || reviewModalVisit.tujuan}</span>
					<span class="text-[11px] font-semibold text-blue-600 dark:text-blue-400">{reviewModalVisit.tanggal_kunjungan}</span>
				</div>
				<p class="text-[11px]" style="color: var(--sys-label2)">Sales: <strong>{resolveSalesDisplayName(reviewModalVisit.sales_name)}</strong> &bull; Kegiatan: {reviewModalVisit.kegiatan || reviewModalVisit.tujuan}</p>
				{#if reviewModalVisit.hasil_kunjungan}
					<div class="mt-1 pt-1.5 border-t" style="border-color: var(--sys-sep)">
						<span class="text-[10px] font-bold block opacity-70">Laporan Hasil:</span>
						<p class="text-[12px] italic mt-0.5 font-medium" style="color: var(--sys-label)">"{reviewModalVisit.hasil_kunjungan}"</p>
					</div>
				{/if}
				{#if reviewModalVisit.foto_id}
					<div class="mt-2">
						<span class="text-[10px] font-bold block opacity-70 mb-1">Foto Bukti Lapangan:</span>
						<img
							src={`/api/directus/assets/${reviewModalVisit.foto_id}`}
							alt="Bukti Lapangan"
							class="h-32 w-full object-cover rounded-lg border cursor-pointer hover:opacity-95"
							style="border-color: var(--sys-sep)"
							onclick={() => (previewPhotoUrl = `/api/directus/assets/${reviewModalVisit?.foto_id}`)}
						/>
					</div>
				{/if}
			</div>

			<!-- Catatan SPV Input -->
			<div class="flex flex-col gap-1">
				<label class="text-[11px] font-bold" style="color: var(--sys-label)">
					Catatan SPV <span class="text-[10px] font-normal opacity-70">(Wajib jika ditolak, opsional jika disetujui)</span>
				</label>
				<textarea
					bind:value={spvCatatan}
					rows="3"
					placeholder="Masukkan masukan, arahan, atau alasan penolakan..."
					class="w-full rounded-xl border p-2.5 text-[12px] outline-none transition-all focus:ring-2 focus:ring-[var(--p,var(--g))]/40"
					style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
				></textarea>
			</div>

			<!-- Action Buttons -->
			<div class="flex items-center justify-end gap-2 pt-2 border-t" style="border-color: var(--sys-sep)">
				<button
					type="button"
					class="px-3.5 py-2 rounded-xl text-[12px] font-semibold border hover:bg-black/5 dark:hover:bg-white/5"
					style="border-color: var(--sys-sep); color: var(--sys-label)"
					disabled={isVerifying}
					onclick={() => (reviewModalVisit = null)}
				>
					Batal
				</button>
				<button
					type="button"
					class="px-4 py-2 rounded-xl text-[12px] font-bold text-white bg-rose-600 hover:bg-rose-700 active:scale-95 transition-all disabled:opacity-50"
					disabled={isVerifying}
					onclick={() => handleExecuteVerify('rejected')}
				>
					✕ Tolak Kunjungan
				</button>
				<button
					type="button"
					class="px-4 py-2 rounded-xl text-[12px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-95 transition-all disabled:opacity-50 flex items-center gap-1.5"
					disabled={isVerifying}
					onclick={() => handleExecuteVerify('verified')}
				>
					{#if isVerifying}<IconLoader2 size={14} class="animate-spin" />{/if}
					<span>✓ Setujui Kunjungan</span>
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Photo Preview Lightbox Modal -->
{#if previewPhotoUrl}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in"
		onclick={() => (previewPhotoUrl = null)}
	>
		<div class="relative max-w-2xl max-h-[90vh] flex flex-col items-center" onclick={(e) => e.stopPropagation()}>
			<button
				type="button"
				class="absolute -top-10 right-0 p-1.5 rounded-full bg-white/20 text-white hover:bg-white/30"
				onclick={() => (previewPhotoUrl = null)}
			>
				<IconX size={20} />
			</button>
			<img src={previewPhotoUrl} alt="Foto Bukti Lapangan" class="max-w-full max-h-[80vh] rounded-2xl shadow-2xl object-contain" />
		</div>
	</div>
{/if}
