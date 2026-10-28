<!-- src/routes/(app)/produksi/cetak-label/+page.svelte -->
<!-- Fase 4B (Penajaman Modul Produksi v2, 26 Agu 2026) — Label Self-Service Lapangan. -->
<!-- Reuse endpoint /api/print/product-label (erp-epi-1) lewat labelPrintApi.ts, -->
<!-- supaya CSS/markup label tidak diduplikasi dari admin. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		fetchPrintableSpkList,
		fetchSpkLabelMeta,
		printProductLabelField,
		type PrintableSpk,
		type SpkLabelMeta
	} from '$lib/services/labelPrintApi';
	import { IconLoader2, IconPrinter } from '@tabler/icons-svelte';

	let loading = $state(true);
	let printing = $state(false);
	let spkList = $state<PrintableSpk[]>([]);
	let selectedSpkId = $state('');
	let printQuantity = $state(10);
	let errorMsg = $state('');
	let successMsg = $state('');

	// Fase 4 -- pilih netto per komponen (samakan dengan modal admin) + netto manual
	// wajib kalau unit_size_id produk kosong.
	let labelMeta = $state<SpkLabelMeta | null>(null);
	let labelMetaLoading = $state(false);
	let selectedComponentId = $state('');
	let manualNettoKg = $state<number | null>(null);

	const MIN_QTY = 1;
	const MAX_QTY = 10;

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'production_label_print', roles)) {
			goto('/');
		}
	});

	function productLabel(spk: PrintableSpk) {
		const p = spk.product_id;
		const name = typeof p === 'object' ? p?.nama_barang_lengkap : null;
		const statusLabel = spk.status === 'completed' ? 'Selesai' : 'QC Pending';
		return `${spk.nomor}${spk.batch_no ? ' / ' + spk.batch_no : ''}${name ? ' — ' + name : ''} (${statusLabel})`;
	}

	async function load() {
		loading = true;
		try {
			spkList = await fetchPrintableSpkList();
			// B5: pra-pilih SPK dari ?spk=<id> (deep-link dari Monitoring Produksi) supaya
			// operator tidak menyalin nomor SPK/batch manual. Fallback ke SPK pertama.
			const wanted = $page.url.searchParams.get('spk');
			const match = wanted && spkList.find((s) => String(s.id) === String(wanted));
			if (match) selectedSpkId = String(match.id);
			else if (spkList.length > 0) selectedSpkId = String(spkList[0].id);
			if (selectedSpkId) await loadLabelMeta();
		} finally {
			loading = false;
		}
	}

	onMount(load);

	function clampQty() {
		printQuantity = Math.max(MIN_QTY, Math.min(MAX_QTY, Math.round(printQuantity) || 1));
	}

	async function loadLabelMeta() {
		labelMeta = null;
		selectedComponentId = '';
		manualNettoKg = null;
		if (!selectedSpkId) return;
		labelMetaLoading = true;
		try {
			labelMeta = await fetchSpkLabelMeta(Number(selectedSpkId));
			if (labelMeta.isMulti && labelMeta.options.length > 0) {
				selectedComponentId = labelMeta.options[0].componentId;
			}
		} catch (e) {
			// Gagal ambil meta bukan fatal -- cetak tetap bisa jalan (server yang menolak
			// kalau unit_size_id memang kosong), cuma picker komponen tidak muncul.
			console.warn('Gagal memuat info komponen label:', e);
		} finally {
			labelMetaLoading = false;
		}
	}

	function handleSpkChange() {
		loadLabelMeta();
	}

	let unitSizeMissing = $derived(labelMeta !== null && labelMeta.unitSizeKg === null);
	let selectedOption = $derived(
		labelMeta?.isMulti && selectedComponentId
			? labelMeta.options.find((o) => o.componentId === selectedComponentId) || null
			: null
	);
	let canPrint = $derived(
		!!selectedSpkId && !printing && !labelMetaLoading && (!unitSizeMissing || (manualNettoKg ?? 0) > 0)
	);

	async function handlePrint() {
		if (!canPrint) return;
		errorMsg = '';
		successMsg = '';
		printing = true;
		try {
			const nettoKg = unitSizeMissing ? manualNettoKg : selectedOption?.netto ?? null;
			const componentLabel = selectedOption?.label ?? null;
			await printProductLabelField(Number(selectedSpkId), printQuantity, nettoKg, componentLabel);
			successMsg = 'Label dibuka di tab baru. Kalau tidak muncul, cek popup blocker browser.';
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal mencetak label.';
		} finally {
			printing = false;
		}
	}
