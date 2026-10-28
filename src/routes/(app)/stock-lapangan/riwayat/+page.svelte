<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getRiwayat, type StockTransactionRow } from '$lib/services/stockLapangan';
	import { IconArrowLeft, IconLoader2, IconHistory, IconShare } from '@tabler/icons-svelte';

	let canAccess = $derived(
		hasPermission($authStore.roleId, 'input_stock_lapangan', $rolesStore) ||
		hasPermission($authStore.roleId, 'view_stock_lapangan', $rolesStore)
	);

	$effect(() => {
		const checked = $authStore.checked;
		if (checked && !canAccess) goto('/');
	});

	let loading = $state(true);
	let rows = $state<StockTransactionRow[]>([]);

	onMount(async () => {
		rows = await getRiwayat();
		loading = false;
	});

	const CATEGORY_LABELS: Record<string, string> = {
		FIELD_RECEIPT: 'Barang Masuk',
		PRODUCTION_OUTPUT: 'Hasil Produksi',
		OPNAME_ADJ: 'Opname'
	};

	function formatDate(iso: string) {
		if (!iso) return '-';
		const d = new Date(iso);
		return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
	}

	function formatOleh(source: string) {
		return source?.replace('field:', '') || '-';
	}

	const STATUS_LABELS: Record<string, string> = {
		pending: 'Menunggu Verifikasi',
		verified: 'Terverifikasi',
		rejected: 'Ditolak',
		revised: 'Diperbaiki'
	};

	const STATUS_COLORS: Record<string, string> = {
		pending: 'background:var(--aml);color:var(--amd)',
		verified: 'background:var(--gg);color:var(--ggd)',
		rejected: 'background:var(--rel);color:var(--red)',
		revised: 'background:#DBEAFE;color:#1E40AF'
	};

	// Fase 5 "Export Inventory & Maintenance v2" §5 — CSV ringan (BUKAN Excel:
	// file .xlsx sering tak bisa dibuka di HP tanpa aplikasi tambahan). Sengaja
	// TIDAK memakai util export bersama (exportCsv.ts) yang sedang dibangun di
	// branch lapangan lain (feat/export-maintenance-v2-field, plan berbeda) --
	// menyalin path yang sama sekarang cuma akan jadi konflik merge nanti.
	// Halaman ini kecil & satu-satunya pemakai, jadi CSV dirakit inline.
	let exporting = $state(false);

	function toCsvValue(v: string | number | null | undefined): string {
		const s = v == null ? '' : String(v);
		return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	}

	function buildCsv(): string {
		const headers = ['Tanggal', 'Item', 'Tipe', 'Kategori', 'Qty', 'Oleh', 'Ref No', 'Status'];
		const lines = [headers.join(',')];
		for (const row of rows) {
			lines.push(
				[
					toCsvValue(formatDate(row.transactionDate)),
					toCsvValue(row.itemName),
					toCsvValue(row.transactionType === 'OUT' ? 'Keluar' : 'Masuk'),
					toCsvValue(CATEGORY_LABELS[row.categoryTransaction] || row.categoryTransaction),
					toCsvValue(row.quantity),
					toCsvValue(formatOleh(row.source)),
					toCsvValue(row.referenceNo),
					toCsvValue(STATUS_LABELS[row.verificationStatus] || row.verificationStatus)
				].join(',')
			);
		}
		return lines.join('\n');
	}

	// F1 (rekomendasi lapangan rencana): Web Share API dulu -- di Android "unduh"
	// masuk folder Downloads dan gampang hilang; share sheet langsung ke WA lebih
	// natural. Fallback ke unduhan blob biasa kalau browser tak dukung Web Share
	// file (mis. sebagian besar desktop).
	async function exportRiwayat() {
		if (exporting || rows.length === 0) return;
		exporting = true;
		try {
			const csv = buildCsv();
			const filename = `riwayat-stock-lapangan-${new Date().toISOString().slice(0, 10)}.csv`;
			const file = new File([csv], filename, { type: 'text/csv;charset=utf-8;' });

			if (navigator.canShare && navigator.canShare({ files: [file] })) {
				await navigator.share({ files: [file], title: 'Riwayat Stock Lapangan' });
				return;
			}

			const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			a.click();
			URL.revokeObjectURL(url);
		} catch (e: any) {
			// AbortError = user membatalkan share sheet -- bukan kegagalan sungguhan.
			if (e?.name !== 'AbortError') console.error('Gagal export riwayat stock lapangan:', e);
		} finally {
			exporting = false;
		}
	}
</script>

<div class="max-w-3xl mx-auto p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/stock-lapangan')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	<div class="flex items-center justify-between gap-2 mb-4">
		<h1 class="text-[16px] font-bold flex items-center gap-2" style="color: var(--sys-label)">
			<IconHistory size={18} /> Riwayat Stock Lapangan
		</h1>
		<button
			type="button"
			class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-semibold border disabled:opacity-50"
			style="border-color: var(--sys-sep); color: var(--sys-label2)"
			disabled={exporting || loading || rows.length === 0}
			onclick={exportRiwayat}
			title="Bagikan atau unduh riwayat sebagai CSV — untuk rekonsiliasi dengan gudang pusat"
		>
			{#if exporting}
				<IconLoader2 size={14} class="animate-spin" />
			{:else}
				<IconShare size={14} />
			{/if}
			<span>Export CSV</span>
		</button>
	</div>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat riwayat transaksi..." />
		</div>
	{:else}
		<div class="bg-white rounded-xl border overflow-hidden" style="border-color: var(--sys-sep)">
			<table class="w-full text-left border-collapse text-[12px]">
				<thead>
					<tr class="bg-gray-50 border-b text-gray-400 font-semibold uppercase tracking-wider text-[10px]" style="border-color: var(--sys-sep)">
						<th class="p-3">Tanggal</th>
						<th class="p-3">Item</th>
						<th class="p-3">Tipe</th>
						<th class="p-3 text-center">Qty</th>
						<th class="p-3">Oleh</th>
						<th class="p-3">Ref No</th>
						<th class="p-3">Status</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-50">
					{#if rows.length === 0}
						<tr><td colspan="7" class="p-6 text-center text-gray-400 italic">Belum ada transaksi dari modul lapangan.</td></tr>
					{:else}
						{#each rows as row (row.id)}
							<tr class="hover:bg-gray-50/50 transition-colors">
								<td class="p-3 whitespace-nowrap" style="color: var(--sys-label3)">{formatDate(row.transactionDate)}</td>
								<td class="p-3 font-medium" style="color: var(--sys-label)">{row.itemName}</td>
								<td class="p-3">{CATEGORY_LABELS[row.categoryTransaction] || row.categoryTransaction}</td>
								<td class="p-3 text-center font-semibold" style="color: {row.transactionType === 'OUT' ? '#DC2626' : '#16A34A'}">
									{row.transactionType === 'OUT' ? '-' : '+'}{row.quantity}
								</td>
								<td class="p-3" style="color: var(--sys-label3)">{formatOleh(row.source)}</td>
								<td class="p-3" style="color: var(--sys-label3)">{row.referenceNo}</td>
								<td class="p-3">
									<span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold" style={STATUS_COLORS[row.verificationStatus]}>
										{STATUS_LABELS[row.verificationStatus] || row.verificationStatus}
									</span>
									{#if row.verificationStatus === 'rejected' && row.rejectReason}
										<div class="text-[10px] mt-0.5" style="color: var(--sys-label4)">{row.rejectReason}</div>
									{/if}
								</td>
							</tr>
						{/each}
					{/if}
				</tbody>
			</table>
		</div>
	{/if}
</div>
