<!-- src/lib/components/ui/CircularProgressGauge.svelte -->
<!-- Proxy wrapper to shared CircularProgressGauge for backward compatibility -->
<script lang="ts">
  import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';

  // Mode runes dipaksa di project-epi: `$$props` dilarang → seluruh props diteruskan lewat $props() rest.
  let props: Record<string, any> = $props();
</script>

<CircularProgressGauge {...props} />
