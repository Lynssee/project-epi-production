<!-- src/routes/(app)/proyek/[project_id]/coating-log/+page.svelte -->
<!-- Coating/Application Log (Quality Management Proyek v2, Fase 5 opsional — 10 Agustus 2026). -->
<!-- batch_no dari supplier WAJIB (traceability). DFT/ambient tidak diulang di sini — sudah ada -->
<!-- di laporan inspeksi (Report menu). -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { getProjectById } from '$lib/services/projects';
	import { createCoatingLog, fetchProjectCoatingLogs } from '$lib/services/projectCoatingLogApi';
	import { fetchGrandPoLapangan } from '$lib/services/grandPoLapangan';
	import type { PilihanProduk } from '$lib/utils/grandPoLapangan';
	import { IconArrowLeft, IconLoader2 } from '@tabler/icons-svelte';

	let projectId = $derived($page.params.project_id as string);
	let loading = $state(true);
	let project = $state<any>(null);
	let logs = $state<any[]>([]);

	let showForm = $state(false);
	let saving = $state(false);
	let form = $state({ batchNo: '', supplierName: '', productName: '', qtyUsed: '', satuan: '', notes: '' });

	// Grand PO Fase 6: produk dari PO material yang memasok proyek ini (opsional; kosong = isian bebas seperti biasa).
	let pilihanProduk = $state<PilihanProduk[]>([]);
	let selectedProductId = $state('');
	let pilihanError = $state('');
	const selectedProduk = $derived(pilihanProduk.find((p) => String(p.product_id) === selectedProductId) || null);

	function onPilihProduk() {
		const p = selectedProduk;
		if (p) {
			form.productName = p.nama_barang;
			form.satuan = p.unit; // satuan dikunci ke satuan PO agar rekonsiliasi konsisten
		}
	}

	async function load() {
		loading = true;
		try {
			const [proj, list] = await Promise.all([getProjectById(projectId), fetchProjectCoatingLogs(Number(projectId))]);
			project = proj;
			logs = list as any[];
		} finally {
			loading = false;
		}
		loadPilihanProduk();
	}

	/** Best-effort: gagal memuat pilihan TIDAK menghalangi pencatatan (isian bebas tetap jalan), tapi tidak disembunyikan. */
	async function loadPilihanProduk() {
		pilihanError = '';
		try {
			const gp = await fetchGrandPoLapangan(Number(projectId));
			pilihanProduk = gp?.pilihan_produk || [];
		} catch (e) {
			console.error('[coating-log] gagal memuat pilihan produk PO material:', e);
			pilihanProduk = [];
			pilihanError = 'Daftar produk PO material belum bisa dimuat — isi nama produk manual.';
		}
	}

	onMount(load);

	async function submit() {
		if (!form.batchNo.trim()) return;
		saving = true;
		try {
			await createCoatingLog({
				projectId: Number(projectId),
				batchNo: form.batchNo.trim(),
				supplierName: form.supplierName || undefined,
				productName: form.productName || undefined,
				productId: selectedProduk ? selectedProduk.product_id : undefined,
				qtyUsed: form.qtyUsed ? Number(form.qtyUsed) : undefined,
				satuan: form.satuan || undefined,
				notes: form.notes || undefined,
				createdByName: $authStore.karyawanName || undefined
			});
			form = { batchNo: '', supplierName: '', productName: '', qtyUsed: '', satuan: '', notes: '' };
			selectedProductId = '';
			showForm = false;
			await load();
		} finally {
			saving = false;
		}
	}
</script>

<div class="mx-auto max-w-lg p-4 pb-24">
	<button class="mb-3 flex items-center gap-1 text-sm text-gray-500" onclick={() => goto(`/proyek/${projectId}`)}>
		<IconArrowLeft size={16} /> Kembali ke Proyek
	</button>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-12">
		<CircularProgressGauge size={52} strokeWidth={4} label="Memuat coating log harian..." />
	</div>
	{:else}
		<h1 class="text-lg font-bold text-gray-900">Coating / Application Log</h1>
		<p class="mb-4 text-sm text-gray-500">{project?.name || '-'}</p>

		<div class="mb-4 flex items-center justify-between">
			<span class="text-xs text-gray-400">{logs.length} entri</span>
			<button class="text-xs font-semibold text-blue-600" onclick={() => (showForm = !showForm)}>
				{showForm ? 'Batal' : '+ Catat Batch'}
			</button>
		</div>

		{#if showForm}
			<div class="mb-4 space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
				<input type="text" class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" placeholder="Nomor batch/lot dari supplier (wajib)" bind:value={form.batchNo} />
				<input type="text" class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" placeholder="Nama supplier" bind:value={form.supplierName} />
				{#if pilihanProduk.length}
					<div data-testid="coating-produk-po">
						<select class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" bind:value={selectedProductId} onchange={onPilihProduk}>
							<option value="">Bukan dari PO customer / isi manual</option>
							{#each pilihanProduk as p (p.product_id)}
								<option value={String(p.product_id)}>{p.nama_barang} ({p.unit})</option>
							{/each}
						</select>
						<p class="mt-1 text-[11px] text-gray-400">Pilih produk dari PO material customer agar pemakaian tercatat & terhitung di panel Dikirim vs Dipakai vs Sisa. Satuan otomatis mengikuti PO.</p>
					</div>
				{:else if pilihanError}
					<p class="text-[11px] text-amber-600" data-testid="coating-pilihan-error">{pilihanError}</p>
				{/if}
				<input type="text" class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" placeholder="Nama produk/jenis cat" bind:value={form.productName} readonly={!!selectedProduk} />
				<div class="flex gap-2">
					<input type="number" class="flex-1 rounded-lg border border-gray-200 px-2 py-1.5 text-sm" placeholder="Qty terpakai" bind:value={form.qtyUsed} />
					<input type="text" class="w-24 rounded-lg border border-gray-200 px-2 py-1.5 text-sm" placeholder="Satuan" bind:value={form.satuan} readonly={!!selectedProduk} />
				</div>
				<textarea class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" rows="2" placeholder="Catatan (opsional)" bind:value={form.notes}></textarea>
				<button class="w-full rounded-lg bg-blue-600 py-1.5 text-xs font-bold text-white disabled:opacity-60" disabled={saving} onclick={submit}>
					{saving ? '…' : 'Simpan'}
				</button>
			</div>
		{/if}

		<div class="space-y-2">
			{#each logs as log (log.id)}
				<div class="rounded-lg border border-gray-100 bg-white p-3 text-xs">
					<div class="flex items-center justify-between">
						<span class="font-mono font-semibold text-gray-700">{log.batch_no}</span>
						<span class="text-gray-400">{log.date_applied}</span>
					</div>
					{#if log.product_name}<p class="mt-1 text-gray-600">{log.product_name}{log.supplier_name ? ` — ${log.supplier_name}` : ''}</p>{/if}
					{#if log.qty_used}<p class="text-gray-400">{log.qty_used} {log.satuan || ''}</p>{/if}
				</div>
			{:else}
				<p class="text-xs text-gray-400">Belum ada catatan coating log.</p>
			{/each}
		</div>
	{/if}
</div>
