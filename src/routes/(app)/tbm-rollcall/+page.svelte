<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import {
		IconArrowLeft, IconLoader2, IconUsers, IconAlertTriangle,
		IconCheck, IconX, IconBuilding, IconSun, IconShieldCheck,
		IconBolt, IconFlame, IconInfoCircle
	} from '@tabler/icons-svelte';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { getAssignments } from '$lib/services/manpowerAssignment';
	import directus from '$lib/services/directus';
	import { readItems } from '@directus/sdk';
	import { page } from '$app/stores';
	import SmartReplacementModal from '$lib/components/project/SmartReplacementModal.svelte';

	interface WorkerRow {
		assignment_id: number;
		manpower_id: number;
		nama: string;
		posisi: string;
		nik: string;
		status_komitmen: string;
		reliability_score: number;
		total_mangkir_count: number;
		status: 'hadir' | 'izin' | 'sakit' | 'alpha' | 'standby';
		notes: string;
	}

	let loading = $state(true);
	let saving = $state(false);
	let projects = $state<any[]>([]);
	let selectedProjectId = $state<number | null>(null);
	let tanggal = $state<string>(new Date().toISOString().split('T')[0]);
	let topicTbm = $state<string>('');
	let workers = $state<WorkerRow[]>([]);
	let successMsg = $state<string>('');
	let errorMsg = $state<string>('');
	let showSmartModal = $state(false);
	let targetReplacePosisi = $state('');
	let targetReplaceMandorId = $state<number | null>(null);

	function openReplacementModal(posisi = '', mandorId: number | null = null) {
		targetReplacePosisi = posisi;
		targetReplaceMandorId = mandorId;
		showSmartModal = true;
	}

	// Derived metrics
	let totalRencana = $derived(workers.length);
	let hadirCount = $derived(workers.filter(w => w.status === 'hadir').length);
	let izinCount = $derived(workers.filter(w => w.status === 'izin').length);
	let sakitCount = $derived(workers.filter(w => w.status === 'sakit').length);
	let alphaCount = $derived(workers.filter(w => w.status === 'alpha').length);
	let standbyCount = $derived(workers.filter(w => w.status === 'standby').length);
	let complianceRate = $derived(totalRencana > 0 ? Math.round((hadirCount / totalRencana) * 100) : 100);

	let selectedProject = $derived(projects.find(p => p.id === selectedProjectId) || null);

	onMount(async () => {
		try {
			projects = (await getProjectsForCurrentUser(true)) || [];
			const urlParamProject = $page.url.searchParams.get('project');
			if (urlParamProject && projects.some(p => String(p.id) === urlParamProject)) {
				selectedProjectId = Number(urlParamProject);
			} else if (projects.length > 0) {
				selectedProjectId = projects[0].id;
			}
			if (selectedProjectId) {
				await loadWorkersForProject();
			}
		} finally {
			loading = false;
		}
	});

	async function handleProjectChange() {
		await loadWorkersForProject();
	}

	async function loadWorkersForProject() {
		if (!selectedProjectId) {
			workers = [];
			return;
		}
		loading = true;
		errorMsg = '';
		successMsg = '';
		try {
			// 1. Ambil SPK aktif untuk proyek ini
			const assignRes = await getAssignments({ project_id: selectedProjectId, status: 'aktif' });
			const activeAssignments: any[] = assignRes.success ? assignRes.data : [];

			// 2. Ambil absensi yang sudah tercatat hari ini
			let existingAbsensi: any[] = [];
			try {
				existingAbsensi = await directus.request(
					readItems('manpower_absensi', {
						fields: ['id', 'assignment_id', 'manpower_id', 'status', 'keterangan'],
						filter: {
							project_id: { _eq: selectedProjectId },
							tanggal: { _eq: tanggal }
						},
						limit: -1
					})
				);
			} catch (err) {
				console.warn('[tbm-rollcall] Belum ada absensi hari ini:', err);
			}

			const absensiMap = new Map<number, any>();
			for (const a of (existingAbsensi || [])) {
				if (a?.assignment_id) {
					absensiMap.set(Number(a.assignment_id), a);
				}
			}

			// 3. Petakan ke baris presensi
			workers = activeAssignments.map((a: any) => {
				const mp = typeof a.manpower_id === 'object' ? a.manpower_id : null;
				const mId = mp?.id ?? a.manpower_id;
				const exist = absensiMap.get(Number(a.id));

				let initialStatus: 'hadir' | 'izin' | 'sakit' | 'alpha' | 'standby' = 'hadir';
				if (exist?.status) {
					if (['hadir', 'setengah_hari'].includes(exist.status)) initialStatus = 'hadir';
					else if (['izin', 'sakit', 'alpha', 'standby'].includes(exist.status)) initialStatus = exist.status;
				}

				return {
					assignment_id: Number(a.id),
					manpower_id: Number(mId),
					nama: mp?.nama || a.ttd_nama || `Pekerja #${mId}`,
					posisi: a.jabatan || mp?.posisi || 'Helper/Tukang',
					nik: mp?.NIK ? String(mp.NIK) : '-',
					status_komitmen: mp?.status_komitmen || 'aktif',
					reliability_score: mp?.reliability_score ?? 100,
					total_mangkir_count: mp?.total_mangkir_count ?? 0,
					status: initialStatus,
					notes: exist?.keterangan || ''
				};
			});
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat daftar manpower';
		} finally {
			loading = false;
		}
	}

	function hadirkanSemua() {
		workers = workers.map(w => ({ ...w, status: 'hadir' }));
	}

	function setWorkerStatus(index: number, newStatus: 'hadir' | 'izin' | 'sakit' | 'alpha' | 'standby') {
		workers[index].status = newStatus;
	}

	async function handleSubmit() {
		if (!selectedProjectId) {
			errorMsg = 'Pilih proyek terlebih dahulu.';
			return;
		}
		if (workers.length === 0) {
			errorMsg = 'Tidak ada manpower SPK aktif untuk proyek ini.';
			return;
		}

		saving = true;
		errorMsg = '';
		successMsg = '';
		try {
			const res = await fetch('/api/tbm-rollcall/submit', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					project_id: selectedProjectId,
					project_name: selectedProject?.name || `Proyek #${selectedProjectId}`,
					tanggal,
					topic_tbm: topicTbm.trim(),
					records: workers.map(w => ({
						assignment_id: w.assignment_id,
						manpower_id: w.manpower_id,
						nama: w.nama,
						status: w.status,
						notes: w.notes
					}))
				})
			});

			const result = await res.json();
			if (result.success) {
				successMsg = result.message || 'Presensi TBM berhasil disimpan.';
				if (typeof window !== 'undefined' && (window as any).__showToast) {
					(window as any).__showToast(successMsg, 'success');
				}
			} else {
				errorMsg = result.error || 'Gagal menyimpan presensi TBM.';
			}
		} catch (err: any) {
			errorMsg = err?.message || 'Terjadi kesalahan sistem';
		} finally {
			saving = false;
		}
	}

	function getBadgeStyle(statusKomitmen: string, score: number) {
		if (statusKomitmen === 'blacklisted_kabur' || statusKomitmen === 'blacklisted_indisipliner') {
			return { label: 'Blacklist', bg: 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30' };
		}
		if (statusKomitmen === 'dalam_pengawasan' || score < 80) {
			return { label: `Pengawasan (${score}%)`, bg: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30' };
		}
		return { label: `Komitmen Baik (${score}%)`, bg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30' };
	}
</script>

<div class="max-w-4xl mx-auto p-4 sm:p-6 space-y-5">
	<!-- Top Navigation Header -->
	<div class="flex items-center justify-between">
		<div>
			<a href="/laporan" class="inline-flex items-center gap-1 text-[12px] text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 mb-1">
				<IconArrowLeft size={14} /> Kembali ke Laporan
			</a>
			<div class="flex items-center gap-2">
				<div class="p-2 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
					<IconSun size={24} />
				</div>
				<div>
					<h1 class="text-xl font-bold text-gray-900 dark:text-white">TBM Roll-Call Pagi</h1>
					<p class="text-xs text-gray-500 dark:text-gray-400">Presensi cepat briefing keselamatan kerja (07:30–08:30 WIB) & sinkronisasi headcount riil.</p>
				</div>
			</div>
		</div>
	</div>

	<!-- Project & Date Selector Bar -->
	<div class="p-4 rounded-2xl border bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800 shadow-xs space-y-3">
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
			<div>
				<label class="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-1">Proyek Aktif</label>
				<select
					bind:value={selectedProjectId}
					onchange={handleProjectChange}
					class="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500"
				>
					{#if projects.length === 0}
						<option value="">Tidak ada proyek yang dipegang</option>
					{:else}
						{#each projects as p}
							<option value={p.id}>{p.name} (#{p.id})</option>
						{/each}
					{/if}
				</select>
			</div>
			<div>
				<label class="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-1">Tanggal Presensi</label>
				<input
					type="date"
					bind:value={tanggal}
					onchange={handleProjectChange}
					class="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500"
				/>
			</div>
		</div>

		<!-- Topik K3 / Briefing Pagi -->
		<div>
			<label class="block text-xs font-bold text-gray-700 dark:text-gray-300 uppercase mb-1">Topik Briefing K3 / TBM Hari Ini (Opsional)</label>
			<input
				type="text"
				bind:value={topicTbm}
				placeholder="Misal: Prosedur Bekerja di Ruang Terbatas (Confined Space) & APD Masker Respirator..."
				class="w-full px-3 py-2 border border-gray-300 dark:border-slate-700 rounded-xl text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500"
			/>
		</div>
	</div>

	<!-- Real-Time Metrics Strip -->
	<div class="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
		<div class="p-3 rounded-xl border bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800 text-center">
			<p class="text-[10px] font-bold text-gray-400 uppercase">Total SPK</p>
			<p class="text-lg font-bold text-gray-800 dark:text-gray-100">{totalRencana}</p>
		</div>
		<div class="p-3 rounded-xl border bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800/40 text-center">
			<p class="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">Hadir</p>
			<p class="text-lg font-bold text-emerald-700 dark:text-emerald-300">{hadirCount}</p>
		</div>
		<div class="p-3 rounded-xl border bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800/40 text-center">
			<p class="text-[10px] font-bold text-amber-600 dark:text-amber-400 uppercase">Izin / Sakit</p>
			<p class="text-lg font-bold text-amber-700 dark:text-amber-300">{izinCount + sakitCount}</p>
		</div>
		<div class="p-3 rounded-xl border bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800/40 text-center">
			<p class="text-[10px] font-bold text-rose-600 dark:text-rose-400 uppercase">Alpha / Mangkir</p>
			<p class="text-lg font-bold text-rose-700 dark:text-rose-300">{alphaCount}</p>
		</div>
		<div class="col-span-2 sm:col-span-1 p-3 rounded-xl border bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800/40 text-center">
			<p class="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase">Kepatuhan</p>
			<p class="text-lg font-bold text-indigo-700 dark:text-indigo-300">{complianceRate}%</p>
		</div>
	</div>

	<!-- Alerts and Messages -->
	{#if errorMsg}
		<div class="p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-red-600 dark:text-red-400 text-xs font-semibold flex items-center gap-2">
			<IconAlertTriangle size={16} />
			<span>{errorMsg}</span>
		</div>
	{/if}
	{#if successMsg}
		<div class="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-2">
			<IconCheck size={16} />
			<span>{successMsg}</span>
		</div>
	{/if}

	<!-- Alpha / Shortfall Smart Mitigation Banner -->
	{#if alphaCount > 0}
		<div class="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
			<div class="flex items-center gap-2 text-amber-900 dark:text-amber-200">
				<IconAlertTriangle size={18} class="shrink-0 text-amber-600 dark:text-amber-400" />
				<span>
					Terdapat <strong>{alphaCount} tenaga kerja Alpha / mangkir</strong> hari ini. Ingin mencari tenaga pengganti siap kerja dari pool?
				</span>
			</div>
			<button
				type="button"
				onclick={() => openReplacementModal()}
				class="inline-flex items-center justify-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white shadow-xs shrink-0 active:scale-95"
			>
				<IconBolt size={14} />
				<span>⚡ Cari Pengganti Cepat</span>
			</button>
		</div>
	{/if}

	<!-- Action Bar & Worker List -->
	<div class="p-4 rounded-2xl border bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800 shadow-xs space-y-4">
		<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-3 border-b border-gray-100 dark:border-slate-800">
			<div>
				<h3 class="text-sm font-bold text-gray-900 dark:text-white">Daftar Tenaga Kerja SPK Aktif</h3>
				<p class="text-[11px] text-gray-500 dark:text-gray-400">Pilih status kehadiran setiap pekerja pada briefing pagi.</p>
			</div>
			<div class="flex items-center gap-2 flex-wrap">
				<button
					type="button"
					onclick={() => openReplacementModal()}
					class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white shadow-2xs transition-all active:scale-95"
				>
					<IconBolt size={14} />
					<span>⚡ Cari Pengganti Cepat</span>
				</button>
				<button
					type="button"
					onclick={hadirkanSemua}
					disabled={loading || workers.length === 0}
					class="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs transition-all active:scale-95 disabled:opacity-50"
				>
					<IconBolt size={14} />
					<span>⚡ Hadirkan Semua (1-Klik)</span>
				</button>
			</div>
		</div>

		{#if loading}
			<div class="py-12 flex flex-col items-center justify-center">
				<CircularProgressGauge size={44} strokeWidth={4} label="Memuat data SPK aktif..." />
			</div>
		{:else if workers.length === 0}
			<div class="py-12 text-center rounded-xl border border-dashed border-gray-200 dark:border-slate-800">
				<p class="text-sm font-semibold text-gray-500 dark:text-gray-400">Tidak ada penugasan SPK aktif di proyek ini.</p>
				<p class="text-xs text-gray-400 mt-1">Pastikan manpower telah ditugaskan dan SPK berstatus aktif di tab Manpower.</p>
			</div>
		{:else}
			<div class="space-y-3">
				{#each workers as w, idx (w.assignment_id)}
					{@const bStyle = getBadgeStyle(w.status_komitmen, w.reliability_score)}
					<div class="p-3.5 rounded-xl border transition-all {w.status === 'alpha' ? 'bg-rose-50/60 dark:bg-rose-950/20 border-rose-300 dark:border-rose-900/50' : 'bg-slate-50/50 dark:bg-slate-800/30 border-gray-200 dark:border-slate-800'}">
						<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
							<!-- Worker Identity -->
							<div class="min-w-0">
								<div class="flex items-center gap-2 flex-wrap">
									<p class="text-[13px] font-bold text-gray-900 dark:text-white truncate">{w.nama}</p>
									<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold {bStyle.bg}">
										{bStyle.label}
									</span>
								</div>
								<div class="flex items-center gap-2 mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
									<span>{w.posisi}</span>
									<span>·</span>
									<span>NIK: {w.nik}</span>
									{#if w.total_mangkir_count > 0}
										<span>·</span>
										<span class="text-amber-600 dark:text-amber-400 font-medium">Pernah mangkir {w.total_mangkir_count}x</span>
									{/if}
								</div>
							</div>

							<!-- Attendance Status Toggle Buttons -->
							<div class="flex items-center gap-1 shrink-0 flex-wrap">
								<button
									type="button"
									onclick={() => setWorkerStatus(idx, 'hadir')}
									class="px-2.5 py-1 rounded-lg text-xs font-bold transition-all {w.status === 'hadir' ? 'bg-emerald-600 text-white shadow-2xs' : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}"
								>
									Hadir
								</button>
								<button
									type="button"
									onclick={() => setWorkerStatus(idx, 'izin')}
									class="px-2.5 py-1 rounded-lg text-xs font-bold transition-all {w.status === 'izin' ? 'bg-amber-600 text-white shadow-2xs' : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}"
								>
									Izin
								</button>
								<button
									type="button"
									onclick={() => setWorkerStatus(idx, 'sakit')}
									class="px-2.5 py-1 rounded-lg text-xs font-bold transition-all {w.status === 'sakit' ? 'bg-blue-600 text-white shadow-2xs' : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}"
								>
									Sakit
								</button>
								<button
									type="button"
									onclick={() => setWorkerStatus(idx, 'alpha')}
									class="px-2.5 py-1 rounded-lg text-xs font-bold transition-all {w.status === 'alpha' ? 'bg-rose-600 text-white shadow-2xs' : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}"
								>
									Alpha
								</button>
								<button
									type="button"
									onclick={() => setWorkerStatus(idx, 'standby')}
									class="px-2.5 py-1 rounded-lg text-xs font-bold transition-all {w.status === 'standby' ? 'bg-slate-600 text-white shadow-2xs' : 'bg-gray-100 dark:bg-slate-800 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}"
								>
									Standby
								</button>
							</div>
						</div>

						<!-- Input Catatan & Tombol Pengganti Jika Alpha -->
						{#if w.status !== 'hadir'}
							<div class="mt-2.5 pt-2 border-t border-gray-200/60 dark:border-slate-800/60 flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
								<input
									type="text"
									bind:value={w.notes}
									placeholder={w.status === 'alpha' ? 'Alasan mangkir / tidak ada kabar (akan masuk audit)...' : 'Keterangan izin/sakit/kendala...'}
									class="flex-1 px-2.5 py-1.5 border border-gray-300 dark:border-slate-700 rounded-lg text-xs bg-white dark:bg-slate-900 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-amber-500"
								/>
								{#if w.status === 'alpha'}
									<button
										type="button"
										onclick={() => openReplacementModal(w.posisi)}
										class="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white shrink-0 shadow-2xs flex items-center gap-1 justify-center"
									>
										<IconBolt size={12} />
										<span>Cari Pengganti {w.posisi}</span>
									</button>
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>

			<!-- Submit Button -->
			<div class="pt-4 border-t border-gray-100 dark:border-slate-800 flex justify-end">
				<button
					type="button"
					onclick={handleSubmit}
					disabled={saving || loading}
					class="w-full sm:w-auto px-6 py-2.5 rounded-xl text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
				>
					{#if saving}
						<IconLoader2 size={16} class="animate-spin" />
						<span>Menyimpan Presensi...</span>
					{:else}
						<IconShieldCheck size={16} />
						<span>Simpan TBM Roll-Call ({hadirCount}/{totalRencana} Hadir)</span>
					{/if}
				</button>
			</div>
		{/if}
	</div>

	<SmartReplacementModal
		isOpen={showSmartModal}
		projectId={selectedProjectId}
		projectName={selectedProject?.name || ''}
		targetPosisi={targetReplacePosisi}
		targetMandorId={targetReplaceMandorId}
		onClose={() => (showSmartModal = false)}
		onAssigned={() => {
			showSmartModal = false;
			loadWorkersForProject();
		}}
	/>
</div>