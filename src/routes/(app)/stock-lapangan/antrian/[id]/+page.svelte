<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getAntrianDetail, type AntrianDetail } from '$lib/services/gudangAntrian';
	import { IconArrowLeft, IconLoader2, IconPackage, IconCircleFilled, IconPackageExport } from '@tabler/icons-svelte';

	let canAccess = $derived(
		hasPermission($authStore.roleId, 'input_stock_lapangan', $rolesStore) ||
		hasPermission($authStore.roleId, 'view_stock_lapangan', $rolesStore)
	);

	$effect(() => {
		const checked = $authStore.checked;
		if (checked && !canAccess) goto('/');
	});

	let packingListId = $derived(Number($page.params.id));
	let loading = $state(true);
	let detail = $state<AntrianDetail | null>(null);

	onMount(async () => {
		detail = await getAntrianDetail(packingListId);
		loading = false;
	});

	function stokColor(level: string) {
		switch (level) {
			case 'hijau': return '#16A34A';
			case 'kuning': return '#D97706';
			case 'merah': return '#DC2626';
			default: return '#94A3B8';
		}
	}

	function stokLabel(level: string) {
		switch (level) {
			case 'hijau': return 'Cukup';
			case 'kuning': return 'Kurang';
			case 'merah': return 'Habis';
			default: return 'Tidak diketahui';
		}
	}

	function formatDate(d: string | null) {
		if (!d) return '-';
		try {
			return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
		} catch {
			return d;
		}
	}
</script>

<div class="max-w-2xl mx-auto p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/stock-lapangan/antrian')}>
		<IconArrowLeft size={15} /> Kembali ke Antrian
	</button>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat detail antrian..." />
		</div>
	{:else if !detail}
		<div class="rounded-xl border p-8 text-center" style="border-color: var(--sys-sep)">
			<p class="text-[12px]" style="color: var(--sys-label3)">Antrian tidak ditemukan.</p>
		</div>
	{:else}
		<div class="rounded-xl border p-4 mb-4" style="border-color: var(--sys-sep)">
			<h1 class="text-[15px] font-bold mb-1" style="color: var(--sys-label)">{detail.nomorPl}</h1>
			<p class="text-[11px]" style="color: var(--sys-label3)">
				{detail.requestedByDepartment || 'Tanpa departemen'} · {detail.destinationPicName || 'Tanpa PIC'}
			</p>
			<div class="flex items-center gap-4 mt-3">
				<div>
					<p class="text-[9.5px] uppercase font-bold" style="color: var(--sys-label4)">Butuh Tanggal</p>
					<p class="text-[12px] font-medium" style="color: var(--sys-label)">{formatDate(detail.neededDate)}</p>
				</div>
				<div>
					<p class="text-[9.5px] uppercase font-bold" style="color: var(--sys-label4)">Prioritas</p>
					<p class="text-[12px] font-medium capitalize" style="color: var(--sys-label)">{detail.priority}</p>
				</div>
				<div>
					<p class="text-[9.5px] uppercase font-bold" style="color: var(--sys-label4)">Status Persiapan</p>
					<p class="text-[12px] font-medium capitalize" style="color: var(--sys-label)">{detail.prepStatus}</p>
				</div>
			</div>
		</div>

		{#if detail.prepStatus !== 'dispatched'}
			<button
				class="w-full h-11 mb-4 rounded-xl text-[13px] font-bold text-white flex items-center justify-center gap-2"
				style="background: var(--g)"
				onclick={() => goto(`/stock-lapangan/antrian/${packingListId}/pick`)}
			>
				<IconPackageExport size={17} /> Mulai Picking
			</button>
		{/if}

		<div class="flex items-center gap-2 mb-2 px-1">
			<IconPackage size={15} style="color: var(--sys-label3)" />
			<h2 class="text-[13px] font-bold" style="color: var(--sys-label)">Item ({detail.items.length})</h2>
		</div>

		<div class="rounded-xl border overflow-hidden" style="border-color: var(--sys-sep)">
			{#if detail.items.length === 0}
				<p class="p-4 text-[12px] text-center" style="color: var(--sys-label3)">Tidak ada item pada packing list ini.</p>
			{:else}
				{#each detail.items as item (item.id)}
					<div class="p-3 border-b last:border-b-0 flex items-center justify-between gap-3" style="border-color: var(--sys-sep)">
						<div class="min-w-0 flex-1">
							<p class="text-[12.5px] font-medium truncate" style="color: var(--sys-label)">{item.namaBarang}</p>
							<p class="text-[10.5px]" style="color: var(--sys-label3)">
								Diminta {item.qtyRequired} {item.unit} · Terkirim {item.qtyDelivered} {item.unit}
							</p>
						</div>
						<div class="shrink-0 flex items-center gap-1.5">
							<IconCircleFilled size={9} style="color: {stokColor(item.stokLevel)}" />
							<span class="text-[10.5px] font-medium" style="color: {stokColor(item.stokLevel)}">{stokLabel(item.stokLevel)}</span>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	{/if}
</div>
