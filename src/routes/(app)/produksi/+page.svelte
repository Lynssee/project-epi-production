<!-- src/routes/(app)/produksi/+page.svelte -->
<!-- Monitoring Produksi (Fase 7, Pertajam KPI Marketing & Manufaktur v2) -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		fetchActiveSpkList,
		fetchWaitingForStockSpkList,
		fetchAllSpkList,
		fetchAllDailyLogs,
		fetchProductionStats,
		type ActiveSpk,
		type SpkDailyLogRow,
		type ProductionStats
	} from '$lib/services/spkDailyLogApi';
	import { fetchRantaiBahanOverview, type RantaiBahanOverviewRow } from '$lib/services/materialChain';
	import ProduksiExportSheet from '$lib/components/produksi/ProduksiExportSheet.svelte';
	import {
		IconBuildingFactory2,
		IconClipboardList,
		IconPlus,
		IconLoader2,
		IconAlertTriangle,
		IconSearch,
		IconCalendar,
		IconScale,
		IconFlame,
		IconArrowLeft,
		IconRefresh,
		IconPackage,
		IconClock
	} from '@tabler/icons-svelte';

	let loading = $state(true);
	let activeTab = $state<'spk' | 'logs' | 'all_spk'>('spk');
	let showExport = $state(false);

	let activeSpks = $state<ActiveSpk[]>([]);
	let allSpks = $state<ActiveSpk[]>([]);
	let dailyLogs = $state<SpkDailyLogRow[]>([]);

	// Rantai Bahan SPK v2, Fase 4.3 (2 Sep 2026) — "⏳ Menunggu Bahan".
	let waitingSpks = $state<ActiveSpk[]>([]);
	let rantaiBahanByspkId = $state<Map<number, RantaiBahanOverviewRow>>(new Map());
	let stats = $state<ProductionStats>({
		activeSpkCount: 0,
		outputHariIniKg: 0,
		rejectHariIniKg: 0,
		wasteHariIniKg: 0,
		outputBulanIniKg: 0
	});

	// Filters
	let searchQuery = $state('');
	let filterDate = $state('');
	let statusFilter = $state('all');
	let errorMsg = $state('');

	function canInput(): boolean {
		if ($authStore.roleId === 'super_admin' || $authStore.roleIds?.includes('super_admin')) return true;
		return hasPermission($authStore.roleId, 'input_produksi_harian', $rolesStore, $authStore.roleIds);
	}

	async function loadData() {
		loading = true;
		errorMsg = '';
		try {
			const [spkRes, statsRes, logsRes, waitingRes] = await Promise.all([
				fetchActiveSpkList(),
				fetchProductionStats(),
				fetchAllDailyLogs({ limit: 100 }),
				fetchWaitingForStockSpkList()
			]);
			activeSpks = spkRes;
			stats = statsRes;
			dailyLogs = logsRes;
			waitingSpks = waitingRes;
			loadRantaiBahan(); // tidak diawait -- badge boleh muncul belakangan (cross-origin, jangan tunda render utama)
		} catch (e: any) {
			console.error('[produksi/+page] Gagal memuat data produksi:', e);
			errorMsg = e?.message || 'Gagal memuat data monitoring produksi.';
		} finally {
			loading = false;
		}
	}

	async function loadRantaiBahan() {
		const overview = await fetchRantaiBahanOverview();
		if (!overview) return;
		rantaiBahanByspkId = new Map(overview.rows.map((r) => [r.spkId, r]));
	}

	async function loadAllSpks() {
		try {
			allSpks = await fetchAllSpkList(statusFilter);
		} catch (e: any) {
			console.error('[produksi/+page] Gagal memuat semua SPK:', e);
		}
	}

	$effect(() => {
		if (activeTab === 'all_spk') {
			loadAllSpks();
		}
	});

	onMount(() => {
		loadData();
	});

	function productTitle(p: any) {
		if (!p) return 'Produk tidak ditentukan';
		if (typeof p === 'object') {
			return p.nama_barang_lengkap || p.kode_barang || 'Produk';
		}
		return `Produk #${p}`;
	}

	function getSpkNumber(spk: any) {
		if (!spk) return '-';
		if (typeof spk === 'object') return spk.nomor || `#${spk.id}`;
		return `#${spk}`;
	}

	function getSpkProduct(spk: any) {
		if (!spk || typeof spk !== 'object') return '-';
		return productTitle(spk.product_id);
	}

	const STATUS_BADGE: Record<string, { label: string; bg: string; text: string }> = {
		requested: { label: 'Diajukan', bg: 'bg-amber-100 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-300' },
		approved: { label: 'Disetujui', bg: 'bg-blue-100 dark:bg-blue-950/40', text: 'text-blue-700 dark:text-blue-300' },
		in_progress: { label: 'Sedang Berjalan', bg: 'bg-emerald-100 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-300' },
		qc_pending: { label: 'Menunggu QC', bg: 'bg-purple-100 dark:bg-purple-950/40', text: 'text-purple-700 dark:text-purple-300' },
		qc_check: { label: 'Uji QC', bg: 'bg-purple-100 dark:bg-purple-950/40', text: 'text-purple-700 dark:text-purple-300' },
		completed: { label: 'Selesai', bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-700 dark:text-slate-300' },
		closed: { label: 'Ditutup', bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-600 dark:text-slate-400' },
		cancelled: { label: 'Dibatalkan', bg: 'bg-red-100 dark:bg-red-950/40', text: 'text-red-700 dark:text-red-300' }
	};

	let filteredActiveSpks = $derived(
		activeSpks.filter((s) => {
			if (!searchQuery) return true;
			const q = searchQuery.toLowerCase();
			const no = (s.nomor || '').toLowerCase();
			const batch = (s.batch_no || '').toLowerCase();
			const name = productTitle(s.product_id).toLowerCase();
			return no.includes(q) || batch.includes(q) || name.includes(q);
		})
	);

	let filteredLogs = $derived(
		dailyLogs.filter((l) => {
			if (filterDate && l.tanggal !== filterDate) return false;
			if (!searchQuery) return true;
			const q = searchQuery.toLowerCase();
			const spkNo = getSpkNumber(l.spk_id).toLowerCase();
			const prod = getSpkProduct(l.spk_id).toLowerCase();
			const cat = (l.catatan || '').toLowerCase();
			const user = (l.input_by || '').toLowerCase();
			return spkNo.includes(q) || prod.includes(q) || cat.includes(q) || user.includes(q);
		})
	);

	let filteredAllSpks = $derived(
		allSpks.filter((s) => {
			if (!searchQuery) return true;
			const q = searchQuery.toLowerCase();
			const no = (s.nomor || '').toLowerCase();
			const batch = (s.batch_no || '').toLowerCase();
			const name = productTitle(s.product_id).toLowerCase();
			return no.includes(q) || batch.includes(q) || name.includes(q);
		})
	);
</script>

<svelte:head>
	<title>Monitoring Produksi — EPI</title>
</svelte:head>

<div class="flex-1 flex flex-col h-full overflow-y-auto p-4 md:p-6 pb-24" style="background: var(--sys-bg)">
	<!-- Header -->
	<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
		<div class="flex items-center gap-3">
			<button
				class="w-10 h-10 rounded-xl flex items-center justify-center border transition-colors hover:bg-black/5 dark:hover:bg-white/5"
				style="border-color: var(--sys-sep); color: var(--sys-label)"
				onclick={() => goto('/produksi/hub')}
				title="Kembali ke Hub"
			>
				<IconArrowLeft size={20} />
			</button>
			<div>
				<div class="flex items-center gap-2">
					<h1 class="text-xl md:text-2xl font-black tracking-tight" style="color: var(--sys-label)">
						Monitoring Produksi
					</h1>
					<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-600 dark:text-blue-400">
						Pabrik & Lapangan
					</span>
				</div>
				<p class="text-xs md:text-sm font-medium mt-0.5" style="color: var(--sys-label3)">
					Pantau progres SPK aktif, riwayat log harian, dan ringkasan output produksi
				</p>
			</div>
		</div>

		<div class="flex items-center gap-2">
			<button
				class="h-10 px-3.5 rounded-xl border flex items-center gap-2 text-xs font-semibold transition-colors hover:bg-black/5 dark:hover:bg-white/5"
				style="border-color: var(--sys-sep); color: var(--sys-label)"
				onclick={loadData}
				disabled={loading}
			>
				<IconRefresh size={16} class={loading ? 'animate-spin' : ''} />
				<span>Refresh</span>
			</button>

			<button
				class="h-10 px-3.5 rounded-xl border flex items-center gap-2 text-xs font-semibold transition-colors hover:bg-black/5 dark:hover:bg-white/5"
				style="border-color: var(--sys-sep); color: var(--sys-label)"
				onclick={() => (showExport = true)}
				title="Ekspor SPK & log harian ke CSV (offline) atau PDF (butuh koneksi)"
			>
				<IconPackage size={16} />
				<span>Ekspor</span>
			</button>

			{#if canInput()}
				<button
					class="h-10 px-4 rounded-xl text-xs font-bold text-white flex items-center gap-1.5 shadow-sm transition-opacity hover:opacity-90"
					style="background: var(--p, var(--g))"
					onclick={() => goto('/produksi/input-harian')}
				>
					<IconPlus size={16} />
					<span>Input Log Harian</span>
				</button>
			{/if}
		</div>
	</div>

	<!-- Metric Cards Grid -->
	<div class="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
		<div class="p-4 rounded-2xl border flex flex-col gap-1" style="background: var(--sys-surface); border-color: var(--sys-sep)">
			<div class="flex items-center justify-between text-xs font-semibold" style="color: var(--sys-label3)">
				<span>SPK Aktif</span>
				<div class="w-7 h-7 rounded-lg flex items-center justify-center bg-emerald-500/10 text-emerald-600">
					<IconBuildingFactory2 size={16} />
				</div>
			</div>
			<div class="text-2xl font-extrabold tracking-tight mt-1" style="color: var(--sys-label)">
				{stats.activeSpkCount}
			</div>
			<span class="text-[11px]" style="color: var(--sys-label3)">Sedang berproduksi</span>
		</div>

		<div class="p-4 rounded-2xl border flex flex-col gap-1" style="background: var(--sys-surface); border-color: var(--sys-sep)">
			<div class="flex items-center justify-between text-xs font-semibold" style="color: var(--sys-label3)">
				<span>Output Hari Ini</span>
				<div class="w-7 h-7 rounded-lg flex items-center justify-center bg-blue-500/10 text-blue-600">
					<IconScale size={16} />
				</div>
			</div>
			<div class="text-2xl font-extrabold tracking-tight mt-1" style="color: var(--sys-label)">
				{stats.outputHariIniKg.toLocaleString('id-ID')} <span class="text-xs font-bold">kg</span>
			</div>
			<span class="text-[11px]" style="color: var(--sys-label3)">Hasil log per hari ini</span>
		</div>

		<div class="p-4 rounded-2xl border flex flex-col gap-1" style="background: var(--sys-surface); border-color: var(--sys-sep)">
			<div class="flex items-center justify-between text-xs font-semibold" style="color: var(--sys-label3)">
				<span>Output Bulan Ini</span>
				<div class="w-7 h-7 rounded-lg flex items-center justify-center bg-indigo-500/10 text-indigo-600">
					<IconFlame size={16} />
				</div>
			</div>
			<div class="text-2xl font-extrabold tracking-tight mt-1" style="color: var(--sys-label)">
				{stats.outputBulanIniKg.toLocaleString('id-ID')} <span class="text-xs font-bold">kg</span>
			</div>
			<span class="text-[11px]" style="color: var(--sys-label3)">Akumulasi log bulanan</span>
		</div>

		<div class="p-4 rounded-2xl border flex flex-col gap-1" style="background: var(--sys-surface); border-color: var(--sys-sep)">
			<div class="flex items-center justify-between text-xs font-semibold" style="color: var(--sys-label3)">
				<span>Reject & Waste Hari Ini</span>
				<div class="w-7 h-7 rounded-lg flex items-center justify-center bg-amber-500/10 text-amber-600">
					<IconAlertTriangle size={16} />
				</div>
			</div>
			<div class="text-2xl font-extrabold tracking-tight mt-1" style="color: var(--sys-label)">
				{(stats.rejectHariIniKg + stats.wasteHariIniKg).toLocaleString('id-ID')} <span class="text-xs font-bold">kg</span>
			</div>
			<span class="text-[11px]" style="color: var(--sys-label3)">
				R: {stats.rejectHariIniKg} kg · W: {stats.wasteHariIniKg} kg
			</span>
		</div>
	</div>

	<!-- Navigation Tabs & Search Toolbar -->
	<div class="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
		<!-- Tabs -->
		<div class="flex items-center gap-1.5 p-1 rounded-xl border bg-black/5 dark:bg-white/5 w-fit" style="border-color: var(--sys-sep)">
			<button
				class="px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all {activeTab === 'spk'
					? 'bg-white dark:bg-slate-800 shadow-sm text-blue-600 dark:text-blue-400'
					: 'text-slate-600 dark:text-slate-400 hover:text-slate-900'}"
				onclick={() => { activeTab = 'spk'; }}
			>
				SPK Berjalan ({activeSpks.length})
			</button>
			<button
				class="px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all {activeTab === 'logs'
					? 'bg-white dark:bg-slate-800 shadow-sm text-blue-600 dark:text-blue-400'
					: 'text-slate-600 dark:text-slate-400 hover:text-slate-900'}"
				onclick={() => { activeTab = 'logs'; }}
			>
				Riwayat Log Harian ({dailyLogs.length})
			</button>
			<button
				class="px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all {activeTab === 'all_spk'
					? 'bg-white dark:bg-slate-800 shadow-sm text-blue-600 dark:text-blue-400'
					: 'text-slate-600 dark:text-slate-400 hover:text-slate-900'}"
				onclick={() => { activeTab = 'all_spk'; }}
			>
				Semua SPK
			</button>
		</div>

		<!-- Search & Quick Filters -->
		<div class="flex items-center gap-2">
			<div class="relative flex-1 md:w-64">
				<IconSearch size={16} class="absolute left-3 top-1/2 -translate-y-1/2" style="color: var(--sys-label3)" />
				<input
					type="text"
					placeholder="Cari SPK, batch, produk..."
					bind:value={searchQuery}
					class="w-full h-9 pl-9 pr-3 rounded-xl border text-xs outline-none transition-colors focus:border-blue-500"
					style="background: var(--sys-surface); border-color: var(--sys-sep); color: var(--sys-label)"
				/>
			</div>

			{#if activeTab === 'logs'}
				<input
					type="date"
					bind:value={filterDate}
					class="h-9 px-2.5 rounded-xl border text-xs outline-none"
					style="background: var(--sys-surface); border-color: var(--sys-sep); color: var(--sys-label)"
				/>
			{:else if activeTab === 'all_spk'}
				<select
					bind:value={statusFilter}
					onchange={loadAllSpks}
					class="h-9 px-2.5 rounded-xl border text-xs outline-none"
					style="background: var(--sys-surface); border-color: var(--sys-sep); color: var(--sys-label)"
				>
					<option value="all">Semua Status</option>
					<option value="in_progress">Sedang Berjalan</option>
					<option value="qc_pending">Menunggu QC</option>
					<option value="qc_check">Uji QC</option>
					<option value="approved">Disetujui</option>
					<option value="completed">Selesai</option>
					<option value="closed">Ditutup</option>
				</select>
			{/if}
		</div>
	</div>

	<!-- Content Area -->
	{#if loading}
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data produksi..." />
	{:else if errorMsg}
		<div class="p-4 rounded-2xl bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800/40 flex items-start gap-3 text-red-700 dark:text-red-400">
			<IconAlertTriangle size={20} class="shrink-0 mt-0.5 text-red-500" />
			<div class="text-xs">
				<p class="font-bold">Terjadi Kesalahan</p>
				<p class="mt-0.5">{errorMsg}</p>
				<button class="mt-2 text-xs underline font-semibold" onclick={loadData}>Coba lagi</button>
			</div>
		</div>
	{:else if activeTab === 'spk'}
		<!-- Rantai Bahan SPK v2, Fase 4.3 (2 Sep 2026) — "⏳ Menunggu Bahan" -->
		{#if waitingSpks.length > 0}
			<div class="mb-4">
				<h2 class="text-xs font-bold uppercase tracking-wide mb-2 flex items-center gap-1.5" style="color: var(--sys-label3)">
					<IconClock size={14} />
					<span>Menunggu Bahan ({waitingSpks.length})</span>
				</h2>
				<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
					{#each waitingSpks as spk (spk.id)}
						{@const rb = rantaiBahanByspkId.get(spk.id)}
						<div
							class="p-4 rounded-2xl border flex flex-col gap-2"
							style="background: color-mix(in srgb, #f59e0b 6%, var(--sys-surface)); border-color: color-mix(in srgb, #f59e0b 30%, var(--sys-sep))"
						>
							<div class="flex items-start justify-between gap-2">
								<span class="text-xs font-mono font-bold px-2 py-0.5 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400">
									{spk.nomor}
								</span>
								<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
									Menunggu Bahan
								</span>
							</div>
							<h3 class="text-sm font-bold line-clamp-2" style="color: var(--sys-label)">{productTitle(spk.product_id)}</h3>
							{#if rb}
								<div class="text-[11px] flex items-center gap-1.5" style="color: var(--sys-label3)">
									<span class="font-semibold {rb.shortageCount > 0 ? 'text-red-600' : 'text-emerald-600'}">
										{rb.shortageCount}/{rb.materialCount} bahan kurang
									</span>
								</div>
								{#if rb.telatHari != null}
									<div class="text-[11px] font-semibold {rb.telatHari > 0 ? 'text-red-600' : 'text-emerald-600'}">
										{rb.telatHari > 0 ? `Estimasi telat ${rb.telatHari} hari` : 'Aman — sesuai jadwal'}
									</div>
								{:else if !rb.hasSoReference}
									<div class="text-[11px]" style="color: var(--sys-label4)">Belum tertaut SO — risiko keterlambatan tidak bisa dihitung</div>
								{/if}
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Tab: SPK Berjalan -->
		{#if filteredActiveSpks.length === 0}
			<div class="p-12 text-center rounded-2xl border flex flex-col items-center justify-center" style="background: var(--sys-surface); border-color: var(--sys-sep)">
				<IconBuildingFactory2 size={40} style="color: var(--sys-label4)" />
				<p class="text-sm font-bold mt-2" style="color: var(--sys-label)">Tidak ada SPK berjalan</p>
				<p class="text-xs mt-0.5 max-w-sm" style="color: var(--sys-label3)">
					{searchQuery ? 'Tidak ada SPK aktif yang cocok dengan pencarian.' : 'Saat ini belum ada SPK berstatus in_progress di pabrik.'}
				</p>
			</div>
		{:else}
			<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
				{#each filteredActiveSpks as spk (spk.id)}
					{@const planned = Number(spk.total_kg) || Number(spk.jumlah_produksi) || 0}
					{@const actual = Number(spk.actual_quantity_produced) || 0}
					{@const pct = planned > 0 ? Math.min(100, Math.round((actual / planned) * 100)) : 0}
					<div
						class="p-4 rounded-2xl border flex flex-col justify-between gap-3 transition-all hover:shadow-md"
						style="background: var(--sys-surface); border-color: var(--sys-sep)"
					>
						<div>
							<div class="flex items-start justify-between gap-2">
								<div>
									<span class="text-xs font-mono font-bold px-2 py-0.5 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
										{spk.nomor}
									</span>
									{#if spk.batch_no}
										<span class="ml-1 text-[11px] font-mono font-semibold" style="color: var(--sys-label3)">
											Batch: {spk.batch_no}
										</span>
									{/if}
								</div>
								<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
									In Progress
								</span>
							</div>

							<h3 class="text-sm font-bold mt-2.5 line-clamp-2" style="color: var(--sys-label)">
								{productTitle(spk.product_id)}
							</h3>

							{#if spk.production_deadline}
								<div class="flex items-center gap-1.5 text-[11px] mt-1" style="color: var(--sys-label3)">
									<IconCalendar size={13} />
									<span>Deadline: {spk.production_deadline}</span>
								</div>
							{/if}
						</div>

						<div class="pt-3 border-t flex flex-col gap-2" style="border-color: var(--sys-sep)">
							{#if planned > 0}
								<div class="flex items-center justify-between text-xs font-semibold">
									<span style="color: var(--sys-label3)">Progres Batch:</span>
									<span style="color: var(--sys-label)">{actual.toLocaleString('id-ID')} / {planned.toLocaleString('id-ID')} kg ({pct}%)</span>
								</div>
								<div class="w-full h-1.5 rounded-full bg-black/5 dark:bg-white/5 overflow-hidden">
									<div class="h-full rounded-full bg-blue-600" style="width: {pct}%"></div>
								</div>
							{/if}

							<div class="flex items-center justify-end gap-2 mt-1">
								<!-- B5: deep-link ke Cetak Label dgn SPK terpilih (tanpa salin batch manual) -->
								<button
									class="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 flex items-center gap-1"
									onclick={() => goto(`/produksi/cetak-label?spk=${spk.id}`)}
									title="Cetak label untuk SPK ini"
								>
									🏷️ <span>Label</span>
								</button>
								<button
									class="px-3 py-1.5 rounded-xl text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-500/10 hover:bg-blue-500/20 flex items-center gap-1"
									onclick={() => goto(`/produksi/input-harian`)}
								>
									<IconPlus size={14} />
									<span>Input Log</span>
								</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{:else if activeTab === 'logs'}
		<!-- Tab: Riwayat Log Harian -->
		{#if filteredLogs.length === 0}
			<div class="p-12 text-center rounded-2xl border flex flex-col items-center justify-center" style="background: var(--sys-surface); border-color: var(--sys-sep)">
				<IconClipboardList size={40} style="color: var(--sys-label4)" />
				<p class="text-sm font-bold mt-2" style="color: var(--sys-label)">Belum ada riwayat log</p>
				<p class="text-xs mt-0.5 max-w-sm" style="color: var(--sys-label3)">
					{filterDate || searchQuery ? 'Tidak ada data log yang cocok dengan filter.' : 'Gunakan tombol "+ Input Log Harian" untuk mencatat output pertama.'}
				</p>
			</div>
		{:else}
			<div class="rounded-2xl border overflow-hidden" style="background: var(--sys-surface); border-color: var(--sys-sep)">
				<div class="overflow-x-auto">
					<table class="w-full text-left text-xs">
						<thead>
							<tr class="border-b bg-black/[0.02] dark:bg-white/[0.02]" style="border-color: var(--sys-sep); color: var(--sys-label3)">
								<th class="py-3 px-4 font-semibold">Tanggal</th>
								<th class="py-3 px-4 font-semibold">SPK / Batch</th>
								<th class="py-3 px-4 font-semibold">Produk</th>
								<th class="py-3 px-4 font-semibold text-right">Output (Kg)</th>
								<th class="py-3 px-4 font-semibold text-right">Reject (Kg)</th>
								<th class="py-3 px-4 font-semibold text-right">Waste (Kg)</th>
								<th class="py-3 px-4 font-semibold">Catatan</th>
								<th class="py-3 px-4 font-semibold">Input Oleh</th>
							</tr>
						</thead>
						<tbody class="divide-y" style="border-color: var(--sys-sep)">
							{#each filteredLogs as log (log.id)}
								<tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
									<td class="py-3 px-4 font-mono font-medium whitespace-nowrap" style="color: var(--sys-label)">
										{log.tanggal}
									</td>
									<td class="py-3 px-4 whitespace-nowrap">
										<span class="font-mono font-bold text-blue-600 dark:text-blue-400">
											{getSpkNumber(log.spk_id)}
										</span>
									</td>
									<td class="py-3 px-4 font-medium max-w-xs truncate" style="color: var(--sys-label)">
										{getSpkProduct(log.spk_id)}
									</td>
									<td class="py-3 px-4 font-mono font-bold text-right text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
										{(Number(log.output_kg) || 0).toLocaleString('id-ID')}
									</td>
									<td class="py-3 px-4 font-mono font-medium text-right text-amber-600 dark:text-amber-400 whitespace-nowrap">
										{(Number(log.reject_kg) || 0).toLocaleString('id-ID')}
									</td>
									<td class="py-3 px-4 font-mono font-medium text-right text-slate-500 whitespace-nowrap">
										{(Number(log.waste_kg) || 0).toLocaleString('id-ID')}
									</td>
									<td class="py-3 px-4 max-w-xs truncate text-[11px]" style="color: var(--sys-label3)">
										{log.catatan || '-'}
									</td>
									<td class="py-3 px-4 text-[11px] whitespace-nowrap" style="color: var(--sys-label3)">
										{log.input_by || '-'}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	{:else if activeTab === 'all_spk'}
		<!-- Tab: Semua SPK -->
		{#if filteredAllSpks.length === 0}
			<div class="p-12 text-center rounded-2xl border flex flex-col items-center justify-center" style="background: var(--sys-surface); border-color: var(--sys-sep)">
				<IconPackage size={40} style="color: var(--sys-label4)" />
				<p class="text-sm font-bold mt-2" style="color: var(--sys-label)">Data SPK tidak ditemukan</p>
				<p class="text-xs mt-0.5 max-w-sm" style="color: var(--sys-label3)">
					Tidak ada data SPK dengan status dan filter yang dipilih.
				</p>
			</div>
		{:else}
			<div class="rounded-2xl border overflow-hidden" style="background: var(--sys-surface); border-color: var(--sys-sep)">
				<div class="overflow-x-auto">
					<table class="w-full text-left text-xs">
						<thead>
							<tr class="border-b bg-black/[0.02] dark:bg-white/[0.02]" style="border-color: var(--sys-sep); color: var(--sys-label3)">
								<th class="py-3 px-4 font-semibold">Nomor SPK</th>
								<th class="py-3 px-4 font-semibold">Batch No</th>
								<th class="py-3 px-4 font-semibold">Produk</th>
								<th class="py-3 px-4 font-semibold text-right">Rencana (Kg)</th>
								<th class="py-3 px-4 font-semibold text-right">Realisasi (Kg)</th>
								<th class="py-3 px-4 font-semibold">Status</th>
								<th class="py-3 px-4 font-semibold">Deadline</th>
							</tr>
						</thead>
						<tbody class="divide-y" style="border-color: var(--sys-sep)">
							{#each filteredAllSpks as item (item.id)}
								{@const badge = STATUS_BADGE[item.status || ''] || { label: item.status || '-', bg: 'bg-slate-100', text: 'text-slate-700' }}
								<tr class="hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
									<td class="py-3 px-4 font-mono font-bold whitespace-nowrap text-blue-600 dark:text-blue-400">
										{item.nomor}
									</td>
									<td class="py-3 px-4 font-mono whitespace-nowrap" style="color: var(--sys-label3)">
										{item.batch_no || '-'}
									</td>
									<td class="py-3 px-4 font-medium max-w-xs truncate" style="color: var(--sys-label)">
										{productTitle(item.product_id)}
									</td>
									<td class="py-3 px-4 font-mono text-right whitespace-nowrap" style="color: var(--sys-label)">
										{(Number(item.total_kg) || Number(item.jumlah_produksi) || 0).toLocaleString('id-ID')}
									</td>
									<td class="py-3 px-4 font-mono font-semibold text-right whitespace-nowrap text-emerald-600 dark:text-emerald-400">
										{(Number(item.actual_quantity_produced) || 0).toLocaleString('id-ID')}
									</td>
									<td class="py-3 px-4 whitespace-nowrap">
										<span class="px-2 py-0.5 rounded-full text-[10px] font-bold {badge.bg} {badge.text}">
											{badge.label}
										</span>
									</td>
									<td class="py-3 px-4 text-[11px] whitespace-nowrap" style="color: var(--sys-label3)">
										{item.production_deadline || '-'}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{/if}
	{/if}
</div>

<ProduksiExportSheet
	open={showExport}
	onClose={() => (showExport = false)}
	rowsByKey={{
		'spk-berjalan': filteredActiveSpks,
		'log-harian': filteredLogs,
		'semua-spk': filteredAllSpks
	}}
/>
