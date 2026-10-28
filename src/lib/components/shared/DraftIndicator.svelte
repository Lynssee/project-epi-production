<script lang="ts">
	// Penanda kecil "Draf tersimpan HH:MM" (rencana v2, 3.3). Bukan sekadar hiasan:
	// user lapangan yang pernah kehilangan data cenderung enggan menekan tombol kamera —
	// indikator ini memulihkan kepercayaan bahwa isian mereka aman.
	import IconCheck from '@tabler/icons-svelte/icons/check';
	import IconWifiOff from '@tabler/icons-svelte/icons/wifi-off';

	// isOffline (Fase 4, "Offline-First Daily Report"): tampilkan status koneksi berdampingan
	// dengan status draft, supaya user tahu KENAPA submit belum bisa dilakukan tanpa harus
	// mencoba dulu dan gagal.
	let { savedAt, hasPhotos = false, isOffline = false }: { savedAt: Date | null; hasPhotos?: boolean; isOffline?: boolean } = $props();

	let label = $derived(
		savedAt
			? `Draf tersimpan ${savedAt.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}${hasPhotos ? ' (+ foto)' : ''}`
			: ''
	);
</script>

{#if isOffline}
	<span class="draft-indicator draft-indicator--offline">
		<IconWifiOff size={12} />
		Offline — draf aman tersimpan di perangkat
	</span>
{:else if savedAt}
	<span class="draft-indicator">
		<IconCheck size={12} />
		{label}
	</span>
{/if}

<style>
	.draft-indicator {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		font-weight: 500;
		color: var(--sys-label3, #6b7280);
	}
	.draft-indicator--offline {
		color: #b45309;
	}
</style>
