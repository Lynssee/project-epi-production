<!-- src/routes/(app)/laporan-saya/+page.svelte
     Report Center Fase 6 — "Laporan Saya" (lapangan): daftar laporan yang tersedia untuk lapangan + jumlah unduhan 90 hari.
     Katalog dari report_catalog (app = lapangan|both), diatur Superadmin di admin /settings/report-catalog. -->
<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fetchLaporanSaya, logReportEvent, startReportEventAutoFlush, isOpenableInLapangan, filterLaporanSaya, type LaporanSayaData } from '$lib/services/laporanSayaApi';

	const FAV_KEY = 'laporan_saya_favorites_v1';

	let data = $state<LaporanSayaData | null>(null);
	let loading = $state(true);
	let error = $state('');
	let q = $state('');
	let onlyFav = $state(false);
	let favs = $state<Set<string>>(new Set());

	let stopFlush: (() => void) | null = null;
	onDestroy(() => stopFlush?.());

	onMount(async () => {
		stopFlush = startReportEventAutoFlush(); // kirim ulang event yang tertunda saat sinyal kembali
		try { favs = new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); } catch { /* localStorage bisa tidak tersedia */ }
		try {
			data = await fetchLaporanSaya();
		} catch (e: any) {
			error = `Gagal memuat daftar laporan (${e?.message || 'jaringan'}). Coba lagi nanti.`;
		}
		loading = false;
	});

	function toggleFav(key: string) {
		const next = new Set(favs);
		if (next.has(key)) next.delete(key); else next.add(key);
		favs = next;
		try { localStorage.setItem(FAV_KEY, JSON.stringify([...next])); } catch { /* abaikan */ }
	}

	let list = $derived(filterLaporanSaya(data?.items || [], q, onlyFav, favs));
</script>

<svelte:head><title>Laporan Saya</title></svelte:head>

<div class="mx-auto max-w-3xl space-y-3 p-4">
	<h1 class="text-lg font-bold text-slate-800">Laporan Saya</h1>
	<details class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-900" open>
		<summary class="cursor-pointer font-semibold">Cara memakai</summary>
		<ol class="mt-1 list-decimal space-y-0.5 pl-4">
			<li>Cari laporan lewat kotak pencarian, atau tandai ⭐ agar mudah ditemukan lagi.</li>
			<li>Tekan <b>Buka</b> untuk masuk ke halaman laporan.</li>
			<li>Laporan bertanda <i>Dibuka dari modul</i> dibuat lewat tombol Cetak/Unduh di halaman dokumennya.</li>
			<li>Setiap pembukaan dan unduhan tercatat otomatis. Tanpa sinyal, daftar terakhir tetap tampil dan pencatatan dikirim saat online.</li>
		</ol>
	</details>

	<div class="flex items-center gap-2">
		<input type="search" bind:value={q} placeholder="Cari laporan…" class="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" />
		<label class="flex items-center gap-1 whitespace-nowrap text-xs font-semibold text-slate-600">
			<input type="checkbox" bind:checked={onlyFav} /> ⭐ Favorit
		</label>
	</div>

	{#if data?.offline}
		<p class="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
			Mode offline: menampilkan daftar tersimpan di perangkat{#if data.cachedAt} (diperbarui {new Date(data.cachedAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })}){/if}. Jumlah unduhan mungkin belum terbaru. Pembukaan laporan tetap dicatat dan dikirim saat sinyal kembali.
		</p>
	{/if}

	{#if loading}
		<p class="text-sm text-slate-500">Memuat…</p>
	{:else if error}
		<p class="text-sm text-rose-600">{error}</p>
	{:else if list.length === 0}
		<p class="text-sm text-slate-500">Tidak ada laporan yang cocok.</p>
	{:else}
		<ul class="space-y-2">
			{#each list as r (r.key)}
				<li class="rounded-xl border border-slate-200 bg-white p-3">
					<div class="flex items-start justify-between gap-2">
						<div class="min-w-0">
							<p class="text-sm font-bold text-slate-800">{r.title}</p>
							{#if r.hint}<p class="text-xs text-slate-500">{r.hint}</p>{/if}
							<div class="mt-1 flex flex-wrap gap-1 text-[10px] font-semibold">
								{#if r.department}<span class="rounded bg-slate-100 px-1.5 py-0.5 text-slate-600">{r.department}</span>{/if}
								{#if data?.counts?.[r.key]}<span class="rounded bg-emerald-50 px-1.5 py-0.5 text-emerald-700" title="Unduhan/cetak 90 hari terakhir">diunduh {data.counts[r.key]}×</span>{/if}
							</div>
						</div>
						<button type="button" onclick={() => toggleFav(r.key)} aria-label="Favorit" title={favs.has(r.key) ? 'Hapus dari favorit' : 'Tambah ke favorit'}
							class="text-lg leading-none {favs.has(r.key) ? '' : 'opacity-30'}">⭐</button>
					</div>
					<div class="mt-2">
						{#if isOpenableInLapangan(r)}
							<a href={r.route_template} onclick={() => logReportEvent({ catalog_key: r.key, action: 'view', format: 'html' })}
								class="inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white">Buka</a>
						{:else}
							<span class="text-xs text-slate-500">Dibuka dari modul terkait (tombol Cetak/Unduh pada dokumen).</span>
						{/if}
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</div>
