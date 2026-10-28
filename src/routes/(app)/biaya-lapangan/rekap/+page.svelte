<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Rekap Nota Lapangan — nota/biaya yang SAYA catat per periode + total per jenis + cetak A4 ringan.
	// Hanya-baca. Sumber: GET /api/biaya-lapangan/rekap (fleet_trip_expense milik saya).
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { IconChevronLeft, IconLoader2, IconAlertTriangle, IconPrinter, IconCamera } from '@tabler/icons-svelte';
	import { auth } from '$lib/firebase';
	import { todayWib } from '$lib/utils/wibDate';
	import {
		REKAP_PRESETS, rangeForPreset, validateRange, aggregateRekap, jenisLabel, modeLabel,
		printRekapNotaLapangan, type RekapRow, type RekapPreset
	} from '$lib/utils/rekapNotaLapangan';

	const hariIni = todayWib();
	let preset = $state<RekapPreset | 'custom'>('bulan-ini');
	let dari = $state(rangeForPreset('bulan-ini', hariIni).dari);
	let sampai = $state(rangeForPreset('bulan-ini', hariIni).sampai);
	let modeFilter = $state<'semua' | 'talangan' | 'proyek'>('semua');

	let loading = $state(true);
	let errorMsg = $state('');
	let rows = $state<RekapRow[]>([]);
	let truncated = $state(false);
	let nama = $state('');

	const tampil = $derived(modeFilter === 'semua' ? rows : rows.filter((r) => r.mode === modeFilter));
	const ringkasan = $derived(aggregateRekap(tampil));
	const rp = (n: number) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
	const fmtTgl = (iso: string) => {
		const t = Date.parse(iso);
		return Number.isNaN(t) ? '-' : new Date(t).toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Asia/Jakarta' });
	};
	const fmtJam = (iso: string) => {
		const t = Date.parse(iso);
		return Number.isNaN(t) ? '' : new Date(t).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jakarta' });
	};

	async function load() {
		const v = validateRange(dari, sampai);
		if (!v.ok) {
			errorMsg = v.reason;
			return;
		}
		loading = true;
		errorMsg = '';
		try {
			const idToken = await auth.currentUser?.getIdToken();
			const res = await fetch(`/api/biaya-lapangan/rekap?dari=${dari}&sampai=${sampai}`, {
				headers: idToken ? { Authorization: `Bearer ${idToken}` } : {}
			});
			const j = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(j?.message || `HTTP ${res.status}`);
			rows = j.data?.rows ?? [];
			truncated = !!j.data?.truncated;
			nama = j.data?.nama ?? '';
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat rekap.';
			rows = [];
		} finally {
			loading = false;
		}
	}
	onMount(load);

	function pilihPreset(p: RekapPreset) {
		preset = p;
		({ dari, sampai } = rangeForPreset(p, todayWib()));
		load();
	}
	function ubahManual() {
		preset = 'custom';
		load();
	}

	function cetak() {
		// Sinkron dari klik (pop-up blocker). Rekap yang dicetak = yang sedang tampil (sesuai filter sumber dana).
		const ok = printRekapNotaLapangan({ nama: nama || 'Karyawan', dari, sampai, rows: tampil });
		if (!ok) errorMsg = 'Pop-up diblokir. Izinkan pop-up untuk situs ini lalu coba lagi.';
	}
</script>

