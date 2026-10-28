<!-- src/routes/(app)/kemitraan/+page.svelte -->
<!-- Modul Kemitraan & Atribusi — Sisi Lapangan (Project Leader & Tim) -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		fetchMitraList,
		fetchMitraWidgetSummary,
		TIPE_MITRA_LABELS,
		type MitraDetail,
		type MitraWidgetSummary
	} from '$lib/services/kemitraan';
	import IconHandshake from '@tabler/icons-svelte/icons/heart-handshake';
	import {
		IconStar,
		IconStarFilled,
		IconUsers,
		IconAlertTriangle,
		IconPhone,
		IconMail,
		IconMapPin,
		IconSearch,
		IconRefresh,
		IconFileCertificate,
		IconLoader2,
		IconBuildingStore,
		IconBrandWhatsapp
	} from '@tabler/icons-svelte';

	let loading = $state(true);
	let refreshing = $state(false);
	let errorMsg = $state('');
	let mitraList = $state<MitraDetail[]>([]);
	let widgetSummary = $state<MitraWidgetSummary | null>(null);

	let searchQuery = $state('');
	let selectedTipe = $state<string>('all');

	const TIPE_OPTIONS = [
		{ id: 'all', label: 'Semua Mitra' },
		{ id: 'subkontraktor', label: 'Subkontraktor' },
		{ id: 'mandor_borongan', label: 'Mandor / Borongan' },
		{ id: 'supplier_material', label: 'Supplier Material' },
		{ id: 'vendor_alat', label: 'Vendor Alat' },
		{ id: 'konsultan', label: 'Konsultan' },
		{ id: 'joint_venture', label: 'Joint Venture' }
	];

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (
			checked &&
			!hasPermission(roleId, 'view_all_projects', roles) &&
			!hasPermission(roleId, 'input_sales', roles)
		) {
			goto('/');
		}
	});

	async function loadData() {
		try {
			errorMsg = '';
			const [list, summary] = await Promise.all([
				fetchMitraList(),
				fetchMitraWidgetSummary()
			]);
			mitraList = list;
			widgetSummary = summary;
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal memuat data kemitraan.';
		} finally {
			loading = false;
			refreshing = false;
		}
	}

	onMount(() => {
		loadData();
	});

	async function handleRefresh() {
		refreshing = true;
		await loadData();
	}

	// Map pekerja per mitra dari widget summary
	let workerCountByMitra = $derived.by(() => {
		const map = new Map<number, number>();
		if (widgetSummary?.mitraTerlibat) {
			for (const m of widgetSummary.mitraTerlibat) {
				map.set(m.id, m.jumlahPekerja);
			}
		}
		return map;
	});

	// Filtered list
	let filteredMitra = $derived.by(() => {
		const q = searchQuery.toLowerCase().trim();
		return mitraList.filter((m) => {
			const matchTipe = selectedTipe === 'all' || m.tipe_mitra === selectedTipe;
			if (!matchTipe) return false;

			if (!q) return true;
			const namaMatch = m.nama?.toLowerCase().includes(q);
			const kodeMatch = m.kode_supplier?.toLowerCase().includes(q);
			const kontakMatch = m.kontak_person?.toLowerCase().includes(q);
			const kategoriMatch = m.kategori_bidang?.toLowerCase().includes(q);
			const alamatMatch = m.alamat?.toLowerCase().includes(q);

			return namaMatch || kodeMatch || kontakMatch || kategoriMatch || alamatMatch;
		});
	});

	// Rata-rata rating
	let avgRating = $derived.by(() => {
		const scored = mitraList.filter((m) => m.skor_total != null && m.skor_total > 0);
		if (scored.length === 0) return null;
		const sum = scored.reduce((acc, curr) => acc + (curr.skor_total || 0), 0);
		return Math.round((sum / scored.length) * 10) / 10;
	});

	function sanitizePhoneForWa(phone: string): string {
		let cleaned = phone.replace(/[^0-9]/g, '');
		if (cleaned.startsWith('0')) {
			cleaned = '62' + cleaned.slice(1);
		}
		return cleaned;
	}
</script>

<svelte:head>
	<title>Kemitraan & Atribusi — EPI</title>
</svelte:head>

