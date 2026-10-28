<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getOperatorEquipment, getTodaySessionsMap, getPmDueCountsMap, getEquipmentCategoriesMap, submitQuickHM } from '$lib/services/preventive';
	import { getAssetOwnershipSummaryBatch } from '$lib/services/assetOwnership';
	import { todayWib } from '$lib/utils/wibDate';
	import IconTool from '@tabler/icons-svelte/icons/tool';
	import IconCircleCheck from '@tabler/icons-svelte/icons/circle-check';
	import IconAlertTriangle from '@tabler/icons-svelte/icons/alert-triangle';
	import IconChevronRight from '@tabler/icons-svelte/icons/chevron-right';
	import IconLoader2 from '@tabler/icons-svelte/icons/loader-2';
	import IconSearch from '@tabler/icons-svelte/icons/search';
	import IconChevronDown from '@tabler/icons-svelte/icons/chevron-down';
	import IconGauge from '@tabler/icons-svelte/icons/gauge';
	import IconClock from '@tabler/icons-svelte/icons/clock';
	import IconX from '@tabler/icons-svelte/icons/x';
	import IconRefresh from '@tabler/icons-svelte/icons/refresh';
	import { SectionGuide, FieldHint, EmptyStateGuide, StatusExplainer } from '$lib/components/hints';
	import { preventiveHints } from '$lib/data/hints/preventive';
	import { getHint } from '$lib/data/hints/getHint';

	/** Pintasan pembaca hint modul Preventive */
	const h = (key: string) => getHint(preventiveHints, key, 'preventive-maintenance');

	// Quick Log HM modal state
	let quickHmEquipment = $state<any | null>(null);
	let quickHmValue = $state('');
	let quickHmSubmitting = $state(false);
	let quickHmError = $state('');

	function openQuickHm(eq: any) {
		quickHmEquipment = eq;
		quickHmValue = eq.last_hoursmeter != null ? String(eq.last_hoursmeter) : '';
		quickHmError = '';
	}

	async function submitQuickHmForm() {
		if (!quickHmEquipment) return;
		const val = parseFloat(quickHmValue);
		if (!Number.isFinite(val) || val < 0) {
			quickHmError = 'HM wajib angka >= 0.';
			return;
		}
		quickHmSubmitting = true;
		quickHmError = '';
		try {
			await submitQuickHM(quickHmEquipment.id, val);
			quickHmEquipment.last_hoursmeter = val;
			equipmentList = [...equipmentList];
			quickHmEquipment = null;
		} catch (e: any) {
			quickHmError = e?.message || 'Gagal menyimpan HM.';
		} finally {
			quickHmSubmitting = false;
		}
	}

	function conditionBadge(status: string | null | undefined) {
		if (!status) return null;
		const s = status.toLowerCase().trim();
		
		switch (s) {
			case 'operational':
			case 'operasional':
				return {
					label: 'Operational',
					dotClass: 'bg-emerald-500',
					badgeClass: 'bg-emerald-50 text-emerald-800 border border-emerald-200/90 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'
				};
			case 'breakdown':
				return {
					label: 'Breakdown',
					dotClass: 'bg-rose-500',
					badgeClass: 'bg-rose-50 text-rose-800 border border-rose-200/90 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800'
				};
			case 'rental_out':
				return {
					label: 'Rental Out',
					dotClass: 'bg-blue-500',
					badgeClass: 'bg-blue-50 text-blue-800 border border-blue-200/90 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800'
				};
			case 'rental_in':
				return {
					label: 'Rental In',
					dotClass: 'bg-purple-500',
					badgeClass: 'bg-purple-50 text-purple-800 border border-purple-200/90 dark:bg-purple-950/50 dark:text-purple-300 dark:border-purple-800'
				};
			case 'on_project':
				return {
					label: 'Di Proyek',
					dotClass: 'bg-teal-500',
					badgeClass: 'bg-teal-50 text-teal-800 border border-teal-200/90 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-800'
				};
			case 'under_repair':
				return {
					label: 'Dalam Perbaikan',
					dotClass: 'bg-amber-500',
					badgeClass: 'bg-amber-50 text-amber-800 border border-amber-200/90 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800'
				};
			case 'broken':
				return {
					label: 'Rusak',
					dotClass: 'bg-rose-500',
					badgeClass: 'bg-rose-50 text-rose-800 border border-rose-200/90 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800'
				};
			case 'available':
				return {
					label: 'Tersedia',
					dotClass: 'bg-emerald-500',
					badgeClass: 'bg-emerald-50 text-emerald-800 border border-emerald-200/90 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'
				};
			default: {
				const formattedLabel = status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
				return {
					label: formattedLabel,
					dotClass: 'bg-slate-500',
					badgeClass: 'bg-slate-100 text-slate-800 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
				};
			}
		}
	}

	function formatHM(val: number | string | null | undefined): string {
		if (val == null || val === '') return '-';
		const n = typeof val === 'number' ? val : parseFloat(String(val));
		if (isNaN(n)) return String(val);
		return n.toLocaleString('id-ID');
	}

	let loading = $state(true);
	let equipmentList = $state<any[]>([]);
	let sessionMap = $state<Record<string, any>>({});
	let pmMap = $state<Record<string, { overdue: number; total: number }>>({});
	let categoryMap = $state<Record<string, string>>({});
	// Fase 6.3 (Penajaman Aset Produktif, 29 Agu 2026): beban perawatan per alat — 1 batch
	// fetch untuk seluruh daftar, BUKAN per-baris (lihat assetOwnership.ts).
	let ownershipMap = $state<Map<string, { totalBiaya: number; woCount: number; rasioPct: number; statusLevel: 'aman' | 'peringatan' | 'kritis' }>>(new Map());

	const today = todayWib();

	let searchQuery = $state('');
	let statusFilter = $state<'Semua' | 'P2H Belum' | 'P2H Sudah' | 'PM Overdue'>('Semua');
	
	// Fase A1 (P2H Alat Ukur QC, 5 Sep 2026): filter kategori dipertahankan per-HP
	// supaya QC Gudang tidak perlu memilih ulang "Alat Ukur & Instrumen QC" tiap sesi.
	const CATEGORY_FILTER_KEY = 'epi_preventive_category_filter';
	let selectedCategories = $state<string[]>([]);
	function loadSelectedCategories() {
		try {
			const saved = localStorage.getItem(CATEGORY_FILTER_KEY);
			if (saved) {
				const parsed = JSON.parse(saved);
				if (Array.isArray(parsed)) selectedCategories = parsed.filter((c) => typeof c === 'string');
			}
		} catch {
			// localStorage tidak tersedia — pakai default (Semua Kategori).
		}
	}
	function persistSelectedCategories() {
		try {
			localStorage.setItem(CATEGORY_FILTER_KEY, JSON.stringify(selectedCategories));
		} catch {
			// localStorage tidak tersedia — pilihan tidak akan bertahan setelah reload.
		}
	}
	let isCategoryDropdownOpen = $state(false);
	let dropdownRef: HTMLDivElement | null = null;
	let collapsedCategories = $state<Record<string, boolean>>({});
	// Kategori alat ukur (Fase A0) — dipakai untuk menampilkan hint khusus saat dipilih.
	const ALAT_UKUR_CATEGORIES = ['Alat Ukur & Instrumen QC', 'Referensi & Komparator Visual'];
	let showAlatUkurHint = $derived(selectedCategories.some((c) => ALAT_UKUR_CATEGORIES.includes(c)));

	let availableCategories = $derived.by(() => {
		const cats = new Set(Object.values(categoryMap));
		if (equipmentList.some(eq => !eq.category_id || !categoryMap[eq.category_id])) {
			cats.add('Tidak Berkategori');
		}
		return Array.from(cats).sort();
	});

	function toggleCategory(cat: string) {
		if (selectedCategories.includes(cat)) {
			selectedCategories = selectedCategories.filter(c => c !== cat);
		} else {
			selectedCategories = [...selectedCategories, cat];
		}
		persistSelectedCategories();
	}

	function selectAllCategories() {
		selectedCategories = [];
		persistSelectedCategories();
	}

	// Ringkasan KPI Cepat
	let stats = $derived.by(() => {
		const total = equipmentList.length;
		let p2hSudahCount = 0;
		let p2hBelumCount = 0;
		let pmOverdueCount = 0;
		let pmTotalDueCount = 0;

		for (const eq of equipmentList) {
			const isDone = !!sessionMap[eq.id];
			if (isDone) {
				p2hSudahCount++;
			} else {
				p2hBelumCount++;
			}
			const pm = pmMap[eq.id];
			if (pm) {
				if (pm.overdue > 0) pmOverdueCount += pm.overdue;
				if (pm.total > 0) pmTotalDueCount += pm.total;
			}
		}

		return {
			total,
			p2hSudah: p2hSudahCount,
			p2hBelum: p2hBelumCount,
			pmOverdue: pmOverdueCount,
			pmTotalDue: pmTotalDueCount
		};
	});

	let groupedEquipment = $derived.by(() => {
		const groups: Record<string, any[]> = {};
		const q = searchQuery.toLowerCase().trim();

		for (const eq of equipmentList) {
			if (q) {
				const nameMatch = (eq.name || '').toLowerCase().includes(q);
				const codeMatch = (eq.code || '').toLowerCase().includes(q);
				if (!nameMatch && !codeMatch) continue;
			}

			const done = !!sessionMap[eq.id];
			const pm = pmMap[eq.id];
			if (statusFilter === 'P2H Sudah' && !done) continue;
			if (statusFilter === 'P2H Belum' && done) continue;
			if (statusFilter === 'PM Overdue' && (!pm || pm.overdue <= 0)) continue;

			const catName = eq.category_id && categoryMap[eq.category_id] ? categoryMap[eq.category_id] : 'Tidak Berkategori';
			
			if (selectedCategories.length > 0 && !selectedCategories.includes(catName)) {
				continue;
			}

			if (!groups[catName]) groups[catName] = [];
			groups[catName].push(eq);
		}

		return Object.entries(groups).map(([category, items]) => ({ category, items })).sort((a, b) => {
			const aIsKendaraan = a.category.toLowerCase().includes('kendaraan');
			const bIsKendaraan = b.category.toLowerCase().includes('kendaraan');
			if (aIsKendaraan && !bIsKendaraan) return -1;
			if (!aIsKendaraan && bIsKendaraan) return 1;
			return a.category.localeCompare(b.category);
		});
	});

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && roles.length > 0 && !hasPermission(roleId, 'input_preventive', roles)) {
			goto('/');
		}
	});

	async function loadData() {
		loading = true;
		try {
			equipmentList = await getOperatorEquipment();
			const ids = equipmentList.map((e) => e.id);
			const categoryIds = [...new Set(equipmentList.map(e => e.category_id).filter(Boolean))];
			[sessionMap, pmMap, categoryMap, ownershipMap] = await Promise.all([
				getTodaySessionsMap(ids, today),
				getPmDueCountsMap(ids),
				getEquipmentCategoriesMap(categoryIds),
				getAssetOwnershipSummaryBatch()
			]);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		loadSelectedCategories();
		loadData();
	});
