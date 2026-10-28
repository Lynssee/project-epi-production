<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		IconList,
		IconReceipt2,
		IconChevronRight,
		IconPackage,
		IconTools,
		IconLoader2,
		IconExternalLink,
		IconShoppingCart,
		IconTruckDelivery,
		IconFileCheck,
		IconClock,
		IconBuildingStore
	} from '@tabler/icons-svelte';
	import { onMount } from 'svelte';
	import { getPengajuanAnggaran } from '$lib/services/finance';
	import { fetchProjectProcurementHistory, type ProjectProcurementItem } from '$lib/services/procurementApi';
	import FilterSort from '$lib/components/FilterSort.svelte';
	import InfiniteScroll from '$lib/components/InfiniteScroll.svelte';
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { getBudgetStatusLabel, getBudgetStatusBadgeClass } from '$lib/constants/status';

	let { projectId, projectName } = $props<{ projectId: string | number | null; projectName?: string }>();

	let activeTab = $state<'pa' | 'procurement'>('pa');

	// State PA Kasbon
	let budgets = $state<any[]>([]);
	let loading = $state(true);
	let loadingMore = $state(false);
	let hasMore = $state(true);

	let limit = 10;
	let offset = 0;

	let searchQuery = $state('');
	let sortOption = $state('-date_created');
	let activeFilter = $state(''); // '' means 'semua'
	let expandedId = $state<string | number | null>(null);

	// State Pengadaan Pusat (PR & PO)
	let procurementList = $state<ProjectProcurementItem[]>([]);
	let loadingProcurement = $state(false);
	let expandedPrId = $state<string | number | null>(null);

	const sortOptions = [
		{ value: '-date_created', label: 'Paling Baru' },
		{ value: 'date_created', label: 'Paling Lama' },
		{ value: '-total_amount', label: 'Nominal Tertinggi' },
		{ value: 'total_amount', label: 'Nominal Terendah' }
	];

	const filterOptions = [
		{ value: 'menunggu', label: 'Menunggu' },
		{ value: 'disetujui', label: 'Disetujui' },
		{ value: 'ditolak', label: 'Ditolak' },
		{ value: 'dibayarkan', label: 'Dibayarkan' }
	];

	// Re-fetch when projectId changes
	$effect(() => {
		if (projectId !== undefined) {
			loadInitialBudgets();
			loadProcurementHistory();
		}
	});

	async function loadInitialBudgets() {
		loading = true;
		await fetchBudgets(false);
		loading = false;
	}

	async function loadProcurementHistory() {
		if (!projectId) {
			procurementList = [];
			return;
		}
		loadingProcurement = true;
		try {
			procurementList = await fetchProjectProcurementHistory(projectId);
		} catch (e) {
			console.error('Gagal memuat riwayat pengadaan:', e);
		} finally {
			loadingProcurement = false;
		}
	}

	async function fetchBudgets(isLoadMore = false) {
		if (!projectId) {
			budgets = [];
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
			const options: any = {
				limit,
				offset,
				search: searchQuery,
				sort: sortOption,
				filterStatus: activeFilter,
				projectIds: [projectId]
			};

			const newBudgets = await getPengajuanAnggaran(limit, options);

			if (newBudgets.length < limit) {
				hasMore = false;
			}

			if (isLoadMore) {
				budgets = [...budgets, ...newBudgets];
			} else {
				budgets = newBudgets;
			}
			offset += limit;
		} catch (error) {
			console.error('Gagal memuat pengajuan:', error);
		} finally {
			loadingMore = false;
		}
	}

	function handleFilterSortSearch() {
		fetchBudgets(false);
	}

	const getStatusLabel = getBudgetStatusLabel;
	const getStatusBadgeClass = getBudgetStatusBadgeClass;

	function formatCurrencyFull(val: number) {
		return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(val || 0);
	}

	function toggleExpand(id: string | number) {
		if (expandedId === id) {
			expandedId = null;
		} else {
			expandedId = id;
		}
	}

	function toggleExpandPr(id: string | number) {
		if (expandedPrId === id) {
			expandedPrId = null;
		} else {
			expandedPrId = id;
		}
	}

	// Filter & search untuk pengadaan pusat
	let filteredProcurement = $derived(() => {
		let list = [...procurementList];
		if (searchQuery && searchQuery.trim() !== '') {
			const q = searchQuery.toLowerCase().trim();
			list = list.filter((p) => {
				const no = (p.pr_number || '').toLowerCase();
				const tuj = (p.tujuan || '').toLowerCase();
				const app = (p.nama_pengaju || '').toLowerCase();
				const pos = (p.pos || []).some((po) => (po.po_number || '').toLowerCase().includes(q) || (po.supplier_name || '').toLowerCase().includes(q));
				const itemsMatch = (p.items || []).some((it) => (it.nama_barang || '').toLowerCase().includes(q));
				return no.includes(q) || tuj.includes(q) || app.includes(q) || pos || itemsMatch;
			});
		}
		return list;
	});
