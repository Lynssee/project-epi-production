<!-- src/routes/(app)/panduan/alur/KendalaSearch.svelte -->
<!-- "🔎 Cari kendala / pesan gate": ketik kata kunci kendala (mis. "kurva s", "kredit hold", "foto ba", kode gate) → langsung loncat ke langkah SOP
     beserta solusinya. Hemat kuota: server mencari di alur yang sudah ber-cache dan hanya membalas ≤12 hasil kecil; baru mencari setelah
     jeda mengetik ±0,4 detik dan minimal 2 huruf. -->
<script lang="ts">
	import { onDestroy } from 'svelte';
	import { searchKendala, type KendalaHit } from './fieldGateApi';

	let {
		onjump,
		ontanyaai
	}: {
		onjump: (flowId: string, nodeId: string) => void;
		ontanyaai?: (query: string) => void;
	} = $props();

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
	<div class="flex items-center justify-between">
		<label class="block text-sm font-bold text-gray-800" for="kendala-q">🔎 Cari kendala / pesan gate</label>
		{#if ontanyaai}
			<button
				type="button"
				class="text-[11px] font-semibold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-full px-2.5 py-0.5 flex items-center gap-1 active:scale-95 transition-all"
				onclick={() => ontanyaai(q || '')}
				title="Tanya AI Panduan Lapangan"
			>
				<span>✨</span>
				<span>Tanya AI</span>
			</button>
		{/if}
	</div>

	<input
		id="kendala-q"
		type="search"
		bind:value={q}
		oninput={onInput}
		onkeydown={(e) => {
			if (e.key === 'Enter' && ontanyaai && q.trim().length >= 2) {
				e.preventDefault();
				ontanyaai(q.trim());
			}
		}}
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
		<div class="p-3 rounded-xl bg-amber-50 border border-amber-200 text-center space-y-1.5" data-testid="kendala-empty">
			<p class="text-[11px] text-amber-800">Tidak ada yang cocok dengan kata kunci "{searched}".</p>
			{#if ontanyaai}
				<button
					type="button"
					class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs inline-flex items-center gap-1.5 active:scale-95 transition-all shadow-xs"
					onclick={() => ontanyaai(searched)}
				>
					<span>✨</span>
					<span>Tanyakan Solusi ke AI Panduan</span>
				</button>
			{/if}
		</div>
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
