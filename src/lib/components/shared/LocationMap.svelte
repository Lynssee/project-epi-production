<!-- src/lib/components/shared/LocationMap.svelte -->
<!--
	Peta lokasi pertama di repo ini (Fase 6 open-source plan — MapLibre GL JS, BSD-3,
	pengganti Mapbox yang sudah proprietary). Sebelum ini, ~29 halaman menyimpan
	GPS (watermark foto/geofence) tapi TIDAK PERNAH menampilkannya sebagai peta.

	Tile dari OpenFreeMap (gratis, tanpa API key, komunitas open-source) — dikonfirmasi
	user. INGAT: setiap render peta mengirim koordinat area ke server pihak ketiga
	(tiles.openfreemap.org), bukan self-hosted. Jangan pakai untuk lokasi yang benar-benar
	rahasia tanpa persetujuan tambahan.

	Lazy-load: import komponen ini via `await import(...)` di pemanggil (pola sama dengan
	QrScannerModal/EquipmentActionSheet) supaya maplibre-gl (~200KB) tidak ikut bundle utama
	-- penting di lapangan dengan koneksi lemah.
-->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import 'maplibre-gl/dist/maplibre-gl.css';

	let {
		lat,
		lng,
		zoom = 15,
		label = '',
		height = '220px'
	}: { lat: number; lng: number; zoom?: number; label?: string; height?: string } = $props();

	const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';

	let container: HTMLDivElement | undefined = $state();
	let map: any = null;
	let loadError = $state('');

	onMount(async () => {
		try {
			const { Map: MapLibreMap, NavigationControl, Marker, Popup } = await import('maplibre-gl');
			if (!container) return;
			map = new MapLibreMap({
				container,
				style: OPENFREEMAP_STYLE,
				center: [lng, lat],
				zoom
			});
			map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
			const marker = new Marker({ color: '#1F6592' }).setLngLat([lng, lat]);
			if (label) marker.setPopup(new Popup({ offset: 24 }).setText(label));
			marker.addTo(map);
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Gagal memuat peta.';
			console.error('LocationMap gagal memuat:', e);
		}
	});

	onDestroy(() => {
		map?.remove();
		map = null;
	});
</script>

{#if loadError}
	<div
		class="rounded-lg flex items-center justify-center text-[11px] p-4 text-center"
		style="height: {height}; background: var(--sys-fill, #f1f5f9); color: var(--sys-label3, #6b7280)"
	>
		Peta tidak bisa dimuat ({loadError}). Koordinat: {lat.toFixed(6)}, {lng.toFixed(6)}
	</div>
{:else}
	<div bind:this={container} class="rounded-lg overflow-hidden" style="height: {height}; width: 100%"></div>
{/if}
