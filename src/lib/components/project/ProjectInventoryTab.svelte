<script lang="ts">
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import {
		getProjectInventory,
		getProjectInventoryLogs,
		getSuratJalanListForProject,
		recordProjectStockMovement,
		type ProjectStockItem,
		type ProjectStockTransaction,
		type InventoryCategory,
		type ConditionStatus,
		type SuratJalanOption
	} from '$lib/services/projectStockInventoryApi';
	import {
		IconPackage,
		IconPlus,
		IconMinus,
		IconSearch,
		IconLoader2,
		IconCheck,
		IconAlertTriangle,
		IconFileText,
		IconArrowUpRight,
		IconArrowDownLeft,
		IconFilter,
		IconTool,
		IconBox,
		IconSparkles,
		IconHistory
	} from '@tabler/icons-svelte';

	interface Props {
		projectId: number | string;
	}

	let { projectId }: Props = $props();

	// State
	let loading = $state(true);
	let saving = $state(false);
	let activeCategoryTab = $state<'all' | InventoryCategory>('all');
	let activeViewTab = $state<'balance' | 'logs'>('balance');
	let searchQuery = $state('');

	let inventoryItems = $state<ProjectStockItem[]>([]);
	let transactionLogs = $state<ProjectStockTransaction[]>([]);
	let sjOptions = $state<SuratJalanOption[]>([]);

	// Modal State
	let showModal = $state(false);
	let movementType = $state<'IN' | 'OUT'>('IN');
	let selectedItemId = $state<number | null>(null);
	let conditionStatus = $state<ConditionStatus>('diterima');
	let quantity = $state<number>(1);
	let suratJalanRef = $state<string>('');
	let notes = $state<string>('');

	let modalError = $state<string | null>(null);
	let modalSuccess = $state<string | null>(null);

	// Computed Metrics
	let filteredItems = $derived.by(() => {
		return inventoryItems.filter((item) => {
			const matchCategory = activeCategoryTab === 'all' || item.category === activeCategoryTab;
			const matchSearch =
				!searchQuery.trim() ||
				item.namaBarang.toLowerCase().includes(searchQuery.toLowerCase()) ||
				(item.kodeItem && item.kodeItem.toLowerCase().includes(searchQuery.toLowerCase()));
			return matchCategory && matchSearch;
		});
	});

	let filteredLogs = $derived.by(() => {
		return transactionLogs.filter((log) => {
			const matchCategory = activeCategoryTab === 'all' || log.category === activeCategoryTab;
			const matchSearch =
				!searchQuery.trim() ||
				log.namaBarang.toLowerCase().includes(searchQuery.toLowerCase()) ||
				(log.suratJalanRef && log.suratJalanRef.toLowerCase().includes(searchQuery.toLowerCase())) ||
				(log.notes && log.notes.toLowerCase().includes(searchQuery.toLowerCase()));
			return matchCategory && matchSearch;
		});
	});

	let totalItemsCount = $derived(inventoryItems.length);
	let consumableCount = $derived(inventoryItems.filter((i) => i.category === 'consumable').length);
	let equipmentCount = $derived(inventoryItems.filter((i) => i.category === 'equipment').length);
	let materialCount = $derived(inventoryItems.filter((i) => i.category === 'material').length);

	let totalStockOnHand = $derived(inventoryItems.reduce((acc, i) => acc + (i.qtyOnHand || 0), 0));
	let totalUsed = $derived(inventoryItems.reduce((acc, i) => acc + (i.qtyUsed || 0), 0));
	let totalDamaged = $derived(inventoryItems.reduce((acc, i) => acc + (i.qtyDamaged || 0), 0));

	async function loadData() {
		loading = true;
		try {
			const [itemsData, logsData, sjData] = await Promise.all([
				getProjectInventory(projectId),
				getProjectInventoryLogs(projectId),
				getSuratJalanListForProject(projectId)
			]);
			inventoryItems = itemsData;
			transactionLogs = logsData;
			sjOptions = sjData;
		} catch (err: any) {
			console.error('Error loading project inventory:', err);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		loadData();
	});

	function openMovementModal(type: 'IN' | 'OUT', defaultItem?: ProjectStockItem) {
		movementType = type;
		selectedItemId = defaultItem ? defaultItem.itemId : inventoryItems[0]?.itemId || null;
		conditionStatus = type === 'IN' ? 'diterima' : 'dipakai';
		quantity = 1;
		suratJalanRef = '';
		notes = '';
		modalError = null;
		modalSuccess = null;
		showModal = true;
	}

	async function handleSaveMovement() {
		if (!selectedItemId) {
			modalError = 'Pilih barang terlebih dahulu';
			return;
		}
		if (!quantity || quantity <= 0) {
			modalError = 'Masukkan kuantitas yang valid';
			return;
		}

		modalError = null;
		saving = true;

		try {
			const selectedObj = inventoryItems.find((i) => i.itemId === selectedItemId);
			const reporter = ($authStore?.user as any)?.first_name || 'Project Leader';

			await recordProjectStockMovement({
				projectId,
				itemId: selectedItemId,
				movementType,
				conditionStatus,
				quantity,
				suratJalanRef: suratJalanRef.trim() || null,
				category: selectedObj?.category || 'material',
				notes,
				reportedBy: reporter
			});

			modalSuccess = `Berhasil mencatat Stock ${movementType} (${quantity} ${selectedObj?.satuan || 'pcs'})`;
			setTimeout(async () => {
				showModal = false;
				modalSuccess = null;
				await loadData();
			}, 1000);
		} catch (err: any) {
			modalError = err?.message || 'Gagal menyimpan transaksi stok';
		} finally {
			saving = false;
		}
	}

	function getCategoryBadgeClass(category: InventoryCategory) {
		switch (category) {
			case 'consumable':
				return 'bg-amber-100 text-amber-800 border-amber-200';
			case 'equipment':
				return 'bg-purple-100 text-purple-800 border-purple-200';
			case 'material':
			default:
				return 'bg-blue-100 text-blue-800 border-blue-200';
		}
	}

	function getCategoryLabel(category: InventoryCategory) {
		switch (category) {
			case 'consumable':
				return 'Consumable';
			case 'equipment':
				return 'Equipment';
			case 'material':
			default:
				return 'Material';
		}
	}

	function getConditionBadgeClass(status: ConditionStatus) {
		switch (status) {
			case 'diterima':
				return 'bg-emerald-100 text-emerald-800 border-emerald-200';
			case 'dipakai':
				return 'bg-sky-100 text-sky-800 border-sky-200';
			case 'rusak':
				return 'bg-red-100 text-red-800 border-red-200 font-bold';
			case 'dikembalikan':
				return 'bg-orange-100 text-orange-800 border-orange-200';
			case 'hilang':
				return 'bg-rose-100 text-rose-800 border-rose-200 font-bold';
			default:
				return 'bg-slate-100 text-slate-700 border-slate-200';
		}
	}
