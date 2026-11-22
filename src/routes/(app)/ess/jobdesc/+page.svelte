<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		fetchJobdescSaya,
		fetchJobdescKonfirmasi,
		konfirmasiBacaJobdesc,
		type JobdescSayaResult,
		type JobdescKonfirmasi
	} from '$lib/services/jobdescSaya';
	import {
		IconArrowLeft,
		IconBriefcase,
		IconShieldCheck,
		IconAlertTriangle,
		IconCheck,
		IconX,
		IconFileText,
		IconAward,
		IconUpload,
		IconChevronRight
	} from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let data = $state<JobdescSayaResult | null>(null);
	let konf = $state<JobdescKonfirmasi | null>(null);
	let konfBusy = $state(false);
	let konfMsg = $state('');

	// Bagian lanjutan jobdesc (13 bagian; bagian 2-4 & 11 sudah tampil di atas). Sumber: kolom lama + bagian_tambahan.
	const LANJUTAN: { key: string; label: string; hint: string; text?: boolean; col?: boolean }[] = [
		{ key: 'wewenang', label: 'Wewenang & Batas Keputusan', hint: 'Apa yang boleh Anda putuskan sendiri dan kapan harus lapor atasan.' },
		{ key: 'hubungan_internal', label: 'Hubungan Kerja Internal', hint: 'Dari siapa Anda menerima pekerjaan dan ke siapa menyerahkan hasilnya.', col: true },
		{ key: 'hubungan_eksternal', label: 'Hubungan Kerja Eksternal', hint: 'Pihak luar yang rutin berinteraksi dengan Anda.', col: true },
		{ key: 'kpi_sla', label: 'KPI & SLA', hint: 'Ukuran penilaian kerja dan batas waktu layanan.' },
		{ key: 'dokumen_form', label: 'Dokumen / Form yang Dipegang', hint: 'Dokumen yang Anda isi, periksa, atau tanda tangani.' },
		{ key: 'alat_sistem', label: 'Alat & Sistem', hint: 'Aplikasi, alat, dan perlengkapan yang Anda pakai.' },
		{ key: 'k3_risiko', label: 'K3 / Risiko Jabatan', hint: 'Bahaya utama dan perlengkapan keselamatan yang wajib dipakai.' },
		{ key: 'jalur_karier', label: 'Jalur Karier', hint: 'Kemungkinan jenjang berikutnya dari jabatan ini.' },
		{ key: 'catatan_khusus', label: 'Catatan Khusus', hint: 'Hal lain yang perlu Anda ketahui tentang jabatan ini.', text: true }
	];

	function extra(): Record<string, any> {
		let b: any = data?.jobdesc?.bagian_tambahan;
		if (typeof b === 'string') {
			try {
				b = JSON.parse(b);
			} catch {
				b = null;
			}
		}
		return b && typeof b === 'object' && !Array.isArray(b) ? b : {};
	}
	function listOf(sec: { key: string; col?: boolean }): string[] {
		const raw: any = sec.col ? (data?.jobdesc as any)?.[sec.key] : extra()[sec.key];
		const arr = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split('\n') : [];
		return arr.map((x: any) => String(x ?? '').trim()).filter(Boolean);
	}
	function textOf(key: string): string {
		const v = extra()[key];
		return typeof v === 'string' ? v.trim() : '';
	}
	const sections = $derived(
		data?.jobdesc ? LANJUTAN.filter((x) => (x.text ? textOf(x.key) : listOf(x).length > 0)) : []
	);

	async function konfirmasi() {
		konfBusy = true;
		konfMsg = '';
		const r = await konfirmasiBacaJobdesc();
		konfBusy = false;
		if (r.ok) {
			konfMsg = 'Terima kasih, konfirmasi baca jobdesc tercatat.';
			konf = await fetchJobdescKonfirmasi();
		} else {
			konfMsg = r.error || 'Gagal mencatat konfirmasi.';
		}
	}

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			data = await fetchJobdescSaya();
			konf = data?.jobdesc ? await fetchJobdescKonfirmasi() : null;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat tugas & jobdesc.';
		} finally {
			loading = false;
		}
	}

	onMount(load);
</script>

<svelte:head>
	<title>Tugas &amp; Jobdesc Saya — ESS</title>
</svelte:head>