<div class="w-full max-w-lg mx-auto p-4 pb-28">
	<div class="flex items-center gap-3 mb-4">
		<button onclick={() => goto('/biaya-lapangan')} class="p-2 rounded-xl hover:bg-black/5 transition-colors" style="color: var(--sys-label3)" aria-label="Kembali ke Biaya Lapangan">
			<IconChevronLeft size={22} />
		</button>
		<div class="flex-1">
			<h1 class="text-xl font-extrabold tracking-tight" style="color: var(--sys-label)">Rekap Nota Saya</h1>
			<p class="text-xs font-medium mt-0.5" style="color: var(--sys-label3)">Kumpulan nota sebelum diserahkan ke admin</p>
		</div>
		<button
			onclick={cetak}
			disabled={loading || tampil.length === 0}
			class="w-11 h-11 rounded-full flex items-center justify-center border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 text-slate-600 disabled:opacity-40 hover:scale-105 transition-transform"
			aria-label="Cetak rekap nota"
			title="Cetak rekap (A4 ringan, tanpa gambar) — yang dicetak sesuai filter yang tampil"
		>
			<IconPrinter size={20} />
		</button>
	</div>

	<!-- Periode -->
	<div class="flex gap-1.5 overflow-x-auto pb-1 mb-2" role="group" aria-label="Pilih periode">
		{#each REKAP_PRESETS as p}
			<button
				onclick={() => pilihPreset(p.id)}
				class="px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border {preset === p.id ? 'gradient-bg text-white border-transparent' : 'border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70'}"
			>{p.label}</button>
		{/each}
	</div>
	<div class="grid grid-cols-2 gap-2 mb-3">
		<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Dari
			<input type="date" bind:value={dari} max={sampai} onchange={ubahManual} class="mt-0.5 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 px-2.5 py-2 text-sm" />
		</label>
		<label class="text-[11px] font-semibold" style="color: var(--sys-label3)">Sampai
			<input type="date" bind:value={sampai} min={dari} onchange={ubahManual} class="mt-0.5 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80 px-2.5 py-2 text-sm" />
		</label>
	</div>
	<div class="flex gap-1.5 mb-4" role="group" aria-label="Filter sumber dana">
		{#each [['semua', 'Semua'], ['talangan', 'Uang Saya'], ['proyek', 'Dana Proyek']] as [id, label]}
			<button
				onclick={() => (modeFilter = id as typeof modeFilter)}
				class="flex-1 px-2 py-1.5 rounded-xl text-xs font-semibold border {modeFilter === id ? 'gradient-bg text-white border-transparent' : 'border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70'}"
			>{label}</button>
		{/each}
	</div>

	{#if loading}
		<CircularProgressGauge size={52} strokeWidth={4} label="Memuat rekap nota..." />
	{:else if errorMsg}
		<div class="p-4 rounded-2xl border flex items-start gap-3" style="background: var(--rel); border-color: var(--red); color: var(--red)" role="alert">
			<IconAlertTriangle size={20} class="shrink-0 mt-0.5" />
			<div class="text-sm">
				<p class="font-semibold">{errorMsg}</p>
				<button onclick={load} class="underline text-xs mt-1">Coba lagi</button>
			</div>
		</div>
	{:else}
		<!-- Ringkasan -->
		<div class="rounded-2xl p-4 mb-3 border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80">
			<p class="text-[11px] font-semibold uppercase tracking-wider" style="color: var(--sys-label3)">Total {ringkasan.count} nota</p>
			<p class="text-2xl font-extrabold tabular-nums mt-0.5" style="color: var(--sys-label)">{rp(ringkasan.total)}</p>
			{#if ringkasan.perJenis.length}
				<div class="flex flex-wrap gap-1.5 mt-2">
					{#each ringkasan.perJenis as j}
						<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 dark:bg-slate-700">{jenisLabel(j.jenis)} · {j.count}× · {rp(j.total)}</span>
					{/each}
				</div>
			{/if}
			{#if ringkasan.tanpaStruk > 0}
				<p class="mt-2 text-[11px] font-semibold flex items-center gap-1" style="color: var(--amd)">
					<IconCamera size={14} /> {ringkasan.tanpaStruk} nota belum ada foto struk — lengkapi sebelum diserahkan.
				</p>
			{/if}
			{#if ringkasan.menunggu > 0}
				<p class="mt-1 text-[11px] font-semibold" style="color: var(--amd)">⏳ {ringkasan.menunggu} nota menunggu approval.</p>
			{/if}
		</div>

		{#if truncated}
			<p class="text-[11px] mb-2 font-semibold" style="color: var(--amd)">Menampilkan 500 nota terbaru. Persempit periode untuk melihat sisanya.</p>
		{/if}

		{#if tampil.length === 0}
			<div class="text-center py-12">
				<p class="text-3xl mb-2">🧾</p>
				<p class="text-sm font-medium" style="color: var(--sys-label3)">Belum ada nota pada periode ini.</p>
				<button onclick={() => goto('/biaya-lapangan')} class="mt-3 px-4 py-2 rounded-xl text-sm font-semibold gradient-bg text-white">Catat Biaya</button>
			</div>
		{:else}
			<ul class="space-y-2">
				{#each tampil as r (r.id)}
					<li class="rounded-2xl p-3 border border-slate-200 dark:border-slate-700 bg-white/80 dark:bg-slate-800/80">
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0">
								<p class="text-sm font-bold" style="color: var(--sys-label)">{jenisLabel(r.jenis)} <span class="font-medium text-xs" style="color: var(--sys-label3)">· {modeLabel(r.mode)}</span></p>
								<p class="text-[11px]" style="color: var(--sys-label3)">{fmtTgl(r.waktu)} {fmtJam(r.waktu)}{r.project_name ? ' · ' + r.project_name : ''}</p>
								{#if r.catatan}<p class="text-xs mt-1 break-words" style="color: var(--sys-label2, var(--sys-label))">{r.catatan}</p>{/if}
							</div>
							<div class="text-right shrink-0">
								<p class="text-sm font-extrabold tabular-nums">{rp(r.nominal)}</p>
								<p class="text-[10px] font-semibold mt-0.5" style="color: {r.has_struk ? 'var(--ggd)' : 'var(--amd)'}">{r.has_struk ? '✓ Struk ada' : '✗ Tanpa struk'}</p>
								{#if r.approval_status === 'menunggu'}<p class="text-[10px] font-semibold" style="color: var(--amd)">⏳ Menunggu approval</p>{/if}
							</div>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</div>
