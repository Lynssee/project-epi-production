<!-- Host uji untuk Tooltip (hanya dipakai tes). -->
<script lang="ts">
	import Tooltip from './Tooltip.svelte';
	let { text = '', parentClick = false, cls = '', style = '', count = 1, inP = false }: { text?: string; parentClick?: boolean; cls?: string; style?: string; count?: number; inP?: boolean } = $props();
</script>

<div role="presentation" onclick={() => { if (parentClick) (window as any).__parentClicked = ((window as any).__parentClicked ?? 0) + 1; }}>
	{#each Array(count) as _, i}
		{#if inP}
			<p><Tooltip text="{text}{i}" class={cls} {style}><span>pemicu{i}</span></Tooltip></p>
		{:else}
			<Tooltip text="{text}{i}" class={cls} {style}><span>pemicu{i}</span></Tooltip>
		{/if}
	{/each}
</div>
