<!-- src/routes/(app)/ruangan/+page.svelte -->
<!--
	Daftar semua ruangan (Barang per Ruangan via QR Patroli, Fase 2) untuk yang
	tidak sedang berada di lokasi / tidak scan QR. Plus:
	- tombol Scan QR Ruangan (resolver + routeCheckpointScan yang sama)
	- pencarian nama ruangan
	- B1: "cari barang ada di ruangan mana"
-->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fetchDaftarRuangan, cariBarang, type RuanganRingkas, type CariBarangHit } from '$lib/services/gaRuangan';
	import { resolveCheckpoint } from '$lib/services/gaChecklist';
	import { routeCheckpointScan } from '$lib/utils/checkpointScanRoute';
	import { IconLoader2, IconAlertTriangle, IconQrcode, IconSearch, IconChevronRight, IconPackage } from '@tabler/icons-svelte';

	let status = $state<'loading' | 'error' | 'ok'>('loading');
	let errorMsg = $state('');
	let rooms = $state<RuanganRingkas[]>([]);

	let q = $state('');
	let scanOpen = $state(false);
	let scanError = $state('');

	let QrScannerModal = $state<any>(null);
	async function openScanner() {
		QrScannerModal ??= (await import('$lib/components/scanner/QrScannerModal.svelte')).default;
		scanError = '';
		scanOpen = true;
	}
	async function onScanDetect(code: string) {
		scanOpen = false;
		try {
			const result = await resolveCheckpoint(code);
			const { url } = routeCheckpointScan(result, { scanRouteMode: result.scan_route_mode });
			await goto(url);
		} catch (err) {
			scanError = err instanceof Error ? err.message : 'QR tidak dikenali.';
		}
	}

	// B1 — cari barang
	let barangQ = $state('');
	let barangHits = $state<CariBarangHit[]>([]);
	let barangSearching = $state(false);
	let barangErr = $state('');
	let barangTimer: ReturnType<typeof setTimeout> | null = null;
	function onBarangInput() {
		if (barangTimer) clearTimeout(barangTimer);
		const term = barangQ.trim();
		if (term.length < 2) {
			barangHits = [];
			barangErr = '';
			return;
		}
		barangTimer = setTimeout(async () => {
			barangSearching = true;
			barangErr = '';
			try {
				const { hasil } = await cariBarang(term);
				barangHits = hasil;
			} catch (err) {
				barangErr = err instanceof Error ? err.message : 'Gagal mencari.';
			}
			barangSearching = false;
		}, 350);
	}

	const filtered = $derived(
		rooms.filter((r) => {
			const t = q.trim().toLowerCase();
			if (!t) return true;
			return (
				r.area_name.toLowerCase().includes(t) ||
				(r.zone_name ?? '').toLowerCase().includes(t) ||
				(r.location_name ?? '').toLowerCase().includes(t)
			);
		})
	);

	const grouped = $derived.by(() => {
		const g = new Map<string, RuanganRingkas[]>();
		for (const r of filtered) {
			const key = `${r.location_name ?? 'Tanpa site'} — ${r.zone_name ?? 'Tanpa zona'}`;
			if (!g.has(key)) g.set(key, []);
			g.get(key)!.push(r);
		}
		return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0]));
	});

	async function load() {
		status = 'loading';
		try {
			const { ruangan } = await fetchDaftarRuangan();
			rooms = ruangan;
			status = 'ok';
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal memuat daftar ruangan.';
			status = 'error';
		}
	}
	onMount(load);
</script>

<svelte:head><title>Barang per Ruangan</title></svelte:head>

