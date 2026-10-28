<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getAsetSaya, type AsetSayaSummary } from '$lib/services/ess/asetSaya';
	import { SectionGuide } from '$lib/components/hints';
	import { essHints } from '$lib/data/hints/ess';
	import { getHint } from '$lib/data/hints/getHint';
	import {
		IconBriefcase, IconDeviceLaptop, IconDeviceMobile, IconBuildingWarehouse, IconTool,
		IconLoader2, IconAlertTriangle, IconRefresh, IconFlag
	} from '@tabler/icons-svelte';

	const h = (key: string) => getHint(essHints, key, 'ess');

	let loading = $state(true);
	let refreshing = $state(false);
	let errorMsg = $state('');
	let summary = $state<AsetSayaSummary | null>(null);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			summary = await getAsetSaya();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat data aset Anda.';
		} finally {
			loading = false;
			refreshing = false;
		}
	}

	async function handleRefresh() {
		refreshing = true;
		await load();
	}

	onMount(load);

	function kondisiConfig(kondisi: string | null | undefined) {
		const k = String(kondisi || '').toLowerCase();
		if (k.includes('rusak')) return 'bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800/40';
		if (k.includes('perbaikan') || k.includes('perlu')) return 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800/40';
		return 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/40';
	}

	function fmtTanggal(d: string | null | undefined) {
		if (!d) return '-';
		try {
			return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
		} catch {
			return d;
		}
	}

	function laporKerusakan(departemen: 'IT' | 'GA' | 'Maintenance', namaBarang: string) {
		const params = new URLSearchParams({
			tipe: 'Komplain',
			departemen,
			judul: `Kerusakan/Kendala: ${namaBarang}`
		});
		goto(`/support/baru?${params.toString()}`);
	}
</script>

