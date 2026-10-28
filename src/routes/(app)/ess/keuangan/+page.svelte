<!-- src/routes/(app)/ess/keuangan/+page.svelte -->
<!-- FITUR-5: Personal Finance Dashboard Karyawan — riwayat gaji 12 bulan, proyeksi THR, status
     cicilan kasbon, estimasi take-home berjalan. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { auth } from '$lib/firebase';
	import { IconArrowLeft, IconLoader2, IconAlertTriangle, IconCircleCheck } from '@tabler/icons-svelte';

	interface RiwayatGajiRow {
		periode: string;
		gaji_bersih: number;
	}
	interface SpjItem { nomor: string; nominal: number; hariSejakCair: number; }
	interface Summary {
		riwayatGaji: RiwayatGajiRow[];
		thr: { masaKerjaBulan: number; nominalThr: number };
		kasbon: { plafon: number; sisaKasbon: number; cicilanBulanIni: number; jumlahAktif: number };
		estimasiTakeHomeBerjalan: number;
		periodeBerjalan: string;
		tanggungan?: {
			kasbon: { jumlah: number; nominal: number };
			klaimMenunggu: { jumlah: number; nominal: number };
			spj: { jumlah: number; nominal: number; terlamaHari: number; daftar: SpjItem[] };
		};
	}

	let loading = $state(true);
	let errorMsg = $state('');
	let summary = $state<Summary | null>(null);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const idToken = await auth.currentUser?.getIdToken();
			if (!idToken) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
			const res = await fetch('/api/ess/keuangan/summary', { headers: { Authorization: `Bearer ${idToken}` } });
			if (!res.ok) throw new Error('Gagal memuat data keuangan.');
			summary = await res.json();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat data keuangan.';
		} finally {
			loading = false;
		}
	}
	onMount(load);

	function formatRupiah(n: number | null | undefined) {
		return 'Rp ' + Math.round(n || 0).toLocaleString('id-ID');
	}
	function formatPeriode(periode: string) {
		const [year, month] = periode.split('-');
		const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
		return `${monthNames[parseInt(month) - 1] || month} ${year.slice(2)}`;
	}

	let maxGaji = $derived(
		summary && summary.riwayatGaji.length > 0
			? Math.max(...summary.riwayatGaji.map((r) => r.gaji_bersih || 0), 1)
			: 1
	);
</script>

