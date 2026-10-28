<!-- WsRapAktualStatusCard.svelte — Sinkronisasi Laporan Harian Workshop v2, Fase 5.
     Kartu lampu progres fisik vs serapan biaya WORKSHOP (manpower+material+overhead,
     dari Konsolidasi RAP Workshop admin), untuk SATU PO yang sedang dipilih di
     /rap-aktual. Beda dari WorkshopManpowerSummaryCard (itu manpower generik semua
     PO dari RAB, ini workshop-specific dari getWorkshopConsolidation() erp-epi).
     TANPA rupiah sama sekali (pola sama existing). -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { fetchWsTimelineStatus, type WsTimelineStatus } from '$lib/services/wsTimelineStatus';
	import { IconGauge, IconLoader2 } from '@tabler/icons-svelte';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';

	let { project = null } = $props<{ project?: any }>();

	let status = $state<WsTimelineStatus | null>(null);
	let loading = $state(false);

	const DOT: Record<string, string> = {
		red: 'bg-red-500',
		yellow: 'bg-amber-500',
		green: 'bg-emerald-500'
	};

	$effect(() => {
		const isWorkshop = project?.workshop === 'ciketing' || project?.workshop === 'balaraja';
		if (!isWorkshop || !project?.id) {
			status = null;
			return;
		}
		loading = true;
		status = null;
		fetchWsTimelineStatus(Number(project.id), project.workshop).then((s) => {
			status = s;
			loading = false;
		});
	});
</script>

{#if project?.workshop === 'ciketing' || project?.workshop === 'balaraja'}
	<div class="bg-white dark:bg-[#1B2530] rounded-2xl shadow-xs border border-gray-200/80 dark:border-[#2B3844] p-4 sm:p-5 transition-all">
		<div class="flex items-center gap-2.5 mb-1">
			<div class="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 bg-cyan-500/10 border border-cyan-500/20 text-cyan-600 dark:text-cyan-400">
				<IconGauge size={18} />
			</div>
			<div class="min-w-0">
				<h3 class="text-sm font-extrabold text-gray-900 dark:text-white leading-tight">Progres vs Serapan Workshop</h3>
				<p class="text-[11px] text-gray-500 dark:text-gray-400 font-medium">Dari Konsolidasi RAP Workshop admin — tanpa nominal</p>
			</div>
		</div>

		{#if loading}
			<CircularProgressGauge size={44} strokeWidth={3} label="Memuat status RAP vs Aktual..." />
		{:else if !status?.found}
			<p class="text-xs text-gray-400 dark:text-gray-500 py-3 text-center">Belum ada data konsolidasi bulan ini untuk PO ini.</p>
		{:else}
			<div class="flex items-center gap-4 py-2">
				<Tooltip text="Lampu EV (serapan vs progres)" position="right"><span class="inline-flex p-2 -m-2 shrink-0"><span class="w-3 h-3 rounded-full shrink-0 {DOT[status.evFlag || ''] || 'bg-gray-300 dark:bg-gray-600'}"></span></span></Tooltip>
				<div class="flex-1 min-w-0">
					<p class="text-xs font-bold text-gray-900 dark:text-gray-100">
						Progres {status.progressPct ?? '—'}%
						{#if status.serapanPct != null}
							· Serapan {status.serapanPct}%{#if status.manpowerEstimasi}<span class="font-normal text-gray-400"> (estimasi)</span>{/if}
						{/if}
					</p>
					<p class="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">🟢 serapan ≤ progres · 🟡 selisih tipis · 🔴 serapan jauh melebihi progres fisik</p>
				</div>
			</div>
		{/if}
	</div>
{/if}
