<!-- src/routes/kiosk/[workshop=workshop]/cek-stok/+page.svelte -->
<!-- Cek stok kiosk berparameter workshop (ciketing | balaraja) — Fase 7 Unifikasi Workshop. -->
<script lang="ts">
	import { page } from '$app/state';
	import KioskCekStok from '$lib/components/kiosk/KioskCekStok.svelte';
	import type { WorkshopKey } from '$lib/kiosk/workshopKiosk';
</script>

<KioskCekStok workshop={page.params.workshop as WorkshopKey} />
