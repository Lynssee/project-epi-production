<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Kartu ringkas Kepatuhan Klien (WPO) — Pertajam Fase Planning Fase 2, sisi lapangan.
	// READ-ONLY: PL hanya melihat status, upload/assign profil tetap lewat ERP.
	// Data dibaca dari cache yang ditulis admin erp-epi (client_compliance_evaluation).
	import { onMount } from 'svelte';
	import { getClientComplianceSummary, type ClientComplianceSummary } from '$lib/services/clientCompliance';
	import { IconFileCheck, IconLoader2 } from '@tabler/icons-svelte';

	let { projectId }: { projectId: number | string } = $props();

	let loading = $state(true);
	let data = $state<ClientComplianceSummary | null>(null);

	onMount(async () => {
		loading = true;
		data = await getClientComplianceSummary(projectId);
		loading = false;
	});

	let unmetRequired = $derived(
		(data?.items_snapshot || []).filter((i) => i.is_required && i.status === 'failed')
	);
	let badgeColor = $derived(
		!data ? { bg: 'var(--sys-fill)', fg: 'var(--sys-label3)' }
		: data.score >= 100 ? { bg: 'var(--gl)', fg: 'var(--gd)' }
		: data.score >= 50 ? { bg: 'var(--pl)', fg: 'var(--pd)' }
		: { bg: 'var(--rel)', fg: 'var(--re)' }
	);
</script>

<div class="card-section">
	<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-3" style="color: var(--sys-label)">
		<IconFileCheck size={16} style="color: var(--g)" /> Kepatuhan Klien (WPO)
	</h4>

	{#if loading}
		<CircularProgressGauge size={44} strokeWidth={3} label="Memeriksa status kepatuhan WPO..." />
	{:else if !data}
		<p class="text-[12px]" style="color: var(--sys-label3)">Belum pernah dievaluasi admin. Status akan muncul setelah admin membuka tab Kepatuhan Klien di ERP.</p>
	{:else}
		<div class="flex items-center justify-between mb-2.5">
			<span class="text-[12px]" style="color: var(--sys-label3)">Kelengkapan: {data.passed}/{data.total} syarat wajib</span>
			<span class="text-[11px] font-bold px-2 py-0.5 rounded-full" style="background: {badgeColor.bg}; color: {badgeColor.fg}">{data.score}%</span>
		</div>
		<div class="h-1.5 rounded-full overflow-hidden mb-3" style="background: var(--sys-fill)">
			<div class="h-full rounded-full" style="width: {data.score}%; background: {data.score >= 100 ? 'var(--g)' : data.score >= 50 ? 'var(--p)' : 'var(--re)'}"></div>
		</div>
		{#if unmetRequired.length > 0}
			<p class="text-[11px] font-semibold mb-1.5" style="color: var(--sys-label3)">Belum terpenuhi:</p>
			<ul class="flex flex-col gap-1">
				{#each unmetRequired as it (it.id)}
					<li class="text-[12px]" style="color: var(--re)">• {it.label}</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>