<div class="w-full p-4 md:p-6 pb-24 max-w-4xl mx-auto space-y-6">
	<!-- Top Bar Navigation -->
	<div class="flex items-center gap-3">
		<button
			onclick={() => goto('/ess')}
			class="w-10 h-10 rounded-2xl border flex items-center justify-center transition-colors cursor-pointer hover:bg-slate-800"
			style="background: var(--sys-bg2); border-color: var(--sys-sep); color: var(--sys-label)"
			title="Kembali ke ESS"
		>
			<IconArrowLeft size={18} />
		</button>
		<div>
			<h1 class="text-xl md:text-2xl font-extrabold tracking-tight" style="color: var(--sys-label)">
				Tugas &amp; Jobdesc Saya
			</h1>
			<p class="text-xs md:text-sm mt-0.5 font-medium" style="color: var(--sys-label3)">
				Uraian tugas pokok jabatan &amp; kepatuhan syarat kerja operasional
			</p>
		</div>
	</div>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-24">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat uraian tugas & kepatuhan..." />
		</div>
	{:else if errorMsg}
		<div class="glass-panel rounded-3xl p-8 text-center max-w-md mx-auto border border-rose-500/20">
			<div class="w-14 h-14 rounded-full bg-rose-500/10 flex items-center justify-center mx-auto mb-3 text-rose-500">
				<IconAlertTriangle size={28} />
			</div>
			<h3 class="text-base font-bold text-rose-400 mb-1">Gagal Memuat Data</h3>
			<p class="text-xs text-rose-300 mb-5">{errorMsg}</p>
			<button
				class="px-5 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 transition-colors shadow-lg cursor-pointer"
				onclick={load}
			>
				Coba Lagi
			</button>
		</div>
	{:else if data}
		<!-- Header Posisi & Badge Kepatuhan -->
		<div class="glass-panel rounded-3xl p-5 md:p-6 border relative overflow-hidden space-y-4" style="background: var(--sys-bg2); border-color: var(--sys-sep)">
			<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
				<div class="flex items-center gap-3">
					<div class="w-12 h-12 rounded-2xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/30">
						<IconBriefcase size={24} />
					</div>
					<div>
						<span class="text-[10px] font-bold uppercase tracking-wider text-emerald-400">Jabatan Resmi:</span>
						<h2 class="text-lg md:text-xl font-bold" style="color: var(--sys-label)">
							{data.posisi?.nama_posisi || data.karyawan?.posisi || 'Belum Terpetakan'}
						</h2>
						<p class="text-xs mt-0.5" style="color: var(--sys-label3)">
							{data.karyawan?.nama_karyawan} &middot; {data.karyawan?.divisi || data.posisi?.grade || '-'}
						</p>
					</div>
				</div>

				<div class="flex items-center gap-2">
					{#if data.jobdesc}
						<span class="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
							<IconCheck size={14} /> Jobdesc v{data.jobdesc.versi} Aktif
						</span>
					{:else}
						<span class="px-3 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1.5">
							<IconAlertTriangle size={14} /> Belum Ada Jobdesc Resmi
						</span>
					{/if}
				</div>
			</div>

			<!-- Panel Kepatuhan Syarat Kualifikasi (Fase 3 & 5) -->
			<div class="p-4 rounded-2xl border space-y-3" style="background: var(--sys-fill); border-color: var(--sys-sep)">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<IconShieldCheck size={18} class="text-emerald-400" />
						<span class="text-xs font-bold uppercase tracking-wider" style="color: var(--sys-label)">
							Kepatuhan Syarat Jabatan Lapangan
						</span>
					</div>
					<span class="text-xs font-bold font-mono {data.compliance.isCompliant ? 'text-emerald-400' : 'text-amber-400'}">
						{data.compliance.scorePct}% ({data.compliance.statusText})
					</span>
				</div>

				<!-- Progress bar -->
				<div class="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
					<div
						class="h-full rounded-full transition-all duration-500 {data.compliance.isCompliant ? 'bg-emerald-500' : 'bg-gradient-to-r from-amber-500 to-emerald-500'}"
						style="width: {data.compliance.scorePct}%"
					></div>
				</div>

				<!-- Checklist Items -->
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
					{#each data.compliance.items as item}
						<div class="p-2.5 rounded-xl border flex items-start justify-between gap-2" style="background: var(--sys-bg2); border-color: var(--sys-sep)">
							<div class="flex items-start gap-2 min-w-0">
								<span class="mt-0.5 text-xs font-bold {item.fulfilled ? 'text-emerald-400' : 'text-amber-400'}">
									{item.fulfilled ? '✓' : '✗'}
								</span>
								<div class="min-w-0">
									<div class="flex items-center gap-1.5 flex-wrap">
										<span class="text-xs font-semibold truncate" style="color: var(--sys-label)">
											{item.label}
										</span>
										{#if item.wajib}
											<span class="text-[9px] px-1 py-0.2 rounded font-bold bg-rose-950/70 text-rose-300 border border-rose-800/40">Wajib</span>
										{/if}
									</div>
									<p class="text-[10px] truncate mt-0.5" style="color: var(--sys-label3)" title={item.detail}>
										{item.detail}
									</p>
								</div>
							</div>

							{#if !item.fulfilled}
								{#if item.jenis === 'sertifikat_k3'}
									<button
										onclick={() => goto('/ess/sertifikasi')}
										class="px-2 py-1 bg-amber-600/20 hover:bg-amber-600 text-amber-300 hover:text-white rounded-lg text-[10px] font-semibold transition-colors shrink-0 cursor-pointer"
									>
										+ Tambah
									</button>
								{:else}
									<button
										onclick={() => goto('/ess/profil')}
										class="px-2 py-1 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-300 hover:text-white rounded-lg text-[10px] font-semibold transition-colors shrink-0 cursor-pointer"
									>
										+ Lengkapi
									</button>
								{/if}
							{/if}
						</div>
					{/each}
				</div>
			</div>
		</div>

		<!-- Detail Isi Jobdesc -->
		{#if data.jobdesc}
			<!-- Tujuan Jabatan (Job Purpose) -->
			{#if data.jobdesc.fungsi_tujuan}
				<div class="glass-panel rounded-3xl p-5 border space-y-2" style="background: var(--sys-bg2); border-color: var(--sys-sep)">
					<h3 class="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
						<IconFileText size={16} /> Tujuan Utama Jabatan (Job Purpose)
					</h3>
					<p class="text-sm leading-relaxed font-medium" style="color: var(--sys-label2)">
						{data.jobdesc.fungsi_tujuan}
					</p>
				</div>
			{/if}

			<!-- Tugas Pokok & Tanggung Jawab -->
			<div class="glass-panel rounded-3xl p-5 md:p-6 border space-y-4" style="background: var(--sys-bg2); border-color: var(--sys-sep)">
				<div class="border-b pb-3" style="border-color: var(--sys-sep)">
					<h3 class="text-sm font-bold uppercase tracking-wider flex items-center gap-2" style="color: var(--sys-label)">
						<span class="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs">📋</span>
						Tugas Pokok &amp; Tanggung Jawab Operasional
					</h3>
					<p class="text-xs mt-0.5" style="color: var(--sys-label3)">
						Diambil dari Peta Alur Bisnis (SOP) dan standar operasional perusahaan
					</p>
				</div>

				{#if data.jobdesc.tugas_pokok?.length}
					<div class="space-y-2.5">
						{#each data.jobdesc.tugas_pokok as tugas, idx}
							<div class="p-3 rounded-2xl border flex items-start gap-3 transition-colors hover:bg-slate-800/40" style="background: var(--sys-fill); border-color: var(--sys-sep)">
								<span class="w-6 h-6 rounded-full bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
									{idx + 1}
								</span>
								<p class="text-xs md:text-sm leading-snug font-medium" style="color: var(--sys-label)">
									{tugas}
								</p>
							</div>
						{/each}
					</div>
				{:else}
					<p class="text-xs text-slate-400 py-3 text-center">Belum ada tugas pokok tercatat.</p>
				{/if}
			</div>

			<!-- Persyaratan & Tugas Tambahan Grid -->
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				{#if data.jobdesc.persyaratan?.length}
					<div class="glass-panel rounded-3xl p-5 border space-y-3" style="background: var(--sys-bg2); border-color: var(--sys-sep)">
						<h4 class="text-xs font-bold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
							<IconAward size={16} /> Kualifikasi &amp; Persyaratan
						</h4>
						<ul class="space-y-2 text-xs" style="color: var(--sys-label2)">
							{#each data.jobdesc.persyaratan as req}
								<li class="flex items-start gap-2">
									<span class="text-amber-400 font-bold">&bull;</span>
									<span>{req}</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}

				{#if data.jobdesc.tugas_tambahan?.length}
					<div class="glass-panel rounded-3xl p-5 border space-y-3" style="background: var(--sys-bg2); border-color: var(--sys-sep)">
						<h4 class="text-xs font-bold uppercase tracking-wider text-indigo-400 flex items-center gap-1.5">
							<IconBriefcase size={16} /> Tugas &amp; Koordinasi Tambahan
						</h4>
						<ul class="space-y-2 text-xs" style="color: var(--sys-label2)">
							{#each data.jobdesc.tugas_tambahan as tmb}
								<li class="flex items-start gap-2">
									<span class="text-indigo-400 font-bold">&bull;</span>
									<span>{tmb}</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>

			<!-- Bagian lanjutan jobdesc (tampil hanya yang terisi) -->
			{#if sections.length}
				<div class="space-y-2">
					{#each sections as sec (sec.key)}
						<details class="glass-panel rounded-2xl border" style="background: var(--sys-bg2); border-color: var(--sys-sep)">
							<summary class="cursor-pointer px-4 py-3 text-xs font-bold uppercase tracking-wider select-none" style="color: var(--sys-label)" title={sec.hint}>
								{sec.label}
							</summary>
							<div class="px-4 pb-4 space-y-2">
								<p class="text-[11px]" style="color: var(--sys-label3)">{sec.hint}</p>
								{#if sec.text}
									<p class="text-xs leading-relaxed" style="color: var(--sys-label2)">{textOf(sec.key)}</p>
								{:else}
									<ul class="space-y-1.5 text-xs" style="color: var(--sys-label2)">
										{#each listOf(sec) as item}
											<li class="flex items-start gap-2"><span class="text-emerald-400 font-bold">&bull;</span><span>{item}</span></li>
										{/each}
									</ul>
								{/if}
							</div>
						</details>
					{/each}
				</div>
			{/if}

			<!-- Langkah kerja di alur SOP + konfirmasi baca (informasi, tidak memblokir pekerjaan) -->
			<div class="glass-panel rounded-3xl p-5 border space-y-3" style="background: var(--sys-bg2); border-color: var(--sys-sep)">
				<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
					<div>
						<h4 class="text-xs font-bold uppercase tracking-wider" style="color: var(--sys-label)">Langkah Kerja Saya di Alur SOP</h4>
						<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">Lihat langkah-langkah SOP yang menjadi tugas jabatan Anda.</p>
					</div>
					<button
						onclick={() => goto('/panduan/alur')}
						class="px-3 py-2 rounded-xl text-xs font-semibold border cursor-pointer flex items-center gap-1.5 shrink-0"
						style="border-color: var(--sys-sep); color: var(--sys-label)"
					>
						Buka Panduan Alur <IconChevronRight size={14} />
					</button>
				</div>
				{#if konf?.available}
					<div class="pt-3 border-t flex flex-col sm:flex-row sm:items-center justify-between gap-2" style="border-color: var(--sys-sep)">
						<p class="text-xs" style="color: var(--sys-label2)">
							{#if konf.confirmed}
								<span class="text-emerald-400 font-bold">✓ Sudah dibaca</span> (jobdesc v{konf.versi}).
							{:else if konf.needs_reconfirm}
								<span class="text-amber-400 font-bold">Jobdesc diperbarui ke v{konf.versi}.</span> Mohon baca dan konfirmasi ulang.
							{:else}
								Setelah membaca jobdesc di atas, tekan konfirmasi. Ini hanya pencatatan — tidak memblokir pekerjaan Anda.
							{/if}
						</p>
						{#if !konf.confirmed}
							<button
								onclick={konfirmasi}
								disabled={konfBusy}
								class="px-4 py-2 rounded-xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 cursor-pointer shrink-0"
								title="Mencatat bahwa Anda sudah membaca jobdesc versi ini"
							>
								{konfBusy ? 'Mencatat...' : 'Saya Sudah Membaca'}
							</button>
						{/if}
					</div>
					{#if konfMsg}<p class="text-[11px]" style="color: var(--sys-label3)">{konfMsg}</p>{/if}
				{/if}
			</div>
		{:else}
			<div class="glass-panel rounded-3xl p-8 text-center border border-dashed border-slate-700 space-y-3">
				<div class="w-14 h-14 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto">
					<IconBriefcase size={28} />
				</div>
				<h3 class="text-base font-bold" style="color: var(--sys-label)">Job Description Belum Diterbitkan</h3>
				<p class="text-xs max-w-md mx-auto" style="color: var(--sys-label3)">
					Jabatan Anda ({data.posisi?.nama_posisi || data.karyawan?.posisi}) belum memiliki Job Description aktif yang disahkan oleh HRD. Anda dapat berkoordinasi dengan atasan langsung atau HRD.
				</p>
			</div>
		{/if}
	{/if}
</div>
