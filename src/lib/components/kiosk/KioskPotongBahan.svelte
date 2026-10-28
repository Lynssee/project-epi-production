<!-- src/lib/components/kiosk/KioskPotongBahan.svelte -->
<!-- Potong Bahan via Scan QR, terpadu Ciketing & Balaraja (Fase 7 Unifikasi Workshop). Scan label barang (EPI:ITEM:<id>) -> pilih SPK workshop yang sedang berjalan
     -> isi qty -> stok terpotong seketika. Hanya scan kamera (listener global +layout.svelte mengalihkan kode EPI:ITEM:... dari hardware wedge ke /kiosk/cek-stok). -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { WORKSHOP_KIOSK, type WorkshopKey } from '$lib/kiosk/workshopKiosk';
	import { IconArrowLeft, IconLoader2, IconAlertTriangle, IconCheck, IconScan, IconPackage } from '@tabler/icons-svelte';

	let { workshop = 'ciketing' }: { workshop?: WorkshopKey } = $props();
	const prof = $derived(WORKSHOP_KIOSK[workshop]);

	let QrScannerModal: any = $state(null);
	let showScanner = $state(false);

	type Item = {
		itemId: number;
		identitasBarangId: number;
		namaBarang: string;
		satuan: string;
		stokTersedia: number | null;
	};

	let step = $state<'scan' | 'spk' | 'qty' | 'sukses'>('scan');
	let loading = $state(false);
	let errorMsg = $state('');
	let item = $state<Item | null>(null);
	let spkList = $state<any[]>([]);
	let selectedSpk = $state<any | null>(null);
	let qty = $state('');
	let catatan = $state('');
	let submitting = $state(false);
	let hasilPotong = $state<any | null>(null);

	async function loadScanner() {
		QrScannerModal ??= (await import('$lib/components/scanner/QrScannerModal.svelte')).default;
		showScanner = true;
	}

	async function onScanDetect(raw: string) {
		showScanner = false;
		loading = true;
		errorMsg = '';
		try {
			const res = await fetch(`/api/kiosk/${workshop}/potong-bahan?code=${encodeURIComponent(raw)}`);
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || 'Barang tidak ditemukan.');
			item = data.item;
			await loadSpkList();
			step = 'spk';
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal membaca QR.';
		} finally {
			loading = false;
		}
	}

	async function loadSpkList() {
		const res = await fetch(`/api/kiosk/${workshop}/potong-bahan`);
		const data = await res.json().catch(() => null);
		if (res.ok) spkList = data.spkList || [];
	}

	function pilihSpk(spk: any) {
		selectedSpk = spk;
		step = 'qty';
	}

	function batal() {
		step = 'scan';
		item = null;
		selectedSpk = null;
		qty = '';
		catatan = '';
		errorMsg = '';
	}

	async function submitPotong() {
		if (!item || !selectedSpk) return;
		const qtyNum = parseFloat(qty);
		if (!(qtyNum > 0)) {
			errorMsg = 'Qty harus lebih dari 0.';
			return;
		}
		if (item.stokTersedia === null) {
			errorMsg = 'Stok barang ini belum tercatat. Minta admin melakukan stok awal (stock opname) dulu.';
			return;
		}
		if (qtyNum > item.stokTersedia) {
			errorMsg = `Qty melebihi stok tersedia (${item.stokTersedia} ${item.satuan}).`;
			return;
		}
		submitting = true;
		errorMsg = '';
		try {
			const clientTxnId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			const res = await fetch(`/api/kiosk/${workshop}/potong-bahan`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					code: `EPI:ITEM:${item.identitasBarangId}`,
					projectId: selectedSpk.id,
					projectLabel: selectedSpk.name,
					qty: qtyNum,
					catatan: catatan.trim() || undefined,
					clientTxnId
				})
			});
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || 'Gagal memotong stok.');
			hasilPotong = data;
			step = 'sukses';
			setTimeout(() => {
				batal();
			}, 3500);
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal memotong stok.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="page">
	<header class="topbar">
		<button class="back-btn" onclick={() => (step === 'scan' ? goto('/kiosk/home') : batal())}>
			<IconArrowLeft size={22} />
		</button>
		<div>
			<p class="tag">{prof.tag}</p>
			<h1>Potong Bahan — Scan QR</h1>
		</div>
	</header>

	{#if errorMsg}
		<div class="alert alert-error">
			<IconAlertTriangle size={20} />
			<span>{errorMsg}</span>
		</div>
	{/if}

	{#if step === 'scan'}
		<div class="scan-panel">
			<IconPackage size={56} class="muted-icon" />
			<p class="hint">Scan label QR barang (dari "Cetak Label Barang") untuk mulai potong bahan.</p>
			<button class="btn-primary btn-scan" onclick={loadScanner} disabled={loading}>
				{#if loading}<IconLoader2 size={22} class="spin" />{:else}<IconScan size={22} />{/if}
				Scan QR Barang
			</button>
		</div>
	{:else if step === 'spk' && item}
		<div class="item-card">
			<p class="item-name">{item.namaBarang}</p>
			<p class="item-stock">Stok WS {prof.label}: {#if item.stokTersedia === null}<strong>belum tercatat</strong> — minta admin stok awal (opname){:else if item.stokTersedia < 0}<strong style="color:#b91c1c">−{Math.abs(item.stokTersedia)} {item.satuan} (perlu opname)</strong>{:else}<strong>{item.stokTersedia} {item.satuan}</strong>{/if}</p>
		</div>
		<p class="section-title">Pilih SPK / Project</p>
		{#if spkList.length === 0}
			<p class="hint">Tidak ada SPK {prof.label} berstatus "on progress" saat ini.</p>
		{:else}
			<div class="spk-list">
				{#each spkList as spk}
					<button class="spk-row" onclick={() => pilihSpk(spk)}>
						<span class="spk-name">{spk.name}</span>
						{#if spk.nomor_po}<span class="spk-po">PO: {spk.nomor_po}</span>{/if}
					</button>
				{/each}
			</div>
		{/if}
	{:else if step === 'qty' && item && selectedSpk}
		<div class="item-card">
			<p class="item-name">{item.namaBarang}</p>
			<p class="item-stock">Stok tersedia: {#if item.stokTersedia === null}<strong>belum tercatat</strong>{:else}<strong>{item.stokTersedia} {item.satuan}</strong>{/if}</p>
			<p class="hint">Angka stok berasal dari catatan gudang workshop. Kalau tidak sesuai fisik, laporkan ke admin untuk stock opname.</p>
			<p class="item-spk">SPK: {selectedSpk.name}</p>
		</div>
		<label class="field">
			<span>Qty dipakai ({item.satuan})</span>
			<input type="number" inputmode="decimal" min="0" step="any" bind:value={qty} placeholder="0" class="qty-input" />
		</label>
		<label class="field">
			<span>Catatan (opsional)</span>
			<input type="text" bind:value={catatan} placeholder="mis. campur batch pagi" />
		</label>
		<button class="btn-primary btn-submit" onclick={submitPotong} disabled={submitting}>
			{#if submitting}<IconLoader2 size={22} class="spin" />{:else}<IconCheck size={22} />{/if}
			Potong Stok Sekarang
		</button>
	{:else if step === 'sukses' && hasilPotong}
		<div class="sukses-panel">
			<IconCheck size={64} class="sukses-icon" />
			<p class="sukses-title">Berhasil Dipotong</p>
			<p class="sukses-detail">{hasilPotong.qty} {hasilPotong.satuan} — {hasilPotong.nama_barang}</p>
			<p class="sukses-stock">Sisa stok: {hasilPotong.new_stock} {hasilPotong.satuan}</p>
		</div>
	{/if}
</div>

{#if showScanner && QrScannerModal}
	<QrScannerModal expectedPrefix="EPI:ITEM:" onDetect={onScanDetect} onClose={() => (showScanner = false)} />
{/if}

<style>
	.page {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1rem 1.25rem 2rem;
		max-width: 640px;
		margin: 0 auto;
	}
	.topbar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.back-btn {
		min-width: 48px;
		min-height: 48px;
		display: grid;
		place-items: center;
		border-radius: 999px;
		border: 1px solid #e2e8f0;
		background: white;
		touch-action: manipulation;
	}
	.back-btn:active {
		transform: scale(0.96);
	}
	.tag {
		margin: 0;
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #0f766e;
	}
	h1 {
		margin: 0.1rem 0 0;
		font-size: 1.25rem;
		font-weight: 850;
		color: #0f172a;
	}
	.alert {
		display: flex;
		align-items: flex-start;
		gap: 0.6rem;
		padding: 0.85rem 1rem;
		border-radius: 10px;
		font-size: 0.88rem;
		font-weight: 650;
	}
	.alert-error {
		background: #fef2f2;
		color: #b91c1c;
		border: 1px solid #fecaca;
	}
	.scan-panel {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		padding: 2.5rem 1rem;
		border: 2px dashed #cbd5e1;
		border-radius: 14px;
		text-align: center;
	}
	.hint {
		color: #64748b;
		font-size: 0.88rem;
		margin: 0;
	}
	.btn-primary {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.6rem;
		min-height: 56px;
		padding: 0 1.5rem;
		border-radius: 12px;
		background: #0f766e;
		color: white;
		font-weight: 800;
		font-size: 1rem;
		border: none;
		touch-action: manipulation;
		user-select: none;
	}
	.btn-primary:active {
		transform: scale(0.98);
	}
	.btn-primary:disabled {
		opacity: 0.6;
	}
	.btn-scan {
		width: 100%;
	}
	.item-card {
		padding: 1rem 1.15rem;
		border-radius: 12px;
		background: #f0fdfa;
		border: 1px solid #99f6e4;
	}
	.item-name {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 850;
		color: #0f172a;
	}
	.item-stock,
	.item-spk {
		margin: 0.3rem 0 0;
		font-size: 0.85rem;
		color: #334155;
	}
	.section-title {
		margin: 0.2rem 0 0;
		font-size: 0.85rem;
		font-weight: 800;
		color: #475569;
	}
	.spk-list {
		display: grid;
		gap: 0.6rem;
	}
	.spk-row {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.2rem;
		min-height: 56px;
		padding: 0.75rem 1rem;
		border-radius: 12px;
		border: 1px solid #e2e8f0;
		background: white;
		text-align: left;
		touch-action: manipulation;
	}
	.spk-row:active {
		transform: scale(0.98);
		border-color: #0f766e;
		background: #f0fdfa;
	}
	.spk-name {
		font-weight: 800;
		color: #0f172a;
		font-size: 0.92rem;
	}
	.spk-po {
		font-size: 0.75rem;
		color: #64748b;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		font-size: 0.82rem;
		font-weight: 700;
		color: #475569;
	}
	.field input {
		min-height: 52px;
		padding: 0 1rem;
		border-radius: 10px;
		border: 1px solid #cbd5e1;
		font-size: 1.1rem;
	}
	.qty-input {
		font-weight: 800;
	}
	.btn-submit {
		width: 100%;
		margin-top: 0.3rem;
	}
	.sukses-panel {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 3rem 1rem;
		text-align: center;
	}
	:global(.sukses-icon) {
		color: #059669;
	}
	.sukses-title {
		margin: 0.5rem 0 0;
		font-size: 1.3rem;
		font-weight: 900;
		color: #0f172a;
	}
	.sukses-detail {
		margin: 0.2rem 0 0;
		font-size: 0.95rem;
		color: #334155;
	}
	.sukses-stock {
		margin: 0.2rem 0 0;
		font-size: 0.85rem;
		color: #64748b;
	}
	:global(.spin) {
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
