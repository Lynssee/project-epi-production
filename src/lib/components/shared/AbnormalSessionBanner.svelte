<!--
  Banner global: "sesi terakhir berakhir tidak normal" (Fase 2, rencana v2 Draf
  Otomatis Universal & Anti-White-Screen §4/§9). Muncul kalau sessionCleanliness.js
  mendeteksi penanda sesi sebelumnya masih menggantung DAN ada draf tersimpan.
  Bukan error — cuma info supaya user sadar ada isian lama yang belum terkirim.
-->
<script>
	let { draftCount = 0, onDismiss } = $props();
</script>

{#if draftCount > 0}
	<div
		class="w-full bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900 px-4 py-2 text-xs md:text-sm text-amber-800 dark:text-amber-300 flex items-center justify-between gap-3"
	>
		<span>
			Sesi terakhir berakhir tidak normal. Ada {draftCount} isian belum terkirim tersimpan di
			perangkat ini.
		</span>
		<button
			type="button"
			class="shrink-0 underline hover:no-underline"
			onclick={onDismiss}
		>
			Mengerti
		</button>
	</div>
{/if}
