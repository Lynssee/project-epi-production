<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getKasbonStatus, type KasbonRecord, type KasbonStatus } from '$lib/services/ess/kasbon';
	import { IconLoader2, IconPlus, IconAlertTriangle, IconFileExport } from '@tabler/icons-svelte';
	import EssExportSheet from '$lib/components/ess/EssExportSheet.svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let status = $state<KasbonStatus | null>(null);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			status = await getKasbonStatus();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat data kasbon.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	function statusColor(s: string) {
		if (s === 'approved') return { bg: 'var(--gg)', text: 'var(--ggd)' };
		if (s === 'Ditolak') return { bg: 'var(--rel)', text: 'var(--red)' };
		return { bg: 'var(--aml)', text: 'var(--amd)' };
	}

	function statusLabel(s: string) {
		if (s === 'approved') return 'Disetujui Finance (Cair)';
		return s;
	}

	function formatRupiah(n: number) {
		return 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
	}

	function formatDate(dateStr: string) {
		if (!dateStr) return '-';
		const d = new Date(dateStr);
		if (Number.isNaN(d.getTime())) return dateStr;
		const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
		return `${d.getDate()} ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
	}

	function formatPeriode(periode: string) {
		if (!periode) return '-';
		const [y, m] = periode.split('-');
		const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
		return `${monthNames[Number(m) - 1] || m} ${y}`;
	}

	// Fase 4 (R5): "unduh PDF" kartu hutang — cetak halaman via dialog print browser (bisa disimpan
	// sebagai PDF dari situ), tanpa perlu infrastruktur pembuatan PDF sisi server.
	function cetakKartuHutang() {
		window.print();
	}

	let sheetOpen = $state(false);
	const exportColumns = [
		{ key: 'tanggal', label: 'Tanggal Pengajuan' },
		{ key: 'nominal', label: 'Nominal (Rp)' },
		{ key: 'tenor', label: 'Tenor (bln)' },
		{ key: 'cicilan', label: 'Cicilan/bln (Rp)' },
		{ key: 'terbayar', label: 'Terbayar (Rp)' },
		{ key: 'sisa', label: 'Sisa (Rp)' },
		{ key: 'status', label: 'Status' },
		{ key: 'keterangan', label: 'Keterangan' }
	];
	const exportRows = $derived(
		(status?.riwayat ?? []).map((r) => ({
			tanggal: formatDate(r.tanggal_pengajuan),
			nominal: r.nominal ?? 0,
			tenor: r.tenor ?? '-',
			cicilan: r.cicilan_per_bulan ?? 0,
			terbayar: r.total_paid ?? 0,
			sisa: Number(r.nominal || 0) - Number(r.total_paid || 0),
			status: statusLabel(r.status),
			keterangan: r.keterangan ?? '-'
		}))
	);
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<div class="flex items-center justify-between mb-8">
		<div>
			<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Kasbon Saya</h1>
			<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">Riwayat & pengajuan kasbon</p>
		</div>
		<div class="flex items-center gap-2 shrink-0">
			<button
				class="w-11 h-11 md:w-12 md:h-12 rounded-full flex items-center justify-center border border-slate-200 dark:border-slate-700 bg-white/70 dark:bg-slate-800/70 text-slate-500 disabled:opacity-40 hover:scale-105 transition-transform"
				onclick={() => (sheetOpen = true)}
				disabled={!status?.riwayat?.length}
				aria-label="Ekspor riwayat kasbon"
				title="Ekspor riwayat kasbon (PDF / CSV)"
			>
				<IconFileExport size={20} />
			</button>
			<button
				class="w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center text-white gradient-bg btn-pulse hover:scale-105 transition-transform shadow-lg disabled:opacity-40"
				onclick={() => goto('/ess/kasbon/baru')}
				disabled={!status?.bisaAjukanBaru}
				aria-label="Ajukan kasbon baru"
			>
				<IconPlus size={24} />
			</button>
		</div>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data kasbon..." />
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
			<div class="md:col-span-4 flex flex-col gap-4">
				<div class="glass-panel rounded-3xl p-6 relative overflow-hidden">
					<div class="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl -mr-10 -mt-10"></div>
					<div class="relative z-10">
						<p class="text-sm font-semibold mb-2" style="color: var(--sys-label3)">Sisa Kasbon Berjalan</p>
						<p class="text-3xl font-black gradient-text">{formatRupiah(status?.sisaAktif || 0)}</p>
						<p class="text-xs font-medium mt-2" style="color: var(--sys-label4)">Plafon: {formatRupiah(status?.plafon || 0)} · Tenor maks {status?.tenorMaxBulan} bulan</p>
						{#if !status?.bisaAjukanBaru}
							<p class="text-xs font-bold mt-3 px-3 py-2 rounded-xl" style="background: var(--aml); color: var(--amd)">Belum bisa ajukan baru — lunasi kasbon berjalan dulu.</p>
						{/if}
					</div>
				</div>
			</div>

			<div class="md:col-span-8">
				<h2 class="text-lg font-bold mb-4" style="color: var(--sys-label)">Riwayat Pengajuan</h2>
				{#if !status?.riwayat.length}
					<div class="glass-panel rounded-2xl p-10 text-center">
						<p class="text-sm font-medium" style="color: var(--sys-label3)">Belum ada pengajuan kasbon.</p>
					</div>
				{:else}
					<div class="flex flex-col gap-3 md:gap-4">
						{#each status.riwayat as r (r.id)}
							{@const c = statusColor(r.status)}
							<div class="hover-lift glass-panel rounded-2xl p-5 relative overflow-hidden">
								<div class="flex items-center justify-between mb-2 relative z-10">
									<h3 class="text-base font-bold" style="color: var(--sys-label)">{formatRupiah(r.nominal)}</h3>
									<span class="text-xs font-bold px-3 py-1 rounded-full border shadow-sm" style="background: {c.bg}; color: {c.text}; border-color: {c.text}20">{statusLabel(r.status)}</span>
								</div>
								<div class="flex items-center gap-2 mb-3 relative z-10">
									<p class="text-sm font-medium" style="color: var(--sys-label3)">Diajukan {formatDate(r.tanggal_pengajuan)}</p>
									<span class="px-2 py-0.5 rounded text-xs font-bold bg-slate-100 text-slate-600">Tenor {r.tenor} bulan</span>
								</div>
								{#if r.status === 'approved'}
									<p class="text-xs font-semibold" style="color: var(--sys-label3)">
										Cicilan: {formatRupiah(r.cicilan_per_bulan || 0)}/bulan · Terbayar: {formatRupiah(r.total_paid || 0)} / {formatRupiah(r.nominal)}
									</p>
									{#if r.jadwalAngsuran?.length}
										<div class="mt-3 relative z-10">
											<p class="text-xs font-bold mb-1.5" style="color: var(--sys-label)">Jadwal Angsuran</p>
											<div class="flex flex-col gap-1">
												{#each r.jadwalAngsuran as j}
													<div class="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg" style="background: {j.status === 'terbayar' ? 'var(--gg)' : 'var(--sys-fill)'}">
														<span>Ke-{j.urutan} · {formatPeriode(j.periode)}</span>
														<span class="font-semibold">{formatRupiah(j.nominal_rencana)} {j.status === 'terbayar' ? '✓' : ''}</span>
													</div>
												{/each}
											</div>
										</div>
									{/if}
									{#if r.riwayatPotongan?.length}
										<div class="mt-3 relative z-10">
											<p class="text-xs font-bold mb-1.5" style="color: var(--sys-label)">Riwayat Potongan</p>
											<div class="flex flex-col gap-1">
												{#each r.riwayatPotongan as p}
													<div class="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-lg" style="background: var(--sys-fill)">
														<span>{formatPeriode(p.periode)} · {formatDate(p.tanggal)}</span>
														<span class="font-semibold">-{formatRupiah(p.nominal_potongan)}</span>
													</div>
												{/each}
											</div>
										</div>
									{/if}
									<button class="mt-3 text-xs font-bold px-3 py-1.5 rounded-lg border relative z-10 print:hidden" style="border-color: var(--sys-sep); color: var(--sys-label3)" onclick={cetakKartuHutang}>
										🖨️ Cetak / Unduh PDF
									</button>
								{/if}
								{#if r.keterangan}
									<p class="text-sm bg-white/50 p-3 rounded-xl border border-white/20 relative z-10 mt-2" style="color: var(--sys-label)">{r.keterangan}</p>
								{/if}
								{#if r.status === 'Ditolak' && r.catatan_penolakan}
									<p class="text-xs mt-3 px-3 py-2 rounded-xl border relative z-10" style="background: var(--rel); color: var(--red); border-color: var(--re)"><strong>Alasan Penolakan:</strong> {r.catatan_penolakan}</p>
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
	judul="Riwayat Kasbon Saya"
	filename="kasbon-saya"
	columns={exportColumns}
	rows={exportRows}
	watermark="Dokumen pribadi — bukan bukti pembayaran"
/>
