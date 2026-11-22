<!-- src/lib/components/help/ProcessInfographicFlow.svelte -->
<!-- SOP Ringkas Lapangan: Infographic 7-Step Process Flow (Sesuai Gambar 2) -->
<script lang="ts">
	import { buildInfographicSteps, type InfographicModel } from '$lib/utils/processVisualFlowModel';
	import type { ProcessFlow } from '$lib/data/processGuidance';

	interface Props {
		flow?: ProcessFlow | null;
		infographicData?: InfographicModel | null;
		showActions?: boolean;
		onSelectStep?: ((stepId: string) => void) | null;
	}

	let {
		flow = null,
		infographicData = null,
		showActions = true,
		onSelectStep = null
	}: Props = $props();

	const data = $derived(infographicData ?? buildInfographicSteps(flow));
	const steps = $derived(data.steps ?? []);

	let expandedStepIds = $state<Set<string>>(new Set());

	function toggleExpand(stepId: string) {
		const next = new Set(expandedStepIds);
		if (next.has(stepId)) next.delete(stepId);
		else next.add(stepId);
		expandedStepIds = next;
		onSelectStep?.(stepId);
	}

	function getStepTheme(type: string, isDecision: boolean) {
		if (isDecision) {
			return {
				badge: 'bg-amber-500 text-white',
				border: 'border-amber-300',
				iconBg: 'bg-amber-100 text-amber-800'
			};
		}
		if (type === 'start') {
			return {
				badge: 'bg-blue-600 text-white',
				border: 'border-blue-300',
				iconBg: 'bg-blue-100 text-blue-800'
			};
		}
		if (type === 'end') {
			return {
				badge: 'bg-emerald-600 text-white',
				border: 'border-emerald-300',
				iconBg: 'bg-emerald-100 text-emerald-800'
			};
		}
		return {
			badge: 'bg-blue-600 text-white',
			border: 'border-gray-200',
			iconBg: 'bg-gray-100 text-gray-700'
		};
	}
</script>

<div class="infographic-flow-container max-w-2xl mx-auto p-2 sm:p-4 text-gray-900">
	<!-- Header Infografis (Gaya Gambar 2) -->
	<div class="text-center mb-6">
		<div class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-blue-100 text-blue-800 border border-blue-200 mb-1.5">
			<span>📋 SOP PROCESS FLOW</span>
			<span>•</span>
			<span class="font-mono">{data.code}</span>
		</div>
		<h2 class="text-lg sm:text-xl font-black text-gray-950 tracking-tight leading-snug">
			{data.title}
		</h2>
		<p class="text-xs font-bold text-blue-700 mt-0.5">
			{data.totalSteps}-Step Process Flow
		</p>
	</div>

	<!-- Urutan Langkah Vertikal Bernomor (Vertical Stepper) -->
	<div class="space-y-0" role="list">
		{#each steps as step, index (step.id)}
			{@const theme = getStepTheme(step.type, step.isDecision)}
			{@const isExpanded = expandedStepIds.has(step.id)}

			<!-- Kartu Langkah Tunggal -->
			<div
				class="group relative rounded-2xl border-2 {theme.border} bg-white p-3 sm:p-4 shadow-xs hover:shadow-md transition-all cursor-pointer"
				role="listitem"
				tabindex="0"
				onclick={() => toggleExpand(step.id)}
				onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(step.id); } }}
			>
				<div class="flex items-start gap-3">
					<!-- Nomor Langkah Besar -->
					<div class="shrink-0 flex flex-col items-center">
						<div class="w-9 h-9 sm:w-11 sm:h-11 rounded-xl {theme.badge} font-black text-base sm:text-lg flex items-center justify-center shadow-xs">
							{step.stepNumber}
						</div>
					</div>

					<!-- Ikon Visual -->
					<div class="shrink-0">
						<div class="w-9 h-9 sm:w-11 sm:h-11 rounded-xl {theme.iconBg} flex items-center justify-center text-lg sm:text-xl shadow-2xs">
							{step.icon}
						</div>
					</div>

					<!-- Konten Teks Langkah -->
					<div class="grow min-w-0">
						<div class="flex flex-wrap items-center justify-between gap-1 mb-1">
							<h3 class="text-xs sm:text-sm font-black text-gray-950 leading-tight">
								{step.label}
							</h3>
							{#if step.slaHours}
								<span class="text-[9.5px] font-mono px-1.5 py-0.2 rounded bg-gray-100 text-gray-600 font-bold">
									⏱️ {step.slaHours}j
								</span>
							{/if}
						</div>

						<!-- Ringkasan Poin Kunci dalam kurung (Format Gambar 2) -->
						{#if step.keyPoints.length > 0}
							<p class="text-[11px] sm:text-xs text-gray-600 leading-snug font-medium">
								({step.keyPoints.join(', ')})
							</p>
						{:else if step.summary}
							<p class="text-[11px] text-gray-600 leading-snug">
								{step.summary}
							</p>
						{/if}

						<!-- Badges: PIC, Lane & Gate -->
						<div class="flex items-center gap-1.5 mt-2 flex-wrap">
							<span class="text-[9px] font-bold px-1.5 py-0.2 rounded bg-gray-100 text-gray-700">
								👤 {step.pic}
							</span>

							{#if step.gates.length > 0}
								{#each step.gates as gateKey}
									<span class="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded text-[9px] font-black uppercase bg-rose-100 text-rose-800 border border-rose-300">
										<span>🛡️</span>
										<span>{gateKey}</span>
									</span>
								{/each}
							{/if}

							{#if showActions && step.actionUrl}
								<a
									href={step.actionUrl}
									class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9.5px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 hover:bg-emerald-200 ml-auto"
									onclick={(e) => e.stopPropagation()}
								>
									<span>📱 Buka Form</span>
									<span>→</span>
								</a>
							{/if}
						</div>

						{#if isExpanded && step.summary}
							<div class="mt-2.5 pt-2 border-t border-gray-100 text-[11px] text-gray-600 leading-relaxed">
								{step.summary}
							</div>
						{/if}
					</div>
				</div>
			</div>

			<!-- Panah Transisi Antar Langkah -->
			{#if index < steps.length - 1}
				<div class="flex justify-center my-1" aria-hidden="true">
					<div class="w-6 h-6 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-200 shadow-2xs">
						<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
							<path stroke-linecap="round" stroke-linejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
						</svg>
					</div>
				</div>
			{/if}
		{/each}
	</div>
</div>
