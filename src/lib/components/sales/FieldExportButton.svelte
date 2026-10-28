<script lang="ts">
	// FieldExportButton — tombol export ringkas untuk dashboard lapangan.
	// (Export & PDF Modul Sales v2 — Fase 6 §9.2 / rekomendasi B1.)
	// CSV tanpa dependency + Quick Share WA (navigator.share) → fallback unduhan.
	// TIDAK PERNAH menyertakan kolom harga/margin — pemanggil menyiapkan `rows`
	// yang sudah bersih; komponen ini tidak mengambil data apa pun.
	import { IconFileExport, IconShare2, IconLoader2, IconFileTypePdf } from '@tabler/icons-svelte';
	import { toCsv, shareOrDownloadCsv, downloadCsv } from '$lib/utils/csvExport';
	import { getIdToken } from '$lib/services/secureDirectus';

	let {
		rows = [] as Array<Record<string, unknown>>,
		columns = undefined as Array<string | [string, string]> | undefined,
		filename = 'data-sales',
		title = 'Data Sales',
		label = 'Export',
		disabled = false,
		offlineNote = '',
		/** Tampilkan tombol PDF (lewat Gotenberg server). Otomatis fallback ke CSV bila 503. */
		enablePdf = true,
		pdfSubtitle = ''
	} = $props();

	let busy = $state(false);
	let note = $state('');

	/** Kolom & baris datar untuk endpoint PDF (header dari `columns` atau kunci baris). */
	function flatForPdf(): { cols: string[]; body: Array<Array<string | number>> } {
		const cols: Array<[string, string]> = (columns && columns.length
			? columns
			: Object.keys(rows[0] ?? {})
		).map((c) => (Array.isArray(c) ? c : [c, c]));
		return {
			cols: cols.map(([, h]) => h),
			body: rows.map((r) => cols.map(([k]) => (r?.[k] as string | number) ?? ''))
		};
	}

	async function run(share: boolean) {
		if (busy) return;
		if (!rows || rows.length === 0) {
			note = 'Tidak ada data untuk diekspor.';
			return;
		}
		busy = true;
		note = '';
		try {
			const csv = toCsv(rows, columns);
			const fname = `${filename}-${new Date().toISOString().slice(0, 10)}`;
			if (share) {
				const how = await shareOrDownloadCsv(csv, fname, title);
				note = how === 'shared' ? 'Dibagikan.' : 'Berkas diunduh.';
			} else {
				downloadCsv(csv, fname);
				note = `Berkas CSV (${rows.length} baris) diunduh.`;
			}
		} catch (e) {
			note = 'Gagal membuat berkas: ' + ((e as Error)?.message ?? e);
		} finally {
			busy = false;
			if (note && !note.startsWith('Gagal')) setTimeout(() => (note = ''), 5000);
		}
	}

	async function runPdf() {
		if (busy) return;
		if (!rows || rows.length === 0) {
			note = 'Tidak ada data untuk diekspor.';
			return;
		}
		busy = true;
		note = 'Menyiapkan PDF…';
		try {
			const { cols, body } = flatForPdf();
			const token = await getIdToken();
			const res = await fetch('/api/sales/field-report/pdf', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({ title, subtitle: pdfSubtitle, columns: cols, rows: body })
			});
			if (res.status === 503) {
				note = 'PDF sedang tidak tersedia — unduh CSV sebagai gantinya.';
				return;
			}
			if (!res.ok) {
				const j = await res.json().catch(() => ({}));
				throw new Error(j?.error || `HTTP ${res.status}`);
			}
			const blob = await res.blob();
			const fname = `${filename}-${new Date().toISOString().slice(0, 10)}.pdf`;
			const file = new File([blob], fname, { type: 'application/pdf' });
			const nav = navigator as Navigator & { canShare?: (d?: { files?: File[] }) => boolean };
			if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
				try {
					await nav.share({ files: [file], title });
					note = 'PDF dibagikan.';
					return;
				} catch {
					/* dibatalkan → unduh */
				}
			}
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = fname;
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			setTimeout(() => URL.revokeObjectURL(url), 1000);
			note = 'PDF diunduh.';
		} catch (e) {
			note = 'Gagal membuat PDF: ' + ((e as Error)?.message ?? e);
		} finally {
			busy = false;
			if (note && !note.startsWith('Gagal')) setTimeout(() => (note = ''), 6000);
		}
	}
</script>

<div class="feb">
	<div class="feb__row">
		<button type="button" class="feb__btn" disabled={disabled || busy} onclick={() => run(false)}>
			{#if busy}<IconLoader2 size={15} class="feb__spin" />{:else}<IconFileExport size={15} />{/if}
			<span>{label}</span>
		</button>
		{#if enablePdf}
			<button
				type="button"
				class="feb__btn feb__btn--ghost"
				disabled={disabled || busy}
				title="Unduh PDF (lewat server; otomatis pakai CSV bila tak tersedia)"
				onclick={runPdf}
			>
				<IconFileTypePdf size={15} />
			</button>
		{/if}
		<button
			type="button"
			class="feb__btn feb__btn--ghost"
			disabled={disabled || busy}
			title="Bagikan berkas (mis. lewat WhatsApp)"
			onclick={() => run(true)}
		>
			<IconShare2 size={15} />
		</button>
	</div>
	{#if offlineNote}<p class="feb__hint">{offlineNote}</p>{/if}
	{#if note}<p class="feb__note">{note}</p>{/if}
</div>

<style>
	.feb { display: inline-block; font-size: 13px; }
	.feb__row { display: inline-flex; gap: 6px; align-items: center; }
	.feb__btn {
		display: inline-flex; align-items: center; gap: 6px;
		padding: 7px 12px; border-radius: 9px; font-weight: 600; cursor: pointer;
		background: var(--color-primary, #2563eb); color: #fff; border: none; white-space: nowrap;
	}
	.feb__btn--ghost { padding: 7px 9px; background: #eef2ff; color: var(--color-primary, #2563eb); }
	.feb__btn:disabled { opacity: .55; cursor: not-allowed; }
	:global(.feb__spin) { animation: feb-spin .7s linear infinite; }
	@keyframes feb-spin { to { transform: rotate(360deg); } }
	.feb__hint { margin: 5px 0 0; font-size: 11px; color: #64748b; }
	.feb__note { margin: 5px 0 0; font-size: 12px; color: #1e40af; }
</style>
