<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { fetchSjManualDetail, cancelSjManual, fetchSjManualDokumen } from '$lib/services/sjManualApi';
	import QRCode from 'qrcode';
	import { IconArrowLeft, IconLoader2, IconAlertTriangle, IconX, IconFileCheck, IconEdit } from '@tabler/icons-svelte';

	const STATUS_LABEL: Record<string, string> = {
		tidak_perlu: 'Tidak Perlu Approval',
		menunggu: 'Menunggu Persetujuan',
		disetujui: 'Disetujui',
		ditolak: 'Ditolak'
	};
	const STATUS_COLOR: Record<string, string> = {
		tidak_perlu: 'bg-slate-100 text-slate-600',
		menunggu: 'bg-amber-100 text-amber-800',
		disetujui: 'bg-emerald-100 text-emerald-800',
		ditolak: 'bg-red-100 text-red-800'
	};

	let id = $derived(Number($page.params.id));
	let header = $state<any>(null);
	let items = $state<any[]>([]);
	let actions = $state<any[]>([]);
	let loading = $state(true);
	let errorMsg = $state('');
	let cancelling = $state(false);

	let dokumen = $state<any>(null);
	let dokumenLoading = $state(false);
	let dokumenError = $state('');
	let qrDataUrl = $state('');

	onMount(load);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const res = await fetchSjManualDetail(id);
			header = res.header;
			items = res.items;
			actions = res.actions;
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat detail SJ Manual.';
		} finally {
			loading = false;
		}
	}

	async function loadDokumen() {
		dokumenLoading = true;
		dokumenError = '';
		try {
			dokumen = await fetchSjManualDokumen(id);
			if (dokumen.available && dokumen.qrPayload) {
				qrDataUrl = await QRCode.toDataURL(dokumen.qrPayload, { width: 220, margin: 1 });
			}
		} catch (e: any) {
			dokumenError = e?.message || 'Gagal memuat e-Surat Jalan.';
		} finally {
			dokumenLoading = false;
		}
	}

	async function handleCancel() {
		if (!confirm('Batalkan pengajuan SJ Manual ini?')) return;
		cancelling = true;
		try {
			await cancelSjManual(id);
			await load();
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal membatalkan SJ Manual.';
		} finally {
			cancelling = false;
		}
	}
</script>

<div class="w-full p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/sj-manual')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat rincian surat jalan manual..." />
		</div>
	{:else if errorMsg}
		<div class="p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-red-700 text-[12px]">
			<IconAlertTriangle size={18} class="shrink-0 mt-0.5 text-red-500" />
			<div>{errorMsg}</div>
		</div>
	{:else if header}
		<div class="flex items-center gap-2 mb-1">
			<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">{header.nomor_sj}</h1>
			<span class="text-[10px] font-bold px-2 py-1 rounded-full {STATUS_COLOR[header.approval_status] || 'bg-slate-100 text-slate-600'}">
				{STATUS_LABEL[header.approval_status] || header.approval_status}
			</span>
		</div>
		<p class="text-[11px] mb-4" style="color: var(--sys-label3)">
			{header.manual_customer_name || '-'} · {header.manual_customer_address || '-'}
		</p>

		{#if header.manual_notes}
			<div class="p-3 rounded-lg border mb-4 text-[12px]" style="border-color: var(--sys-sep); color: var(--sys-label)">
				{header.manual_notes}
			</div>
		{/if}

		{#if header.approval_status === 'disetujui'}
			<div class="p-4 rounded-xl border mb-5" style="border-color: var(--sys-sep); background: var(--sys-fill)">
				{#if !dokumen}
					<button
						class="w-full h-11 rounded-xl text-[13px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
						style="background: var(--p, var(--g))"
						disabled={dokumenLoading}
						onclick={loadDokumen}
					>
						{#if dokumenLoading}<IconLoader2 size={16} class="animate-spin" />{:else}<IconFileCheck size={16} />{/if}
						Lihat e-Surat Jalan
					</button>
					{#if dokumenError}
						<p class="text-[11px] mt-2" style="color: var(--red, #dc2626)">{dokumenError}</p>
					{/if}
				{:else if dokumen.available}
					<div class="flex flex-col items-center gap-2">
						{#if qrDataUrl}
							<img src={qrDataUrl} alt="QR e-Surat Jalan" class="w-44 h-44" />
						{/if}
						<p class="text-[11px] text-center" style="color: var(--sys-label3)">
							Tunjukkan QR ini ke satpam/gudang saat barang keluar/masuk.
						</p>
					</div>
				{:else}
					<p class="text-[12px] text-center" style="color: var(--sys-label3)">e-Surat Jalan belum tersedia.</p>
				{/if}
			</div>
		{/if}

		{#if header.approval_status === 'ditolak'}
			<div class="p-3 rounded-xl bg-red-50 border border-red-200 mb-5">
				<p class="text-[12px] text-red-700 mb-2">Pengajuan ini ditolak. Perbaiki data lalu ajukan ulang.</p>
				<button
					class="w-full h-11 rounded-xl text-[13px] font-bold text-white flex items-center justify-center gap-2"
					style="background: var(--p, var(--g))"
					onclick={() => goto(`/sj-manual/ajukan?editId=${id}`)}
				>
					<IconEdit size={16} /> Revisi &amp; Ajukan Ulang
				</button>
			</div>
		{/if}

		<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Item ({items.length})</p>
		<div class="flex flex-col gap-2 mb-5">
			{#each items as it, idx (idx)}
				<div class="p-3 rounded-lg border flex items-center justify-between" style="border-color: var(--sys-sep)">
					<div class="text-[12px]" style="color: var(--sys-label)">{it.nama_barang}</div>
					<div class="text-[12px] font-semibold" style="color: var(--sys-label3)">{it.qty} {it.satuan}</div>
				</div>
			{/each}
		</div>

		{#if actions.length > 0}
			<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Riwayat Approval</p>
			<div class="flex flex-col gap-2 mb-5">
				{#each actions as a (a.id)}
					<div class="p-3 rounded-lg border text-[12px]" style="border-color: var(--sys-sep)">
						<span class="font-semibold">{a.action === 'approve' ? 'Disetujui' : a.action === 'reject' ? 'Ditolak' : a.action}</span>
						{#if a.note} — {a.note}{/if}
					</div>
				{/each}
			</div>
		{/if}

		{#if header.approval_status === 'menunggu'}
			<button
				class="w-full h-12 rounded-xl text-[13px] font-bold border flex items-center justify-center gap-2 disabled:opacity-40"
				style="border-color: var(--red, #dc2626); color: var(--red, #dc2626)"
				disabled={cancelling}
				onclick={handleCancel}
			>
				{#if cancelling}<IconLoader2 size={16} class="animate-spin" />{:else}<IconX size={16} />{/if}
				Batalkan Pengajuan
			</button>
		{/if}
	{/if}
</div>
