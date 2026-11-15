<!-- src/lib/components/leader/LeaderSopTahapCard.svelte
     "Panduan SOP Tahap Ini" (dashboard Leader): untuk tiap tahap proyek yang SEDANG berjalan (dari subtask wajib timeline / status proyek),
     tampilkan maks. 3 SOP yang oleh admin ditandai relevan di tahap itu — bukan ratusan SOP. Tahap & penanda diatur Super Admin di erp-epi
     (🧭 Atur Tahap Proyek). Hemat: satu panggilan ringkas dulu; tidak ada alur bertahap → kartu diam TANPA membaca data proyek. Fail-soft. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { loadStageFlows } from '$lib/services/processGuidanceStageApi';
	import { getProjectStageSignals } from '$lib/services/projectStageSignals';
	import { loadMyTasks } from '$lib/services/processGuidanceMineApi';
	import { resolveProjectStage, pickStageFlows, type StageFlow } from '$lib/utils/projectStageResolver';
	import type { ProjectStage } from '$lib/data/processProjectStageDefaults';
	import { todayWib } from '$lib/utils/wibDate';

	let { projects }: { projects: { id: number; name: string }[] } = $props();

	const MAX_GROUPS = 2;
	const MAX_SOP = 3;

	interface Group {
		stage: ProjectStage;
		projectNames: string[];
		flows: StageFlow[];
	}
	let groups = $state<Group[]>([]);

	onMount(async () => {
		try {
			if (!projects?.length) return;
			const data = await loadStageFlows();
			if (!data.flows.length) return; // belum ada SOP yang ditandai tahap → diam, tanpa query proyek
			const today = todayWib();
			const [signals, mine] = await Promise.all([getProjectStageSignals(projects.map((p) => p.id)), loadMyTasks().catch(() => null)]);
			const myFlowIds = new Set((mine?.tasks ?? []).map((t) => t.flow_id));
			const byStage = new Map<string, Group>();
			for (const s of signals) {
				const r = resolveProjectStage(data.stages, { status: s.status, timelinePlanning: s.timeline_planning }, today);
				if (!r) continue;
				const g = byStage.get(r.stage.key) ?? { stage: r.stage, projectNames: [], flows: pickStageFlows(data.flows, r.stage.key, { myFlowIds, max: MAX_SOP, today }) };
				g.projectNames.push(s.name);
				byStage.set(r.stage.key, g);
			}
			groups = [...byStage.values()].filter((g) => g.flows.length > 0).sort((a, b) => a.stage.urutan - b.stage.urutan).slice(0, MAX_GROUPS);
		} catch (e) {
			console.warn('[LeaderSopTahapCard] gagal:', e instanceof Error ? e.message : e);
		}
	});
</script>

{#if groups.length > 0}
	<div class="rounded-xl border p-3.5 mb-4" style="border-color: var(--sys-separator, #e5e7eb); background: var(--sys-fill2)" data-testid="sop-tahap-card">
		<p class="text-[12px] font-semibold" style="color: var(--sys-label)" title="SOP yang relevan dengan tahap proyek Anda saat ini. Daftar diatur admin.">📘 Panduan SOP Tahap Ini</p>
		{#each groups as g (g.stage.key)}
			<div class="mt-2" data-testid="sop-tahap-group">
				<p class="text-[11px]" style="color: var(--sys-label-2)">
					Tahap <strong style="color: var(--sys-label)">{g.stage.label}</strong>
					<span style="color: var(--sys-label3)"> · {g.projectNames.slice(0, 2).join(', ')}{g.projectNames.length > 2 ? ` +${g.projectNames.length - 2}` : ''}</span>
				</p>
				<ul class="mt-1 space-y-1">
					{#each g.flows as f (f.id)}
						<li>
							<a href="/panduan/alur?alur={encodeURIComponent(f.id)}" class="block rounded-lg px-3 py-2 bg-slate-50 active:scale-[0.99] transition-transform text-[12px] font-medium" style="color: var(--sys-label)">
								{f.title}
								{#if f.sop_code}<span class="ml-1 text-[10px] font-mono" style="color: var(--sys-label3)">{f.sop_code}</span>{/if}
							</a>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
	</div>
{/if}
