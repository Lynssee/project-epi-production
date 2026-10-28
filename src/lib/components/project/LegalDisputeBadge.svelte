<script lang="ts">
	// Badge ⚖️ sengketa hukum penagihan customer proyek — READ-ONLY untuk Project Leader.
	// Tanpa nominal/nomor PA (lihat $lib/server/legalDisputeStatus.ts). Fail-soft: gagal = tidak tampil.
	import { onMount } from 'svelte';
	import { auth } from '$lib/firebase';

	let { projectId }: { projectId: number | string } = $props();

	let tahap = $state<'somasi' | 'litigasi' | null>(null);

	onMount(async () => {
		try {
			const user = auth?.currentUser;
			if (!user) return;
			const token = await user.getIdToken();
			const res = await fetch(`/api/proyek/${encodeURIComponent(String(projectId))}/sengketa-hukum`, {
				headers: { Authorization: `Bearer ${token}` }
			});
			if (!res.ok) return;
			const d = await res.json();
			tahap = d?.aktif ? (d.tahap ?? 'somasi') : null;
		} catch (e) {
			console.warn('[LegalDisputeBadge] gagal memuat status sengketa hukum', e);
		}
	});
</script>

{#if tahap}
	<div
		class="rounded-xl border p-3 {tahap === 'litigasi' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}"
		title="Informasi dari Finance. Anda tidak perlu mengubah apa pun; hanya berhati-hati."
	>
		<p class="text-sm font-semibold {tahap === 'litigasi' ? 'text-red-800' : 'text-amber-800'}">
			⚖️ Customer proyek ini sedang dalam sengketa hukum penagihan ({tahap === 'litigasi' ? 'Litigasi' : 'Somasi'})
		</p>
		<p class="text-[11px] text-gray-600 mt-0.5">
			Hati-hati saat menjanjikan pekerjaan tambahan, serah terima, atau pengiriman baru. Koordinasikan dengan Finance/Sales sebelum berkomitmen ke customer.
		</p>
	</div>
{/if}
