<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Project Leader view (Rekomendasi #5 dokumen implementation_plan_pelatihan & jabatan.md):
	// progress silabus jabatan anggota tim langsung (karyawan.atasan_id == diri sendiri).
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getTimSilabus, type TeamMemberSilabusProgress } from '$lib/services/ess/silabus';
	import { IconAlertTriangle, IconChevronLeft, IconChevronDown, IconCircleCheck, IconCircleDashed, IconLoader2, IconLock, IconProgressCheck, IconUsersGroup } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let anggota = $state<TeamMemberSilabusProgress[]>([]);
	let expandedKaryawanId = $state<number | null>(null);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const res = await getTimSilabus();
			anggota = res.anggota;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat progress tim.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	function toggleExpand(karyawanId: number) {
		expandedKaryawanId = expandedKaryawanId === karyawanId ? null : karyawanId;
	}

	function overallPersen(m: TeamMemberSilabusProgress): number {
		return m.totalWajibKeseluruhan > 0 ? Math.round((m.selesaiKeseluruhan / m.totalWajibKeseluruhan) * 100) : 0;
	}
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<button
		class="flex items-center gap-1 text-xs font-bold mb-4"
		style="color: var(--sys-label3)"
		onclick={() => goto('/ess/pelatihan')}
	>
		<IconChevronLeft size={16} /> Kembali ke Pelatihan
	</button>

	<div class="mb-6 flex items-center gap-3">
		<IconUsersGroup size={28} style="color: var(--p, var(--g))" />
		<div>
			<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Progress Tim</h1>
			<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">Silabus training anggota tim yang berada langsung di bawah Anda</p>
		</div>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat progress pelatihan tim..." />
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
	{:else if anggota.length === 0}
		<div class="glass-panel rounded-2xl p-10 text-center">
			<IconUsersGroup size={32} class="mx-auto mb-3" style="color: var(--sys-label4)" />
			<p class="text-sm font-medium" style="color: var(--sys-label3)">Belum ada anggota tim yang tertaut ke Anda sebagai atasan langsung.</p>
			<p class="text-xs mt-1" style="color: var(--sys-label4)">Hubungi HRD bila seharusnya ada anggota tim di bawah Anda.</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each anggota as m (m.karyawanId)}
				<div class="glass-panel rounded-2xl overflow-hidden">
					<button
						class="w-full flex items-center justify-between gap-3 p-4 text-left"
						onclick={() => toggleExpand(m.karyawanId)}
					>
						<div class="flex items-center gap-3 min-w-0">
							<IconChevronDown size={16} class="shrink-0 transition-transform {expandedKaryawanId === m.karyawanId ? 'rotate-180' : ''}" style="color: var(--sys-label4)" />
							<div class="min-w-0">
								<h3 class="text-sm font-bold truncate" style="color: var(--sys-label)">{m.namaKaryawan}</h3>
								<p class="text-xs truncate" style="color: var(--sys-label4)">{m.position?.nama_posisi || 'Jabatan belum terdata'}</p>
							</div>
						</div>
						<div class="flex items-center gap-2 shrink-0">
							{#if m.totalWajibKeseluruhan === 0}
								<span class="text-xs font-medium" style="color: var(--sys-label4)">Tanpa silabus wajib</span>
							{:else}
								<div class="w-20 h-2 rounded-full bg-white/40 overflow-hidden">
									<div class="h-full rounded-full gradient-bg" style="width: {overallPersen(m)}%"></div>
								</div>
								<span class="text-xs font-bold" style="color: var(--sys-label3)">{m.selesaiKeseluruhan}/{m.totalWajibKeseluruhan}</span>
							{/if}
						</div>
					</button>

					{#if expandedKaryawanId === m.karyawanId}
						<div class="px-4 pb-4 space-y-3 border-t" style="border-color: var(--sys-sep, rgba(0,0,0,0.06))">
							{#if m.silabusList.length === 0}
								<p class="text-xs pt-3" style="color: var(--sys-label4)">Belum ada silabus aktif untuk jabatan ini.</p>
							{:else}
								{#each m.silabusList as s (s.id)}
									<div class="pt-3">
										<div class="flex items-center justify-between mb-1.5">
											<span class="text-xs font-bold" style="color: var(--sys-label2)">{s.namaSilabus}</span>
											<span class="text-[11px] font-semibold" style="color: var(--sys-label4)">{s.wajibSelesai}/{s.totalWajib}</span>
										</div>
										<div class="flex flex-col gap-1">
											{#each s.materi as mat (mat.id)}
												<div class="flex items-center gap-2 text-xs" style="color: var(--sys-label3)">
													{#if mat.locked}
														<IconLock size={13} style="color: var(--sys-label4)" class="shrink-0" />
													{:else if mat.status === 'Lulus'}
														<IconCircleCheck size={13} style="color: var(--g)" class="shrink-0" />
													{:else if mat.status === 'Ongoing' || mat.status === 'Enrolled'}
														<IconProgressCheck size={13} style="color: var(--p, var(--g))" class="shrink-0" />
													{:else}
														<IconCircleDashed size={13} style="color: var(--sys-label4)" class="shrink-0" />
													{/if}
													<span class="truncate">{mat.programJudul}</span>
												</div>
											{/each}
										</div>
									</div>
								{/each}
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
