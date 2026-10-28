<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { IconLoader2 } from '@tabler/icons-svelte';

	onMount(() => {
		goto('/ess/kendaraan', { replaceState: true });
	});
</script>

<div class="flex flex-col items-center justify-center min-h-[60vh]">
	<CircularProgressGauge size={54} strokeWidth={4} label="Mengalihkan ke Portal Karyawan..." />
</div>

