<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { 
		IconArrowLeft, 
		IconPlus, 
		IconList, 
		IconReceipt2, 
		IconChevronRight, 
		IconPackage, 
		IconTools, 
		IconLoader2,
		IconWallet,
		IconClock,
		IconCheck,
		IconX,
		IconCash,
		IconBuilding,
		IconReceiptOff,
		IconExternalLink,
		IconFilter,
		IconUser,
		IconTag,
		IconDownload
	} from '@tabler/icons-svelte';
	import FieldExportSheet from '$lib/components/shared/FieldExportSheet.svelte';
	import type { CsvColumn } from '$lib/utils/exportCsv';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { getPengajuanAnggaran } from '$lib/services/finance';
	import { getProjectsForCurrentUser, getProjectScope } from '$lib/services/projectScope';
	import { authStore } from '$lib/stores/auth';
	import FilterSort from '$lib/components/FilterSort.svelte';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';
	import { getBudgetCategories, type BudgetCategory } from '$lib/services/budgetCategory';
	import {
		getBudgetStatusLabel,
		getBudgetStatusBadgeClass,
		getBudgetStatusDotClass,
		getBudgetStatusHint
	} from '$lib/constants/status';

	let loading = $state(true);
	let isLeader = $state(false);
	let userProjectIds: any[] = $state([]);
	let totalDiajukan = $state(0);
	let menungguAcc = $state(0);
	let disetujui = $state(0);
	let ditolak = $state(0);
	let dibayarkan = $state(0);

	let submissions = $state<any[]>([]);
	let searchQuery = $state('');
	let activeFilter = $state(''); // '' means 'semua'
	let sortOption = $state('-date_created');
	let expandedId = $state<string | number | null>(null);
	let projectsMap = $state<Record<number, string>>({});
	// Fase 3 (Pengajuan Anggaran v3): label kategori dari config bila kategori_belanja
	// terisi (kartu baru+lama), fallback ke kategori legacy untuk 505 baris lama.
	let categoriesByKode = $state<Record<string, BudgetCategory>>({});
	function kategoriLabel(budget: any): string {
		const cfg = budget.kategori_belanja ? categoriesByKode[budget.kategori_belanja] : null;
		if (cfg) return `${cfg.icon || ''} ${cfg.nama}`.trim();
		return budget.kategori || '-';
	}

	// Widget lapangan (Fase 5): breakdown pengeluaran per kategori dari submissions yang
	// sudah dimuat penuh (limit=-1) — bukan fetch baru.
	let categoryBreakdown = $derived.by(() => {
		const byKode: Record<string, { total: number; count: number }> = {};
		for (const b of submissions) {
			const kode = b.kategori_belanja || null;
			if (!kode) continue;
			if (!byKode[kode]) byKode[kode] = { total: 0, count: 0 };
			byKode[kode].total += b.total_amount || 0;
			byKode[kode].count += 1;
		}
		return Object.entries(byKode)
			.map(([kode, v]) => {
				const cfg = categoriesByKode[kode];
				return { kode, nama: cfg?.nama || kode, icon: cfg?.icon || '📄', total: v.total, count: v.count };
			})
			.sort((a, b) => b.total - a.total);
	});

	// Derived count metrics for badges & quick filter pills
	let countTotal = $derived(submissions.length);
	let countMenunggu = $derived(submissions.filter((b) => getStatusLabel(b.status) === 'Menunggu').length);
	let countDisetujui = $derived(submissions.filter((b) => getStatusLabel(b.status) === 'Disetujui').length);
	let countDibayarkan = $derived(submissions.filter((b) => getStatusLabel(b.status) === 'Dibayarkan').length);
	let countDitolak = $derived(submissions.filter((b) => getStatusLabel(b.status) === 'Ditolak').length);

	const sortOptions = [
		{ value: '-date_created', label: 'Paling Baru' },
		{ value: 'date_created', label: 'Paling Lama' },
		{ value: '-total_amount', label: 'Nominal Tertinggi' },
		{ value: 'total_amount', label: 'Nominal Terendah' }
	];

	// Nilai `value` harus sama dengan getStatusLabel(...).toLowerCase() — lihat filter
	// client-side di bawah. 'Diproses' & 'Dibayar Sebagian' baru muncul setelah pemetaan
	// status diperbaiki; tanpa pill ini keduanya tidak bisa disaring.
	const filterOptions = [
		{ value: 'menunggu', label: 'Menunggu' },
		{ value: 'diproses', label: 'Diproses' },
		{ value: 'disetujui', label: 'Disetujui' },
		{ value: 'dibayar sebagian', label: 'Dibayar Sebagian' },
		{ value: 'dibayarkan', label: 'Dibayarkan' },
		{ value: 'ditolak', label: 'Ditolak' }
	];

	onMount(async () => {
		loading = true;

		const needsLeaderFilter = !getProjectScope().unrestricted;
		isLeader = needsLeaderFilter;

		getBudgetCategories().then((cats) => {
			categoriesByKode = Object.fromEntries(cats.map((c) => [c.kode, c]));
		});

		try {
			const projects = await getProjectsForCurrentUser(false, { limit: -1 });
			if (needsLeaderFilter) {
				userProjectIds = projects.map((p: any) => p.id);
			}
			
			const map: Record<number, string> = {};
			projects.forEach((p: any) => {
				map[p.id] = p.name;
			});
			projectsMap = map;
		} catch (error) {
			console.error('Gagal memuat proyek:', error);
		}

		await Promise.all([
			loadStats()
		]);
		loading = false;
	});

	async function loadStats() {
		try {
			// Jika leader dan tidak punya project, skip
			if (isLeader && userProjectIds.length === 0) {
				totalDiajukan = 0;
				menungguAcc = 0;
				disetujui = 0;
				ditolak = 0;
				dibayarkan = 0;
				submissions = [];
				return;
			}
			const options: any = {};
			if (isLeader && userProjectIds.length > 0) {
				options.projectIds = userProjectIds;
			}
			const stats = await getPengajuanAnggaran(-1, options);
			submissions = stats || [];
			totalDiajukan = stats.reduce((acc: number, curr: any) => acc + (curr.total_amount || 0), 0);
			menungguAcc = stats.filter((b: any) => getStatusLabel(b.status) === 'Menunggu').reduce((acc: number, curr: any) => acc + (curr.total_amount || 0), 0);
			disetujui = stats.filter((b: any) => getStatusLabel(b.status) === 'Disetujui').reduce((acc: number, curr: any) => acc + (curr.total_amount || 0), 0);
			ditolak = stats.filter((b: any) => getStatusLabel(b.status) === 'Ditolak').reduce((acc: number, curr: any) => acc + (curr.total_amount || 0), 0);
			dibayarkan = stats.filter((b: any) => getStatusLabel(b.status) === 'Dibayarkan').reduce((acc: number, curr: any) => acc + (curr.total_amount || 0), 0);
		} catch (e) {
			console.error(e);
		}
	}

	const filteredSubmissions = $derived.by(() => {
		let res = [...submissions];

		// Search
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase().trim();
			res = res.filter((item) => 
				(item.nomor_pengajuan || '').toLowerCase().includes(q) ||
				(item.nama_pengaju || '').toLowerCase().includes(q) ||
				(item.tujuan_pengajuan || '').toLowerCase().includes(q) ||
				(projectsMap[item.project_id] || '').toLowerCase().includes(q)
			);
		}

		// Filter
		if (activeFilter) {
			res = res.filter((item) => getStatusLabel(item.status).toLowerCase() === activeFilter.toLowerCase());
		}

		// Sort
		res.sort((a, b) => {
			if (sortOption === '-date_created') {
				return new Date(b.date_created).getTime() - new Date(a.date_created).getTime();
			} else if (sortOption === 'date_created') {
				return new Date(a.date_created).getTime() - new Date(b.date_created).getTime();
			} else if (sortOption === '-total_amount') {
				return (b.total_amount || 0) - (a.total_amount || 0);
			} else if (sortOption === 'total_amount') {
				return (a.total_amount || 0) - (b.total_amount || 0);
			}
			return 0;
		});

		return res;
	});

	// Pemetaan status dipusatkan di $lib/constants/status supaya tidak divergen lagi
	// dengan admin. Versi lokal sebelumnya tidak mengenal 'Approved' & 'Completed',
	// sehingga 160 dari 515 pengajuan (31%) salah berlabel "Menunggu".
	const getStatusLabel = getBudgetStatusLabel;

	let exportOpen = $state(false);
	const EXPORT_COLUMNS: CsvColumn[] = [
		{ key: 'nomor', label: 'No. Pengajuan' },
		{ key: 'tanggal', label: 'Tanggal' },
		{ key: 'proyek', label: 'Proyek' },
		{ key: 'pengaju', label: 'Pengaju' },
		{ key: 'kategori', label: 'Kategori' },
		{ key: 'tujuan', label: 'Tujuan' },
		{ key: 'nominal', label: 'Nominal' },
		{ key: 'status', label: 'Status' }
	];
	let exportRows = $derived(
		filteredSubmissions.map((b) => ({
			nomor: b.nomor_pengajuan || '',
			tanggal: b.date_created ? new Date(b.date_created).toLocaleDateString('id-ID') : '',
			proyek: projectsMap[b.project_id] || '',
			pengaju: b.nama_pengaju || '',
			kategori: kategoriLabel(b),
			tujuan: b.tujuan_pengajuan || '',
			nominal: b.total_amount || 0,
			status: getStatusLabel(b.status)
		}))
	);
	const getStatusBadgeStyle = getBudgetStatusBadgeClass;
	const getStatusDotStyle = getBudgetStatusDotClass;

	function formatCurrency(val: number) {
		if (val >= 1000000000) return 'Rp ' + (val / 1000000000).toFixed(1).replace('.0', '') + ' M';
		if (val >= 1000000) return 'Rp ' + (val / 1000000).toFixed(1).replace('.0', '') + ' jt';
		if (val >= 1000) return 'Rp ' + (val / 1000).toFixed(0) + ' rb';
		return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);
	}

	function formatCurrencyFull(val: number) {
		return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val);
	}

	function toggleExpand(id: string | number) {
		if (expandedId === id) {
			expandedId = null;
		} else {
			expandedId = id;
		}
	}

	function setQuickFilter(filterKey: string) {
		activeFilter = filterKey;
	}
