<!-- src/lib/components/produksi/SpkDataHealthBanner.svelte -->
<!-- Fase 5 (Laporan Bulanan Manufaktur): banner hub produksi — akar masalah akurasi KPI.
     1) SPK selesai produksi tapi belum di-QC  → buka Kiosk QC.   2) SPK berjalan tanpa deadline → minta supervisor/admin mengisi.
     Hanya informasi (tidak memblokir input). Gagal memuat = pesan kecil, bukan angka 0. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { fetchSpkDataHealth, type SpkDataHealth } from '$lib/services/produksiDataHealthApi';

	let health = $state<SpkDataHealth | null>(null);
	let error = $state('');
	let loading = $state(true);

	onMount(async () => {
		try {
			health = await fetchSpkDataHealth();
		} catch (e: any) {
			error = e?.message || 'Gagal memuat kesehatan data SPK';
		} finally {
			loading = false;
		}
	});

	// Server membatasi 200 baris/daftar → tampilkan "200+" agar jujur saat terpotong.
	const fmt = (n: number) => (n >= 200 ? '200+' : String(n));
	let adaMasalah = $derived(!!health && (health.belumQc.total > 0 || health.tanpaDeadline.total > 0));
</script>

{#if loading}
	<!-- tidak menampilkan apa pun saat memuat agar hub tidak berkedip -->
{:else if error}
	<p class="mb-4 text-[11px] rounded-xl px-3 py-2" style="color: var(--sys-label3)" data-testid="spk-health-err">Status kelengkapan data SPK tidak tersedia ({error}).</p>
{:else if health && adaMasalah}
	<div class="mb-4 rounded-2xl border border-amber-300 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/40 px-4 py-3 text-xs space-y-2" data-testid="spk-health-banner">
		<p class="font-bold text-amber-800 dark:text-amber-300">⚠ Data SPK perlu dilengkapi agar laporan & KPI produksi akurat</p>
		{#if health.belumQc.total > 0}
			<p class="text-amber-900 dark:text-amber-200" data-testid="spk-health-qc">
				<strong>{fmt(health.belumQc.total)} SPK</strong> selesai produksi ({health.windowHari} hari terakhir) tetapi belum di-QC
				{#if health.belumQc.contoh.length}— mis. {health.belumQc.contoh.join(', ')}{/if}.
				<a href="/kiosk/qc" class="underline font-semibold">Buka Kiosk QC →</a>
			</p>
		{/if}
		{#if health.tanpaDeadline.total > 0}
			<p class="text-amber-900 dark:text-amber-200" data-testid="spk-health-deadline">
				<strong>{fmt(health.tanpaDeadline.total)} SPK</strong> sedang berjalan tanpa deadline
				{#if health.tanpaDeadline.contoh.length}— mis. {health.tanpaDeadline.contoh.join(', ')}{/if}.
				Minta admin produksi mengisi deadline di data SPK.
			</p>
		{/if}
		<p class="text-[10px] text-amber-700 dark:text-amber-300/80">Tanpa QC dan deadline, laporan bulanan hanya menghitung sebagian SPK. Banner ini hanya pengingat — tidak menahan pekerjaan Anda.</p>
	</div>
{/if}