</script>

<svelte:head>
	<title>Cetak Label Produk — EPI</title>
</svelte:head>

<div class="mx-auto max-w-lg p-4 pb-24">
	<div class="mb-3 flex items-center gap-2">
		<IconPrinter size={20} class="text-blue-600" />
		<h1 class="text-lg font-bold text-gray-900">Cetak Label Produk</h1>
	</div>
	<p class="mb-4 text-xs text-gray-500">
		Pilih SPK yang sudah lolos QC atau selesai, lalu cetak label langsung dari HP/tablet lapangan.
		Label dibuat oleh sistem yang sama dengan admin — pastikan popup browser diizinkan.
	</p>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-12">
		<CircularProgressGauge size={52} strokeWidth={4} label="Memuat data cetak label produksi..." />
	</div>
	{:else if spkList.length === 0}
		<p class="text-sm text-gray-400">Tidak ada SPK berstatus "QC Pending" atau "Selesai" saat ini.</p>
	{:else}
		<div class="space-y-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
			<div>
				<label for="spk-select" class="mb-1 block text-[10px] text-gray-400">SPK</label>
				<select
					id="spk-select"
					class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
					bind:value={selectedSpkId}
					onchange={handleSpkChange}
				>
					{#each spkList as spk (spk.id)}
						<option value={String(spk.id)}>{productLabel(spk)}</option>
					{/each}
				</select>
			</div>

			{#if labelMetaLoading}
				<p class="text-[10px] text-gray-400">Memuat info komponen…</p>
			{:else if labelMeta?.isMulti && labelMeta.options.length > 0}
				<div>
					<label for="component-select" class="mb-1 block text-[10px] text-gray-400">Komponen (multi-komponen)</label>
					<select
						id="component-select"
						class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
						bind:value={selectedComponentId}
					>
						{#each labelMeta.options as opt (opt.componentId)}
							<option value={opt.componentId}>{opt.label} — {opt.netto} KG</option>
						{/each}
					</select>
				</div>
			{/if}

			{#if unitSizeMissing}
				<div class="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
					<strong>Ukuran kemasan produk ini belum terisi</strong> di data produk. Masukkan netto manual (KG) sebelum mencetak.
					<div class="mt-1.5 flex items-center gap-1.5">
						<input
							type="number"
							min="0.01"
							step="0.01"
							placeholder="cth. 20"
							class="w-24 rounded-lg border border-amber-300 px-2 py-1 text-xs font-semibold"
							bind:value={manualNettoKg}
						/>
						<span>KG</span>
					</div>
				</div>
			{/if}

			<div>
				<label for="qty-input" class="mb-1 block text-[10px] text-gray-400">Jumlah Label (1-10)</label>
				<input
					id="qty-input"
					type="number"
					min={MIN_QTY}
					max={MAX_QTY}
					class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
					bind:value={printQuantity}
					onchange={clampQty}
				/>
			</div>

			{#if errorMsg}
				<p class="rounded-lg bg-red-50 p-2 text-xs text-red-600">{errorMsg}</p>
			{/if}
			{#if successMsg}
				<p class="rounded-lg bg-green-50 p-2 text-xs text-green-700">{successMsg}</p>
			{/if}

			<button
				class="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 py-2 text-xs font-bold text-white disabled:opacity-60"
				disabled={!canPrint}
				onclick={handlePrint}
			>
				{#if printing}
					<IconLoader2 size={16} class="animate-spin" /> Membuat label…
				{:else}
					<IconPrinter size={16} /> Cetak Label
				{/if}
			</button>
			<p class="text-[10px] text-gray-400">
				Label hanya bisa dicetak untuk SPK yang sudah lolos QC. Kalau SPK tidak muncul di daftar, cek dulu status QC-nya.
			</p>
		</div>
	{/if}
</div>
