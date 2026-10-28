<!-- src/lib/components/ui/CircularProgressGauge.svelte -->
<!-- Proxy wrapper to shared CircularProgressGauge for backward compatibility -->
<script lang="ts">
  import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
</script>

<CircularProgressGauge {...$$props} />
