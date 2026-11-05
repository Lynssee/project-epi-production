<!-- src/lib/components/help/FloatingSopHint.svelte -->
<!-- Tombol Panduan SOP & Gate Mengambang (Floating Hint) di Modul Lapangan
     Memberi panduan kontekstual instan tanpa meninggalkan form kerja. -->
<script lang="ts">
	import { getStageById, type ProjectStage } from '$lib/utils/fieldProjectStepper';

	interface Props {
		/** ID Tahap Proyek (0: Sales, 1: Pra-Mob, 2: Logistik/SJM, 3: Blasting/QC, 4: Daily Report, 5: BAST) */
		stageId?: number;
		/** Kode Gate spesifik yang aktif di modul ini (opsional) */
		activeGateKey?: string;
		/** Label singkat tombol mengambang */
		buttonLabel?: string;
		/** Objek stage kustom bila diberikan langsung */
		customStage?: ProjectStage;
	}

	let {
		stageId = 1,
		activeGateKey = '',
		buttonLabel = 'SOP & Gate',
		customStage
	}: Props = $props();

	let isOpen = $state(false);
	let stage = $derived(customStage ?? getStageById(stageId));

	let targetGate = $derived.by(() => {
		if (!stage) return null;
		if (activeGateKey) {
			return stage.gates.find((g) => g.key === activeGateKey) ?? stage.gates[0] ?? null;
		}
		return stage.gates[0] ?? null;
	});
</script>

{#if stage}
	<div
		class="fixed bottom-20 right-3.5 z-40 flex flex-col items-end"
		data-testid="floating-sop-hint"
	>
		{#if isOpen}
			<!-- Modal / Panel Mengambang -->
			<div
				class="w-76 max-w-[calc(100vw-1.75rem)] mb-2 bg-white border border-gray-200 rounded-2xl shadow-xl p-3.5 space-y-2.5 text-xs text-gray-800 animate-in fade-in slide-in-from-bottom-2 duration-150"
				role="dialog"
				aria-label="Panduan SOP Lapangan"
			>
				<!-- Header Panel -->
				<div class="flex items-start justify-between gap-2 border-b border-gray-100 pb-2">
					<div class="flex items-center gap-1.5 min-w-0">
						<span class="text-base" aria-hidden="true">{stage.icon}</span>
						<div class="min-w-0">
							<span class="inline-block px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
								{stage.badge}
							</span>
							<h4 class="font-bold text-gray-900 text-xs truncate leading-tight mt-0.5">
								{stage.shortTitle}
							</h4>
						</div>
					</div>
					<button
						type="button"
						class="text-gray-400 hover:text-gray-700 p-1 -mr-1 -mt-1 rounded-full text-sm font-bold"
						onclick={() => (isOpen = false)}
						aria-label="Tutup panduan"
					>
						✕
					</button>
				</div>

				<!-- Rambu Gate Penjaga -->
				{#if targetGate}
					<div class="rounded-xl border border-purple-200 bg-purple-50/90 p-2.5 space-y-1">
						<div class="flex items-center justify-between gap-1">
							<span class="text-[10px] font-bold text-purple-900 uppercase tracking-wide flex items-center gap-1">
								<span>🛡️</span>
								<span>Gate Sistem</span>
							</span>
							<span class="px-1.5 py-0.2 rounded text-[9px] font-bold uppercase {targetGate.mode === 'hard' ? 'bg-rose-100 text-rose-800 border border-rose-200' : 'bg-amber-100 text-amber-800 border border-amber-200'}">
								{targetGate.mode === 'hard' ? 'Hard Block' : 'Warning'}
							</span>
						</div>
						<p class="font-mono font-bold text-purple-950 text-[11px]">{targetGate.key}</p>
						<p class="text-[10.5px] text-purple-900 leading-snug">{targetGate.label}</p>
					</div>
				{/if}

				<!-- Checkpoint Wajib -->
				{#if stage.checkpoints.length > 0}
					<div class="space-y-1">
						<p class="text-[10px] font-bold text-gray-600 uppercase tracking-wide">
							✅ Cek Sebelum Submit:
						</p>
						<ul class="space-y-1 text-[11px] text-gray-700 pl-0.5">
							{#each stage.checkpoints as cp}
								<li class="flex items-start gap-1.5 leading-snug">
									<span class="text-emerald-600 font-bold shrink-0">✓</span>
									<span>{cp}</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				<!-- Tombol Menuju Alur Lengkap -->
				<div class="pt-2 border-t border-gray-100 flex items-center justify-between gap-2">
					<a
						href="/panduan/alur?kategori=turunan"
						class="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 hover:text-blue-800 hover:underline"
					>
						<span>🗺️ Buka Peta Alur Lengkap</span>
						<span>→</span>
					</a>
					<button
						type="button"
						class="px-2 py-1 text-[10.5px] font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
						onclick={() => (isOpen = false)}
					>
						Tutup
					</button>
				</div>
			</div>
		{/if}

		<!-- Tombol Mengambang (Pill Trigger) -->
		<button
			type="button"
			class="inline-flex items-center gap-1.5 px-3 py-2 rounded-full font-bold text-xs text-white shadow-lg active:scale-95 transition-all {isOpen
				? 'bg-gray-800 hover:bg-gray-900 ring-2 ring-gray-300'
				: 'bg-emerald-700 hover:bg-emerald-800 ring-2 ring-emerald-300'}"
			onclick={() => (isOpen = !isOpen)}
			aria-expanded={isOpen}
			title="Buka panduan SOP dan rambu gate untuk modul ini"
		>
			<span class="text-xs" aria-hidden="true">{isOpen ? '✕' : '🛡️'}</span>
			<span>{isOpen ? 'Tutup Panduan' : buttonLabel}</span>
			{#if !isOpen && targetGate}
				<span class="w-2 h-2 rounded-full bg-amber-400 animate-pulse" aria-hidden="true"></span>
			{/if}
		</button>
	</div>
{/if}
