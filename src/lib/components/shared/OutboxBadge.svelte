<script lang="ts">
	// Fase 4 (rencana "Package & Fitur Addons" §5) — UI Outbox global: satu badge yang
	// menghitung SEMUA antrian offline (lihat offlineOutboxStore.ts). Hanya memantau +
	// menavigasi ke halaman terkait — TIDAK mengirim ulang langsung dari sini (lihat
	// alasan di offlineOutboxStore.ts).
	import { onMount, onDestroy } from 'svelte';
	import { offlineOutbox, initOfflineOutboxWatcher, refreshOutboxCounts } from '$lib/stores/offlineOutboxStore';
	import IconCloudUp from '@tabler/icons-svelte/icons/cloud-up';

	let open = $state(false);
	let stop: (() => void) | null = null;

	onMount(() => {
		stop = initOfflineOutboxWatcher();
	});
	onDestroy(() => stop?.());

	function toggle() {
		open = !open;
		if (open) refreshOutboxCounts();
	}
</script>

<div class="relative">
	<button
		type="button"
		class="relative w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all bg-[var(--sys-fill)] hover:bg-[var(--sys-fill2)] text-[var(--sys-label2)]"
		onclick={toggle}
		title="Data belum tersinkron"
	>
		<IconCloudUp size={16} />
		{#if $offlineOutbox.total > 0}
			<span class="absolute -top-1 -right-1 text-[9px] font-bold text-white rounded-full min-w-[16px] h-4 flex items-center justify-center px-1" style="background: #D97706">
				{$offlineOutbox.total > 99 ? '99+' : $offlineOutbox.total}
			</span>
		{/if}
	</button>

	{#if open}
		<!-- svelte-ignore a11y-click-events-have-key-events -->
		<!-- svelte-ignore a11y-no-static-element-interactions -->
		<div class="fixed inset-0 z-40" onclick={() => (open = false)}></div>
		<div class="absolute right-0 top-10 z-50 w-72 rounded-xl border shadow-lg bg-white overflow-hidden" style="border-color: var(--sys-sep)">
			<div class="px-4 py-3 border-b" style="border-color: var(--sys-sep)">
				<p class="text-[12px] font-bold" style="color: var(--sys-label)">Data belum tersinkron</p>
				<p class="text-[10px] mt-0.5" style="color: var(--sys-label3)">Otomatis terkirim saat koneksi kembali online.</p>
			</div>
			{#if $offlineOutbox.entries.length === 0}
				<div class="px-4 py-6 text-center text-[11px]" style="color: var(--sys-label4)">
					{$offlineOutbox.loading ? 'Memeriksa...' : 'Semua data sudah tersinkron.'}
				</div>
			{:else}
				<div class="max-h-72 overflow-y-auto">
					{#each $offlineOutbox.entries as entry (entry.key)}
						<a
							href={entry.route}
							class="flex items-center justify-between px-4 py-2.5 border-b last:border-b-0 hover:bg-[var(--sys-fill)] transition-colors"
							style="border-color: var(--sys-sep)"
							onclick={() => (open = false)}
						>
							<span class="text-[11px] font-medium truncate" style="color: var(--sys-label)">{entry.label}</span>
							<span class="text-[10px] font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5 shrink-0" style="background: var(--sys-fill2); color: var(--sys-label2)">
								{entry.count}
							</span>
						</a>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
