<!-- src/routes/(app)/hrga/+page.svelte -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	onMount(() => {
		goto('/hrga/hub', { replaceState: true });
	});
</script>

<svelte:head>
	<title>HRD & GA — EPI</title>
</svelte:head>

<div class="p-8 text-center text-xs font-semibold text-slate-400">
	Memuat Hub HRD & GA...
</div>
