<!-- src/routes/(app)/panduan/alur/FlowMiniMap.svelte -->
<!-- "🗺️ Peta Alur Mini" — diagram alur vertikal untuk layar HP, digambar dari data alur yang SUDAH ada di memori (0 request, tetap jalan offline).
     ◇ = keputusan (cabang berlabel), garis putus-putus oranye = kembali/perbaikan. Ketuk langkah → kartu membuka rincian langkah itu. -->
<script lang="ts">
	import type { ProcessFlow } from '$lib/data/processGuidance';
	import type { CycleStep } from './gateCardModel';
	import { layoutMiniMap } from './flowMiniMap';

	let { flow, steps, selected = '', onpick }: { flow: ProcessFlow | null; steps: CycleStep[]; selected?: string; onpick?: (id: string) => void } = $props();

	let map = $derived(layoutMiniMap(flow, steps));
	const MODE_COLOR: Record<string, string> = { hard: '#e11d48', soft: '#ea580c', warn: '#ca8a04', shadow: '#64748b' };
	const strokeOf = (n: { strongest: string | null; type: string }) => (n.strongest ? MODE_COLOR[n.strongest] : n.type === 'decision' ? '#d97706' : '#94a3b8');
	const pick = (n: { id: string; tappable: boolean }) => n.tappable && onpick?.(n.id);
</script>

{#if map.empty}
	<p class="text-[11px] text-gray-500" data-testid="mini-map-empty">Alur ini belum punya langkah untuk digambar.</p>
{:else}
	<div class="space-y-1.5" data-testid="mini-map">
		<!-- Lebar mengikuti layar (maks. ukuran asli, min. 70% supaya teks tetap terbaca); sisanya digeser ke samping. Murni CSS, tanpa JS. -->
		<div class="overflow-x-auto rounded-xl border border-gray-200 bg-white" style="touch-action: pan-x pan-y">
			<svg viewBox="0 0 {map.width} {map.height}" role="img" aria-label="Peta alur: {flow?.title ?? ''}" font-family="ui-sans-serif, system-ui, sans-serif" font-size="11" class="block" style="width:100%;height:auto;min-width:{Math.round(map.width * 0.7)}px;max-width:{map.width}px">
				<defs>
					<marker id="mm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#475569" /></marker>
					<marker id="mm-arrow-back" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#d97706" /></marker>
				</defs>
				{#each map.edges as e, i (i)}
					<path d={e.points.map((p, k) => `${k ? 'L' : 'M'} ${p[0]} ${p[1]}`).join(' ')} fill="none" stroke={e.back ? '#d97706' : '#475569'} stroke-width="1.5" stroke-dasharray={e.back ? '5 3' : undefined} marker-end={e.back ? 'url(#mm-arrow-back)' : 'url(#mm-arrow)'} />
					{#if e.label}<text x={e.lx} y={e.ly} text-anchor={e.back ? 'end' : 'start'} font-size="10" font-weight="700" fill={e.back ? '#b45309' : '#4338ca'}>{e.back ? '↩ ' : ''}{e.label}</text>{/if}
				{/each}
				{#each map.nodes as n (n.id)}
					{@const sel = n.id === selected}
					<!-- role/tabindex hanya dipasang bersamaan pada simpul yang bisa diketuk (Mulai/Selesai statis) -->
					<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_static_element_interactions -->
					<g
						role={n.tappable ? 'button' : undefined}
						tabindex={n.tappable ? 0 : undefined}
						aria-label={n.tappable ? `Langkah ${n.no}: ${n.full}` : undefined}
						aria-pressed={n.tappable ? sel : undefined}
						class={n.tappable ? 'cursor-pointer' : ''}
						data-testid={n.tappable ? 'mini-node' : undefined}
						data-node={n.id}
						onclick={() => pick(n)}
						onkeydown={(ev) => (ev.key === 'Enter' || ev.key === ' ') && pick(n)}
					>
						<title>{n.full}{n.gates ? ` · ${n.gates} gate` : ''}</title>
						{#if n.shape === 'diamond'}
							<polygon points="{n.cx},{n.y} {n.x + n.w},{n.cy} {n.cx},{n.y + n.h} {n.x},{n.cy}" fill="#fef3c7" stroke={sel ? '#7e22ce' : strokeOf(n)} stroke-width={sel ? 3 : 1.7} />
							<text x={n.cx} y={n.cy + 4} text-anchor="middle" font-weight="700" fill="#1e293b">{n.label}</text>
						{:else if n.shape === 'pill'}
							<rect x={n.x} y={n.y} width={n.w} height={n.h} rx={n.h / 2} fill={n.type === 'start' ? '#dcfce7' : '#e2e8f0'} stroke={n.type === 'start' ? '#16a34a' : '#64748b'} stroke-width="1.5" />
							<text x={n.cx} y={n.cy + 4} text-anchor="middle" font-weight="700" fill="#1e293b">{n.label}</text>
						{:else}
							<rect x={n.x} y={n.y} width={n.w} height={n.h} rx="9" fill="#ffffff" stroke={sel ? '#7e22ce' : strokeOf(n)} stroke-width={sel ? 3 : n.strongest ? 2 : 1.4} />
							<text x={n.x + 30} y={n.cy + 4} font-weight="600" fill="#1e293b">{n.label}</text>
						{/if}
						{#if n.no !== null && n.shape === 'rect'}
							<circle cx={n.x + 15} cy={n.cy} r="9" fill="#f3e8ff" />
							<text x={n.x + 15} y={n.cy + 3.5} text-anchor="middle" font-size="10" font-weight="700" fill="#6b21a8">{n.no}</text>
						{/if}
						{#if n.no !== null && n.shape === 'diamond'}
							<circle cx={n.x + 8} cy={n.y + 8} r="8" fill="#f3e8ff" />
							<text x={n.x + 8} y={n.y + 11.5} text-anchor="middle" font-size="9" font-weight="700" fill="#6b21a8">{n.no}</text>
						{/if}
						{#if n.gates}
							<circle cx={n.x + n.w - 2} cy={n.y + 2} r="9" fill={n.strongest ? MODE_COLOR[n.strongest] : '#7c3aed'} />
							<text x={n.x + n.w - 2} y={n.y + 5.5} text-anchor="middle" font-size="9" font-weight="700" fill="#fff">{n.gates}</text>
						{/if}
					</g>
				{/each}
			</svg>
		</div>
		<p class="text-[10px] text-gray-500 leading-relaxed" data-testid="mini-map-legend">
			◇ = keputusan (pilih cabang sesuai label) · garis putus-putus oranye ↩ = kembali ke langkah sebelumnya (perbaikan) · lencana ungu/warna = jumlah gate. <b>Ketuk langkah</b> untuk melihat rinciannya di bawah. Geser ke samping bila diagram lebar.
		</p>
	</div>
{/if}
