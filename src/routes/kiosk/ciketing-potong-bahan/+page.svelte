<!-- src/routes/kiosk/ciketing-potong-bahan/+page.svelte -->
<!-- Rute lama (kompatibel) — isi dipindah ke KioskPotongBahan.svelte. Versi berparameter: /kiosk/[workshop]/potong-bahan. -->
<script lang="ts">
	import KioskPotongBahan from '$lib/components/kiosk/KioskPotongBahan.svelte';
</script>

<KioskPotongBahan workshop="ciketing" />
