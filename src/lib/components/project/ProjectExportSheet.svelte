<script lang="ts">
	// src/lib/components/project/ProjectExportSheet.svelte
	// Fase "Export Universal — Dashboard Lapangan" (§5.4). Bottom-sheet mobile-first.
	//
	// • Excel / CSV: dibuat 100% di perangkat — TETAP bisa offline.
	// • PDF: hanya server (Gotenberg). Offline → masuk antrian, terkirim otomatis
	//   saat online (badge "menunggu koneksi"), BUKAN tombol mati (Aturan #6).
	// • Section = daftar putih lapangan (fieldExportRegistry) — data sensitif
	//   (HPP/margin/kontrak/harga) tidak pernah ada di sini.

	import { onMount } from 'svelte';
	import { IconX, IconLoader2, IconFileSpreadsheet, IconFileText, IconFileTypePdf, IconWifiOff, IconShare2 } from '@tabler/icons-svelte';
	import { auth } from '$lib/firebase';
	import { listFieldExportSections, type FieldExportSection } from '$lib/config/fieldExportRegistry';
	import { flattenForField } from '$lib/services/fieldExportApi';
	import { buildXlsxBlob } from '$lib/utils/exportExcelJs';
	import { buildCsvBlob } from '$lib/utils/csvExport';
	import { enqueuePdfExport } from '$lib/utils/offlineExportPdfQueue';

	const SIZE_WARN_BYTES = 4 * 1024 * 1024; // B4 §7 — ingatkan bila file besar

	let { projectId, projectName = '', arsip = false, onClose } = $props<{
		projectId: number | string;
		projectName?: string;
		/** §7 A3 — proyek `closed`: file diberi awalan ARSIP_ + catatan. */
		arsip?: boolean;
		onClose: () => void;
	}>();

	const toast = {
		success: (m: string) => (window as any).__showToast?.(m, 'success'),
		error: (m: string) => (window as any).__showToast?.(m, 'error'),
		info: (m: string) => (window as any).__showToast?.(m, 'info')
	};

	const sections = listFieldExportSections();
	let selectedKey = $state<string>(sections[0]?.key ?? '');
	let dateFrom = $state('');
	let dateTo = $state('');
	let busy = $state<null | 'xlsx' | 'csv' | 'pdf'>(null);
	let statusMsg = $state('');
	let online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);
	let lastFile = $state<File | null>(null); // hasil terakhir, untuk tombol Bagikan (B1 §7)

	function fmtSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	}

	/** Unduh blob + simpan sebagai File untuk Bagikan + peringatan ukuran (B4). */
	function finishFile(blob: Blob, name: string) {
		const file = new File([blob], name, { type: blob.type });
		lastFile = file;
		const url = URL.createObjectURL(file);
		const a = document.createElement('a');
		a.href = url;
		a.download = name;
		a.click();
		URL.revokeObjectURL(url);
		if (blob.size > SIZE_WARN_BYTES) {
			toast.info(`File ±${fmtSize(blob.size)} — sebaiknya pakai WiFi saat membagikan.`);
		}
	}

	async function shareLast() {
		if (!lastFile) return;
		try {
			const nav: any = navigator;
			if (nav.canShare?.({ files: [lastFile] })) {
				await nav.share({ files: [lastFile], title: lastFile.name });
			} else if (nav.share) {
				await nav.share({ title: lastFile.name, text: lastFile.name });
			} else {
				toast.info('Perangkat ini tidak mendukung berbagi langsung — file sudah terunduh.');
			}
		} catch (e: any) {
			if (e?.name !== 'AbortError') toast.error('Gagal membagikan file.');
		}
	}

	const canShare = $derived(
		typeof navigator !== 'undefined' && !!(navigator as any).share
	);

	const selected = $derived<FieldExportSection | undefined>(
		sections.find((s) => s.key === selectedKey)
	);
	const pid = $derived(Number(projectId));
	const baseName = $derived(
		`${arsip ? 'ARSIP_' : ''}${selectedKey}-${String(projectName || pid)
			.replace(/[^a-zA-Z0-9]+/g, '_')
			.slice(0, 32)}-${new Date().toISOString().slice(0, 10)}`
	);

	onMount(() => {
		const on = () => (online = true);
		const off = () => (online = false);
		window.addEventListener('online', on);
		window.addEventListener('offline', off);
		return () => {
			window.removeEventListener('online', on);
			window.removeEventListener('offline', off);
		};
	});

	function opts() {
		const sec = selected;
		if (sec?.supportsDateRange && (dateFrom || dateTo)) {
			return { dateRange: { from: dateFrom || undefined, to: dateTo || undefined } };
		}
		return {};
	}

	async function loadRows(): Promise<{ rows: Array<Record<string, unknown>>; sec: FieldExportSection }> {
		const sec = selected;
		if (!sec) throw new Error('Pilih jenis data dulu.');
		statusMsg = 'Mengambil data…';
		const raw = await sec.fetch(pid, opts());
		const rows = flattenForField(raw, sec.columns);
		if (rows.length === 0) throw new Error('Tidak ada data pada rentang/jenis yang dipilih.');
		return { rows, sec };
	}

	async function doExcel() {
		if (busy) return;
		busy = 'xlsx';
		statusMsg = '';
		try {
			const { rows, sec } = await loadRows();
			statusMsg = 'Menyusun Excel…';
			const blob = await buildXlsxBlob(rows, sec.label.slice(0, 31), sec.columns);
			finishFile(blob, `${baseName}.xlsx`);
			statusMsg = '';
			toast.success('Excel terunduh.');
		} catch (e: any) {
			statusMsg = '';
			toast.error(e?.message || 'Gagal membuat Excel.');
		} finally {
			busy = null;
		}
	}

	async function doCsv() {
		if (busy) return;
		busy = 'csv';
		statusMsg = '';
		try {
			const { rows, sec } = await loadRows();
			finishFile(buildCsvBlob(rows, sec.columns), `${baseName}.csv`);
			statusMsg = '';
			toast.success('CSV terunduh.');
		} catch (e: any) {
			statusMsg = '';
			toast.error(e?.message || 'Gagal membuat CSV.');
		} finally {
			busy = null;
		}
	}

	async function doPdf() {
		if (busy) return;
		busy = 'pdf';
		statusMsg = '';
		try {
			const { rows, sec } = await loadRows();
			const payload = {
				projectId: pid,
				section: sec.key,
				title: `${sec.label} — ${projectName || `Proyek #${pid}`}`,
				columns: sec.columns.map((c) => ({ header: c.header, key: c.key })),
				rows
			};

			if (!navigator.onLine) {
				await enqueuePdfExport({
					client_txn_id: `pdf-${sec.key}-${pid}-${Date.now()}`,
					requestedAt: new Date().toISOString(),
					...payload
				});
				statusMsg = '';
				toast.info('Menunggu koneksi — PDF akan siap otomatis saat online.');
				busy = null;
				return;
			}

			statusMsg = 'Membuat PDF di server…';
			const user = auth?.currentUser;
			if (!user) throw new Error('Sesi tidak ditemukan. Login ulang.');
			const token = await user.getIdToken();
			const res = await fetch('/api/export/project', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify(payload)
			});
			if (!res.ok) {
				const msg = await res.text().catch(() => '');
				throw new Error(msg || `Gagal membuat PDF (${res.status}).`);
			}
			finishFile(await res.blob(), `${baseName}.pdf`);
			statusMsg = '';
			toast.success('PDF terunduh.');
		} catch (e: any) {
			statusMsg = '';
			toast.error(e?.message || 'Gagal membuat PDF.');
		} finally {
			busy = null;
		}
	}
