<!-- src/lib/components/PengecualianProyekWidget.svelte
     PRJ-31 — "Pengecualian Hari Ini" versi ringkas untuk Leader/PM di beranda lapangan. Komponen mandiri, non-blocking
     (pola sama DisiplinKesiapanWidget). Sumber: erp-epi /api/project/exceptions?scope=mine (1 panggilan, cache 5 menit).
     Tidak tampil bila tidak ada masalah atau akun tak punya proyek berjalan. Gagal muat = pesan kecil, bukan layar kosong. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fetchMyProjectExceptions, FIELD_CARD_KEYS, type ExceptionCard } from '$lib/services/projectExceptions';

	let loading = $state(true);
	let cards = $state<ExceptionCard[]>([]);
	let errorMsg = $state('');
	let open = $state<Record<string, boolean>>({});

	async function load(force = false) {
		loading = true;
		errorMsg = '';
		try {
			const d = await fetchMyProjectExceptions(force);
			cards = (d?.cards ?? []).filter((c) => FIELD_CARD_KEYS.has(c.key));
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat.';
		} finally {
			loading = false;
		}
	}
	onMount(() => load());

	const total = $derived(cards.reduce((s, c) => s + (c.count ?? 0), 0));
	const sevColor = (s: string) => (s === 'high' ? 'var(--re)' : s === 'medium' ? 'var(--am)' : 'var(--tx3, #888)');
	// Kartu approval berisi id request (bukan proyek) -> tanpa tautan proyek.
	const projectLinked = (c: ExceptionCard) => c.key !== 'approval_menunggu';
</script>

{#if loading}
	<div class="pxw pxw-muted">Memeriksa masalah proyek…</div>
{:else if errorMsg}
	<div class="pxw pxw-muted">
		{errorMsg} <button class="pxw-link" onclick={() => load(true)}>Coba lagi</button>
	</div>
{:else if cards.length > 0}
	<section class="pxw" aria-label="Pengecualian proyek hari ini">
		<header class="pxw-head">
			<strong>⚠️ Perlu tindakan hari ini ({total})</strong>
			<button class="pxw-link" onclick={() => load(true)} title="Muat ulang (data di server di-cache ±5 menit)">Segarkan</button>
		</header>
		<p class="pxw-hint">Ketuk judul untuk melihat proyeknya, lalu ketuk proyek untuk membukanya.</p>
		{#each cards as c (c.key)}
			<div class="pxw-card" style="border-left-color: {sevColor(c.severity)}">
				<button class="pxw-title" onclick={() => (open[c.key] = !open[c.key])} aria-expanded={!!open[c.key]}>
					<span>{c.title}</span><span class="pxw-count">{c.count}</span>
				</button>
				{#if open[c.key]}
					<p class="pxw-hint">{c.hint}</p>
					<ul>
						{#each c.items ?? [] as it (it.id)}
							<li>
								{#if projectLinked(c)}
									<button class="pxw-link" onclick={() => goto(`/proyek/${it.id}`)}>{it.label}</button>
								{:else}
									<span>{it.label}</span>
								{/if}
								<small> — {it.detail}</small>
							</li>
						{/each}
						{#if (c.count ?? 0) > (c.items?.length ?? 0)}<li><small>+{c.count - c.items.length} lainnya</small></li>{/if}
					</ul>
				{/if}
			</div>
		{/each}
	</section>
{/if}

<style>
	.pxw { margin: 0.75rem 0; padding: 0.75rem; border-radius: 12px; background: var(--card, #fff); border: 1px solid var(--bd, #e5e7eb); }
	.pxw-muted { font-size: 0.8rem; color: var(--tx3, #888); border: none; background: transparent; padding: 0.25rem 0; }
	.pxw-head { display: flex; justify-content: space-between; align-items: center; }
	.pxw-hint { font-size: 0.75rem; color: var(--tx3, #888); margin: 0.25rem 0 0.5rem; }
	.pxw-card { border-left: 4px solid; padding: 0.4rem 0.6rem; margin-bottom: 0.4rem; background: var(--bg2, #f9fafb); border-radius: 6px; }
	.pxw-title { display: flex; justify-content: space-between; width: 100%; background: none; border: none; font-weight: 600; text-align: left; padding: 0.15rem 0; cursor: pointer; }
	.pxw-count { background: var(--bd, #e5e7eb); border-radius: 999px; padding: 0 0.5rem; font-size: 0.75rem; }
	.pxw-card ul { margin: 0.25rem 0 0; padding-left: 1.1rem; font-size: 0.8rem; }
	.pxw-link { background: none; border: none; color: var(--g, #2563eb); cursor: pointer; padding: 0; text-decoration: underline; font-size: inherit; }
</style>
