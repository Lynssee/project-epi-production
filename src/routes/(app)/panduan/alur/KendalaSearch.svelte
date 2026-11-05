<!-- src/routes/(app)/panduan/alur/KendalaSearch.svelte -->
<!-- "🔎 Cari kendala / pesan gate": ketik kata kunci kendala (mis. "kurva s", "kredit hold", "foto ba", kode gate) → langsung loncat ke langkah SOP
     beserta solusinya. Hemat kuota: server mencari di alur yang sudah ber-cache dan hanya membalas ≤12 hasil kecil; baru mencari setelah
     jeda mengetik ±0,4 detik dan minimal 2 huruf. -->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { searchKendala, type KendalaHit } from './fieldGateApi';

	let { onjump }: { onjump: (flowId: string, nodeId: string) => void } = $props();

	const DEBOUNCE_MS = 400;
	const KIND: Record<KendalaHit['kind'], { label: string; cls: string }> = {
		kendala: { label: '⚠️ Kendala', cls: 'bg-amber-100 text-amber-800 border-amber-300' },
		gate: { label: '🛡️ Gate', cls: 'bg-purple-100 text-purple-800 border-purple-300' },
		syarat: { label: '✅ Syarat', cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
		langkah: { label: '📌 Langkah', cls: 'bg-gray-100 text-gray-700 border-gray-300' }
	};

	let q = $state('');
	let hits = $state<KendalaHit[]>([]);
	let loading = $state(false);
	let error = $state('');
	let searched = $state('');
	let timer: ReturnType<typeof setTimeout> | null = null;
	let ctrl: AbortController | null = null;

	function onInput() {
		if (timer) clearTimeout(timer);
		ctrl?.abort();
		const term = q.trim();
		if (term.length < 2) {
			hits = [];
			error = '';
			loading = false;
			searched = '';
			return;
		}
		loading = true;
		timer = setTimeout(() => void cari(term), DEBOUNCE_MS);
	}

	async function cari(term: string) {
		ctrl = new AbortController();
		const mine = ctrl;
		const r = await searchKendala(term, {}, mine.signal);
		if (mine.signal.aborted) return; // diganti ketikan baru
		hits = r.hits;
		error = r.error ?? '';
		searched = term;
		loading = false;
	}

	function pilih(h: KendalaHit) {
		onjump(h.flow_id, h.node_id);
		q = '';
		hits = [];
		searched = '';
	}

	onDestroy(() => {
		if (timer) clearTimeout(timer);
		ctrl?.abort();
	});
</script>

<section class="bg-white border border-gray-200 rounded-2xl p-3.5 space-y-2 shadow-xs" data-testid="kendala-search">
	<label class="block text-sm font-bold text-gray-800" for="kendala-q">🔎 Cari kendala / pesan gate</label>
	<input
		id="kendala-q"
		type="search"
		bind:value={q}
		oninput={onInput}
		placeholder='Ketik kendala Anda, mis. "kurva s", "kredit hold", "foto ba"'
		class="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white"
		autocomplete="off"
		enterkeyhint="search"
	/>
	<p class="text-[10px] text-gray-400">Tulis kata kunci masalah atau kode gate (minimal 2 huruf). Hasil menunjuk langsung ke langkah SOP dan cara mengatasinya.</p>

	{#if loading}
		<p class="text-[11px] text-gray-400" role="status">Mencari…</p>
	{:else if error}
		<p class="text-[11px] text-amber-700" role="alert" data-testid="kendala-error">{error}</p>
	{:else if searched && hits.length === 0}
		<p class="text-[11px] text-gray-500" role="status" data-testid="kendala-empty">Tidak ada yang cocok dengan "{searched}". Coba kata yang lebih umum.</p>
	{:else if hits.length}
		<ul class="space-y-1.5" aria-label="Hasil pencarian kendala">
			{#each hits as h (h.flow_id + ':' + h.node_id)}
				<li>
					<button type="button" class="w-full text-left px-2.5 py-2 rounded-lg border border-gray-200 bg-gray-50 active:scale-[0.99]" data-testid="kendala-hit" onclick={() => pilih(h)}>
						<span class="flex items-center gap-1.5">
							<span class="text-[10px] font-bold px-1.5 py-0.5 rounded border {KIND[h.kind].cls}">{KIND[h.kind].label}</span>
							<span class="text-xs font-semibold text-gray-800">{h.node_label}</span>
						</span>
						<span class="block text-[11px] text-gray-600 mt-0.5">{h.snippet}</span>
						<span class="block text-[10px] text-gray-400 mt-0.5">di alur: {h.flow_title}</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>
