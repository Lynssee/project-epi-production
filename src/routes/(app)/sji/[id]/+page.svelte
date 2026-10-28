<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { fetchSjiDetail, cancelSji, fetchSjiDokumen, type SjiDokumen } from '$lib/services/sjiApi';
	import QRCode from 'qrcode';
	import { IconArrowLeft, IconLoader2, IconAlertTriangle, IconX, IconFileCheck } from '@tabler/icons-svelte';

	const STATUS_LABEL: Record<string, string> = {
		diajukan: 'Menunggu Persetujuan',
		disetujui: 'Disetujui',
		ditolak: 'Ditolak',
		diserahkan: 'Diserahkan',
		dipinjam: 'Sedang Dipinjam',
		dikembalikan: 'Dikembalikan',
		overdue: 'Terlambat Kembali',
		sebagian_diserahkan: 'Sebagian Diserahkan',
		selesai: 'Selesai',
		dibatalkan: 'Dibatalkan'
	};

	let id = $derived(Number($page.params.id));
	let header = $state<any>(null);
	let items = $state<any[]>([]);
	let loading = $state(true);
	let errorMsg = $state('');
	let cancelling = $state(false);

	let dokumen = $state<SjiDokumen | null>(null);
	let dokumenLoading = $state(false);
	let dokumenError = $state('');
	let qrDataUrl = $state('');
	// qrPayload berformat "EPI:SJI:<id>:<rawToken>" — token mentah diambil untuk jalur
	// pengambilan mandiri (tanpa perlu benar-benar scan QR, karena tak ada petugas yang scan).
	let dokumenToken = $derived(dokumen?.qrPayload?.split(':')[3] || '');

	onMount(load);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const res = await fetchSjiDetail(id);
			header = res.header;
			items = res.items;
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat detail SJI.';
		} finally {
			loading = false;
		}
	}

	async function loadDokumen() {
		dokumenLoading = true;
		dokumenError = '';
		try {
			dokumen = await fetchSjiDokumen(id);
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
		if (!confirm('Batalkan pengajuan SJI ini?')) return;
		cancelling = true;
		try {
			await cancelSji(id);
			await load();
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal membatalkan SJI.';
		} finally {
			cancelling = false;
		}
	}
</script>

<div class="w-full p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/sji')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat rincian surat jalan internal..." />
		</div>
	{:else if errorMsg}
		<div class="p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-red-700 text-[12px]">
			<IconAlertTriangle size={18} class="shrink-0 mt-0.5 text-red-500" />
			<div>{errorMsg}</div>
		</div>
	{:else if header}
		<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">{header.reference_no}</h1>
		<p class="text-[11px] mb-4" style="color: var(--sys-label3)">
			{STATUS_LABEL[header.status] || header.status} · {header.gudang_id?.nama_gudang || '-'}
		</p>

		{#if header.keperluan}
			<div class="p-3 rounded-lg border mb-4 text-[12px]" style="border-color: var(--sys-sep); color: var(--sys-label)">
				{header.keperluan}
			</div>
		{/if}

		{#if header.status === 'disetujui' || header.status === 'sebagian_diserahkan'}
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
						<p class="text-[11px] mt-2" style="color: var(--red)">{dokumenError}</p>
					{/if}
				{:else if dokumen.available}
					<div class="text-center">
						<p class="text-[12px] font-bold" style="color: var(--sys-label)">e-SURAT JALAN INTERNAL</p>
						<p class="text-[11px] mb-3" style="color: var(--sys-label3)">{dokumen.reference_no} · disetujui oleh {dokumen.approver || '-'}</p>
						{#if qrDataUrl}
							<img src={qrDataUrl} alt="QR e-Surat Jalan" class="mx-auto rounded-lg" width="220" height="220" />
						{/if}
						<p class="text-[10px] mt-3" style="color: var(--sys-label4)">
							Tunjukkan QR ini ke petugas gudang di {dokumen.gudang} untuk serah-terima.
							QR ini berlaku 30 menit — buka ulang halaman dalam waktu itu tidak mengubah QR.
						</p>
					</div>

					{#if dokumenToken}
						<div class="mt-4 pt-4 border-t" style="border-color: var(--sys-sep)">
							<p class="text-[11px] mb-2" style="color: var(--sys-label3)">
								Tidak ada petugas gudang di tempat? Ambil barang sendiri — wajib ada saksi & foto tiap barang.
							</p>
							<button
								class="w-full h-11 rounded-xl text-[13px] font-bold border flex items-center justify-center gap-2"
								style="border-color: var(--sys-sep); color: var(--sys-label)"
								onclick={() => goto(`/sji/konfirmasi?id=${id}&token=${encodeURIComponent(dokumenToken)}&mode=mandiri`)}
							>
								Ambil Sendiri (Tanpa Petugas Gudang)
							</button>
						</div>
					{/if}
				{:else}
					<p class="text-[12px]" style="color: var(--sys-label3)">e-Surat Jalan belum tersedia (status: {dokumen.status}).</p>
				{/if}
			</div>
		{/if}

		<p class="text-[12px] font-semibold mb-2" style="color: var(--sys-label)">Item ({items.length})</p>
		<div class="flex flex-col gap-2 mb-5">
			{#each items as it (it.collection + '-' + it.id)}
				<div class="p-3 rounded-lg border" style="border-color: var(--sys-sep)">
					<div class="flex items-start justify-between gap-2">
						<div class="text-[13px] font-medium" style="color: var(--sys-label)">
							{it.item_id?.nama_barang_lengkap || '-'}
						</div>
						<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 shrink-0">
							{STATUS_LABEL[it.status] || it.status}
						</span>
					</div>
					<div class="text-[11px]" style="color: var(--sys-label3)">
						{it.tipe === 'pinjam' ? 'Pinjam' : 'Ambil Pakai'} · Qty {it.quantity}
						{#if it.tipe === 'pinjam' && it.tanggal_jatuh_tempo}
							· Jatuh tempo {it.tanggal_jatuh_tempo}
						{/if}
					</div>
					{#if it.catatan}
						<p class="text-[10px] mt-1 text-amber-600">{it.catatan}</p>
					{/if}
					{#if it.tipe === 'pinjam' && (it.status === 'dipinjam' || it.status === 'overdue')}
						<button
							class="mt-2 w-full h-9 rounded-lg text-[12px] font-semibold text-white"
							style="background: var(--p, var(--g))"
							onclick={() => goto(`/sji/peminjaman/${it.id}/kembali`)}
						>
							Kembalikan Barang Ini
						</button>
					{/if}
				</div>
			{/each}
		</div>

		{#if header.status === 'diajukan'}
			<button
				class="w-full h-11 rounded-xl text-[13px] font-bold text-red-600 border border-red-200 bg-red-50 flex items-center justify-center gap-2 disabled:opacity-40"
				disabled={cancelling}
				onclick={handleCancel}
			>
				{#if cancelling}<IconLoader2 size={16} class="animate-spin" />{:else}<IconX size={16} />{/if}
				Batalkan Pengajuan
			</button>
		{/if}
	{/if}
</div>
