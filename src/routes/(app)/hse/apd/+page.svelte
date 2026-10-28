<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { fetchMyApdDistribution, confirmApdReceipt, type HseApdDistribution } from '$lib/services/hse';
	import { IconArrowLeft, IconCheck } from '@tabler/icons-svelte';

	let items = $state<HseApdDistribution[]>([]);
	let loading = $state(true);
	let confirming = $state<number | null>(null);

	async function load() {
		loading = true;
		items = await fetchMyApdDistribution($authStore.karyawanId ?? 0);
		loading = false;
	}

	onMount(load);

	async function confirm(id: number) {
		confirming = id;
		try {
			await confirmApdReceipt(id);
			await load();
		} finally {
			confirming = null;
		}
	}

	const statusLabel: Record<string, string> = { aktif: 'Aktif', kedaluwarsa: 'Kedaluwarsa', diganti: 'Diganti' };
</script>

<div class="scroll-body">
	<div class="w-full p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/hse')}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">🦺 APD Saya</h1>
		</div>

		{#if loading}
			<CircularProgressGauge size={48} strokeWidth={4} label="Memuat data APD..." />
		{:else if items.length === 0}
			<p class="text-[12px] text-center py-8" style="color: var(--sys-label-2)">Belum ada APD yang didistribusikan ke Anda.</p>
		{:else}
			<div class="space-y-3">
				{#each items as item (item.id)}
					<div class="rounded-xl p-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
						<div class="flex items-center justify-between">
							<p class="text-[13px] font-bold" style="color: var(--sys-label)">{item.apd_id?.nama_apd} × {item.qty}</p>
							<span class="text-[10px] px-2 py-0.5 rounded-full" style="background: var(--rel); color: var(--sys-label-2)">{statusLabel[item.status] || item.status}</span>
						</div>
						<p class="text-[11px] mt-1" style="color: var(--sys-label-2)">
							Terbit: {item.tanggal_terbit || '-'} · Kedaluwarsa: {item.tanggal_kedaluwarsa || '-'}
						</p>
						{#if item.ttd_terima}
							<p class="text-[12px] mt-2 font-semibold" style="color: var(--ggd)">✓ Sudah dikonfirmasi diterima</p>
						{:else}
							<button
								class="w-full mt-2 rounded-lg py-2 text-[12px] font-semibold text-white flex items-center justify-center gap-1 disabled:opacity-50"
								style="background: var(--g)"
								disabled={confirming === item.id}
								onclick={() => confirm(item.id)}
							>
								<IconCheck size={14} />
								{confirming === item.id ? 'Menyimpan...' : 'Konfirmasi Terima (TTD)'}
							</button>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
