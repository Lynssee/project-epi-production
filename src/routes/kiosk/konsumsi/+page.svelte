<!-- src/routes/kiosk/konsumsi/+page.svelte -->
<!-- Fase 5a, rencana Kiosk Fase 5 (docs/(eh) rencana-kiosk-menu-lain-fase5, repo erp-epi-1).
  Checklist konsumsi bahan baku MURNI INFORMASIONAL -- bahan sudah terpotong dari stok
  otomatis saat Start Production, mencentang di sini TIDAK mengubah stok apa pun. Nol foto,
  nol validasi ketat -- ini pengingat visual, beda karakter dari kiosk QC. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconLoader2, IconAlertTriangle, IconCheck, IconAlertCircle, IconPackageImport } from '@tabler/icons-svelte';
	import { TEKS_KONSUMSI } from '$lib/kiosk/teks';

	type ChecklistItem = {
		material_id: number;
		material_name: string;
		satuan: string;
		total_qty: number;
		checked: boolean;
		checked_by: string | null;
		checked_at: string | null;
	};

	let step = $state<'pilih-spk' | 'checklist'>('pilih-spk');
	let loading = $state(true);
	let errorMsg = $state('');
	let spkList = $state<any[]>([]);
	let selectedSpk = $state<any | null>(null);
	let checklist = $state<ChecklistItem[]>([]);
	let togglingId = $state<number | null>(null);

	// File 09 Tahap 2 — panel lapor per baris: 'kurang' (minta tambahan ke gudang) atau 'sisa'
	// (kembalikan ke stok). Hanya satu baris aktif dalam satu waktu supaya layar tidak penuh.
	let lapor = $state<{ materialId: number; mode: 'kurang' | 'sisa'; qty: string } | null>(null);
	let laporSubmitting = $state(false);
	let laporSukses = $state('');

	async function loadSpkList() {
		loading = true;
		errorMsg = '';
		try {
			const res = await fetch('/api/kiosk/konsumsi');
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || 'Gagal memuat daftar SPK.');
			spkList = data.spkList || [];
			if (spkList.length === 1) {
				await pilihSpk(spkList[0]);
			}
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal memuat daftar SPK.';
		} finally {
			loading = false;
		}
	}

	async function pilihSpk(spk: any) {
		loading = true;
		errorMsg = '';
		try {
			const res = await fetch(`/api/kiosk/konsumsi?spkId=${spk.id}`);
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || 'Gagal memuat checklist.');
			selectedSpk = data.selectedSpk;
			checklist = data.checklist || [];
			step = 'checklist';
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal memuat checklist.';
		} finally {
			loading = false;
		}
	}

	async function toggleItem(item: ChecklistItem) {
		if (!selectedSpk) return;
		const nextChecked = !item.checked;
		togglingId = item.material_id;
		try {
			const res = await fetch('/api/kiosk/konsumsi', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ spkId: selectedSpk.id, materialId: item.material_id, checked: nextChecked })
			});
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || 'Gagal menyimpan.');
			checklist = data.checklist || checklist;
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal menyimpan centang.';
		} finally {
			togglingId = null;
		}
	}

	function bukaLapor(item: ChecklistItem, mode: 'kurang' | 'sisa') {
		laporSukses = '';
		lapor = { materialId: item.material_id, mode, qty: '' };
	}

	function tutupLapor() {
		lapor = null;
	}

	// clientTxnId per kiosk device — dibuat sekali per submit (bukan per halaman) supaya retry
	// jaringan setelah sukses tidak dianggap transaksi baru oleh writeStockMovementServer.
	function buatClientTxnId(): string {
		return typeof crypto?.randomUUID === 'function'
			? crypto.randomUUID()
			: `kiosk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	}

	async function submitLapor() {
		if (!lapor || !selectedSpk) return;
		const qty = Number(lapor.qty);
		if (!(qty > 0)) {
			errorMsg = 'Isi jumlah lebih dari 0 dulu.';
			return;
		}
		const item = checklist.find((c) => c.material_id === lapor!.materialId);
		if (!item) return;

		laporSubmitting = true;
		errorMsg = '';
		try {
			if (lapor.mode === 'kurang') {
				const res = await fetch('/api/kiosk/konsumsi', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						action: 'request_bahan_kurang',
						spkId: selectedSpk.id,
						items: [{ itemId: item.material_id, namaBarang: item.material_name, qty, unit: item.satuan }]
					})
				});
				const data = await res.json().catch(() => null);
				if (!res.ok) throw new Error(data?.message || 'Gagal mengirim permintaan bahan kurang.');
				laporSukses = data.alreadyDone
					? `Permintaan untuk SPK ini sudah ada (${data.nomorPl || '-'}), belum diproses gudang.`
					: `✓ Diminta ke gudang: ${item.material_name} ${qty} ${item.satuan} (${data.nomorPl || '-'}).`;
			} else {
				const res = await fetch('/api/kiosk/konsumsi', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						action: 'catat_sisa_bahan',
						spkId: selectedSpk.id,
						itemId: item.material_id,
						qty,
						clientTxnId: buatClientTxnId()
					})
				});
				const data = await res.json().catch(() => null);
				if (!res.ok) throw new Error(data?.message || 'Gagal mencatat sisa bahan.');
				laporSukses = `✓ Sisa ${qty} ${item.satuan} ${item.material_name} sudah masuk stok gudang.`;
			}
			lapor = null;
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal mengirim laporan.';
		} finally {
			laporSubmitting = false;
		}
	}

	onMount(loadSpkList);
</script>

<div class="wrap">
	<div class="header">
		<button
			class="back"
			onclick={() => (step === 'pilih-spk' ? goto('/kiosk/home') : (step = 'pilih-spk'))}
		>
			<IconArrowLeft size={22} />
		</button>
		<h1>{TEKS_KONSUMSI.labelBeranda}</h1>
	</div>

	{#if errorMsg}<div class="error"><IconAlertTriangle size={18} />{errorMsg}</div>{/if}
	{#if laporSukses}<div class="sukses"><IconCheck size={18} />{laporSukses}</div>{/if}

	{#if loading}
		<div class="py-12 flex justify-center">
			<CircularProgressGauge size={72} strokeWidth={6} label="Memuat Daftar SPK..." sublabel="Mengambil data produksi aktif" />
		</div>
	{:else if step === 'pilih-spk'}
		<p class="hint">Centang bahan yang sudah Anda terima di lini produksi. Ini hanya pengingat — stok sudah dipotong gudang waktu produksi dimulai.</p>
		{#if spkList.length === 0}
			<div class="empty-state">Tidak ada SPK sedang produksi (in_progress) saat ini.</div>
		{:else}
			<div class="spk-list">
				{#each spkList as spk}
					<button class="spk-btn" onclick={() => pilihSpk(spk)}>
						<strong>{spk.nomor}</strong>
						<span>{spk.product_id?.nama_barang_lengkap || '-'}</span>
					</button>
				{/each}
			</div>
		{/if}
	{:else if step === 'checklist'}
		<p class="spk-current">{selectedSpk?.nomor} — {selectedSpk?.product_id?.nama_barang_lengkap || '-'}</p>
		<p class="hint">Ada masalah bahan? Pakai tombol ⚠️ Kurang / 📦 Sisa di baris bahan yang bersangkutan.</p>
		{#if checklist.length === 0}
			<div class="empty-state">Belum ada catatan konsumsi bahan untuk SPK ini.</div>
		{:else}
			<div class="item-list">
				{#each checklist as item (item.material_id)}
					<div class="item-block">
						<button
							class="item-row"
							class:checked={item.checked}
							disabled={togglingId === item.material_id}
							onclick={() => toggleItem(item)}
						>
							<span class="check-box">
								{#if togglingId === item.material_id}
									<IconLoader2 size={18} class="animate-spin" />
								{:else if item.checked}
									<IconCheck size={18} />
								{/if}
							</span>
							<span class="item-info">
								<strong>{item.material_name}</strong>
								<span class="item-qty">{item.total_qty} {item.satuan}</span>
							</span>
						</button>
						<div class="lapor-actions">
							<button class="lapor-btn kurang" onclick={() => bukaLapor(item, 'kurang')}>
								<IconAlertCircle size={16} /> Bahan kurang
							</button>
							<button class="lapor-btn sisa" onclick={() => bukaLapor(item, 'sisa')}>
								<IconPackageImport size={16} /> Ada sisa
							</button>
						</div>

						{#if lapor && lapor.materialId === item.material_id}
							<div class="lapor-panel">
								<p class="lapor-title">
									{lapor.mode === 'kurang'
										? `Berapa ${item.material_name} yang kurang? Gudang akan diminta menambah.`
										: `Berapa sisa ${item.material_name} yang dikembalikan? Langsung masuk stok gudang.`}
								</p>
								<div class="lapor-input-row">
									<input
										type="number"
										inputmode="decimal"
										min="0"
										step="any"
										placeholder={`Jumlah (${item.satuan})`}
										bind:value={lapor.qty}
										disabled={laporSubmitting}
									/>
									<span class="unit">{item.satuan}</span>
								</div>
								<div class="lapor-buttons">
									<button class="btn-batal" onclick={tutupLapor} disabled={laporSubmitting}>Batal</button>
									<button class="btn-kirim" onclick={submitLapor} disabled={laporSubmitting}>
										{#if laporSubmitting}<IconLoader2 size={16} class="animate-spin" />{:else}Kirim{/if}
									</button>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	.wrap { padding: 1rem 1.25rem 1.5rem; display: flex; flex-direction: column; gap: 1rem; width: 100%; max-width: 100%; box-sizing: border-box; min-height: 100%; }
	.header { display: flex; align-items: center; gap: 0.75rem; }
	.back { background: #e2e8f0; border: none; border-radius: 0.5rem; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center; cursor: pointer; }
	h1 { font-size: 1.35rem; font-weight: 800; margin: 0; color: #0f172a; }
	.center { display: flex; justify-content: center; padding: 3rem; }
	.hint { color: #475569; font-size: 0.95rem; margin: 0; }
	.error { background: #fef2f2; color: #b91c1c; padding: 0.75rem; border-radius: 0.5rem; display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; }
	.sukses { background: #f0fdf4; color: #15803d; padding: 0.75rem; border-radius: 0.5rem; display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; }
	.empty-state { background: #f1f5f9; border: 1px dashed #cbd5e1; border-radius: 0.75rem; padding: 1.5rem; text-align: center; color: #64748b; }

	.spk-list { display: flex; flex-direction: column; gap: 0.75rem; }
	.spk-btn { display: flex; flex-direction: column; align-items: flex-start; gap: 0.15rem; padding: 1rem 1.25rem; border-radius: 0.75rem; border: 2px solid #cbd5e1; background: white; cursor: pointer; font-size: 1rem; }
	.spk-btn strong { font-size: 1.05rem; }
	.spk-btn span { color: #64748b; }

	.spk-current { font-weight: 700; color: #0f172a; font-size: 1.05rem; margin: 0; }
	.item-list { display: flex; flex-direction: column; gap: 0.6rem; }
	.item-row {
		display: flex; align-items: center; gap: 0.75rem; padding: 1rem; border-radius: 0.75rem;
		border: 2px solid #e2e8f0; background: white; cursor: pointer; text-align: left; width: 100%;
	}
	.item-row.checked { border-color: #0d9488; background: #f0fdfa; }
	.item-row:disabled { opacity: 0.7; }
	.check-box {
		width: 32px; height: 32px; border-radius: 0.5rem; border: 2px solid #cbd5e1; flex-shrink: 0;
		display: flex; align-items: center; justify-content: center; color: #0d9488;
	}
	.item-row.checked .check-box { border-color: #0d9488; background: #0d9488; color: white; }
	.item-info { display: flex; flex-direction: column; gap: 0.1rem; }
	.item-info strong { font-size: 1rem; color: #0f172a; }
	.item-qty { font-size: 0.85rem; color: #64748b; }

	.item-block { display: flex; flex-direction: column; gap: 0.4rem; }
	.lapor-actions { display: flex; gap: 0.5rem; padding-left: 0.25rem; }
	.lapor-btn {
		display: flex; align-items: center; gap: 0.35rem; font-size: 0.85rem; padding: 0.5rem 0.75rem;
		border-radius: 0.5rem; border: 1.5px solid #e2e8f0; background: white; cursor: pointer; color: #334155;
	}
	.lapor-btn.kurang { border-color: #fbbf24; color: #92400e; }
	.lapor-btn.sisa { border-color: #38bdf8; color: #075985; }
	.lapor-panel { background: #f8fafc; border: 1.5px solid #cbd5e1; border-radius: 0.75rem; padding: 0.9rem; display: flex; flex-direction: column; gap: 0.6rem; }
	.lapor-title { margin: 0; font-size: 0.9rem; color: #334155; }
	.lapor-input-row { display: flex; align-items: center; gap: 0.5rem; }
	.lapor-input-row input {
		flex: 1; font-size: 1.1rem; padding: 0.6rem 0.75rem; border-radius: 0.5rem; border: 2px solid #cbd5e1;
		box-sizing: border-box;
	}
	.lapor-input-row .unit { color: #64748b; font-weight: 600; }
	.lapor-buttons { display: flex; gap: 0.5rem; justify-content: flex-end; }
	.btn-batal, .btn-kirim {
		padding: 0.6rem 1.1rem; border-radius: 0.5rem; border: none; cursor: pointer; font-size: 0.95rem; font-weight: 600;
		display: flex; align-items: center; gap: 0.35rem;
	}
	.btn-batal { background: #e2e8f0; color: #334155; }
	.btn-kirim { background: #0d9488; color: white; }
	.btn-batal:disabled, .btn-kirim:disabled { opacity: 0.6; }
</style>
