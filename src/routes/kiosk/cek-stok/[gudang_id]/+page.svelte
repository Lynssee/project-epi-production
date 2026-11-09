<script lang="ts">
	// src/routes/kiosk/cek-stok/[gudang_id]/+page.svelte
	// Detail satu rak di Kiosk Gudang. Seluruh isi & logikanya ada di RakDetailPanel, yang juga
	// dipakai pop-up sub rak/pallet.
	import { page } from '$app/state';
	import RakDetailPanel from '$lib/components/kiosk/RakDetailPanel.svelte';
</script>

<RakDetailPanel gudangId={Number(page.params.gudang_id)} />
