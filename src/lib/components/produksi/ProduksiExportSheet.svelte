<!-- src/lib/components/produksi/ProduksiExportSheet.svelte -->
<!--
  Export Produksi v2 — Fase 4 §6.6. Bottom-sheet mobile-first, dibuka dari header
  Monitoring Produksi lapangan. Prinsip rencana:
   - Lapangan MENAMPILKAN / BERBAGI, bukan sekadar mengunduh:
       CSV → Web Share API (File) → jatuh ke <a download> bila share tak ada. Bisa OFFLINE.
       PDF → dirender server (Gotenberg via /api/export/produksi) → PdfBlobViewer.
             Butuh koneksi; saat offline tombol TIDAK dimatikan — beri pesan + CSV tetap jalan (Aturan #6).
   - Nol dependency baru: CSV lewat exportCsv.ts, PDF nol bundle klien.
   - Allow-list terpisah (produksiExportAllowlist.ts) — nol kolom harga/HPP.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import PdfBlobViewer from '$lib/components/project/PdfBlobViewer.svelte';
	import { csvFile, buildCsv } from '$lib/utils/exportCsv';
	import { getIdToken } from '$lib/services/secureDirectus';
	import {
		PRODUKSI_EXPORT_SECTIONS,
		PRODUKSI_EXPORT_KEYS,
		flattenForExport,
		type ProduksiExportKey
	} from '$lib/config/produksiExportAllowlist';
	import {
		enqueueProduksiPdf,
		getQueuedProduksiPdf,
		flushProduksiPdfQueue,
		registerProduksiPdfAutoFlush,
		type QueuedProduksiPdf
	} from '$lib/utils/offlineProduksiPdfQueue';

	interface Props {
		open: boolean;
		onClose: () => void;
		/** Baris mentah per bagian, mengikuti filter aktif di halaman. */
		rowsByKey: Partial<Record<ProduksiExportKey, any[]>>;
	}
	let { open, onClose, rowsByKey }: Props = $props();

	let busy = $state('');
	let msg = $state('');
	let pdfBlob = $state<Blob | null>(null);
	let pdfName = $state('produksi-export.pdf');
	let online = $state(true);
	let queuedCount = $state(0);

	async function refreshQueued() {
		queuedCount = (await getQueuedProduksiPdf().catch(() => [])).length;
	}

	/** Kirim satu entri antrean → render PDF di server → serahkan ke user (unduh). Throw = tetap di antrean. */
	async function sendQueuedPdf(entry: QueuedProduksiPdf): Promise<void> {
		const token = await getIdToken();
		const resp = await fetch('/api/export/produksi', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({
				section: entry.section,
				judul: entry.judul,
				subjudul: entry.subjudul,
				landscape: entry.landscape,
				kolom: entry.kolom,
				baris: entry.baris
			})
		});
		if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
		const blob = await resp.blob();
		// Tanpa gesture user (dipanggil dari event 'online') → langsung unduh, jangan share-prompt.
		const url = URL.createObjectURL(new File([blob], entry.filename, { type: 'application/pdf' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = entry.filename;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	onMount(() => {
		online = navigator.onLine;
		const up = () => (online = true);
		const down = () => (online = false);
		window.addEventListener('online', up);
		window.addEventListener('offline', down);

		registerProduksiPdfAutoFlush(async (entry) => {
			await sendQueuedPdf(entry);
			await refreshQueued();
		});
		refreshQueued();
		if (navigator.onLine) {
			flushProduksiPdfQueue(sendQueuedPdf).then((r) => {
				if (r.sent > 0) msg = `${r.sent} PDF tertunda selesai dibuat.`;
				refreshQueued();
			});
		}

		return () => {
			window.removeEventListener('online', up);
			window.removeEventListener('offline', down);
		};
	});

	function rowsFor(key: ProduksiExportKey) {
		return flattenForExport(key, rowsByKey[key] || []);
	}
	function sizeHint(key: ProduksiExportKey): string {
		const cols = PRODUKSI_EXPORT_SECTIONS[key].columns.map((c) => ({ key: c.key, label: c.label }));
		const bytes = new Blob([buildCsv(rowsFor(key), cols)]).size;
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}

	async function shareOrDownload(file: File): Promise<'shared' | 'aborted' | 'downloaded'> {
		const nav = navigator as Navigator & { canShare?: (d: any) => boolean };
		try {
			if (nav.share && nav.canShare?.({ files: [file] })) {
				await nav.share({ files: [file], title: file.name });
				return 'shared';
			}
		} catch (e: any) {
			if (e?.name === 'AbortError') return 'aborted';
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

	async function doCsv(key: ProduksiExportKey) {
		if (busy) return;
		const rows = rowsFor(key);
		if (!rows.length) {
			msg = 'Belum ada data pada bagian ini.';
			return;
		}
		busy = `${key}:csv`;
		msg = '';
		try {
			const cols = PRODUKSI_EXPORT_SECTIONS[key].columns.map((c) => ({ key: c.key, label: c.label }));
			const stamp = new Date().toISOString().slice(0, 10);
			const res = await shareOrDownload(csvFile(rows, cols, `produksi-${key}-${stamp}.csv`));
			msg =
				res === 'downloaded'
					? 'CSV tersimpan ke perangkat.'
					: res === 'shared'
						? 'CSV dibagikan.'
						: '';
		} catch (e: any) {
			msg = 'Gagal menyiapkan CSV: ' + (e?.message || e);
		} finally {
			busy = '';
		}
	}

	function buildPdfPayload(key: ProduksiExportKey) {
		const section = PRODUKSI_EXPORT_SECTIONS[key];
		const cols = section.columns;
		const rows = rowsFor(key);
		return {
			section: key,
			judul: `Monitoring Produksi — ${section.label}`,
			subjudul: `${rows.length} baris · ${new Date().toLocaleDateString('id-ID')}`,
			landscape: cols.length > 6,
			kolom: cols.map((c) => c.label),
			baris: rows.map((r) =>
				cols.map((c): string | number | null => {
					const v = r[c.key];
					if (v == null) return '';
					return typeof v === 'number' ? v : String(v);
				})
			),
			filename: `produksi-${key}-${new Date().toISOString().slice(0, 10)}.pdf`
		};
	}

	async function doPdf(key: ProduksiExportKey) {
		if (busy) return;
		const rows = rowsFor(key);
		if (!rows.length) {
			msg = 'Belum ada data pada bagian ini.';
			return;
		}
		if (!online) {
			// §6.4 — masuk antrean, otomatis dibuat saat online (bukan tombol mati).
			const p = buildPdfPayload(key);
			await enqueueProduksiPdf({
				client_txn_id: `pdf-${key}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
				createdAt: new Date().toISOString(),
				...p
			});
			await refreshQueued();
			msg = 'Sedang offline — permintaan PDF disimpan, otomatis dibuat saat online lagi. CSV tetap bisa sekarang.';
			return;
		}
		busy = `${key}:pdf`;
		msg = '';
		try {
			const section = PRODUKSI_EXPORT_SECTIONS[key];
			const cols = section.columns;
			const token = await getIdToken();
			const resp = await fetch('/api/export/produksi', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({
					section: key,
					judul: `Monitoring Produksi — ${section.label}`,
					subjudul: `${rows.length} baris · ${new Date().toLocaleDateString('id-ID')}`,
					landscape: cols.length > 6,
					kolom: cols.map((c) => c.label),
					baris: rows.map((r) => cols.map((c) => r[c.key] ?? ''))
				})
			});
			if (!resp.ok) {
				const t = await resp.json().catch(() => ({}));
				throw new Error(t?.message || `Gagal membuat PDF (HTTP ${resp.status})`);
			}
			pdfBlob = await resp.blob();
			pdfName = `produksi-${key}-${new Date().toISOString().slice(0, 10)}.pdf`;
		} catch (e: any) {
			msg = e?.message || 'Gagal membuat PDF.';
		} finally {
			busy = '';
		}
	}

	async function sharePdf() {
		if (!pdfBlob) return;
		await shareOrDownload(new File([pdfBlob], pdfName, { type: 'application/pdf' }));
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
					<h3 class="text-base font-bold text-slate-800 dark:text-slate-100">Ekspor Data Produksi</h3>
					<p class="text-xs text-slate-400">Mengambil data yang sedang tampil (mengikuti filter aktif).</p>
				</div>
				<button
					onclick={onClose}
					class="h-8 w-8 shrink-0 rounded-full text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
					aria-label="Tutup">✕</button
				>
			</div>

			<p class="mb-3 text-[11px] text-slate-400">
				CSV untuk diolah di Excel/Sheets (bisa dibuat tanpa koneksi). PDF cocok dikirim/ditunjukkan
				ke atasan (butuh koneksi).
			</p>

			{#if !online}
				<div
					class="mb-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11px] font-medium text-amber-700 dark:text-amber-300"
				>
					⚠ Sedang offline — permintaan PDF akan diantre & dibuat otomatis saat online. CSV tetap bisa
					sekarang.
				</div>
			{/if}

			{#if queuedCount > 0}
				<div
					class="mb-3 flex items-center justify-between gap-2 rounded-xl bg-blue-50 dark:bg-blue-950/30 px-3 py-2 text-[11px] font-medium text-blue-700 dark:text-blue-300"
				>
					<span>⏳ {queuedCount} permintaan PDF menunggu koneksi.</span>
					{#if online}
						<button
							class="rounded-lg bg-blue-600 px-2 py-1 text-white"
							onclick={() =>
								flushProduksiPdfQueue(sendQueuedPdf).then((r) => {
									if (r.sent > 0) msg = `${r.sent} PDF tertunda selesai dibuat.`;
									refreshQueued();
								})}>Buat sekarang</button
						>
					{/if}
				</div>
			{/if}

			<div class="space-y-2.5">
				{#each PRODUKSI_EXPORT_KEYS as key}
					{@const sec = PRODUKSI_EXPORT_SECTIONS[key]}
					{@const n = rowsFor(key).length}
					<div class="rounded-2xl border border-slate-200 dark:border-slate-700 p-3">
						<div class="flex items-center justify-between">
							<div>
								<div class="text-sm font-bold text-slate-800 dark:text-slate-100">{sec.label}</div>
								<div class="text-[11px] text-slate-400">
									{n} baris{#if n > 0} · ±{sizeHint(key)}{/if}
								</div>
							</div>
						</div>
						<div class="mt-2.5 flex gap-2">
							<button
								onclick={() => doCsv(key)}
								disabled={busy !== '' || n === 0}
								class="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 disabled:opacity-40"
							>
								{busy === `${key}:csv` ? 'Menyiapkan…' : '📊 CSV'}
							</button>
							{#if sec.formats.includes('pdf')}
								<button
									onclick={() => doPdf(key)}
									disabled={busy !== '' || n === 0}
									class="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 py-2 text-xs font-bold disabled:opacity-40 {online
										? 'text-slate-700 dark:text-slate-200'
										: 'text-slate-400'}"
								>
									{#if busy === `${key}:pdf`}
										Membuat…
									{:else if online}
										📄 PDF
									{:else}
										📄 Antre PDF
									{/if}
								</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>

			{#if msg}
				<p class="mt-3 text-center text-xs text-slate-500">{msg}</p>
			{/if}
		</div>
	</div>
{/if}

{#if pdfBlob}
	<PdfBlobViewer src={pdfBlob} title={pdfName} show={true} onClose={() => (pdfBlob = null)} />
	<button
		onclick={sharePdf}
		class="fixed bottom-4 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-lg"
	>
		Bagikan PDF
	</button>
{/if}
