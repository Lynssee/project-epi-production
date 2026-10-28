<!-- src/routes/(app)/proyek/[project_id]/itp/+page.svelte -->
<!-- Daftar ITP ditugaskan ke proyek ini (Quality Management Proyek v2, Fase 3 — 10 Agustus 2026). -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getProjectById } from '$lib/services/projects';
	import { fetchProjectItpList } from '$lib/services/projectItpApi';
	import { IconArrowLeft, IconLoader2 } from '@tabler/icons-svelte';

	let projectId = $derived($page.params.project_id as string);
	let loading = $state(true);
	let project = $state<any>(null);
	let itpList = $state<any[]>([]);

	const STATUS_LABEL: Record<string, string> = { assigned: 'Belum Mulai', in_progress: 'Berjalan', completed: 'Selesai' };
	const STATUS_COLOR: Record<string, string> = {
		assigned: 'bg-gray-100 text-gray-600',
		in_progress: 'bg-blue-100 text-blue-700',
		completed: 'bg-green-100 text-green-700'
	};

	onMount(async () => {
		loading = true;
		try {
			const [proj, list] = await Promise.all([getProjectById(projectId), fetchProjectItpList(Number(projectId))]);
			project = proj;
			itpList = list as any[];
		} finally {
			loading = false;
		}
	});
</script>

<div class="mx-auto max-w-lg p-4 pb-24">
	<button class="mb-3 flex items-center gap-1 text-sm text-gray-500" onclick={() => goto(`/proyek/${projectId}`)}>
		<IconArrowLeft size={16} /> Kembali ke Proyek
	</button>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-14">
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat Inspection & Test Plan (ITP)..." />
	</div>
	{:else}
		<h1 class="text-lg font-bold text-gray-900">ITP — Inspection Test Plan</h1>
		<p class="mb-4 text-sm text-gray-500">{project?.name || '-'}</p>

		<div class="space-y-2">
			{#each itpList as itp (itp.id)}
				<button
					class="w-full rounded-lg border border-gray-100 bg-white p-3 text-left text-xs"
					onclick={() => goto(`/proyek/${projectId}/itp/${itp.id}`)}
				>
					<div class="flex items-center justify-between">
						<span class="font-semibold text-gray-800">{itp.template_id?.name || '-'}</span>
						<span class="rounded-full px-2 py-0.5 {STATUS_COLOR[itp.status] || 'bg-gray-100'}">{STATUS_LABEL[itp.status] || itp.status}</span>
					</div>
				</button>
			{:else}
				<p class="text-xs text-gray-400">Belum ada ITP ditugaskan ke proyek ini.</p>
			{/each}
		</div>
	{/if}
</div>
