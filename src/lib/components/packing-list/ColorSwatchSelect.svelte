<!-- Fase 2 (Standarisasi Cat & Smart Swatch, 5 Okt 2026) — pengganti input teks bebas untuk
     warna material. Tetap menulis string biasa ke `value` (field material_color tidak diubah
     skemanya) supaya kompatibel dengan data lama & modul lain yang membaca field ini. Yang
     berubah cuma UX: user memilih dari katalog warna_fg (dengan swatch visual) alih-alih
     mengetik bebas, tapi tetap bisa ketik bebas untuk warna yang belum ada di katalog
     (fallback otomatis — tidak ada mode terkunci). -->
<script lang="ts">
	import { IconChevronDown, IconSearch } from '@tabler/icons-svelte';
	import { searchColorCatalog, type ColorCatalogEntry } from '$lib/services/colorCatalog';

	let {
		value = $bindable(''),
		placeholder = 'Contoh: RAL 7035 / OX-101',
		id = undefined
	}: { value: string; placeholder?: string; id?: string } = $props();

	let open = $state(false);
	let suggestions = $state<ColorCatalogEntry[]>([]);
	let loading = $state(false);
	let debounceTimer: any = null;
	let inputEl: HTMLInputElement | undefined = $state();

	// Swatch untuk warna yang sedang terisi di `value` (kalau cocok persis nama katalog),
	// supaya chip tetap tampil setelah dipilih, bukan cuma saat dropdown terbuka.
	let selectedMatch = $state<ColorCatalogEntry | null>(null);

	async function runSearch(text: string) {
		loading = true;
		try {
			suggestions = await searchColorCatalog(text, 15);
		} finally {
			loading = false;
		}
	}

	function onInput(e: Event) {
		const text = (e.target as HTMLInputElement).value;
		value = text;
		selectedMatch = null;
		open = true;
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => runSearch(text), 200);
	}

	function onFocus() {
		open = true;
		if (suggestions.length === 0) runSearch(value);
	}

	function pick(entry: ColorCatalogEntry) {
		value = entry.nama_warna;
		selectedMatch = entry;
		open = false;
		suggestions = [];
	}

	function onBlur() {
		// Delay agar klik pada item dropdown (yang juga memicu blur) tetap terdaftar.
		setTimeout(() => (open = false), 150);
	}
</script>

<div class="relative">
	<div class="relative">
		{#if selectedMatch}
			<span
				class="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 rounded border border-gray-300 shrink-0"
				style={selectedMatch.hex_color ? `background-color:${selectedMatch.hex_color}` : ''}
				class:bg-gray-100={!selectedMatch.hex_color}
				title={selectedMatch.hex_color ? selectedMatch.nama_warna : 'Belum ada acuan visual (hex kosong)'}
			></span>
		{:else}
			<IconSearch size={14} class="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-300" />
		{/if}
		<input
			bind:this={inputEl}
			{id}
			type="text"
			class="f-input !pl-8"
			{placeholder}
			{value}
			oninput={onInput}
			onfocus={onFocus}
			onblur={onBlur}
			autocomplete="off"
		/>
		<IconChevronDown size={14} class="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-300 pointer-events-none" />
	</div>

	{#if open}
		<div class="absolute z-30 left-0 right-0 top-[calc(100%+4px)] bg-white border border-gray-200 rounded-xl shadow-xl overflow-hidden max-h-56 overflow-y-auto">
			<div class="px-2.5 py-1.5 bg-gray-50 text-[10px] font-bold text-gray-500 uppercase tracking-wider sticky top-0">
				Katalog Warna Standar
			</div>
			{#if loading}
				<div class="px-3 py-3 text-[11px] text-gray-400">Mencari...</div>
			{:else if suggestions.length === 0}
				<div class="px-3 py-3 text-[11px] text-gray-400">
					Tidak ada di katalog — teks yang diketik akan dipakai langsung sebagai warna custom.
				</div>
			{:else}
				<div class="divide-y divide-gray-100">
					{#each suggestions as s (s.id)}
						<button
							type="button"
							class="w-full text-left px-3 py-2 hover:bg-[var(--gl)]/30 transition-colors flex items-center gap-2.5 cursor-pointer border-none bg-transparent"
							onclick={() => pick(s)}
						>
							<span
								class="w-5 h-5 rounded border border-gray-300 shrink-0 flex items-center justify-center text-[9px] text-gray-400 font-bold"
								style={s.hex_color ? `background-color:${s.hex_color}` : ''}
								class:bg-gray-50={!s.hex_color}
							>
								{#if !s.hex_color}?{/if}
							</span>
							<span class="flex-1 min-w-0">
								<span class="text-[12px] font-medium text-gray-800">{s.nama_warna}</span>
								{#if !s.hex_color}
									<span class="ml-1.5 text-[9px] text-amber-600 font-medium">belum ada acuan visual</span>
								{/if}
							</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
