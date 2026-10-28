<!-- src/routes/(app)/anggaran/rapor-kecepatan/+page.svelte -->
<!-- R10 (Forecast Keuangan Global, rekomendasi laporan) — Rapor Kecepatan Pengajuan: berapa
     hari rata-rata dari submit PA sampai cair, per kategori, untuk PENGAJUAN SAYA SENDIRI.
     Nol logic baru — murni UI di atas fetchPengajuanSpeedReport() (pengajuanSpeedReport.ts).

     R9 (Estimasi Pencairan) DIGABUNG di halaman yang sama, BUKAN fitur terpisah: "kapan bisa
     cair" dijawab pakai DATA YANG SAMA (rata-rata historis per kategori), dibingkai ke depan
     ("kalau ajukan sekarang, biasanya cair ~H+X") alih-alih ke belakang. Estimasi prediksi
     antrian-bayar+saldo-kas yang sesungguhnya (bukan rata-rata historis) butuh engine baru
     senilai R4/R5 — SENGAJA tidak dibangun sekarang (lihat keputusan skip R4/R5 sesi ini). -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { IconArrowLeft, IconLoader2, IconGauge, IconSparkles } from '@tabler/icons-svelte';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { authStore } from '$lib/stores/auth';
	import { fetchPengajuanSpeedReport, type PengajuanSpeedReport } from '$lib/services/pengajuanSpeedReport';

	let loading = $state(true);
	let report = $state<PengajuanSpeedReport | null>(null);
	let selectedKategori = $state<string>('');

	onMount(async () => {
		try {
			const email = get(authStore).user?.email;
			report = await fetchPengajuanSpeedReport(email);
			if (report.rows.length > 0) selectedKategori = report.rows[0].kategori;
		} catch (e) {
			console.error('Gagal memuat rapor kecepatan pengajuan:', e);
		} finally {
			loading = false;
		}
	});

	function speedLabel(days: number): { label: string; cls: string } {
		if (days <= 3) return { label: 'Cepat', cls: 'text-emerald-600' };
		if (days <= 7) return { label: 'Normal', cls: 'text-amber-600' };
		return { label: 'Lambat', cls: 'text-red-600' };
	}

	let selectedRow = $derived(report?.rows.find((r) => r.kategori === selectedKategori) || null);
	let estimatedClearDate = $derived.by(() => {
		if (!selectedRow) return null;
		const d = new Date();
		d.setDate(d.getDate() + Math.round(selectedRow.avgDays));
		return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
	});
</script>

<div class="flex-1 flex flex-col h-full">
	<div class="scroll-body px-4 py-4 max-w-3xl mx-auto w-full space-y-3">
		<div class="mb-2">
			<button
				type="button"
				onclick={() => goto('/anggaran')}
				class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition-colors mb-2"
			>
				<IconArrowLeft size={16} />
				<span>Kembali ke Anggaran</span>
			</button>
			<h2 class="text-lg font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
				<IconGauge size={20} class="text-[var(--p)]" /> Estimasi &amp; Rapor Kecepatan Pengajuan
			</h2>
		</div>
		<p class="text-[12px] text-gray-500">
			Rata-rata waktu dari pengajuan Anda diajukan sampai dana cair, dikelompokkan per
			kategori — hanya pengajuan Anda sendiri, bukan perbandingan dengan orang lain. Pakai
			bagian "Kapan Bisa Cair?" untuk estimasi sebelum mengajukan, atau lihat rincian per
			kategori di bawah untuk merencanakan lebih awal.
		</p>

		{#if loading}
			<CircularProgressGauge size={50} strokeWidth={4} label="Menghitung rapor kecepatan pencairan..." />
		{:else if !report || report.rows.length === 0}
			<div class="card-section text-[12px] text-gray-500 leading-relaxed">
				Belum ada pengajuan yang sudah cair untuk dihitung rata-rata waktunya.
				{#if report && report.totalMenunggu > 0}
					({report.totalMenunggu} pengajuan masih berjalan, belum dihitung.)
				{/if}
			</div>
		{:else}
			<!-- R9: Estimasi Pencairan self-service, pakai data historis yang sama -->
			<div class="card-section space-y-2" style="border-color: var(--p, #7c3aed); border-width: 1.5px;">
				<div class="flex items-center gap-1.5">
					<IconSparkles size={16} class="text-[var(--p)]" />
					<p class="text-sm font-bold text-gray-900">Kapan Bisa Cair? (Estimasi)</p>
				</div>
				<label class="block text-[11px] text-gray-500">
					Kategori yang mau saya ajukan:
					<select
						bind:value={selectedKategori}
						class="mt-1 w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs text-gray-800"
					>
						{#each report.rows as row (row.kategori)}
							<option value={row.kategori}>{row.kategori.replace(/_/g, ' ')}</option>
						{/each}
					</select>
				</label>
				{#if selectedRow}
					<p class="text-[12px] text-gray-700">
						Berdasarkan {selectedRow.count} pengajuan Anda sebelumnya di kategori ini, biasanya
						cair dalam rata-rata <strong>{selectedRow.avgDays} hari</strong>. Kalau diajukan
						<strong>hari ini</strong>, perkiraan cair sekitar <strong>{estimatedClearDate}</strong>.
					</p>
				{/if}
				<p class="text-[10px] text-gray-400">
					ⓘ Ini rata-rata riwayat Anda sendiri, BUKAN jaminan atau antrian real-time — bisa
					lebih cepat/lambat tergantung kelengkapan dokumen &amp; kondisi kas saat itu.
				</p>
			</div>

			<div class="card-section flex items-center justify-between">
				<div>
					<p class="text-[11px] text-gray-500">Rata-rata keseluruhan</p>
					<p class="text-xl font-bold text-gray-900">{report.overallAvgDays} hari</p>
				</div>
				<div class="text-right">
					<p class="text-[11px] text-gray-500">Pengajuan selesai / masih berjalan</p>
					<p class="text-sm font-semibold text-gray-700">{report.totalSelesai} / {report.totalMenunggu}</p>
				</div>
			</div>

			<div class="space-y-2">
				{#each report.rows as row (row.kategori)}
					{@const speed = speedLabel(row.avgDays)}
					<div class="card-section flex items-center justify-between gap-3">
						<div class="min-w-0">
							<p class="text-sm font-semibold text-gray-900 capitalize truncate">{row.kategori.replace(/_/g, ' ')}</p>
							<p class="text-[11px] text-gray-500 mt-0.5">
								{row.count} pengajuan · tercepat {row.minDays}h · terlama {row.maxDays}h
							</p>
						</div>
						<div class="text-right shrink-0">
							<p class="text-lg font-bold text-gray-900">{row.avgDays}h</p>
							<p class="text-[10px] font-semibold {speed.cls}">{speed.label}</p>
						</div>
					</div>
				{/each}
			</div>

			<p class="text-[10px] text-gray-400 mt-2">
				ⓘ "Cepat" ≤3 hari, "Normal" 4-7 hari, "Lambat" &gt;7 hari — ambang kasar untuk
				gambaran cepat, bukan SLA resmi. Dihitung dari tanggal pengajuan dibuat sampai
				tanggal dana dicairkan.
			</p>
		{/if}
	</div>
</div>
