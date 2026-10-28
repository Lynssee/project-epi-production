<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// src/routes/kiosk/home/+page.svelte
	// Layar Beranda Terminal Kiosk Produksi — Penajaman UI/UX Touchscreen
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		IconClipboardList,
		IconTool,
		IconLoader2,
		IconSpeakerphone,
		IconCoffee,
		IconBuildingWarehouse,
		IconFlask2,
		IconChecklist,
		IconPackage,
		IconChevronRight,
		IconUserCheck,
		IconShieldCheck,
		IconTruckLoading,
		IconClipboardCheck,
		IconLayoutKanban,
		IconScissors,
		IconSearch
	} from '@tabler/icons-svelte';
	import { TEKS_QC, TEKS_KONSUMSI, TEKS_FG } from '$lib/kiosk/teks';

	let loading = $state(true);
	let announcements = $state<any[]>([]);
	let spkBerjalanTotal = $state(0);
	let kioskMenuAccess = $state<string[]>([]);
	// File 11 §2 — dulu spkError dari API TIDAK PERNAH dibaca: kegagalan (401/500/network) dan
	// "memang belum ada SPK" tampil SAMA PERSIS ("Belum ada SPK aktif"), operator awam tidak
	// tahu harus menunggu koneksi atau memang belum ada kerjaan. Tiga keadaan eksplisit sekarang:
	// loading / gagal / berhasil.
	let loadFailed = $state(false);

	async function loadHome() {
		loading = true;
		loadFailed = false;
		try {
			const res = await fetch('/api/kiosk/home');
			if (!res.ok) {
				console.error(`[kiosk/home] /api/kiosk/home gagal: HTTP ${res.status}`);
				loadFailed = true;
				return;
			}
			const data = await res.json();
			announcements = data.announcements || [];
			spkBerjalanTotal = Number(data.spkBerjalanTotal) || 0;
			kioskMenuAccess = data.kioskMenuAccess || [];
			loadFailed = Boolean(data.spkError);
		} catch (e) {
			console.error('[kiosk/home] gagal memuat beranda kiosk:', e);
			loadFailed = true;
		} finally {
			loading = false;
		}
	}

	onMount(loadHome);

	const tiles = $derived([
		{
			href: '/kiosk/absen-istirahat',
			tag: 'Presensi & Shift',
			label: 'Absen Kembali dari Istirahat',
			desc: 'Konfirmasi kembali bertugas setelah jeda istirahat',
			icon: IconCoffee,
			theme: 'sky',
			show: true
		},
		{
			href: '/kiosk/gudang',
			tag: 'Logistik & Material',
			label: 'Menu Gudang',
			desc: 'Cek stok rak, denah, antrian picking & opname fisik',
			icon: IconBuildingWarehouse,
			theme: 'orange',
			// File 07 §2.4 — dulu selalu tampil untuk SEMUA orang, satu sentuhan dari
			// picking/opname yang endpoint-nya (sekarang) memang menggerbangi akses.
			show: ['gudang_stok', 'gudang_pick', 'gudang_opname', 'gudang_transfer', 'fg_receive', 'muat_sj'].some((k) =>
				kioskMenuAccess.includes(k)
			)
		},
		{
			href: '/kiosk/input-produksi',
			tag: 'Pencatatan Kerja',
			label: 'Input Produksi',
			desc: 'Catat hasil output kerja, SPK berjalan & kuantitas produk',
			icon: IconClipboardList,
			theme: 'emerald',
			show: true
		},
		{
			href: '/kiosk/formula-kembali',
			tag: 'Formula & Lembar Kerja',
			label: 'Formula Kembali',
			desc: 'Pindai QR SPK atau pilih SPK saat formula fisik dikembalikan ke PPIC',
			icon: IconClipboardCheck,
			theme: 'orange',
			show: true
		},
		{
			href: '/kiosk/lapor-mesin',
			tag: 'Maintenance & Mesin',
			label: 'Lapor Masalah Mesin',
			desc: 'Laporkan kendala teknis, downtime, atau kerusakan mesin',
			icon: IconTool,
			theme: 'rose',
			show: true
		},
		{
			href: '/kiosk/qc',
			tag: 'Inspeksi Kualitas',
			label: TEKS_QC.labelBeranda,
			desc: TEKS_QC.descBeranda,
			icon: IconFlask2,
			theme: 'purple',
			show: kioskMenuAccess.includes('qc')
		},
		{
			href: '/kiosk/konsumsi',
			tag: 'Material & Formula',
			label: TEKS_KONSUMSI.labelBeranda,
			desc: TEKS_KONSUMSI.descBeranda,
			icon: IconChecklist,
			theme: 'teal',
			show: kioskMenuAccess.includes('konsumsi_bahan')
		},
		{
			href: '/kiosk/fg-terima',
			tag: 'Serah Terima',
			label: TEKS_FG.labelBeranda,
			desc: TEKS_FG.descBeranda,
			icon: IconPackage,
			theme: 'indigo',
			show: kioskMenuAccess.includes('fg_receive')
		},
		{
			href: '/kiosk/gerbang-sj',
			tag: 'Gerbang Satpam',
			label: 'Gerbang — Surat Jalan',
			desc: 'Verifikasi surat jalan keluar dan pemeriksaan pos satpam',
			icon: IconShieldCheck,
			theme: 'rose',
			show: kioskMenuAccess.includes('gerbang_sj')
		},
		{
			href: '/kiosk/siapkan-sj',
			tag: 'Logistik & Muat',
			label: 'Siapkan Surat Jalan',
			desc: 'Tandai barang sudah terkumpul di area muat (TTD gudang sebelum SJ dicetak)',
			icon: IconClipboardCheck,
			theme: 'teal',
			show: kioskMenuAccess.includes('siapkan_sj')
		},
		{
			href: '/kiosk/muat-sj',
			tag: 'Logistik & Muat',
			label: 'Muat Barang',
			desc: 'Proses pemuatan barang ke armada pengiriman',
			icon: IconTruckLoading,
			theme: 'orange',
			show: kioskMenuAccess.includes('muat_sj')
		},
		{
			href: '/kiosk/papan-sj',
			tag: 'Pemantauan',
			label: 'Papan Pantau SJ',
			desc: 'Monitoring visual alur pengiriman dan surat jalan',
			icon: IconLayoutKanban,
			theme: 'indigo',
			show: kioskMenuAccess.includes('papan_sj')
		},
		{
			href: '/kiosk/ciketing-potong-bahan',
			tag: 'WS Ciketing',
			label: 'Potong Bahan (Scan QR)',
			desc: 'Scan label barang, pilih SPK, potong stok Workshop Ciketing seketika',
			icon: IconScissors,
			theme: 'teal',
			show: kioskMenuAccess.includes('ciketing_potong_bahan')
		},
		{
			href: '/kiosk/ciketing-cek-stok',
			tag: 'WS Ciketing',
			label: 'Cek Stok',
			desc: 'Lihat stok material/consumable Workshop Ciketing saat ini (read-only)',
			icon: IconSearch,
			theme: 'teal',
			show: kioskMenuAccess.includes('ciketing_cek_stok')
		},
		{
			href: '/kiosk/balaraja/potong-bahan',
			tag: 'MB Balaraja',
			label: 'Potong Bahan (Scan QR)',
			desc: 'Scan label barang, pilih SPK, potong stok Workshop Balaraja seketika',
			icon: IconScissors,
			theme: 'teal',
			show: kioskMenuAccess.includes('balaraja_potong_bahan')
		},
		{
			href: '/kiosk/balaraja/cek-stok',
			tag: 'MB Balaraja',
			label: 'Cek Stok',
			desc: 'Lihat stok material/consumable Workshop Balaraja saat ini (read-only)',
			icon: IconSearch,
			theme: 'teal',
			show: kioskMenuAccess.includes('balaraja_cek_stok')
		}
	]);
