<!-- src/lib/components/help/ProcessGuidanceMobile.svelte -->
<!-- Alur bisnis versi lapangan: akordeon per lane + kartu langkah (ketuk = buka panduan). Tanpa SVG/peta → ringan di HP
     dan tetap terbaca di sinyal buruk (data dibundel, tidak ada fetch). Lihat dashboard admin untuk peta swimlane lengkap. -->
<script lang="ts">
	import { tick } from 'svelte';
	import type { ProcessFlow } from '$lib/data/processGuidance';
	import { buildLaneSections, laneOfNode, type NodeView } from '$lib/utils/processGuidance';

	interface Props {
		flow: ProcessFlow | null;
		/** id langkah yang dibuka otomatis (deep-link dari tombol bantuan kontekstual). */
		fokus?: string;
	}
	let { flow, fokus = '' }: Props = $props();

	let sections = $derived(buildLaneSections(flow));
	let openLanes = $state<Record<string, boolean>>({});
	let openNode = $state('');

	const TYPE_ICON: Record<string, string> = { start: '🟢', end: '🏁', decision: '🔶', task: '▫️' };

	function toggleLane(key: string) {
		openLanes[key] = !openLanes[key];
	}

	async function fokusKe(id: string) {
		const lane = laneOfNode(flow, id);
		if (!lane) return;
		openLanes[lane] = true;
		openNode = id;
		await tick();
		document.getElementById(`pg-node-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
	}

	function toggleNode(n: NodeView) {
		openNode = openNode === n.id ? '' : n.id;
	}

	// Buka lane pertama secara default; bila ada ?fokus=, buka langkah itu.
	let inisialisasi = $state(false);
	$effect(() => {
		if (!flow || inisialisasi) return;
		inisialisasi = true;
		if (fokus && laneOfNode(flow, fokus)) fokusKe(fokus);
		else if (sections[0]) openLanes[sections[0].key] = true;
	});
</script>

<div class="space-y-3" data-testid="process-guidance-mobile">
	{#if !flow || sections.length === 0}
		<p class="text-sm text-gray-400 text-center py-8">Panduan alur belum tersedia.</p>
	{:else}
		<p class="text-xs text-gray-500 leading-relaxed">
			💡 Alur dibaca per bagian (Sales, Inventory, dst). Ketuk bagian untuk membuka, lalu ketuk satu langkah untuk melihat
			yang harus dilakukan, siapa yang bertanggung jawab, dan ke mana lanjutnya.
		</p>

		{#each sections as sec (sec.key)}
			<section class="bg-white rounded-2xl border border-gray-200 overflow-hidden">
				<button
					type="button"
					class="w-full flex items-center justify-between px-4 py-3 text-left active:bg-gray-50"
					aria-expanded={!!openLanes[sec.key]}
					onclick={() => toggleLane(sec.key)}
				>
					<span class="text-sm font-bold text-gray-800">{sec.label}</span>
					<span class="flex items-center gap-2 text-xs text-gray-400">
						{sec.nodes.length} langkah
						<span class="transition-transform {openLanes[sec.key] ? 'rotate-180' : ''}">▾</span>
					</span>
				</button>

				{#if openLanes[sec.key]}
					<ol class="px-3 pb-3 space-y-2 border-t border-gray-100 pt-3">
						{#each sec.nodes as n (n.id)}
							<li id="pg-node-{n.id}" class="rounded-xl border {openNode === n.id ? 'border-[var(--p,#1d6fa5)] bg-blue-50/40' : 'border-gray-200 bg-white'}">
								<button
									type="button"
									class="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
									aria-expanded={openNode === n.id}
									onclick={() => toggleNode(n)}
								>
									<span aria-hidden="true">{TYPE_ICON[n.type] || '▫️'}</span>
									<span class="flex-1 text-sm font-semibold text-gray-800">{n.label}</span>
									{#if n.type === 'decision'}<span class="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">Keputusan</span>{/if}
								</button>

								{#if openNode === n.id}
									<div class="px-3 pb-3 space-y-3 text-xs text-gray-700">
										<p class="leading-relaxed text-gray-600">{n.desc}</p>

										{#if n.pic}
											<div>
												<p class="text-[11px] font-bold text-gray-500 uppercase tracking-wide">👤 Penanggung jawab</p>
												<p class="mt-0.5">{n.pic}</p>
											</div>
										{/if}

										{#if n.checklist?.length}
											<div>
												<p class="text-[11px] font-bold text-gray-500 uppercase tracking-wide">✅ Yang perlu dipenuhi</p>
												<ul class="mt-1 space-y-1">
													{#each n.checklist as c}<li class="flex gap-2 leading-snug"><span class="text-gray-300">☐</span><span>{c}</span></li>{/each}
												</ul>
											</div>
										{/if}

										{#if n.blockers?.length}
											<div class="rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2">
												<p class="text-[11px] font-bold text-amber-700 uppercase tracking-wide">⚠️ Sering membuat tertahan</p>
												<ul class="mt-1 list-disc pl-4 space-y-1 text-amber-900">
													{#each n.blockers as b}<li class="leading-snug">{b}</li>{/each}
												</ul>
											</div>
										{/if}

										{#if n.next.length}
											<div>
												<p class="text-[11px] font-bold text-gray-500 uppercase tracking-wide">➡️ Lanjut ke</p>
												<div class="mt-1.5 flex flex-wrap gap-2">
													{#each n.next as nx}
														<button
															type="button"
															class="px-2.5 py-1.5 rounded-lg border text-[11px] font-medium text-left {nx.backward ? 'border-red-200 text-red-700 bg-red-50' : 'border-gray-200 text-gray-700 bg-gray-50'}"
															onclick={() => fokusKe(nx.toId)}
														>
															{#if nx.condition}<span class="font-bold">{nx.backward ? '↩ ' : ''}{nx.condition}:</span>{/if} {nx.toLabel}
														</button>
													{/each}
												</div>
											</div>
										{/if}

										{#if n.actions?.length}
											<div class="flex flex-wrap gap-2 pt-1">
												{#each n.actions as a}
													<a href={a.href} class="px-3 py-2 rounded-xl text-xs font-bold text-white active:scale-95 transition-transform" style="background: var(--p, #1d6fa5)">{a.label} →</a>
												{/each}
											</div>
										{/if}
									</div>
								{/if}
							</li>
						{/each}
					</ol>
				{/if}
			</section>
		{/each}
	{/if}
</div>
