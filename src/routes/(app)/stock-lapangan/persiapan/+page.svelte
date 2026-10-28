<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getPersiapanHarian, type PersiapanHarian } from '$lib/services/stockLapangan';
	import { getAntrianList } from '$lib/services/gudangAntrian';
	import { getProgressMap } from '$lib/services/persiapanProgress';
	import { loadInventorySettings, getInventorySetting } from '$lib/services/inventorySettings';
	import { IconArrowLeft, IconLoader2, IconClipboardList, IconBuildingFactory2, IconTruckDelivery, IconChevronRight } from '@tabler/icons-svelte';

	let canAccess = $derived(
		hasPermission($authStore.roleId, 'input_stock_lapangan', $rolesStore) ||
		hasPermission($authStore.roleId, 'view_stock_lapangan', $rolesStore)
	);

	$effect(() => {
		const checked = $authStore.checked;
		if (checked && !canAccess) goto('/');
	});

	let loading = $state(true);
	let hubEnabled = $state(true);
	let gudangHqEnabled = $state(false);
	let data = $state<PersiapanHarian>({ reorderAlerts: [], spkReservations: [], packingPipeline: [], jatahEligible: [] });
	let antrianCount = $state(0);
	let lajur1SiapCount = $state(0);

	// Lajur 1: bahan baku untuk produksi — reservasi SPK (dikelompokkan per SPK) + reorder alert.
	let spkCount = $derived.by(() => new Set(data.spkReservations.map((r) => r.spkId)).size);
	let lajur1Total = $derived(data.spkReservations.length + data.reorderAlerts.length);
	let lajur1Pending = $derived(Math.max(lajur1Total - lajur1SiapCount, 0));

	onMount(async () => {
		await loadInventorySettings();
		hubEnabled = getInventorySetting('inventory.persiapan.hub_enabled');
		gudangHqEnabled = getInventorySetting('inventory.gudang_hq.enabled');

		data = await getPersiapanHarian();
		if (gudangHqEnabled) {
			const antrian = await getAntrianList();
			antrianCount = antrian.length;
		}

		const spkIds = data.spkReservations.map((r) => r.spkId);
		const reorderIds = data.reorderAlerts.map((r) => `reorder-${r.itemId}`);
		const progress = await getProgressMap('bahan_baku_spk', [...spkIds, ...reorderIds]);
		lajur1SiapCount = [...progress.values()].filter((p) => p.status === 'siap').length;

		loading = false;
	});
</script>

