<!-- src/routes/(app)/panduan/alur/FieldHierarchyCard.svelte -->
<!-- Kartu drill-down daftar SOP Induk & Instruksi Kerja (IK) naungan untuk Dashboard Lapangan (/panduan/alur). -->
<script lang="ts">
	import type { FieldHierarchyItem, FieldHierarchyView } from './fieldHierarchyModel';

	let {
		view,
		includeDraft = true,
		onselectflow,
		ontoggledraft = null
	}: {
		view: FieldHierarchyView;
		includeDraft?: boolean;
		onselectflow: (id: string) => void;
		ontoggledraft?: ((next: boolean) => void) | null;
	} = $props();

	let showSection = $derived(
		view.counts.totalDescendants > 0 || view.counts.skippedDraftCount > 0 || view.roleKey === 'master'
	);

	function itemStatusBadge(it: FieldHierarchyItem): { text: string; cls: string } {
		if (it.is_draft_approval) {
			return { text: 'Menunggu Pengesahan', cls: 'bg-amber-100 text-amber-900 border-amber-300' };
		}
		if (it.is_sosialisasi) {
			return { text: 'Sosialisasi', cls: 'bg-purple-100 text-purple-900 border-purple-300' };
		}
		return { text: 'Terbit', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' };
	}
</script>

{#if showSection}
	<section
		class="bg-white border border-indigo-200 rounded-2xl p-3.5 space-y-2.5 shadow-xs"
		data-testid="field-hierarchy-card"
	>
		<div class="flex flex-wrap items-center justify-between gap-2">
			<div class="flex flex-wrap items-center gap-1.5">
				<h2 class="text-xs font-bold text-indigo-950">🌳 Induk &amp; Anak Kerja (IK) Naungan</h2>
				<span class="px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold bg-indigo-100 text-indigo-900">
					{view.counts.indukCount} Induk · {view.counts.turunanCount} IK
				</span>
			</div>
			{#if ontoggledraft && (view.counts.draftApprovalCount > 0 || view.counts.skippedDraftCount > 0)}
				<button
					type="button"
					onclick={() => ontoggledraft(!includeDraft)}
					class="px-2 py-1 rounded-lg text-[10px] font-semibold border transition {includeDraft
						? 'bg-amber-50 text-amber-900 border-amber-300'
						: 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}"
					data-testid="toggle-field-draft"
					title="Sertakan atau sembunyikan prosedur turunan yang menunggu pengesahan approval"
				>
					{includeDraft
						? `✓ Termasuk Menunggu Pengesahan (${view.counts.draftApprovalCount})`
						: `+ Tampilkan Menunggu Pengesahan (${view.counts.skippedDraftCount})`}
				</button>
			{/if}
		</div>

		<p class="text-[11px] text-indigo-900 bg-indigo-50/70 border border-indigo-100 rounded-xl px-2.5 py-1.5 leading-snug">
			💡 Ketuk salah satu <strong>SOP Induk</strong> atau <strong>Anak Kerja (IK)</strong> di bawah untuk langsung membuka langkah kerja &amp; checklist lapangannya.
		</p>

		{#if view.counts.totalDescendants === 0}
			<p class="text-[11px] text-gray-500 italic bg-gray-50 border border-gray-200 rounded-xl px-3 py-2">
				Belum ada SOP Induk atau Instruksi Kerja (IK) lapangan yang aktif di bawah naungan ini.
			</p>
		{:else}
			<div class="space-y-2">
				{#each view.indukGroups as grp, gi (grp.induk.id)}
					{@const indukSt = itemStatusBadge(grp.induk)}
					<div class="rounded-xl border border-sky-200 bg-sky-50/40 p-2 space-y-1.5" data-testid="field-induk-group">
						<button
							type="button"
							onclick={() => onselectflow(grp.induk.id)}
							class="w-full text-left bg-white hover:bg-sky-50 active:scale-[0.99] border border-sky-200 rounded-lg px-2.5 py-2 flex items-start justify-between gap-2 transition"
							data-testid="field-hierarchy-item"
						>
							<div class="min-w-0 space-y-1">
								<div class="flex flex-wrap items-center gap-1">
									<span class="px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase bg-sky-100 text-sky-900 border border-sky-300">
										INDUK #{gi + 1} · {grp.induk.role_label}
									</span>
									{#if grp.induk.sop_code}
										<span class="px-1.5 py-0.5 rounded font-mono text-[10px] font-bold bg-amber-50 text-amber-900 border border-amber-200">
											{grp.induk.sop_code}
										</span>
									{/if}
									<span class="px-1.5 py-0.5 rounded text-[9.5px] font-semibold border {indukSt.cls}">
										{indukSt.text}
									</span>
								</div>
								<p class="text-xs font-bold text-gray-900 leading-snug">{grp.induk.title}</p>
								<p class="text-[10px] text-gray-500">
									{grp.induk.node_count} langkah · membawahi {grp.anakKerja.length} IK
								</p>
							</div>
							<span class="shrink-0 text-xs font-bold text-sky-700 self-center">Buka ›</span>
						</button>

						{#if grp.anakKerja.length > 0}
							<div class="pl-3 border-l-2 border-teal-300 space-y-1">
								{#each grp.anakKerja as ik, ii (ik.id)}
									{@const ikSt = itemStatusBadge(ik)}
									<button
										type="button"
										onclick={() => onselectflow(ik.id)}
										class="w-full text-left bg-white hover:bg-teal-50 active:scale-[0.99] border border-teal-200 rounded-lg px-2.5 py-1.5 flex items-start justify-between gap-2 transition"
										data-testid="field-hierarchy-item"
									>
										<div class="min-w-0 space-y-0.5">
											<div class="flex flex-wrap items-center gap-1">
												<span class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-teal-100 text-teal-900 border border-teal-300">
													IK #{gi + 1}.{ii + 1} · {ik.role_label}
												</span>
												{#if ik.sop_code}
													<span class="px-1.5 py-0.5 rounded font-mono text-[10px] font-bold bg-amber-50 text-amber-900 border border-amber-200">
														{ik.sop_code}
													</span>
												{/if}
												<span class="px-1.5 py-0.5 rounded text-[9px] font-semibold border {ikSt.cls}">
													{ikSt.text}
												</span>
											</div>
											<p class="text-xs font-semibold text-gray-900 leading-snug">{ik.title}</p>
											<p class="text-[10px] text-gray-500">{ik.node_count} langkah kerja</p>
										</div>
										<span class="shrink-0 text-xs font-bold text-teal-700 self-center">Buka ›</span>
									</button>
								{/each}
							</div>
						{/if}
					</div>
				{/each}

				{#if view.directTurunan.length > 0}
					<div class="space-y-1.5">
						{#each view.directTurunan as ik, di (ik.id)}
							{@const ikSt = itemStatusBadge(ik)}
							<button
								type="button"
								onclick={() => onselectflow(ik.id)}
								class="w-full text-left bg-white hover:bg-teal-50 active:scale-[0.99] border border-teal-200 rounded-lg px-2.5 py-2 flex items-start justify-between gap-2 transition"
								data-testid="field-hierarchy-item"
							>
								<div class="min-w-0 space-y-0.5">
									<div class="flex flex-wrap items-center gap-1">
										<span class="px-1.5 py-0.5 rounded text-[9.5px] font-bold uppercase bg-teal-100 text-teal-900 border border-teal-300">
											IK #{di + 1} · {ik.role_label}
										</span>
										{#if ik.sop_code}
											<span class="px-1.5 py-0.5 rounded font-mono text-[10px] font-bold bg-amber-50 text-amber-900 border border-amber-200">
												{ik.sop_code}
											</span>
										{/if}
										<span class="px-1.5 py-0.5 rounded text-[9.5px] font-semibold border {ikSt.cls}">
											{ikSt.text}
										</span>
									</div>
									<p class="text-xs font-semibold text-gray-900 leading-snug">{ik.title}</p>
									<p class="text-[10px] text-gray-500">{ik.node_count} langkah kerja</p>
								</div>
								<span class="shrink-0 text-xs font-bold text-teal-700 self-center">Buka ›</span>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</section>
{/if}
