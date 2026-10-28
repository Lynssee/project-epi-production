<script lang="ts">
	// FormDraftBar — banner pemulihan + chip status draf untuk Lapis 1 (Fase 3, rencana
	// Draf Otomatis Universal & Anti-White-Screen v2). Memperluas DraftIndicator.svelte
	// (dipakai untuk chip "tersimpan"), BUKAN menggantinya.
	//
	// Pemakaian tipikal (di halaman yang pakai use:autoDraft):
	//   <div use:autoDraft={{ onRestoreAvailable: (info) => (restoreInfo = info) }}>
	//   <FormDraftBar {restoreInfo} {savedAt} onApplied={() => (restoreInfo = null)} />
	import DraftIndicator from './DraftIndicator.svelte';

	interface RestoreInfo {
		savedAt: number | null;
		apply: () => void;
		discard: () => void;
	}

	let {
		restoreInfo = null,
		savedAt = null,
		isOffline = false,
		onApplied
	}: {
		restoreInfo?: RestoreInfo | null;
		savedAt?: number | null;
		isOffline?: boolean;
		onApplied?: () => void;
	} = $props();

	function formatRelative(ms: number | null) {
		if (!ms) return '';
		const diffMin = Math.round((Date.now() - ms) / 60000);
		const jam = new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
		if (diffMin < 1) return `barusan (${jam})`;
		if (diffMin < 60) return `${diffMin} menit lalu (${jam})`;
		const diffJam = Math.round(diffMin / 60);
		return `${diffJam} jam lalu (${jam})`;
	}

	function apply() {
		restoreInfo?.apply();
		onApplied?.();
	}

	function discard() {
		if (!confirm('Buang isian lama yang belum terkirim? Tindakan ini tidak bisa dibatalkan.')) return;
		restoreInfo?.discard();
		onApplied?.();
	}
</script>

{#if restoreInfo}
	<div
		class="w-full bg-blue-50 dark:bg-blue-950/30 border-b border-blue-200 dark:border-blue-900 px-4 py-2.5 text-xs md:text-sm text-blue-800 dark:text-blue-300 flex flex-wrap items-center justify-between gap-2"
	>
		<span>
			Ada isian belum terkirim dari {formatRelative(restoreInfo.savedAt)}.
		</span>
		<div class="flex items-center gap-2 shrink-0">
			<button
				type="button"
				onclick={apply}
				class="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors"
			>
				Pulihkan Isian
			</button>
			<button
				type="button"
				onclick={discard}
				class="px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-blue-300 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-blue-700 dark:text-blue-300 text-xs font-medium transition-colors"
			>
				Mulai Baru
			</button>
		</div>
	</div>
{:else if savedAt || isOffline}
	<div class="px-1">
		<DraftIndicator savedAt={savedAt ? new Date(savedAt) : null} {isOffline} />
	</div>
{/if}
