<!-- src/routes/(app)/ServerProfileView.svelte -->
<!-- Tampilan "Server" di tab Fetch Halaman (khusus Super Admin): profil fetch SERVER LAPANGAN dari
     GET /api/health/pulse?profile=1 (memori proses, tanpa tulis ke Directus): koleksi & halaman terberat,
     efisiensi cache/penggabungan, dan log query lambat dengan saran perbaikan yang bisa disalin.
     Versi ringkas dari panel "Top Bottleneck Fetch" di /settings/system-health erp-epi. -->

<script lang="ts">
	import { onMount } from 'svelte';
	import { auth } from '$lib/firebase';
	import { adviseSlowEntry, slowEntryToText, sortRows, latencyTone } from './serverProfile';

	let { slowMs = 500 }: { slowMs?: number } = $props();

	let profile = $state<any>(null);
	let loading = $state(false);
	let error = $state('');
	let loadedAt = $state<Date | null>(null);
	let sortKey = $state('totalMs');
	let openSlow = $state<number | null>(null);
	let copiedIdx = $state<number | null>(null);

	let collections = $derived(sortRows<any>(profile?.collections, sortKey).slice(0, 8));
	let routes = $derived(sortRows<any>(profile?.routes, sortKey).slice(0, 6));
	let slow = $derived<any[]>((profile?.slow || []).slice(0, 12));

	async function authHeader(): Promise<Record<string, string>> {
		const user = auth.currentUser;
		const token = user ? await user.getIdToken() : null;
		return token ? { Authorization: `Bearer ${token}` } : {};
	}

	async function load() {
		loading = true;
		error = '';
		try {
			const res = await fetch('/api/health/pulse?profile=1', { headers: await authHeader() });
			if (!res.ok) {
				const b = await res.json().catch(() => ({}));
				throw new Error(b?.error || `HTTP ${res.status}`);
			}
			profile = await res.json();
			loadedAt = new Date();
		} catch (e: any) {
			error = e?.message || 'Gagal memuat profil server.';
		} finally {
			loading = false;
		}
	}

	async function resetProfile() {
		if (!confirm('Kosongkan profil fetch server lapangan? Pengukuran dimulai ulang dari nol (data Directus tidak terpengaruh).')) return;
		try {
			const res = await fetch('/api/health/pulse?profile=reset', { method: 'POST', headers: await authHeader() });
			if (!res.ok) throw new Error(`HTTP ${res.status}`);
			await load();
		} catch (e: any) {
			error = 'Gagal mereset: ' + (e?.message || e);
		}
	}

	function copySlow(e: any, i: number) {
		navigator.clipboard.writeText(slowEntryToText(e, { slowMs }));
		copiedIdx = i;
		setTimeout(() => (copiedIdx = null), 2000);
	}

	const sevCls: Record<string, string> = {
		bad: 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300',
		warn: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
		info: 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
	};
	const fmtTime = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-');

	onMount(load);
</script>

