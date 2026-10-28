<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconLoader2, IconAlertCircle, IconCheck, IconX, IconClock } from '@tabler/icons-svelte';
	import { getRequisitionDetail, REQUISITION_STATUS_LABEL, REQUISITION_ITEM_STATUS_LABEL } from '$lib/services/requisitionApi';

	let loading = $state(true);
	let error = $state<string | null>(null);
	let requisition = $state<any>(null);

	const STEPS = [
		{ key: 'submitted_dept', label: 'Diajukan' },
		{ key: 'approved_pending_inventory', label: 'Disetujui' },
		{ key: 'inventory_processing', label: 'Diproses Gudang' },
		{ key: 'fulfilled', label: 'Selesai' }
	];

	function stepIndex(status: string) {
		if (status === 'rejected' || status === 'cancelled') return -1;
		if (status === 'draft') return -1;
		if (['needs_purchase_pending', 'partially_fulfilled'].includes(status)) return 2;
		const idx = STEPS.findIndex((s) => s.key === status);
		return idx >= 0 ? idx : 0;
	}

	function formatCurrency(v: number) {
		return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v || 0);
	}

	onMount(async () => {
		try {
			requisition = await getRequisitionDetail(page.params.id);
		} catch (e: any) {
			error = e?.message || 'Gagal memuat detail pengajuan';
		} finally {
			loading = false;
		}
	});
</script>

<div class="p-4 max-w-2xl mx-auto">
	<button class="flex items-center gap-1 text-sm text-gray-500 mb-3" onclick={() => goto('/requisition')}>
		<IconArrowLeft size={18} /> Kembali
	</button>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat rincian requisition..." />
		</div>
	{:else if error}
		<div class="flex items-center gap-2 bg-red-50 text-red-700 p-3 rounded-lg text-sm">
			<IconAlertCircle size={18} /> {error}
		</div>
	{:else if requisition}
		<h1 class="text-lg font-semibold mb-1">{requisition.requisition_number}</h1>
		<p class="text-sm text-gray-500 mb-4">
			{requisition.requisition_type === 'project_material' ? 'Material Proyek' : 'Kebutuhan Internal'} ·
			{formatCurrency(requisition.total_amount)}
		</p>

		{#if requisition.status === 'rejected'}
			<div class="flex items-start gap-2 bg-red-50 text-red-700 p-3 rounded-lg text-sm mb-4">
				<IconX size={18} class="mt-0.5 flex-shrink-0" />
				<div>
					<div class="font-medium">Pengajuan Ditolak</div>
					{#if requisition.rejection_note}<div class="text-xs mt-0.5">{requisition.rejection_note}</div>{/if}
				</div>
			</div>
		{:else if requisition.status === 'cancelled'}
			<div class="bg-gray-100 text-gray-600 p-3 rounded-lg text-sm mb-4">Pengajuan dibatalkan.</div>
		{:else}
			<div class="flex items-center mb-6">
				{#each STEPS as step, idx (step.key)}
					{@const active = idx <= stepIndex(requisition.status)}
					<div class="flex-1 flex flex-col items-center relative">
						{#if idx > 0}
							<div class="absolute top-3 right-1/2 w-full h-0.5 {active ? 'bg-blue-600' : 'bg-gray-200'}" style="left:-50%;"></div>
						{/if}
						<div class="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs relative z-10 {active ? 'bg-blue-600' : 'bg-gray-300'}">
							{#if active}<IconCheck size={14} />{:else}<IconClock size={14} />{/if}
						</div>
						<span class="text-[10px] text-center mt-1 {active ? 'text-blue-700 font-medium' : 'text-gray-400'}">{step.label}</span>
					</div>
				{/each}
			</div>
		{/if}

		<div class="mb-2 text-sm font-medium">
			Status: <span class="font-normal">{REQUISITION_STATUS_LABEL[requisition.status] || requisition.status}</span>
		</div>

		{#if requisition.tujuan_penggunaan}
			<div class="text-sm text-gray-600 mb-4">{requisition.tujuan_penggunaan}</div>
		{/if}

		<div class="text-sm font-medium mb-2">Item Barang</div>
		<div class="space-y-2">
			{#each requisition.items || [] as item (item.id)}
				<div class="border rounded-lg p-3 flex items-center justify-between">
					<div>
						<div class="text-sm font-medium">{item.nama_barang}</div>
						<div class="text-xs text-gray-500">{item.quantity_requested} {item.units}</div>
					</div>
					<span class="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
						{REQUISITION_ITEM_STATUS_LABEL[item.item_status] || item.item_status}
					</span>
				</div>
			{/each}
		</div>
	{/if}
</div>
