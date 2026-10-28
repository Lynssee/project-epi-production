<script lang="ts">
	// src/routes/(app)/lacak-sj/serah-berkas/+page.svelte
	// Penajaman Gate SJ Fase 3 — Handover QR. Driver/PIC menunjukkan QR ini ke admin; admin memindainya di
	// ERP (/inventory/dokumen-fisik-sj → Mode Scan Cepat) dan seluruh lembar wajib-kembali SJ di bawah ini
	// langsung tercatat "diterima admin". Payload: EPI:HO:<karyawanId>:<id1,id2,...> (tanpa data sensitif;
	// pengendalinya adalah admin yang memindai di depan Anda sambil memegang kertasnya).
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import QRCode from 'qrcode';
	import { IconArrowLeft, IconLoader2, IconAlertTriangle } from '@tabler/icons-svelte';
	import { authedJson } from '$lib/services/sjTunggakan';

	interface Row { id: number | string; nomor_sj: string; ageDays: number }
	let loading = $state(true);
	let err = $state('');
	let rows = $state<Row[]>([]);
	let qr = $state<string | null>(null);

	onMount(async () => {
		try {
			const d = await authedJson('/api/lacak-sj/tunggakan?semua=1');
			rows = d?.rows ?? [];
			if (rows.length > 0 && d?.karyawanId != null) {
				const payload = `EPI:HO:${d.karyawanId}:${rows.map((r) => r.id).join(',')}`;
				qr = await QRCode.toDataURL(payload, { margin: 1, width: 280 });
			}
		} catch (e) {
			err = e instanceof Error ? e.message : 'Gagal memuat.';
		} finally {
			loading = false;
		}
	});
</script>

<div class="wrap">
	<button class="back" onclick={() => goto('/')}><IconArrowLeft size={18} /> Beranda</button>
	<h1>Serahkan Berkas ke Admin</h1>
	<p class="sub">Bawa kertas SJ asli ke meja admin, tunjukkan QR ini. Admin memindainya — berkas langsung tercatat diterima, tanpa tanda terima kertas.</p>

	{#if loading}
		<div class="center"><IconLoader2 size={28} class="spin" /></div>
	{:else if err}
		<div class="banner"><IconAlertTriangle size={16} /> {err}</div>
	{:else if rows.length === 0}
		<p class="muted">Tidak ada berkas SJ yang perlu diserahkan. 🎉</p>
	{:else}
		{#if qr}<img class="qr" src={qr} alt="QR serah berkas" />{/if}
		<p class="count">{rows.length} Surat Jalan dalam QR ini</p>
		<ul class="list">
			{#each rows as r (r.id)}<li><b>{r.nomor_sj}</b> <span>{r.ageDays} hari kerja</span></li>{/each}
		</ul>
		<p class="muted sm">Pastikan kertas SJ yang tercantum benar-benar Anda bawa. Yang tidak ada di tangan, jangan diserahkan — hubungi admin.</p>
	{/if}
</div>

<style>
	.wrap { max-width: 480px; margin: 0 auto; padding: 1rem; }
	.back { display: inline-flex; align-items: center; gap: 0.35rem; background: none; border: none; color: #475569; font-size: 0.9rem; margin-bottom: 0.5rem; }
	h1 { font-size: 1.25rem; margin: 0 0 0.25rem; }
	.sub { font-size: 0.82rem; color: #64748b; margin: 0 0 1rem; }
	.center { display: flex; justify-content: center; padding: 2rem; }
	.qr { display: block; margin: 0 auto 0.5rem; width: 100%; max-width: 280px; image-rendering: pixelated; background: #fff; padding: 0.5rem; border: 1px solid #e2e8f0; border-radius: 0.75rem; }
	.count { text-align: center; font-weight: 700; font-size: 0.9rem; margin: 0 0 0.5rem; }
	.list { list-style: none; padding: 0; margin: 0 0 0.75rem; font-size: 0.85rem; }
	.list li { display: flex; justify-content: space-between; padding: 0.25rem 0; border-bottom: 1px solid #f1f5f9; }
	.list span { color: #94a3b8; }
	.banner { display: flex; gap: 0.5rem; align-items: center; background: #fef2f2; color: #b91c1c; padding: 0.6rem; border-radius: 0.6rem; font-size: 0.82rem; }
	.muted { color: #94a3b8; }
	.muted.sm { font-size: 0.75rem; }
	:global(.spin) { animation: spin 1s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