</script>

<div
	class="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-sm"
	role="button"
	tabindex="-1"
	onclick={(e) => e.target === e.currentTarget && onClose()}
	onkeydown={(e) => e.key === 'Escape' && onClose()}
>
	<div class="w-full max-w-md rounded-t-3xl bg-white p-4 pb-6 shadow-2xl" style="max-height: 85vh; overflow-y: auto">
		<div class="mx-auto mb-3 h-1 w-10 rounded-full bg-gray-300"></div>

		<div class="mb-1 flex items-center justify-between">
			<h3 class="text-[15px] font-bold text-gray-900">Export Data Proyek</h3>
			<button class="rounded-lg p-1 text-gray-400 hover:bg-gray-100" onclick={onClose} aria-label="Tutup">
				<IconX size={18} />
			</button>
		</div>
		<p class="mb-3 text-[11px] leading-snug text-gray-500">
			Excel &amp; CSV dibuat di HP Anda (bisa offline). PDF dibuat di server — kalau sinyal hilang,
			permintaan diantre dan terunduh otomatis saat online. Data harga/biaya tidak disertakan.
		</p>

		{#if arsip}
			<p class="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
				📦 Proyek <b>Closed</b> — file diberi awalan <code>ARSIP_</code>, angkanya data historis.
			</p>
		{/if}

		<!-- Pilih jenis data -->
		<div class="mb-3 grid grid-cols-2 gap-1.5">
			{#each sections as s (s.key)}
				<button
					class="rounded-xl border px-2.5 py-2 text-left text-[12px] font-semibold transition-colors {selectedKey ===
					s.key
						? 'border-[var(--g)] bg-[var(--gl,#eef2ff)] text-[var(--gd,#3730a3)]'
						: 'border-gray-200 text-gray-600 hover:bg-gray-50'}"
					onclick={() => (selectedKey = s.key)}
				>
					{s.label}
					{#if s.supportsDateRange}
						<span class="block text-[10px] font-normal text-gray-400">bisa pakai rentang tanggal</span>
					{/if}
				</button>
			{/each}
		</div>

		<!-- Rentang tanggal -->
		{#if selected?.supportsDateRange}
			<div class="mb-3 flex items-center gap-2 text-[12px]">
				<input type="date" bind:value={dateFrom} class="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-1.5" />
				<span class="text-gray-400">s/d</span>
				<input type="date" bind:value={dateTo} class="min-w-0 flex-1 rounded-lg border border-gray-200 px-2 py-1.5" />
			</div>
		{/if}

		{#if statusMsg}
			<p class="mb-2 flex items-center gap-1.5 text-[11px] text-gray-500">
				<IconLoader2 size={13} class="animate-spin" /> {statusMsg}
			</p>
		{/if}

		<!-- Aksi -->
		<div class="grid grid-cols-3 gap-2">
			<button
				class="flex flex-col items-center gap-1 rounded-xl bg-emerald-600 px-2 py-3 text-[11px] font-bold text-white disabled:opacity-40"
				disabled={busy !== null || !selected?.formats.includes('xlsx')}
				onclick={doExcel}
			>
				{#if busy === 'xlsx'}<IconLoader2 size={18} class="animate-spin" />{:else}<IconFileSpreadsheet size={18} />{/if}
				Excel
			</button>
			<button
				class="flex flex-col items-center gap-1 rounded-xl bg-slate-700 px-2 py-3 text-[11px] font-bold text-white disabled:opacity-40"
				disabled={busy !== null || !selected?.formats.includes('csv')}
				onclick={doCsv}
			>
				{#if busy === 'csv'}<IconLoader2 size={18} class="animate-spin" />{:else}<IconFileText size={18} />{/if}
				CSV
			</button>
			<button
				class="flex flex-col items-center gap-1 rounded-xl bg-rose-600 px-2 py-3 text-[11px] font-bold text-white disabled:opacity-40"
				disabled={busy !== null || !selected?.formats.includes('pdf')}
				onclick={doPdf}
			>
				{#if busy === 'pdf'}<IconLoader2 size={18} class="animate-spin" />
				{:else if !online}<IconWifiOff size={18} />
				{:else}<IconFileTypePdf size={18} />{/if}
				PDF
			</button>
		</div>
		{#if !online}
			<p class="mt-2 text-center text-[10px] text-rose-500">
				Sedang offline — PDF akan diantre &amp; dikirim otomatis saat koneksi kembali.
			</p>
		{/if}

		{#if lastFile && canShare}
			<button
				class="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 px-3 py-2.5 text-[12px] font-bold text-gray-700 hover:bg-gray-50"
				onclick={shareLast}
			>
				<IconShare2 size={15} /> Bagikan "{lastFile.name}"
			</button>
		{/if}
	</div>
</div>
