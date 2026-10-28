<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Fase 5 — Quick Price Check (Multi-Tier Pricelist & Penajaman Modul
	// Distributor v2). READ-ONLY: acuan harga untuk sales di lapangan.
	// TIDAK menulis apa pun, TIDAK dipakai sebagai penawaran resmi.
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { searchProdukForHarga, getQuickPrice, type ProdukOption, type QuickPriceResult } from '$lib/services/pricingApi';
	import { getCustomerOptions, KONDISI_PERMUKAAN_OPTIONS, KETERSEDIAAN_OPTIONS, type CustomerOption } from '$lib/services/sales';
	import QuickEstimatorCard from '$lib/components/sales/QuickEstimatorCard.svelte';
	import { IconArrowLeft, IconSearch, IconLoader2, IconX, IconBuildingStore, IconInfoCircle, IconBox, IconCalculator } from '@tabler/icons-svelte';

	let activeTab = $state<'produk' | 'jasa'>('produk');

	// State khusus tab "Cek Jasa" (quick estimasi sandblasting/painting/floor coating)
	let jasaLuasArea = $state('');
	let jasaKondisiPermukaan = $state('');
	let jasaListrikTersedia = $state('');
	let jasaAirTersedia = $state('');

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && roles.length > 0 && !hasPermission(roleId, 'input_sales', roles, $authStore.roleIds)) {
			goto('/');
		}
	});

	let produkQuery = $state('');
	let produkOptions = $state<ProdukOption[]>([]);
	let produkLoading = $state(false);
	let selectedProduk = $state<ProdukOption | null>(null);

	let customerQuery = $state('');
	let customerOptions = $state<CustomerOption[]>([]);
	let customerLoading = $state(false);
	let selectedCustomer = $state<CustomerOption | null>(null);

	let hasil = $state<QuickPriceResult | null>(null);
	let hasilLoading = $state(false);

	let produkSearchTimer: ReturnType<typeof setTimeout>;
	function onProdukInput() {
		selectedProduk = null;
		hasil = null;
		clearTimeout(produkSearchTimer);
		produkSearchTimer = setTimeout(async () => {
			if (produkQuery.trim().length < 2) {
				produkOptions = [];
				return;
			}
			produkLoading = true;
			produkOptions = await searchProdukForHarga(produkQuery);
			produkLoading = false;
		}, 300);
	}

	let customerSearchTimer: ReturnType<typeof setTimeout>;
	function onCustomerInput() {
		selectedCustomer = null;
		hasil = null;
		clearTimeout(customerSearchTimer);
		customerSearchTimer = setTimeout(async () => {
			if (customerQuery.trim().length < 2) {
				customerOptions = [];
				return;
			}
			customerLoading = true;
			customerOptions = await getCustomerOptions(customerQuery);
			customerLoading = false;
		}, 300);
	}

	async function pilihProduk(p: ProdukOption) {
		selectedProduk = p;
		produkQuery = p.nama;
		produkOptions = [];
		await muatHasil();
	}

	async function pilihCustomer(c: CustomerOption) {
		selectedCustomer = c;
		customerQuery = c.customer_name;
		customerOptions = [];
		await muatHasil();
	}

	function clearCustomer() {
		selectedCustomer = null;
		customerQuery = '';
		muatHasil();
	}

	async function muatHasil() {
		if (!selectedProduk) return;
		hasilLoading = true;
		try {
			hasil = await getQuickPrice(selectedProduk.id, selectedCustomer?.id ?? null);
		} finally {
			hasilLoading = false;
		}
	}

	function fmtRp(v: number | null) {
		if (v === null || v === undefined) return '—';
		return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v);
	}

	function fmtTanggal(v: string | null) {
		if (!v) return '';
		const d = new Date(v);
		const bulanLalu = Math.max(0, Math.round((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 30)));
		if (bulanLalu === 0) return 'bulan ini';
		return `${bulanLalu} bln lalu`;
	}

	const sumberLabel: Record<string, string> = {
		customer_item: '🏷️ Kontrak Khusus Customer',
		tier_item: '🏷️ Harga Tier',
		harga_master: '📋 Harga Master',
		histori: '📊 Median Histori',
		tidak_ada: '✍️ Belum Ada Acuan'
	};
</script>

<svelte:head>
	<title>Cek Harga - Sales</title>
</svelte:head>