<div class="max-w-2xl mx-auto p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/stock-lapangan')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	<h1 class="text-[16px] font-bold flex items-center gap-2 mb-1" style="color: var(--sys-label)">
		<IconClipboardList size={18} /> Persiapan
	</h1>
	<p class="text-[11px] mb-4" style="color: var(--sys-label3)">
		Pilih lajur sesuai tujuan barang.
	</p>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat persiapan barang..." />
		</div>
	{:else if !hubEnabled}
		<div class="rounded-xl border p-6 text-center" style="border-color: var(--sys-sep)">
			<p class="text-[12.5px]" style="color: var(--sys-label)">Hub Persiapan belum diaktifkan.</p>
			<p class="text-[11px] mt-1" style="color: var(--sys-label3)">
				Hubungi admin untuk mengaktifkan setelan <code>inventory.persiapan.hub_enabled</code>.
			</p>
		</div>
	{:else}
		<div class="space-y-3">
			<button
				class="w-full text-left p-4 rounded-xl border flex items-center gap-3"
				style="border-color: var(--sys-sep)"
				onclick={() => goto('/stock-lapangan/persiapan/bahan-baku')}
			>
				<div class="shrink-0 w-11 h-11 rounded-full flex items-center justify-center lajur-icon lajur-biru">
					<IconBuildingFactory2 size={20} />
				</div>
				<div class="min-w-0 flex-1">
					<p class="text-[13.5px] font-bold" style="color: var(--sys-label)">Bahan Baku → Produksi</p>
					<p class="text-[11px]" style="color: var(--sys-label3)">
						{lajur1SiapCount}/{lajur1Total} siap · {spkCount} SPK
					</p>
				</div>
				{#if lajur1Pending > 0}
					<span class="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">{lajur1Pending}</span>
				{/if}
				<IconChevronRight size={16} class="shrink-0" style="color: var(--sys-label4)" />
			</button>

			<button
				class="w-full text-left p-4 rounded-xl border flex items-center gap-3"
				style="border-color: var(--sys-sep)"
				onclick={() => goto('/stock-lapangan/persiapan/finish-good')}
			>
				<div class="shrink-0 w-11 h-11 rounded-full flex items-center justify-center lajur-icon lajur-hijau">
					<IconTruckDelivery size={20} />
				</div>
				<div class="min-w-0 flex-1">
					<p class="text-[13.5px] font-bold" style="color: var(--sys-label)">Finish Good → Kirim</p>
					<p class="text-[11px]" style="color: var(--sys-label3)">Barang jadi untuk dikirim ke proyek/customer</p>
				</div>
				<IconChevronRight size={16} class="shrink-0" style="color: var(--sys-label4)" />
			</button>

			{#if gudangHqEnabled}
				<button
					class="w-full text-left p-4 rounded-xl border flex items-center gap-3"
					style="border-color: var(--sys-sep)"
					onclick={() => goto('/stock-lapangan/antrian')}
				>
					<div class="shrink-0 w-11 h-11 rounded-full flex items-center justify-center lajur-icon lajur-oranye">
						<IconClipboardList size={20} />
					</div>
					<div class="min-w-0 flex-1">
						<p class="text-[13.5px] font-bold" style="color: var(--sys-label)">Packing List</p>
						<p class="text-[11px]" style="color: var(--sys-label3)">Proyek, Maintenance & Internal — Gudang Pusat</p>
					</div>
					{#if antrianCount > 0}
						<span class="shrink-0 min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">{antrianCount}</span>
					{/if}
					<IconChevronRight size={16} class="shrink-0" style="color: var(--sys-label4)" />
				</button>
			{/if}
		</div>

		{#if data.jatahEligible.length > 0}
			<div class="mt-5">
				<div class="section-header mt-0 mb-2 text-[13px]">Jatah Barang</div>
				<div class="rounded-xl border overflow-hidden" style="border-color: var(--sys-sep)">
					{#each data.jatahEligible as item, idx (idx)}
						<div class="p-3 border-b last:border-b-0" style="border-color: var(--sys-sep)">
							<p class="text-[12.5px] font-medium truncate" style="color: var(--sys-label)">{item.namaBarang}</p>
							<p class="text-[10.5px]" style="color: var(--sys-label3)">{item.nama} · {item.qtyJatah} {item.satuan}</p>
						</div>
					{/each}
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	/* Dark mode gudang (cahaya minim): latar pastel terang diganti overlay transparan +
	   warna ikon yang dinaikkan kecerahannya, pola sama dengan ProjectCharterTab.svelte. */
	.lajur-icon.lajur-biru { background: #EFF6FF; color: #2563EB; }
	.lajur-icon.lajur-hijau { background: #ECFDF5; color: #16A34A; }
	.lajur-icon.lajur-oranye { background: #FFF7ED; color: #EA580C; }

	:global([data-theme='dark']) .lajur-icon.lajur-biru { background: rgba(59, 130, 246, 0.16); color: #7FC0EC; }
	:global([data-theme='dark']) .lajur-icon.lajur-hijau { background: rgba(52, 201, 140, 0.16); color: #6FE3B4; }
	:global([data-theme='dark']) .lajur-icon.lajur-oranye { background: rgba(234, 88, 12, 0.18); color: #F5A16A; }
</style>
