<!-- src/routes/+error.svelte -->
<!--
  Fase 2, rencana v2 Draf Otomatis Universal & Anti-White-Screen — project-epi
  BELUM punya +error.svelte sebelumnya (dikonfirmasi audit Fase 0). Ini
  menangkap error di load/navigasi (bukan error render komponen — itu tugas
  <svelte:boundary> di +layout.svelte). Gaya mobile karena project-epi dipakai
  di lapangan lewat HP/tablet.
-->
<script>
	import { page } from '$app/stores';

	function reloadPage() {
		try {
			sessionStorage.removeItem('last_dyn_import_reload');
		} catch {}
		const url = new URL(window.location.href);
		url.searchParams.set('_r', Date.now().toString());
		window.location.href = url.toString();
	}

	function goHome() {
		window.location.href = '/';
	}
</script>

<svelte:head>
	<title>Terjadi Kendala - {$page.status || 500} | EPI Lapangan</title>
</svelte:head>

<div class="min-h-screen flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100">
	<div class="max-w-sm w-full bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-5 text-center">
		<div class="w-14 h-14 mx-auto mb-3 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center">
			<svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
			</svg>
		</div>

		<div class="inline-block px-2 py-0.5 mb-2 rounded-full text-[11px] font-semibold bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
			Status {$page.status || 500}
		</div>

		<h1 class="text-lg font-bold mb-2">
			{#if $page.status === 404}
				Halaman Tidak Ditemukan
			{:else}
				Gagal Memuat Halaman
			{/if}
		</h1>

		<p class="text-xs text-slate-500 dark:text-slate-400 mb-5 leading-relaxed">
			{#if $page.error?.message?.includes('dynamically imported module') || $page.error?.message?.includes('fetch')}
				Koneksi sempat terputus atau ada pembaruan sistem. Muat ulang untuk lanjut. Isian
				form yang sudah sempat tersimpan otomatis tetap aman di perangkat ini.
			{:else}
				{$page.error?.message || 'Terjadi kendala saat memuat data. Isian form yang sudah sempat tersimpan otomatis tetap aman.'}
			{/if}
		</p>

		<div class="flex flex-col gap-2.5">
			<button
				type="button"
				onclick={reloadPage}
				class="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold transition-all shadow-sm shadow-blue-500/20 active:scale-95"
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
				</svg>
				Muat Ulang &amp; Pulihkan Isian
			</button>

			<button
				type="button"
				onclick={goHome}
				class="inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-sm font-medium transition-all active:scale-95"
			>
				Ke Beranda
			</button>
		</div>
	</div>
</div>
