<!--
  Kartu Pengetahuan Inventory 360° untuk LAPANGAN (mobile-first).
    <KnowledgeCard itemId={…} context="purchase" />          → tombol ⓘ + lembar bawah (bottom sheet) di HP
    <KnowledgeCard itemId={…} context="usage" inline />      → isi kartu langsung di halaman (mis. hasil scan QR)
  context: purchase | receive | usage | maintenance | sales — menentukan bagian yang tampil (diatur superadmin per kategori).
  Titik warna: hijau = profil terverifikasi · kuning = belum terverifikasi · abu = belum ada profil · merah = barang KRITIS tanpa profil terverifikasi.
  Lapangan hanya MEMBACA. Mengisi/memverifikasi profil dilakukan admin di Inventory 360° (dashboard internal).
  Tidak ada rupiah di kartu lapangan.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { IconInfoCircle, IconX } from '@tabler/icons-svelte';
	import { getKnowledgeCard, isCardContextEnabled, trackCardOpen, type KnowledgeCardData } from '$lib/services/inventoryCardApi';
	import {
		buildCardBlocks,
		buildCardWarnings,
		cardIndicator,
		cardStatus,
		isCardKritis
	} from '$lib/services/inventory360/inventoryKnowledgeView.js';

	let {
		itemId,
		context = 'purchase',
		inline = false,
		label = ''
	}: { itemId: number | string | null | undefined; context?: string; inline?: boolean; label?: string } = $props();

	const STATUS_LABEL: Record<string, string> = {
		belum: 'Belum ada profil',
		draft: 'Draft',
		review: 'Menunggu verifikasi',
		verified: 'Terverifikasi',
		stale: 'Perlu ditinjau ulang'
	};
	const DOT: Record<string, string> = { verified: 'bg-emerald-500', unverified: 'bg-amber-400', none: 'bg-slate-300', danger: 'bg-red-500' };
	const WARN: Record<string, string> = {
		danger: 'border-red-300 bg-red-50 text-red-800',
		warn: 'border-amber-300 bg-amber-50 text-amber-900',
		info: 'border-slate-200 bg-slate-50 text-slate-700'
	};

	let enabled = $state(true);
	let card = $state<KnowledgeCardData | null>(null);
	let loaded = $state(false);
	let error = $state('');
	let open = $state(false);

	const indicator = $derived(card ? cardIndicator(card) : 'none');
	const status = $derived(card ? cardStatus(card) : 'belum');
	const kritis = $derived(card ? isCardKritis(card) : false);
	const blocks = $derived(card ? buildCardBlocks(card, context) : []);
	const warnings = $derived(card ? buildCardWarnings(card, context) : []);

	async function load(id: number | string | null | undefined) {
		error = '';
		loaded = false;
		card = null;
		try {
			enabled = await isCardContextEnabled(context);
			if (!enabled) return;
			card = await getKnowledgeCard(id);
		} catch (e: any) {
			console.error('[KnowledgeCard] gagal memuat kartu barang', id, e);
			error = e?.message || 'Gagal memuat.';
		} finally {
			loaded = true;
		}
	}

	// Muat saat dipasang & saat barang berganti pada komponen yang sama (baris dipilih ulang).
	let lastId: unknown = Symbol('belum');
	$effect(() => {
		const id = itemId;
		if (id === lastId) return;
		lastId = id;
		open = false;
		load(id);
	});

	// Mode inline (mis. hasil scan QR): kartu langsung terbaca → catat sekali per barang.
	let trackedInline: unknown = null;
	$effect(() => {
		if (inline && loaded && card && trackedInline !== itemId) {
			trackedInline = itemId;
			trackCardOpen(itemId, context);
		}
	});

	onMount(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') open = false;
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});
</script>

