<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { IconPlus, IconLoader2, IconClipboardList, IconAlertCircle } from '@tabler/icons-svelte';
	import { listMyRequisitions, REQUISITION_STATUS_LABEL } from '$lib/services/requisitionApi';

	let loading = $state(true);
	let error = $state<string | null>(null);
	let requisitions = $state<any[]>([]);

	onMount(async () => {
		try {
			requisitions = await listMyRequisitions();
		} catch (e: any) {
			error = e?.message || 'Gagal memuat daftar pengajuan';
		} finally {
			loading = false;
		}
	});

	function statusBadgeClass(status: string) {
		if (status === 'fulfilled') return 'bg-green-100 text-green-700';
		if (status === 'rejected' || status === 'cancelled') return 'bg-red-100 text-red-700';
		if (status === 'partially_fulfilled' || status === 'needs_purchase_pending') return 'bg-amber-100 text-amber-700';
		return 'bg-blue-100 text-blue-700';
	}

	function formatCurrency(v: number) {
		return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(v || 0);
	}
</script>

<div class="p-4 max-w-2xl mx-auto">
	<div class="flex items-center justify-between mb-4">
		<h1 class="text-lg font-semibold flex items-center gap-2">
			<IconClipboardList size={22} /> Pengajuan Barang Saya
		</h1>
		<button
			class="flex items-center gap-1 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium"
			onclick={() => goto('/requisition/new')}
		>
			<IconPlus size={18} /> Baru
		</button>
	</div>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat requisition barang..." />
		</div>
	{:else if error}
		<div class="flex items-center gap-2 bg-red-50 text-red-700 p-3 rounded-lg text-sm">
			<IconAlertCircle size={18} /> {error}
		</div>
	{:else if requisitions.length === 0}
		<div class="text-center text-gray-400 py-10 text-sm">Belum ada pengajuan barang.</div>
	{:else}
		<div class="space-y-2">
			{#each requisitions as r (r.id)}
				<button
					class="w-full text-left border rounded-lg p-3 bg-white hover:bg-gray-50 transition"
					onclick={() => goto(`/requisition/${r.id}`)}
				>
					<div class="flex items-center justify-between">
						<span class="font-medium text-sm">{r.requisition_number}</span>
						<span class="text-xs px-2 py-0.5 rounded-full {statusBadgeClass(r.status)}">
							{REQUISITION_STATUS_LABEL[r.status] || r.status}
						</span>
					</div>
					<div class="text-xs text-gray-500 mt-1">
						{r.requisition_type === 'project_material' ? 'Material Proyek' : 'Kebutuhan Internal'} ·
						{formatCurrency(r.total_amount)}
					</div>
					{#if r.tanggal_dibutuhkan}
						<div class="text-xs text-gray-400 mt-0.5">Dibutuhkan: {r.tanggal_dibutuhkan}</div>
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
