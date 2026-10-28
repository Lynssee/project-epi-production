<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// src/routes/kiosk/gudang/antrian/[id]/+page.svelte
	// Detail satu antrian + ambil barang per item, dari terminal Kiosk Gudang.
	// Fase 3 penajaman kiosk inventory: info lokasi rak, tombol ambil penuh, dan verifikasi barang.
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import {
		IconArrowLeft, IconLoader2, IconRefresh, IconCircleCheck, IconPackageExport,
		IconMapPin, IconExternalLink
	} from '@tabler/icons-svelte';

	interface ItemLokasi {
		gudang_id: number;
		nama_rak: string;
		kode_rak: string | null;
		qty_tercatat?: number;
	}

	interface Item {
		id: number;
		item_id: number | null;
		nama_barang: string;
		qty_required: number;
		qty_delivered: number;
		unit: string;
		stok_tersedia: number | null;
		stok_level: 'hijau' | 'kuning' | 'merah' | 'tidak_diketahui';
		lokasi_rak?: ItemLokasi[];
	}
	interface Detail {
		id: number;
		nomor_pl: string;
		prep_status: string;
		requested_by_department: string;
		destination_pic_name: string;
		request_type: string;
		needed_date: string | null;
		items: Item[];
	}

	const plId = Number(page.params.id);
	let loading = $state(true);
	let loadError = $state('');
	let detail = $state<Detail | null>(null);

	// Per item (keyed by packing_list_items.id)
	let qtyInput = $state<Record<number, number>>({});
	let itemStatus = $state<Record<number, 'idle' | 'sending' | 'done' | 'error'>>({});
	let itemError = $state<Record<number, string>>({});
	let clientTxn = $state<Record<number, string>>({});
	// File 06 §2.3 — rak asal pengambilan per item. null = belum dipilih (>1 rak, wajib pilih)
	// atau memang tidak ada rak (area umum, dengan konfirmasi).
	let selectedRakId = $state<Record<number, number | null>>({});
	let confirmAreaUmum = $state<Record<number, boolean>>({});

	const STOK_COLOR: Record<string, string> = {
		hijau: '#16a34a', kuning: '#d97706', merah: '#dc2626', tidak_diketahui: '#94a3b8'
	};

	async function load() {
		loading = true;
		loadError = '';
		try {
			const res = await fetch(`/api/kiosk/gudang/antrian/${plId}`);
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || `Gagal memuat antrian (${res.status}).`);
			detail = data;
			for (const it of detail!.items) {
				const sisa = Math.max(0, it.qty_required - it.qty_delivered);
				qtyInput[it.id] = sisa;
				itemStatus[it.id] = it.qty_delivered >= it.qty_required ? 'done' : 'idle';
				clientTxn[it.id] = `kioskpick-${plId}-${it.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
				// File 06 §2.3 — hanya 1 rak → otomatis terpilih. >1 rak → operator wajib pilih.
				// Tidak ada rak → tetap null, operator konfirmasi "area umum" secara eksplisit.
				const lok = it.lokasi_rak || [];
				selectedRakId[it.id] = lok.length === 1 ? lok[0].gudang_id : null;
				confirmAreaUmum[it.id] = false;
			}
		} catch (e) {
			loadError = e instanceof Error ? e.message : 'Gagal memuat antrian.';
		} finally {
			loading = false;
		}
	}

	async function ambil(it: Item) {
		itemError[it.id] = '';
		const qty = Number(qtyInput[it.id]) || 0;
		if (qty <= 0) { itemError[it.id] = 'Isi jumlah yang diambil.'; return; }
		const sisa = it.qty_required - it.qty_delivered;
		if (qty > sisa + 0.0001) { itemError[it.id] = `Melebihi sisa yang diminta (sisa ${sisa}).`; return; }
		const lok = it.lokasi_rak || [];
		if (lok.length > 1 && !selectedRakId[it.id]) {
			itemError[it.id] = 'Barang ini ada di beberapa rak. Sentuh rak tempat Anda mengambil barang.';
			return;
		}
		if (lok.length === 0 && !confirmAreaUmum[it.id]) {
			itemError[it.id] = 'Barang ini belum dipetakan ke rak. Tekan "Ambil dari area umum" untuk konfirmasi.';
			return;
		}

		itemStatus[it.id] = 'sending';
		try {
			const res = await fetch(`/api/kiosk/gudang/antrian/${plId}/pick`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					packing_list_item_id: it.id,
					item_id: it.item_id,
					quantity: qty,
					client_txn_id: clientTxn[it.id],
					from_rak_id: selectedRakId[it.id] ?? null
				})
			});
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || `Gagal menyimpan (${res.status}).`);
			itemStatus[it.id] = 'done';
			// Segarkan angka dari server (qty_delivered).
			await load();
		} catch (e) {
			itemStatus[it.id] = 'error';
			itemError[it.id] = e instanceof Error ? e.message : 'Gagal menyimpan.';
		}
	}

	let allDone = $derived(!!detail && detail.items.length > 0 && detail.items.every((i) => i.qty_delivered >= i.qty_required - 0.0001));

	// File 06 §2.3 — scan QR rak fisik langsung memilih rak untuk item yang lokasinya cocok
	// (jika item sedang tampil di daftar dan raknya salah satu lokasi tercatatnya).
	let activeItemId = $state<number | null>(null);
	function onHardwareScan(ev: Event) {
		const { parsed } = (ev as CustomEvent).detail || {};
		if (parsed?.type !== 'LOC' || !detail) return;
		const rakId = Number(parsed.id);
		const target = activeItemId
			? detail.items.find((i) => i.id === activeItemId)
			: detail.items.find((i) => (i.lokasi_rak || []).some((l) => l.gudang_id === rakId));
		if (!target) return;
		const cocok = (target.lokasi_rak || []).some((l) => l.gudang_id === rakId);
		if (!cocok) return;
		ev.preventDefault();
		selectedRakId[target.id] = rakId;
		itemError[target.id] = '';
	}

	onMount(() => {
		load();
		window.addEventListener('kiosk-hardware-scan', onHardwareScan);
		return () => window.removeEventListener('kiosk-hardware-scan', onHardwareScan);
	});
</script>

<div class="wrap">
	<button class="back" onclick={() => goto('/kiosk/gudang/antrian')}>
		<IconArrowLeft size={18} /> Kembali
	</button>

	{#if loading}
		<div class="center py-12 flex justify-center">
			<CircularProgressGauge size={72} strokeWidth={6} label="Memuat Rincian Antrean..." sublabel="Mengambil detail muatan barang" />
		</div>
	{:else if loadError}
		<div class="err-box">
			<p>{loadError}</p>
			<button class="retry" onclick={load}><IconRefresh size={16} /> Coba lagi</button>
		</div>
	{:else if detail}
		<div class="head">
			<h1>{detail.nomor_pl}</h1>
			<p class="sub">
				{detail.request_type || '—'}
				{detail.destination_pic_name ? ` · untuk ${detail.destination_pic_name}` : ''}
				{detail.requested_by_department ? ` · ${detail.requested_by_department}` : ''}
			</p>
		</div>

		{#if allDone}
			<div class="ok-banner">
				<IconCircleCheck size={24} />
				<div class="ok-banner__text">
					<strong>Semua item telah diambil!</strong>
					<p>Barang siap diserahkan ke bagian ekspedisi / pengiriman.</p>
				</div>
				<button class="done-nav-btn" onclick={() => goto('/kiosk/gudang/antrian')}>
					Selesai
				</button>
			</div>
		{/if}

		<div class="list-head">
			<p class="count">{detail.items.length} item perlu disiapkan</p>
		</div>

		<div class="list">
			{#each detail.items as it (it.id)}
				{@const sisa = Math.max(0, it.qty_required - it.qty_delivered)}
				{@const st = itemStatus[it.id]}
				<div class="item" class:done={st === 'done'}>
					<div class="item-top">
						<span class="item-nama">{it.nama_barang}</span>
						<span class="stok-dot" style="background:{STOK_COLOR[it.stok_level]}" title="Status stok"></span>
					</div>

					<!-- File 06 §2.3 — pemilihan rak ASAL pengambilan, bukan sekadar tampilan lokasi.
					     1 rak → otomatis terpilih. >1 rak → wajib pilih (sentuh/scan). 0 rak →
					     konfirmasi eksplisit "area umum" (Aturan #6, tetap ada jalan keluar). -->
					{#if it.lokasi_rak && it.lokasi_rak.length === 1}
						<div class="item-loc" onfocusin={() => (activeItemId = it.id)}>
							<IconMapPin size={13} class="loc-ic" />
							<span class="loc-label">Ambil dari:</span>
							<span class="loc-tag loc-tag--active">{it.lokasi_rak[0].nama_rak} ✓</span>
						</div>
					{:else if it.lokasi_rak && it.lokasi_rak.length > 1}
						<div class="item-loc item-loc--pick">
							<IconMapPin size={13} class="loc-ic" />
							<span class="loc-label">Barang ini ada di beberapa rak. Sentuh rak tempat Anda mengambil:</span>
							<div class="rak-choice-row">
								{#each it.lokasi_rak as loc (loc.gudang_id)}
									<button
										type="button"
										class="rak-choice-btn"
										class:active={selectedRakId[it.id] === loc.gudang_id}
										onclick={() => { activeItemId = it.id; selectedRakId[it.id] = loc.gudang_id; itemError[it.id] = ''; }}
									>
										{loc.nama_rak}{loc.qty_tercatat != null ? ` (${loc.qty_tercatat})` : ''}
									</button>
								{/each}
							</div>
						</div>
					{:else}
						<div class="item-loc item-loc--empty">
							<IconMapPin size={13} class="loc-ic" />
							<span class="loc-label">Belum dipetakan di rak.</span>
							<label class="area-umum-confirm">
								<input type="checkbox" bind:checked={confirmAreaUmum[it.id]} />
								Ambil dari area umum (belum di rak)
							</label>
						</div>
					{/if}

					<div class="item-nums">
						<span>Diminta <strong>{it.qty_required}</strong> {it.unit}</span>
						<span>Sudah <strong>{it.qty_delivered}</strong></span>
						<span>Stok sistem <strong>{it.stok_tersedia ?? '–'}</strong></span>
					</div>

					{#if st === 'done'}
						<div class="item-done"><IconCircleCheck size={16} /> Lengkap diambil</div>
					{:else}
						<div class="item-action">
							<button class="stp" onclick={() => (qtyInput[it.id] = Math.max(0, (Number(qtyInput[it.id]) || 0) - 1))}>−</button>
							<input
								type="number" inputmode="decimal" min="0"
								bind:value={qtyInput[it.id]}
							/>
							<button class="stp" onclick={() => (qtyInput[it.id] = (Number(qtyInput[it.id]) || 0) + 1)}>+</button>
							{#if sisa > 1}
								<button class="fill-sisa-btn" type="button" onclick={() => (qtyInput[it.id] = sisa)}>
									Sisa ({sisa})
								</button>
							{/if}
							<button class="take" disabled={st === 'sending' || sisa <= 0} onclick={() => ambil(it)}>
								{#if st === 'sending'}
									<IconLoader2 size={16} class="spin" />
								{:else}
									<IconPackageExport size={16} /> Ambil
								{/if}
							</button>
						</div>
						{#if it.stok_level === 'merah' || it.stok_level === 'kuning'}
							<p class="stok-warn">
								{it.stok_level === 'merah' ? 'Stok sistem kosong/negatif' : 'Stok sistem kurang dari yang diminta'} — tetap bisa diambil, selisih tercatat.
							</p>
						{/if}
					{/if}

					{#if itemError[it.id]}<p class="item-err">{itemError[it.id]}</p>{/if}
				</div>
			{/each}
		</div>

		<p class="disclaimer">
			Setiap "Ambil" langsung mengurangi stok sistem dan tercatat atas nama badge Anda.
			Foto/GPS tidak diminta di terminal — pastikan barang benar sebelum menekan Ambil.
		</p>
	{/if}
</div>

<style>
	.wrap { padding: 1rem 1.25rem 1.5rem; display: flex; flex-direction: column; gap: 1rem; width: 100%; max-width: 100%; box-sizing: border-box; min-height: 100%; }
	.back { align-self: flex-start; display: flex; align-items: center; gap: 0.4rem; background: none; border: none; color: #475569; font-size: 0.95rem; font-weight: 600; cursor: pointer; padding: 0; }
	.center { display: flex; justify-content: center; padding: 3rem; }
	:global(.spin) { animation: spin 1s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.err-box { text-align: center; color: #dc2626; display: flex; flex-direction: column; gap: 0.75rem; align-items: center; padding: 2rem 1rem; }
	.retry { display: flex; align-items: center; gap: 0.35rem; border: 1px solid #cbd5e1; background: white; color: #475569; border-radius: 0.6rem; padding: 0.5rem 1rem; font-weight: 700; cursor: pointer; }
	.head h1 { font-size: 1.35rem; font-weight: 800; color: #0f172a; margin: 0; }
	.sub { font-size: 0.85rem; color: #64748b; margin: 0.15rem 0 0; }
	.ok-banner {
		display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
		background: #ecfdf5; border: 1px solid #a7f3d0; color: #047857; border-radius: 0.75rem;
		padding: 0.85rem 1.1rem; flex-wrap: wrap;
	}
	.ok-banner__text { flex: 1; min-width: 200px; }
	.ok-banner__text strong { font-size: 0.95rem; font-weight: 800; display: block; }
	.ok-banner__text p { margin: 0.15rem 0 0; font-size: 0.8rem; color: #065f46; }
	.done-nav-btn {
		background: #047857; color: white; border: none; border-radius: 0.5rem;
		padding: 0.5rem 1rem; font-size: 0.85rem; font-weight: 700; cursor: pointer;
	}
	.list-head { display: flex; align-items: center; justify-content: space-between; }
	.count { font-size: 0.75rem; font-weight: 700; text-transform: uppercase; color: #64748b; margin: 0; }
	.list { display: flex; flex-direction: column; gap: 0.6rem; }
	.item { background: white; border: 1px solid #e2e8f0; border-radius: 0.8rem; padding: 0.9rem 1rem; }
	.item.done { background: #f8fafc; opacity: 0.75; }
	.item-top { display: flex; align-items: center; gap: 0.5rem; }
	.item-nama { flex: 1; font-size: 0.95rem; font-weight: 700; color: #0f172a; }
	.stok-dot { width: 10px; height: 10px; border-radius: 999px; flex-shrink: 0; }

	.item-loc {
		display: flex; align-items: center; gap: 0.35rem; margin-top: 0.3rem;
		font-size: 0.78rem; color: #475569; flex-wrap: wrap;
	}
	:global(.loc-ic) { color: #0f766e; flex-shrink: 0; }
	.loc-label { font-weight: 600; color: #64748b; }
	.loc-tag {
		background: #f0fdfa; color: #0f766e; border: 1px solid #ccfbf1;
		border-radius: 4px; padding: 0.1rem 0.4rem; font-weight: 700; text-decoration: none;
	}
	.loc-tag:hover { background: #ccfbf1; }
	.loc-tag--active { }
	.loc-sep { color: #94a3b8; }
	.item-loc--empty { color: #94a3b8; font-style: italic; flex-direction: column; align-items: flex-start; gap: 0.35rem; }
	.item-loc--pick { flex-direction: column; align-items: flex-start; gap: 0.4rem; }
	.rak-choice-row { display: flex; flex-wrap: wrap; gap: 0.4rem; }
	.rak-choice-btn {
		min-height: 44px; padding: 0.4rem 0.8rem; border-radius: 8px;
		border: 1.5px solid #cbd5e1; background: #fff; color: #334155;
		font-weight: 700; font-size: 0.85rem; cursor: pointer;
	}
	.rak-choice-btn.active { background: #0f766e; border-color: #0f766e; color: #fff; }
	.area-umum-confirm { display: flex; align-items: center; gap: 0.4rem; font-style: normal; font-size: 0.8rem; color: #475569; }

	.item-nums { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-top: 0.4rem; font-size: 0.8rem; color: #64748b; }
	.item-action { display: flex; align-items: center; gap: 0.4rem; margin-top: 0.7rem; }
	.stp { width: 40px; height: 44px; border-radius: 0.5rem; border: 1px solid #cbd5e1; background: #f1f5f9; font-size: 1.2rem; font-weight: 800; color: #475569; cursor: pointer; flex-shrink: 0; }
	.item-action input { width: 70px; height: 44px; text-align: center; border: 1px solid #cbd5e1; border-radius: 0.5rem; font-size: 1.05rem; font-weight: 700; min-width: 0; }
	.fill-sisa-btn {
		height: 44px; padding: 0 0.75rem; border-radius: 0.5rem; border: 1px solid #bfdbfe;
		background: #eff6ff; color: #1d4ed8; font-size: 0.8rem; font-weight: 700; cursor: pointer;
		white-space: nowrap;
	}
	.take { flex: 1; height: 44px; display: flex; align-items: center; justify-content: center; gap: 0.35rem; background: #ea580c; color: white; border: none; border-radius: 0.5rem; font-size: 0.95rem; font-weight: 800; cursor: pointer; }
	.take:disabled { opacity: 0.5; }
	.item-done { display: flex; align-items: center; gap: 0.35rem; margin-top: 0.6rem; color: #16a34a; font-weight: 700; font-size: 0.88rem; }
	.stok-warn { font-size: 0.75rem; color: #b45309; margin: 0.4rem 0 0; }
	.item-err { font-size: 0.8rem; color: #dc2626; margin: 0.4rem 0 0; }
	.disclaimer { font-size: 0.78rem; color: #94a3b8; line-height: 1.4; margin: 0.5rem 0 0; }
</style>
