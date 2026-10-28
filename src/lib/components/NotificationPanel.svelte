<script lang="ts">
	import { IconX, IconReceipt2, IconClipboardList, IconAlertTriangle, IconBell, IconCalendar, IconBriefcase } from '@tabler/icons-svelte';
	import { goto } from '$app/navigation';

	let {
		open = $bindable(false),
		pendingAnggaran = [],
		belumLaporProjects = [],
		deadlineProjects = [],
		upcomingDeadlines = [],
		salesNotifications = []
	}: {
		open: boolean;
		pendingAnggaran: any[];
		belumLaporProjects: any[];
		deadlineProjects: any[];
		upcomingDeadlines: any[];
		salesNotifications?: any[];
	} = $props();

	let totalCount = $derived(pendingAnggaran.length + belumLaporProjects.length + deadlineProjects.length + upcomingDeadlines.length + salesNotifications.length);

	function fmt(dateStr: string) {
		if (!dateStr) return '-';
		return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(dateStr));
	}

	function navigate(path: string) {
		open = false;
		goto(path);
	}
</script>

{#if open}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-40"
		role="button"
		tabindex="-1"
		aria-label="Tutup notifikasi"
		onclick={() => (open = false)}
		onkeydown={(e) => e.key === 'Escape' && (open = false)}
	></div>

	<!-- Panel -->
	<div
		class="fixed z-50 rounded-2xl shadow-2xl overflow-hidden flex flex-col"
		style="
			top: 68px;
			right: 16px;
			width: min(340px, calc(100vw - 32px));
			max-height: min(520px, calc(100vh - 90px));
			background: var(--sys-bg2);
			border: 1px solid var(--sys-sep);
		"
	>
		<!-- Header -->
		<div class="flex items-center justify-between px-4 py-3 shrink-0" style="border-bottom: 1px solid var(--sys-sep)">
			<div class="flex items-center gap-2">
				<IconBell size={15} style="color: var(--sys-label)" />
				<p class="text-[13px] font-semibold" style="color: var(--sys-label)">Notifikasi</p>
				{#if totalCount > 0}
					<span class="badge rej" style="font-size: 10px; padding: 1px 6px; border-radius: 99px">{totalCount}</span>
				{/if}
			</div>
			<button
				class="p-1.5 rounded-lg transition-colors hover:bg-[var(--sys-fill)]"
				onclick={() => (open = false)}
				style="color: var(--sys-label3)"
			>
				<IconX size={15} />
			</button>
		</div>

		<!-- Content -->
		<div class="flex-1 overflow-y-auto">
			{#if totalCount === 0}
				<div class="px-4 py-10 text-center">
					<div class="w-10 h-10 rounded-full mx-auto mb-3 flex items-center justify-center" style="background: var(--sys-fill)">
						<IconBell size={18} style="color: var(--sys-label3)" />
					</div>
					<p class="text-[13px] font-medium" style="color: var(--sys-label)">Semua sudah beres</p>
					<p class="text-[11px] mt-1" style="color: var(--sys-label3)">Tidak ada notifikasi baru</p>
				</div>
			{:else}
				<!-- Notifikasi Sales (Fase 1 — Maksimalisasi Notifikasi Sales) -->
				{#if salesNotifications.length > 0}
					<div class="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide sticky top-0" style="color: var(--sys-label3); background: var(--sys-fill)">
						Notifikasi Sales · {salesNotifications.length}
					</div>
					{#each salesNotifications as notif}
						<div class="w-full flex items-start gap-3 px-4 py-3 text-left" style="border-bottom: 1px solid var(--sys-sep)">
							<div class="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5" style="background: var(--pl)">
								<IconBriefcase size={15} style="color: var(--p)" />
							</div>
							<div class="flex-1 min-w-0">
								<p class="text-[12px] font-medium truncate" style="color: var(--sys-label)">{notif.title || 'Notifikasi Sales'}</p>
								<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">{notif.message}</p>
							</div>
						</div>
					{/each}
				{/if}

				<!-- Anggaran Pending -->
				{#if pendingAnggaran.length > 0}
					<div class="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide sticky top-0" style="color: var(--sys-label3); background: var(--sys-fill)">
						Anggaran Menunggu · {pendingAnggaran.length}
					</div>
					{#each pendingAnggaran as item}
						<button
							class="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--sys-fill)] active:bg-[var(--sys-fill2)]"
							style="border-bottom: 1px solid var(--sys-sep)"
							onclick={() => navigate('/anggaran')}
						>
							<div class="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5" style="background: var(--pl)">
								<IconReceipt2 size={15} style="color: var(--p)" />
							</div>
							<div class="flex-1 min-w-0">
								<p class="text-[12px] font-medium truncate" style="color: var(--sys-label)">{item.tujuan_pengajuan || 'Pengajuan Anggaran'}</p>
								<p class="text-[11px] mt-0.5 truncate" style="color: var(--sys-label3)">{item.nomor_pengajuan || ''}{item.nama_pengaju ? ' · ' + item.nama_pengaju : ''}</p>
							</div>
							<span class="badge pend shrink-0 mt-0.5" style="font-size: 10px; padding: 2px 6px">Pending</span>
						</button>
					{/each}
				{/if}

				<!-- Belum Lapor -->
				{#if belumLaporProjects.length > 0}
					<div class="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide sticky top-0" style="color: var(--sys-label3); background: var(--sys-fill)">
						Belum Lapor Hari Ini · {belumLaporProjects.length}
					</div>
					{#each belumLaporProjects as project}
						<button
							class="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--sys-fill)] active:bg-[var(--sys-fill2)]"
							style="border-bottom: 1px solid var(--sys-sep)"
							onclick={() => navigate(`/proyek/${project.id}`)}
						>
							<div class="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5" style="background: var(--rel)">
								<IconClipboardList size={15} style="color: var(--re)" />
							</div>
							<div class="flex-1 min-w-0">
								<p class="text-[12px] font-medium truncate" style="color: var(--sys-label)">{project.name}</p>
								<p class="text-[11px] mt-0.5 truncate" style="color: var(--sys-label3)">{project.lokasi || '-'}</p>
							</div>
						</button>
					{/each}
				{/if}

				<!-- Deadline Mendekat (≤7 hari) -->
				{#if upcomingDeadlines.length > 0}
					<div class="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide sticky top-0" style="color: var(--sys-label3); background: var(--sys-fill)">
						Deadline Mendekat · {upcomingDeadlines.length}
					</div>
					{#each upcomingDeadlines as project}
						<button
							class="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--sys-fill)] active:bg-[var(--sys-fill2)]"
							style="border-bottom: 1px solid var(--sys-sep)"
							onclick={() => navigate(`/proyek/${project.id}`)}
						>
							<div class="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5" style="background: var(--aml)">
								<IconCalendar size={15} style="color: #D97706" />
							</div>
							<div class="flex-1 min-w-0">
								<p class="text-[12px] font-medium truncate" style="color: var(--sys-label)">{project.name}</p>
								<p class="text-[11px] mt-0.5" style="color: #D97706">
									{project.daysLeft === 0 ? 'Deadline hari ini!' : `${project.daysLeft} hari lagi · ${fmt(project.end_date)}`}
								</p>
							</div>
						</button>
					{/each}
				{/if}

				<!-- Deadline Terlewat -->
				{#if deadlineProjects.length > 0}
					<div class="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wide sticky top-0" style="color: var(--sys-label3); background: var(--sys-fill)">
						Deadline Terlewat · {deadlineProjects.length}
					</div>
					{#each deadlineProjects as project}
						<button
							class="w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--sys-fill)] active:bg-[var(--sys-fill2)]"
							style="border-bottom: 1px solid var(--sys-sep)"
							onclick={() => navigate(`/proyek/${project.id}`)}
						>
							<div class="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5" style="background: var(--aml)">
								<IconAlertTriangle size={15} style="color: #D97706" />
							</div>
							<div class="flex-1 min-w-0">
								<p class="text-[12px] font-medium truncate" style="color: var(--sys-label)">{project.name}</p>
								<p class="text-[11px] mt-0.5" style="color: #D97706">Deadline: {fmt(project.end_date)}</p>
							</div>
						</button>
					{/each}
				{/if}
			{/if}
		</div>
	</div>
{/if}
