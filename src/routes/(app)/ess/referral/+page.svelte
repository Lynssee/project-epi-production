<!-- src/routes/(app)/ess/referral/+page.svelte -->
<!-- ESS Rekomendasi Relasi (Internal Referral Rekrutmen) — Mobile First untuk kru lapangan & kantor -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import {
		getReferralData,
		submitReferral,
		type ReferralJobItem,
		type MyReferralItem
	} from '$lib/services/ess/referral';
	import {
		IconBriefcase,
		IconGift,
		IconUsersGroup,
		IconCheck,
		IconAlertTriangle,
		IconArrowRight,
		IconUpload,
		IconChevronDown,
		IconChevronUp,
		IconSearch,
		IconPlus,
		IconX,
		IconBuildingFactory2,
		IconMapPin,
		IconClock,
		IconFileText
	} from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let successMsg = $state('');

	let jobs = $state<ReferralJobItem[]>([]);
	let myReferrals = $state<MyReferralItem[]>([]);
	let activeTab = $state<'jobs' | 'my'>('jobs');
	let searchQuery = $state('');
	let expandedJobId = $state<number | null>(null);

	// Modal Submit State
	let showModal = $state(false);
	let submitting = $state(false);
	let formJobId = $state<number | null>(null);
	let formNama = $state('');
	let formNoHp = $state('');
	let formEmail = $state('');
	let formHubungan = $state('Mantan Rekan Kerja');
	let formAlasan = $state('');
	let formCvFile = $state<File | null>(null);

	const HUBUNGAN_OPTIONS = [
		'Mantan Rekan Kerja',
		'Teman Sekolah / Kuliah',
		'Keluarga / Kerabat',
		'Kenalan Profesional',
		'Lainnya'
	];

	function formatRupiah(num: number | null | undefined): string {
		if (num == null) return 'Rp 0';
		return 'Rp ' + Number(num).toLocaleString('id-ID');
	}

	function formatDate(dateStr: string | null | undefined): string {
		if (!dateStr) return '-';
		const d = new Date(dateStr);
		if (isNaN(d.getTime())) return dateStr;
		return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
	}

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const res = await getReferralData();
			jobs = res.jobs || [];
			myReferrals = res.myReferrals || [];
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat data program referral.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	let filteredJobs = $derived(
		jobs.filter((j) => {
			if (!searchQuery.trim()) return true;
			const q = searchQuery.toLowerCase();
			return (
				(j.judul_posisi || '').toLowerCase().includes(q) ||
				(j.departemen || '').toLowerCase().includes(q) ||
				(j.lokasi || '').toLowerCase().includes(q)
			);
		})
	);

	function openSubmitModal(jobId?: number) {
		formJobId = jobId || (jobs.length > 0 ? jobs[0].id : null);
		formNama = '';
		formNoHp = '';
		formEmail = '';
		formHubungan = 'Mantan Rekan Kerja';
		formAlasan = '';
		formCvFile = null;
		errorMsg = '';
		showModal = true;
	}

	function handleFileChange(e: Event) {
		const target = e.target as HTMLInputElement;
		if (target.files && target.files[0]) {
			formCvFile = target.files[0];
		}
	}

	async function handleSubmit() {
		if (!formJobId || !formNama.trim() || !formNoHp.trim()) {
			alert('Mohon lengkapi lowongan, nama kandidat, dan nomor WhatsApp.');
			return;
		}

		submitting = true;
		errorMsg = '';
		try {
			const fd = new FormData();
			fd.append('lowongan_id', String(formJobId));
			fd.append('nama', formNama.trim());
			fd.append('no_hp', formNoHp.trim());
			if (formEmail.trim()) fd.append('email', formEmail.trim());
			fd.append('hubungan_relasi', formHubungan);
			if (formAlasan.trim()) fd.append('alasan_rekomendasi', formAlasan.trim());
			if (formCvFile) fd.append('cv', formCvFile);

			const res = await submitReferral(fd);
			showModal = false;
			successMsg = res.message || 'Rekomendasi Anda berhasil dikirim ke tim HRD!';
			activeTab = 'my';
			await load();
			setTimeout(() => {
				successMsg = '';
			}, 6000);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengirim rekomendasi.';
		} finally {
			submitting = false;
		}
	}

	function getStatusColor(status: string) {
		switch (status) {
			case 'Reward_Paid':
				return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
			case 'Reward_Eligible':
				return 'bg-purple-500/15 text-purple-400 border-purple-500/30';
			case 'Hired':
			case 'Probation':
				return 'bg-teal-500/15 text-teal-400 border-teal-500/30';
			case 'Offered':
			case 'Interview':
				return 'bg-blue-500/15 text-blue-400 border-blue-500/30';
			case 'Screening':
			case 'Diajukan':
				return 'bg-amber-500/15 text-amber-400 border-amber-500/30';
			case 'Rejected':
				return 'bg-red-500/15 text-red-400 border-red-500/30';
			default:
				return 'bg-slate-500/15 text-slate-400 border-slate-500/30';
		}
	}

	function getStatusText(status: string) {
		switch (status) {
			case 'Diajukan':
				return 'Diajukan (Review Awal)';
			case 'Screening':
				return 'Tahap Screening';
			case 'Interview':
				return 'Tahap Wawancara';
			case 'Offered':
				return 'Penawaran Kerja (Offered)';
			case 'Hired':
				return 'Diterima Bekerja (Hired)';
			case 'Probation':
				return 'Masa Percobaan 3 Bulan';
			case 'Reward_Eligible':
				return '🎁 Lolos Probation (Bonus Siap Cair)';
			case 'Reward_Paid':
				return '✓ Bonus Telah Dicairkan';
			case 'Rejected':
				return 'Belum Lolos Kualifikasi';
			default:
				return status;
		}
	}