</script>

<svelte:window onclick={(e) => {
	if (isCategoryDropdownOpen && dropdownRef && !dropdownRef.contains(e.target as Node)) {
		isCategoryDropdownOpen = false;
	}
}} />

<div class="scroll-body">
	<div class="max-w-7xl mx-auto p-4 md:p-6 pb-20">
		<!-- Header Halaman -->
		<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
			<div>
				<h1 class="text-xl md:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
					Ceklist Preventive
				</h1>
				<p class="text-[12px] md:text-[13px] text-slate-500 dark:text-slate-400 mt-0.5">
					Pilih unit untuk isi P2H harian atau selesaikan tugas PM jatuh tempo
				</p>
			</div>
			<div class="flex items-center gap-2">
				<button
					type="button"
					class="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-medium border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-2xs cursor-pointer"
					onclick={() => loadData()}
					title="Segarkan Data"
				>
					<IconRefresh size={14} class={loading ? "animate-spin text-blue-600" : "text-slate-500"} />
					<span>Segarkan</span>
				</button>
				<button
					type="button"
					class="shrink-0 px-3 py-2 rounded-lg text-[12px] font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-2xs cursor-pointer"
					onclick={() => goto('/preventive/audit-penempatan')}
				>
					Audit Penempatan
				</button>
			</div>
		</div>

		<SectionGuide
			id="preventive.daftar.page"
			title={h('daftar.page').sectionGuide?.title}
			steps={h('daftar.page').sectionGuide?.steps ?? []}
		/>

		<!-- Quick Metric KPI Filter Cards -->
		{#if !loading && equipmentList.length > 0}
			<div class="grid grid-cols-2 lg:grid-cols-4 gap-2.5 md:gap-3 mb-5 mt-2">
				<!-- Total Unit -->
				<button
					type="button"
					class="p-3.5 rounded-xl border text-left transition-all cursor-pointer {statusFilter === 'Semua' ? 'ring-2 ring-blue-500 border-blue-500 bg-blue-50/50 dark:bg-blue-950/30' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 shadow-2xs'}"
					onclick={() => statusFilter = 'Semua'}
				>
					<div class="flex items-center justify-between gap-1 mb-1.5">
						<span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Total Unit</span>
						<div class="w-6 h-6 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 flex items-center justify-center">
							<IconTool size={13} />
						</div>
					</div>
					<div class="flex items-baseline gap-2">
						<span class="text-xl md:text-2xl font-bold text-slate-900 dark:text-slate-100">{stats.total}</span>
						<span class="text-[11px] text-slate-400">Unit aktif</span>
					</div>
				</button>

				<!-- P2H Sudah -->
				<button
					type="button"
					class="p-3.5 rounded-xl border text-left transition-all cursor-pointer {statusFilter === 'P2H Sudah' ? 'ring-2 ring-emerald-500 border-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/30' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 shadow-2xs'}"
					onclick={() => statusFilter = statusFilter === 'P2H Sudah' ? 'Semua' : 'P2H Sudah'}
				>
					<div class="flex items-center justify-between gap-1 mb-1.5">
						<span class="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">P2H Selesai</span>
						<div class="w-6 h-6 rounded-md bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 flex items-center justify-center">
							<IconCircleCheck size={13} />
						</div>
					</div>
					<div class="flex items-baseline gap-2">
						<span class="text-xl md:text-2xl font-bold text-emerald-800 dark:text-emerald-300">{stats.p2hSudah}</span>
						<span class="text-[11px] text-emerald-700 dark:text-emerald-400">Hari ini</span>
					</div>
				</button>

				<!-- P2H Belum -->
				<button
					type="button"
					class="p-3.5 rounded-xl border text-left transition-all cursor-pointer {statusFilter === 'P2H Belum' ? 'ring-2 ring-amber-500 border-amber-500 bg-amber-50/50 dark:bg-amber-950/30' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 shadow-2xs'}"
					onclick={() => statusFilter = statusFilter === 'P2H Belum' ? 'Semua' : 'P2H Belum'}
				>
					<div class="flex items-center justify-between gap-1 mb-1.5">
						<span class="text-[11px] font-semibold text-amber-900 dark:text-amber-300">P2H Belum Diisi</span>
						<div class="w-6 h-6 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-400 flex items-center justify-center">
							<IconClock size={13} />
						</div>
					</div>
					<div class="flex items-baseline gap-2">
						<span class="text-xl md:text-2xl font-bold text-amber-900 dark:text-amber-300">{stats.p2hBelum}</span>
						<span class="text-[11px] text-amber-700 dark:text-amber-400">Perlu ceklist</span>
					</div>
				</button>

				<!-- PM Overdue -->
				<button
					type="button"
					class="p-3.5 rounded-xl border text-left transition-all cursor-pointer {statusFilter === 'PM Overdue' ? 'ring-2 ring-rose-500 border-rose-500 bg-rose-50/50 dark:bg-rose-950/30' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700 shadow-2xs'}"
					onclick={() => statusFilter = statusFilter === 'PM Overdue' ? 'Semua' : 'PM Overdue'}
				>
					<div class="flex items-center justify-between gap-1 mb-1.5">
						<span class="text-[11px] font-semibold text-rose-800 dark:text-rose-300">PM Overdue</span>
						<div class="w-6 h-6 rounded-md bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-400 flex items-center justify-center">
							<IconAlertTriangle size={13} />
						</div>
					</div>
					<div class="flex items-baseline gap-2">
						<span class="text-xl md:text-2xl font-bold text-rose-800 dark:text-rose-300">{stats.pmOverdue}</span>
						<span class="text-[11px] text-rose-700 dark:text-rose-400">Tugas jatuh tempo</span>
					</div>
				</button>
			</div>
		{/if}

		<!-- Filter & Pencarian Bar -->
		<div class="flex flex-col md:flex-row gap-3 mb-3">
			<div class="relative flex-1">
				<IconSearch size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
				<input 
					type="text" 
					placeholder="Cari nama atau kode unit..." 
					bind:value={searchQuery}
					class="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-[13px] md:text-[14px] outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all shadow-2xs"
				/>
				{#if searchQuery}
					<button 
						type="button" 
						class="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
						onclick={() => searchQuery = ''}
					>
						<IconX size={16} />
					</button>
				{/if}
			</div>
			
			<!-- Multi-select Kategori -->
			<div class="relative shrink-0" bind:this={dropdownRef}>
				<button 
					type="button"
					class="w-full md:w-auto px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 text-[13px] md:text-[14px] font-medium outline-none flex items-center justify-between gap-2.5 min-w-[170px] hover:border-slate-300 dark:hover:border-slate-600 transition-colors shadow-2xs cursor-pointer"
					onclick={() => isCategoryDropdownOpen = !isCategoryDropdownOpen}
				>
					<span class="truncate text-left flex-1">
						{#if selectedCategories.length === 0}
							Semua Kategori
						{:else if selectedCategories.length === 1}
							{selectedCategories[0]}
						{:else}
							{selectedCategories.length} Kategori Dipilih
						{/if}
					</span>
					<IconChevronDown size={16} class="text-slate-400 shrink-0" />
				</button>

				{#if isCategoryDropdownOpen}
					<div 
						class="absolute top-full right-0 md:left-0 mt-1.5 w-full md:w-68 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-20 max-h-64 overflow-y-auto bg-white dark:bg-slate-900 p-1.5"
					>
						<div class="flex items-center justify-between px-2.5 py-1.5 mb-1 border-b border-slate-100 dark:border-slate-800">
							<span class="text-[11px] font-bold uppercase text-slate-400">Filter Kategori</span>
							{#if selectedCategories.length > 0}
								<button 
									type="button" 
									class="text-[11px] text-blue-600 hover:text-blue-700 font-semibold cursor-pointer"
									onclick={selectAllCategories}
								>
									Reset
								</button>
							{/if}
						</div>
						{#each availableCategories as cat}
							<label class="flex items-center gap-2.5 px-2.5 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/80 rounded-lg cursor-pointer text-[13px] text-slate-800 dark:text-slate-200 transition-colors">
								<input 
									type="checkbox" 
									checked={selectedCategories.includes(cat)}
									onchange={() => toggleCategory(cat)}
									class="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-4 h-4 cursor-pointer"
								/>
								<span class="truncate flex-1 font-medium">{cat}</span>
							</label>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Filter Status P2H -->
			<select
				bind:value={statusFilter}
				class="px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 text-[13px] md:text-[14px] font-medium outline-none shrink-0 cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 transition-colors shadow-2xs"
			>
				<option value="Semua">Semua Status P2H</option>
				<option value="P2H Belum">P2H Belum</option>
				<option value="P2H Sudah">P2H Sudah</option>
				<option value="PM Overdue">PM Overdue Saja</option>
			</select>
		</div>

		<div class="mb-4 space-y-2">
			<FieldHint text={h('daftar.form.statusFilter').fieldHint} />
			{#if showAlatUkurHint}
				<FieldHint text={h('daftar.form.alatUkur').fieldHint} type={h('daftar.form.alatUkur').type} />
			{/if}
		</div>

		{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data unit & status P2H..." />
		</div>
		{:else if equipmentList.length === 0}
			<EmptyStateGuide
				message={h('daftar.empty').message}
				hints={h('daftar.empty').hints ?? []}
			/>
		{:else if groupedEquipment.length === 0}
			<div class="text-center py-16 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-6">
				<IconTool size={36} class="mx-auto text-slate-400 mb-2" />
				<h3 class="text-[15px] font-bold text-slate-800 dark:text-slate-200">Tidak ada unit yang sesuai</h3>
				<p class="text-[13px] text-slate-500 mt-1">Coba sesuaikan kata kunci pencarian atau reset filter kategori/status.</p>
				<button 
					type="button" 
					class="mt-3 px-4 py-2 rounded-lg bg-blue-600 text-white text-[12px] font-semibold hover:bg-blue-700 transition-colors cursor-pointer"
					onclick={() => { searchQuery = ''; statusFilter = 'Semua'; selectedCategories = []; }}
				>
					Reset Semua Filter
				</button>
			</div>
		{:else}
			<!-- Daftar Grup Kategori Unit -->
			<div class="flex flex-col gap-4">
				{#each groupedEquipment as group}
					{@const isCollapsed = !!collapsedCategories[group.category]}
					<div class="space-y-2">
						<!-- Accordion Header Kategori -->
						<button
							type="button"
							class="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/90 hover:bg-slate-100/90 dark:bg-slate-800/60 dark:hover:bg-slate-800/90 transition-all text-left group cursor-pointer shadow-2xs"
							onclick={() => collapsedCategories[group.category] = !collapsedCategories[group.category]}
						>
							<div class="flex items-center gap-2.5 min-w-0">
								<div class="text-slate-400 group-hover:text-blue-600 transition-colors">
									{#if isCollapsed}
										<IconChevronRight size={18} />
									{:else}
										<IconChevronDown size={18} />
									{/if}
								</div>
								<span class="font-bold text-[13px] md:text-[14px] text-slate-800 dark:text-slate-100 truncate">{group.category}</span>
								<span class="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-100/80 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border border-blue-200/60 dark:border-blue-800">
									{group.items.length} Unit
								</span>
							</div>
							<div class="flex items-center gap-2 text-[11px] text-slate-400 font-medium">
								{#if isCollapsed}
									<span class="hidden sm:inline">Buka</span>
								{/if}
							</div>
						</button>

						{#if !isCollapsed}
							<!-- Tampilan Kartu (Mobile) -->
							<div class="flex flex-col gap-2.5 md:hidden">
								{#each group.items as eq (eq.id)}
									{@const done = !!sessionMap[eq.id]}
									{@const pm = pmMap[eq.id]}
									{@const cond = conditionBadge(eq.status_operational)}
									{@const own = ownershipMap.get(eq.id)}
									<div class="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900 shadow-2xs space-y-3">
										<div class="flex items-start justify-between gap-2">
											<div class="flex items-start gap-2.5 min-w-0">
												<div class="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/70 border border-blue-100 dark:border-blue-800/60 flex items-center justify-center shrink-0 text-blue-600 dark:text-blue-400 mt-0.5">
													<IconTool size={16} />
												</div>
												<div class="min-w-0">
													<p class="text-[13px] font-bold text-slate-900 dark:text-slate-100 leading-snug truncate">{eq.name}</p>
													<span class="font-mono text-[11px] font-medium text-slate-500 dark:text-slate-400 mt-0.5 block">
														{eq.code || '-'}
													</span>
												</div>
											</div>
										</div>

										<div class="flex flex-wrap items-center gap-1.5 pt-1">
											<!-- Status P2H -->
											{#if done}
												<span class="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200/90 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800 shadow-2xs">
													<IconCircleCheck size={14} class="text-emerald-600 dark:text-emerald-400 shrink-0" />
													<span>P2H Sudah {#if sessionMap[eq.id]?.operator?.name}<span class="font-normal text-emerald-700 dark:text-emerald-300/90">({sessionMap[eq.id].operator.name})</span>{/if}</span>
												</span>
											{:else}
												<span class="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-900 border border-amber-200/90 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800 shadow-2xs">
													<span class="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>
													<span>P2H Belum</span>
												</span>
											{/if}

											<!-- Status PM -->
											{#if pm && pm.total > 0}
												<span
													class="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full shadow-2xs {pm.overdue > 0 ? 'bg-rose-50 text-rose-800 border border-rose-200/90 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800' : 'bg-indigo-50 text-indigo-800 border border-indigo-200/90 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800'}"
												>
													{#if pm.overdue > 0}
														<IconAlertTriangle size={13} class="text-rose-600 dark:text-rose-400 shrink-0" />
														<span>{pm.overdue} PM overdue</span>
													{:else}
														<IconClock size={13} class="text-indigo-600 dark:text-indigo-400 shrink-0" />
														<span>{pm.total} PM jatuh tempo</span>
													{/if}
												</span>
											{/if}

											<!-- Kondisi Operasional -->
											{#if cond}
												<StatusExplainer status={cond.label ?? ''} explain={h('daftar.status.kondisi').explain}>
													<span class="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full {cond.badgeClass} shadow-2xs">
														<span class="w-1.5 h-1.5 rounded-full {cond.dotClass} shrink-0"></span>
														<span>{cond.label}</span>
													</span>
												</StatusExplainer>
											{/if}

											<!-- Hour Meter -->
											{#if eq.last_hoursmeter != null}
												<span class="inline-flex items-center gap-1 font-mono text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
													<IconGauge size={12} class="text-slate-400 shrink-0" />
													<span>HM {formatHM(eq.last_hoursmeter)}</span>
												</span>
											{/if}

											<!-- Beban Perawatan (Fase 6.3) -->
											{#if own}
												<span
													class="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md border {own.statusLevel === 'kritis' ? 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800' : own.statusLevel === 'peringatan' ? 'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800' : 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'}"
													title="Diperbaiki {own.woCount}× — beban perawatan {own.rasioPct.toFixed(1)}% dari nilai beli"
												>
													<span>{own.statusLevel === 'kritis' ? '🔴' : own.statusLevel === 'peringatan' ? '🟡' : '🟢'} {own.woCount}× · {own.rasioPct.toFixed(0)}%</span>
												</span>
											{/if}
										</div>

										<!-- Tombol Aksi Mobile -->
										<div class="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
											<button
												type="button"
												class="flex-1 h-9 rounded-lg text-[12px] font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.98] transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
												onclick={() => goto(`/preventive/p2h/${eq.id}`)}
											>
												<span>Isi P2H</span>
											</button>
											{#if pm && pm.total > 0}
												<button
													type="button"
													class="flex-1 h-9 rounded-lg text-[12px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
													onclick={() => goto(`/preventive/pm/${eq.id}`)}
												>
													<span>Tugas PM</span>
												</button>
											{/if}
											<button
												type="button"
												class="h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors shadow-2xs flex items-center justify-center cursor-pointer"
												onclick={() => openQuickHm(eq)}
												title="Quick Log HM"
											>
												<IconGauge size={15} />
											</button>
											<button
												type="button"
												class="h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors shadow-2xs flex items-center justify-center cursor-pointer"
												onclick={() => goto(`/preventive/riwayat/${eq.id}`)}
												title="Riwayat Timeline"
											>
												<IconClock size={15} />
											</button>
											<button
												type="button"
												class="h-9 px-2.5 rounded-lg border border-rose-200 dark:border-rose-800 bg-white dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 transition-colors shadow-2xs flex items-center justify-center cursor-pointer"
												onclick={() => goto(`/maintenance/survey/baru?equipment_id=${eq.id}`)}
												title="Lapor Kerusakan"
											>
												<IconAlertTriangle size={15} />
											</button>
										</div>
									</div>
								{/each}
							</div>

							<!-- Tampilan Tabel (Desktop md+) -->
							<div class="hidden md:block w-full overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs">
								<table class="w-full text-left border-collapse">
									<thead>
										<tr class="border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/60">
											<th class="px-4 py-3 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Nama Unit</th>
											<th class="px-4 py-3 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Kode Unit</th>
											<th class="px-4 py-3 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-center">Status P2H</th>
											<th class="px-4 py-3 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-center">Status PM</th>
											<th class="px-4 py-3 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-center">Kondisi / HM</th>
											<th class="px-4 py-3 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-center">Beban Perawatan</th>
											<th class="px-4 py-3 text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-center min-w-[200px]">Aksi</th>
										</tr>
									</thead>
									<tbody class="divide-y divide-slate-100 dark:divide-slate-800">
										{#each group.items as eq (eq.id)}
											{@const done = !!sessionMap[eq.id]}
											{@const pm = pmMap[eq.id]}
											{@const cond = conditionBadge(eq.status_operational)}
											{@const own = ownershipMap.get(eq.id)}
											<tr class="hover:bg-blue-50/30 dark:hover:bg-slate-800/40 transition-colors">
												<!-- Nama Unit -->
												<td class="px-4 py-3">
													<div class="flex items-center gap-3">
														<div class="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/70 border border-blue-100 dark:border-blue-800/60 flex items-center justify-center shrink-0 text-blue-600 dark:text-blue-400">
															<IconTool size={16} />
														</div>
														<div class="min-w-0">
															<p class="text-[13px] font-bold text-slate-900 dark:text-slate-100 leading-snug truncate max-w-xs">{eq.name}</p>
														</div>
													</div>
												</td>

												<!-- Kode Unit -->
												<td class="px-4 py-3 whitespace-nowrap">
													<span class="font-mono text-[11px] font-medium px-2 py-1 rounded-md bg-slate-100/90 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/80">
														{eq.code || '-'}
													</span>
												</td>

												<!-- Status P2H -->
												<td class="px-4 py-3 text-center whitespace-nowrap">
													{#if done}
														<span class="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200/90 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800 shadow-2xs">
															<IconCircleCheck size={14} class="text-emerald-600 dark:text-emerald-400 shrink-0" />
															<span>P2H Sudah {#if sessionMap[eq.id]?.operator?.name}<span class="font-normal text-emerald-700 dark:text-emerald-300/90">({sessionMap[eq.id].operator.name})</span>{/if}</span>
														</span>
													{:else}
														<span class="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-amber-50 text-amber-900 border border-amber-200/90 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800 shadow-2xs">
															<span class="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0"></span>
															<span>P2H Belum</span>
														</span>
													{/if}
												</td>

												<!-- Status PM -->
												<td class="px-4 py-3 text-center whitespace-nowrap">
													{#if pm && pm.total > 0}
														<span
															class="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full shadow-2xs {pm.overdue > 0 ? 'bg-rose-50 text-rose-800 border border-rose-200/90 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800' : 'bg-indigo-50 text-indigo-800 border border-indigo-200/90 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800'}"
														>
															{#if pm.overdue > 0}
																<IconAlertTriangle size={13} class="text-rose-600 dark:text-rose-400 shrink-0" />
																<span>{pm.overdue} PM overdue</span>
															{:else}
																<IconClock size={13} class="text-indigo-600 dark:text-indigo-400 shrink-0" />
																<span>{pm.total} PM jatuh tempo</span>
															{/if}
														</span>
													{:else}
														<span class="text-[12px] font-medium text-slate-300 dark:text-slate-600 select-none">-</span>
													{/if}
												</td>

												<!-- Kondisi / HM -->
												<td class="px-4 py-3 text-center whitespace-nowrap">
													<div class="flex items-center justify-center gap-1.5 flex-wrap">
														{#if cond}
															<StatusExplainer status={cond.label ?? ''} explain={h('daftar.status.kondisi').explain}>
																<span class="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-full {cond.badgeClass} shadow-2xs">
																	<span class="w-1.5 h-1.5 rounded-full {cond.dotClass} shrink-0"></span>
																	<span>{cond.label}</span>
																</span>
															</StatusExplainer>
														{/if}
														{#if eq.last_hoursmeter != null}
															<span class="inline-flex items-center gap-1 font-mono text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700" title="Hour Meter Terakhir">
																<IconGauge size={12} class="text-slate-400 shrink-0" />
																<span>{formatHM(eq.last_hoursmeter)}</span>
															</span>
														{/if}
													</div>
												</td>

												<!-- Beban Perawatan (Fase 6.3) -->
												<td class="px-4 py-3 text-center whitespace-nowrap">
													{#if own}
														<span
															class="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border {own.statusLevel === 'kritis' ? 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800' : own.statusLevel === 'peringatan' ? 'bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800' : 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'}"
															title="Total biaya perbaikan {own.totalBiaya.toLocaleString('id-ID')} dari nilai beli"
														>
															{own.statusLevel === 'kritis' ? '🔴' : own.statusLevel === 'peringatan' ? '🟡' : '🟢'} {own.woCount}× · {own.rasioPct.toFixed(0)}%
														</span>
													{:else}
														<span class="text-[12px] font-medium text-slate-300 dark:text-slate-600 select-none">-</span>
													{/if}
												</td>

												<!-- Aksi -->
												<td class="px-4 py-3 whitespace-nowrap text-center">
													<div class="flex items-center justify-center gap-1.5">
														<button
															type="button"
															class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.98] transition-all shadow-xs cursor-pointer"
															onclick={() => goto(`/preventive/p2h/${eq.id}`)}
														>
															<span>Isi P2H</span>
														</button>
														{#if pm && pm.total > 0}
															<button
																type="button"
																class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-[0.98] transition-all shadow-xs cursor-pointer"
																onclick={() => goto(`/preventive/pm/${eq.id}`)}
															>
																<span>Tugas PM</span>
															</button>
														{/if}
														<button
															type="button"
															class="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors shadow-2xs cursor-pointer"
															onclick={() => openQuickHm(eq)}
															title="Quick Log Hour Meter"
														>
															<IconGauge size={15} />
														</button>
														<button
															type="button"
															class="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors shadow-2xs cursor-pointer"
															onclick={() => goto(`/preventive/riwayat/${eq.id}`)}
															title="Lihat Riwayat & Timeline Unit"
														>
															<IconClock size={15} />
														</button>
														<button
															type="button"
															class="p-1.5 rounded-lg border border-rose-200 dark:border-rose-800 bg-white dark:bg-slate-800 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600 dark:text-rose-400 transition-colors shadow-2xs cursor-pointer"
															onclick={() => goto(`/maintenance/survey/baru?equipment_id=${eq.id}`)}
															title="Lapor Kerusakan"
														>
															<IconAlertTriangle size={15} />
														</button>
													</div>
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- Modal Quick Log Hour Meter -->
	{#if quickHmEquipment}
		<div 
			class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs transition-opacity" 
			onclick={() => (quickHmEquipment = null)}
		>
			<div 
				class="w-full max-w-sm rounded-2xl p-5 md:p-6 space-y-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl" 
				onclick={(e) => e.stopPropagation()}
			>
				<div class="flex items-start justify-between gap-2">
					<div>
						<h3 class="text-[16px] font-bold text-slate-900 dark:text-slate-100">Quick Log Hour Meter</h3>
						<p class="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">
							{quickHmEquipment.name} <span class="font-mono">({quickHmEquipment.code || '-'})</span>
						</p>
					</div>
					<button
						type="button"
						class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg cursor-pointer"
						onclick={() => (quickHmEquipment = null)}
					>
						<IconX size={18} />
					</button>
				</div>

				{#if quickHmError}
					<div class="text-[12px] px-3 py-2 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800">
						{quickHmError}
					</div>
				{/if}

				<div>
					<label for="quick-hm-input" class="text-[12px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5 block">
						Hour Meter Terakhir: <span class="font-mono text-blue-600 dark:text-blue-400">{formatHM(quickHmEquipment.last_hoursmeter)}</span>
					</label>
					<div class="relative">
						<IconGauge size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
						<input
							id="quick-hm-input"
							type="number"
							min="0"
							step="any"
							bind:value={quickHmValue}
							placeholder="Masukkan nilai HM baru"
							class="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-[14px] outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-mono"
						/>
					</div>
				</div>

				<div class="flex gap-2.5 pt-2">
					<button
						type="button"
						class="flex-1 h-10 rounded-xl text-[13px] font-semibold border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
						onclick={() => (quickHmEquipment = null)}
						disabled={quickHmSubmitting}
					>
						Batal
					</button>
					<button
						type="button"
						class="flex-1 h-10 rounded-xl text-[13px] font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
						onclick={submitQuickHmForm}
						disabled={quickHmSubmitting}
					>
						{#if quickHmSubmitting}
							<IconLoader2 size={16} class="animate-spin" />
							<span>Menyimpan…</span>
						{:else}
							<span>Simpan HM</span>
						{/if}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>