<div class="min-h-screen bg-gray-50 pb-8">
	<div class="sticky top-0 z-10 bg-white border-b px-4 py-3 flex items-center gap-3">
		<button onclick={() => goto('/sales')} class="text-gray-500" aria-label="Kembali">
			<IconArrowLeft size={22} />
		</button>
		<div>
			<h1 class="text-lg font-bold text-gray-900">Cek Harga</h1>
			<p class="text-xs text-gray-500">Acuan tier & histori — bukan penawaran resmi</p>
		</div>
	</div>

	<div class="p-4 space-y-4">
		<!-- Tab Switcher: Cek Harga Produk vs Cek Jasa -->
		<div class="grid grid-cols-2 gap-2 bg-gray-100 rounded-xl p-1">
			<button
				type="button"
				class={`h-10 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors ${activeTab === 'produk' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
				onclick={() => (activeTab = 'produk')}
			>
				<IconBox size={16} /> Cek Harga Produk
			</button>
			<button
				type="button"
				class={`h-10 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors ${activeTab === 'jasa' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}
				onclick={() => (activeTab = 'jasa')}
			>
				<IconCalculator size={16} /> Cek Jasa
			</button>
		</div>

		{#if activeTab === 'jasa'}
			<!-- Tab Cek Jasa: quick estimasi kasar sandblasting/painting/floor coating, tidak menulis apa pun -->
			<div class="bg-blue-50 border border-blue-200 rounded-lg p-3 flex gap-2 text-xs text-blue-800">
				<IconInfoCircle size={16} class="shrink-0 mt-0.5" />
				<span>Simulasi cepat harga jasa untuk telepon/chat customer. Angka kasar, bukan penawaran resmi — tidak tersimpan di sistem.</span>
			</div>

			<div class="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="jasa-luas" class="text-xs font-semibold text-gray-500 mb-1 block">Luas Area (m²)</label>
						<input
							id="jasa-luas"
							type="number"
							bind:value={jasaLuasArea}
							placeholder="cth. 250"
							class="w-full px-3 py-3 border border-gray-300 rounded-xl text-sm font-semibold focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
						/>
					</div>
					<div>
						<label for="jasa-kondisi" class="text-xs font-semibold text-gray-500 mb-1 block">Kondisi Permukaan</label>
						<select
							id="jasa-kondisi"
							bind:value={jasaKondisiPermukaan}
							class="w-full px-3 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
						>
							<option value="">-- Pilih --</option>
							{#each KONDISI_PERMUKAAN_OPTIONS as o}<option value={o}>{o}</option>{/each}
						</select>
					</div>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label for="jasa-listrik" class="text-xs font-semibold text-gray-500 mb-1 block">Listrik Kerja</label>
						<select
							id="jasa-listrik"
							bind:value={jasaListrikTersedia}
							class="w-full px-3 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
						>
							<option value="">-</option>
							{#each KETERSEDIAAN_OPTIONS as o}<option value={o}>{o}</option>{/each}
						</select>
					</div>
					<div>
						<label for="jasa-air" class="text-xs font-semibold text-gray-500 mb-1 block">Air Bersih</label>
						<select
							id="jasa-air"
							bind:value={jasaAirTersedia}
							class="w-full px-3 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
						>
							<option value="">-</option>
							{#each KETERSEDIAAN_OPTIONS as o}<option value={o}>{o}</option>{/each}
						</select>
					</div>
				</div>
			</div>

			<QuickEstimatorCard
				luasArea={jasaLuasArea}
				kondisiPermukaan={jasaKondisiPermukaan}
				ketersediaanListrik={jasaListrikTersedia}
				ketersediaanAir={jasaAirTersedia}
			/>
		{:else}
		<div class="bg-blue-50 border border-blue-200 rounded-lg p-3 flex gap-2 text-xs text-blue-800">
			<IconInfoCircle size={16} class="shrink-0 mt-0.5" />
			<span>Harga di sini adalah acuan tier, bukan penawaran resmi. Untuk penawaran final, konfirmasi ke admin — harga bisa berubah karena kurs & stok.</span>
		</div>

		<!-- Search Barang -->
		<div class="relative">
			<label for="produk-search" class="text-xs font-semibold text-gray-500 mb-1 block">Cari Barang</label>
			<div class="relative">
				<IconSearch size={18} class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
				<input
					id="produk-search"
					type="text"
					bind:value={produkQuery}
					oninput={onProdukInput}
					placeholder="Ketik nama barang…"
					class="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
				/>
				{#if produkLoading}
					<IconLoader2 size={18} class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
				{/if}
			</div>
			{#if produkOptions.length > 0}
				<div class="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
					{#each produkOptions as p}
						<button
							type="button"
							onclick={() => pilihProduk(p)}
							class="w-full text-left px-4 py-3 hover:bg-gray-50 border-b last:border-0 text-sm"
						>
							{p.nama}
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Search Customer (opsional) -->
		<div class="relative">
			<label for="customer-search" class="text-xs font-semibold text-gray-500 mb-1 block">Customer (opsional)</label>
			<div class="relative">
				<IconBuildingStore size={18} class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
				<input
					id="customer-search"
					type="text"
					bind:value={customerQuery}
					oninput={onCustomerInput}
					placeholder="Ketik nama/kode customer… (kosongkan untuk harga umum)"
					class="w-full pl-10 pr-9 py-3 border border-gray-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
				/>
				{#if customerLoading}
					<IconLoader2 size={18} class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 animate-spin" />
				{:else if selectedCustomer}
					<button type="button" onclick={clearCustomer} class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" aria-label="Hapus customer">
						<IconX size={18} />
					</button>
				{/if}
			</div>
			{#if customerOptions.length > 0}
				<div class="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg max-h-64 overflow-y-auto">
					{#each customerOptions as c}
						<button
							type="button"
							onclick={() => pilihCustomer(c)}
							class="w-full text-left px-4 py-3 hover:bg-gray-50 border-b last:border-0 text-sm"
						>
							<div class="font-medium text-gray-900">{c.customer_name}</div>
							<div class="text-xs text-gray-400">{c.kode_customer}</div>
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Hasil -->
		{#if hasilLoading}
		<div class="flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat kalkulasi harga produk..." />
		</div>
		{:else if hasil && selectedProduk}
			<div class="bg-white border border-gray-200 rounded-2xl p-4 space-y-3">
				<div class="text-sm font-semibold text-gray-900">{selectedProduk.nama}</div>

				{#if hasil.hargaTier}
					<div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
						<div class="text-xs text-emerald-700 font-semibold mb-0.5">{sumberLabel[hasil.sumber]} {hasil.tierLabel ? `(${hasil.tierLabel})` : ''}</div>
						<div class="text-xl font-bold text-emerald-800">{fmtRp(hasil.hargaTier)}</div>
					</div>
				{:else if hasil.hargaMaster}
					<div class="bg-blue-50 border border-blue-200 rounded-xl p-3">
						<div class="text-xs text-blue-700 font-semibold mb-0.5">📋 Harga Master</div>
						<div class="text-xl font-bold text-blue-800">{fmtRp(hasil.hargaMaster)}</div>
					</div>
				{:else}
					<div class="bg-gray-50 border border-gray-200 rounded-xl p-3 text-sm text-gray-500">
						Belum ada harga tier/master untuk barang ini — pakai histori di bawah sebagai acuan, atau konfirmasi ke admin.
					</div>
				{/if}

				{#if hasil.hargaTerakhir}
					<div class="border-t pt-3">
						<div class="text-xs text-gray-500 mb-1">
							{selectedCustomer ? `Terakhir ke ${selectedCustomer.customer_name}` : 'Harga terakhir (semua customer)'}
						</div>
						<div class="text-sm text-gray-800">
							<span class="font-semibold">{fmtRp(hasil.hargaTerakhir)}</span>
							<span class="text-gray-400"> · {fmtTanggal(hasil.tanggalTerakhir)}</span>
						</div>
						{#if hasil.hargaRataRata && hasil.jumlahSO > 1}
							<div class="text-xs text-gray-500 mt-1">
								Rata-rata: {fmtRp(hasil.hargaRataRata)} ({hasil.jumlahSO} SO)
							</div>
						{/if}
					</div>
				{/if}

				{#if hasil.lantai}
					<div class="border-t pt-3 text-xs text-gray-500">
						🔒 Lantai harga (jangan jual di bawah ini tanpa alasan): <span class="font-semibold text-gray-700">{fmtRp(hasil.lantai)}</span>
					</div>
				{/if}
			</div>
		{:else if selectedProduk}
			<div class="text-center py-10 text-gray-400 text-sm">Tidak ada data harga untuk barang ini.</div>
		{/if}
		{/if}
	</div>
</div>
