<script lang="ts">
	// R6 (Forecast Keuangan Global, rekomendasi laporan) — traffic light kesehatan keuangan
	// proyek, dipasang di header /proyek/[project_id] (SELALU terlihat, bukan cuma di tab
	// Aktualisasi) supaya PL tak perlu masuk RAP-Aktual dulu untuk tahu posisi budget.
	// Reuse getProjectCostPosition() (sama sumber ProjectBepTrackerCard) +
	// fetchPenagihanStatusForProjects() (sama sumber PenagihanStatusCard) — nol sumber baru.
	import { onMount } from 'svelte';
	import { getProjectCostPosition } from '$lib/services/projectCostBehaviorApi';
	import { fetchPenagihanStatusForProjects } from '$lib/services/penagihanProyek';
	import { computeProjectFinancialHealth, type ProjectFinancialHealth } from '$lib/utils/projectFinancialHealth';
	import { getProjectSetting } from '$lib/services/projectSettings';

	let { projectId, projectName }: { projectId: number | string; projectName: string } = $props();

	let loading = $state(true);
	let health = $state<ProjectFinancialHealth | null>(null);
	let showDetail = $state(false);

	let enabled = $derived(
		getProjectSetting('project.field_bep.enabled') !== false ||
			getProjectSetting('project.field_penagihan.enabled') !== false
	);

	const LEVEL_CLS: Record<string, string> = {
		green: 'bg-emerald-500/20 text-emerald-50 border-emerald-300/40',
		yellow: 'bg-amber-500/25 text-amber-50 border-amber-300/40',
		red: 'bg-rose-500/30 text-rose-50 border-rose-300/50'
	};

	onMount(async () => {
		if (!enabled) {
			loading = false;
			return;
		}
		try {
			const [costPosition, billingRows] = await Promise.all([
				getProjectCostPosition(Number(projectId)).catch(() => null),
				fetchPenagihanStatusForProjects([{ id: projectId, name: projectName }]).catch(() => [])
			]);
			health = computeProjectFinancialHealth(costPosition, billingRows);
		} finally {
			loading = false;
		}
	});
</script>

{#if enabled && !loading && health}
	<button
		type="button"
		class="text-[11px] font-semibold px-2 py-0.5 rounded-lg flex items-center gap-1 border {LEVEL_CLS[health.level]}"
		onclick={() => (showDetail = !showDetail)}
		title="Kesehatan Keuangan Proyek — klik untuk detail"
	>
		{health.icon} {health.label}
	</button>
	{#if showDetail}
		<div class="w-full basis-full mt-1.5 text-[11px] rounded-lg px-3 py-2" style="background: rgba(0,0,0,0.15); color: rgba(255,255,255,0.9)">
			<p class="font-semibold mb-1">Kesehatan Keuangan Proyek</p>
			<ul class="space-y-0.5 list-disc list-inside">
				{#each health.reasons as reason}
					<li>{reason}</li>
				{/each}
			</ul>
			<p class="text-[10px] mt-1.5" style="color: rgba(255,255,255,0.6)">
				ⓘ Gabungan posisi RAP (tab Aktualisasi) &amp; status penagihan customer — lihat detail lengkap di masing-masing kartu.
			</p>
		</div>
	{/if}
{/if}
