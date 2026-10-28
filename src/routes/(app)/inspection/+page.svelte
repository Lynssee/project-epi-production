<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore, getUserDisplay } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { fetchMyReports, type InspectionReport } from '$lib/services/inspectionApi';
	import { IconClipboardCheck, IconPlus, IconChevronRight, IconLoader2, IconAlertTriangle } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let reports = $state<InspectionReport[]>([]);
	let statusFilter = $state('Aktif');

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'input_inspection', roles)) {
			goto('/');
		}
	});

	const STATUS_LABEL: Record<string, string> = {
		draft: 'Draft',
		menunggu_approval: 'Menunggu Approval',
		approved: 'Approved',
		revisi: 'Revisi',
		void: 'Void'
	};

	let filteredReports = $derived.by(() => {
		if (statusFilter === 'Semua') return reports;
		if (statusFilter === 'Aktif') return reports.filter((r) => r.status !== 'approved' && r.status !== 'void');
		return reports.filter((r) => r.status === 'approved');
	});

	onMount(async () => {
		try {
			const name = $authStore.karyawanName || getUserDisplay($authStore.user);
			reports = await fetchMyReports(name);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat laporan inspeksi.';
		} finally {
			loading = false;
		}
	});
</script>

<div class="max-w-7xl mx-auto p-4 md:p-6 pb-20">
	<div class="flex items-center justify-between mb-1">
		<h1 class="text-[18px] md:text-xl font-bold" style="color: var(--sys-label)">Inspection Report</h1>
		<button
			class="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[12px] font-semibold text-white"
			style="background: var(--g)"
			onclick={() => goto('/inspection/new')}
		>
			<IconPlus size={14} /> Buat Baru
		</button>
	</div>
	<p class="text-[12px] md:text-[14px] mb-4" style="color: var(--sys-label3)">Blasting & Painting Inspection Report (BPIR) — laporan Anda</p>

	<div class="flex gap-2 mb-4">
		{#each ['Aktif', 'Approved', 'Semua'] as f}
			<button
				class="px-3 py-1.5 rounded-full text-[12px] font-semibold border"
				style={statusFilter === f ? 'background: var(--g); color: #fff; border-color: var(--g)' : 'border-color: var(--sys-sep); color: var(--sys-label3)'}
				onclick={() => (statusFilter = f)}
			>
				{f}
			</button>
		{/each}
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat daftar inspeksi..." />
		</div>
	{:else if errorMsg}
		<div class="text-center py-16 text-[13px]" style="color: #DC2626">{errorMsg}</div>
	{:else if filteredReports.length === 0}
		<div class="text-center py-16 text-[13px]" style="color: var(--sys-label3)">Belum ada laporan inspeksi untuk kategori ini.</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
			{#each filteredReports as r (r.id)}
				<div
					class="w-full text-left rounded-xl border p-3.5 cursor-pointer transition-all hover:shadow-sm hover:-translate-y-0.5 active:opacity-70"
					style="border-color: var(--sys-sep); background: var(--sys-bg-secondary, #fff)"
					role="button"
					tabindex="0"
					onclick={() => goto(`/inspection/${r.id}`)}
					onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') goto(`/inspection/${r.id}`); }}
				>
					<div class="flex items-start gap-3">
						<div class="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style="background: var(--gl)">
							<IconClipboardCheck size={18} style="color: var(--g)" />
						</div>
						<div class="flex-1 min-w-0">
							<p class="text-[13px] font-semibold truncate" style="color: var(--sys-label)">{r.part_name || r.report_no || `Laporan #${r.id}`}</p>
							<p class="text-[12px] mt-0.5 line-clamp-2" style="color: var(--sys-label3)">{r.client_name || '-'} · {r.po_no || 'PO belum diisi'}</p>
							<div class="flex items-center gap-2 mt-2 flex-wrap">
								<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase" style="background:var(--sys-fill); color:var(--sys-label3)">{r.workshop}</span>
								<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:var(--pl); color:var(--pd)">{STATUS_LABEL[r.status] || r.status}</span>
								{#if r.hold_point_flag}
									<span class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:var(--rel); color:var(--red)">
										<IconAlertTriangle size={11} /> Hold Point
									</span>
								{/if}
							</div>
						</div>
						<IconChevronRight size={16} style="color: var(--sys-label4)" />
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
