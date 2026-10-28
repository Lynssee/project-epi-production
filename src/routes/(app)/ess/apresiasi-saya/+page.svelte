<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { getApresiasiSaya, konfirmasiTerimaApresiasi, type ApresiasiItem } from '$lib/services/ess/apresiasi';
	import { IconLoader2, IconAlertTriangle, IconGift, IconCamera } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let items = $state<ApresiasiItem[]>([]);
	let busyId = $state<number | null>(null);
	let actionMsg = $state('');

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			items = await getApresiasiSaya();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat apresiasi.';
		} finally {
			loading = false;
		}
	}
	onMount(load);

	async function onPick(it: ApresiasiItem, e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		busyId = it.id;
		actionMsg = '';
		try {
			await konfirmasiTerimaApresiasi(it.id, file);
			actionMsg = 'Terima kasih, konfirmasi penerimaan tersimpan.';
			await load();
		} catch (err: any) {
			actionMsg = err?.message || 'Gagal menyimpan konfirmasi.';
		} finally {
			busyId = null;
		}
	}

	function statusLabel(it: ApresiasiItem) {
		if (it.status_kirim === 'diterima') return { text: 'Sudah Anda terima', color: '#059669' };
		if (it.status === 'diserahkan') return { text: 'Sudah diserahkan — mohon konfirmasi', color: '#D97706' };
		if (it.status_kirim === 'dikirim') return { text: 'Dalam pengiriman', color: '#2563EB' };
		if (it.status_kirim === 'dikemas') return { text: 'Sedang dikemas', color: '#2563EB' };
		return { text: 'Disiapkan HRD', color: 'var(--sys-label3)' };
	}
	const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<div class="mb-6">
		<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Apresiasi Saya</h1>
		<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">Hadiah & apresiasi dari perusahaan. Setelah barang Anda terima, ketuk "Konfirmasi Terima" dan lampirkan foto sebagai bukti. Ada yang tidak sesuai? Hubungi HRD.</p>
	</div>

	{#if actionMsg}
		<div class="glass-panel rounded-xl p-3 mb-4 text-sm font-medium">{actionMsg}</div>
	{/if}

	{#if loading}
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat apresiasi..." />
	{:else if errorMsg}
		<div class="glass-panel rounded-2xl p-8 text-center max-w-md mx-auto mt-10">
			<div class="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
				<IconAlertTriangle size={32} style="color: #DC2626" />
			</div>
			<p class="text-sm text-red-500 mb-6">{errorMsg}</p>
			<button class="px-6 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg" onclick={load}>Coba Lagi</button>
		</div>
	{:else if items.length === 0}
		<div class="glass-panel rounded-2xl p-10 text-center">
			<div class="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
				<IconGift size={32} class="text-slate-400" />
			</div>
			<p class="text-sm font-medium" style="color: var(--sys-label3)">Belum ada apresiasi untuk Anda.</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each items as it (it.id)}
				{@const st = statusLabel(it)}
				<div class="glass-panel rounded-2xl p-4 flex items-start justify-between gap-3">
					<div class="min-w-0">
						<div class="font-bold">{it.item_nama} <span class="font-medium" style="color: var(--sys-label3)">×{it.qty}</span></div>
						<div class="text-xs mt-0.5" style="color: var(--sys-label4)">
							{it.program_nama || 'Apresiasi'} · {fmtDate(it.tanggal)}{it.nomor_resi ? ` · Resi ${it.nomor_resi}` : ''}
						</div>
						<div class="text-sm font-semibold mt-1" style="color: {st.color}">{st.text}</div>
					</div>
					{#if it.bisa_konfirmasi}
						<label class="shrink-0 px-3 py-2 rounded-xl text-xs font-bold text-white gradient-bg cursor-pointer inline-flex items-center gap-1.5 {busyId === it.id ? 'opacity-50 pointer-events-none' : ''}">
							{#if busyId === it.id}<IconLoader2 size={14} class="animate-spin" />{:else}<IconCamera size={14} />{/if}
							Konfirmasi Terima
							<input type="file" accept="image/*" capture="environment" class="hidden" onchange={(e) => onPick(it, e)} />
						</label>
					{/if}
				</div>
			{/each}
		</div>
		<p class="text-xs mt-4" style="color: var(--sys-label4)">Foto wajib — dipakai sebagai bukti audit penerimaan.</p>
	{/if}
</div>
