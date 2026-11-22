<script lang="ts">
	// Dropdown ringkas "📘 Panduan" di cockpit proyek: SOP terbit + gate penjaga untuk tab yang sedang dibuka.
	// Konfigurasi diatur Superadmin di dashboard admin (popup "?" tab /project → ⚙ Atur). Dimuat malas saat dibuka; hasil
	// di-cache di memori per tab (2 menit) agar buka-tutup berulang tidak memanggil API.
	let { tab }: { tab: string } = $props();

	type Ctx = {
		catatan: string;
		sops: { code: string; flow_key: string; title: string }[];
		gates: { key: string; nama: string; hint: string; mode: string | null }[];
	};
	const TTL = 2 * 60 * 1000;
	const cache = new Map<string, { at: number; ctx: Ctx }>();

	let open = $state(false);
	let loading = $state(false);
	let error = $state('');
	let ctx = $state<Ctx | null>(null);
	let loadedTab = $state('');

	async function load() {
		const hit = cache.get(tab);
		if (hit && Date.now() - hit.at < TTL) { ctx = hit.ctx; loadedTab = tab; return; }
		loading = true; error = '';
		try {
			const res = await fetch(`/api/sop-context?tab=${encodeURIComponent(tab)}`);
			const body = await res.json().catch(() => null);
			if (!res.ok || !body?.success) throw new Error(body?.error || `HTTP ${res.status}`);
			ctx = { catatan: body.catatan || '', sops: body.sops || [], gates: body.gates || [] };
			cache.set(tab, { at: Date.now(), ctx });
			loadedTab = tab;
		} catch (e: any) {
			ctx = null; error = e?.message || 'Gagal memuat panduan';
		} finally {
			loading = false;
		}
	}

	function toggle() {
		open = !open;
		if (open && loadedTab !== tab) load();
	}

	// Ganti tab saat popup terbuka → muat ulang untuk tab baru.
	$effect(() => {
		if (open && tab && loadedTab !== tab && !loading) load();
	});

	const modeLabel: Record<string, string> = { hard: 'Wajib', soft: 'Ditahan', warn: 'Peringatan', shadow: 'Dipantau' };
</script>

<svelte:window onclick={() => (open = false)} />

<span class="relative inline-block">
	<button
		type="button"
		class="breadcrumb-copy flex items-center gap-1.5"
		onclick={(e) => { e.stopPropagation(); toggle(); }}
		aria-haspopup="true"
		aria-expanded={open}
		title="SOP dan aturan (gate) untuk bagian ini"
	>
		<span>📘 Panduan</span>
	</button>

	{#if open}
		<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
		<div
			class="absolute right-0 top-full mt-1.5 z-50 w-[min(20rem,calc(100vw-1.5rem))] max-h-[60vh] overflow-y-auto rounded-xl border border-gray-200 bg-white p-3 text-left shadow-xl space-y-3"
			onclick={(e) => e.stopPropagation()}
		>
			{#if loading}
				<p class="text-xs text-gray-400">Memuat panduan…</p>
			{:else if error}
				<p class="text-xs text-red-600">{error} <button type="button" class="underline" onclick={() => load()}>Coba lagi</button></p>
			{:else if ctx}
				{#if ctx.catatan}<p class="text-xs italic text-gray-600">{ctx.catatan}</p>{/if}

				<div>
					<p class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">SOP untuk bagian ini</p>
					{#if ctx.sops.length}
						<ul class="space-y-1.5">
							{#each ctx.sops as s (s.code)}
								<li class="text-xs">
									<a class="text-blue-700 hover:underline" href={`/panduan/alur?alur=${encodeURIComponent(s.flow_key)}`}>
										<span class="font-mono font-bold">{s.code}</span> — {s.title}
									</a>
								</li>
							{/each}
						</ul>
						<p class="mt-1 text-[10px] text-gray-400">Buka SOP lalu tekan “Saya sudah paham” agar tercatat sudah dibaca.</p>
					{:else}
						<p class="text-xs text-gray-400">Belum ada SOP terbit untuk bagian ini.</p>
					{/if}
				</div>

				<div>
					<p class="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">Aturan yang dicek sistem</p>
					{#if ctx.gates.length}
						<ul class="space-y-1.5">
							{#each ctx.gates as g (g.key)}
								<li class="text-xs">
									<div class="flex items-start gap-1.5">
										{#if g.mode}<span class="shrink-0 rounded bg-slate-100 px-1 text-[10px] font-semibold text-slate-600">{modeLabel[g.mode] ?? g.mode}</span>{/if}
										<span class="text-gray-800">{g.nama}</span>
									</div>
									{#if g.hint}<p class="ml-0.5 mt-0.5 text-[11px] text-gray-500">{g.hint}</p>{/if}
								</li>
							{/each}
						</ul>
					{:else}
						<p class="text-xs text-gray-400">Tidak ada aturan khusus di bagian ini.</p>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</span>
