<!-- src/routes/kiosk/ciketing-cek-stok/+page.svelte -->
<!-- Rute lama (kompatibel; bookmark/perangkat kiosk) — isi dipindah ke KioskCekStok.svelte. Versi berparameter: /kiosk/[workshop]/cek-stok. -->
<script lang="ts">
	import KioskCekStok from '$lib/components/kiosk/KioskCekStok.svelte';
</script>

<KioskCekStok workshop="ciketing" />
