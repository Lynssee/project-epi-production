<script lang="ts">
	// Peminjaman 08 Fase B — penyinkron antrean P2H (headless). Dipasang sekali di layout (app) supaya P2H yang
	// tersimpan di HP terkirim otomatis begitu ada sinyal, di halaman mana pun peminjam berada — bukan hanya bila
	// ia kebetulan membuka halaman peminjaman. Tidak merender apa pun.
	import { onMount } from 'svelte';
	import { registerP2HAutoFlush } from '$lib/utils/offlineP2HQueue';
	import { refreshOutboxCounts } from '$lib/stores/offlineOutboxStore';

	onMount(() => registerP2HAutoFlush(() => refreshOutboxCounts()));
</script>