</script>

<div class="mt-2">
	<!-- List Header -->
	<div class="flex items-center justify-between mb-3">
		<div class="text-xs font-extrabold text-gray-800 dark:text-gray-200 tracking-wider uppercase flex items-center gap-2">
			<IconList size={16} class="text-blue-500" /> RIWAYAT PENGAJUAN &amp; PENGADAAN PROYEK
		</div>
	</div>

	<!-- Channel Switcher Tabs -->
	<div class="flex items-center gap-2 mb-3.5 border-b border-gray-200/80 dark:border-[#2B3844] pb-2.5">
		<button
			type="button"
			class="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer {activeTab === 'pa' ? 'bg-blue-600 text-white shadow-xs' : 'bg-gray-100 dark:bg-[#18232F] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#232F3B]'}"
			onclick={() => (activeTab = 'pa')}
		>
			<IconReceipt2 size={15} />
			<span>Pengajuan Anggaran / Kasbon</span>
			<span class="text-[10px] px-1.5 py-0.2 rounded-full {activeTab === 'pa' ? 'bg-blue-700 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}">{budgets.length}</span>
		</button>
		<button
			type="button"
			class="px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer {activeTab === 'procurement' ? 'bg-blue-600 text-white shadow-xs' : 'bg-gray-100 dark:bg-[#18232F] text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-[#232F3B]'}"
			onclick={() => (activeTab = 'procurement')}
		>
			<IconShoppingCart size={15} />
			<span>Pengadaan Pusat (PR &amp; PO)</span>
			<span class="text-[10px] px-1.5 py-0.2 rounded-full {activeTab === 'procurement' ? 'bg-blue-700 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300'}">{procurementList.length}</span>
		</button>
	</div>

	<!-- Filter & Search Toolbar -->
	<div class="mb-4">
		{#if activeTab === 'pa'}
			<FilterSort 
				bind:searchQuery
				bind:sortOption
				bind:filterOption={activeFilter}
				{sortOptions}
				{filterOptions}
				placeholder="Cari pengajuan kasbon..."
				onSearch={handleFilterSortSearch}
				onSortChange={handleFilterSortSearch}
				onFilterChange={handleFilterSortSearch}
			/>
		{:else}
			<div class="relative">
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Cari no. PR, PO, vendor, atau nama barang/jasa..."
					class="w-full text-xs px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-[#2B3844] bg-white dark:bg-[#121A22] text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-2 focus:ring-blue-500"
				/>
			</div>
		{/if}
	</div>

	<!-- TAB 1: PENGAJUAN ANGGARAN (PA KASBON) -->
	{#if activeTab === 'pa'}
		{#if loading}
			<div class="py-6">
				<CircularProgressGauge
					compact={true}
					stepLabel="Memuat riwayat pengajuan anggaran..."
					subLabel="Mengambil data pengajuan Directus SSOT"
				/>
			</div>
		{:else if budgets.length === 0}
			<div class="text-center py-10 text-gray-400 dark:text-gray-500 text-xs bg-gray-50/50 dark:bg-[#121A22] rounded-xl border border-dashed border-gray-200 dark:border-[#2B3844]">
				{#if searchQuery || activeFilter}
					Tidak ada pengajuan yang cocok dengan filter.
				{:else}
					Belum ada riwayat pengajuan anggaran untuk proyek ini.
				{/if}
			</div>
		{:else}
			<div class="space-y-2.5">
				{#each budgets as budget}
					<div class="border border-gray-200/80 dark:border-[#2B3844] rounded-xl bg-white dark:bg-[#121A22] hover:border-gray-300 dark:hover:border-gray-600 transition-all overflow-hidden shadow-2xs">
						<button
							type="button"
							class="w-full p-3.5 cursor-pointer flex items-center gap-3 text-left transition-colors hover:bg-gray-50/60 dark:hover:bg-[#18232F]"
							onclick={() => toggleExpand(budget.id)}
						>
							<div class="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 border border-blue-500/20">
								{#if budget.kategori === 'material'}
									<IconPackage size={20} />
								{:else if budget.kategori === 'alat'}
									<IconTools size={20} />
								{:else}
									<IconReceipt2 size={20} />
								{/if}
							</div>
							<div class="flex-1 min-w-0">
								<p class="text-xs font-bold text-gray-900 dark:text-white truncate">{budget.tujuan_pengajuan || 'Keuangan'}</p>
								<p class="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{new Intl.DateTimeFormat('id-ID', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(budget.date_created))}</p>
								<p class="text-xs font-extrabold text-blue-600 dark:text-blue-400 mt-1">{formatCurrencyFull(budget.total_amount || 0)}</p>
							</div>
							<div class="flex flex-col items-end gap-2 shrink-0">
								<span class="text-[10px] font-bold px-2.5 py-0.5 rounded-full border {getStatusBadgeClass(budget.status)}">
									{getStatusLabel(budget.status)}
								</span>
								<IconChevronRight size={16} class="text-gray-400 dark:text-gray-500 transition-transform duration-200 {expandedId === budget.id ? 'rotate-90 text-blue-500' : ''}" />
							</div>
						</button>
						
						{#if expandedId === budget.id}
							<div class="px-4 pb-4 border-t border-gray-100 dark:border-[#2B3844] bg-gray-50/50 dark:bg-[#18232F]/50 pt-3 text-xs">
								<div class="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-3.5 text-gray-700 dark:text-gray-300">
									<div>
										<span class="text-gray-400 dark:text-gray-500 block text-[10px] font-bold uppercase tracking-wider">No. Pengajuan</span>
										<span class="font-semibold">{budget.nomor_pengajuan || '-'}</span>
									</div>
									<div>
										<span class="text-gray-400 dark:text-gray-500 block text-[10px] font-bold uppercase tracking-wider">Proyek</span>
										<span class="font-semibold truncate block">{projectName || '-'}</span>
									</div>
									<div>
										<span class="text-gray-400 dark:text-gray-500 block text-[10px] font-bold uppercase tracking-wider">Pengaju</span>
										<span class="font-semibold">{budget.nama_pengaju || '-'}</span>
									</div>
									<div>
										<span class="text-gray-400 dark:text-gray-500 block text-[10px] font-bold uppercase tracking-wider">Departemen</span>
										<span class="font-semibold">{budget.department || '-'}</span>
									</div>
									<div>
										<span class="text-gray-400 dark:text-gray-500 block text-[10px] font-bold uppercase tracking-wider">Kategori</span>
										<span class="font-semibold capitalize">{budget.kategori || '-'}</span>
									</div>
									<div>
										<span class="text-gray-400 dark:text-gray-500 block text-[10px] font-bold uppercase tracking-wider">Status</span>
										<span class="font-semibold capitalize">{getStatusLabel(budget.status) || '-'}</span>
									</div>
								</div>
								
								<button 
									type="button"
									class="w-full py-2 bg-blue-500/10 hover:bg-blue-500 text-blue-600 dark:text-blue-400 hover:text-white border border-blue-500/20 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-98" 
									onclick={() => goto(`/anggaran/${budget.id}`)}
								>
									<IconExternalLink size={14} /> Lihat Detail Pengajuan
								</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>

			<InfiniteScroll {hasMore} loading={loadingMore} onloadmore={() => fetchBudgets(true)} />
		{/if}

	<!-- TAB 2: PENGADAAN PUSAT (PR & PO SUPPLIER) -->
	{:else}
		{#if loadingProcurement}
			<div class="py-6">
				<CircularProgressGauge
					compact={true}
					stepLabel="Memuat riwayat pengadaan material..."
					subLabel="Mengambil data purchase request Directus"
				/>
			</div>
		{:else if filteredProcurement().length === 0}
			<div class="text-center py-10 text-gray-400 dark:text-gray-500 text-xs bg-gray-50/50 dark:bg-[#121A22] rounded-xl border border-dashed border-gray-200 dark:border-[#2B3844]">
				{#if searchQuery}
					Tidak ada pengadaan PR/PO yang cocok dengan pencarian.
				{:else}
					Belum ada Purchase Request (PR) atau PO Pengadaan untuk proyek ini.
				{/if}
			</div>
		{:else}
			<div class="space-y-2.5">
				{#each filteredProcurement() as pr}
					<div class="border border-gray-200/80 dark:border-[#2B3844] rounded-xl bg-white dark:bg-[#121A22] hover:border-gray-300 dark:hover:border-gray-600 transition-all overflow-hidden shadow-2xs">
						<button
							type="button"
							class="w-full p-3.5 cursor-pointer flex items-center gap-3 text-left transition-colors hover:bg-gray-50/60 dark:hover:bg-[#18232F]"
							onclick={() => toggleExpandPr(pr.id)}
						>
							<div class="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/20">
								{#if pr.pos && pr.pos.length > 0}
									<IconTruckDelivery size={20} />
								{:else}
									<IconShoppingCart size={20} />
								{/if}
							</div>
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2">
									<p class="text-xs font-bold text-gray-900 dark:text-white truncate">{pr.pr_number}</p>
									{#if pr.pos && pr.pos.length > 0}
										<span class="text-[10px] font-mono px-1.5 py-0.2 rounded bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
											{pr.pos.map((p) => p.po_number).join(', ')}
										</span>
									{/if}
								</div>
								<p class="text-[11px] text-gray-600 dark:text-gray-300 font-medium truncate mt-0.5">{pr.tujuan || pr.items.map((i) => i.nama_barang).slice(0, 2).join(', ') || 'Pengadaan Pusat'}</p>
								<div class="flex items-center gap-2 mt-1">
									<span class="text-xs font-extrabold text-emerald-600 dark:text-emerald-400">{formatCurrencyFull(pr.total_amount || 0)}</span>
									{#if pr.received_amount > 0 && pr.received_amount < pr.total_amount}
										<span class="text-[10px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-1.5 py-0.2 rounded border border-emerald-200">
											Diterima: {formatCurrencyFull(pr.received_amount)}
										</span>
									{/if}
								</div>
							</div>
							<div class="flex flex-col items-end gap-1.5 shrink-0">
								<span class="text-[10px] font-bold px-2 py-0.5 rounded-full border {pr.badge_class}">
									{pr.status_label}
								</span>
								<IconChevronRight size={16} class="text-gray-400 dark:text-gray-500 transition-transform duration-200 {expandedPrId === pr.id ? 'rotate-90 text-blue-500' : ''}" />
							</div>
						</button>

						{#if expandedPrId === pr.id}
							<div class="px-4 pb-4 border-t border-gray-100 dark:border-[#2B3844] bg-gray-50/50 dark:bg-[#18232F]/50 pt-3 text-xs space-y-3">
								<!-- Rincian PR Header -->
								<div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-gray-700 dark:text-gray-300">
									<div>
										<span class="text-gray-400 dark:text-gray-500 block text-[10px] font-bold uppercase tracking-wider">Pengaju</span>
										<span class="font-semibold">{pr.nama_pengaju || '-'}</span>
									</div>
									<div>
										<span class="text-gray-400 dark:text-gray-500 block text-[10px] font-bold uppercase tracking-wider">Tanggal</span>
										<span class="font-semibold">{pr.date_created ? new Intl.DateTimeFormat('id-ID', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(pr.date_created)) : '-'}</span>
									</div>
									<div>
										<span class="text-gray-400 dark:text-gray-500 block text-[10px] font-bold uppercase tracking-wider">Kategori RAP</span>
										<span class="font-semibold capitalize">{pr.kategori_pembelian || (pr.is_non_stock ? 'Jasa/Non-stok' : 'Material')}</span>
									</div>
									<div>
										<span class="text-gray-400 dark:text-gray-500 block text-[10px] font-bold uppercase tracking-wider">Status PR</span>
										<span class="font-semibold">{pr.status || '-'}</span>
									</div>
								</div>

								<!-- Rincian Item Barang / Jasa -->
								<div>
									<span class="text-gray-500 dark:text-gray-400 block text-[10px] font-bold uppercase tracking-wider mb-1.5">Item Barang / Jasa</span>
									<div class="space-y-1 bg-white dark:bg-[#121A22] rounded-lg border border-gray-200/80 dark:border-[#2B3844] p-2.5">
										{#each pr.items as it}
											<div class="flex items-center justify-between py-1 border-b last:border-b-0 border-gray-100 dark:border-gray-800 text-[11px]">
												<span class="font-medium text-gray-900 dark:text-gray-100">{it.nama_barang}</span>
												<div class="flex items-center gap-2">
													<span class="text-gray-500">{it.quantity} {it.units || 'unit'}</span>
													{#if it.harga}
														<span class="font-mono text-gray-700 dark:text-gray-300">@ {formatCurrencyFull(it.harga)}</span>
													{/if}
												</div>
											</div>
										{/each}
									</div>
								</div>

								<!-- Rincian PO Supplier Terkait -->
								{#if pr.pos && pr.pos.length > 0}
									<div>
										<span class="text-gray-500 dark:text-gray-400 block text-[10px] font-bold uppercase tracking-wider mb-1.5 flex items-center gap-1">
											<IconBuildingStore size={13} /> Purchase Order Supplier (Procurement)
										</span>
										<div class="space-y-2">
											{#each pr.pos as po}
												<div class="p-2.5 bg-sky-50/70 dark:bg-sky-950/30 rounded-lg border border-sky-200/80 dark:border-sky-800/60 space-y-1.5">
													<div class="flex items-center justify-between text-xs font-bold text-sky-950 dark:text-sky-200">
														<span>{po.po_number} — {po.supplier_name || 'Vendor'}</span>
														<span class="text-[10px] font-mono px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-900/60 border border-sky-300 dark:border-sky-700">
															{po.status === 'draft' ? 'Draft (Menunggu Kirim)' : po.status === 'sent' ? 'Terkirim ke Vendor' : po.status}
														</span>
													</div>
													{#if po.items && po.items.length > 0}
														<div class="text-[11px] text-gray-600 dark:text-gray-300 space-y-0.5 pt-1">
															{#each po.items as poi}
																<div class="flex items-center justify-between">
																	<span>• {poi.item_name}</span>
																	<span>Diterima: <b class="{poi.received_qty > 0 ? 'text-emerald-600 font-bold' : 'text-gray-500'}">{poi.received_qty || 0}</b> / {poi.quantity} {poi.unit || ''}</span>
																</div>
															{/each}
														</div>
													{/if}
												</div>
											{/each}
										</div>
									</div>
								{:else}
									<div class="p-2.5 bg-gray-100/70 dark:bg-gray-800/40 rounded-lg text-gray-500 text-[11px] text-center">
										⏳ Belum diterbitkan PO Supplier oleh tim Procurement Pusat.
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
