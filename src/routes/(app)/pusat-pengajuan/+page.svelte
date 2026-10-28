<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { hasPermission } from '$lib/constants/permissions';
	import { rolesStore } from '$lib/stores/roles';
	import type { FeatureKey } from '$lib/constants/permissions';
	import { getIdToken } from '$lib/services/secureDirectus';
	import { getCategoriesCached, getRecentCategoryKodes, type PurchaseCategory } from '$lib/services/purchaseCategoryApi';
	import {
		IconLoader2,
		IconAlertTriangle,
		IconPackage,
		IconClipboardList,
		IconCalendarEvent,
		IconClock,
		IconReceipt2,
		IconCash,
		IconChevronRight,
		IconPlus,
		IconHistory,
		IconInbox,
		IconRefresh,
		IconFlame,
		IconCar,
		IconAdjustmentsHorizontal
	} from '@tabler/icons-svelte';

	// R10 (Audit Konfigurabilitas Lifecycle, 16 Sep 2026): tombol "Atur Tampilan" hanya
	// untuk supervisor lapangan (admin_panel) — sembunyikan/urutkan kartu tanpa akses admin ERP.
	let canConfigureLayout = $derived(hasPermission($authStore.roleId, 'admin_panel', $rolesStore, $authStore.roleIds));

	// Peta nama ikon (field `ikon` di Directus) → komponen Tabler
	// Tambah entri sini saat menambah jenis baru di master_pengajuan_katalog.
	const ICON_MAP: Record<string, any> = {
		package: IconPackage,
		'clipboard-list': IconClipboardList,
		'calendar-event': IconCalendarEvent,
		clock: IconClock,
		'receipt-2': IconReceipt2,
		cash: IconCash,
		flame: IconFlame,
		car: IconCar
	};

	const WARNA_MAP: Record<string, { bg: string; border: string; text: string; iconBg: string; badge: string }> = {
		blue:   { bg: 'var(--b6, rgba(59, 130, 246, 0.08))', border: 'var(--blue, #3b82f6)', text: 'var(--blue, #2563eb)', iconBg: 'rgba(59, 130, 246, 0.16)', badge: '#2563eb' },
		green:  { bg: 'var(--g6, rgba(34, 197, 94, 0.08))',  border: 'var(--g, #16a34a)',    text: 'var(--green, #15803d)', iconBg: 'rgba(34, 197, 94, 0.16)',  badge: '#16a34a' },
		orange: { bg: 'var(--o6, rgba(234, 88, 12, 0.08))',  border: 'var(--o, #ea580c)',    text: 'var(--orange, #c2410c)', iconBg: 'rgba(234, 88, 12, 0.16)', badge: '#ea580c' },
		purple: { bg: 'var(--p6, rgba(147, 51, 234, 0.08))', border: 'var(--p, #9333ea)',    text: 'var(--purple, #7e22ce)', iconBg: 'rgba(147, 51, 234, 0.16)', badge: '#9333ea' },
		red:    { bg: 'var(--rel, rgba(220, 38, 38, 0.08))', border: 'var(--red, #dc2626)',  text: 'var(--red, #b91c1c)', iconBg: 'rgba(220, 38, 38, 0.16)',  badge: '#dc2626' },
		gray:   { bg: 'var(--sys-bg2)',                      border: 'var(--sys-sep)',       text: 'var(--sys-label2)',  iconBg: 'var(--sys-fill)',           badge: '#6b7280' }
	};

	interface KatalogItem {
		id: number;
		jenis_pengajuan: string;
		label: string;
		ikon: string;
		kategori: string;
		deskripsi_singkat: string;
		rute_form: string;
		rute_riwayat: string;
		permission_key: string | null;
		warna_kartu: string;
	}

	interface Badges {
		pending: Record<string, number>;
		total: Record<string, number>;
		prByCategory?: Record<string, number>;
	}

	let loading = $state(true);
	let error = $state('');
	let katalog = $state<KatalogItem[]>([]);
	let badges = $state<Badges>({ pending: {}, total: {} });
	// Pengajuan atas nama saya yang menunggu konfirmasi (Fase 3 — Pengajuan Darurat Atas Nama)
	let menungguKonfirmasi = $state<any[]>([]);
	// Pengajuan Anggaran milik saya yang tertahan gate + gate WAJIB yang gagal (panduan perbaikan, Fase 5 unifikasi)
	let tertahanGate = $state<{ id: number; nomor: string; tujuan: string; failed: { gate_key: string; label: string; message: string }[] }[]>([]);

	async function load() {
		loading = true;
		error = '';
		try {
			const token = await getIdToken();
			const res = await fetch('/api/pusat-pengajuan', {
				headers: {
					Authorization: `Bearer ${token}`
				}
			});
			if (!res.ok) {
				const errData = await res.json().catch(() => null);
				throw new Error(errData?.message || `HTTP ${res.status}`);
			}
			const data = await res.json();
			badges = data.badges || { pending: {}, total: {} };
			menungguKonfirmasi = data.menungguKonfirmasi || [];
			tertahanGate = data.tertahanGate || [];

			// Filter kartu berdasar permission_key (null = semua bisa lihat)
			katalog = (data.katalog as KatalogItem[]).filter((item) => {
				if (!item.permission_key) return true;
				return hasPermission(
					$authStore.roleId,
					item.permission_key as FeatureKey,
					$rolesStore,
					$authStore.roleIds
				);
			});
		} catch (e: any) {
			error = e?.message || 'Gagal memuat daftar pengajuan.';
		} finally {
			loading = false;
		}
	}

	// Fase 5 (Pertajam Pengajuan Pembelian v2, 23 Agu 2026): kartu "Kategori Favorit" —
	// shortcut Langkah 1 wizard PR untuk pengguna rutin (localStorage, per-perangkat).
	let favoritCategories = $state<PurchaseCategory[]>([]);
	async function loadFavoritCategories() {
		try {
			const all = await getCategoriesCached();
			const recent = getRecentCategoryKodes();
			favoritCategories = recent.map((k) => all.find((c) => c.kode === k)).filter(Boolean) as PurchaseCategory[];
		} catch {
			// shortcut UX saja — kegagalan diabaikan, kartu "Buat Baru" biasa tetap jalan
		}
	}

	onMount(() => {
		load();
		loadFavoritCategories();
	});

	// Kelompokkan kartu per kategori (urutan sudah dari server)
	const KATEGORI_LABEL: Record<string, string> = {
		proyek: 'Proyek',
		hrd: 'HRD & Absensi',
		keuangan: 'Keuangan',
		operasional: 'Operasional',
		lainnya: 'Lainnya'
	};
	const KATEGORI_ORDER = ['proyek', 'hrd', 'keuangan', 'operasional', 'lainnya'];

	let grouped = $derived(() => {
		const map: Record<string, KatalogItem[]> = {};
		for (const item of katalog) {
			const k = item.kategori || 'lainnya';
			if (!map[k]) map[k] = [];
			map[k].push(item);
		}
		return KATEGORI_ORDER.filter((k) => map[k]?.length).map((k) => ({ key: k, label: KATEGORI_LABEL[k] || k, items: map[k] }));
	});

	let totalPending = $derived(Object.values(badges.pending).reduce((a, b) => a + b, 0));
