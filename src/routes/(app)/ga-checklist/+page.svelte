<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
		import { fetchTodaySchedule, fetchTemplateWithItems, type ScheduleItem } from '$lib/services/gaChecklist';
	import { IconShieldLock, IconLoader2, IconChevronRight, IconCircleCheck } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let items = $state<ScheduleItem[]>([]);

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'access_ga_checklist', roles)) {
			goto('/');
		}
	});

	onMount(async () => {
		try {
			const res = await fetchTodaySchedule();
			items = res.items;
			// Background pre-fetch checklist templates for all schedule items
			if (items && items.length > 0) {
				for (const item of items) {
					if (item.template_id) {
						fetchTemplateWithItems(Number(item.template_id)).catch((err) => {
							console.warn(`[Pre-fetch] Gagal pre-fetch template ${item.template_id}:`, err);
						});
					}
				}
			}
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal memuat ruangan tanggung jawab.';
		}
		loading = false;
	});

	function statusBadge(item: ScheduleItem) {
		if (item.existing_response?.status === 'verified') return { label: 'Terverifikasi', bg: 'var(--gg)', color: 'var(--ggd)' };
		if (item.existing_response?.status === 'submitted') return { label: 'Menunggu Verifikasi', bg: '#FEF9C3', color: '#A16207' };
		if (item.existing_response?.status === 'rejected') return { label: 'Ditolak — Isi Ulang', bg: 'var(--rel)', color: 'var(--red)' };
		return { label: 'Belum Diisi', bg: 'var(--sys-fill)', color: 'var(--sys-label3)' };
	}

	// R5 (Kontrol Patroli, rekomendasi): progress ring skor kebersihan per area —
	// motivasi & awareness cepat status area, hijau/kuning/merah.
	function ringColor(score: number | null | undefined): string {
		if (score == null) return '#CBD5E1'; // abu — belum ada skor
		if (score >= 90) return 'var(--ggd, #16A34A)';
		if (score >= 70) return '#D97706';
		return 'var(--red, #DC2626)';
	}
	const RING_R = 16;
	const RING_CIRC = 2 * Math.PI * RING_R;
	function ringDashoffset(score: number | null | undefined): number {
		const pct = score == null ? 0 : Math.max(0, Math.min(100, score));
		return RING_CIRC * (1 - pct / 100);
	}
</script>

<div class="scroll-body">
	<div class="max-w-2xl mx-auto p-4 pb-24">
		<div class="flex items-center justify-between mb-4">
			<div>
				<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Ruangan Anda</h1>
				<p class="text-[11px]" style="color: var(--sys-label3)">Checklist ruangan tanggung jawab Anda hari ini</p>
			</div>
			<div class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--gl)">
				<IconShieldLock size={18} style="color: var(--g)" />
			</div>
		</div>

		{#if loading}
			<CircularProgressGauge size={48} strokeWidth={4} label="Memuat checklist GA..." />
		{:else if errorMsg}
			<div class="rounded-lg p-4 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>
		{:else if items.length === 0}
			<div class="rounded-lg p-6 text-[12px] text-center" style="background: var(--sys-fill); color: var(--sys-label3)">
				Tidak ada checklist yang ditugaskan untuk Anda hari ini.
			</div>
		{:else}
			<div class="flex flex-col gap-2">
				{#each items as item}
					{@const badge = statusBadge(item)}
					{@const done = item.existing_response?.status === 'verified' || item.existing_response?.status === 'submitted'}
					<button
						class="w-full text-left rounded-xl p-4 flex items-center justify-between"
						style="background: var(--sys-fill); border: 1px solid var(--sys-sep)"
						onclick={() => goto(`/ga-checklist/${item.id}?area_id=${item.area_id}&template_id=${item.template_id}`)}
					>
						<div class="flex-1">
							<p class="text-[13px] font-semibold" style="color: var(--sys-label)">{item.area?.area_name || `Area #${item.area_id}`}</p>
							<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">{item.checklist_type === 'deep_check' ? 'Deep Check' : 'Rutin'}</p>
							{#if item.stats_30d}
								<!-- R4 (rencana v2 Fase 6): riwayat skor Anda sendiri 30 hari -- sebelumnya
								     petugas tidak pernah lihat skornya sendiri sama sekali. -->
								<p class="text-[11px] mt-1" style="color: {item.stats_30d.avg < 70 ? 'var(--red)' : 'var(--sys-label3)'}">
									Skor 30 hari: {item.stats_30d.avg}% ({item.stats_30d.count}x isi)
								</p>
							{/if}
							<div class="flex items-center gap-1.5 mt-2 flex-wrap">
								<span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold" style="background: {badge.bg}; color: {badge.color}">
									{badge.label}
								</span>
								{#if item.status === 'delegated'}
									<span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold" style="background: #EDE9FE; color: #6D28D9">
										Didelegasikan untuk Anda
									</span>
								{/if}
								{#if item.status === 'remedial'}
									<!-- Kontrol Patroli Fase 1: checklist ini menyimpang kemarin, wajib diperiksa ulang hari ini. -->
									<span class="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold" style="background: #FEF3C7; color: #92400E">
										⚠ Checklist Remedial
									</span>
								{/if}
							</div>
						</div>
						<div class="flex items-center gap-2 shrink-0">
							{#if item.existing_response?.scoring_result != null}
								<div class="relative w-9 h-9" title="Skor kebersihan: {item.existing_response.scoring_result}%">
									<svg viewBox="0 0 40 40" class="w-9 h-9 -rotate-90">
										<circle cx="20" cy="20" r={RING_R} fill="none" stroke="var(--sys-sep)" stroke-width="4" />
										<circle
											cx="20" cy="20" r={RING_R} fill="none"
											stroke={ringColor(item.existing_response.scoring_result)}
											stroke-width="4" stroke-linecap="round"
											stroke-dasharray={RING_CIRC}
											stroke-dashoffset={ringDashoffset(item.existing_response.scoring_result)}
										/>
									</svg>
									<span class="absolute inset-0 flex items-center justify-center text-[9px] font-bold" style="color: {ringColor(item.existing_response.scoring_result)}">
										{Math.round(item.existing_response.scoring_result)}
									</span>
								</div>
							{/if}
							{#if done}
								<IconCircleCheck size={18} style="color: var(--ggd)" />
							{:else}
								<IconChevronRight size={18} style="color: var(--sys-label3)" />
							{/if}
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>
