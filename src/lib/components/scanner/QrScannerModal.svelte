<!-- src/lib/components/scanner/QrScannerModal.svelte -->
<!--
  QrScannerModal wrapper menggunakan komponen html5-qrcode (QrCameraScanner.svelte).
  Menyediakan pemindaian kamera HP yang responsif, kontrol senter, ganti kamera, dan fallback file gambar.
-->
<script lang="ts">
	import QrCameraScanner from '$lib/components/ui/QrCameraScanner.svelte';

	let {
		onDetect,
		onClose,
		expectedPrefix = null,
		continuous = false,
		debounceMs = 1500
	}: {
		onDetect: (value: string) => void;
		onClose: () => void;
		expectedPrefix?: string | null;
		continuous?: boolean;
		debounceMs?: number;
	} = $props();
</script>

<QrCameraScanner
	{onDetect}
	{onClose}
	{expectedPrefix}
	{continuous}
	{debounceMs}
/>