</script>

<div class="w-full p-4 md:p-6 pb-28 max-w-4xl mx-auto space-y-6">
	<!-- HEADER -->
	<div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
		<div>
			<div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20 mb-2">
				<span>🤝 Program Referral Internal</span>
			</div>
			<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Rekomendasi Relasi</h1>
			<p class="text-xs md:text-sm mt-1" style="color: var(--sys-label3)">
				Rekomendasikan kerabat/rekan kerja terbaik Anda & raih bonus tunai saat mereka bergabung.
			</p>
		</div>

		<button
			type="button"
			onclick={() => openSubmitModal()}
			class="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs md:text-sm text-white shadow-lg shadow-purple-600/25 bg-gradient-to-r from-purple-600 to-indigo-600 hover:brightness-110 active:scale-95 transition-all"
		>
			<IconPlus size={18} />
			<span>Rekomendasikan Teman</span>
		</button>
	</div>

	<!-- ALERT SUKSES / ERROR -->
	{#if successMsg}
		<div class="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs md:text-sm flex items-center gap-3 animate-in fade-in">
			<IconCheck size={20} class="shrink-0" />
			<div class="font-medium">{successMsg}</div>
		</div>
	{/if}

	{#if errorMsg}
		<div class="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs md:text-sm flex items-center gap-3 animate-in fade-in">
			<IconAlertTriangle size={20} class="shrink-0" />
			<div class="font-medium">{errorMsg}</div>
		</div>
	{/if}

	<!-- TAB SELECTOR -->
	<div class="flex items-center gap-2 p-1 rounded-2xl bg-slate-900/40 border border-slate-800/80">
		<button
			type="button"
			onclick={() => (activeTab = 'jobs')}
			class="flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 {activeTab === 'jobs' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}"
		>
			<IconBriefcase size={16} />
			<span>Lowongan Dibuka</span>
			<span class="px-1.5 py-0.2 rounded-full text-[10px] {activeTab === 'jobs' ? 'bg-purple-800 text-purple-200' : 'bg-slate-800 text-slate-400'}">{jobs.length}</span>
		</button>

		<button
			type="button"
			onclick={() => (activeTab = 'my')}
			class="flex-1 py-2 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 {activeTab === 'my' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'}"
		>
			<IconUsersGroup size={16} />
			<span>Rekomendasi Saya</span>
			<span class="px-1.5 py-0.2 rounded-full text-[10px] {activeTab === 'my' ? 'bg-purple-800 text-purple-200' : 'bg-slate-800 text-slate-400'}">{myReferrals.length}</span>
		</button>
	</div>

	<!-- TAB 1: LOWONGAN DIBUKA -->
	{#if activeTab === 'jobs'}
		<div class="space-y-4">
			<!-- PENCARIAN -->
			<div class="relative">
				<input
					type="text"
					bind:value={searchQuery}
					placeholder="Cari posisi pekerjaan, departemen, atau site proyek..."
					class="w-full pl-10 pr-4 py-2.5 rounded-xl text-xs bg-slate-900/60 border border-slate-800 focus:border-purple-500 outline-none text-white placeholder-slate-500"
				/>
				<IconSearch size={18} class="absolute left-3 top-3 text-slate-500" />
			</div>

			{#if loading}
				<div class="py-16 flex flex-col items-center justify-center">
					<CircularProgressGauge size={48} strokeWidth={4} label="Memuat lowongan referral..." />
				</div>
			{:else if filteredJobs.length === 0}
				<div class="glass-panel rounded-2xl p-8 text-center border border-slate-800/80">
					<div class="w-14 h-14 rounded-2xl bg-purple-500/10 flex items-center justify-center mx-auto mb-3 text-purple-400">
						<IconBriefcase size={28} />
					</div>
					<h3 class="text-sm font-bold text-slate-200">Tidak Ada Lowongan Referral Aktif</h3>
					<p class="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
						Saat ini belum ada posisi yang membuka jalur rekomendasi karyawan. Silakan periksa kembali berkala.
					</p>
				</div>
			{:else}
				<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
					{#each filteredJobs as job (job.id)}
						<div class="glass-panel rounded-2xl p-4 border border-slate-800/80 hover:border-purple-500/40 transition-all flex flex-col justify-between space-y-4">
							<div class="space-y-2.5">
								<!-- Title & Bonus Tag -->
								<div class="flex items-start justify-between gap-2">
									<div>
										<h2 class="text-sm md:text-base font-extrabold text-white leading-snug">{job.judul_posisi}</h2>
										<div class="text-[11px] text-slate-400 mt-0.5 flex items-center gap-2">
											<span>{job.departemen}</span>
											<span>•</span>
											<span>{job.tipe_pekerjaan}</span>
										</div>
									</div>
									<div class="shrink-0 px-2.5 py-1 rounded-xl bg-gradient-to-r from-purple-500/20 to-emerald-500/20 border border-emerald-500/30 text-emerald-400 font-black text-xs inline-flex items-center gap-1 shadow-sm">
										<IconGift size={14} />
										<span>{formatRupiah(job.referral_reward_nominal || 0)}</span>
									</div>
								</div>

								<!-- Info Badges -->
								<div class="flex flex-wrap items-center gap-2 pt-1 text-[11px] text-slate-400">
									<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-800/60 border border-slate-700/60">
										<IconMapPin size={12} class="text-slate-500" />
										<span>{job.lokasi || 'Site Operasional'}</span>
									</span>
									{#if job.batas_lamaran}
										<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-800/60 border border-slate-700/60">
											<IconClock size={12} class="text-slate-500" />
											<span>Batas: {formatDate(job.batas_lamaran)}</span>
										</span>
									{/if}
								</div>

								<!-- Syarat / Deskripsi -->
								{#if job.referral_terms}
									<div class="p-2.5 rounded-xl bg-purple-500/5 border border-purple-500/15 text-[11px] text-purple-300">
										<span class="font-bold">Ketentuan Bonus:</span> {job.referral_terms}
									</div>
								{/if}

								{#if expandedJobId === job.id}
									<div class="pt-2 border-t border-slate-800 space-y-2 text-xs text-slate-300 animate-in fade-in">
										{#if job.deskripsi}
											<div>
												<span class="font-bold text-slate-400 text-[10px] uppercase">Deskripsi:</span>
												<p class="whitespace-pre-line text-slate-300 text-[11px] mt-0.5">{job.deskripsi}</p>
											</div>
										{/if}
										{#if job.persyaratan}
											<div>
												<span class="font-bold text-slate-400 text-[10px] uppercase">Kualifikasi:</span>
												<p class="whitespace-pre-line text-slate-300 text-[11px] mt-0.5">{job.persyaratan}</p>
											</div>
										{/if}
									</div>
								{/if}
							</div>

							<div class="pt-2 border-t border-slate-800/60 flex items-center justify-between gap-2">
								<button
									type="button"
									onclick={() => (expandedJobId = expandedJobId === job.id ? null : job.id)}
									class="text-[11px] text-slate-400 hover:text-white font-medium inline-flex items-center gap-1"
								>
									<span>{expandedJobId === job.id ? 'Tutup Detail' : 'Lihat Syarat'}</span>
									{#if expandedJobId === job.id}
										<IconChevronUp size={14} />
									{:else}
										<IconChevronDown size={14} />
									{/if}
								</button>

								<button
									type="button"
									onclick={() => openSubmitModal(job.id)}
									class="px-3 py-1.5 rounded-xl text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 transition-colors inline-flex items-center gap-1"
								>
									<span>Rekomendasikan</span>
									<IconArrowRight size={14} />
								</button>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	<!-- TAB 2: REKOMENDASI SAYA -->
	{#if activeTab === 'my'}
		<div class="space-y-4">
			{#if loading}
				<div class="py-16 flex flex-col items-center justify-center">
					<CircularProgressGauge size={48} strokeWidth={4} label="Memuat riwayat rekomendasi..." />
				</div>
			{:else if myReferrals.length === 0}
				<div class="glass-panel rounded-2xl p-8 text-center border border-slate-800/80">
					<div class="w-14 h-14 rounded-2xl bg-purple-500/10 flex items-center justify-center mx-auto mb-3 text-purple-400">
						<IconUsersGroup size={28} />
					</div>
					<h3 class="text-sm font-bold text-slate-200">Belum Ada Rekomendasi</h3>
					<p class="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
						Anda belum pernah mengajukan rekomendasi relasi. Pilih lowongan terbuka dan rekomendasikan teman atau kerabat Anda!
					</p>
					<button
						type="button"
						onclick={() => (activeTab = 'jobs')}
						class="mt-4 px-4 py-2 rounded-xl text-xs font-bold text-white bg-purple-600 hover:bg-purple-700 transition-all inline-flex items-center gap-1.5"
					>
						<span>Lihat Lowongan Terbuka</span>
						<IconArrowRight size={14} />
					</button>
				</div>
			{:else}
				<div class="space-y-3">
					{#each myReferrals as ref (ref.id)}
						<div class="glass-panel rounded-2xl p-4 border border-slate-800/80 space-y-3">
							<!-- Top Row -->
							<div class="flex items-start justify-between gap-3">
								<div>
									<h2 class="text-sm font-bold text-white">{ref.kandidat?.nama || 'Kandidat #' + ref.kandidat_id}</h2>
									<div class="text-xs text-purple-400 font-semibold mt-0.5">
										{ref.lowongan?.judul_posisi || 'Posisi #' + ref.lowongan_id}
									</div>
									<div class="text-[11px] text-slate-400 mt-1">
										Hubungan: <span class="text-slate-300 font-medium">{ref.hubungan_relasi}</span> • Diajukan: {formatDate(ref.tanggal_rekomendasi)}
									</div>
								</div>

								<div class="text-right">
									<span class="inline-block px-2.5 py-1 rounded-xl text-[10px] font-bold border {getStatusColor(ref.status)}">
										{getStatusText(ref.status)}
									</span>
									<div class="text-[11px] font-black text-emerald-400 mt-1">
										{formatRupiah(ref.reward_amount || ref.lowongan?.referral_reward_nominal || 0)}
									</div>
								</div>
							</div>

							<!-- Catatan atau Alasan -->
							{#if ref.alasan_rekomendasi}
								<div class="p-2.5 rounded-xl bg-slate-900/60 border border-slate-800 text-[11px] text-slate-400">
									<span class="font-bold text-slate-300">Catatan Rekomendasi:</span> "{ref.alasan_rekomendasi}"
								</div>
							{/if}

							<!-- Timeline Status Ringkas -->
							<div class="pt-2 border-t border-slate-800/70 text-[10px] text-slate-400 flex items-center justify-between">
								<div>
									{#if ref.status === 'Reward_Paid'}
										<span class="text-emerald-400 font-bold">✓ Reward berhasil dicairkan pada {formatDate(ref.tanggal_reward_cair)}</span>
									{:else if ref.status === 'Reward_Eligible'}
										<span class="text-purple-400 font-bold">🎁 Kandidat lulus probation! Reward siap diproses ke payroll.</span>
									{:else if ref.status === 'Hired' || ref.status === 'Probation'}
										<span class="text-teal-400">Sedang menjalani masa percobaan (estimasi evaluasi 3 bulan).</span>
									{:else if ref.status === 'Rejected'}
										<span class="text-red-400">Terima kasih atas rekomendasi Anda. Kandidat belum lolos kriteria saat ini.</span>
									{:else}
										<span class="text-slate-400">Sedang ditinjau oleh tim rekrutmen HRD.</span>
									{/if}
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>

<!-- MODAL FORM PENGAJUAN REKOMENDASI -->
{#if showModal}
	<div class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
		<div class="bg-slate-900 rounded-3xl max-w-lg w-full max-h-[90vh] flex flex-col border border-slate-800 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
			<!-- Modal Header -->
			<div class="p-5 border-b border-slate-800 flex items-center justify-between bg-purple-950/20">
				<div>
					<h3 class="text-base font-extrabold text-white">Formulir Rekomendasi Relasi</h3>
					<p class="text-xs text-slate-400 mt-0.5">Isi data relasi Anda dengan benar untuk dihubungi tim HRD</p>
				</div>
				<button
					type="button"
					onclick={() => (showModal = false)}
					class="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center"
				>
					<IconX size={18} />
				</button>
			</div>

			<!-- Modal Body (Scrollable) -->
			<form onsubmit={(e) => { e.preventDefault(); handleSubmit(); }} class="p-5 overflow-y-auto space-y-4 text-xs">
				<!-- Pilih Lowongan -->
				<div>
					<label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Posisi Lowongan *</label>
					<select
						bind:value={formJobId}
						class="w-full px-3 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-white outline-none focus:border-purple-500 font-semibold"
					>
						{#each jobs as job}
							<option value={job.id}>{job.judul_posisi} ({job.departemen}) — Bonus: {formatRupiah(job.referral_reward_nominal || 0)}</option>
						{/each}
					</select>
				</div>

				<!-- Nama Kandidat -->
				<div>
					<label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Nama Lengkap Relasi *</label>
					<input
						type="text"
						bind:value={formNama}
						placeholder="Nama lengkap sesuai KTP"
						required
						class="w-full px-3 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-white outline-none focus:border-purple-500"
					/>
				</div>

				<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
					<!-- No WhatsApp -->
					<div>
						<label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Nomor WhatsApp / HP *</label>
						<input
							type="tel"
							bind:value={formNoHp}
							placeholder="Contoh: 081234567890"
							required
							class="w-full px-3 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-white outline-none focus:border-purple-500"
						/>
					</div>

					<!-- Email (Opsional) -->
					<div>
						<label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Alamat Email (Opsional)</label>
						<input
							type="email"
							bind:value={formEmail}
							placeholder="nama@email.com"
							class="w-full px-3 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-white outline-none focus:border-purple-500"
						/>
					</div>
				</div>

				<!-- Hubungan Relasi -->
				<div>
					<label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Hubungan Relasi Anda *</label>
					<select
						bind:value={formHubungan}
						class="w-full px-3 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-white outline-none focus:border-purple-500 font-medium"
					>
						{#each HUBUNGAN_OPTIONS as opt}
							<option value={opt}>{opt}</option>
						{/each}
					</select>
				</div>

				<!-- Alasan Rekomendasi -->
				<div>
					<label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Kelebihan / Pengalaman Relevan Kandidat</label>
					<textarea
						bind:value={formAlasan}
						rows="3"
						placeholder="Jelaskan secara singkat kompetensi atau pengalaman kerja relasi Anda..."
						class="w-full px-3 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-white outline-none focus:border-purple-500 resize-none placeholder-slate-500"
					></textarea>
				</div>

				<!-- Upload CV File -->
				<div>
					<label class="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Berkas CV / Portofolio (PDF/Word/Foto)</label>
					<label class="flex flex-col items-center justify-center p-4 border-2 border-dashed border-slate-700 hover:border-purple-500 rounded-2xl cursor-pointer bg-slate-800/40 transition-colors">
						<IconUpload size={24} class="text-purple-400 mb-1" />
						<span class="text-xs font-semibold text-slate-300">
							{formCvFile ? formCvFile.name : 'Pilih atau foto berkas CV (Maks. 5 MB)'}
						</span>
						<span class="text-[10px] text-slate-500 mt-0.5">Format: PDF, DOC, DOCX, JPG, PNG</span>
						<input
							type="file"
							accept=".pdf,.doc,.docx,image/*"
							onchange={handleFileChange}
							class="hidden"
						/>
					</label>
				</div>

				<!-- Hint & Integritas -->
				<div class="p-3 rounded-2xl bg-purple-950/30 border border-purple-800/40 text-[11px] text-purple-300 space-y-1">
					<div class="font-bold flex items-center gap-1.5">
						<span>🛡️ Kebijakan Transparansi:</span>
					</div>
					<p class="text-purple-200/80 text-[10px] leading-relaxed">
						Pastikan relasi Anda bersedia dihubungi oleh tim HRD dan mengikuti proses seleksi formal. Bonus referral akan diproses setelah kandidat lolos masa percobaan (3 bulan).
					</p>
				</div>

				<!-- Modal Footer -->
				<div class="pt-2 flex items-center justify-end gap-2 border-t border-slate-800">
					<button
						type="button"
						onclick={() => (showModal = false)}
						class="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-800 font-semibold"
					>
						Batal
					</button>

					<button
						type="submit"
						disabled={submitting}
						class="px-5 py-2 rounded-xl text-xs text-white bg-gradient-to-r from-purple-600 to-indigo-600 hover:brightness-110 font-bold shadow-lg shadow-purple-600/30 disabled:opacity-50 flex items-center gap-2"
					>
						{#if submitting}
							<div class="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
							<span>Mengirim...</span>
						{:else}
							<span>Kirim Rekomendasi</span>
						{/if}
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
