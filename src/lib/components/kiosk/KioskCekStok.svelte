<!-- src/lib/components/kiosk/KioskCekStok.svelte -->
<!-- Cek stok read-only kiosk, terpadu Ciketing & Balaraja (Fase 7 Unifikasi Workshop). Dipakai rute /kiosk/[workshop]/cek-stok dan rute lama /kiosk/ciketing-cek-stok.
     Operator badge+PIN (bukan login Firebase individual). Stok Balaraja dihitung dari ledger (tidak ada kolom saldo). -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { WORKSHOP_KIOSK, type WorkshopKey } from '$lib/kiosk/workshopKiosk';
	import { onMount } from 'svelte';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';
	import { IconArrowLeft, IconLoader2, IconAlertTriangle, IconSearch, IconAlertCircle } from '@tabler/icons-svelte';

	let { workshop = 'ciketing' }: { workshop?: WorkshopKey } = $props();
	const prof = $derived(WORKSHOP_KIOSK[workshop]);

	type Item = {
		id: number;
		namaBarang: string;
		kode: string | null;
		satuan: string | null;
		stokTersedia: number | null;
		stokMin: number;
	};

	let items = $state<Item[]>([]);
	let loading = $state(true);
	let errorMsg = $state('');
	let query = $state('');

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const res = await fetch(`/api/kiosk/${workshop}/cek-stok`);
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || 'Gagal memuat stok.');
			items = data.items || [];
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal memuat stok.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	let filtered = $derived(
		items.filter((it) => {
			if (!query.trim()) return true;
			const q = query.trim().toLowerCase();
			return it.namaBarang.toLowerCase().includes(q) || (it.kode || '').toLowerCase().includes(q);
		})
	);
</script>

<div class="page">
	<header class="topbar">
		<button class="back-btn" onclick={() => goto('/kiosk/home')}>
			<IconArrowLeft size={22} />
		</button>
		<div>
			<p class="tag">{prof.tag}</p>
			<h1>Cek Stok</h1>
		</div>
	</header>

	{#if errorMsg}
		<div class="alert alert-error">
			<IconAlertTriangle size={20} />
			<span>{errorMsg}</span>
		</div>
	{/if}

	<div class="search-box">
		<IconSearch size={20} class="muted-icon" />
		<input type="text" bind:value={query} placeholder="Cari nama/kode barang..." />
	</div>

	{#if loading}
		<div class="loading"><IconLoader2 size={32} class="spin" /></div>
	{:else if filtered.length === 0}
		<p class="hint" style="text-align:center; padding: 2rem 0;">Tidak ada barang yang cocok.</p>
	{:else}
		<div class="item-list">
			{#each filtered as it (it.id)}
				<div class="item-row">
					<div class="item-info">
						<div class="item-name">{it.namaBarang}</div>
						<div class="item-sub">{it.kode ? it.kode + ' · ' : ''}{it.satuan || ''}</div>
					</div>
					{#if it.stokTersedia === null}
						<Tooltip text="Saldo barang ini belum pernah dicatat. Minta admin melakukan stok awal (stock opname)." position="left"><div class="item-stok belum">Belum tercatat</div></Tooltip>
					{:else if it.stokTersedia < 0}
						<Tooltip text="Saldo minus — catatan tidak sesuai fisik. Laporkan ke admin untuk stock opname." position="left"><div class="item-stok minus"><IconAlertCircle size={16} />−{Math.abs(it.stokTersedia).toLocaleString('id-ID')}<span class="minus-note">perlu opname</span></div></Tooltip>
					{:else}
						<div class="item-stok" class:kritis={it.stokMin > 0 && it.stokTersedia < it.stokMin}>
							{#if it.stokMin > 0 && it.stokTersedia < it.stokMin}<IconAlertCircle size={16} />{/if}
							{it.stokTersedia.toLocaleString('id-ID')}
						</div>
					{/if}
				</div>
			{/each}
		</div>
		<p class="hint" style="margin-top: 0.75rem;">Angka stok berasal dari catatan gudang workshop. Kalau tidak sesuai fisik, laporkan ke admin untuk stock opname.</p>
	{/if}
</div>

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
	.search-box {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.75rem 1rem;
		border: 1px solid #e2e8f0;
		border-radius: 12px;
		background: white;
	}
	.search-box input {
		flex: 1;
		border: none;
		outline: none;
		font-size: 1rem;
		min-height: 32px;
	}
	.loading {
		display: flex;
		justify-content: center;
		padding: 2.5rem 0;
	}
	.item-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	.item-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.85rem 1rem;
		border: 1px solid #e2e8f0;
		border-radius: 12px;
		background: white;
		min-height: 60px;
	}
	.item-name {
		font-weight: 750;
		font-size: 0.95rem;
		color: #0f172a;
	}
	.item-sub {
		font-size: 0.78rem;
		color: #64748b;
		margin-top: 0.15rem;
	}
	.item-stok {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		font-size: 1.1rem;
		font-weight: 800;
		color: #0f172a;
		white-space: nowrap;
	}
	.item-stok.kritis {
		color: #b91c1c;
	}
	.item-stok.belum {
		color: #64748b;
		font-size: 0.85rem;
		font-weight: 700;
	}
	.item-stok.minus {
		color: #b91c1c;
	}
	.minus-note {
		font-size: 0.7rem;
		font-weight: 700;
		background: #fee2e2;
		border-radius: 999px;
		padding: 0.1rem 0.45rem;
	}
	:global(.spin) {
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
