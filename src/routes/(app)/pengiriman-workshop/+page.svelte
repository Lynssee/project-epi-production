<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		fetchMyWorkshopDeliveries,
		STAGE_LABEL,
		STAGE_COLOR,
		type WsDeliveryBatch
	} from '$lib/services/workshopDeliveryApi';
	import {
		IconLoader2,
		IconAlertTriangle,
		IconTruckDelivery,
		IconChevronRight,
		IconBuildingWarehouse
	} from '@tabler/icons-svelte';

	let list = $state<WsDeliveryBatch[]>([]);
	let loading = $state(true);
	let errorMsg = $state('');
	let filterWs = $state<'all' | 'ciketing' | 'balaraja'>('all');

	const WS_LABEL: Record<string, string> = { ciketing: 'WS Ciketing', balaraja: 'MB Balaraja' };

	onMount(load);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			list = await fetchMyWorkshopDeliveries();
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat data pengiriman workshop.';
		} finally {
			loading = false;
		}
	}

	const shown = $derived(filterWs === 'all' ? list : list.filter((b) => b.workshop === filterWs));

	function fmtRp(n: number) {
		return 'Rp' + Math.round(n || 0).toLocaleString('id-ID');
	}
	function fmtDate(s: string | null) {
		if (!s) return '-';
		return new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
	}
</script>

<div class="w-full p-4 pb-24">
	<div class="mb-4">
		<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Pengiriman Workshop</h1>
		<p class="text-[11px]" style="color: var(--sys-label3)">
			Status SJ Keluar & penagihan barang dari WS Ciketing / MB Balaraja untuk proyek Anda (hanya-baca).
		</p>
	</div>

	<div class="flex gap-1.5 mb-3">
		{#each [['all', 'Semua'], ['ciketing', 'Ciketing'], ['balaraja', 'Balaraja']] as [val, label]}
			<button
				class="h-8 px-3 rounded-lg text-[11px] font-semibold border"
				style="border-color: var(--sys-sep); {filterWs === val ? 'background: var(--p, var(--g)); color: #fff; border-color: transparent;' : 'color: var(--sys-label3)'}"
				onclick={() => (filterWs = val as typeof filterWs)}
			>{label}</button>
		{/each}
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat pengiriman workshop..." />
		</div>
	{:else if errorMsg}
		<div class="p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-red-700 text-[12px]">
			<IconAlertTriangle size={18} class="shrink-0 mt-0.5 text-red-500" />
			<div>{errorMsg}</div>
		</div>
	{:else if shown.length === 0}
		<div class="text-center py-16">
			<IconTruckDelivery size={32} style="color: var(--sys-label4); margin: 0 auto" />
			<p class="text-[12px] mt-2" style="color: var(--sys-label3)">Belum ada pengiriman workshop untuk proyek Anda.</p>
		</div>
	{:else}
		<div class="flex flex-col gap-2">
			{#each shown as b (b.workshop + b.key)}
				<button
					class="w-full p-3.5 rounded-xl border flex items-start justify-between gap-2 text-left"
					style="border-color: var(--sys-sep)"
					onclick={() => goto(`/pengiriman-workshop/detail?w=${b.workshop}&k=${encodeURIComponent(b.key)}`)}
				>
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2 flex-wrap">
							<span class="text-[13px] font-semibold truncate" style="color: var(--sys-label)">{b.no_sj}</span>
							<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 flex items-center gap-0.5">
								<IconBuildingWarehouse size={10} />{WS_LABEL[b.workshop]}
							</span>
						</div>
						<div class="text-[11px] truncate mt-0.5" style="color: var(--sys-label3)">
							{b.project_name} · {b.item_count} item · {fmtDate(b.tanggal)}
						</div>
						<div class="text-[11px] mt-0.5" style="color: var(--sys-label3)">
							Nilai {fmtRp(b.nilai_total)}
							{#if b.invoice}
								· Inv {b.invoice.invoice_number}
								{#if b.invoice.is_partial} <span class="text-amber-600">(parsial ke-{b.invoice.delivery_sequence})</span>{/if}
							{/if}
						</div>
						{#if b.stage === 'ditahan' && b.hold_reason}
							<div class="mt-1 text-[10px] px-2 py-1 rounded bg-red-50 text-red-700 border border-red-100">
								Alasan ditahan: {b.hold_reason}
							</div>
						{/if}
					</div>
					<div class="flex flex-col items-end gap-1 shrink-0">
						<span class="text-[9px] font-bold px-2 py-1 rounded-full text-center {STAGE_COLOR[b.stage]}">
							{STAGE_LABEL[b.stage]}
						</span>
						<IconChevronRight size={16} style="color: var(--sys-label4)" />
					</div>
				</button>
			{/each}
		</div>
	{/if}
</div>
