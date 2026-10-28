<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	let { 
		hasMore = true, 
		loading = false, 
		rootMargin = '200px',
		onloadmore
	}: {
		hasMore?: boolean;
		loading?: boolean;
		rootMargin?: string;
		onloadmore?: () => void;
	} = $props();

	let element: HTMLDivElement | undefined = $state();
	let observer: IntersectionObserver | undefined;

	onMount(() => {
		observer = new IntersectionObserver(
			(entries) => {
				const first = entries[0];
				if (first.isIntersecting && hasMore && !loading) {
					if (onloadmore) onloadmore();
				}
			},
			{ rootMargin }
		);

		if (element) observer.observe(element);
	});

	onDestroy(() => {
		if (observer && element) observer.unobserve(element);
	});
</script>

<div bind:this={element} class="h-4 w-full flex items-center justify-center my-4">
	{#if loading}
		<div class="relative w-6 h-6">
			<div class="absolute inset-0 rounded-full border-2 border-[var(--gl)]"></div>
			<div class="absolute inset-0 rounded-full border-2 border-t-[var(--g)] border-r-transparent border-b-transparent border-l-transparent animate-spin"></div>
		</div>
	{/if}
</div>
