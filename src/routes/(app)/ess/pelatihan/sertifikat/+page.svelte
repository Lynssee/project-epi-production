<script lang="ts">
	// Kartu Sertifikat Digital: semua sertifikat pelatihan saya di HP. Tunjukkan QR ke klien/auditor — mereka memindai untuk
	// memverifikasi keaslian di halaman publik EPI. QR dibuat di HP dari tautan terverifikasi, jadi tetap tampil tanpa sinyal
	// (setelah halaman ini pernah dibuka saat online).
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import QRCode from 'qrcode';
	import { getSertifikatSaya, type SertifikatSayaData, type KartuSertifikatClient } from '$lib/services/ess/training';
	import { IconArrowLeft, IconAward, IconLoader2, IconWifiOff, IconX, IconQrcode } from '@tabler/icons-svelte';

	let data = $state<SertifikatSayaData | null>(null);
	let loading = $state(true);
	let error = $state('');
	let dariCache = $state(false);
	let cachedAt = $state<string | null>(null);
	let qr = $state<Record<number, string>>({});
	let besar = $state<KartuSertifikatClient | null>(null);

	async function muat() {
		loading = true;
		error = '';
		try {
			const r = await getSertifikatSaya();
			data = r.data;
			dariCache = r.dariCache;
			cachedAt = r.cachedAt;
			// QR dibuat sekali per kartu di sisi klien (tanpa jaringan).
			const hasil: Record<number, string> = {};
			for (const k of data.kartu) {
				if (!k.verifyUrl) continue;
				try {
					hasil[k.enrollmentId] = await QRCode.toDataURL(k.verifyUrl, { margin: 1, width: 360, errorCorrectionLevel: 'M' });
				} catch (e) {
					console.warn('[sertifikat] gagal membuat QR:', (e as Error)?.message);
				}
			}
			qr = hasil;
		} catch (e: any) {
			error = e?.message || 'Gagal memuat sertifikat.';
		} finally {
			loading = false;
		}
	}
	onMount(muat);

	const BADGE: Record<KartuSertifikatClient['status'], { teks: string; bg: string; fg: string }> = {
		aktif: { teks: 'Berlaku', bg: 'rgba(34,197,94,0.12)', fg: '#16a34a' },
		tanpa_batas: { teks: 'Berlaku', bg: 'rgba(34,197,94,0.12)', fg: '#16a34a' },
		segera_habis: { teks: 'Segera habis', bg: 'rgba(245,158,11,0.15)', fg: '#b45309' },
		kedaluwarsa: { teks: 'Kedaluwarsa', bg: 'rgba(239,68,68,0.12)', fg: '#dc2626' }
	};
	const tgl = (s: string | null) => (s ? new Date(`${s}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Seumur hidup');
</script>

<div class="w-full p-4 md:p-6 pb-24 max-w-2xl mx-auto">
	<button type="button" onclick={() => goto('/ess/pelatihan')} class="inline-flex items-center gap-1.5 text-xs font-semibold mb-3" style="color: var(--sys-label3)">
		<IconArrowLeft size={16} /> Kembali ke Pelatihan
	</button>
	<h1 class="text-2xl font-extrabold tracking-tight gradient-text">Sertifikat Saya</h1>
	<p class="text-sm mt-1" style="color: var(--sys-label3)">Tunjukkan kode QR kepada klien atau auditor. Mereka memindainya untuk memastikan sertifikat ini asli.</p>

	{#if dariCache}
		<div class="mt-3 rounded-lg p-2.5 text-[12px] flex items-center gap-2" style="background: rgba(245,158,11,0.12); color: #b45309">
			<IconWifiOff size={16} /> Mode offline — menampilkan data tersimpan{cachedAt ? ` (${new Date(cachedAt).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})` : ''}. QR tetap bisa dipindai.
		</div>
	{/if}

	{#if loading}
		<div class="py-16 text-center text-sm" style="color: var(--sys-label3)"><IconLoader2 size={20} class="inline animate-spin" /> Memuat sertifikat…</div>
	{:else if error}
		<div class="glass-panel rounded-2xl p-6 text-center mt-6">
			<p class="text-sm text-red-500 mb-4">{error}</p>
			<button class="px-5 py-2 rounded-xl text-sm font-bold text-white gradient-bg" onclick={muat}>Coba Lagi</button>
		</div>
	{:else if data && data.kartu.length === 0}
		<div class="glass-panel rounded-2xl p-8 text-center mt-6">
			<IconAward size={32} class="mx-auto mb-2" style="color: var(--sys-label4)" />
			<p class="text-sm font-medium" style="color: var(--sys-label3)">Belum ada sertifikat. Selesaikan kursus dan lulus kuis akhir untuk mendapatkannya.</p>
		</div>
	{:else if data}
		<p class="text-[12px] mt-3" style="color: var(--sys-label3)">
			{data.ringkasan.total} sertifikat · {data.ringkasan.aktif} berlaku{data.ringkasan.segeraHabis ? ` · ${data.ringkasan.segeraHabis} segera habis` : ''}{data.ringkasan.kedaluwarsa ? ` · ${data.ringkasan.kedaluwarsa} kedaluwarsa` : ''}
		</p>
		<div class="flex flex-col gap-3 mt-3">
			{#each data.kartu as k (k.enrollmentId)}
				{@const b = BADGE[k.status]}
				<div class="glass-panel rounded-2xl p-4 flex gap-3 items-start">
					<div class="flex-1 min-w-0">
						<div class="flex items-center gap-2 flex-wrap">
							<span class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full" style="background: {b.bg}; color: {b.fg}">{b.teks}</span>
							{#if k.status === 'segera_habis' && k.sisaHari != null}<span class="text-[11px]" style="color: #b45309">{k.sisaHari} hari lagi</span>{/if}
						</div>
						<p class="text-[14px] font-bold mt-1.5 leading-snug" style="color: var(--sys-label)">{k.judul}</p>
						<p class="text-[11px] mt-1" style="color: var(--sys-label3)">No. {k.sertifikatNo}</p>
						<p class="text-[11px]" style="color: var(--sys-label3)">Berlaku s.d. {tgl(k.expired)}{k.nilaiAkhir != null ? ` · Nilai ${k.nilaiAkhir}` : ''}</p>
						{#if k.status === 'kedaluwarsa' || k.status === 'segera_habis'}
							<button type="button" onclick={() => goto(`/ess/pelatihan/${k.programId}`)} class="mt-2 text-[12px] font-semibold" style="color: var(--ac, #2563eb)">Buka kursus untuk memperbarui →</button>
						{/if}
					</div>
					{#if qr[k.enrollmentId]}
						<button type="button" onclick={() => (besar = k)} class="shrink-0 rounded-lg bg-white p-1" style="border: 1px solid var(--sys-sep)" aria-label="Perbesar QR {k.judul}" title="Ketuk untuk memperbesar">
							<img src={qr[k.enrollmentId]} alt="QR verifikasi {k.judul}" width="84" height="84" />
						</button>
					{:else}
						<div class="shrink-0 w-[92px] text-center text-[10px]" style="color: var(--sys-label4)" title="Kode verifikasi belum diaktifkan di server">
							<IconQrcode size={24} class="mx-auto" />QR belum tersedia
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if besar && qr[besar.enrollmentId]}
	<div class="fixed inset-0 z-50 flex flex-col items-center justify-center p-6" style="background: rgba(0,0,0,0.85)" role="dialog" aria-modal="true" aria-label="QR sertifikat">
		<button type="button" class="absolute top-4 right-4 text-white" onclick={() => (besar = null)} aria-label="Tutup"><IconX size={28} /></button>
		<div class="bg-white rounded-2xl p-4">
			<img src={qr[besar.enrollmentId]} alt="QR verifikasi {besar.judul}" class="w-[min(80vw,360px)] h-auto" />
		</div>
		<p class="text-white text-sm font-semibold mt-4 text-center">{besar.judul}</p>
		<p class="text-white/70 text-xs mt-1 text-center">No. {besar.sertifikatNo} — minta klien memindai kode ini</p>
	</div>
{/if}
