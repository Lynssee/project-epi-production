<!-- src/lib/components/help/ProcessHandoffChain.svelte -->
<!-- "🔗 Rantai Serah-Terima Alur Ini": ⬅️ Diterima dari (Hulu) dan ➡️ Diserahkan ke (Hilir). Kartu vertikal ringan untuk HP (tanpa SVG),
     setiap baris punya tombol lompat 1-ketuk ke alur seberang. mode="hilir" = hanya pengingat "setelah selesai, dilanjutkan oleh…" (bagian bawah). -->
<script lang="ts">
	import { HANDOFF_TYPE_LABEL, type FlowChain, type ChainItem } from '$lib/utils/processHandoffChain';

	interface Props {
		chain: FlowChain | null;
		mode?: 'full' | 'hilir';
		/** Ketuk "Buka alur": pindah ke alur seberang dan fokus ke langkahnya. */
		onjump?: (flowId: string, nodeId: string) => void;
	}
	let { chain, mode = 'full', onjump }: Props = $props();

	const TYPE_CLS: Record<string, string> = {
		dokumen: 'bg-blue-50 text-blue-700 border-blue-200',
		barang: 'bg-amber-50 text-amber-700 border-amber-200',
		dana: 'bg-emerald-50 text-emerald-700 border-emerald-200',
		otorisasi: 'bg-violet-50 text-violet-700 border-violet-200'
	};
	let up = $derived(chain?.upstream ?? []);
	let down = $derived(chain?.downstream ?? []);
	let show = $derived(mode === 'hilir' ? down.length > 0 : up.length + down.length > 0);
</script>

{#if show}
	<section class="bg-white rounded-2xl border border-indigo-200 p-3.5 shadow-sm space-y-3" data-testid="handoff-chain-{mode}" aria-label="Rantai serah-terima alur ini">
		{#if mode === 'full'}
			<h3 class="text-xs font-bold text-indigo-800 flex items-center gap-1.5">🔗 Rantai Serah-Terima Alur Ini</h3>
			{#if up.length}
				{@render group('⬅️ Diterima dari (Hulu)', 'Sebelum mulai, pastikan dokumen/barang ini sudah Anda terima:', up, 'Dari')}
			{/if}
			{#if down.length}
				{@render group('➡️ Diserahkan ke (Hilir)', 'Setelah selesai, hasil pekerjaan Anda diserahkan ke:', down, 'Ke')}
			{/if}
		{:else}
			<p class="text-xs text-indigo-900 leading-relaxed" data-testid="handoff-hint">
				📌 Setelah langkah terakhir di alur ini selesai, dokumen/pekerjaan Anda akan dilanjutkan oleh
				<b>{[...new Set(down.map((d) => d.flow_title))].join(', ')}</b>.
			</p>
			<div class="flex flex-wrap gap-2">
				{#each down as d (d.code + d.flow_id + d.node_id)}
					<button type="button" class="px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-[11px] font-semibold text-indigo-800 active:scale-95" onclick={() => onjump?.(d.flow_id, d.node_id)}>Buka: {d.flow_title} →</button>
				{/each}
			</div>
		{/if}
	</section>
{/if}

{#snippet group(title: string, hint: string, items: ChainItem[], prefix: string)}
	<div>
		<p class="text-[11px] font-bold text-gray-600 uppercase tracking-wide">{title}</p>
		<p class="text-[11px] text-gray-500 mb-1.5">{hint}</p>
		<ul class="space-y-2">
			{#each items as it (it.code + it.flow_id + it.node_id + it.own_node_id)}
				<li class="rounded-xl border border-gray-200 bg-gray-50/70 p-2.5">
					<div class="flex items-start justify-between gap-2">
						<p class="text-xs font-semibold text-gray-900 leading-snug">{it.doc_label || 'Serah-terima'}</p>
						<span class="shrink-0 px-1.5 py-0.5 rounded-full border text-[10px] font-medium {TYPE_CLS[it.handoff_type] ?? ''}">{HANDOFF_TYPE_LABEL[it.handoff_type] ?? it.handoff_type}</span>
					</div>
					<p class="text-[11px] text-gray-600 mt-1 leading-snug">
						{prefix}: <b>{it.flow_title}</b>{#if it.node_label}<span class="text-gray-400"> · langkah “{it.node_label}”</span>{/if}
					</p>
					{#if it.own_node_label}
						<p class="text-[10px] text-gray-400 mt-0.5">Terkait langkah Anda: “{it.own_node_label}”</p>
					{/if}
					<button type="button" class="mt-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-white text-[11px] font-semibold text-indigo-700 active:scale-95" onclick={() => onjump?.(it.flow_id, it.node_id)}>Buka alur ini →</button>
				</li>
			{/each}
		</ul>
	</div>
{/snippet}