</script>

<div class="space-y-6">
	<!-- Top Bar / Action Header -->
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
		<div>
			<h3 class="text-lg font-bold text-slate-800 flex items-center gap-2">
				<IconBox size={22} class="text-blue-600" />
				Inventory Site & Stock Management
			</h3>
			<p class="text-xs text-slate-500 mt-0.5">
				Kelola stok barang masuk/keluar site, pencatatan pemakaian/kerusakan, dan referensi Surat Jalan.
			</p>
		</div>
		<div class="flex items-center gap-2">
			<button
				class="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 transition-colors shadow-sm active:scale-95"
				onclick={() => openMovementModal('IN')}
			>
				<IconPlus size={16} />
				Stock In (Terima Site)
			</button>
			<button
				class="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 transition-colors shadow-sm active:scale-95"
				onclick={() => openMovementModal('OUT')}
			>
				<IconMinus size={16} />
				Stock Out (Pakai / Rusak)
			</button>
		</div>
	</div>

	<!-- Panduan Alur Barang Proyek -->
	<div class="p-3.5 bg-blue-50/70 dark:bg-blue-950/20 rounded-xl border border-blue-200/60 dark:border-blue-900/40 text-xs text-blue-900 dark:text-blue-200 flex items-start gap-2.5">
		<IconSparkles size={18} class="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
		<div class="leading-relaxed">
			<span class="font-bold">Panduan Siklus Barang Site:</span>
			<b>1. Terima Barang:</b> Pastikan Surat Jalan yang tiba sudah di-GR (klik tombol Konfirmasi GR pada banner proyek). &bull;
			<b>2. Pemakaian:</b> Catat pengeluaran cat, thinner, & abrasive harian via Laporan Harian atau tombol <i>Stock Out</i>. &bull;
			<b>3. Retur / Alat:</b> Sebelum proyek berakhir, kembalikan sisa material dan alat pinjaman ke gudang via menu <i>Retur</i>.
		</div>
	</div>

	<!-- Summary Cards -->
	<div class="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
		<!-- Total Items -->
		<div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
			<div class="flex items-center justify-between text-slate-500 mb-2">
				<span class="text-xs font-semibold uppercase tracking-wider">Total Item Site</span>
				<div class="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
					<IconPackage size={18} />
				</div>
			</div>
			<p class="text-2xl font-black text-slate-800">{totalItemsCount}</p>
			<div class="text-[11px] text-slate-500 mt-2 flex items-center gap-2 flex-wrap">
				<span class="px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">{materialCount} Mat</span>
				<span class="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 font-medium">{consumableCount} Con</span>
				<span class="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 font-medium">{equipmentCount} Eq</span>
			</div>
		</div>

		<!-- Stock On Hand -->
		<div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
			<div class="flex items-center justify-between text-slate-500 mb-2">
				<span class="text-xs font-semibold uppercase tracking-wider">Total Qty Site</span>
				<div class="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
					<IconArrowDownLeft size={18} />
				</div>
			</div>
			<p class="text-2xl font-black text-emerald-600">{totalStockOnHand.toLocaleString('id-ID')}</p>
			<p class="text-[11px] text-slate-500 mt-2">Stok fisik tersedia di lokasi</p>
		</div>

		<!-- Total Used (Dipakai) -->
		<div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
			<div class="flex items-center justify-between text-slate-500 mb-2">
				<span class="text-xs font-semibold uppercase tracking-wider">Total Dipakai</span>
				<div class="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
					<IconArrowUpRight size={18} />
				</div>
			</div>
			<p class="text-2xl font-black text-sky-600">{totalUsed.toLocaleString('id-ID')}</p>
			<p class="text-[11px] text-slate-500 mt-2">Item terpakai operasional</p>
		</div>

		<!-- Total Damaged (Rusak) -->
		<div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
			<div class="flex items-center justify-between text-slate-500 mb-2">
				<span class="text-xs font-semibold uppercase tracking-wider">Total Rusak</span>
				<div class="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
					<IconAlertTriangle size={18} />
				</div>
			</div>
			<p class="text-2xl font-black text-red-600">{totalDamaged.toLocaleString('id-ID')}</p>
			<p class="text-[11px] text-slate-500 mt-2">Barang afkir / kerusakan site</p>
		</div>
	</div>

	<!-- Filter & Search Controls -->
	<div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
		<!-- Category Selector Tabs -->
		<div class="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto">
			<button
				class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap {activeCategoryTab === 'all' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'}"
				onclick={() => (activeCategoryTab = 'all')}
			>
				Semua Category ({inventoryItems.length})
			</button>
			<button
				class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 {activeCategoryTab === 'material' ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'}"
				onclick={() => (activeCategoryTab = 'material')}
			>
				<span class="w-2 h-2 rounded-full bg-blue-500"></span>
				Material ({materialCount})
			</button>
			<button
				class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 {activeCategoryTab === 'consumable' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'}"
				onclick={() => (activeCategoryTab = 'consumable')}
			>
				<span class="w-2 h-2 rounded-full bg-amber-500"></span>
				Consumable ({consumableCount})
			</button>
			<button
				class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-1.5 {activeCategoryTab === 'equipment' ? 'bg-white text-purple-600 shadow-sm' : 'text-slate-600 hover:text-slate-900'}"
				onclick={() => (activeCategoryTab = 'equipment')}
			>
				<span class="w-2 h-2 rounded-full bg-purple-500"></span>
				Equipment ({equipmentCount})
			</button>
		</div>

		<!-- Search Input & View Switcher -->
		<div class="flex items-center gap-2">
			<div class="relative flex-1 sm:w-64">
				<IconSearch size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
				<input
					type="text"
					placeholder="Cari barang / SJ..."
					bind:value={searchQuery}
					class="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
				/>
			</div>

			<div class="flex items-center bg-slate-100 p-1 rounded-xl">
				<button
					class="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all {activeViewTab === 'balance' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}"
					onclick={() => (activeViewTab = 'balance')}
					title="Daftar Stok"
				>
					Stok
				</button>
				<button
					class="px-2.5 py-1 rounded-lg text-xs font-semibold transition-all {activeViewTab === 'logs' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-800'}"
					onclick={() => (activeViewTab = 'logs')}
					title="Riwayat Mutasi"
				>
					Riwayat
				</button>
			</div>
		</div>
	</div>

	<!-- Main Content Area -->
	{#if loading}
		<div class="bg-white p-8 rounded-2xl border border-slate-200 text-center">
			<CircularProgressGauge
				stepLabel="Memuat inventory proyek lapangan..."
				subLabel="Mengambil alokasi barang & mutasi Directus"
			/>
		</div>
	{:else if activeViewTab === 'balance'}
		<!-- BALANCE TABLE -->
		<div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
			<div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
				<h4 class="text-xs font-bold text-slate-700 uppercase tracking-wider">
					Daftar Inventaris Site ({filteredItems.length} Barang)
				</h4>
			</div>

			{#if filteredItems.length === 0}
				<div class="p-8 text-center text-slate-400">
					<IconPackage size={40} class="mx-auto mb-2 opacity-50" />
					<p class="text-xs">Tidak ada data barang yang sesuai filter.</p>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-xs">
						<thead class="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
							<tr>
								<th class="px-4 py-3">Nama Barang</th>
								<th class="px-4 py-3">Kategori</th>
								<th class="px-4 py-3 text-right">Stok Ada (Site)</th>
								<th class="px-4 py-3 text-right">Total Diterima</th>
								<th class="px-4 py-3 text-right">Dipakai</th>
								<th class="px-4 py-3 text-right">Rusak</th>
								<th class="px-4 py-3 text-center">Aksi</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-slate-100 text-slate-700">
							{#each filteredItems as item}
								<tr class="hover:bg-slate-50/80 transition-colors">
									<td class="px-4 py-3 font-semibold text-slate-800">
										<div>{item.namaBarang}</div>
										{#if item.kodeItem}
											<div class="text-[10px] text-slate-400 font-normal">{item.kodeItem}</div>
										{/if}
									</td>
									<td class="px-4 py-3">
										<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold border {getCategoryBadgeClass(item.category)}">
											{getCategoryLabel(item.category)}
										</span>
									</td>
									<td class="px-4 py-3 text-right font-bold text-slate-900">
										{item.qtyOnHand} <span class="text-[10px] text-slate-500 font-normal">{item.satuan}</span>
									</td>
									<td class="px-4 py-3 text-right text-emerald-600 font-medium">
										+{item.qtyReceived}
									</td>
									<td class="px-4 py-3 text-right text-sky-600 font-medium">
										{item.qtyUsed}
									</td>
									<td class="px-4 py-3 text-right text-red-600 font-medium">
										{item.qtyDamaged > 0 ? item.qtyDamaged : 0}
									</td>
									<td class="px-4 py-3 text-center">
										<div class="flex items-center justify-center gap-1">
											<button
												class="p-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
												title="Stock In (Terima)"
												onclick={() => openMovementModal('IN', item)}
											>
												<IconPlus size={14} />
											</button>
											<button
												class="p-1 rounded bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors"
												title="Stock Out (Pakai/Rusak)"
												onclick={() => openMovementModal('OUT', item)}
											>
												<IconMinus size={14} />
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
	{:else}
		<!-- LOGS TABLE -->
		<div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
			<div class="px-5 py-4 border-b border-slate-100">
				<h4 class="text-xs font-bold text-slate-700 uppercase tracking-wider">
					Riwayat Transaksi & Mutasi Surat Jalan ({filteredLogs.length})
				</h4>
			</div>

			{#if filteredLogs.length === 0}
				<div class="p-8 text-center text-slate-400">
					<IconHistory size={40} class="mx-auto mb-2 opacity-50" />
					<p class="text-xs">Belum ada riwayat transaksi mutasi stok.</p>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<table class="w-full text-left text-xs">
						<thead class="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
							<tr>
								<th class="px-4 py-3">Tanggal</th>
								<th class="px-4 py-3">Tipe</th>
								<th class="px-4 py-3">Nama Barang</th>
								<th class="px-4 py-3">Kategori</th>
								<th class="px-4 py-3 text-right">Jumlah</th>
								<th class="px-4 py-3">Kondisi / Alasan</th>
								<th class="px-4 py-3">Ref Surat Jalan</th>
								<th class="px-4 py-3">Catatan</th>
							</tr>
						</thead>
						<tbody class="divide-y divide-slate-100 text-slate-700">
							{#each filteredLogs as log}
								<tr class="hover:bg-slate-50/80 transition-colors">
									<td class="px-4 py-3 text-slate-500 whitespace-nowrap">{log.date}</td>
									<td class="px-4 py-3">
										{#if log.type === 'IN'}
											<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 inline-flex items-center gap-1">
												<IconArrowDownLeft size={12} /> IN
											</span>
										{:else}
											<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200 inline-flex items-center gap-1">
												<IconArrowUpRight size={12} /> OUT
											</span>
										{/if}
									</td>
									<td class="px-4 py-3 font-medium text-slate-800">{log.namaBarang}</td>
									<td class="px-4 py-3">
										<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold border {getCategoryBadgeClass(log.category)}">
											{getCategoryLabel(log.category)}
										</span>
									</td>
									<td class="px-4 py-3 text-right font-bold text-slate-900">
										{log.qty} <span class="text-[10px] text-slate-500 font-normal">{log.satuan}</span>
									</td>
									<td class="px-4 py-3">
										<span class="px-2 py-0.5 rounded-full text-[10px] font-semibold border {getConditionBadgeClass(log.conditionStatus)}">
											{log.conditionStatus.toUpperCase()}
										</span>
									</td>
									<td class="px-4 py-3">
										{#if log.suratJalanRef}
											<span class="font-mono text-[11px] font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-100 flex items-center gap-1 w-max">
												<IconFileText size={12} /> {log.suratJalanRef}
											</span>
										{:else}
											<span class="text-slate-400 font-mono text-[11px]">{log.refNo}</span>
										{/if}
									</td>
									<td class="px-4 py-3 text-slate-500 max-w-xs truncate">{log.notes || '-'}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- RECORD MOVEMENT MODAL -->
{#if showModal}
	<div class="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
		<div class="bg-white rounded-2xl shadow-xl w-full max-w-md border border-slate-100 overflow-hidden animate-in fade-in zoom-in duration-150">
			<!-- Modal Header -->
			<div class="px-5 py-4 border-b border-slate-100 flex items-center justify-between {movementType === 'IN' ? 'bg-emerald-50/50' : 'bg-rose-50/50'}">
				<h3 class="text-sm font-bold text-slate-800 flex items-center gap-2">
					{#if movementType === 'IN'}
						<div class="w-6 h-6 rounded bg-emerald-600 text-white flex items-center justify-center">
							<IconPlus size={14} />
						</div>
						Stock IN — Terima Barang di Site
					{:else}
						<div class="w-6 h-6 rounded bg-rose-600 text-white flex items-center justify-center">
							<IconMinus size={14} />
						</div>
						Stock OUT — Catat Penggunaan / Rusak
					{/if}
				</h3>
				<button class="text-slate-400 hover:text-slate-600 text-lg font-bold" onclick={() => (showModal = false)}>
					&times;
				</button>
			</div>

			<!-- Modal Body -->
			<div class="p-5 space-y-4">
				{#if modalError}
					<div class="p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium flex items-center gap-2">
						<IconAlertTriangle size={16} class="shrink-0" />
						{modalError}
					</div>
				{/if}

				{#if modalSuccess}
					<div class="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium flex items-center gap-2">
						<IconCheck size={16} class="shrink-0" />
						{modalSuccess}
					</div>
				{/if}

				<!-- Select Barang -->
				<div>
					<label class="block text-xs font-semibold text-slate-700 mb-1">Pilih Barang *</label>
					<select
						bind:value={selectedItemId}
						class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20"
					>
						{#each inventoryItems as item}
							<option value={item.itemId}>
								{item.namaBarang} ({getCategoryLabel(item.category)}) — Stok Site: {item.qtyOnHand} {item.satuan}
							</option>
						{/each}
					</select>
				</div>

				<!-- Kondisi / Status Transaksi -->
				<div>
					<label class="block text-xs font-semibold text-slate-700 mb-1">Status Kondisi / Alasan *</label>
					<select
						bind:value={conditionStatus}
						class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-medium focus:outline-none focus:ring-2 focus:ring-blue-500/20"
					>
						{#if movementType === 'IN'}
							<option value="diterima">Diterima di Site (Baik)</option>
							<option value="dikembalikan">Kembali dari Peminjaman</option>
						{:else}
							<option value="dipakai">Dipakai Pekerjaan (Consumed)</option>
							<option value="rusak">Rusak / Afkir saat Operasional Site</option>
							<option value="dikembalikan">Dikembalikan ke Gudang HQ</option>
							<option value="hilang">Hilang / Off-spec</option>
						{/if}
					</select>
				</div>

				<!-- Quantity -->
				<div>
					<label class="block text-xs font-semibold text-slate-700 mb-1">Kuantitas Total *</label>
					<input
						type="number"
						min="1"
						bind:value={quantity}
						class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500/20"
					/>
				</div>

				<!-- Referensi Surat Jalan -->
				<div>
					<label class="block text-xs font-semibold text-slate-700 mb-1">Referensi Surat Jalan (Site In/Out)</label>
					<div class="space-y-1.5">
						{#if sjOptions.length > 0}
							<select
								onchange={(e) => (suratJalanRef = (e.target as HTMLSelectElement).value)}
								class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700"
							>
								<option value="">-- Pilih dari Surat Jalan Terdaftar --</option>
								{#each sjOptions as sj}
									<option value={sj.nomorSj}>
										[{sj.tipe}] {sj.nomorSj} ({sj.tanggal} - {sj.tujuan})
									</option>
								{/each}
							</select>
						{/if}
						<input
							type="text"
							placeholder="Atau ketik No. Surat Jalan manual (cth: SJI-0826/101)"
							bind:value={suratJalanRef}
							class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
						/>
					</div>
				</div>

				<!-- Catatan -->
				<div>
					<label class="block text-xs font-semibold text-slate-700 mb-1">Catatan Tambahan</label>
					<textarea
						rows="2"
						placeholder="Keterangan penggunaan, lokasi kerja site, dsb..."
						bind:value={notes}
						class="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
					></textarea>
				</div>
			</div>

			<!-- Modal Footer -->
			<div class="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
				<button
					class="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-200/60 transition-colors"
					onclick={() => (showModal = false)}
					disabled={saving}
				>
					Batal
				</button>
				<button
					class="px-4 py-2 rounded-xl text-xs font-semibold text-white transition-all flex items-center gap-1.5 shadow-sm active:scale-95 {movementType === 'IN' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}"
					onclick={handleSaveMovement}
					disabled={saving}
				>
					{#if saving}
						<IconLoader2 size={14} class="animate-spin" />
						Menyimpan...
					{:else}
						Simpan Transaksi
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