<div class="space-y-2.5">
	<div class="flex items-center justify-between gap-1.5">
		<p class="text-[10px] text-slate-400 leading-snug">
			Server lapangan sejak {profile?.since ? new Date(profile.since).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : 'restart terakhir'}
		</p>
		<div class="flex gap-1 shrink-0">
			<button type="button" onclick={load} disabled={loading} class="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-[11px] font-semibold disabled:opacity-50 cursor-pointer" title="Ambil profil terbaru dari server">
				{loading ? '…' : '🔄'}
			</button>
			<button type="button" onclick={resetProfile} class="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-[11px] font-semibold cursor-pointer" title="Mulai ukur dari nol, mis. setelah perbaikan dideploy">🧹</button>
		</div>
	</div>

	{#if error}
		<div class="p-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-[11px] text-rose-700 dark:text-rose-300">{error}</div>
	{:else if !profile}
		<p class="text-[11px] text-slate-400 text-center py-3">Memuat profil server…</p>
	{:else}
		<div class="grid grid-cols-4 gap-1.5 text-center">
			<div class="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-150 dark:border-slate-750" title="Semua request yang lewat proxy Directus lapangan sejak profil dimulai">
				<p class="font-mono font-black text-sm">{profile.totals.calls}</p>
				<p class="text-[9px] text-slate-400 uppercase">Request</p>
			</div>
			<div class="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-150 dark:border-slate-750" title="Persentase pembacaan yang digabung dengan request identik (proxy lapangan tidak punya cache lain)">
				<p class="font-mono font-black text-sm">{profile.totals.cacheHitPct ?? '-'}{profile.totals.cacheHitPct != null ? '%' : ''}</p>
				<p class="text-[9px] text-slate-400 uppercase">Digabung</p>
			</div>
			<div class="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-150 dark:border-slate-750">
				<p class="font-mono font-black text-sm {profile.totals.errors ? 'text-rose-600' : ''}">{profile.totals.errors}</p>
				<p class="text-[9px] text-slate-400 uppercase">Error</p>
			</div>
			<div class="p-1.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-150 dark:border-slate-750">
				<p class="font-mono font-black text-sm {slow.length ? 'text-amber-600' : ''}">{profile.slow?.length ?? 0}</p>
				<p class="text-[9px] text-slate-400 uppercase">Lambat</p>
			</div>
		</div>

		<label class="flex items-center gap-2 text-[10px] text-slate-500">
			<span class="shrink-0">Urutkan:</span>
			<select bind:value={sortKey} class="flex-1 min-w-0 px-1.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[11px]">
				<option value="totalMs">Total waktu</option>
				<option value="avgMs">Rata-rata</option>
				<option value="maxMs">Terlama</option>
				<option value="calls">Jumlah panggilan</option>
			</select>
		</label>

		<div>
			<p class="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Top Koleksi</p>
			<div class="space-y-0.5 max-h-36 overflow-y-auto pr-0.5">
				{#each collections as c (c.name)}
					<div class="flex items-center gap-1.5 text-[10px]" title="{c.calls} panggilan • {c.upstreamCalls} ke Directus • total {c.totalMs} ms • {c.kb} KB">
						<span class="w-24 shrink-0 truncate font-mono font-bold">{c.name}</span>
						<span class="flex-1 text-right font-mono text-slate-400">{c.calls}×</span>
						<span class="w-14 text-right font-mono {latencyTone(c.avgMs, slowMs)}">{c.avgMs ?? '-'}ms</span>
						<span class="w-14 text-right font-mono {latencyTone(c.maxMs, slowMs * 2)}">{c.maxMs}ms</span>
						<span class="w-10 text-right">
							{#if c.unboundedLimit}<span title="limit=-1 ×{c.unboundedLimit}">⚠</span>{/if}{#if c.wildcardFields}<span title="fields=* ×{c.wildcardFields}">⚠</span>{/if}{#if c.errors}<span title="{c.errors} error">❌</span>{/if}
						</span>
					</div>
				{:else}
					<p class="text-[11px] text-slate-400">Belum ada data. Pakai aplikasi sebentar lalu muat ulang.</p>
				{/each}
			</div>
			<p class="mt-0.5 text-[9px] text-slate-400">kolom: koleksi • panggilan • rata-rata • terlama • ⚠ overfetch</p>
		</div>

		<div>
			<p class="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Top Halaman</p>
			<div class="space-y-0.5 max-h-28 overflow-y-auto pr-0.5">
				{#each routes as r (r.name)}
					<div class="flex items-center gap-1.5 text-[10px]" title="{r.name} • {r.calls} panggilan • total {r.totalMs} ms">
						<span class="flex-1 min-w-0 truncate font-mono">{r.name}</span>
						<span class="w-10 text-right font-mono {r.calls >= 30 ? 'text-amber-600 font-bold' : 'text-slate-400'}" title={r.calls >= 30 ? 'Banyak panggilan — kemungkinan N+1 / fetch berulang' : ''}>{r.calls}×</span>
						<span class="w-14 text-right font-mono {latencyTone(r.avgMs, slowMs)}">{r.avgMs ?? '-'}ms</span>
					</div>
				{/each}
			</div>
		</div>

		<div>
			<p class="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">Query Lambat Terakhir</p>
			{#if slow.length === 0}
				<p class="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-800 dark:text-emerald-300">🟢 Tidak ada query ≥ {profile.config?.slowMs ?? slowMs} ms tercatat.</p>
			{:else}
				<ul class="space-y-1 max-h-48 overflow-y-auto pr-0.5">
					{#each slow as e, i}
						{@const adv = adviseSlowEntry(e, { slowMs })}
						<li class="rounded-lg border border-slate-200/80 dark:border-slate-700/80 overflow-hidden">
							<button type="button" onclick={() => (openSlow = openSlow === i ? null : i)} class="w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-[10px] hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer">
								<span class="px-1 py-0.5 rounded font-bold {sevCls[adv.severity]}">{e.durMs}ms</span>
								<span class="font-mono font-bold shrink-0">{e.method} {e.collection}</span>
								<span class="text-slate-400 truncate flex-1">{e.route}</span>
								<span class="text-slate-400 font-mono shrink-0">{fmtTime(e.at)}</span>
							</button>
							{#if openSlow === i}
								<div class="px-2 pb-2 pt-1 bg-slate-50/70 dark:bg-slate-800/40 text-[10px] space-y-1.5">
									<ol class="list-decimal pl-4 space-y-0.5 text-slate-700 dark:text-slate-200">
										{#each adv.steps as s}<li>{s}</li>{/each}
									</ol>
									<button type="button" onclick={() => copySlow(e, i)} class="px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer">
										{copiedIdx === i ? '✅ Disalin' : '📋 Salin untuk developer'}
									</button>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<p class="text-[9px] text-slate-400">Dimuat {loadedAt ? loadedAt.toLocaleTimeString('id-ID') : '-'}. Hanya server lapangan; per proses server; hilang saat restart. Server Admin dilihat di ERP → Kesehatan Sistem.</p>
	{/if}
</div>
