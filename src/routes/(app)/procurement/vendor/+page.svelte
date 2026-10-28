<!-- src/routes/(app)/procurement/vendor/+page.svelte -->
<!--
  Direktori Vendor Terdekat — Vendor Wajib Terdaftar, Fase 7 (lapangan B1).
  Cari vendor terdaftar per kota / bidang usaha sebelum belanja di toko tak terdaftar.
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { getIdToken } from '$lib/services/secureDirectus';
	import { IconArrowLeft, IconBuildingStore, IconMapPin, IconPhone, IconPlus } from '@tabler/icons-svelte';
	import { SectionGuide, FieldHint } from '$lib/components/hints';
	import { procurementLapanganHints } from '$lib/data/hints/procurementLapangan';
	import { getHint } from '$lib/data/hints/getHint';

	const h = (key: string) => getHint(procurementLapanganHints, key, 'procurementLapangan');

	let q = $state('');
	let kota = $state('');
	let bidang = $state('');
	let loading = $state(false);
	let rows = $state<any[]>([]);
	let searched = $state(false);
	let timer: ReturnType<typeof setTimeout> | undefined;

	function debouncedSearch() {
		if (timer) clearTimeout(timer);
		timer = setTimeout(search, 350);
	}

	async function search() {
		loading = true;
		searched = true;
		try {
			const token = await getIdToken();
			const p = new URLSearchParams();
			if (q.trim()) p.set('q', q.trim());
			if (kota.trim()) p.set('kota', kota.trim());
			if (bidang.trim()) p.set('bidang', bidang.trim());
			const res = await fetch(`/api/procurement/vendor-directory?${p.toString()}`, {
				headers: { Authorization: `Bearer ${token}` }
			});
			const j = await res.json();
			rows = j.data || [];
		} catch {
			rows = [];
		} finally {
			loading = false;
		}
	}
</script>

<div class="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
	<div class="glass-panel border-b border-white/40 sticky top-0 z-30 shadow-sm">
		<div class="px-4 sm:px-6 py-4 flex items-center gap-3">
			<button onclick={() => goto('/procurement')} class="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-black/5 shrink-0">
				<IconArrowLeft size={20} />
			</button>
			<div class="w-10 h-10 rounded-2xl bg-teal-500 flex items-center justify-center shadow-lg shadow-teal-500/20 text-white shrink-0">
				<IconBuildingStore size={20} />
			</div>
			<div class="flex-1 min-w-0">
				<h1 class="text-lg font-black text-slate-900 tracking-tight">Direktori Vendor Terdaftar</h1>
				<p class="text-xs font-medium" style="color: var(--sys-label3)">Cari toko/vendor resmi sebelum belanja lokal</p>
			</div>
			<button onclick={() => goto('/procurement/vendor/usul')} class="shrink-0 flex items-center gap-1 px-3 py-2 text-xs font-semibold bg-teal-600 text-white rounded-xl hover:bg-teal-700">
				<IconPlus size={14} /> Usul Vendor
			</button>
		</div>
	</div>

	<div class="flex-1 overflow-y-auto px-4 sm:px-6 py-6 pb-24">
		<div class="max-w-lg mx-auto w-full space-y-4">
			<SectionGuide
				id="procurementLapangan.vendorDirektori.page"
				title={h('vendorDirektori.page').sectionGuide?.title}
				steps={h('vendorDirektori.page').sectionGuide?.steps ?? []}
			/>

			<div class="glass-panel rounded-2xl p-4 space-y-3">
				<input bind:value={q} oninput={debouncedSearch} placeholder="Nama toko / kategori" class="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-400" />
				<div class="grid grid-cols-2 gap-2">
					<input bind:value={kota} oninput={debouncedSearch} placeholder="Kota" class="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-400" />
					<input bind:value={bidang} oninput={debouncedSearch} placeholder="Bidang (mis. besi, cat)" class="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-400" />
				</div>
				<FieldHint text={h('vendorDirektori.filter').fieldHint} />
			</div>

			{#if loading}
				<p class="text-center text-slate-400 text-sm py-6">Mencari…</p>
			{:else if searched && rows.length === 0}
				<div class="glass-panel rounded-2xl p-5 text-center space-y-2">
					<p class="text-sm text-slate-600">Tidak ada vendor terdaftar yang cocok.</p>
					<button onclick={() => goto('/procurement/vendor/usul')} class="text-xs font-semibold text-teal-700 underline">Usulkan vendor baru →</button>
				</div>
			{:else}
				{#each rows as v (v.id)}
					<div class="glass-panel rounded-2xl p-4">
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0">
								<div class="font-bold text-slate-900 truncate">{v.nama}</div>
								<div class="text-xs text-slate-500 flex items-center gap-3 mt-0.5 flex-wrap">
									{#if v.kota}<span class="flex items-center gap-1"><IconMapPin size={12} />{v.kota}</span>{/if}
									{#if v.telp}<a href={`tel:${v.telp}`} class="flex items-center gap-1 text-teal-600"><IconPhone size={12} />{v.telp}</a>{/if}
								</div>
								{#if v.bidang_usaha?.length}
									<div class="flex flex-wrap gap-1 mt-1.5">
										{#each v.bidang_usaha.slice(0, 5) as tag}<span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px]">{tag}</span>{/each}
									</div>
								{/if}
							</div>
							{#if v.identitas_lengkap === true}
								<span class="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700">✅ resmi</span>
							{:else if v.identitas_lengkap === false}
								<span class="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">identitas belum lengkap</span>
							{/if}
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>
