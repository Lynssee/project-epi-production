<!-- src/lib/components/project/PdfBlobViewer.svelte -->
<script lang="ts">
	import { onDestroy, untrack } from 'svelte';

	interface Props {
		src: Blob | File | string | null | undefined;
		title?: string;
		show?: boolean;
		onClose?: () => void;
	}

	let { src, title = 'Document Preview', show = true, onClose }: Props = $props();

	let objectUrl = $state<string | null>(null);
	let loading = $state(true);
	let error = $state(false);

	// Computed URL to display in iframe
	const previewUrl = $derived.by(() => {
		if (!src) return '';
		if (typeof src === 'string') return src;
		return objectUrl || '';
	});

	function cleanupUrl() {
		if (objectUrl) {
			URL.revokeObjectURL(objectUrl);
			objectUrl = null;
		}
	}

	// Watch src and manage URL lifetime
	$effect(() => {
		if (src) {
			untrack(() => {
				cleanupUrl();
				loading = true;
				error = false;
				if (src instanceof Blob || src instanceof File) {
					try {
						objectUrl = URL.createObjectURL(src);
					} catch (e) {
						console.error('Failed to create Object URL:', e);
						error = true;
						loading = false;
					}
				} else {
					loading = false;
				}
			});
		} else {
			untrack(() => {
				cleanupUrl();
				loading = false;
				error = false;
			});
		}

		return () => {
			untrack(() => cleanupUrl());
		};
	});

	function handleIframeLoad() {
		loading = false;
	}

	function handleIframeError() {
		error = true;
		loading = false;
	}

	function downloadPdf() {
		if (!previewUrl) return;
		const a = document.createElement('a');
		a.href = previewUrl;
		a.download = title.endsWith('.pdf') ? title : `${title}.pdf`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
	}

	onDestroy(() => {
		cleanupUrl();
	});
</script>

{#if show}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 transition-opacity duration-300 animate-in fade-in"
		role="presentation"
		onclick={(e) => e.target === e.currentTarget && onClose?.()}
	>
		<div
			class="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden transform transition-all duration-300 animate-in zoom-in-95"
		>
			<!-- Header -->
			<div class="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
				<div class="min-w-0">
					<h3 class="text-base font-bold text-slate-800 dark:text-slate-100 truncate pr-4">
						{title}
					</h3>
				</div>
				<div class="flex items-center gap-2 shrink-0">
					{#if previewUrl}
						<button
							onclick={downloadPdf}
							class="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors shadow-sm flex items-center gap-1.5"
						>
							<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
							</svg>
							Unduh
						</button>
					{/if}
					<button
						onclick={onClose}
						class="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-lg font-medium transition-colors"
						aria-label="Tutup"
					>
						✕
					</button>
				</div>
			</div>

			<!-- PDF Frame Container -->
			<div class="flex-1 bg-slate-100 dark:bg-slate-950 p-4 flex flex-col items-center justify-center relative min-h-0">
				{#if !src}
					<div class="flex flex-col items-center text-center text-slate-400 p-8">
						<span class="text-5xl mb-3">📁</span>
						<p class="text-sm font-semibold">Tidak ada berkas PDF</p>
					</div>
				{:else if loading}
					<div class="flex flex-col items-center gap-3 text-slate-500 dark:text-slate-400">
						<div class="w-9 h-9 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin"></div>
						<span class="text-xs font-semibold">Memuat dokumen PDF...</span>
					</div>
				{/if}

				{#if error}
					<div class="flex flex-col items-center text-center text-rose-500 p-8">
						<span class="text-5xl mb-3">⚠️</span>
						<p class="text-sm font-semibold">Gagal memuat dokumen</p>
						<p class="text-xs text-slate-400 mt-1 mb-4">Pastikan berkas yang dimasukkan berformat PDF valid.</p>
					</div>
				{/if}

				{#if previewUrl && !error}
					<iframe
						src={previewUrl}
						onload={handleIframeLoad}
						onerror={handleIframeError}
						class="w-full h-full border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 shadow-sm transition-opacity duration-300 {loading ? 'opacity-0 absolute pointer-events-none' : 'opacity-100'}"
						title={title}
					></iframe>
				{/if}
			</div>
		</div>
	</div>
{/if}