</script>

<div class="flex-1 flex flex-col h-full">
	{#if loading}
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data pengajuan anggaran..." />
	{:else}
		<div class="scroll-body px-4 sm:px-6 py-6 lg:px-8 max-w-7xl mx-auto w-full space-y-6">
			<div class="flex items-center justify-between">
				<div>
					<h2 class="text-lg font-bold" style="color: var(--sys-label)">Ringkasan Anggaran Proyek</h2>
					<p class="text-xs" style="color: var(--sys-label3)">Pantau dan ajukan kebutuhan dana operasional lapangan</p>
				</div>
				<div class="flex items-center gap-2">
					<button
						type="button"
						onclick={() => goto('/hutang-proyek')}
						class="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all text-purple-700 bg-purple-50 hover:bg-purple-100 border-purple-300 dark:bg-purple-900/30 dark:border-purple-700/60 dark:text-purple-300"
						title="Lihat tagihan supplier outstanding untuk proyek yang Anda pegang"
					>
						<IconReceipt2 size={16} />
						<span>Hutang Proyek</span>
					</button>
					<button
						type="button"
						onclick={() => goto('/anggaran/cek-gate')}
						class="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all text-purple-700 bg-purple-50 hover:bg-purple-100 border-purple-300 dark:bg-purple-900/30 dark:border-purple-700/60 dark:text-purple-300"
						title="Cek apakah pengajuan siap dan lolos gate sebelum mengisi form"
					>
						<span>🎯</span>
						<span>Cek Kesiapan Gate</span>
					</button>
					<button
						type="button"
						onclick={() => goto('/anggaran/rapor-kecepatan')}
						class="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border transition-all text-purple-700 bg-purple-50 hover:bg-purple-100 border-purple-300 dark:bg-purple-900/30 dark:border-purple-700/60 dark:text-purple-300"
						title="Estimasi kapan pengajuan Anda bisa cair, dan rata-rata waktu per kategori"
					>
						<span>📊</span>
						<span>Estimasi &amp; Rapor Kecepatan</span>
					</button>
					<button
						type="button"
						onclick={() => goto('/sewa-alat/ajukan')}
						class="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white shadow-sm hover:opacity-95 transition-all"
						style="background: #ea580c"
						title="Ajukan sewa alat dari vendor (bukan alat milik sendiri)"
					>
						<span>🔶</span>
						<span>Sewa Alat</span>
					</button>
					<button
						type="button"
						onclick={() => goto('/anggaran/baru')}
						class="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold text-white shadow-sm hover:opacity-95 transition-all"
						style="background: var(--g)"
					>
						<IconPlus size={16} />
						<span>Pengajuan Baru</span>
					</button>
				</div>
			</div>

			<!-- Stats Cards Grid -->
			<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
				<!-- Total Diajukan -->
				<div class="rounded-2xl p-4 transition-all duration-200 hover:shadow-md" style="background: var(--sys-bg2); border: 1px solid var(--sys-sep);">
					<div class="flex items-center justify-between mb-2.5">
						<span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--sys-label3)]">Total Diajukan</span>
						<div class="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-500 dark:bg-blue-400/20 dark:text-blue-400 flex items-center justify-center">
							<IconWallet size={18} />
						</div>
					</div>
					<div class="space-y-1">
						<strong class="text-lg sm:text-xl font-bold tracking-tight text-[var(--sys-label)] block">{formatCurrency(totalDiajukan)}</strong>
						<span class="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--sys-label3)]">
							<span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span> {countTotal} pengajuan
						</span>
					</div>
				</div>

				<!-- Menunggu ACC -->
				<div class="rounded-2xl p-4 transition-all duration-200 hover:shadow-md" style="background: var(--sys-bg2); border: 1px solid var(--sys-sep);">
					<div class="flex items-center justify-between mb-2.5">
						<span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--sys-label3)]">Menunggu ACC</span>
						<div class="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-500 dark:bg-amber-400/20 dark:text-amber-400 flex items-center justify-center">
							<IconClock size={18} />
						</div>
					</div>
					<div class="space-y-1">
						<strong class="text-lg sm:text-xl font-bold tracking-tight text-amber-600 dark:text-amber-400 block">{formatCurrency(menungguAcc)}</strong>
						<span class="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--sys-label3)]">
							<span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span> {countMenunggu} pengajuan
						</span>
					</div>
				</div>

				<!-- Disetujui -->
				<div class="rounded-2xl p-4 transition-all duration-200 hover:shadow-md" style="background: var(--sys-bg2); border: 1px solid var(--sys-sep);">
					<div class="flex items-center justify-between mb-2.5">
						<span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--sys-label3)]">Disetujui</span>
						<div class="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-500 dark:bg-emerald-400/20 dark:text-emerald-400 flex items-center justify-center">
							<IconCheck size={18} />
						</div>
					</div>
					<div class="space-y-1">
						<strong class="text-lg sm:text-xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400 block">{formatCurrency(disetujui)}</strong>
						<span class="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--sys-label3)]">
							<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> {countDisetujui} pengajuan
						</span>
					</div>
				</div>

				<!-- Dibayarkan -->
				<div class="rounded-2xl p-4 transition-all duration-200 hover:shadow-md" style="background: var(--sys-bg2); border: 1px solid var(--sys-sep);">
					<div class="flex items-center justify-between mb-2.5">
						<span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--sys-label3)]">Dibayarkan</span>
						<div class="w-8 h-8 rounded-xl bg-sky-500/10 text-sky-500 dark:bg-sky-400/20 dark:text-sky-400 flex items-center justify-center">
							<IconCash size={18} />
						</div>
					</div>
					<div class="space-y-1">
						<strong class="text-lg sm:text-xl font-bold tracking-tight text-sky-600 dark:text-sky-400 block">{formatCurrency(dibayarkan)}</strong>
						<span class="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--sys-label3)]">
							<span class="w-1.5 h-1.5 rounded-full bg-sky-500"></span> {countDibayarkan} pengajuan
						</span>
					</div>
				</div>

				<!-- Ditolak -->
				<div class="col-span-2 md:col-span-1 rounded-2xl p-4 transition-all duration-200 hover:shadow-md" style="background: var(--sys-bg2); border: 1px solid var(--sys-sep);">
					<div class="flex items-center justify-between mb-2.5">
						<span class="text-[11px] font-semibold uppercase tracking-wider text-[var(--sys-label3)]">Ditolak</span>
						<div class="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-500 dark:bg-rose-400/20 dark:text-rose-400 flex items-center justify-center">
							<IconX size={18} />
						</div>
					</div>
					<div class="space-y-1">
						<strong class="text-lg sm:text-xl font-bold tracking-tight text-rose-600 dark:text-rose-400 block">{formatCurrency(ditolak)}</strong>
						<span class="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--sys-label3)]">
							<span class="w-1.5 h-1.5 rounded-full bg-rose-500"></span> {countDitolak} pengajuan
						</span>
					</div>
				</div>
			</div>

			<!-- Fase 5 (Pengajuan Anggaran v3): pengeluaran per kategori — dihitung dari data
			     yang sudah dimuat (submissions, limit=-1 sudah scope ke proyek user ini),
			     nol fetch tambahan. Bukan "sisa pagu RAB" (butuh struktur so_rab per kategori
			     yang belum ada) — ini murni breakdown pengeluaran diajukan/disetujui/dibayar. -->
			{#if categoryBreakdown.length > 0}
				<div class="rounded-2xl p-4" style="background: var(--sys-bg2); border: 1px solid var(--sys-sep);">
					<h3 class="text-[13px] font-semibold mb-2.5" style="color: var(--sys-label)">Pengeluaran per Kategori</h3>
					<div class="flex flex-wrap gap-2">
						{#each categoryBreakdown as c (c.kode)}
							<div class="flex items-center gap-2 px-3 py-2 rounded-xl" style="background: var(--sys-fill2);">
								<span class="text-sm">{c.icon}</span>
								<div class="leading-tight">
									<div class="text-[11px] font-medium" style="color: var(--sys-label)">{c.nama}</div>
									<div class="text-[10px]" style="color: var(--sys-label3)">{formatCurrency(c.total)} · {c.count} pengajuan</div>
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- CTA Banner -->
			<div class="relative overflow-hidden rounded-2xl bg-gradient-to-r from-orange-500 via-amber-500 to-orange-600 p-4 sm:p-5 text-white shadow-lg shadow-orange-500/15">
				<div class="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
					<div class="flex items-center gap-3.5">
						<div class="w-11 h-11 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center shrink-0 border border-white/20">
							<IconPlus size={22} class="text-white" />
						</div>
						<div>
							<h2 class="text-base sm:text-lg font-bold tracking-tight text-white">Buat Pengajuan Anggaran Baru</h2>
							<p class="text-xs text-orange-100/90 mt-0.5">Ajukan kasbon borongan, perbaikan alat, atau kebutuhan material proyek</p>
						</div>
					</div>
					<button 
						class="w-full sm:w-auto px-5 py-2.5 bg-white text-orange-600 hover:bg-orange-50 active:scale-[0.98] transition-all font-semibold text-xs sm:text-sm rounded-xl shadow-md flex items-center justify-center gap-2 shrink-0 cursor-pointer"
						onclick={() => goto('/anggaran/baru')}
					>
						<IconPlus size={16} /> Buat Sekarang
					</button>
				</div>
				<div class="absolute -right-8 -bottom-8 w-32 h-32 rounded-full bg-white/10 blur-xl pointer-events-none"></div>
			</div>

			<!-- Fase 4 Lapangan #1: cek gate mandiri sebelum isi form lengkap -->
			<button
				class="w-full flex items-center justify-between px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-left hover:bg-gray-50 transition-colors"
				onclick={() => goto('/anggaran/cek-gate')}
			>
				<span class="text-[12px] font-medium text-gray-600">🔍 Apakah saya siap mengajukan? — cek cepat sebelum isi form</span>
				<IconChevronRight size={16} class="text-gray-300 shrink-0" />
			</button>

			<!-- PA-Rilis Hutang v2 (Fase 4): jalan pintas ke daftar tagihan supplier proyek -->
			<button
				class="w-full flex items-center justify-between px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-left hover:bg-gray-50 transition-colors"
				onclick={() => goto('/hutang-proyek')}
			>
				<span class="text-[12px] font-medium text-gray-600">🧾 Ada tagihan supplier proyek yang perlu segera dibayar? — lihat Hutang Proyek</span>
				<IconChevronRight size={16} class="text-gray-300 shrink-0" />
			</button>

			<!-- Riwayat Pengajuan Section -->
			<div class="space-y-4 pt-2">
				<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
					<div class="text-xs font-bold text-[var(--sys-label2)] tracking-widest uppercase flex items-center gap-2">
						<IconList size={18} class="text-blue-500" /> RIWAYAT PENGAJUAN SAYA
					</div>

					<!-- Quick Filter Pills -->
					<div class="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
						<button 
							class="px-3 py-1.5 rounded-xl text-xs font-medium transition-all shrink-0 cursor-pointer flex items-center gap-1.5 {activeFilter === '' ? 'bg-[var(--p)] text-white shadow-sm font-semibold' : 'text-[var(--sys-label2)] hover:bg-[var(--sys-fill)]'}"
							style="background: {activeFilter === '' ? 'var(--p)' : 'var(--sys-fill)'}"
							onclick={() => setQuickFilter('')}
						>
							Semua <span class="px-1.5 py-0.2 rounded-full text-[10px] {activeFilter === '' ? 'bg-white/20 text-white' : 'bg-[var(--sys-fill2)] text-[var(--sys-label3)]'}">{countTotal}</span>
						</button>
						<button 
							class="px-3 py-1.5 rounded-xl text-xs font-medium transition-all shrink-0 cursor-pointer flex items-center gap-1.5 {activeFilter === 'menunggu' ? 'bg-amber-500 text-white shadow-sm font-semibold' : 'text-[var(--sys-label2)] hover:bg-[var(--sys-fill)]'}"
							style="background: {activeFilter === 'menunggu' ? '#f59e0b' : 'var(--sys-fill)'}"
							onclick={() => setQuickFilter('menunggu')}
						>
							Menunggu <span class="px-1.5 py-0.2 rounded-full text-[10px] {activeFilter === 'menunggu' ? 'bg-white/20 text-white' : 'bg-[var(--sys-fill2)] text-[var(--sys-label3)]'}">{countMenunggu}</span>
						</button>
						<button 
							class="px-3 py-1.5 rounded-xl text-xs font-medium transition-all shrink-0 cursor-pointer flex items-center gap-1.5 {activeFilter === 'disetujui' ? 'bg-emerald-500 text-white shadow-sm font-semibold' : 'text-[var(--sys-label2)] hover:bg-[var(--sys-fill)]'}"
							style="background: {activeFilter === 'disetujui' ? '#10b981' : 'var(--sys-fill)'}"
							onclick={() => setQuickFilter('disetujui')}
						>
							Disetujui <span class="px-1.5 py-0.2 rounded-full text-[10px] {activeFilter === 'disetujui' ? 'bg-white/20 text-white' : 'bg-[var(--sys-fill2)] text-[var(--sys-label3)]'}">{countDisetujui}</span>
						</button>
						<button 
							class="px-3 py-1.5 rounded-xl text-xs font-medium transition-all shrink-0 cursor-pointer flex items-center gap-1.5 {activeFilter === 'dibayarkan' ? 'bg-sky-500 text-white shadow-sm font-semibold' : 'text-[var(--sys-label2)] hover:bg-[var(--sys-fill)]'}"
							style="background: {activeFilter === 'dibayarkan' ? '#0ea5e9' : 'var(--sys-fill)'}"
							onclick={() => setQuickFilter('dibayarkan')}
						>
							Dibayarkan <span class="px-1.5 py-0.2 rounded-full text-[10px] {activeFilter === 'dibayarkan' ? 'bg-white/20 text-white' : 'bg-[var(--sys-fill2)] text-[var(--sys-label3)]'}">{countDibayarkan}</span>
						</button>
						<button 
							class="px-3 py-1.5 rounded-xl text-xs font-medium transition-all shrink-0 cursor-pointer flex items-center gap-1.5 {activeFilter === 'ditolak' ? 'bg-rose-500 text-white shadow-sm font-semibold' : 'text-[var(--sys-label2)] hover:bg-[var(--sys-fill)]'}"
							style="background: {activeFilter === 'ditolak' ? '#f43f5e' : 'var(--sys-fill)'}"
							onclick={() => setQuickFilter('ditolak')}
						>
							Ditolak <span class="px-1.5 py-0.2 rounded-full text-[10px] {activeFilter === 'ditolak' ? 'bg-white/20 text-white' : 'bg-[var(--sys-fill2)] text-[var(--sys-label3)]'}">{countDitolak}</span>
						</button>
					</div>
				</div>

				<!-- Search and Filter Controls -->
				<div class="flex items-start gap-2">
					<div class="flex-1 min-w-0">
						<FilterSort
							bind:searchQuery
							bind:sortOption
							bind:filterOption={activeFilter}
							{sortOptions}
							{filterOptions}
							placeholder="Cari pengajuan, nama pengaju, atau proyek..."
						/>
					</div>
					<button
						type="button"
						onclick={() => (exportOpen = true)}
						disabled={!filteredSubmissions.length}
						class="shrink-0 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border text-[12px] font-semibold disabled:opacity-40"
						style="border-color: var(--sys-sep); color: var(--sys-label2)"
						title="Ekspor daftar pengajuan yang sedang tampil"
					>
						<IconDownload size={14} /> Ekspor
					</button>
				</div>

				<FieldExportSheet
					open={exportOpen}
					onClose={() => (exportOpen = false)}
					judul="Pengajuan Anggaran"
					filename="pengajuan-anggaran"
					columns={EXPORT_COLUMNS}
					rows={exportRows}
					formats={['xlsx', 'csv', 'pdf']}
				/>

				<!-- List Items -->
				{#if filteredSubmissions.length === 0}
					<div class="text-center py-12 px-4 rounded-2xl border border-dashed flex flex-col items-center justify-center gap-3" style="background: var(--sys-bg2); border-color: var(--sys-sep)">
						<div class="w-12 h-12 rounded-2xl bg-[var(--sys-fill)] flex items-center justify-center text-[var(--sys-label3)]">
							<IconReceiptOff size={24} />
						</div>
						<div class="space-y-1 max-w-sm">
							<p class="text-sm font-semibold text-[var(--sys-label)]">
								{#if searchQuery || activeFilter}
									Tidak ada pengajuan yang cocok dengan filter
								{:else}
									Belum ada riwayat pengajuan
								{/if}
							</p>
							<p class="text-xs text-[var(--sys-label3)]">
								{#if searchQuery || activeFilter}
									Coba ubah kata kunci pencarian atau bersihkan filter status untuk melihat data lainnya.
								{:else}
									Buat pengajuan anggaran baru untuk mencatat kasbon borongan atau pembelian material.
								{/if}
							</p>
						</div>
						{#if searchQuery || activeFilter}
							<button 
								class="mt-2 px-4 py-2 text-xs font-semibold rounded-xl bg-[var(--sys-fill)] text-[var(--sys-label)] hover:bg-[var(--sys-fill2)] transition-colors cursor-pointer"
								onclick={() => { searchQuery = ''; activeFilter = ''; }}
							>
								Reset Filter & Pencarian
							</button>
						{/if}
					</div>
				{:else}
					<div class="space-y-3">
						{#each filteredSubmissions as budget (budget.id)}
							<div 
								class="rounded-2xl transition-all duration-200 overflow-hidden" 
								style="background: var(--sys-bg2); border: 1px solid var(--sys-sep); box-shadow: 0 2px 6px rgba(0,0,0,0.02)"
							>
								<button
									class="w-full p-4 cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left transition-colors hover:bg-[var(--sys-fill)]/50 active:scale-[0.99]"
									onclick={() => toggleExpand(budget.id)}
								>
									<div class="flex items-start gap-3.5 min-w-0">
										<!-- Category Icon Badge -->
										<div class="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 mt-0.5" style="background: var(--pl)">
											{#if budget.kategori === 'material'}
												<IconPackage size={22} class="text-[var(--p)]" />
											{:else if budget.kategori === 'alat'}
												<IconTools size={22} class="text-[var(--p)]" />
											{:else}
												<IconReceipt2 size={22} class="text-[var(--p)]" />
											{/if}
										</div>

										<div class="min-w-0 space-y-1">
											<!-- Title / Purpose -->
											<h3 class="text-sm font-semibold text-[var(--sys-label)] leading-snug break-words">
												{budget.tujuan_pengajuan || 'Pengajuan Keuangan'}
											</h3>

											<!-- Sub-info tags -->
											<div class="flex flex-wrap items-center gap-2 text-xs">
												{#if budget.nomor_pengajuan}
													<span class="font-mono text-[11px] font-semibold px-2 py-0.5 rounded-md bg-[var(--sys-fill)] text-[var(--sys-label2)]">
														#{budget.nomor_pengajuan}
													</span>
												{/if}
												<!-- Fase 3 (Rencana v2 Shift-Left Gate Anggaran, 25 Sep 2026) — beri tahu pengaju
												     dari daftar saja, tanpa harus buka detail, bahwa syarat WAJIB belum lengkap. -->
												{#if budget.interlocking_status === 'blocked' && budget.status === 'Pending'}
													<Tooltip text="Ada syarat WAJIB yang belum terpenuhi — buka pengajuan ini untuk detail & tombol Cek Ulang" position="bottom">
														<span class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-red-50 text-red-600">
															🔴 Tertahan syarat
														</span>
													</Tooltip>
												{/if}
												{#if projectsMap[budget.project_id]}
													<span class="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--sys-label2)]">
														<IconBuilding size={13} class="text-[var(--sys-label3)]" />
														{projectsMap[budget.project_id]}
													</span>
												{/if}
												<span class="text-[11px] text-[var(--sys-label3)]">
													{new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(budget.date_created))}
												</span>
											</div>
										</div>
									</div>

									<!-- Right side: Amount & Status Badge -->
									<div class="flex items-center justify-between sm:justify-end gap-3 pt-2 sm:pt-0 border-t sm:border-t-0 border-[var(--sys-sep)]">
										<div class="text-left sm:text-right">
											<span class="text-sm sm:text-base font-bold text-[var(--sys-label)] block">
												{formatCurrencyFull(budget.total_amount || 0)}
											</span>
											<span
												class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold mt-0.5 {getStatusBadgeStyle(budget.status)}"
												title={getBudgetStatusHint(budget.status)}
											>
												<span class="w-1.5 h-1.5 rounded-full {getStatusDotStyle(budget.status)}"></span>
												{getStatusLabel(budget.status)}
											</span>
										</div>

										<div class="w-7 h-7 rounded-full bg-[var(--sys-fill)] flex items-center justify-center text-[var(--sys-label3)] shrink-0 transition-transform duration-200 {expandedId === budget.id ? 'rotate-90' : ''}">
											<IconChevronRight size={16} />
										</div>
									</div>
								</button>
								
								<!-- Accordion Details -->
								{#if expandedId === budget.id}
									<div class="px-4 pb-4 pt-3 border-t text-xs space-y-4" style="border-color: var(--sys-sep); background: var(--sys-fill)/40">
										<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
											<div class="space-y-0.5">
												<span class="text-[10px] font-semibold uppercase tracking-wider text-[var(--sys-label3)] block">No. Pengajuan</span>
												<span class="font-mono font-medium text-[var(--sys-label)]">{budget.nomor_pengajuan || '-'}</span>
											</div>
											<div class="space-y-0.5">
												<span class="text-[10px] font-semibold uppercase tracking-wider text-[var(--sys-label3)] block">Proyek</span>
												<span class="font-medium text-[var(--sys-label)]">{projectsMap[budget.project_id] || '-'}</span>
											</div>
											<div class="space-y-0.5">
												<span class="text-[10px] font-semibold uppercase tracking-wider text-[var(--sys-label3)] block">Pengaju</span>
												<span class="font-medium text-[var(--sys-label)]">{budget.nama_pengaju || '-'}</span>
											</div>
											<div class="space-y-0.5">
												<span class="text-[10px] font-semibold uppercase tracking-wider text-[var(--sys-label3)] block">Departemen</span>
												<span class="font-medium text-[var(--sys-label)]">{budget.department || '-'}</span>
											</div>
											<div class="space-y-0.5">
												<span class="text-[10px] font-semibold uppercase tracking-wider text-[var(--sys-label3)] block">Kategori</span>
												<span class="font-medium text-[var(--sys-label)] capitalize">{kategoriLabel(budget)}</span>
											</div>
											<div class="space-y-0.5">
												<span class="text-[10px] font-semibold uppercase tracking-wider text-[var(--sys-label3)] block">Status Pengajuan</span>
												<span class="font-medium text-[var(--sys-label)] capitalize">{getStatusLabel(budget.status) || '-'}</span>
											</div>
										</div>
										
										<div class="pt-1 flex justify-end">
											<button 
												class="w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
												style="background: var(--pl); color: var(--p)"
												onclick={() => goto(`/anggaran/${budget.id}`)}
											>
												Lihat Detail Lengkap & Items <IconExternalLink size={14} />
											</button>
										</div>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<div class="h-6"></div>
		</div>
	{/if}
</div>