{#snippet body()}
	{#if !loaded}
		<p class="text-xs text-slate-500">Memuat…</p>
	{:else if error}
		<p class="text-xs text-red-600">Gagal memuat pengetahuan barang: {error}</p>
	{:else if !card}
		<p class="text-xs text-slate-500">Barang tidak ditemukan.</p>
	{:else}
		<div class="mb-2 flex flex-wrap items-center gap-1.5">
			<span class="h-2.5 w-2.5 rounded-full {DOT[indicator]}"></span>
			<span class="text-xs font-bold text-slate-800">{STATUS_LABEL[status]}</span>
			{#if kritis}<span class="rounded bg-red-100 px-1 text-[10px] font-bold text-red-700">KRITIS</span>{/if}
		</div>

		{#each warnings as w}
			<div class="mb-2 rounded-lg border px-2.5 py-1.5 text-xs {WARN[w.level]}">{w.text}</div>
		{/each}

		{#each blocks as b (b.key)}
			<div class="mb-3">
				<div class="mb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">{b.title}</div>
				<div class="space-y-1">
					{#each b.rows as r}
						<div class="text-sm {r.warn ? 'text-amber-800' : 'text-slate-700'}">
							{#if r.label}<span class="font-semibold">{r.label}{r.kritis ? ' ★' : ''}:</span>{/if}
							{#if r.list}
								<ul class="ml-5 list-disc">{#each r.list as li}<li>{li}</li>{/each}</ul>
							{:else if r.text}
								<span class={r.missing ? 'italic text-rose-600' : ''}>{r.text}</span>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{:else}
			{#if card.profile}<p class="text-xs text-slate-500">Profil belum berisi informasi untuk keperluan ini.</p>{/if}
		{/each}

		{#if card.profile?.training_program_id && card.profile.status === 'verified'}
			<a class="mb-2 block rounded-lg border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800" href="/ess/pelatihan/{card.profile.training_program_id}">
				📘 Pelajari (5 menit){card.profile.wajib_training ? ' — WAJIB sebelum meminta barang ini' : ''}
			</a>
		{/if}

		{#if !card.profile}
			<p class="text-xs text-slate-500">Minta admin Inventory melengkapi profil barang ini agar panduannya muncul di sini.</p>
		{/if}
	{/if}
{/snippet}

{#if enabled}
	{#if inline}
		<div class="space-y-1">{@render body()}</div>
	{:else}
		<button
			type="button"
			class="relative inline-flex shrink-0 items-center gap-1 rounded-full border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-semibold text-slate-600 active:bg-slate-100"
			title={loaded ? `Pengetahuan barang: ${STATUS_LABEL[status]}${kritis ? ' · KRITIS' : ''}. Ketuk untuk panduan beli & pakai.` : 'Memuat…'}
			aria-label="Pengetahuan barang"
			aria-expanded={open}
			onclick={(e) => {
				e.stopPropagation();
				open = !open;
				if (open) trackCardOpen(itemId, context);
			}}
		>
			<IconInfoCircle size={14} />
			{#if label}<span>{label}</span>{/if}
			<span class="h-2 w-2 rounded-full {loaded ? DOT[indicator] : 'animate-pulse bg-slate-200'}"></span>
		</button>

		{#if open}
			<!-- Lembar bawah (bottom sheet): nyaman di HP, tidak terpotong container overflow-hidden -->
			<div class="fixed inset-0 z-[9999] flex items-end justify-center bg-black/40" role="presentation" onclick={() => (open = false)}>
				<div
					class="max-h-[80vh] w-full max-w-xl overflow-y-auto rounded-t-2xl bg-white p-4 pb-8 shadow-2xl"
					role="dialog"
					aria-modal="true"
					aria-label="Pengetahuan barang"
					tabindex="-1"
					onclick={(e) => e.stopPropagation()}
					onkeydown={(e) => e.stopPropagation()}
				>
					<div class="mb-2 flex items-center justify-between">
						<h3 class="text-sm font-bold text-slate-800">Pengetahuan Barang</h3>
						<button type="button" class="rounded-full p-1 text-slate-400 hover:bg-slate-100" aria-label="Tutup" onclick={() => (open = false)}><IconX size={18} /></button>
					</div>
					{@render body()}
				</div>
			</div>
		{/if}
	{/if}
{/if}
