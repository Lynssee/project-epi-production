<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// src/routes/kiosk/gudang/+page.svelte
	// Sub-hub "Menu Gudang" untuk terminal Kiosk Gudang: Cek Stok Rak, Antrian, Persiapan, Opname.
	// Fase 3, rencana "Penajaman Kiosk Inventory — Cek Lokasi Rak & Qty Barang" (8 Sep 2026).
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		IconArrowLeft,
		IconBuildingWarehouse,
		IconListDetails,
		IconClipboardList,
		IconClipboardCheck,
		IconChevronRight,
		IconLoader2,
		IconMap2,
		IconInfoCircle,
		IconArrowsExchange,
		IconTruckDelivery,
		IconPackageImport,
		IconTruckLoading
	} from '@tabler/icons-svelte';
	import { PROFIL_LABEL, menusForProfil, type ProfilKiosk, type MenuGudangKey } from '$lib/kiosk/profilGudang';
	import { TEKS_GUDANG } from '$lib/kiosk/teks';

	let loading = $state(true);
	let antrianCount = $state(0);
	let hqEnabled = $state(false);
	let hubEnabled = $state(true);

	// Lokasi terminal (gudang tempat kiosk ini berdiri) → menentukan profil RM / FG / Central.
	// Dipilih sekali per perangkat & diingat di localStorage; pemetaan gudang→profil diatur admin
	// (system_settings inventory.kiosk.profil_gudang), bukan hardcode. Belum dipilih/dipetakan → semua menu tampil.
	const LS_KEY = 'kiosk_gudang_terminal_id';
	let terminalOptions = $state<Array<{ id: number; nama: string; profil: ProfilKiosk | null }>>([]);
	let terminalId = $state<number | null>(null);
	let profil = $state<ProfilKiosk | null>(null);
	let menus = $state<MenuGudangKey[]>(menusForProfil(null));
	// File 07 §2.4 — hak akses per karyawan (kiosk_menu_access), SELAIN filter profil lokasi
	// (RM/FG/Central) yang sudah ada di atas. Tile yang endpoint-nya digerbangi §2.2 disaring
	// dua kali: profil lokasi DAN akses ini.
	let menuAccess = $state<string[]>([]);
	// Peta memang cuma read-only denah, tidak digerbangi endpoint apa pun — selalu boleh dilihat.
	const TILE_MENU_KEY: Partial<Record<MenuGudangKey, string>> = {
		'cek-stok': 'gudang_stok',
		antrian: 'gudang_pick',
		opname: 'gudang_opname',
		konsumsi: 'konsumsi_bahan',
		'fg-terima': 'fg_receive',
		'muat-sj': 'muat_sj',
		transfer: 'gudang_transfer'
	};

	async function loadProfil(id: number | null) {
		try {
			const res = await fetch('/api/kiosk/gudang/profil' + (id ? `?gudang_id=${id}` : ''));
			if (!res.ok) return;
			const data = await res.json();
			terminalOptions = data.options || [];
			profil = data.profil ?? null;
			menus = data.menus?.length ? data.menus : menusForProfil(null);
			menuAccess = data.menuAccess || [];
		} catch {
			/* offline / gagal: tetap semua menu */
		}
	}

	function pilihTerminal(e: Event) {
		const v = Number((e.currentTarget as HTMLSelectElement).value);
		terminalId = v > 0 ? v : null;
		try {
			if (terminalId) localStorage.setItem(LS_KEY, String(terminalId));
			else localStorage.removeItem(LS_KEY);
		} catch {
			/* private mode — pilihan tidak diingat */
		}
		loadProfil(terminalId);
	}

	onMount(async () => {
		try {
			const saved = Number(localStorage.getItem(LS_KEY));
			terminalId = Number.isFinite(saved) && saved > 0 ? saved : null;
		} catch {
			terminalId = null;
		}
		loadProfil(terminalId);
		try {
			const res = await fetch('/api/kiosk/gudang/antrian');
			if (res.ok) {
				const data = await res.json();
				antrianCount = (data.rows || []).length;
				hqEnabled = data.gate?.gudang_hq_enabled ?? false;
				hubEnabled = data.gate?.persiapan_hub_enabled ?? true;
			}
		} finally {
			loading = false;
		}
	});

	const tiles = $derived([
		{
			key: 'cek-stok' as MenuGudangKey,
			href: '/kiosk/cek-stok',
			tag: 'Lokasi & Qty',
			label: 'Cek Stok Rak',
			desc: 'Lihat isi rak, cari posisi barang & pindah rak fisik',
			icon: IconBuildingWarehouse,
			theme: 'emerald',
			show: true,
			badge: 0
		},
		{
			key: 'peta' as MenuGudangKey,
			href: '/kiosk/gudang/peta',
			tag: 'Denah & Tata Letak',
			label: 'Peta Gudang',
			desc: 'Denah interaktif & hierarki pohon rak gudang',
			icon: IconMap2,
			theme: 'blue',
			show: true,
			badge: 0
		},
		{
			key: 'antrian' as MenuGudangKey,
			href: '/kiosk/gudang/antrian',
			tag: 'Permintaan Barang',
			label: 'Ambil Barang untuk Permintaan',
			desc: 'Daftar permintaan barang dari pusat yang harus disiapkan',
			icon: IconListDetails,
			theme: 'amber',
			show: hqEnabled,
			badge: antrianCount
		},
		{
			key: 'persiapan' as MenuGudangKey,
			href: '/kiosk/gudang/persiapan',
			tag: 'Produksi & Material',
			label: 'Persiapan Harian',
			desc: 'Reservasi bahan baku SPK, reorder alert & barang jadi',
			icon: IconClipboardList,
			theme: 'purple',
			show: hubEnabled,
			badge: 0
		},
		{
			key: 'opname' as MenuGudangKey,
			href: '/kiosk/gudang/opname',
			tag: 'Audit Stok',
			label: 'Hitung Stok Rak',
			desc: 'Cocokkan hitungan fisik rak dengan catatan sistem',
			icon: IconClipboardCheck,
			theme: 'rose',
			show: hqEnabled,
			badge: 0
		},
		{
			key: 'konsumsi' as MenuGudangKey,
			href: '/kiosk/konsumsi',
			tag: 'Bahan Baku',
			label: 'Cek Kelengkapan Bahan',
			desc: 'Centang bahan yang sudah ada di lini. Tidak mengubah stok.',
			icon: IconPackageImport,
			theme: 'purple',
			show: true,
			badge: 0
		},
		{
			key: 'fg-terima' as MenuGudangKey,
			href: '/kiosk/fg-terima',
			tag: 'Barang Jadi',
			label: 'Terima Barang Jadi',
			desc: 'Terima finish good dari produksi/QC ke gudang',
			icon: IconTruckLoading,
			theme: 'emerald',
			show: true,
			badge: 0
		},
		{
			key: 'muat-sj' as MenuGudangKey,
			href: '/kiosk/muat-sj',
			tag: 'Pengiriman',
			label: 'Muat & Surat Jalan',
			desc: 'Alokasi & muat barang jadi ke Surat Jalan',
			icon: IconTruckDelivery,
			theme: 'blue',
			show: true,
			badge: 0
		},
		{
			key: 'transfer' as MenuGudangKey,
			href: '/kiosk/gudang/transfer',
			tag: 'Antar Gudang',
			label: 'Transfer Antar Gudang',
			desc: 'Ajukan, setujui & terima perpindahan barang antar gudang',
			icon: IconArrowsExchange,
			theme: 'amber',
			show: true,
			badge: 0
		}
	]);
