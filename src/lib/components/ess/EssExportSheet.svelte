<!-- src/lib/components/ess/EssExportSheet.svelte -->
<!--
  Bottom-sheet ekspor untuk dashboard lapangan (PWA). Prinsip (dok. rencana §2):
   - Lapangan tidak mengunduh, lapangan MENAMPILKAN/ BERBAGI.
     CSV → Web Share API (File) → jatuh ke <a download> hanya bila share tak ada.
     PDF → dirender di server (Gotenberg via /api/ess/export-pdf) → PdfBlobViewer
           (iframe blob) — <a download> sering gagal diam-diam di WebView.
   - Nol dependency baru: CSV lewat exportCsv.ts (±30 baris), PDF nol bundle klien.
-->
<script lang="ts">
	import PdfBlobViewer from '$lib/components/project/PdfBlobViewer.svelte';
	import { csvFile, type CsvColumn } from '$lib/utils/exportCsv';

	interface Props {
		open: boolean;
		onClose: () => void;
		judul: string;
		filename: string;
		columns: CsvColumn[];
		rows: Array<Record<string, unknown>>;
		subjudul?: string;
		/** Stempel diagonal PDF (mis. dokumen finansial pribadi). */
		watermark?: string;
		landscape?: boolean;
	}

	let {
		open,
		onClose,
		judul,
		filename,
		columns,
		rows,
		subjudul = '',
		watermark = '',
		landscape = false
	}: Props = $props();

	let busy = $state<'' | 'csv' | 'pdf'>('');
	let msg = $state('');
	let pdfBlob = $state<Blob | null>(null);

	const hasData = $derived(Array.isArray(rows) && rows.length > 0 && columns.length > 0);
	const safeName = $derived((filename || 'ekspor').replace(/[\\/:*?"<>|]+/g, '-'));

	function cell(r: Record<string, unknown>, k: string) {
		const v = r?.[k];
		return v == null ? '' : v;
	}

	async function shareOrDownload(file: File): Promise<'shared' | 'aborted' | 'downloaded'> {
		const nav = navigator as Navigator & { canShare?: (d: any) => boolean };
		try {
			if (nav.share && nav.canShare?.({ files: [file] })) {
				await nav.share({ files: [file], title: judul });
				return 'shared';
			}
		} catch (e: any) {
			if (e?.name === 'AbortError') return 'aborted';
			// lanjut ke fallback unduh
		}
		const url = URL.createObjectURL(file);
		const a = document.createElement('a');
		a.href = url;
		a.download = file.name;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
		return 'downloaded';
	}

	async function doCsv() {
		if (!hasData || busy) return;
		busy = 'csv';
		msg = '';
		try {
			const res = await shareOrDownload(csvFile(rows, columns, `${safeName}.csv`));
			msg = res === 'downloaded' ? 'CSV tersimpan ke perangkat.' : res === 'shared' ? 'CSV dibagikan.' : '';
		} catch (e: any) {
			msg = 'Gagal menyiapkan CSV: ' + (e?.message || e);
		} finally {
			busy = '';
		}
	}

	async function doPdf() {
		if (!hasData || busy) return;
		busy = 'pdf';
		msg = '';
		try {
			const resp = await fetch('/api/ess/export-pdf', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					judul,
					subjudul,
					watermark,
					landscape,
					kolom: columns.map((c) => c.label),
					baris: rows.map((r) => columns.map((c) => cell(r, c.key)))
				})
			});
			if (!resp.ok) {
				const t = await resp.json().catch(() => ({}));
				throw new Error(t?.message || `Gagal membuat PDF (HTTP ${resp.status})`);
			}
			pdfBlob = await resp.blob();
		} catch (e: any) {
			msg = e?.message || 'Gagal membuat PDF.';
		} finally {
			busy = '';
		}
	}

	async function sharePdf() {
		if (!pdfBlob) return;
		await shareOrDownload(new File([pdfBlob], `${safeName}.pdf`, { type: 'application/pdf' }));
	}
</script>

{#if open}
	<div
		class="fixed inset-0 z-40 flex items-end justify-center bg-black/40 backdrop-blur-sm"
		role="presentation"
		onclick={(e) => e.target === e.currentTarget && onClose()}
	>
		<div class="w-full max-w-md rounded-t-3xl bg-white dark:bg-slate-900 p-5 pb-8 shadow-2xl">
			<div class="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-200 dark:bg-slate-700"></div>
			<div class="mb-1 flex items-start justify-between gap-3">
				<div>
					<h3 class="text-base font-bold text-slate-800 dark:text-slate-100">Ekspor {judul}</h3>
					<p class="text-xs text-slate-400">
						{hasData ? `${rows.length} baris siap diekspor` : 'Belum ada data pada tampilan ini'}
					</p>
				</div>
				<button
					onclick={onClose}
					class="h-8 w-8 shrink-0 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
					aria-label="Tutup"
				>✕</button>
			</div>

			<p class="mb-4 text-[11px] text-slate-400">
				PDF cocok untuk dikirim/ditunjukkan ke atasan. CSV untuk diolah di Excel/Sheets.
			</p>

			<div class="grid grid-cols-2 gap-3">
				<button
					onclick={doPdf}
					disabled={!hasData || busy !== ''}
					class="flex flex-col items-center gap-1.5 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 text-sm font-bold text-slate-700 dark:text-slate-200 disabled:opacity-40"
				>
					<span class="text-2xl">📄</span>
					{busy === 'pdf' ? 'Membuat…' : 'PDF'}
				</button>
				<button
					onclick={doCsv}
					disabled={!hasData || busy !== ''}
					class="flex flex-col items-center gap-1.5 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 text-sm font-bold text-slate-700 dark:text-slate-200 disabled:opacity-40"
				>
					<span class="text-2xl">📊</span>
					{busy === 'csv' ? 'Menyiapkan…' : 'Bagikan CSV'}
				</button>
			</div>

			{#if msg}
				<p class="mt-3 text-center text-xs text-slate-500">{msg}</p>
			{/if}
		</div>
	</div>
{/if}

{#if pdfBlob}
	<PdfBlobViewer
		src={pdfBlob}
		title={`${safeName}.pdf`}
		show={true}
		onClose={() => (pdfBlob = null)}
	/>
	<button
		onclick={sharePdf}
		class="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg"
	>
		Bagikan PDF
	</button>
{/if}
