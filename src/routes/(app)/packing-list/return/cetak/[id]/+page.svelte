<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// 4-Gate System "Surat Jalan Pengembalian & Kontrol Aset Proyek" — Rencana v2, Fase 2.2.
	// Halaman cetak dokumen retur + QR besar. Sopir membawa lembar ini; satpam & gudang
	// memindai QR (EPI:RTN:<id>:<token>). Tanpa dokumen, barang masuk area karantina.
	//
	// Aturan #5: tidak ada window.open() di sini — ini route tersendiri, tombol Cetak cukup
	// window.print() sinkron (data sudah dimuat saat onMount). Tidak ada await sebelum print.
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import QRCode from 'qrcode';
	import { getIdToken } from '$lib/services/secureDirectus';
	import { IconArrowLeft, IconPrinter, IconLoader2 } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let doc = $state<any>(null);
	let qrDataUrl = $state('');

	const id = $derived($page.params.id);

	function fmtDate(d: string | null) {
		return d ? new Date(d).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-';
	}
	const CONDITION_LABEL: Record<string, string> = {
		ok: 'OK / Layak Pakai',
		bekas_layak: 'Bekas Layak',
		rusak: 'Rusak',
		hilang: 'Hilang'
	};

	onMount(async () => {
		try {
			const token = await getIdToken();
			const res = await fetch(`/api/retur-gudang?id=${encodeURIComponent(id)}`, {
				headers: { Authorization: `Bearer ${token}` }
			});
			const text = await res.text();
			let parsed: any = null;
			try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
			if (!res.ok) throw new Error(parsed?.message || `Gagal memuat dokumen (${res.status})`);
			doc = parsed?.data;
			if (doc?.qr_token) {
				qrDataUrl = await QRCode.toDataURL(`EPI:RTN:${doc.id}:${doc.qr_token}`, {
					width: 320,
					margin: 1,
					errorCorrectionLevel: 'M'
				});
			}
		} catch (e: any) {
			errorMsg = e?.message || String(e);
		} finally {
			loading = false;
		}
	});

	function doPrint() {
		window.print();
	}
</script>

<svelte:head><title>Dokumen Retur {doc?.nomor_retur ?? ''}</title></svelte:head>

<div class="mx-auto w-full max-w-2xl p-4">
	<div class="no-print mb-4 flex items-center justify-between gap-2">
		<button
			type="button"
			class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900"
			onclick={() => goto('/packing-list')}
		>
			<IconArrowLeft size={15} /> Kembali ke Packing List
		</button>
		{#if doc && !errorMsg}
			<button
				type="button"
				class="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
				onclick={doPrint}
			>
				<IconPrinter size={15} /> Cetak
			</button>
		{/if}
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat dokumen retur..." />
		</div>
	{:else if errorMsg}
		<div class="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{errorMsg}</div>
	{:else if doc}
		<div class="no-print mb-3 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-[11px] text-amber-800">
			Cetak &amp; titipkan ke sopir. Satpam dan gudang akan memindai QR ini. Tanpa dokumen, barang masuk area karantina.
		</div>

		<div class="print-sheet rounded-xl border border-slate-300 bg-white p-6">
			<div class="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
				<div>
					<h1 class="text-lg font-bold tracking-tight text-slate-800">DOKUMEN RETUR GUDANG</h1>
					<p class="mt-0.5 text-2xl font-bold text-emerald-700">{doc.nomor_retur}</p>
					<p class="mt-1 text-xs text-slate-500">
						Status: <span class="font-semibold uppercase">{doc.status}</span>
						{#if doc.sumber === 'karantina'} · <span class="text-amber-600">KARANTINA</span>{/if}
					</p>
				</div>
				{#if qrDataUrl}
					<img src={qrDataUrl} alt="QR dokumen retur" class="h-32 w-32 shrink-0" />
				{/if}
			</div>

			<div class="grid grid-cols-2 gap-x-6 gap-y-2 py-4 text-xs">
				<div><span class="text-slate-400">Proyek</span><br /><span class="font-medium text-slate-700">{doc.project_name || `#${doc.project_id}`}</span></div>
				<div><span class="text-slate-400">Dibuat</span><br /><span class="font-medium text-slate-700">{fmtDate(doc.date_created)}</span></div>
				<div><span class="text-slate-400">Sopir</span><br /><span class="font-medium text-slate-700">{doc.driver_name || '-'}{doc.driver_phone ? ` · ${doc.driver_phone}` : ''}</span></div>
				<div><span class="text-slate-400">Kendaraan / Ekspedisi</span><br /><span class="font-medium text-slate-700">{doc.vehicle_plate || doc.expedition_name || '-'}</span></div>
			</div>

			<table class="w-full border-collapse text-xs">
				<thead>
					<tr class="border-y border-slate-300 text-left text-slate-500">
						<th class="py-1.5 pr-2 font-semibold">#</th>
						<th class="py-1.5 pr-2 font-semibold">Barang</th>
						<th class="py-1.5 pr-2 text-right font-semibold">Qty</th>
						<th class="py-1.5 pr-2 font-semibold">Satuan</th>
						<th class="py-1.5 font-semibold">Kondisi (deklarasi)</th>
					</tr>
				</thead>
				<tbody>
					{#each doc.items || [] as it, i}
						<tr class="border-b border-slate-100">
							<td class="py-1.5 pr-2 text-slate-400">{i + 1}</td>
							<td class="py-1.5 pr-2 text-slate-700">
								{it.material_name}{it.material_color ? ` (${it.material_color})` : ''}
								{#if !it.item_id}<span class="text-amber-600"> · tanpa item master</span>{/if}
							</td>
							<td class="py-1.5 pr-2 text-right font-medium text-slate-700">{it.qty_returned ?? 0}</td>
							<td class="py-1.5 pr-2 text-slate-600">{it.unit || '-'}</td>
							<td class="py-1.5 text-slate-600">{CONDITION_LABEL[it.condition] || it.condition || '-'}</td>
						</tr>
					{/each}
					{#if (doc.items || []).length === 0}
						<tr><td colspan="5" class="py-3 text-center text-slate-400">Belum ada baris barang.</td></tr>
					{/if}
				</tbody>
			</table>

			<div class="mt-6 grid grid-cols-3 gap-4 text-[11px] text-slate-500">
				<div>
					<p class="mb-10">Diserahkan (Leader)</p>
					<p class="border-t border-slate-300 pt-1">Nama &amp; tanda tangan</p>
				</div>
				<div>
					<p class="mb-10">Diperiksa (Satpam)</p>
					<p class="border-t border-slate-300 pt-1">Nama &amp; tanda tangan</p>
				</div>
				<div>
					<p class="mb-10">Diterima (Gudang)</p>
					<p class="border-t border-slate-300 pt-1">Nama &amp; tanda tangan</p>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	@media print {
		.no-print { display: none !important; }
		.print-sheet { border: none !important; padding: 0 !important; }
		:global(body) { background: #fff !important; }
	}
</style>