<div class="w-full p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/ess')}>
		<IconArrowLeft size={15} /> Kembali
	</button>
	<div class="mb-6">
		<h1 class="text-2xl font-extrabold tracking-tight gradient-text">Keuangan Saya</h1>
		<p class="text-sm mt-1 font-medium" style="color: var(--sys-label3)">Ringkasan gaji, THR, dan kasbon Anda</p>
	</div>

	{#if loading}
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data keuangan..." />
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
	{:else if summary}
		<div class="flex flex-col gap-4">
			<!-- F6.4 — Tanggungan Saya -->
			{#if summary.tanggungan}
				{@const t = summary.tanggungan}
				{@const totalTanggungan = t.spj.jumlah + t.klaimMenunggu.jumlah}
				<div class="glass-panel rounded-2xl p-5">
					<div class="flex items-center gap-2 mb-3">
						<p class="text-sm font-bold" style="color: var(--sys-label)">📌 Tanggungan Saya</p>
						{#if totalTanggungan > 0}
							<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{totalTanggungan} perlu tindakan</span>
						{/if}
					</div>

					{#if t.spj.jumlah === 0 && t.klaimMenunggu.jumlah === 0 && t.kasbon.jumlah === 0}
						<div class="flex items-center gap-2 text-sm" style="color: var(--sys-label3)">
							<IconCircleCheck size={18} style="color: #16a34a" /> Tidak ada tanggungan. Aman untuk mengajukan yang baru.
						</div>
					{:else}
						<div class="space-y-2.5">
							{#if t.spj.jumlah > 0}
								<div class="flex items-start justify-between gap-3 p-3 rounded-xl bg-red-50 border border-red-200">
									<div class="min-w-0">
										<p class="text-sm font-bold text-red-800">SPJ / Pertanggungjawaban belum selesai</p>
										<p class="text-xs text-red-600 mt-0.5">
											{t.spj.jumlah} pengajuan · {formatRupiah(t.spj.nominal)}
											{#if t.spj.terlamaHari > 0} · terlama {t.spj.terlamaHari} hari sejak cair{/if}
										</p>
										{#if t.spj.daftar.length > 0}
											<p class="text-[11px] text-red-500 mt-1 truncate">
												{t.spj.daftar.map((s) => s.nomor).join(', ')}
											</p>
										{/if}
										<p class="text-[11px] text-red-500 mt-1">Serahkan bukti nota ke Finance — SPJ menunggak memblokir pengajuan operasional baru (gate G17).</p>
									</div>
								</div>
							{/if}

							{#if t.klaimMenunggu.jumlah > 0}
								<div class="flex items-start justify-between gap-3 p-3 rounded-xl bg-blue-50 border border-blue-200">
									<div class="min-w-0">
										<p class="text-sm font-bold text-blue-800">Klaim reimburse menunggu proses</p>
										<p class="text-xs text-blue-600 mt-0.5">{t.klaimMenunggu.jumlah} klaim · {formatRupiah(t.klaimMenunggu.nominal)} belum dibayarkan</p>
									</div>
									<button class="text-[11px] font-semibold text-blue-700 shrink-0" onclick={() => goto('/ess/reimburse')}>Lihat</button>
								</div>
							{/if}

							{#if t.kasbon.jumlah > 0}
								<div class="flex items-start justify-between gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
									<div class="min-w-0">
										<p class="text-sm font-bold" style="color: var(--sys-label)">Kasbon aktif</p>
										<p class="text-xs mt-0.5" style="color: var(--sys-label3)">{t.kasbon.jumlah} kasbon · sisa utang {formatRupiah(t.kasbon.nominal)} (dicicil dari gaji)</p>
									</div>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/if}

			<!-- Estimasi take-home berjalan -->
			<div class="glass-panel rounded-2xl p-5">
				<p class="text-xs font-bold uppercase" style="color: var(--sys-label4)">Estimasi Take-Home Periode {summary.periodeBerjalan}</p>
				<p class="text-2xl font-black gradient-text tracking-tight mt-1">{formatRupiah(summary.estimasiTakeHomeBerjalan)}</p>
				<p class="text-[10px] mt-1" style="color: var(--sys-label4)">⚠️ Estimasi kasar (basis gaji pokok + tunjangan + lembur berjalan, dikurangi rata-rata potongan). Slip resmi tetap dari HRD setelah periode tutup.</p>
			</div>

			<!-- Riwayat Gaji 12 Bulan -->
			<div class="glass-panel rounded-2xl p-5">
				<p class="text-sm font-bold mb-3" style="color: var(--sys-label)">Riwayat Gaji Bersih (12 Bulan)</p>
				{#if summary.riwayatGaji.length === 0}
					<p class="text-xs" style="color: var(--sys-label4)">Belum ada slip gaji tersimpan.</p>
				{:else}
					<div class="flex items-end gap-1.5 h-32">
						{#each summary.riwayatGaji as row (row.periode)}
							<div class="flex-1 flex flex-col items-center justify-end gap-1">
								<div class="w-full rounded-t gradient-bg" style="height: {Math.max(4, (row.gaji_bersih / maxGaji) * 100)}%"></div>
								<span class="text-[8px] rotate-0" style="color: var(--sys-label4)">{formatPeriode(row.periode)}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Proyeksi THR -->
			<div class="glass-panel rounded-2xl p-5">
				<p class="text-sm font-bold mb-1" style="color: var(--sys-label)">🎁 Proyeksi THR</p>
				<p class="text-xl font-black gradient-text tracking-tight">{formatRupiah(summary.thr.nominalThr)}</p>
				<p class="text-[10px] mt-1" style="color: var(--sys-label4)">
					Masa kerja {summary.thr.masaKerjaBulan} bulan
					{summary.thr.masaKerjaBulan < 12 ? '(prorata, belum genap 1 tahun)' : '(penuh 1x gaji + tunjangan tetap)'}.
					Belum termasuk potongan PPh21 atas THR.
				</p>
			</div>

			<!-- Status Kasbon -->
			<div class="glass-panel rounded-2xl p-5">
				<p class="text-sm font-bold mb-3" style="color: var(--sys-label)">💳 Status Kasbon</p>
				<div class="grid grid-cols-2 gap-3 text-sm">
					<div>
						<p class="text-[10px] font-bold uppercase" style="color: var(--sys-label4)">Plafon</p>
						<p class="font-bold" style="color: var(--sys-label)">{formatRupiah(summary.kasbon.plafon)}</p>
					</div>
					<div>
						<p class="text-[10px] font-bold uppercase" style="color: var(--sys-label4)">Sisa Utang Aktif</p>
						<p class="font-bold" style="color: var(--sys-label)">{formatRupiah(summary.kasbon.sisaKasbon)}</p>
					</div>
					<div>
						<p class="text-[10px] font-bold uppercase" style="color: var(--sys-label4)">Cicilan Bulan Ini</p>
						<p class="font-bold" style="color: var(--sys-label)">{formatRupiah(summary.kasbon.cicilanBulanIni)}</p>
					</div>
					<div>
						<p class="text-[10px] font-bold uppercase" style="color: var(--sys-label4)">Kasbon Aktif</p>
						<p class="font-bold" style="color: var(--sys-label)">{summary.kasbon.jumlahAktif}</p>
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>
