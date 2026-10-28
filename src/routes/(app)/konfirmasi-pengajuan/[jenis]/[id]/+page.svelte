<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Pengajuan Darurat Atas Nama — layar konfirmasi pemohon (jalur LOGIN). Tampilan bersama:
	// KonfirmasiPengajuanView. Jalur tautan WhatsApp tanpa login ada di /konfirmasi/[jenis]/[id].
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import KonfirmasiPengajuanView from '$lib/components/konfirmasi/KonfirmasiPengajuanView.svelte';
	import { getIdToken } from '$lib/services/secureDirectus';
	import { IconLoader2, IconAlertTriangle, IconArrowLeft } from '@tabler/icons-svelte';

	const jenis = $page.params.jenis;
	const id = Number($page.params.id);
	const jenisLabel = jenis === 'pr' ? 'Pengajuan Pembelian (PR)' : 'Pengajuan Anggaran';

	let loading = $state(true);
	let errorMsg = $state('');
	let data = $state<any>(null);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const token = await getIdToken();
			const res = await fetch(`/api/pengajuan-konfirmasi?jenis=${encodeURIComponent(jenis)}&id=${id}`, {
				headers: { Authorization: `Bearer ${token}` }
			});
			const j = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(j?.message || `HTTP ${res.status}`);
			data = j.data;
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat pengajuan.';
		} finally {
			loading = false;
		}
	}
	onMount(load);

	async function submit(action: 'approve' | 'reject', p: { note?: string; ttdDataUrl?: string }) {
		const token = await getIdToken();
		const res = await fetch('/api/pengajuan-konfirmasi', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ jenis, pengajuanId: id, action, versi: data?.versi, note: p.note, ttdDataUrl: p.ttdDataUrl })
		});
		const j = await res.json().catch(() => ({}));
		if (!res.ok) throw new Error(j?.message || `HTTP ${res.status}`);
	}
</script>

<div class="w-full p-4 md:p-6 pb-28 max-w-2xl mx-auto">
	<button class="flex items-center gap-1 text-sm mb-3" style="color: var(--sys-label3)" onclick={() => goto('/pusat-pengajuan')}>
		<IconArrowLeft size={16} /> Pusat Pengajuan
	</button>
	<h1 class="text-2xl font-extrabold tracking-tight gradient-text">Konfirmasi Pengajuan</h1>
	<p class="text-sm mt-1 mb-4 font-medium" style="color: var(--sys-label3)">{jenisLabel} yang dibuatkan atas nama Anda</p>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data pengajuan..." />
		</div>
	{:else if !data}
		<div class="glass-panel rounded-2xl p-6 text-center">
			<IconAlertTriangle size={30} class="mx-auto mb-3" style="color: var(--red, #dc2626)" />
			<p class="text-sm font-medium" style="color: var(--sys-label2)">{errorMsg || 'Pengajuan tidak ditemukan.'}</p>
		</div>
	{:else}
		<KonfirmasiPengajuanView {data} {jenis} {submit} doneLabel="Kembali ke Pusat Pengajuan" onDone={() => goto('/pusat-pengajuan')} />
	{/if}
</div>
