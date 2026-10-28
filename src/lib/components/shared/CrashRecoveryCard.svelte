<!--
  Kartu pemulihan saat <svelte:boundary> menangkap error render (Fase 2, rencana v2
  Draf Otomatis Universal & Anti-White-Screen). Menggantikan SELURUH slot halaman
  (bukan cuma bagian yang rusak) — keputusan user: aman & jelas, konsisten diuji.

  Beda dari +error.svelte: +error.svelte cuma menangkap error di load/navigasi,
  ini menangkap error saat KOMPONEN merender (mis. TypeError dari relasi Directus
  null, Aturan #7). Tanpa svelte:boundary, error begini sebelumnya = layar putih
  total.

  Reload penuh (bukan reset() boundary) dipilih sebagai aksi utama — error
  render umumnya deterministik (akan error lagi kalau cuma re-render), jadi
  reset() saja jarang menolong. Isian form (Lapis 2, createFormPersist) sudah
  otomatis tersimpan lewat debounce 500ms sebelum crash; setelah reload, form
  yang sama akan memulihkannya sendiri lewat restore() miliknya.
-->
<script>
	let { error } = $props();
	let showDetail = $state(false);

	function reload() {
		window.location.reload();
	}

	async function copyErrorDetail() {
		const text = String(error?.stack || error?.message || error || 'Error tidak diketahui');
		try {
			await navigator.clipboard?.writeText(text);
		} catch {
			// clipboard API tidak tersedia/ditolak — bukan fatal, detail masih terlihat di layar
		}
	}
</script>

<div class="min-h-[60vh] flex items-center justify-center p-4">
	<div
		class="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-6 md:p-8 text-center"
	>
		<div
			class="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center"
		>
			<svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
				<path
					stroke-linecap="round"
					stroke-linejoin="round"
					stroke-width="2"
					d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
				/>
			</svg>
		</div>

		<h1 class="text-xl font-bold mb-2">Tampilan Halaman Bermasalah</h1>

		<p class="text-xs md:text-sm text-slate-500 dark:text-slate-400 mb-6 leading-relaxed">
			Bukan salah Anda — ada bagian halaman yang gagal ditampilkan. Isian form yang sudah
			sempat tersimpan otomatis tetap aman di perangkat ini. Muat ulang untuk melanjutkan.
		</p>

		<div class="flex flex-col sm:flex-row gap-3 justify-center">
			<button
				type="button"
				onclick={reload}
				class="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs md:text-sm font-semibold transition-all shadow-sm shadow-blue-500/20 active:scale-95"
			>
				<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						stroke-width="2"
						d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
					/>
				</svg>
				Muat Ulang Halaman
			</button>
		</div>

		<button
			type="button"
			class="mt-4 text-[11px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 underline underline-offset-2"
			onclick={() => (showDetail = !showDetail)}
		>
			{showDetail ? 'Sembunyikan detail teknis' : 'Detail teknis (untuk laporan bug)'}
		</button>

		{#if showDetail}
			<div class="mt-2 text-left">
				<pre
					class="text-[10px] bg-slate-50 dark:bg-slate-900 rounded-lg p-3 overflow-auto max-h-32 text-slate-500 whitespace-pre-wrap break-words">{error?.stack || error?.message ||
						String(error)}</pre>
				<button
					type="button"
					class="mt-1 text-[11px] text-blue-600 hover:underline"
					onclick={copyErrorDetail}
				>
					Salin detail error
				</button>
			</div>
		{/if}
	</div>
</div>
