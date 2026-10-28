<script lang="ts">
	// Penajaman Gate SJ — Offline Proof Buffer. Penyinkron antrean foto SJ fisik (headless): dipasang sekali di layout
	// (app) agar foto yang tersimpan di HP terkirim otomatis begitu ada sinyal, di halaman mana pun. Tidak merender apa pun.
	import { onMount } from 'svelte';
	import { registerScanSjAutoFlush } from '$lib/utils/offlineScanSjQueue';
	import { uploadScanSjFisik, flushScanSjQueueNow } from '$lib/services/sjTunggakan';
	import { refreshOutboxCounts } from '$lib/stores/offlineOutboxStore';

	onMount(() => {
		const sendEntry = async (e: { sjId: number | string; photoBlob: Blob }) => {
			await uploadScanSjFisik(e.sjId, e.photoBlob);
			refreshOutboxCounts();
		};
		const off = registerScanSjAutoFlush(sendEntry);
		// Kirim sisa antrean saat aplikasi dibuka (mis. HP sudah online lagi sebelum aplikasi dibuka).
		flushScanSjQueueNow().then(() => refreshOutboxCounts()).catch(() => {});
		return off;
	});
</script>
