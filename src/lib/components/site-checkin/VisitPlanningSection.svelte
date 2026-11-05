<!-- src/lib/components/site-checkin/VisitPlanningSection.svelte -->
<!-- Modul Perencanaan Site Visit Karyawan (Fase 3 Penajaman Absensi).
     Menyajikan jadwal kunjungan harian terencana, pemenuhan Gate G_ESS_VISIT_PLAN_VS_ACTUAL &
     G_ESS_CLOCKOUT_COMPLETE, serta integrasi check-in instan dari jadwal. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { slide, fade } from 'svelte/transition';
	import {
		IconCalendarTime,
		IconPlus,
		IconMapPin,
		IconClock,
		IconCheck,
		IconX,
		IconAlertTriangle,
		IconShieldCheck,
		IconFileText,
		IconArrowRight,
		IconLoader2,
		IconInfoCircle
	} from '@tabler/icons-svelte';
	import {
		getVisitPlans,
		createVisitPlan,
		updateVisitPlanStatus,
		type SiteVisitPlanRecord
	} from '$lib/services/siteCheckin';

	let {
		onSelectPlanForCheckin
	}: {
		onSelectPlanForCheckin?: (plan: SiteVisitPlanRecord) => void;
	} = $props();

	let plans = $state<SiteVisitPlanRecord[]>([]);
	let loading = $state(true);
	let errorMessage = $state<string | null>(null);

	// Modal Tambah Jadwal
	let showAddModal = $state(false);
	let savingAdd = $state(false);
	let newNamaLokasi = $state('');
	let newStartTime = $state('09:00');
	let newEndTime = $state('11:30');
	let newAgenda = $state('');
	let newTipeCheckin = $state<'proyek' | 'marketing' | 'lainnya'>('marketing');

	// Modal Batal / Deviasi
	let showDeviateModal = $state(false);
	let savingDeviate = $state(false);
	let targetDeviatePlan = $state<SiteVisitPlanRecord | null>(null);
	let deviateReasonOption = $state('Dibatalkan oleh Klien/Site');
	let deviateReasonDetail = $state('');

	async function loadPlans() {
		loading = true;
		errorMessage = null;
		try {
			const res = await getVisitPlans();
			plans = res.plans || [];
		} catch (err: any) {
			console.error('Gagal memuat rencana kunjungan:', err);
			errorMessage = err?.message || 'Gagal memuat rencana kunjungan.';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		loadPlans();
	});

	async function handleSaveNewPlan() {
		if (!newNamaLokasi.trim()) {
			alert('Nama lokasi/client kunjungan wajib diisi.');
			return;
		}
		if (!newStartTime || !newEndTime) {
			alert('Jam mulai dan jam selesai rencana wajib diisi.');
			return;
		}
		if (newStartTime >= newEndTime) {
			alert('Jam selesai harus lebih besar dari jam mulai.');
			return;
		}
		if (!newAgenda.trim()) {
			alert('Agenda kunjungan wajib diisi.');
			return;
		}

		savingAdd = true;
		try {
			await createVisitPlan({
				nama_lokasi: newNamaLokasi.trim(),
				planned_start_time: newStartTime,
				planned_end_time: newEndTime,
				planned_agenda: newAgenda.trim(),
				tipe_checkin: newTipeCheckin
			});
			showAddModal = false;
			newNamaLokasi = '';
			newAgenda = '';
			await loadPlans();
		} catch (err: any) {
			alert(err?.message || 'Gagal menyimpan rencana kunjungan.');
		} finally {
			savingAdd = false;
		}
	}

	function openDeviateDialog(plan: SiteVisitPlanRecord) {
		targetDeviatePlan = plan;
		deviateReasonOption = 'Dibatalkan oleh Klien/Site';
		deviateReasonDetail = '';
		showDeviateModal = true;
	}

	async function handleSaveDeviate() {
		if (!targetDeviatePlan) return;
		const fullReason = `${deviateReasonOption}: ${deviateReasonDetail}`.trim();
		if (!deviateReasonDetail.trim() && deviateReasonOption === 'Lainnya') {
			alert('Mohon cantumkan rincian alasan pembatalan/penundaan.');
			return;
		}

		savingDeviate = true;
		try {
			await updateVisitPlanStatus(targetDeviatePlan.id, 'cancel', fullReason);
			showDeviateModal = false;
			targetDeviatePlan = null;
			await loadPlans();
		} catch (err: any) {
			alert(err?.message || 'Gagal mengupdate status rencana kunjungan.');
		} finally {
			savingDeviate = false;
		}
	}

	// Status badge helper
	function getPlanBadge(status: string) {
		switch (status) {
			case 'checked_in':
				return { label: '🟢 Sedang Dikunjungi', class: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800' };
			case 'completed':
				return { label: '✓ Kunjungan Selesai', class: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800' };
			case 'cancelled':
				return { label: '✕ Dibatalkan', class: 'bg-slate-100 text-slate-600 border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700' };
			case 'missed':
				return { label: '⚠ Terlewat', class: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800' };
			default:
				return { label: '⏳ Terjadwal', class: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800' };
		}
	}
</script>

<div class="rounded-3xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/90 shadow-xs p-5 flex flex-col gap-4">
	<!-- Header -->
	<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
		<div>
			<div class="flex items-center gap-2">
				<div class="p-1.5 rounded-xl bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">
					<IconCalendarTime size={18} />
				</div>
				<h2 class="text-sm sm:text-base font-black text-slate-900 dark:text-slate-100">
					Rencana Kunjungan Lapangan Hari Ini
				</h2>
			</div>
			<p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
				Karyawan non-mobile/sales wajib menjadwalkan jam kunjungan sebelum menuju lokasi klien/proyek.
			</p>
		</div>

		<button
			type="button"
			onclick={() => (showAddModal = true)}
			class="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-[0.98] rounded-xl shadow-xs transition-all shrink-0"
		>
			<IconPlus size={15} />
			<span>Tambah Rencana Visit</span>
		</button>
	</div>

	<!-- Gate Notice Banner -->
	<div class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 flex items-start gap-2.5 text-xs text-slate-600 dark:text-slate-300">
		<IconShieldCheck size={16} class="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
		<div class="leading-relaxed">
			<span class="font-bold text-slate-800 dark:text-slate-200">Kepatuhan Absen Pulang (Gate System):</span>
			Semua kunjungan terencana wajib berstatus selesai atau disertai alasan deviasi resmi agar Anda dapat melakukan Absen Pulang sore nanti.
		</div>
	</div>

	<!-- Content Area -->
	{#if loading}
		<div class="py-8 flex flex-col items-center justify-center text-xs text-slate-400 gap-2">
			<IconLoader2 size={24} class="animate-spin text-blue-600" />
			<span>Memuat jadwal kunjungan...</span>
		</div>
	{:else if errorMessage}
		<div class="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-300 border border-rose-200 text-xs flex items-center justify-between">
			<span>{errorMessage}</span>
			<button type="button" onclick={loadPlans} class="font-bold underline text-xs">Coba Lagi</button>
		</div>
	{:else if plans.length === 0}
		<div class="py-7 px-4 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center text-center gap-2">
			<div class="p-2.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400">
				<IconCalendarTime size={22} />
			</div>
			<div class="max-w-md">
				<p class="text-xs font-bold text-slate-700 dark:text-slate-300">Belum Ada Rencana Kunjungan Hari Ini</p>
				<p class="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
					Jika Anda memiliki agenda kunjungan luar (contoh: sales ke PT ISTW, inspeksi proyek, atau meeting client), klik tombol di atas untuk mendaftarkan jadwal.
				</p>
			</div>
		</div>
	{:else}
		<div class="flex flex-col gap-2.5">
			{#each plans as plan (plan.id)}
				{@const badge = getPlanBadge(plan.plan_status)}
				<div class="p-4 rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850 flex flex-col gap-3 transition-all hover:border-slate-300 dark:hover:border-slate-700">
					<div class="flex items-start justify-between gap-3">
						<div class="flex flex-col gap-1 min-w-0">
							<div class="flex items-center gap-2 flex-wrap">
								<span class="text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200">
									⏰ {plan.planned_start_time} - {plan.planned_end_time} WIB
								</span>
								<span class="text-[10px] font-bold px-2 py-0.5 rounded-md border {badge.class}">
									{badge.label}
								</span>
								{#if plan.tipe_checkin}
									<span class="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">
										• {plan.tipe_checkin}
									</span>
								{/if}
							</div>
							<h3 class="text-sm font-black text-slate-900 dark:text-slate-100 truncate mt-1">
								{plan.nama_lokasi}
							</h3>
							<p class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed mt-0.5">
								{plan.planned_agenda}
							</p>
							{#if plan.alasan_deviasi}
								<div class="mt-1 p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-200 text-[11px] flex items-start gap-1.5">
									<IconInfoCircle size={13} class="shrink-0 mt-0.5" />
									<span><strong>Catatan Deviasi:</strong> {plan.alasan_deviasi}</span>
								</div>
							{/if}
						</div>
					</div>

					<!-- Action buttons for planned items -->
					{#if plan.plan_status === 'planned'}
						<div class="pt-2 border-t border-slate-200/70 dark:border-slate-800/80 flex items-center justify-end gap-2">
							<button
								type="button"
								onclick={() => openDeviateDialog(plan)}
								class="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
							>
								Batal / Halangan
							</button>
							{#if onSelectPlanForCheckin}
								<button
									type="button"
									onclick={() => onSelectPlanForCheckin(plan)}
									class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-2xs active:scale-[0.98] transition-all"
								>
									<span>Check-in Sekarang</span>
									<IconArrowRight size={13} />
								</button>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Modal Tambah Rencana Kunjungan -->
{#if showAddModal}
	<div
		class="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
		transition:fade={{ duration: 150 }}
	>
		<div
			class="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-lg p-5 sm:p-6 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
			transition:slide={{ duration: 180 }}
		>
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<div class="p-2 rounded-xl bg-blue-50 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400">
						<IconCalendarTime size={20} />
					</div>
					<div>
						<h3 class="text-sm sm:text-base font-black text-slate-900 dark:text-slate-100">
							Rencanakan Kunjungan (Site Visit)
						</h3>
						<p class="text-[11px] text-slate-500">Tentukan lokasi, jadwal jam, dan agenda kunjungan hari ini</p>
					</div>
				</div>
				<button
					type="button"
					onclick={() => (showAddModal = false)}
					class="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
				>
					<IconX size={18} />
				</button>
			</div>

			<div class="flex flex-col gap-3.5 text-xs">
				<div>
					<label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">
						Tipe Keperluan
					</label>
					<div class="grid grid-cols-3 gap-2">
						{#each [
							{ id: 'marketing', label: 'Sales / Client' },
							{ id: 'proyek', label: 'Proyek Lapangan' },
							{ id: 'lainnya', label: 'Lainnya / Dinas' }
						] as opt}
							<button
								type="button"
								onclick={() => (newTipeCheckin = opt.id as any)}
								class="py-2 px-2.5 rounded-xl border font-bold text-xs transition-all {newTipeCheckin === opt.id ? 'bg-blue-600 text-white border-blue-600 shadow-2xs' : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}"
							>
								{opt.label}
							</button>
						{/each}
					</div>
				</div>

				<div>
					<label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">
						Nama Lokasi / Client / Proyek Tujuan <span class="text-rose-500">*</span>
					</label>
					<input
						type="text"
						bind:value={newNamaLokasi}
						placeholder="Contoh: PT ISTW (Pabrik Cikarang) / Proyek Dermaga"
						class="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-850 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-xs"
					/>
				</div>

				<div class="grid grid-cols-2 gap-3">
					<div>
						<label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">
							Jam Mulai Rencana <span class="text-rose-500">*</span>
						</label>
						<input
							type="time"
							bind:value={newStartTime}
							class="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-850 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-xs font-mono"
						/>
					</div>
					<div>
						<label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">
							Jam Selesai Rencana <span class="text-rose-500">*</span>
						</label>
						<input
							type="time"
							bind:value={newEndTime}
							class="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-850 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-xs font-mono"
						/>
					</div>
				</div>

				<div>
					<label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">
						Agenda Detail Kunjungan <span class="text-rose-500">*</span>
					</label>
					<textarea
						bind:value={newAgenda}
						rows={3}
						placeholder="Tuliskan tujuan kunjungan, person in charge yang ditemui, dan target hasil kunjungan..."
						class="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-850 text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-xs resize-none"
					></textarea>
				</div>
			</div>

			<div class="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
				<button
					type="button"
					onclick={() => (showAddModal = false)}
					disabled={savingAdd}
					class="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
				>
					Batal
				</button>
				<button
					type="button"
					onclick={handleSaveNewPlan}
					disabled={savingAdd}
					class="px-4 py-2 rounded-xl text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 transition-all flex items-center gap-1.5 shadow-2xs"
				>
					{#if savingAdd}
						<IconLoader2 size={14} class="animate-spin" />
						<span>Menyimpan...</span>
					{:else}
						<IconCheck size={14} />
						<span>Simpan Rencana</span>
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal Batal / Deviasi Rencana -->
{#if showDeviateModal && targetDeviatePlan}
	<div
		class="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
		transition:fade={{ duration: 150 }}
	>
		<div
			class="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl w-full max-w-md p-5 flex flex-col gap-4"
			transition:slide={{ duration: 180 }}
		>
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<div class="p-2 rounded-xl bg-amber-50 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400">
						<IconAlertTriangle size={18} />
					</div>
					<div>
						<h3 class="text-sm font-black text-slate-900 dark:text-slate-100">
							Batal / Halangan Kunjungan
						</h3>
						<p class="text-[11px] text-slate-500">Berikan keterangan resmi untuk audit dan absen pulang</p>
					</div>
				</div>
				<button
					type="button"
					onclick={() => (showDeviateModal = false)}
					class="p-1 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
				>
					<IconX size={18} />
				</button>
			</div>

			<div class="p-3 rounded-xl bg-slate-50 dark:bg-slate-800 text-xs flex flex-col gap-0.5">
				<span class="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Lokasi Rencana</span>
				<span class="font-bold text-slate-800 dark:text-slate-200">{targetDeviatePlan.nama_lokasi}</span>
				<span class="text-[11px] text-slate-500">Pukul {targetDeviatePlan.planned_start_time} - {targetDeviatePlan.planned_end_time} WIB</span>
			</div>

			<div class="flex flex-col gap-3 text-xs">
				<div>
					<label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">
						Kategori Alasan
					</label>
					<select
						bind:value={deviateReasonOption}
						class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-850 text-slate-800 dark:text-slate-200 text-xs"
					>
						<option value="Dibatalkan oleh Klien/Site">Dibatalkan oleh Klien/Site</option>
						<option value="Jadwal Reschedule Mundur Hari">Jadwal Reschedule Mundur Hari</option>
						<option value="Tugas Urgent Lain dari Manajer">Tugas Urgent Lain dari Manajer</option>
						<option value="Kendala Cuaca / Akses Jalan">Kendala Cuaca / Akses Jalan</option>
						<option value="Lainnya">Lainnya (Tulis detail)</option>
					</select>
				</div>

				<div>
					<label class="block font-bold text-slate-700 dark:text-slate-300 mb-1">
						Keterangan / Rincian Alasan <span class="text-rose-500">*</span>
					</label>
					<textarea
						bind:value={deviateReasonDetail}
						rows={3}
						placeholder="Jelaskan alasan mengapa kunjungan ini tidak terealisasi..."
						class="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-850 text-slate-800 dark:text-slate-200 text-xs resize-none"
					></textarea>
				</div>
			</div>

			<div class="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
				<button
					type="button"
					onclick={() => (showDeviateModal = false)}
					disabled={savingDeviate}
					class="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300"
				>
					Batal
				</button>
				<button
					type="button"
					onclick={handleSaveDeviate}
					disabled={savingDeviate}
					class="px-4 py-2 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 flex items-center gap-1.5 shadow-2xs"
				>
					{#if savingDeviate}
						<IconLoader2 size={14} class="animate-spin" />
						<span>Menyimpan...</span>
					{:else}
						<IconCheck size={14} />
						<span>Konfirmasi Alasan</span>
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
