<!-- src/lib/components/anggaran/KesiapanProyekWidget.svelte
     Fase 4 (Rencana v2 Shift-Left Gate Anggaran, 25 Sep 2026) — widget ringkas Home
     lapangan, sama data dengan /anggaran/cek-gate. Komponen mandiri, onMount sendiri,
     non-blocking (pola sama PersonalWidget.svelte) — tidak menumpang pipeline loading
     Home. Tidak tampil sama sekali bila user tidak terhubung ke proyek manapun (nol
     noise bagi peran non-PL). -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fetchReadinessBatch } from '$lib/services/readinessBatch';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';

	let loading = $state(true);
	let readiness = $state<any>(null);

	onMount(async () => {
		try {
			const projects = (await getProjectsForCurrentUser(false)) || [];
			if (projects.length === 0) {
				loading = false;
				return;
			}
			// Cache 2 menit bersama /anggaran/cek-gate (readinessBatch.ts) — Home → cek-gate tidak 2x request.
			readiness = await fetchReadinessBatch(projects.map((p: any) => p.id));
		} catch (e) {
			console.error('[KesiapanProyekWidget] gagal memuat:', e);
		} finally {
			loading = false;
		}
	});
</script>

{#if !loading && readiness && readiness.total_count > 0 && readiness.siap_count < readiness.total_count}
	<button
		type="button"
		onclick={() => goto('/anggaran/cek-gate')}
		class="w-full text-left rounded-xl p-3 mb-4"
		style="background: var(--sys-fill2); border: 1px solid var(--sys-sep)"
	>
		<div class="flex items-center justify-between">
			<p class="text-[12px] font-semibold" style="color: var(--sys-label)">🧭 Kesiapan Proyek Saya</p>
			<span class="text-[11px] font-medium text-amber-600">{readiness.siap_count}/{readiness.total_count} siap →</span>
		</div>
		<p class="text-[11px] mt-1" style="color: var(--sys-label-2)">
			{readiness.total_count - readiness.siap_count} proyek belum lengkap datanya (Timeline/Laporan/Manpower) — lihat & ajukan.
		</p>
	</button>
{/if}
