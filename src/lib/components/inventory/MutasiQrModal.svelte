<!-- src/lib/components/inventory/MutasiQrModal.svelte -->
<!-- Tampilkan QR e-SJ Mutasi layar penuh di HP leader/sopir — satpam & penerima memindai langsung dari layar, tanpa kertas.
     Isi QR = EPI:MUT:<id>:<token> (sama dengan cetakan admin). -->
<script lang="ts">
	import { onMount } from 'svelte';
	import QRCode from 'qrcode';
	import { IconX } from '@tabler/icons-svelte';
	import { qrPayloadMutasi, type Mutasi } from '$lib/services/mutasiApi';

	let { m, onClose }: { m: Mutasi; onClose: () => void } = $props();
	let dataUrl = $state('');
	let gagal = $state('');

	onMount(async () => {
		const payload = qrPayloadMutasi(m);
		if (!payload) { gagal = 'Dokumen ini belum punya token QR. Muat ulang halaman, atau hubungi Admin Inventory.'; return; }
		try {
			dataUrl = await QRCode.toDataURL(payload, { margin: 2, width: 640, errorCorrectionLevel: 'M' });
		} catch (e) {
			console.error('[MutasiQrModal] gagal membuat QR:', e);
			gagal = 'QR gagal dibuat. Coba lagi.';
		}
	});
</script>

<div class="fixed inset-0 z-[70] bg-white flex flex-col items-center justify-center p-4 gap-3" role="dialog" aria-modal="true" aria-label="QR e-SJ Mutasi">
	<button type="button" class="absolute top-3 right-3 p-2 rounded-full bg-slate-100 text-slate-700" onclick={onClose} aria-label="Tutup"><IconX size={20} /></button>
	<p class="text-base font-bold text-slate-900 break-all text-center">{m.nomor_mutasi}</p>
	<p class="text-xs text-slate-600 text-center">{m.asal_nama} → {m.tujuan_nama}</p>
	{#if dataUrl}
		<img src={dataUrl} alt="QR e-SJ Mutasi" class="w-[min(86vw,420px)] h-[min(86vw,420px)]" />
	{:else if gagal}
		<p class="text-sm text-red-600 text-center max-w-xs">{gagal}</p>
	{:else}
		<p class="text-sm text-slate-400">Membuat QR…</p>
	{/if}
	<ul class="text-[11px] text-slate-500 text-center max-w-xs space-y-0.5">
		<li>Naikkan kecerahan layar HP, lalu tunjukkan ke satpam (rute via gerbang) dan ke penerima di tujuan.</li>
		<li>Jangan bagikan tangkapan layar QR ini ke orang di luar pengiriman.</li>
	</ul>
</div>
