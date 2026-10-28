<!--
	Quick Estimator Card — Fase 2 (survey lapangan & omnichannel).
	Live badge estimasi kasar: surveyor pilih jenis jasa, sisanya reaktif dari
	luas area & kondisi permukaan yang sudah diisi di form survey.
	Angka di sini BUKAN penawaran resmi — selalu tampil disclaimer.
-->
<script lang="ts">
	// Pola toast global repo ini: Toast.svelte lewat window.__showToast (bukan svelte-sonner)
	const toast = {
		success: (m: string) => (window as any).__showToast?.(m, 'success'),
		error: (m: string) => (window as any).__showToast?.(m, 'error')
	};
	import { onMount } from 'svelte';
	import { IconCalculator, IconCopy, IconInfoCircle, IconLoader2 } from '@tabler/icons-svelte';
	import {
		calculateQuickEstimate,
		formatQuickEstimateRange,
		buildWhatsAppDraft,
		QUICK_ESTIMATOR_JASA,
		type QuickEstimateResult
	} from '$lib/utils/quickEstimator';
	import { getQuickEstimatorConfig } from '$lib/services/quickEstimatorConfigApi';

	let {
		luasArea = '',
		kondisiPermukaan = '',
		ketersediaanListrik = '',
		ketersediaanAir = '',
		customerName = '',
		onEstimate
	}: {
		luasArea?: string | number;
		kondisiPermukaan?: string;
		ketersediaanListrik?: string;
		ketersediaanAir?: string;
		customerName?: string;
		onEstimate?: (result: QuickEstimateResult & { jenisJasaLabel?: string }) => void;
	} = $props();

	const JASA_LABEL: Record<string, string> = {
		sandblasting: 'Sandblasting',
		painting: 'Industrial Painting',
		floor_coating: 'Floor Coating / Epoxy'
	};

	let jenisJasa = $state('');
	let configLoading = $state(true);
	let configError = $state('');
	let rates = $state<Record<string, { base_rate_per_m2: number; label?: string }>>({});
	let multipliers = $state<any>({});

	onMount(async () => {
		try {
			const cfg = await getQuickEstimatorConfig();
			rates = cfg.rates;
			multipliers = cfg.multipliers;
			if (Object.keys(rates).length === 0) {
				configError = 'Parameter Quick Estimasi belum diatur admin. Hubungi tim Sales/Admin.';
			}
		} catch (e) {
			configError = 'Gagal memuat parameter estimasi. Coba muat ulang halaman.';
		} finally {
			configLoading = false;
		}
	});

	let result = $derived.by((): QuickEstimateResult => {
		if (!jenisJasa) return { valid: false, errors: [] };
		return calculateQuickEstimate({
			jenisJasa,
			luasArea,
			kondisiPermukaan,
			listrikTersedia: ketersediaanListrik,
			airTersedia: ketersediaanAir,
			rates,
			multipliers
		});
	});

	$effect(() => {
		if (onEstimate) onEstimate({ ...result, jenisJasaLabel: jenisJasa ? JASA_LABEL[jenisJasa] : undefined });
	});

	async function salinKeWhatsApp() {
		if (!result.valid) return;
		const teks = buildWhatsAppDraft(result, { jasaLabel: JASA_LABEL[jenisJasa], customerName });
		try {
			await navigator.clipboard.writeText(teks);
			toast.success('Draft ringkasan disalin — tempel langsung ke chat WhatsApp.');
		} catch {
			toast.error('Gagal menyalin otomatis. Salin manual teks di bawah.');
		}
	}
</script>

<div class="rounded-2xl border p-4 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
	<div class="flex items-center justify-between gap-2 mb-1">
		<h2 class="text-[13px] font-bold flex items-center gap-1.5" style="color: var(--sys-label)">
			<IconCalculator size={15} style="color: var(--p, var(--g))" /> Quick Estimasi Harga
		</h2>
	</div>
	<p class="text-[10.5px] mb-3 leading-relaxed" style="color: var(--sys-label3)">
		Angka kasar untuk obrolan awal dengan customer. Pilih jenis jasa, estimasi otomatis mengikuti luas area &amp;
		kondisi permukaan yang sudah diisi di atas. Bukan penawaran resmi.
	</p>

	<div class="grid grid-cols-3 gap-1.5 mb-3">
		{#each QUICK_ESTIMATOR_JASA as jasa (jasa)}
			<button
				type="button"
				class="h-9 rounded-xl text-[11px] font-bold border transition-colors"
				style={jenisJasa === jasa
					? 'background: var(--p, var(--g)); color: white; border-color: transparent;'
					: 'border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)'}
				onclick={() => (jenisJasa = jenisJasa === jasa ? '' : jasa)}
			>
				{JASA_LABEL[jasa]}
			</button>
		{/each}
	</div>

	{#if configLoading}
		<div class="flex items-center gap-2 text-[11px] py-3" style="color: var(--sys-label3)">
			<IconLoader2 size={14} class="animate-spin" /> Memuat parameter estimasi...
		</div>
	{:else if configError}
		<div class="flex items-start gap-1.5 text-[11px] py-2 px-3 rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300">
			<IconInfoCircle size={14} class="shrink-0 mt-0.5" /> {configError}
		</div>
	{:else if !jenisJasa}
		<div class="flex items-start gap-1.5 text-[11px] py-2 px-3 rounded-xl" style="background: var(--sys-fill); color: var(--sys-label3)">
			<IconInfoCircle size={14} class="shrink-0 mt-0.5" /> Pilih jenis jasa di atas untuk melihat estimasi kasar.
		</div>
	{:else if !result.valid}
		<div class="flex items-start gap-1.5 text-[11px] py-2 px-3 rounded-xl bg-red-500/10 text-red-600 dark:text-red-400">
			<IconInfoCircle size={14} class="shrink-0 mt-0.5" />
			<span>{result.errors?.[0] || 'Isi luas area terlebih dahulu.'}</span>
		</div>
	{:else}
		<div class="rounded-xl p-3 mb-2.5" style="background: var(--sys-fill)">
			<span class="text-[10px] font-semibold block mb-0.5" style="color: var(--sys-label3)">Estimasi Total ({JASA_LABEL[jenisJasa]}):</span>
			<p class="text-[17px] font-extrabold" style="color: var(--p, var(--g))">{formatQuickEstimateRange(result)}</p>
			<span class="text-[10px] block mt-1" style="color: var(--sys-label3)">
				±{formatQuickEstimateRange(result, { perM2: true })} &middot; luas {result.luasArea} m²
			</span>
		</div>

		{#if result.utilitasBreakdown && result.utilitasBreakdown.length > 0}
			<div class="text-[10px] mb-2.5 pl-1" style="color: var(--sys-label3)">
				{#each result.utilitasBreakdown as item (item.label)}
					<div>+ {item.label}: surcharge dialokasikan ke total</div>
				{/each}
			</div>
		{/if}

		<button
			type="button"
			class="w-full h-9 rounded-xl text-[11px] font-bold border flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
			style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
			onclick={salinKeWhatsApp}
		>
			<IconCopy size={14} /> Salin Ringkasan ke WhatsApp
		</button>
	{/if}
</div>
