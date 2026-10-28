<!-- src/routes/kiosk/[workshop=workshop]/potong-bahan/+page.svelte -->
<!-- Potong bahan kiosk berparameter workshop (ciketing | balaraja) — Fase 7 Unifikasi Workshop. -->
<script lang="ts">
	import { page } from '$app/state';
	import KioskPotongBahan from '$lib/components/kiosk/KioskPotongBahan.svelte';
	import type { WorkshopKey } from '$lib/kiosk/workshopKiosk';
</script>

<KioskPotongBahan workshop={page.params.workshop as WorkshopKey} />
