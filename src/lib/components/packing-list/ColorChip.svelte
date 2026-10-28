<!--
  Fase 3 (Standarisasi Cat & Smart Swatch, 5 Okt 2026) — kotak warna visual di samping
  teks material_color pada tampilan packing list lapangan (Svelte 5 runes).
-->
<script lang="ts">
	import { getColorHex } from '$lib/services/colorCatalog';
	import type { Snippet } from 'svelte';

	let {
		color = '',
		size = 'sm',
		children
	}: {
		color?: string;
		size?: 'xs' | 'sm';
		children?: Snippet;
	} = $props();

	let hex = $state<string | null>(null);

	$effect(() => {
		const c = (color || '').trim();
		if (!c || c === '-' || c === '()') {
			hex = null;
			return;
		}
		getColorHex(c).then((h) => {
			hex = h;
		});
	});
</script>

{#if color && color.trim() && color.trim() !== '-'}
	<span class="inline-flex items-center gap-1">
		<span
			class="{size === 'xs' ? 'w-2.5 h-2.5' : 'w-3 h-3'} rounded border border-gray-300 dark:border-gray-600 inline-block shrink-0 {!hex ? 'bg-gray-100 dark:bg-gray-800' : ''}"
			style={hex ? `background-color:${hex}` : ''}
			title={hex ? color : `${color} (belum ada acuan visual di katalog warna)`}
		></span>
		{#if children}
			{@render children()}
		{:else}
			<span class="text-slate-700 dark:text-slate-300">{color}</span>
		{/if}
	</span>
{/if}