<div class="scroll-body">
	<div class="max-w-2xl mx-auto p-4 pb-24">
		<h1 class="text-[16px] font-bold mb-1" style="color: var(--sys-label)">Barang per Ruangan</h1>
		<p class="text-[11px] mb-3" style="color: var(--sys-label4)">
			Pilih ruangan untuk melihat barang yang tercatat di dalamnya, atau scan QR patroli
			yang tertempel di pintu.
		</p>

		<button
			class="w-full rounded-xl py-2.5 mb-3 text-[13px] font-semibold text-white flex items-center justify-center gap-2"
			style="background: var(--g)"
			onclick={openScanner}
		>
			<IconQrcode size={16} /> Scan QR Ruangan
		</button>
		{#if scanError}
			<div class="rounded-lg p-2.5 mb-3 text-[11px]" style="background: var(--rel); color: var(--red)">{scanError}</div>
		{/if}

		<!-- B1: cari barang ada di ruangan mana -->
		<div class="rounded-xl p-3 mb-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
			<label class="flex items-center gap-2 text-[12px]" style="color: var(--sys-label3)">
				<IconPackage size={14} />
				<input
					bind:value={barangQ}
					oninput={onBarangInput}
					placeholder="Cari barang (mis. proyektor) ada di ruangan mana…"
					class="flex-1 bg-transparent outline-none py-1"
					style="color: var(--sys-label)"
				/>
			</label>
			{#if barangSearching}
				<p class="text-[11px] mt-1.5" style="color: var(--sys-label4)">Mencari…</p>
			{:else if barangErr}
				<p class="text-[11px] mt-1.5" style="color: var(--red)">{barangErr}</p>
			{:else if barangQ.trim().length >= 2 && barangHits.length === 0}
				<p class="text-[11px] mt-1.5" style="color: var(--sys-label4)">Tidak ada barang cocok.</p>
			{:else if barangHits.length > 0}
				<div class="mt-2 flex flex-col gap-1">
					{#each barangHits as h (h.area_id + h.nama)}
						<button
							class="text-left rounded-lg px-2.5 py-1.5 text-[12px] flex items-center justify-between gap-2"
							style="background: var(--sys-bg)"
							onclick={() => goto(`/ruangan/${h.area_id}`)}
						>
							<span style="color: var(--sys-label)">{h.nama} <span style="color: var(--sys-label4)">× {h.qty}</span></span>
							<span class="flex items-center gap-1 shrink-0" style="color: var(--sys-label3)">
								{h.area_name} <IconChevronRight size={13} />
							</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>

		<!-- pencarian ruangan -->
		<label class="flex items-center gap-2 rounded-xl px-3 py-2 mb-3 text-[12px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label3)">
			<IconSearch size={14} />
			<input bind:value={q} placeholder="Cari nama ruangan / zona…" class="flex-1 bg-transparent outline-none py-0.5" style="color: var(--sys-label)" />
		</label>

		{#if status === 'loading'}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat denah & daftar ruangan..." />
		</div>
		{:else if status === 'error'}
			<div class="rounded-xl p-6 text-center" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				<IconAlertTriangle size={28} style="color: var(--red); margin: 0 auto 8px" />
				<p class="text-[12px] mb-4" style="color: var(--sys-label3)">{errorMsg}</p>
				<button class="rounded-lg py-2 px-4 text-[13px] font-semibold text-white" style="background: var(--g)" onclick={load}>Coba lagi</button>
			</div>
		{:else}
			{#each grouped as [siteZone, list] (siteZone)}
				<h2 class="text-[11px] font-semibold mt-4 mb-1.5 tracking-wide" style="color: var(--sys-label3)">{siteZone}</h2>
				<div class="rounded-xl overflow-hidden" style="border: 1px solid var(--sys-sep)">
					{#each list as r, i (r.area_id)}
						<button
							class="w-full text-left flex items-center gap-2 px-3 py-2.5 text-[12px]"
							style="background: var(--sys-fill); {i > 0 ? 'border-top: 1px solid var(--sys-sep)' : ''}"
							onclick={() => goto(`/ruangan/${r.area_id}`)}
						>
							<div class="flex-1 min-w-0">
								<div class="font-medium truncate" style="color: var(--sys-label)">{r.area_name}</div>
								<div class="text-[10px]" style="color: var(--sys-label4)">
									{r.jumlah_barang} barang
									{#if !r.punya_qr}· belum ada QR{/if}
									{#if r.perlu_dicek}· perlu dicek{/if}
								</div>
							</div>
							{#if r.perlu_dicek}
								<span class="shrink-0 w-1.5 h-1.5 rounded-full" style="background: #eab308"></span>
							{/if}
							<IconChevronRight size={14} style="color: var(--sys-label4)" />
						</button>
					{/each}
				</div>
			{/each}
			{#if filtered.length === 0}
				<p class="text-[12px] text-center py-8" style="color: var(--sys-label4)">Tidak ada ruangan cocok.</p>
			{/if}
		{/if}
	</div>
</div>

{#if scanOpen && QrScannerModal}
	<QrScannerModal onDetect={onScanDetect} onClose={() => (scanOpen = false)} />
{/if}
