<!-- src/routes/(app)/panduan/alur/+page.svelte -->
<!-- Panduan Alur Bisnis (lapangan). Deep-link: /panduan/alur?fokus=<id langkah>, mis. ?fokus=survey.
     Sumber: Directus (dikelola dari erp-epi /settings/process-guidance) → salinan terakhir yang tersimpan → salinan bawaan app.
     Tampil seketika dari salinan lokal; diganti data Directus hanya bila isinya berbeda (tidak mereset yang sedang dibuka). -->
<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { PROCESS_FLOWS, type ProcessFlow } from '$lib/data/processGuidance';
	import { loadProcessFlows, type FlowSource } from '$lib/services/processGuidanceFlowsApi';
	import ProcessGuidanceMobile from '$lib/components/help/ProcessGuidanceMobile.svelte';

	let flows = $state<ProcessFlow[]>(PROCESS_FLOWS);
	let sumber = $state<FlowSource>('local');
	let swap = $state(0);
	let flowId = $state(PROCESS_FLOWS[0]?.id ?? '');
	let flow = $derived(flows.find((f) => f.id === flowId) ?? flows[0] ?? null);
	const fokus = page.url.searchParams.get('fokus') ?? '';

	onMount(async () => {
		const r = await loadProcessFlows();
		sumber = r.source;
		if (JSON.stringify(r.flows) !== JSON.stringify(flows)) {
			flows = r.flows;
			if (!flows.some((f) => f.id === flowId)) flowId = flows[0]?.id ?? '';
			swap += 1; // muat ulang daftar langkah hanya bila isinya memang berubah
		}
	});
</script>

<svelte:head>
	<title>Alur Kerja — Project EPI</title>
</svelte:head>

<div class="flex flex-col min-h-screen bg-gray-50 pb-6">
	<div class="bg-white border-b border-gray-200 px-4 py-4">
		<a href="/bantuan" class="text-xs text-gray-500">← Bantuan</a>
		<h1 class="text-lg font-bold text-gray-900 mt-1">🗺️ Alur Kerja</h1>
		<p class="text-xs text-gray-500 mt-0.5">{flow?.description ?? ''}</p>
		{#if flows.length > 1}
			<select bind:value={flowId} class="mt-2 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white" aria-label="Pilih alur">
				{#each flows as f (f.id)}<option value={f.id}>{f.title}</option>{/each}
			</select>
		{/if}
		{#if sumber === 'cached'}
			<p class="mt-2 text-[11px] text-amber-600">📡 Tidak bisa terhubung — menampilkan salinan terakhir yang tersimpan di perangkat ini.</p>
		{/if}
	</div>

	<div class="p-4">
		{#key `${flowId}:${swap}`}
			<ProcessGuidanceMobile {flow} {fokus} />
		{/key}
	</div>
</div>
