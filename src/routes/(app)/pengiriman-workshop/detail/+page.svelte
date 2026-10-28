<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		fetchWorkshopDeliveryDetail,
		fetchWorkshopDeliveryProgress,
		STAGE_LABEL,
		STAGE_COLOR,
		type WsDeliveryDetail,
		type WsDeliveryProgressLine,
		type WorkshopKind
	} from '$lib/services/workshopDeliveryApi';
	import { authStore } from '$lib/stores/auth';
	import {
		IconLoader2,
		IconAlertTriangle,
		IconChevronLeft,
		IconBrandWhatsapp,
		IconFileInvoice
	} from '@tabler/icons-svelte';

	const w = ($page.url.searchParams.get('w') || 'ciketing') as WorkshopKind;
	const k = $page.url.searchParams.get('k') || '';

	let detail = $state<WsDeliveryDetail | null>(null);
	let progress = $state<WsDeliveryProgressLine[]>([]);
	let loading = $state(true);
	let errorMsg = $state('');

	const WS_LABEL: Record<string, string> = { ciketing: 'WS Ciketing', balaraja: 'MB Balaraja' };
	const WS_ADMIN_WA: Record<string, string> = {
		// Nomor admin WS untuk "Minta Pengiriman" — sesuaikan bila perlu.
		ciketing: '',
		balaraja: ''
	};

	onMount(load);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			if (!k) throw new Error('Batch tidak dikenal.');
			detail = await fetchWorkshopDeliveryDetail(w, k);
			if (!detail) throw new Error('Pengiriman tidak ditemukan atau bukan proyek Anda.');
			if (detail.batch.project_id) {
				progress = await fetchWorkshopDeliveryProgress(detail.batch.project_id, w);
			}
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat detail.';
		} finally {
			loading = false;
		}
	}

	function fmtRp(n: number) {
		return 'Rp' + Math.round(n || 0).toLocaleString('id-ID');
	}
	function fmtDate(s: string | null) {
		if (!s) return '-';
		return new Date(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
	}
	function pct(a: number, b: number) {
		return b > 0 ? Math.min(100, Math.max(0, Math.round((a / b) * 100))) : 0;
	}

	function mintaPengiriman() {
		const d = detail!;
		const sisa = progress
			.filter((l) => l.sisa_qty > 0)
			.map((l) => `- ${l.nama_barang}: sisa ${l.sisa_qty} ${l.satuan}`)
			.join('\n');
		const nama = $authStore?.karyawanName || 'Project Leader';
		const msg =
			`Halo Admin ${WS_LABEL[w]}, mohon diproses pengiriman berikutnya.\n\n` +
			`Proyek: ${d.batch.project_name}\n` +
			`Ref SJ terakhir: ${d.batch.no_sj}\n` +
			(sisa ? `Sisa PO:\n${sisa}\n` : '') +
			`\nDiminta oleh: ${nama}`;
		const phone = WS_ADMIN_WA[w];
		const url = phone
			? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
			: `https://wa.me/?text=${encodeURIComponent(msg)}`;
		window.open(url, '_blank');
	}
</script>

<div class="w-full p-4 pb-24">
	<button class="flex items-center gap-1 text-[12px] mb-3" style="color: var(--sys-label3)" onclick={() => goto('/pengiriman-workshop')}>
		<IconChevronLeft size={16} /> Kembali
	</button>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat rincian pengiriman..." />
		</div>
	{:else if errorMsg}
		<div class="p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-red-700 text-[12px]">
			<IconAlertTriangle size={18} class="shrink-0 mt-0.5 text-red-500" />
			<div>{errorMsg}</div>
		</div>
	{:else if detail}
		{@const b = detail.batch}
		<div class="mb-4">
			<div class="flex items-center gap-2 flex-wrap">
				<h1 class="text-[15px] font-bold" style="color: var(--sys-label)">{b.no_sj}</h1>
				<span class="text-[9px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{WS_LABEL[w]}</span>
			</div>
			<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">{b.project_name} · {fmtDate(b.tanggal)}</p>
			<span class="inline-block mt-2 text-[10px] font-bold px-2.5 py-1 rounded-full {STAGE_COLOR[b.stage]}">
				{STAGE_LABEL[b.stage]}
			</span>
		</div>

		{#if b.stage === 'ditahan' && b.hold_reason}
			<div class="mb-4 p-3 rounded-xl bg-red-50 border border-red-200 text-[12px] text-red-700">
				<b>Ditahan Finance.</b> {b.hold_reason}
				<div class="text-[11px] mt-1 text-red-600">Hubungi admin WS untuk perbaikan lalu ajukan ulang.</div>
			</div>
		{/if}

		<!-- Item batch -->
		<div class="rounded-xl border mb-4" style="border-color: var(--sys-sep)">
			<div class="px-3 py-2 text-[11px] font-bold" style="color: var(--sys-label3); border-bottom: 1px solid var(--sys-sep)">
				Item ({detail.items.length})
			</div>
			{#each detail.items as it (it.id)}
				<div class="px-3 py-2.5 text-[12px]" style="border-bottom: 1px solid var(--sys-sep)">
					<div class="font-semibold" style="color: var(--sys-label)">{it.nama_barang}</div>
					<div class="text-[11px]" style="color: var(--sys-label3)">
						{it.luasan_m2 > 0 ? `${it.luasan_m2} m²` : `${it.qty} ${it.satuan}`}
						{#if it.total_harga > 0} · {fmtRp(it.total_harga)}{/if}
						{#if it.no_part} · Part {it.no_part}{/if}
					</div>
					{#if it.approval_status !== 'menunggu' && it.approved_by}
						<div class="text-[10px] mt-0.5" style="color: var(--sys-label4)">
							{it.approval_status === 'approved' ? 'Disetujui' : 'Ditahan'} oleh {it.approved_by}
							{#if it.approved_at} · {fmtDate(it.approved_at)}{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>

		<!-- Progres pengiriman parsial -->
		{#if progress.length > 0}
			<div class="rounded-xl border mb-4" style="border-color: var(--sys-sep)">
				<div class="px-3 py-2 text-[11px] font-bold" style="color: var(--sys-label3); border-bottom: 1px solid var(--sys-sep)">
					Progres Pengiriman (per item PO)
				</div>
				<div class="p-3 flex flex-col gap-2.5">
					{#each progress as l (l.so_detail_id)}
						{@const p = pct(l.qty_terkirim, l.qty_po)}
						<div class="text-[11px]">
							<div class="flex justify-between gap-2">
								<span class="font-medium truncate" style="color: var(--sys-label)">{l.nama_barang}</span>
								<span class="shrink-0" style="color: var(--sys-label3)">
									{l.qty_terkirim} / {l.qty_po} {l.satuan}{l.sisa_qty > 0 ? ` · sisa ${l.sisa_qty}` : ' · lengkap'}
								</span>
							</div>
							<div class="mt-1 h-1.5 w-full rounded bg-slate-100 overflow-hidden">
								<div class="h-full {p >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}" style="width:{p}%"></div>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Penagihan -->
		{#if b.invoice}
			<div class="rounded-xl border mb-4 p-3" style="border-color: var(--sys-sep)">
				<div class="flex items-center gap-1.5 text-[11px] font-bold mb-1" style="color: var(--sys-label3)">
					<IconFileInvoice size={13} /> Penagihan
				</div>
				<div class="text-[12px]" style="color: var(--sys-label)">{b.invoice.invoice_number}</div>
				<div class="text-[11px] mt-0.5" style="color: var(--sys-label3)">
					Total {fmtRp(b.invoice.total_amount)} · Sisa {fmtRp(b.invoice.outstanding_amount)} ·
					Jatuh tempo {fmtDate(b.invoice.due_date)} ·
					<b>{b.invoice.payment_status}</b>
					{#if b.invoice.is_partial} · parsial ke-{b.invoice.delivery_sequence}{/if}
				</div>
			</div>
		{/if}

		<!-- Minta pengiriman berikutnya (WA — nol tulisan ke database) -->
		{#if progress.some((l) => l.sisa_qty > 0)}
			<button
				class="w-full h-11 rounded-xl text-[13px] font-bold text-white flex items-center justify-center gap-2"
				style="background:#25D366"
				onclick={mintaPengiriman}
			>
				<IconBrandWhatsapp size={18} /> Minta Pengiriman Berikutnya
			</button>
			<p class="text-[10px] text-center mt-1.5" style="color: var(--sys-label4)">
				Membuka WhatsApp dengan pesan berisi proyek, sisa qty, dan nama Anda. Tidak menyimpan apa pun.
			</p>
		{/if}
	{/if}
</div>
