<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getCutiStatus, type CutiRecord, type SisaCuti } from '$lib/services/ess/cuti';
	import { IconLoader2, IconPlus, IconAlertTriangle, IconFileExport, IconPaperclip } from '@tabler/icons-svelte';
	import EssExportSheet from '$lib/components/ess/EssExportSheet.svelte';
	import { openSecureAsset } from '$lib/actions/secureAsset';

	let loading = $state(true);
	let errorMsg = $state('');
	let riwayat = $state<CutiRecord[]>([]);
	let sisaCuti = $state<SisaCuti | null>(null);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const status = await getCutiStatus();
			riwayat = status.riwayat;
			sisaCuti = status.sisaCuti;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat data cuti.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	function statusColor(status: string) {
		if (status === 'Disetujui') return { bg: 'var(--gg)', text: 'var(--ggd)' };
		if (status === 'Ditolak') return { bg: 'var(--rel)', text: 'var(--red)' };
		if (status === 'Dibatalkan') return { bg: 'var(--sys-fill)', text: 'var(--sys-label3)' };
		return { bg: 'var(--aml)', text: 'var(--amd)' };
	}

	function formatDate(dateStr: string) {
		if (!dateStr) return '-';
		const parts = dateStr.split('-');
		if (parts.length !== 3) return dateStr;
		const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
		return `${parseInt(parts[2])} ${monthNames[parseInt(parts[1]) - 1] || parts[1]} ${parts[0]}`;
	}

	let sheetOpen = $state(false);
	const exportColumns = [
		{ key: 'jenis', label: 'Jenis' },
		{ key: 'mulai', label: 'Mulai' },
		{ key: 'selesai', label: 'Selesai' },
		{ key: 'hari', label: 'Jumlah Hari' },
		{ key: 'paruh', label: 'Paruh' },
		{ key: 'status', label: 'Status' },
		{ key: 'alasan', label: 'Alasan' },
		{ key: 'catatan_hr', label: 'Catatan HR' }
	];
	const exportRows = $derived(
		riwayat.map((r) => ({
			jenis: r.jenis_cuti ?? '-',
			mulai: formatDate(r.tanggal_mulai),
			selesai: formatDate(r.tanggal_selesai),
			hari: r.jumlah_hari ?? '-',
			paruh: r.paruh ? (r.paruh === 'pagi' ? 'Pagi' : 'Siang') : '-',
			status: r.status ?? '-',
			alasan: r.alasan ?? '-',
			catatan_hr: r.catatan_hr ?? '-'
		}))
	);
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<div class="flex items-center justify-between mb-8">
		<div>
			<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Cuti Saya</h1>
			<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">Riwayat & pengajuan cuti/izin/sakit</p>
		</div>
		<div class="flex items-center gap-2 shrink-0">
			<button
				class="w-11 h-11 md:w-12 md:h-12 rounded-full flex items-center justify-center border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 text-slate-500 disabled:opacity-40 hover:scale-105 transition-transform"
				onclick={() => (sheetOpen = true)}
				disabled={riwayat.length === 0}
				aria-label="Ekspor riwayat cuti"
				title="Ekspor riwayat cuti (PDF / CSV)"
			>
				<IconFileExport size={20} />
			</button>
			<button
				class="w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center text-white gradient-bg btn-pulse hover:scale-105 transition-transform shadow-lg"
				onclick={() => goto('/ess/cuti/baru')}
				aria-label="Ajukan cuti baru"
			>
				<IconPlus size={24} />
			</button>
		</div>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data cuti karyawan..." />
		</div>
	{:else if errorMsg}
		<div class="glass-panel rounded-2xl p-8 text-center max-w-md mx-auto mt-10">
			<div class="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
				<IconAlertTriangle size={32} style="color: #DC2626" />
			</div>
			<h3 class="text-lg font-bold text-red-600 mb-2">Terjadi Kesalahan</h3>
			<p class="text-sm text-red-500 mb-6">{errorMsg}</p>
			<button class="px-6 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg hover:opacity-90 transition-opacity shadow-lg" onclick={load}>
				Coba Lagi
			</button>
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-12 gap-6">
			<!-- Left/Top: Summary -->
			<div class="md:col-span-4 flex flex-col gap-4">
				{#if sisaCuti}
					<div class="glass-panel rounded-3xl p-6 relative overflow-hidden">
						<div class="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl -mr-10 -mt-10"></div>
						<div class="relative z-10">
							<p class="text-sm font-semibold mb-2" style="color: var(--sys-label3)">Sisa Cuti Tahun Ini</p>
							<div class="flex items-baseline gap-2">
								<p class="text-5xl font-black gradient-text">{sisaCuti.sisa}</p>
								<span class="text-sm font-medium" style="color: var(--sys-label4)">/ {sisaCuti.total_hak} hari</span>
							</div>
						</div>
					</div>

					{#if sisaCuti.potongan_cuti_bersama > 0}
						<div class="glass-panel rounded-2xl p-4">
							<p class="text-xs font-semibold mb-3" style="color: var(--sys-label3)">Rincian Pemakaian</p>
							<div class="flex items-center justify-between text-sm mb-2">
								<span style="color: var(--sys-label3)">Pengajuan disetujui</span>
								<span class="font-bold" style="color: var(--sys-label)">{sisaCuti.terpakai_pengajuan} hari</span>
							</div>
							<div class="flex items-center justify-between text-sm">
								<span style="color: var(--sys-label3)">Cuti bersama (libur nasional)</span>
								<span class="font-bold" style="color: var(--sys-label)">{sisaCuti.potongan_cuti_bersama} hari</span>
							</div>
							<p class="text-xs mt-3 pt-3 border-t border-white/10" style="color: var(--sys-label4)">
								Cuti bersama yang sudah lewat otomatis memotong jatah cuti tahunan sesuai kebijakan perusahaan — tidak perlu diajukan manual.
							</p>
						</div>
					{/if}
				{/if}
			</div>

			<!-- Right/Bottom: History -->
			<div class="md:col-span-8">
				<h2 class="text-lg font-bold mb-4" style="color: var(--sys-label)">Riwayat Pengajuan</h2>
				{#if riwayat.length === 0}
					<div class="glass-panel rounded-2xl p-10 text-center">
						<p class="text-sm font-medium" style="color: var(--sys-label3)">Belum ada pengajuan cuti, izin, atau sakit.</p>
					</div>
				{:else}
					<div class="flex flex-col gap-3 md:gap-4">
						{#each riwayat as r (r.id)}
							{@const c = statusColor(r.status)}
							<div class="hover-lift glass-panel rounded-2xl p-5 relative overflow-hidden">
								<div class="flex items-center justify-between mb-2 relative z-10">
									<h3 class="text-base font-bold" style="color: var(--sys-label)">{r.jenis_cuti}</h3>
									<span class="text-xs font-bold px-3 py-1 rounded-full border shadow-sm" style="background: {c.bg}; color: {c.text}; border-color: {c.text}20">{r.status}</span>
								</div>
								<div class="flex items-center gap-2 mb-3 relative z-10">
									<p class="text-sm font-medium" style="color: var(--sys-label3)">
										{formatDate(r.tanggal_mulai)} <span class="mx-1">→</span> {formatDate(r.tanggal_selesai)}
									</p>
									<span class="px-2 py-0.5 rounded text-xs font-bold bg-slate-100 text-slate-600">
										{r.jumlah_hari} hari{r.paruh ? ` — ${r.paruh === 'pagi' ? 'Pagi' : 'Siang'}` : ''}
									</span>
								</div>
								
								{#if r.alasan}
									<p class="text-sm bg-white/50 p-3 rounded-xl border border-white/20 relative z-10" style="color: var(--sys-label)">{r.alasan}</p>
								{/if}
								{#if r.lampiran}
									<button
										type="button"
										class="mt-2 inline-flex items-center gap-1 text-xs font-bold relative z-10"
										style="color: var(--p, var(--g))"
										onclick={() => openSecureAsset(r.lampiran)}
									>
										<IconPaperclip size={14} /> Lihat Lampiran
									</button>
								{:else if r.jenis_cuti === 'Cuti Sakit'}
									<p class="mt-2 text-xs font-bold" style="color: #DC2626">Belum ada lampiran surat dokter</p>
								{/if}
								{#if r.status === 'Ditolak' && r.catatan_hr}
									<p class="text-xs mt-3 px-3 py-2 rounded-xl border relative z-10" style="background: var(--rel); color: var(--red); border-color: var(--re)"><strong>Catatan HR:</strong> {r.catatan_hr}</p>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<EssExportSheet
	open={sheetOpen}
	onClose={() => (sheetOpen = false)}
	judul="Riwayat Cuti Saya"
	filename="cuti-saya"
	columns={exportColumns}
	rows={exportRows}
/>