</script>

<div class="home-container">
	{#if loading}
		<div class="py-12 flex justify-center">
			<CircularProgressGauge size={72} strokeWidth={6} label="Memuat Terminal Kerja..." sublabel="Inisialisasi sistem kiosk" />
		</div>
	{:else}
		{#if announcements.length > 0}
			<div class="announcements-stack">
				{#each announcements as a}
					<div class="announcement-card">
						<div class="announcement-icon">
							<IconSpeakerphone size={22} />
						</div>
						<div class="announcement-text">
							<strong>{a.judul}</strong>
							<p>{a.isi}</p>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		<!-- Status Operasional SPK — File 11 §2: tiga keadaan jelas (gagal vs benar-benar kosong
		     dulu tampil sama persis, operator awam tidak tahu harus tunggu koneksi atau memang
		     belum ada kerjaan). -->
		{#if loadFailed}
			<div class="status-banner status-banner--gagal">
				<div class="status-info">
					<span class="fail-icon">⚠️</span>
					<div class="status-copy">
						<div class="status-headline">
							<span class="headline-text">Tidak bisa terhubung ke server.</span>
						</div>
						<span class="status-sub">Coba lagi, atau lapor supervisor kalau berulang.</span>
					</div>
				</div>
				<button class="retry-btn" onclick={loadHome}>Coba Lagi</button>
			</div>
		{:else}
			<div class="status-banner" class:is-empty={spkBerjalanTotal === 0}>
				<div class="status-info">
					{#if spkBerjalanTotal > 0}
						<div class="pulse-indicator">
							<span class="pulse-core"></span>
							<span class="pulse-ring"></span>
						</div>
						<div class="status-copy">
							<div class="status-headline">
								<span class="count-badge">{spkBerjalanTotal} SPK</span>
								<span class="headline-text">sedang berjalan di lini ini</span>
							</div>
							<span class="status-sub">Sistem siap merekam aktivitas kerja operasional</span>
						</div>
					{:else}
						<div class="idle-indicator"></div>
						<div class="status-copy">
							<div class="status-headline">
								<span class="headline-text">Belum ada SPK aktif untuk lini ini</span>
							</div>
							<span class="status-sub">Hubungi supervisor lini produksi jika seharusnya ada SPK yang berjalan</span>
						</div>
					{/if}
				</div>
				<div class="system-status-chip">
					<span class="chip-status-dot"></span>
					<span>Terminal Aktif</span>
				</div>
			</div>
		{/if}

		<!-- Grid Ubin Menu Utama -->
		<div class="tiles-grid">
			{#each tiles.filter((t) => t.show) as t}
				<button class="tile-card theme-{t.theme}" onclick={() => goto(t.href)}>
					<div class="tile-icon-box">
						<t.icon size={32} stroke-width={2.2} />
					</div>

					<div class="tile-content">
						<span class="tile-tag">{t.tag}</span>
						<h2 class="tile-title">{t.label}</h2>
						<p class="tile-desc">{t.desc}</p>
					</div>

					<div class="tile-action">
						<IconChevronRight size={22} class="tile-arrow" />
					</div>
				</button>
			{/each}
		</div>

		<!-- Cadangan Roll Call Supervisor -->
		<div class="auxiliary-section">
			<button class="rollcall-btn" onclick={() => goto('/kiosk/roll-call')}>
				<div class="rollcall-icon">
					<IconUserCheck size={22} />
				</div>
				<div class="rollcall-content">
					<span class="rollcall-title">Roll Call Supervisor</span>
					<span class="rollcall-sub">Mode cadangan presensi saat pembaca badge atau kartu bermasalah</span>
				</div>
				<IconChevronRight size={18} class="rollcall-arrow" />
			</button>
		</div>
	{/if}
</div>

<style>
	.home-container {
		padding: 1rem 1.25rem 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.15rem;
		width: 100%;
		max-width: 100%;
		margin: 0;
		box-sizing: border-box;
		min-height: 100%;
	}

	.center-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1rem;
		padding: 5rem 1rem;
		color: #64748b;
		font-size: 1rem;
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

	/* Pengumuman */
	.announcements-stack {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.announcement-card {
		display: flex;
		align-items: flex-start;
		gap: 0.85rem;
		background: #fffbeb;
		border: 1px solid #fde68a;
		border-left: 4px solid #f59e0b;
		border-radius: 0.85rem;
		padding: 1rem 1.25rem;
		color: #78350f;
	}
	.announcement-icon {
		color: #d97706;
		flex-shrink: 0;
		margin-top: 0.15rem;
	}
	.announcement-text strong {
		display: block;
		font-size: 1rem;
		font-weight: 800;
		color: #92400e;
		margin-bottom: 0.2rem;
	}
	.announcement-text p {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.45;
		color: #78350f;
	}

	/* Status Operasional Banner */
	.status-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		background: #ffffff;
		border: 1.5px solid #e2e8f0;
		border-radius: 1.15rem;
		padding: 1rem 1.35rem;
		box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04), 0 4px 10px rgba(15, 23, 42, 0.02);
	}
	.status-banner.is-empty {
		background: #f8fafc;
		border-color: #cbd5e1;
	}
	.status-banner--gagal {
		background: #fef2f2;
		border-color: #fecaca;
	}
	.fail-icon { font-size: 1.75rem; }
	.retry-btn {
		min-height: 48px;
		padding: 0 1.25rem;
		background: #b91c1c;
		color: #fff;
		border: none;
		border-radius: 0.65rem;
		font-weight: 800;
		cursor: pointer;
	}

	.status-info {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	/* Live Pulse Dot */
	.pulse-indicator {
		position: relative;
		width: 14px;
		height: 14px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.pulse-core {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #10b981;
	}
	.pulse-ring {
		position: absolute;
		inset: -2px;
		border-radius: 50%;
		background: #10b981;
		opacity: 0.4;
		animation: pulse-wave 2s cubic-bezier(0.24, 0, 0.38, 1) infinite;
	}
	@keyframes pulse-wave {
		0% {
			transform: scale(0.8);
			opacity: 0.7;
		}
		70% {
			transform: scale(2.2);
			opacity: 0;
		}
		100% {
			transform: scale(2.2);
			opacity: 0;
		}
	}

	.idle-indicator {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #94a3b8;
		flex-shrink: 0;
	}

	.status-copy {
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.status-headline {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-wrap: wrap;
	}
	.count-badge {
		display: inline-block;
		background: #dcfce7;
		color: #15803d;
		font-weight: 800;
		font-size: 0.95rem;
		padding: 0.1rem 0.55rem;
		border-radius: 6px;
		letter-spacing: -0.01em;
	}
	.headline-text {
		font-size: 1.05rem;
		font-weight: 800;
		color: #0f172a;
		letter-spacing: -0.01em;
	}
	.status-sub {
		font-size: 0.84rem;
		color: #64748b;
		font-weight: 500;
	}

	.system-status-chip {
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
		flex-shrink: 0;
	}
	.chip-status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #10b981;
	}

	/* Tiles Responsive Grid */
	.tiles-grid {
		display: grid;
		grid-template-columns: 1fr;
		gap: 1.15rem;
	}
	@media (min-width: 640px) {
		.tiles-grid {
			grid-template-columns: repeat(2, 1fr);
			gap: 1.25rem;
		}
	}

	/* Tile Card */
	.tile-card {
		display: flex;
		align-items: center;
		gap: 1.15rem;
		width: 100%;
		text-align: left;
		background: #ffffff;
		border: 1.5px solid #e2e8f0;
		border-radius: 1.25rem;
		padding: 1.35rem 1.45rem;
		cursor: pointer;
		box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04), 0 4px 10px rgba(15, 23, 42, 0.03);
		transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
		position: relative;
		touch-action: manipulation;
		user-select: none;
		box-sizing: border-box;
		min-height: 120px;
	}
	.tile-card:hover {
		transform: translateY(-2px);
		box-shadow: 0 12px 28px -5px rgba(15, 23, 42, 0.09), 0 8px 12px -6px rgba(15, 23, 42, 0.04);
	}
	.tile-card:active {
		transform: scale(0.982);
		box-shadow: 0 2px 6px rgba(15, 23, 42, 0.06);
	}

	/* Tile Icon Box */
	.tile-icon-box {
		width: 62px;
		height: 62px;
		border-radius: 1rem;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		transition: transform 0.15s ease;
	}
	.tile-card:hover .tile-icon-box {
		transform: scale(1.06);
	}

	/* Tile Content */
	.tile-content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}
	.tile-tag {
		font-size: 0.72rem;
		font-weight: 800;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.tile-title {
		font-size: 1.22rem;
		font-weight: 800;
		color: #0f172a;
		margin: 0;
		line-height: 1.25;
		letter-spacing: -0.015em;
	}
	.tile-desc {
		font-size: 0.86rem;
		color: #64748b;
		font-weight: 500;
		line-height: 1.35;
		margin: 0;
	}

	/* Action Chevron */
	.tile-action {
		width: 42px;
		height: 42px;
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
		transform: translateX(3px);
	}

	/* THEMES */
	/* Sky (Absen Istirahat) */
	.theme-sky .tile-icon-box {
		background: #f0f9ff;
		border: 1.5px solid #bae6fd;
		color: #0284c7;
	}
	.theme-sky .tile-tag {
		color: #0284c7;
	}
	.theme-sky:hover {
		border-color: #38bdf8;
	}
	.theme-sky:hover .tile-action {
		background: #f0f9ff;
		color: #0284c7;
	}

	/* Orange (Menu Gudang) */
	.theme-orange .tile-icon-box {
		background: #fff7ed;
		border: 1.5px solid #fed7aa;
		color: #ea580c;
	}
	.theme-orange .tile-tag {
		color: #ea580c;
	}
	.theme-orange:hover {
		border-color: #fb923c;
	}
	.theme-orange:hover .tile-action {
		background: #fff7ed;
		color: #ea580c;
	}

	/* Emerald (Input Produksi) */
	.theme-emerald .tile-icon-box {
		background: #ecfdf5;
		border: 1.5px solid #a7f3d0;
		color: #059669;
	}
	.theme-emerald .tile-tag {
		color: #059669;
	}
	.theme-emerald:hover {
		border-color: #34d399;
	}
	.theme-emerald:hover .tile-action {
		background: #ecfdf5;
		color: #059669;
	}

	/* Rose (Lapor Mesin) */
	.theme-rose .tile-icon-box {
		background: #fff1f2;
		border: 1.5px solid #fecdd3;
		color: #e11d48;
	}
	.theme-rose .tile-tag {
		color: #e11d48;
	}
	.theme-rose:hover {
		border-color: #fb7185;
	}
	.theme-rose:hover .tile-action {
		background: #fff1f2;
		color: #e11d48;
	}

	/* Purple (QC) */
	.theme-purple .tile-icon-box {
		background: #faf5ff;
		border: 1.5px solid #e9d5ff;
		color: #7c3aed;
	}
	.theme-purple .tile-tag {
		color: #7c3aed;
	}
	.theme-purple:hover {
		border-color: #c084fc;
	}
	.theme-purple:hover .tile-action {
		background: #faf5ff;
		color: #7c3aed;
	}

	/* Teal (Konsumsi Bahan) */
	.theme-teal .tile-icon-box {
		background: #f0fdfa;
		border: 1.5px solid #99f6e4;
		color: #0d9488;
	}
	.theme-teal .tile-tag {
		color: #0d9488;
	}
	.theme-teal:hover {
		border-color: #2dd4bf;
	}
	.theme-teal:hover .tile-action {
		background: #f0fdfa;
		color: #0d9488;
	}

	/* Indigo (FG Serah Terima) */
	.theme-indigo .tile-icon-box {
		background: #eef2ff;
		border: 1.5px solid #c7d2fe;
		color: #4f46e5;
	}
	.theme-indigo .tile-tag {
		color: #4f46e5;
	}
	.theme-indigo:hover {
		border-color: #818cf8;
	}
	.theme-indigo:hover .tile-action {
		background: #eef2ff;
		color: #4f46e5;
	}

	/* Cadangan Roll Call Section */
	.auxiliary-section {
		margin-top: 0.5rem;
	}
	.rollcall-btn {
		display: flex;
		align-items: center;
		gap: 1rem;
		width: 100%;
		background: #f8fafc;
		border: 1.5px dashed #cbd5e1;
		border-radius: 1rem;
		padding: 0.9rem 1.25rem;
		text-align: left;
		cursor: pointer;
		transition: all 0.18s ease;
		box-sizing: border-box;
	}
	.rollcall-btn:hover {
		background: #ffffff;
		border-color: #94a3b8;
		box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);
	}
	.rollcall-btn:active {
		transform: scale(0.99);
		background: #f1f5f9;
	}
	.rollcall-icon {
		width: 40px;
		height: 40px;
		border-radius: 0.75rem;
		background: #e2e8f0;
		color: #475569;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.rollcall-btn:hover .rollcall-icon {
		background: #0ea5e9;
		color: #ffffff;
	}
	.rollcall-content {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.rollcall-title {
		font-size: 0.95rem;
		font-weight: 700;
		color: #334155;
	}
	.rollcall-sub {
		font-size: 0.8rem;
		color: #64748b;
	}
	:global(.rollcall-arrow) {
		color: #94a3b8;
		flex-shrink: 0;
		transition: transform 0.15s ease;
	}
	.rollcall-btn:hover :global(.rollcall-arrow) {
		color: #0f172a;
		transform: translateX(2px);
	}
</style>
