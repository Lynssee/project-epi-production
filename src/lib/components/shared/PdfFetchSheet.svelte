<!-- src/lib/components/shared/PdfFetchSheet.svelte -->
<!--
  Penampil PDF server-side untuk dashboard lapangan (PWA/WebView): GET `url` (berautentikasi Bearer) → blob → PdfBlobViewer + "Bagikan PDF".
  Prinsip sama dengan EssExportSheet: lapangan MENAMPILKAN/BERBAGI, tidak mengunduh (<a download> sering gagal diam-diam di WebView).
  Dipakai: Buku Saku alur (/panduan/alur) & Rapor Kinerja Pribadi (/ess/kinerja). Gagal → pesan jelas + tombol coba lagi (tidak diam).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import PdfBlobViewer from '$lib/components/project/PdfBlobViewer.svelte';
	import { auth } from '$lib/firebase';

	interface Props {
		open: boolean;
		url: string;
		title: string;
		filename?: string;
		onClose: () => void;
	}
	let { open, url, title, filename = 'dokumen', onClose }: Props = $props();

	let busy = $state(false);
	let msg = $state('');
	let blob = $state<Blob | null>(null);
	let lastUrl = '';

	const safeName = $derived((filename || 'dokumen').replace(/[\\/:*?"<>|]+/g, '-'));

	async function muat() {
		busy = true;
		msg = '';
		blob = null;
		try {
			const user = auth.currentUser;
			if (!user) throw new Error('Sesi login tidak ditemukan. Silakan login ulang.');
			const token = await user.getIdToken();
			const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' } });
			if (!res.ok) {
				const err = await res.json().catch(() => ({}));
				throw new Error(err?.message || `Gagal membuat PDF (HTTP ${res.status}).`);
			}
			blob = await res.blob();
		} catch (e: any) {
			msg = e?.message || 'Gagal membuat PDF.';
		} finally {
			busy = false;
		}
	}

	// Muat sekali setiap sheet dibuka untuk url tertentu; menutup lalu membuka lagi = membuat ulang (data bisa berubah).
	$effect(() => {
		if (open && url && url !== lastUrl) {
			lastUrl = url;
			untrack(() => muat());
		}
		if (!open) {
			lastUrl = '';
			blob = null;
			msg = '';
		}
	});

	async function bagikan() {
		if (!blob) return;
		const file = new File([blob], `${safeName}.pdf`, { type: 'application/pdf' });
		const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
		try {
			if (nav.share && nav.canShare?.({ files: [file] })) {
				await nav.share({ files: [file], title });
				return;
			}
		} catch (e: any) {
			if (e?.name === 'AbortError') return;
		}
		const href = URL.createObjectURL(file);
		const a = document.createElement('a');
		a.href = href;
		a.download = file.name;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(href);
	}
</script>

{#if open && !blob}
	<div class="fixed inset-0 z-40 flex items-end justify-center bg-black/40 backdrop-blur-sm" role="presentation" onclick={(e) => e.target === e.currentTarget && onClose()}>
		<div class="w-full max-w-md rounded-t-3xl bg-white dark:bg-slate-900 p-5 pb-8 shadow-2xl" data-testid="pdf-sheet">
			<div class="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-200 dark:bg-slate-700"></div>
			<div class="flex items-start justify-between gap-3">
				<h3 class="text-base font-bold text-slate-800 dark:text-slate-100">{title}</h3>
				<button onclick={onClose} class="h-8 w-8 shrink-0 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Tutup">✕</button>
			</div>
			{#if busy}
				<p class="mt-4 text-center text-sm text-slate-500">Menyiapkan PDF…</p>
			{:else if msg}
				<p class="mt-4 text-center text-sm text-red-600" data-testid="pdf-error">{msg}</p>
				<button onclick={muat} class="mt-3 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white">Coba Lagi</button>
			{/if}
		</div>
	</div>
{/if}

{#if open && blob}
	<PdfBlobViewer src={blob} title={`${safeName}.pdf`} show={true} {onClose} />
	<button onclick={bagikan} class="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg">Bagikan PDF</button>
{/if}