</script>

<div class="w-full p-4 md:p-6 pb-28 max-w-4xl mx-auto">
	<!-- Header -->
	<div class="flex items-center justify-between mb-6">
		<div>
			<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Pusat Pengajuan</h1>
			<p class="text-sm mt-1 font-medium" style="color: var(--sys-label3)">
				Semua jenis pengajuan dalam satu tempat
			</p>
		</div>
		{#if canConfigureLayout}
			<button
				onclick={() => goto('/pusat-pengajuan/atur-tampilan')}
				class="p-2 rounded-xl transition-colors hover:bg-black/5 dark:hover:bg-white/5"
				style="color: var(--sys-label3)"
				title="Atur Tampilan"
			>
				<IconAdjustmentsHorizontal size={20} />
			</button>
		{/if}
		{#if !loading}
			<button
				onclick={load}
				class="p-2 rounded-xl transition-colors hover:bg-black/5 dark:hover:bg-white/5"
				style="color: var(--sys-label3)"
				title="Refresh"
			>
				<IconRefresh size={20} />
			</button>
		{/if}
	</div>

	<!-- Perlu konfirmasi saya (pengajuan dibuatkan admin atas nama saya) -->
	{#each menungguKonfirmasi as m (m.jenis + m.id)}
		<button
			class="w-full glass-panel rounded-2xl p-4 mb-3 flex items-center gap-3 text-left hover-lift"
			style="background: rgba(234, 88, 12, 0.10); border: 1px solid #ea580c"
			onclick={() => goto(`/konfirmasi-pengajuan/${m.jenis}/${m.id}`)}
			title="Pengajuan ini dibuatkan admin atas nama Anda. Periksa lalu konfirmasi atau tolak."
		>
			<div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background: #ea580c">
				<IconAlertTriangle size={20} class="text-white" />
			</div>
			<div class="flex-1 min-w-0">
				<p class="text-sm font-bold" style="color: #c2410c">
					Perlu konfirmasi Anda: {m.jenis === 'pr' ? `PR #${m.id}` : m.nomor_pengajuan || `PA #${m.id}`}
				</p>
				<p class="text-xs mt-0.5 truncate" style="color: var(--sys-label3)">{m.tujuan_pengajuan || 'Dibuatkan admin atas nama Anda'} — ketuk untuk memeriksa &amp; tanda tangan</p>
			</div>
			<IconChevronRight size={18} style="color: #ea580c" />
		</button>
	{/each}

	<!-- Pengajuan saya tertahan gate: tampilkan gate yang gagal + langkah perbaikan (pesan gate) -->
	{#each tertahanGate as t (t.id)}
		<button
			class="w-full glass-panel rounded-2xl p-4 mb-3 flex items-start gap-3 text-left hover-lift"
			style="background: rgba(220, 38, 38, 0.08); border: 1px solid #dc2626"
			onclick={() => goto(`/anggaran/${t.id}`)}
			title="Pengajuan ini belum lolos pemeriksaan otomatis (gate). Ketuk untuk membuka dan membenahinya."
		>
			<div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background: #dc2626">
				<IconAlertTriangle size={20} class="text-white" />
			</div>
			<div class="flex-1 min-w-0">
				<p class="text-sm font-bold" style="color: #b91c1c">{t.nomor} tertahan — perlu dibenahi</p>
				{#if t.tujuan}<p class="text-xs mt-0.5 truncate" style="color: var(--sys-label3)">{t.tujuan}</p>{/if}
				<ul class="mt-1.5 space-y-1">
					{#each t.failed.slice(0, 3) as g (g.gate_key)}
						<li class="text-xs" style="color: var(--sys-label2)"><span class="font-semibold">{g.label}</span>{g.message ? ` — ${g.message}` : ''}</li>
					{/each}
					{#if t.failed.length > 3}
						<li class="text-xs" style="color: var(--sys-label4)">+{t.failed.length - 3} gate lain</li>
					{/if}
					{#if t.failed.length === 0}
						<li class="text-xs" style="color: var(--sys-label3)">Status gate belum terbarui — buka pengajuan lalu cek ulang.</li>
					{/if}
				</ul>
			</div>
			<IconChevronRight size={18} style="color: #dc2626" />
		</button>
	{/each}

	<!-- Banner pending -->
	{#if totalPending > 0}
		<button
			class="w-full glass-panel rounded-2xl p-4 mb-6 flex items-center gap-3 text-left hover-lift"
			style="background: var(--b6); border: 1px solid var(--blue, #3b82f6)"
			onclick={() => goto('/ess')}
		>
			<div class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style="background: var(--blue, #3b82f6)">
				<IconInbox size={20} class="text-white" />
			</div>
			<div class="flex-1 min-w-0">
				<p class="text-sm font-bold" style="color: var(--blue, #2563eb)">
					{totalPending} pengajuan menunggu persetujuan
				</p>
				<p class="text-xs mt-0.5" style="color: var(--sys-label3)">Ketuk untuk lihat status lengkap</p>
			</div>
			<IconChevronRight size={18} style="color: var(--blue, #3b82f6)" />
		</button>
	{/if}

	<!-- Loading -->
	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat pusat pengajuan lapangan..." />
		</div>

	<!-- Error -->
	{:else if error}
		<div class="glass-panel rounded-2xl p-8 text-center max-w-md mx-auto mt-10">
			<IconAlertTriangle size={32} class="mx-auto mb-3" style="color: var(--red, #dc2626)" />
			<p class="text-sm font-medium mb-4" style="color: var(--sys-label2)">{error}</p>
			<button
				class="px-5 py-2 rounded-xl text-sm font-bold text-white gradient-bg hover:opacity-90 transition-opacity"
				onclick={load}
			>
				Coba Lagi
			</button>
		</div>

	<!-- Kosong -->
	{:else if katalog.length === 0}
		<div class="glass-panel rounded-2xl p-10 text-center max-w-md mx-auto mt-10">
			<IconInbox size={40} class="mx-auto mb-3" style="color: var(--sys-label4)" />
			<p class="text-sm font-medium" style="color: var(--sys-label3)">
				Belum ada jenis pengajuan yang tersedia untuk akun Anda.
			</p>
		</div>

	<!-- Kartu per kategori -->
	{:else}
		{#each grouped() as group (group.key)}
			<div class="mb-8">
				<h2 class="text-xs font-bold uppercase tracking-widest mb-3 px-1" style="color: var(--sys-label3)">
					{group.label}
				</h2>
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
					{#each group.items as item (item.id)}
						{@const warna = WARNA_MAP[item.warna_kartu] || WARNA_MAP.gray}
						{@const IconComp = ICON_MAP[item.ikon] || IconInbox}
						{@const pending = badges.pending[item.jenis_pengajuan] || 0}
						{@const total = badges.total[item.jenis_pengajuan] || 0}

						<div
							class="glass-panel rounded-2xl p-4 flex flex-col gap-3 transition-shadow hover:shadow-md"
							style="border: 1px solid var(--sys-sep); background: {warna.bg}"
						>
							<!-- Baris atas: ikon + label + badge -->
							<div class="flex items-start gap-3">
								<div
									class="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
									style="background: {warna.iconBg}"
								>
									<IconComp size={22} style="color: {warna.text}" />
								</div>
								<div class="flex-1 min-w-0">
									<div class="flex items-center gap-2 flex-wrap">
										<span class="font-bold text-base leading-tight" style="color: var(--sys-label)">{item.label}</span>
										{#if pending > 0}
											<span
												class="text-xs font-bold px-2 py-0.5 rounded-full text-white shrink-0"
												style="background: {warna.badge}"
											>
												{pending} menunggu
											</span>
										{/if}
									</div>
									{#if item.deskripsi_singkat}
										<p class="text-xs mt-1 leading-relaxed" style="color: var(--sys-label3)">
											{item.deskripsi_singkat}
										</p>
									{/if}
									{#if total > 0}
										<p class="text-xs mt-1" style="color: var(--sys-label4)">
											{total} pengajuan tercatat
										</p>
									{/if}
								</div>
							</div>

							{#if item.jenis_pengajuan === 'PR' && favoritCategories.length > 0}
								{@const prByCategory = badges.prByCategory || {}}
								<div class="flex flex-wrap gap-1.5 -mt-1">
									{#each favoritCategories as cat (cat.id)}
										{@const berjalan = prByCategory[cat.kode] || 0}
										<button
											onclick={() => goto(`/procurement/ajukan?kategori=${cat.kode}`)}
											class="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold"
											style="background: var(--sys-bg2); border: 1px solid var(--sys-sep); color: var(--sys-label2)"
										>
											{cat.icon || '🛒'} {cat.nama}
											{#if berjalan > 0}
												<span class="px-1.5 py-0.5 rounded-full text-white text-[10px]" style="background: {warna.badge}">{berjalan}</span>
											{/if}
										</button>
									{/each}
								</div>
							{/if}

							<!-- Tombol aksi -->
							<div class="flex gap-2 pt-1">
								<button
									class="flex-1 flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90"
									style="background: {warna.badge}"
									onclick={() => goto(item.rute_form)}
								>
									<IconPlus size={15} />
									Buat Baru
								</button>
								<button
									class="flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-sm font-semibold transition-colors hover:bg-black/5 dark:hover:bg-white/5 bg-[var(--sys-bg2)]"
									style="color: var(--sys-label2); border: 1px solid var(--sys-sep)"
									onclick={() => goto(item.rute_riwayat || item.rute_form)}
								>
									<IconHistory size={15} />
									Riwayat
								</button>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/each}
	{/if}
</div>
