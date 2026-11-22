<!-- src/lib/components/help/ProcessVisualInstructionCards.svelte -->
<!-- SOP Ringkas Lapangan: Visual Work Instruction / Photo-Step Cards (Sesuai Gambar 1) -->
<script lang="ts">
	import { buildVisualWorkInstructions, type VisualWorkInstructionModel, type VisualCard, type VisualSkillGroup } from '$lib/utils/processVisualFlowModel';
	import type { ProcessFlow } from '$lib/data/processGuidance';

	interface Props {
		flow?: ProcessFlow | null;
		visualData?: VisualWorkInstructionModel | null;
	}

	let {
		flow = null,
		visualData = null
	}: Props = $props();

	const data = $derived(visualData ?? buildVisualWorkInstructions(flow));
	const skills = $derived(data.skills ?? []);

	let previewCard = $state<(VisualCard & { skillTitle: string }) | null>(null);

	function openPreview(card: VisualCard, skill: VisualSkillGroup) {
		previewCard = { ...card, skillTitle: skill.skillTitle };
	}

	function closePreview() {
		previewCard = null;
	}
</script>

<div class="visual-instruction-container max-w-4xl mx-auto p-2 sm:p-4 text-gray-900">
	<!-- Header Dokumen Instruksi Visual -->
	<div class="text-center mb-6">
		<div class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-teal-100 text-teal-800 border border-teal-200 mb-1.5">
			<span>📸 VISUAL WORK INSTRUCTION (VWI)</span>
			<span>•</span>
			<span class="font-mono">{data.code}</span>
		</div>
		<h2 class="text-lg sm:text-xl font-black text-gray-950 tracking-tight leading-snug">
			{data.title}
		</h2>
		<p class="text-xs text-gray-600 mt-0.5">
			Panduan langkah teknis visual &amp; verifikasi hasil akhir (Finished Result)
		</p>
	</div>

	<!-- Daftar Keterampilan & Kartu Foto (Gaya Gambar 1: Horizontal Strip) -->
	<div class="space-y-6">
		{#each skills as skill (skill.id)}
			<div class="bg-gray-50 rounded-2xl p-3 sm:p-4 border border-gray-200">
				<!-- Header Keterampilan (Gaya Gambar 1: "Basic skills - Stripping herbs...") -->
				<div class="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-gray-200">
					<div class="flex items-center gap-2">
						<span class="text-lg">{skill.icon}</span>
						<h3 class="text-xs sm:text-sm font-black text-gray-900">
							Basic skills – {skill.skillTitle}
						</h3>
					</div>
					<span class="text-[9.5px] font-bold px-1.5 py-0.2 rounded bg-white border border-gray-200 text-gray-700">
						PIC: {skill.pic}
					</span>
				</div>

				<!-- Grid 4 Kolom Foto Aksi & Hasil Selesai -->
				<div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
					{#each skill.cards as card (card.cardNumber)}
						<div class="flex flex-col rounded-xl overflow-hidden border {card.isFinishedResult ? 'border-emerald-500 shadow-xs' : 'border-gray-200'} bg-white">
							<!-- Frame Foto / Ilustrasi Fallback -->
							<div
								class="relative aspect-[4/3] bg-gray-100 flex items-center justify-center overflow-hidden cursor-pointer"
								role="button"
								tabindex="0"
								onclick={() => openPreview(card, skill)}
								onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPreview(card, skill); } }}
							>
								{#if card.photoUrl}
									<img src={card.photoUrl} alt={card.caption} class="w-full h-full object-cover" loading="lazy" />
								{:else}
									<div class="w-full h-full flex flex-col items-center justify-center p-2 text-center bg-gradient-to-b from-gray-100 to-gray-200">
										<span class="text-2xl mb-1">{card.isFinishedResult ? '✅' : '📷'}</span>
										<span class="text-[8.5px] font-bold text-gray-500 uppercase">
											{card.isFinishedResult ? 'Hasil Akhir' : `Aksi ${card.cardNumber}`}
										</span>
									</div>
								{/if}

								<div class="absolute top-1.5 left-1.5">
									<span class="px-1.5 py-0.2 rounded text-[8.5px] font-black uppercase {card.isFinishedResult ? 'bg-emerald-600 text-white' : 'bg-gray-900/80 text-white'}">
										{card.isFinishedResult ? 'Done' : `Step ${card.cardNumber}`}
									</span>
								</div>
							</div>

							<!-- Teks Keterangan di Bawah Foto (Gaya Gambar 1) -->
							<div class="p-2 grow flex flex-col justify-between text-center border-t border-gray-100">
								{#if card.isFinishedResult}
									<div class="text-[11px] font-black text-emerald-700 leading-snug mb-0.5">
										Finished result
									</div>
								{/if}
								<p class="text-[10.5px] text-gray-800 leading-tight font-medium {card.isFinishedResult ? 'text-emerald-900 font-bold' : ''}">
									{card.caption}
								</p>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/each}
	</div>

	<!-- Modal Lightbox Pratinjau Foto -->
	{#if previewCard}
		<div
			class="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			onclick={closePreview}
			onkeydown={(e) => { if (e.key === 'Escape') closePreview(); }}
		>
			<div
				class="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl p-4 space-y-3"
				role="document"
				onclick={(e) => e.stopPropagation()}
				onkeydown={(e) => e.stopPropagation()}
			>
				<div class="flex items-center justify-between pb-2 border-b border-gray-100">
					<h4 class="font-black text-xs text-gray-950">
						{previewCard.skillTitle} • {previewCard.statusBadge}
					</h4>
					<button type="button" class="text-sm font-bold p-1 text-gray-400 hover:text-gray-700" onclick={closePreview}>
						✕
					</button>
				</div>
				<div class="aspect-video bg-black rounded-xl flex items-center justify-center text-white text-center p-4">
					{#if previewCard.photoUrl}
						<img src={previewCard.photoUrl} alt={previewCard.caption} class="max-h-full max-w-full object-contain" />
					{:else}
						<div>
							<span class="text-4xl block mb-1">{previewCard.isFinishedResult ? '✅' : '📷'}</span>
							<span class="text-xs font-bold">{previewCard.isFinishedResult ? 'Standar Hasil Akhir' : 'Langkah Kerja'}</span>
						</div>
					{/if}
				</div>
				<p class="text-xs text-gray-800 font-medium leading-relaxed">
					{previewCard.caption}
				</p>
			</div>
		</div>
	{/if}
</div>
