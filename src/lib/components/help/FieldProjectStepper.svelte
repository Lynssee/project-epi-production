<!-- src/lib/components/help/FieldProjectStepper.svelte -->
<!-- Stepper 5 Tahap Proyek Lapangan (Mobile-First):
     Memberi panduan sekuensial bagi mandor, supervisor, & Project Leader
     lengkap dengan gerbang kendali (gate) dan pintasan modul lapangan. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import {
		FIELD_PROJECT_STAGES,
		getStageById,
		loadSelectedStage,
		saveSelectedStage,
		type ProjectStage
	} from '$lib/utils/fieldProjectStepper';

	interface Props {
		/** Tahap yang sedang aktif (1-5); default dipulihkan dari localStorage */
		activeStageId?: number;
		/** Callback saat pengguna memilih tahap tertentu */
		onselectstage?: (stage: ProjectStage) => void;
		/** Callback saat pengguna menekan tombol untuk menyaring SOP terkait tahap ini */
		onfiltersop?: (keyword: string, procedureType?: string) => void;
	}

	let {
		activeStageId = 1,
		onselectstage,
		onfiltersop
	}: Props = $props();

	let currentStageId = $state(activeStageId);
	let isCollapsed = $state(false);

	onMount(() => {
		if (typeof localStorage !== 'undefined') {
			currentStageId = loadSelectedStage(localStorage, activeStageId);
		}
	});

	let stage = $derived(getStageById(currentStageId) ?? FIELD_PROJECT_STAGES[0]);

	function selectStage(id: number) {
		currentStageId = id;
		if (typeof localStorage !== 'undefined') {
			saveSelectedStage(localStorage, id);
		}
		const s = getStageById(id);
		if (s && onselectstage) {
			onselectstage(s);
		}
	}

	function handleFilterSop() {
		if (!stage || !onfiltersop) return;
		const primaryKeyword = stage.sopKeywords[0] || '';
		onfiltersop(primaryKeyword, stage.procedureType);
	}
</script>

<section
	class="bg-white border border-gray-200 rounded-2xl p-3.5 shadow-xs space-y-3"
	data-testid="field-project-stepper"
>
	<!-- Header Stepper -->
	<div class="flex items-center justify-between gap-2 border-b border-gray-100 pb-2.5">
		<div class="flex items-center gap-2">
			<span class="text-base" aria-hidden="true">🗺️</span>
			<div>
				<h2 class="text-xs font-bold text-gray-900 tracking-tight">5 Tahap Eksekusi Proyek</h2>
				<p class="text-[10px] text-gray-500">Panduan sekuensial lapangan & pintasan modul</p>
			</div>
		</div>
		<button
			type="button"
			class="px-2 py-1 text-[11px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors"
			onclick={() => (isCollapsed = !isCollapsed)}
			aria-expanded={!isCollapsed}
		>
			{isCollapsed ? 'Buka Stepper ▼' : 'Ringkas ▲'}
		</button>
	</div>

	<!-- Track 5 Tahapan (Horizontal Scrollable Pills) -->
	<div class="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar text-xs" role="tablist">
		{#each FIELD_PROJECT_STAGES as s (s.id)}
			{@const isActive = s.id === currentStageId}
			<button
				type="button"
				role="tab"
				aria-selected={isActive}
				class="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-xl font-bold transition-all text-xs {isActive
					? 'bg-emerald-700 text-white shadow-xs ring-2 ring-emerald-300'
					: 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-200'}"
				onclick={() => selectStage(s.id)}
			>
				<span class="text-xs">{s.icon}</span>
				<span>{s.shortTitle}</span>
			</button>
		{/each}
	</div>

	{#if !isCollapsed && stage}
		<!-- Detail Tahap Aktif -->
		<div class="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3 space-y-2.5">
			<div class="flex items-start justify-between gap-2">
				<div>
					<span class="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 mb-1">
						{stage.badge}
					</span>
					<h3 class="text-xs font-bold text-gray-900 leading-snug">{stage.title}</h3>
				</div>
				<button
					type="button"
					class="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-bold text-blue-700 bg-white border border-blue-300 rounded-lg shadow-2xs hover:bg-blue-50 active:scale-95 transition-transform"
					onclick={handleFilterSop}
					title="Saring katalog alur kerja di bawah untuk tahap ini"
				>
					<span>🔍</span>
					<span>SOP Tahap Ini</span>
				</button>
			</div>

			<p class="text-[11px] text-gray-700 leading-relaxed bg-white/80 border border-emerald-100 rounded-lg p-2">
				{stage.fokus}
			</p>

			<!-- Rambu Gate Penjaga Sistem -->
			{#if stage.gates.length > 0}
				<div class="rounded-lg border border-purple-200 bg-purple-50/80 p-2 space-y-1">
					<p class="text-[10px] font-bold text-purple-900 uppercase tracking-wide flex items-center gap-1">
						<span>🛡️</span>
						<span>Gate Penjaga Tahap Ini</span>
					</p>
					<div class="space-y-1">
						{#each stage.gates as g (g.key)}
							<div class="flex items-center gap-1.5 text-[11px] bg-white/90 border border-purple-100 rounded px-2 py-1 font-mono text-purple-950">
								<span class="px-1 py-0.2 rounded text-[9px] font-bold uppercase {g.mode === 'hard' ? 'bg-rose-100 text-rose-800 border border-rose-200' : 'bg-amber-100 text-amber-800 border border-amber-200'}">
									{g.mode === 'hard' ? 'Hard Block' : 'Warning'}
								</span>
								<strong class="font-bold">{g.key}</strong>
								<span class="text-gray-600 font-sans text-[10.5px]">· {g.label}</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Checklist Lapangan -->
			{#if stage.checkpoints.length > 0}
				<div class="rounded-lg border border-gray-200 bg-white/90 p-2 space-y-1">
					<p class="text-[10px] font-bold text-gray-600 uppercase tracking-wide">
						✅ Checkpoint Wajib Dipenuhi:
					</p>
					<ul class="space-y-0.5 text-[11px] text-gray-700 pl-1">
						{#each stage.checkpoints as cp}
							<li class="flex items-start gap-1.5 leading-snug">
								<span class="text-emerald-600 font-bold shrink-0">✓</span>
								<span>{cp}</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			<!-- Pintasan Tindakan Modul Lapangan Langsung -->
			{#if stage.actions.length > 0}
				<div class="pt-1">
					<p class="text-[10px] font-bold text-emerald-900 uppercase tracking-wide mb-1.5">
						⚡ Tindakan Langsung di Lapangan:
					</p>
					<div class="flex flex-wrap gap-1.5">
						{#each stage.actions as a}
							<a
								href={a.href}
								class="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-white shadow-2xs active:scale-95 transition-transform bg-emerald-600 hover:bg-emerald-700"
							>
								<span>{a.icon}</span>
								<span>{a.label}</span>
								<span aria-hidden="true">→</span>
							</a>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}
</section>
