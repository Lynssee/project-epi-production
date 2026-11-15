<!-- src/lib/components/ess/KpiInteractivePreviewModal.svelte -->
<!--
  Modal Pratinjau Interaktif Dossier KPI (True A4) untuk Dashboard Lapangan.
  Membuka URL /print/kpi yang aman dan terautentikasi dalam iframe responsif
  dengan dukungan cetak langsung, mode fullscreen, dan buka tab baru.
-->
<script lang="ts">
	import { IconPrinter, IconExternalLink, IconRefresh, IconX, IconAlertTriangle } from '@tabler/icons-svelte';
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { auth } from '$lib/firebase';

	interface Props {
		open: boolean;
		period?: string;
		scorecardId?: string;
		scope?: 'individual' | 'department';
		onClose: () => void;
	}

	let { open = false, period = '', scorecardId = '', scope = 'individual', onClose }: Props = $props();

	let loading = $state(false);
	let errorMsg = $state('');
	let printUrl = $state('');
	let modalTitle = $state('Pratinjau Rapor Kinerja');
	let iframeEl = $state<HTMLIFrameElement | null>(null);

	async function fetchPrintUrl() {
		if (!open) return;
		loading = true;
		errorMsg = '';
		printUrl = '';
		try {
			const user = auth.currentUser;
			if (!user) throw new Error('Sesi login tidak ditemukan. Silakan login ulang.');
			const token = await user.getIdToken();

			const q = new URLSearchParams();
			if (period) q.set('period', period);
			if (scorecardId) q.set('scorecard', scorecardId);
			if (scope) q.set('scope', scope);

			const res = await fetch(`/api/ess/kpi/print-url?${q.toString()}`, {
				headers: { Authorization: `Bearer ${token}` }
			});
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err?.message || `Gagal memuat URL pratinjau (HTTP ${res.status}).`);
			}
			const data = await res.json();
			if (!data.available || !data.url) {
				throw new Error(data.reason || 'Sistem ERP Admin sedang tidak dapat dijangkau.');
			}
			printUrl = data.url;
			modalTitle = data.title || (scope === 'department' ? 'Matriks Kinerja Tim' : 'Rapor Kinerja Pribadi');
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat pratinjau dokumen KPI.';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (open) {
			fetchPrintUrl();
		} else {
			printUrl = '';
			errorMsg = '';
		}
	});

	function handlePrint() {
		if (iframeEl && iframeEl.contentWindow) {
			try {
				iframeEl.contentWindow.print();
				return;
			} catch (_) {
				// Fallback jika iframe cross-origin
			}
		}
		if (printUrl) {
			window.open(printUrl, '_blank');
		}
	}

	function handleOpenTab() {
		if (printUrl) {
			window.open(printUrl, '_blank');
		}
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-2 sm:p-4 md:p-6"
		role="dialog"
		aria-modal="true"
		data-testid="kpi-interactive-preview-modal"
	>
		<div class="relative flex flex-col w-full h-[94vh] max-w-6xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-slate-300 dark:border-slate-700">
			<!-- Header Toolbar -->
			<div class="px-4 py-3 bg-slate-900 text-white flex items-center justify-between gap-3 border-b border-slate-800 shrink-0">
				<div class="flex items-center gap-2 min-w-0">
					<span class="text-base font-bold truncate text-white">{modalTitle}</span>
					<span class="hidden sm:inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-900/80 text-indigo-300 border border-indigo-700">
						True A4 Interaktif
					</span>
				</div>
				<div class="flex items-center gap-1.5 shrink-0">
					<button
						type="button"
						onclick={fetchPrintUrl}
						class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
						title="Muat Ulang"
						aria-label="Muat Ulang"
					>
						<IconRefresh size={18} />
					</button>
					<button
						type="button"
						onclick={handleOpenTab}
						disabled={!printUrl}
						class="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 hover:text-white disabled:opacity-40 transition-colors cursor-pointer"
						title="Buka di Jendela Penuh"
						aria-label="Buka di Jendela Penuh"
					>
						<IconExternalLink size={18} />
					</button>
					<button
						type="button"
						onclick={handlePrint}
						disabled={!printUrl}
						class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold disabled:opacity-40 transition-colors cursor-pointer shadow-sm"
						title="Cetak Dokumen"
					>
						<IconPrinter size={16} />
						<span class="hidden sm:inline">Cetak / PDF</span>
					</button>
					<button
						type="button"
						onclick={onClose}
						class="p-2 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
						title="Tutup"
						aria-label="Tutup"
					>
						<IconX size={20} />
					</button>
				</div>
			</div>

			<!-- Body Konten Iframe / State -->
			<div class="relative flex-1 w-full bg-slate-100 dark:bg-slate-950 overflow-hidden">
				{#if loading}
					<div class="absolute inset-0 flex flex-col items-center justify-center p-6 bg-slate-50 dark:bg-slate-900 z-10">
						<CircularProgressGauge size={54} strokeWidth={4} label="Menyiapkan Pratinjau Interaktif..." />
					</div>
				{:else if errorMsg}
					<div class="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10">
						<div class="w-14 h-14 rounded-full bg-rose-100 dark:bg-rose-950/60 flex items-center justify-center text-rose-600 mb-3">
							<IconAlertTriangle size={30} />
						</div>
						<h3 class="text-base font-bold text-slate-900 dark:text-slate-100 mb-1">Gagal Membuka Pratinjau</h3>
						<p class="text-xs text-rose-600 dark:text-rose-400 max-w-md mb-4">{errorMsg}</p>
						<div class="flex items-center gap-2">
							<button
								type="button"
								onclick={fetchPrintUrl}
								class="px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 shadow-md"
							>
								Coba Lagi
							</button>
							<button
								type="button"
								onclick={onClose}
								class="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 hover:bg-slate-200"
							>
								Tutup
							</button>
						</div>
					</div>
				{:else if printUrl}
					<iframe
						bind:this={iframeEl}
						src={printUrl}
						title={modalTitle}
						class="w-full h-full border-0 bg-white"
						allow="print"
					></iframe>
				{/if}
			</div>
		</div>
	</div>
{/if}