</script>

<div class="wrap">
	<div class="header-nav">
		<button class="back-btn" onclick={() => goto('/kiosk/home')} aria-label="Kembali ke Beranda">
			<IconArrowLeft size={20} />
			<span>Kembali</span>
		</button>
		<div class="module-chip">
			<span class="chip-dot"></span>
			<span>Terminal Logistik</span>
		</div>
	</div>

	<div class="header-content">
		<div class="title-row">
			<h1>Menu Gudang</h1>
		</div>
		<p class="hint">
			Pilih tugas operasional. Semua tindakan tercatat atas nama badge yang sedang login di terminal ini.
		</p>
		<div class="terminal-row">
			<label for="terminal-gudang">Terminal ini di gudang:</label>
			<select id="terminal-gudang" value={terminalId ?? ''} onchange={pilihTerminal}>
				<option value="">— belum dipilih (semua menu) —</option>
				{#each terminalOptions as g (g.id)}
					<option value={g.id}>{g.nama}{g.profil ? ` · ${PROFIL_LABEL[g.profil]}` : ''}</option>
				{/each}
			</select>
			{#if profil}<span class="profil-chip">Profil: {PROFIL_LABEL[profil]}</span>{/if}
		</div>
		<p class="hint small">
			Pilih sekali — menu menyesuaikan jenis gudang (Raw Material / Finish Good / Central). Pemetaan diatur admin di
			Setelan Inventory (grup Terminal Kiosk Gudang); bila belum dipetakan, semua menu tampil.
		</p>
	</div>

	{#if loading}
		<div class="center py-12 flex justify-center">
			<CircularProgressGauge size={72} strokeWidth={6} label="Memuat Menu Gudang..." sublabel="Memeriksa otorisasi kiosk" />
		</div>
	{:else}
		<div class="tiles-grid">
			{#each tiles.filter((t) => t.show && menus.includes(t.key) && (!TILE_MENU_KEY[t.key] || menuAccess.includes(TILE_MENU_KEY[t.key]))) as t (t.key)}
				<button class="tile-card theme-{t.theme}" onclick={() => goto(t.href)}>
					<div class="tile-icon-box">
						<t.icon size={30} stroke-width={2.2} />
					</div>

					<div class="tile-content">
						<div class="tile-meta">
							<span class="tile-tag">{t.tag}</span>
							{#if t.badge > 0}
								<span class="badge-counter">
									<span class="badge-pulse"></span>
									{t.badge} antrian
								</span>
							{/if}
						</div>
						<h2 class="tile-title">{t.label}</h2>
						<p class="tile-desc">{t.desc}</p>
					</div>

					<div class="tile-action">
						<IconChevronRight size={22} class="tile-arrow" />
					</div>
				</button>
			{/each}
		</div>

		{#if !hqEnabled}
			<div class="alert-box" title="inventory.gudang_hq.enabled">
				<IconInfoCircle size={22} class="alert-icon" />
				<div class="alert-text">
					<strong>Fitur Pusat Dibatasi</strong>
					<p>{TEKS_GUDANG.modulBelumAktif}</p>
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.terminal-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		margin-top: 0.6rem;
		font-size: 0.9rem;
		font-weight: 600;
		color: #334155;
	}
	.terminal-row select {
		padding: 0.5rem 0.75rem;
		border: 1px solid #cbd5e1;
		border-radius: 0.6rem;
		background: #fff;
		font-size: 0.9rem;
		min-height: 44px;
	}
	.profil-chip {
		background: #e0f2fe;
		color: #075985;
		border-radius: 9999px;
		padding: 0.25rem 0.7rem;
		font-size: 0.8rem;
	}
	.hint.small {
		font-size: 0.78rem;
		opacity: 0.8;
	}

	.wrap {
		padding: 1rem 1.25rem 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		width: 100%;
		max-width: 100%;
		margin: 0;
		box-sizing: border-box;
		min-height: 100%;
	}

	.header-nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.back-btn {
		display: inline-flex;
		align-items: center;
		gap: 0.5rem;
		background: #ffffff;
		border: 1px solid #cbd5e1;
		color: #334155;
		font-size: 0.95rem;
		font-weight: 700;
		cursor: pointer;
		padding: 0.55rem 1rem 0.55rem 0.75rem;
		border-radius: 9999px;
		box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
		transition: all 0.15s ease-out;
		touch-action: manipulation;
		user-select: none;
	}
	.back-btn:hover {
		background: #f1f5f9;
		color: #0f172a;
		border-color: #94a3b8;
	}
	.back-btn:active {
		transform: scale(0.97);
		background: #e2e8f0;
	}

	.module-chip {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		background: #f1f5f9;
		border: 1px solid #e2e8f0;
		color: #475569;
		padding: 0.35rem 0.85rem;
		border-radius: 9999px;
		font-size: 0.8rem;
		font-weight: 700;
		letter-spacing: 0.02em;
	}
	.chip-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #0ea5e9;
	}

	.header-content {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.title-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	h1 {
		font-size: 1.75rem;
		font-weight: 800;
		color: #0f172a;
		margin: 0;
		letter-spacing: -0.02em;
	}
	.hint {
		font-size: 0.95rem;
		color: #64748b;
		margin: 0;
		line-height: 1.45;
	}

	.center {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 4rem 1rem;
		color: #64748b;
	}
	.loading-text {
		font-size: 0.95rem;
		font-weight: 600;
	}
	:global(.spin) {
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	/* Tiles Responsive Grid */
	.tiles-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1rem;
	}
	@media (min-width: 640px) {
		.tiles-grid {
			grid-template-columns: repeat(2, 1fr);
			gap: 1.15rem;
		}
	}

	/* Tile Card Base */
	.tile-card {
		display: flex;
		align-items: center;
		gap: 1.15rem;
		width: 100%;
		text-align: left;
		background: #ffffff;
		border: 1.5px solid #e2e8f0;
		border-radius: 1.15rem;
		padding: 1.25rem 1.35rem;
		cursor: pointer;
		box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04), 0 4px 10px rgba(15, 23, 42, 0.03);
		transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
		position: relative;
		touch-action: manipulation;
		user-select: none;
		box-sizing: border-box;
	}
	.tile-card:hover {
		transform: translateY(-2px);
		box-shadow: 0 10px 25px -5px rgba(15, 23, 42, 0.08), 0 8px 10px -6px rgba(15, 23, 42, 0.04);
	}
	.tile-card:active {
		transform: scale(0.985);
		box-shadow: 0 2px 6px rgba(15, 23, 42, 0.06);
	}

	/* Tile Icon Box */
	.tile-icon-box {
		width: 56px;
		height: 56px;
		border-radius: 0.95rem;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: transform 0.15s ease;
	}
	.tile-card:hover .tile-icon-box {
		transform: scale(1.05);
	}

	/* Tile Content */
	.tile-content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}
	.tile-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.tile-tag {
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.tile-title {
		font-size: 1.15rem;
		font-weight: 800;
		color: #0f172a;
		margin: 0;
		line-height: 1.3;
	}
	.tile-desc {
		font-size: 0.85rem;
		color: #64748b;
		font-weight: 500;
		line-height: 1.35;
		margin: 0;
	}

	/* Action Chevron */
	.tile-action {
		width: 38px;
		height: 38px;
		border-radius: 50%;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #94a3b8;
		flex-shrink: 0;
		transition: all 0.18s ease;
	}
	.tile-card:hover .tile-action {
		color: #0f172a;
		border-color: #cbd5e1;
		transform: translateX(2px);
	}

	/* Badge Counter */
	.badge-counter {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		background: #ffedd5;
		color: #c2410c;
		border: 1px solid #fed7aa;
		font-size: 0.75rem;
		font-weight: 800;
		border-radius: 9999px;
		padding: 0.1rem 0.6rem;
		letter-spacing: 0.01em;
	}
	.badge-pulse {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #ea580c;
		box-shadow: 0 0 0 2px rgba(234, 88, 12, 0.25);
	}

	/* Themes */
	/* Emerald */
	.theme-emerald .tile-icon-box {
		background: #ecfdf5;
		border: 1px solid #a7f3d0;
		color: #059669;
	}
	.theme-emerald .tile-tag {
		color: #059669;
	}
	.theme-emerald:hover {
		border-color: #10b981;
	}
	.theme-emerald:hover .tile-action {
		background: #ecfdf5;
		color: #059669;
	}

	/* Blue */
	.theme-blue .tile-icon-box {
		background: #eff6ff;
		border: 1px solid #bfdbfe;
		color: #2563eb;
	}
	.theme-blue .tile-tag {
		color: #2563eb;
	}
	.theme-blue:hover {
		border-color: #3b82f6;
	}
	.theme-blue:hover .tile-action {
		background: #eff6ff;
		color: #2563eb;
	}

	/* Amber */
	.theme-amber .tile-icon-box {
		background: #fffbeb;
		border: 1px solid #fde68a;
		color: #d97706;
	}
	.theme-amber .tile-tag {
		color: #d97706;
	}
	.theme-amber:hover {
		border-color: #f59e0b;
	}
	.theme-amber:hover .tile-action {
		background: #fffbeb;
		color: #d97706;
	}

	/* Purple */
	.theme-purple .tile-icon-box {
		background: #faf5ff;
		border: 1px solid #e9d5ff;
		color: #7c3aed;
	}
	.theme-purple .tile-tag {
		color: #7c3aed;
	}
	.theme-purple:hover {
		border-color: #8b5cf6;
	}
	.theme-purple:hover .tile-action {
		background: #faf5ff;
		color: #7c3aed;
	}

	/* Rose */
	.theme-rose .tile-icon-box {
		background: #fff1f2;
		border: 1px solid #fecdd3;
		color: #e11d48;
	}
	.theme-rose .tile-tag {
		color: #e11d48;
	}
	.theme-rose:hover {
		border-color: #f43f5e;
	}
	.theme-rose:hover .tile-action {
		background: #fff1f2;
		color: #e11d48;
	}

	/* Alert Box */
	.alert-box {
		display: flex;
		gap: 0.85rem;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-left: 4px solid #94a3b8;
		border-radius: 0.85rem;
		padding: 1rem 1.25rem;
		color: #334155;
		margin-top: 0.5rem;
	}
	:global(.alert-icon) {
		color: #64748b;
		flex-shrink: 0;
		margin-top: 0.15rem;
	}
	.alert-text strong {
		display: block;
		font-size: 0.92rem;
		color: #0f172a;
		margin-bottom: 0.2rem;
	}
	.alert-text p {
		margin: 0;
		font-size: 0.84rem;
		color: #64748b;
		line-height: 1.45;
	}
	.alert-text code {
		background: #e2e8f0;
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
		font-size: 0.88em;
		color: #0f172a;
	}
</style>