<div class="w-full p-4 md:p-6 pb-28 max-w-5xl mx-auto">
	<div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
		<div>
			<div class="flex items-center gap-2 mb-1 text-xs font-semibold" style="color: var(--sys-label3)">
				<a href="/ess" class="hover:underline flex items-center gap-1">
					<span>Portal Karyawan</span>
				</a>
				<span>/</span>
				<span style="color: var(--sys-label)">Aset & Alat Saya</span>
			</div>
			<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text flex items-center gap-2">
				<IconBriefcase size={28} class="inline text-blue-600" />
				Aset & Alat Saya
			</h1>
			<p class="text-xs md:text-sm font-medium mt-1" style="color: var(--sys-label3)">
				Barang kantor dan alat kerja yang tercatat atas nama Anda.
			</p>
		</div>

		<button
			class="p-2.5 rounded-xl border flex items-center justify-center transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 self-end md:self-center"
			style="border-color: var(--sys-sep); color: var(--sys-label)"
			onclick={handleRefresh}
			title="Refresh data"
		>
			<IconRefresh size={18} class={refreshing ? 'animate-spin' : ''} />
		</button>
	</div>

	<div class="mb-6">
		<SectionGuide
			id="ess.aset-saya.page"
			title={h('aset-saya.page').sectionGuide?.title}
			steps={h('aset-saya.page').sectionGuide?.steps ?? []}
		/>
	</div>

	{#if loading}
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat aset & alat Anda..." />
	{:else if errorMsg}
		<div class="glass-panel rounded-2xl p-8 text-center max-w-md mx-auto my-8">
			<div class="w-16 h-16 rounded-full bg-red-100 dark:bg-red-950/40 flex items-center justify-center mx-auto mb-4">
				<IconAlertTriangle size={32} class="text-red-600 dark:text-red-400" />
			</div>
			<h3 class="text-lg font-bold text-red-600 dark:text-red-400 mb-2">Gagal Memuat Data</h3>
			<p class="text-xs text-red-500 mb-6">{errorMsg}</p>
			<button class="px-6 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg shadow-md" onclick={load}>
				Coba Lagi
			</button>
		</div>
	{:else if summary && summary.totalItem === 0}
		<div class="glass-panel rounded-3xl p-12 text-center">
			<div class="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4 text-slate-400">
				<IconBriefcase size={32} />
			</div>
			<h3 class="text-sm font-bold" style="color: var(--sys-label)">Belum ada aset tercatat atas nama Anda</h3>
			<p class="text-xs mt-1" style="color: var(--sys-label3)">
				Aset akan muncul di sini setelah ditugaskan oleh Admin IT/GA, atau saat Anda meminjam alat lapangan.
			</p>
		</div>
	{:else if summary}
		<div class="space-y-6">
			<!-- IT Tetap -->
			{#if summary.itTetap.length > 0}
				<div class="glass-panel rounded-3xl p-4 md:p-6">
					<h2 class="text-sm md:text-base font-bold mb-3 flex items-center gap-2" style="color: var(--sys-label)">
						<IconDeviceLaptop size={18} class="text-blue-600" /> Aset IT Tetap ({summary.itTetap.length})
					</h2>
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
						{#each summary.itTetap as it (it.id)}
							<div class="p-3.5 rounded-2xl border bg-white/60 dark:bg-slate-900/60" style="border-color: var(--sys-sep)">
								<div class="flex items-start justify-between gap-2">
									<div>
										<p class="text-sm font-bold" style="color: var(--sys-label)">{it.name || '-'}</p>
										<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">
											{it.type || it.category || '-'}{it.serial_number ? ` · SN: ${it.serial_number}` : ''}
										</p>
									</div>
									<span class="text-[10px] px-2 py-0.5 rounded-full font-bold border shrink-0 {kondisiConfig(it.kondisi)}">{it.kondisi || '-'}</span>
								</div>
								<button
									class="mt-3 w-full py-1.5 rounded-xl text-[11px] font-bold text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 flex items-center justify-center gap-1.5 transition-colors"
									onclick={() => laporKerusakan('IT', it.name || 'Aset IT')}
								>
									<IconFlag size={13} /> Lapor Kerusakan
								</button>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- IT Pinjaman -->
			{#if summary.itPinjaman.length > 0}
				<div class="glass-panel rounded-3xl p-4 md:p-6">
					<h2 class="text-sm md:text-base font-bold mb-3 flex items-center gap-2" style="color: var(--sys-label)">
						<IconDeviceMobile size={18} class="text-indigo-600" /> Peminjaman IT Sementara ({summary.itPinjaman.length})
					</h2>
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
						{#each summary.itPinjaman as p (p.id)}
							<div class="p-3.5 rounded-2xl border bg-white/60 dark:bg-slate-900/60" style="border-color: var(--sys-sep)">
								<p class="text-sm font-bold" style="color: var(--sys-label)">{p.asset_item_id?.name || '-'}</p>
								<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">
									Pinjam {fmtTanggal(p.tanggal_pinjam)} · Target kembali {fmtTanggal(p.tanggal_target_kembali)}
								</p>
								<span class="inline-block mt-2 text-[10px] px-2 py-0.5 rounded-full font-bold border bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800/40 capitalize">
									{p.status_pinjam || '-'}
								</span>
								<button
									class="mt-3 w-full py-1.5 rounded-xl text-[11px] font-bold text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 flex items-center justify-center gap-1.5 transition-colors"
									onclick={() => laporKerusakan('IT', p.asset_item_id?.name || 'Unit Pinjaman IT')}
								>
									<IconFlag size={13} /> Lapor Kerusakan
								</button>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- GA Fasilitas -->
			{#if summary.gaFasilitas.length > 0}
				<div class="glass-panel rounded-3xl p-4 md:p-6">
					<h2 class="text-sm md:text-base font-bold mb-3 flex items-center gap-2" style="color: var(--sys-label)">
						<IconBuildingWarehouse size={18} class="text-teal-600" /> Aset Fasilitas / Kantor ({summary.gaFasilitas.length})
					</h2>
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
						{#each summary.gaFasilitas as g (g.id)}
							<div class="p-3.5 rounded-2xl border bg-white/60 dark:bg-slate-900/60" style="border-color: var(--sys-sep)">
								<div class="flex items-start justify-between gap-2">
									<div>
										<p class="text-sm font-bold" style="color: var(--sys-label)">{g.nama || '-'}</p>
										<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">
											{g.kategori || '-'}{g.lokasi_id?.location_name ? ` · ${g.lokasi_id.location_name}` : ''}
										</p>
									</div>
									<span class="text-[10px] px-2 py-0.5 rounded-full font-bold border shrink-0 {kondisiConfig(g.kondisi)}">{g.kondisi || '-'}</span>
								</div>
								<button
									class="mt-3 w-full py-1.5 rounded-xl text-[11px] font-bold text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 flex items-center justify-center gap-1.5 transition-colors"
									onclick={() => laporKerusakan('GA', g.nama || 'Aset Fasilitas')}
								>
									<IconFlag size={13} /> Lapor Kerusakan
								</button>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Alat Lapangan -->
			{#if summary.alatLapangan.length > 0}
				<div class="glass-panel rounded-3xl p-4 md:p-6">
					<h2 class="text-sm md:text-base font-bold mb-3 flex items-center gap-2" style="color: var(--sys-label)">
						<IconTool size={18} class="text-purple-600" /> Alat Kerja Lapangan ({summary.alatLapangan.length})
					</h2>
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
						{#each summary.alatLapangan as a (a.id)}
							<div class="p-3.5 rounded-2xl border bg-white/60 dark:bg-slate-900/60" style="border-color: var(--sys-sep)">
								<p class="text-sm font-bold" style="color: var(--sys-label)">{a.equipment_id?.name || '-'}</p>
								<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">
									Mulai {fmtTanggal(a.start_date)}{a.project_id?.name ? ` · Proyek: ${a.project_id.name}` : ''}
								</p>
								<button
									class="mt-3 w-full py-1.5 rounded-xl text-[11px] font-bold text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 flex items-center justify-center gap-1.5 transition-colors"
									onclick={() => laporKerusakan('Maintenance', a.equipment_id?.name || 'Alat Lapangan')}
								>
									<IconFlag size={13} /> Lapor Kerusakan
								</button>
							</div>
						{/each}
					</div>
					<p class="text-[11px] mt-3 italic" style="color: var(--sys-label3)">
						Catatan: daftar ini hanya mencakup peminjaman yang tercatat lewat PIC resmi Anda.
					</p>
				</div>
			{/if}
		</div>
	{/if}
</div>