<div class="scroll-body">
	<div class="max-w-4xl mx-auto p-4 md:p-6 pb-28 space-y-6">
		<!-- Header -->
		<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
			<div class="flex items-center gap-3">
				<div
					class="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 bg-blue-500/10 text-blue-600 dark:text-blue-400"
				>
					<IconHandshake size={28} />
				</div>
				<div>
					<h1 class="text-xl font-bold text-zinc-900 dark:text-white">Kemitraan & Atribusi</h1>
					<p class="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
						Database mitra kerja, rekap pekerja lapangan & evaluasi berkala
					</p>
				</div>
			</div>

			<div class="flex items-center gap-2">
				<button
					type="button"
					class="p-2.5 rounded-xl border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 text-zinc-600 dark:text-zinc-300 transition-colors disabled:opacity-50"
					onclick={handleRefresh}
					disabled={refreshing || loading}
					title="Segarkan Data"
				>
					<IconRefresh size={18} class={refreshing ? 'animate-spin' : ''} />
				</button>

				<button
					type="button"
					class="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold border border-zinc-200 dark:border-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
					onclick={() => goto('/atribusi')}
				>
					<IconFileCertificate size={16} class="text-zinc-500" />
					<span>Atribusi</span>
				</button>

				<button
					type="button"
					class="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-white shadow-sm transition-all active:scale-95"
					style="background: var(--p, #2563eb)"
					onclick={() => goto('/kemitraan/evaluasi')}
				>
					<IconStar size={16} />
					<span>⭐ Evaluasi Cepat</span>
				</button>
			</div>
		</div>

		<!-- Summary KPI Cards -->
		<div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
			<div class="rounded-2xl p-4 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-sm">
				<div class="flex items-center justify-between">
					<span class="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Total Mitra</span>
					<div class="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-600 flex items-center justify-center">
						<IconBuildingStore size={15} />
					</div>
				</div>
				<p class="text-xl font-bold text-zinc-900 dark:text-white mt-2">
					{loading ? '...' : mitraList.length}
				</p>
				<p class="text-[10px] text-zinc-400 mt-0.5">Mitra aktif terdaftar</p>
			</div>

			<div class="rounded-2xl p-4 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-sm">
				<div class="flex items-center justify-between">
					<span class="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Pekerja Lapangan</span>
					<div class="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center">
						<IconUsers size={15} />
					</div>
				</div>
				<p class="text-xl font-bold text-zinc-900 dark:text-white mt-2">
					{loading ? '...' : (widgetSummary?.pekerjaMitraAktif ?? 0)}
				</p>
				<p class="text-[10px] text-zinc-400 mt-0.5">Personil mitra hari ini</p>
			</div>

			<div class="rounded-2xl p-4 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-sm">
				<div class="flex items-center justify-between">
					<span class="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Perhatian Dokumen</span>
					<div class="w-7 h-7 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-600 flex items-center justify-center">
						<IconAlertTriangle size={15} />
					</div>
				</div>
				<p class="text-xl font-bold text-zinc-900 dark:text-white mt-2">
					{loading ? '...' : (widgetSummary?.dokumenPerluPerhatian ?? 0)}
				</p>
				<p class="text-[10px] text-zinc-400 mt-0.5">Kadaluarsa dlm 30 hari</p>
			</div>

			<div class="rounded-2xl p-4 bg-white dark:bg-zinc-900 border border-zinc-200/80 dark:border-zinc-800 shadow-sm">
				<div class="flex items-center justify-between">
					<span class="text-[11px] font-medium text-zinc-500 dark:text-zinc-400">Rata-rata Skor</span>
					<div class="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-500 flex items-center justify-center">
						<IconStarFilled size={15} />
					</div>
				</div>
				<p class="text-xl font-bold text-zinc-900 dark:text-white mt-2">
					{loading ? '...' : avgRating != null ? `${avgRating}` : '-'}
					{#if avgRating != null}<span class="text-xs font-normal text-zinc-400"> /100</span>{/if}
				</p>
				<p class="text-[10px] text-zinc-400 mt-0.5">Hasil evaluasi berkala</p>
			</div>
		</div>

		<!-- Search & Filter Section -->
		<div class="space-y-3">
			<div class="relative">
				<IconSearch
					size={18}
					class="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
				/>
				<input
					type="text"
					placeholder="Cari nama mitra, kontak, kode supplier, atau spesialisasi..."
					bind:value={searchQuery}
					class="w-full pl-10 pr-4 py-2.5 rounded-xl text-xs bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-zinc-900 dark:text-white placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all shadow-sm"
				/>
			</div>

			<!-- Tipe Mitra Chips -->
			<div class="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
				{#each TIPE_OPTIONS as opt}
					<button
						type="button"
						class="px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all border {selectedTipe === opt.id
							? 'bg-blue-600 text-white border-blue-600 shadow-sm'
							: 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-800'}"
						onclick={() => (selectedTipe = opt.id)}
					>
						{opt.label}
					</button>
				{/each}
			</div>
		</div>

		<!-- Content / List -->
		{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data kemitraan..." />
		</div>
		{:else if errorMsg}
			<div class="rounded-2xl p-4 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs flex items-center justify-between">
				<span>{errorMsg}</span>
				<button type="button" class="underline font-semibold" onclick={handleRefresh}>Coba Lagi</button>
			</div>
		{:else if filteredMitra.length === 0}
			<div class="rounded-2xl p-12 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-center space-y-3">
				<div class="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-400 mx-auto flex items-center justify-center">
					<IconHandshake size={24} />
				</div>
				<p class="text-sm font-semibold text-zinc-900 dark:text-white">Tidak ada mitra ditemukan</p>
				<p class="text-xs text-zinc-500 dark:text-zinc-400 max-w-sm mx-auto">
					{#if searchQuery || selectedTipe !== 'all'}
						Coba ubah kata kunci pencarian atau ganti filter tipe mitra.
					{:else}
						Belum ada data mitra aktif di master supplier.
					{/if}
				</p>
				{#if searchQuery || selectedTipe !== 'all'}
					<button
						type="button"
						class="text-xs text-blue-600 dark:text-blue-400 font-semibold hover:underline"
						onclick={() => {
							searchQuery = '';
							selectedTipe = 'all';
						}}
					>
						Reset Filter
					</button>
				{/if}
			</div>
		{:else}
			<div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
				{#each filteredMitra as m (m.id)}
					{@const tipeInfo = m.tipe_mitra ? TIPE_MITRA_LABELS[m.tipe_mitra] : null}
					{@const workerCount = workerCountByMitra.get(m.id) || 0}
					<div
						class="rounded-2xl p-4 bg-white dark:bg-zinc-900 border border-zinc-200/90 dark:border-zinc-800 shadow-sm hover:border-blue-500/40 transition-all flex flex-col justify-between"
					>
						<div class="space-y-2.5">
							<!-- Header Card: Nama & Badge Tipe -->
							<div class="flex items-start justify-between gap-2">
								<div>
									<div class="flex items-center gap-2 flex-wrap">
										<h3 class="text-sm font-bold text-zinc-900 dark:text-white leading-tight">
											{m.nama}
										</h3>
										{#if m.kode_supplier}
											<span class="text-[10px] px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 font-mono">
												{m.kode_supplier}
											</span>
										{/if}
									</div>
									{#if m.kategori_bidang}
										<p class="text-[11px] text-zinc-500 dark:text-zinc-400 mt-0.5">
											{m.kategori_bidang}
										</p>
									{/if}
								</div>

								{#if tipeInfo}
									<span
										class="text-[10px] font-semibold px-2 py-0.5 rounded-md border shrink-0 {tipeInfo.badge}"
									>
										{tipeInfo.label}
									</span>
								{:else if m.tipe_mitra}
									<span
										class="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 shrink-0 capitalize"
									>
										{m.tipe_mitra.replace('_', ' ')}
									</span>
								{/if}
							</div>

							<!-- Skor Rating & Status Pekerja Lapangan -->
							<div class="flex items-center gap-3 pt-1 flex-wrap text-xs">
								<div class="flex items-center gap-1 bg-amber-500/10 text-amber-700 dark:text-amber-400 px-2 py-0.5 rounded-md font-semibold text-[11px]">
									<IconStarFilled size={13} class="text-amber-500" />
									<span>
										{m.skor_total != null && m.skor_total > 0 ? `${m.skor_total} / 100` : 'Belum dinilai'}
									</span>
								</div>

								{#if workerCount > 0}
									<div class="flex items-center gap-1 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-2 py-0.5 rounded-md font-medium text-[11px]">
										<IconUsers size={13} />
										<span>{workerCount} pekerja di lapangan</span>
									</div>
								{/if}
							</div>

							<!-- Kontak & Alamat -->
							<div class="space-y-1 pt-1 text-[11px] text-zinc-600 dark:text-zinc-400 border-t border-zinc-100 dark:border-zinc-800/80">
								{#if m.kontak_person}
									<p class="flex items-center gap-1.5">
										<span class="text-zinc-400 font-medium">PIC:</span>
										<span class="text-zinc-800 dark:text-zinc-200">{m.kontak_person}</span>
									</p>
								{/if}

								{#if m.telepon}
									<div class="flex items-center gap-2">
										<a
											href="tel:{m.telepon}"
											class="inline-flex items-center gap-1 text-zinc-700 dark:text-zinc-300 hover:text-blue-600 dark:hover:text-blue-400 font-medium"
										>
											<IconPhone size={13} class="text-zinc-400" />
											{m.telepon}
										</a>
										<a
											href="https://wa.me/{sanitizePhoneForWa(m.telepon)}"
											target="_blank"
											rel="noopener noreferrer"
											class="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 hover:underline text-[10px] font-semibold bg-emerald-500/10 px-1.5 py-0.5 rounded"
										>
											<IconBrandWhatsapp size={12} /> WhatsApp
										</a>
									</div>
								{/if}

								{#if m.email}
									<p class="flex items-center gap-1.5">
										<IconMail size={13} class="text-zinc-400 shrink-0" />
										<a href="mailto:{m.email}" class="hover:underline truncate">{m.email}</a>
									</p>
								{/if}

								{#if m.alamat}
									<p class="flex items-start gap-1.5">
										<IconMapPin size={13} class="text-zinc-400 shrink-0 mt-0.5" />
										<span class="line-clamp-2">{m.alamat}</span>
									</p>
								{/if}
							</div>
						</div>

						<!-- Footer Card: Action Button -->
						<div class="pt-3 mt-3 border-t border-zinc-100 dark:border-zinc-800 flex items-center justify-end gap-2">
							<button
								type="button"
								class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors"
								onclick={() => goto(`/kemitraan/evaluasi?mitra_id=${m.id}`)}
							>
								<IconStar size={14} />
								<span>Beri Evaluasi</span>
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
