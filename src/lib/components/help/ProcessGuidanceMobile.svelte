<!-- src/lib/components/help/ProcessGuidanceMobile.svelte -->
<!-- Alur bisnis versi lapangan: akordeon per lane + kartu langkah (ketuk = buka panduan). Tanpa SVG/peta → ringan di HP
     dan tetap terbaca di sinyal buruk (data dibundel, tidak ada fetch). Lihat dashboard admin untuk peta swimlane lengkap. -->
<script lang="ts">
	import { tick } from 'svelte';
	import ProcessTrainingStatus from '$lib/components/help/ProcessTrainingStatus.svelte';
	import ProcessHandoffChain from '$lib/components/help/ProcessHandoffChain.svelte';
	import type { FlowChain } from '$lib/utils/processHandoffChain';
	import { trainingForNode } from '$lib/utils/processTraining';
	import type { ProcessFlow } from '$lib/data/processGuidance';
	import { buildLaneSections, laneOfNode, type NodeView } from '$lib/utils/processGuidance';
	import { inferFieldActionsForNode } from '$lib/utils/fieldProjectStepper.js';

	interface Props {
		flow: ProcessFlow | null;
		/** id langkah yang dibuka otomatis (deep-link dari tombol bantuan kontekstual). */
		fokus?: string;
		/** id langkah yang menjadi tugas pengguna (jabatannya cocok dengan PIC) — diberi tanda ⭐. */
		mine?: string[];
		/** Rantai serah-terima alur ini (hulu/hilir); null = belum termuat / tidak ada → kartu tidak tampil. */
		chain?: FlowChain | null;
		/** Ketuk tombol lompat pada kartu serah-terima. */
		onjump?: (flowId: string, nodeId: string) => void;
	}
	let { flow, fokus = '', mine = [], chain = null, onjump }: Props = $props();
	let mineSet = $derived(new Set(mine));

	let sections = $derived(buildLaneSections(flow));
	let openLanes = $state<Record<string, boolean>>({});
	let openNode = $state('');
	let openSopClauses = $state(false);

	const TYPE_ICON: Record<string, string> = { start: '🟢', end: '🏁', decision: '🔶', task: '▫️' };

	/** Tombol aksi lapangan sebuah langkah: pintasan yang diatur di editor; bila kosong, ditebak dari teks langkah (inferFieldActionsForNode). */
	function aksiEfektif(n: NodeView): { label: string; href: string }[] {
		return n.actions && n.actions.length > 0 ? n.actions : inferFieldActionsForNode(n.label, n.desc);
	}

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

		<ProcessHandoffChain {chain} mode="full" {onjump} />

		{#if flow.sop || flow.doc_number}
			<div class="bg-white rounded-2xl border border-gray-200 p-3.5 shadow-sm space-y-2">
				<div class="flex items-center justify-between gap-2">
					<div class="flex items-center gap-1.5 flex-wrap">
						<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200 font-mono">
							📄 {flow.sop?.doc_number || flow.doc_number}
						</span>
						{#if flow.sop?.department_label}
							<span class="text-xs font-semibold text-gray-700">
								{flow.sop.department_label}
							</span>
						{/if}
					</div>
					<div class="flex items-center gap-1.5 text-[11px] text-gray-500">
						{#if flow.sop?.revision_status !== undefined}
							<span>Rev: <strong class="text-gray-700">{flow.sop.revision_status}</strong></span>
						{/if}
						<button
							type="button"
							class="text-[11px] text-blue-600 font-medium ml-1"
							onclick={() => (openSopClauses = !openSopClauses)}
						>
							{openSopClauses ? 'Tutup SOP ▲' : 'Standar SOP ▼'}
						</button>
					</div>
				</div>

				{#if openSopClauses && flow.sop}
					<div class="pt-2 border-t border-gray-100 text-xs text-gray-700 space-y-2.5 bg-gray-50/60 p-2.5 rounded-xl">
						{#if flow.sop.purpose}
							<div>
								<p class="font-bold text-gray-900 text-[11px]">1. TUJUAN</p>
								<p class="text-gray-600 leading-relaxed mt-0.5">{flow.sop.purpose}</p>
							</div>
						{/if}
						{#if flow.sop.scope}
							<div>
								<p class="font-bold text-gray-900 text-[11px]">2. CAKUPAN</p>
								<p class="text-gray-600 leading-relaxed mt-0.5">{flow.sop.scope}</p>
							</div>
						{/if}
						{#if flow.sop.deliverables?.length}
							<div>
								<p class="font-bold text-gray-900 text-[11px]">3. DOKUMEN YANG DIHASILKAN</p>
								<ul class="list-disc list-inside space-y-0.5 text-gray-600 mt-0.5">
									{#each flow.sop.deliverables as doc}
										<li>{doc}</li>
									{/each}
								</ul>
							</div>
						{/if}
						{#if flow.sop.definitions?.length}
							<div>
								<p class="font-bold text-gray-900 text-[11px]">4. DEFINISI & ISTILAH</p>
								<div class="space-y-1 mt-0.5">
									{#each flow.sop.definitions as d}
										<p><strong class="text-gray-800">{d.term}:</strong> <span class="text-gray-600">{d.meaning}</span></p>
									{/each}
								</div>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/if}

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
						{#if sec.nodes.some((n) => mineSet.has(n.id))}<span class="text-amber-600 font-semibold" data-testid="lane-mine">⭐ {sec.nodes.filter((n) => mineSet.has(n.id)).length}</span>{/if}
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
									{#if mineSet.has(n.id)}<span class="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5" data-testid="node-mine">⭐ Tugas Anda</span>{/if}
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

										{#if n.sla_hours}
											<p class="text-[11px] text-gray-500" data-testid="node-sla">⏱ Target selesai {n.sla_hours} jam</p>
										{/if}

										{#if flow}<ProcessTrainingStatus links={trainingForNode(flow, n.id)} />{/if}

										{#if n.gates?.length}
											<div class="rounded-xl border border-purple-200 bg-purple-50/80 p-3 shadow-xs">
												<div class="flex items-center justify-between gap-1 mb-1.5">
													<p class="text-[11px] font-bold text-purple-900 uppercase tracking-wide flex items-center gap-1.5">
														<span>🛡️</span>
														<span>Prasyarat Lanjut</span>
														<span class="text-[9.5px] font-normal text-purple-600">(Dijaga {n.gates.length} Gate Sistem)</span>
													</p>
													<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-purple-200/80 text-purple-900">
														Titik Kendali
													</span>
												</div>
												<p class="text-[10px] text-purple-800 leading-snug mb-2">
													Pastikan bukti kerja dan ketentuan prasyarat berikut telah siap sebelum melanjutkan ke langkah berikutnya:
												</p>
												<ul class="space-y-1 text-purple-950 text-[11px]">
													{#each n.gates as g}
														<li class="flex items-center gap-1.5 font-mono bg-white/80 border border-purple-100 rounded-md px-2 py-1">
															<span class="w-1.5 h-1.5 rounded-full bg-purple-600 shrink-0"></span>
															<strong class="text-purple-950">{g.key}</strong>
															{#if g.modul}<span class="text-purple-600 font-sans text-[10px]">· modul {g.modul}</span>{/if}
														</li>
													{/each}
												</ul>
											</div>
										{/if}

										{#if n.checklist?.length}
											<div class="rounded-xl border border-gray-200 bg-gray-50/70 p-2.5">
												<p class="text-[11px] font-bold text-gray-700 uppercase tracking-wide">✅ Yang perlu dipenuhi</p>
												<ul class="mt-1.5 space-y-1">
													{#each n.checklist as c}
														<li class="flex items-start gap-2 leading-snug text-gray-700">
															<span class="text-emerald-600 font-bold shrink-0 mt-0.5">☑</span>
															<span>{c}</span>
														</li>
													{/each}
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

										{#if chain?.upstream.some((u) => u.own_node_id === n.id) || chain?.downstream.some((d) => d.own_node_id === n.id)}
											<div class="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 space-y-1" data-testid="node-handoff">
												{#each chain.upstream.filter((u) => u.own_node_id === n.id) as u (u.code + u.flow_id + u.node_id)}
													<p class="text-[11px] text-indigo-900 leading-snug">📥 Syarat awal: <b>{u.doc_label}</b> dari <b>{u.flow_title}</b></p>
												{/each}
												{#each chain.downstream.filter((d) => d.own_node_id === n.id) as d (d.code + d.flow_id + d.node_id)}
													<p class="text-[11px] text-indigo-900 leading-snug">📤 Hasil langkah ini ditunggu oleh <b>{d.flow_title}</b>: <b>{d.doc_label}</b></p>
												{/each}
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

										{#if aksiEfektif(n).length}
											<div class="pt-2 border-t border-gray-100">
												<p class="text-[11px] font-bold text-emerald-800 uppercase tracking-wide mb-1.5">⚡ Tindakan Langsung di Lapangan</p>
												<div class="flex flex-wrap gap-2">
													{#each aksiEfektif(n) as a}
														<a
															href={a.href}
															class="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-white shadow-xs active:scale-95 transition-all bg-emerald-600 hover:bg-emerald-700"
														>
															<span>{(a as any).icon || '📱'}</span>
															<span>{a.label}</span>
															<span>→</span>
														</a>
													{/each}
												</div>
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

		<ProcessHandoffChain {chain} mode="hilir" {onjump} />
	{/if}
</div>
