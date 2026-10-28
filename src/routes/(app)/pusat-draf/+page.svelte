<!-- src/routes/(app)/pusat-draf/+page.svelte -->
<!-- Pusat Draf Tersimpan (Fase 4, rencana Draf Otomatis Universal & Anti-White-Screen v2).
     Kembaran erp-epi/src/routes/pusat-draf/+page.svelte — lihat file itu untuk konteks
     lengkap. Sisi lapangan: krusial karena rollout Lapis 1 di Kiosk tidak punya banner
     per halaman (terlalu mengganggu di layar sentuh), jadi ini satu-satunya tempat
     operator bisa menemukan draf lama. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { get } from 'svelte/store';
	import { listAllScopes, readEnvelope, removeEnvelope } from '$lib/utils/draftStorage';

	interface ScopeEntry {
		storageKey: string;
		savedAt: number;
		sizeBytes: number;
		label: string;
		route: string | null;
		layer: string;
	}

	let scopes = $state<ScopeEntry[]>([]);
	let loading = $state(true);

	function currentUserId(): string {
		return get(authStore).user?.uid || 'anon';
	}

	function describeScope(storageKey: string): { label: string; route: string | null; layer: string } {
		const parts = storageKey.split(':');
		if (parts[1] === 'autoDraft') {
			const scopeId = parts[parts.length - 2];
			const route = parts.slice(2, -2).join(':');
			return { label: `${route || '(halaman tidak diketahui)'} — ${scopeId}`, route, layer: 'Lapis 1 (otomatis)' };
		}
		const key = parts.slice(1, -1).join(':');
		return { label: key || storageKey, route: null, layer: 'Lapis 2 (form terdaftar)' };
	}

	function formatAge(savedAt: number): string {
		if (!savedAt) return '-';
		const diffMin = Math.round((Date.now() - savedAt) / 60000);
		const jam = new Date(savedAt).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
		if (diffMin < 60) return `${diffMin} menit lalu (${jam})`;
		const diffJam = Math.round(diffMin / 60);
		if (diffJam < 24) return `${diffJam} jam lalu (${jam})`;
		return `${Math.round(diffJam / 24)} hari lalu (${jam})`;
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		return `${(bytes / 1024).toFixed(1)} KB`;
	}

	function refresh() {
		const uid = currentUserId();
		scopes = listAllScopes()
			.filter((e) => e.storageKey.endsWith(`:${uid}`))
			.map((e) => ({ ...e, ...describeScope(e.storageKey) }))
			.sort((a, b) => b.savedAt - a.savedAt);
		loading = false;
	}

	$effect(() => {
		refresh();
	});

	function bukaHalaman(scope: ScopeEntry) {
		if (scope.route) goto(scope.route);
	}

	function hapusDraf(scope: ScopeEntry) {
		if (!confirm(`Hapus draf "${scope.label}"? Isian yang belum terkirim akan hilang permanen.`)) return;
		removeEnvelope(scope.storageKey);
		refresh();
	}

	function eksporJson(scope: ScopeEntry) {
		const data = readEnvelope(scope.storageKey);
		if (!data) return;
		const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `draf-${scope.label}.json`.replace(/[^\w.-]/g, '_');
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<svelte:head>
	<title>Pusat Draf Tersimpan | EPI Lapangan</title>
</svelte:head>

<div class="p-4 max-w-2xl mx-auto pb-24">
	<div class="mb-5">
		<h1 class="text-lg font-semibold text-gray-800">Pusat Draf Tersimpan</h1>
		<p class="text-xs text-gray-500 mt-1 leading-relaxed">
			Daftar isian form yang tersimpan otomatis di <strong>perangkat ini</strong>. Data ini
			murni lokal, tidak pernah dikirim ke server kecuali Anda sendiri yang submit formnya.
		</p>
	</div>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat draf offline tersimpan..." />
		</div>
	{:else if scopes.length === 0}
		<div class="text-center py-12 border border-dashed border-gray-200 rounded-xl">
			<p class="text-sm text-gray-500">Tidak ada draf tersimpan saat ini.</p>
		</div>
	{:else}
		<div class="space-y-2">
			{#each scopes as scope (scope.storageKey)}
				<div class="p-3 border rounded-lg bg-white">
					<div class="flex items-center gap-2 flex-wrap">
						<span class="text-sm font-medium text-gray-700 truncate">{scope.label}</span>
						<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 font-semibold shrink-0">
							{scope.layer}
						</span>
					</div>
					<p class="text-xs text-gray-400 mt-0.5 mb-2">
						{formatAge(scope.savedAt)} · {formatSize(scope.sizeBytes)}
					</p>
					<div class="flex items-center gap-1.5">
						{#if scope.route}
							<button
								type="button"
								onclick={() => bukaHalaman(scope)}
								class="px-2.5 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-medium"
							>
								Buka
							</button>
						{/if}
						<button
							type="button"
							onclick={() => eksporJson(scope)}
							class="px-2.5 py-1.5 rounded-lg bg-gray-50 text-gray-600 text-xs font-medium"
						>
							Ekspor .json
						</button>
						<button
							type="button"
							onclick={() => hapusDraf(scope)}
							class="px-2.5 py-1.5 rounded-lg bg-red-50 text-red-600 text-xs font-medium"
						>
							Hapus
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
