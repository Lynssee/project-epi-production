<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { getBudaya, videoEmbedUrl, type BudayaData } from '$lib/services/ess/budaya';
	import { IconAlertTriangle, IconChevronDown } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let data = $state<BudayaData | null>(null);
	let openId = $state<number | null>(null);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			data = await getBudaya();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat budaya perusahaan.';
		} finally {
			loading = false;
		}
	}
	onMount(load);

	const isEmpty = $derived(
		!!data && !data.motto && !data.visi && data.misi.length === 0 && !data.manifesto_budaya && data.nilai.length === 0
	);
	const embed = $derived(data ? videoEmbedUrl(data.video_budaya_url) : null);
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<div class="mb-6">
		<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Budaya EPI</h1>
		<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">Visi, misi & nilai yang kita pegang bersama</p>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat budaya perusahaan..." />
		</div>
	{:else if errorMsg}
		<div class="glass-panel rounded-2xl p-8 text-center max-w-md mx-auto mt-10">
			<div class="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
				<IconAlertTriangle size={32} style="color: #DC2626" />
			</div>
			<p class="text-sm mb-4" style="color: var(--sys-label2)">{errorMsg}</p>
			<button class="px-4 py-2 rounded-xl text-sm font-bold text-white" style="background: var(--color-primary)" onclick={load}>Coba lagi</button>
		</div>
	{:else if data}
		{#if isEmpty}
			<div class="glass-panel rounded-2xl p-8 text-center max-w-md mx-auto mt-10">
				<p class="text-sm" style="color: var(--sys-label2)">Visi, misi, dan nilai inti perusahaan belum diisi oleh Manajemen.</p>
			</div>
		{:else}
			<div class="space-y-4 max-w-3xl">
				{#if data.motto}
					<div class="rounded-3xl p-6 text-center text-white shadow-lg" style="background: linear-gradient(135deg, #4f46e5, #0284c7)">
						<p class="text-[11px] uppercase tracking-widest opacity-80">Motto Kita</p>
						<p class="text-2xl font-extrabold mt-1 leading-snug">“{data.motto}”</p>
					</div>
				{/if}

				{#if data.visi}
					<section class="glass-panel rounded-2xl p-4">
						<h2 class="text-xs font-bold uppercase tracking-wider mb-1" style="color: #4f46e5">Visi</h2>
						<p class="text-sm whitespace-pre-wrap" style="color: var(--sys-label)">{data.visi}</p>
					</section>
				{/if}

				{#if data.misi.length}
					<section class="glass-panel rounded-2xl p-4">
						<h2 class="text-xs font-bold uppercase tracking-wider mb-1" style="color: #4f46e5">Misi</h2>
						<ol class="list-decimal pl-5 space-y-1 text-sm" style="color: var(--sys-label)">
							{#each data.misi as m}<li>{m}</li>{/each}
						</ol>
					</section>
				{/if}

				{#if data.nilai.length}
					<section>
						<h2 class="text-xs font-bold uppercase tracking-wider mb-2" style="color: var(--sys-label3)">Nilai Inti</h2>
						<div class="space-y-2">
							{#each data.nilai as n (n.id)}
								{@const hasDetail = n.perilaku.do.length > 0 || n.perilaku.dont.length > 0}
								<div class="glass-panel rounded-2xl overflow-hidden">
									<button class="w-full text-left p-4 flex items-start gap-3" onclick={() => (openId = openId === n.id ? null : n.id)}>
										<span class="w-11 h-11 shrink-0 rounded-xl flex items-center justify-center text-xl font-extrabold text-white" style="background:{n.warna || '#64748b'}">{n.ikon || n.kode || '★'}</span>
										<span class="min-w-0 flex-1">
											<span class="block text-base font-bold" style="color: var(--sys-label)">{n.judul}</span>
											<span class="block text-sm" style="color: var(--sys-label2)">{n.arti_singkat}</span>
										</span>
										{#if hasDetail}
											<IconChevronDown size={18} style="color: var(--sys-label3); transform: rotate({openId === n.id ? 180 : 0}deg)" />
										{/if}
									</button>
									{#if openId === n.id && hasDetail}
										<div class="px-4 pb-4 grid gap-3 text-sm">
											{#if n.perilaku.do.length}
												<div>
													<p class="font-bold text-emerald-600 mb-1">✅ Lakukan</p>
													<ul class="list-disc pl-5 space-y-0.5" style="color: var(--sys-label)">{#each n.perilaku.do as d}<li>{d}</li>{/each}</ul>
												</div>
											{/if}
											{#if n.perilaku.dont.length}
												<div>
													<p class="font-bold text-rose-600 mb-1">⛔ Hindari</p>
													<ul class="list-disc pl-5 space-y-0.5" style="color: var(--sys-label)">{#each n.perilaku.dont as d}<li>{d}</li>{/each}</ul>
												</div>
											{/if}
										</div>
									{/if}
								</div>
							{/each}
						</div>
					</section>
				{/if}

				{#if data.manifesto_budaya}
					<section class="rounded-2xl p-4 border" style="background: rgba(245,158,11,0.10); border-color: rgba(245,158,11,0.35)">
						<h2 class="text-xs font-bold uppercase tracking-wider mb-1" style="color: #b45309">Pesan Direktur</h2>
						<p class="text-sm whitespace-pre-wrap" style="color: var(--sys-label)">{data.manifesto_budaya}</p>
					</section>
				{/if}

				{#if embed}
					<div class="aspect-video rounded-2xl overflow-hidden bg-black">
						<iframe class="w-full h-full" src={embed} title="Video budaya EPI" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
					</div>
				{:else if data.video_budaya_url}
					<a href={data.video_budaya_url} target="_blank" rel="noopener noreferrer" class="inline-block px-4 py-2 rounded-xl text-sm font-bold border" style="color: var(--sys-label)">▶ Tonton video budaya</a>
				{/if}

				{#if data.errors.identity || data.errors.nilai}
					<p class="text-xs" style="color: #d97706">Sebagian data budaya belum bisa dimuat. Hubungi HRD/IT bila berlanjut.</p>
				{/if}
			</div>
		{/if}
	{/if}
</div>
