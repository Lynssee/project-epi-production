<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getEquipmentById, getDuePmTasks, completePmTask, logActivity } from '$lib/services/preventive';
	import IconArrowLeft from '@tabler/icons-svelte/icons/arrow-left';
	import IconLoader2 from '@tabler/icons-svelte/icons/loader-2';
	import IconAlertTriangle from '@tabler/icons-svelte/icons/alert-triangle';
	import IconCircleCheck from '@tabler/icons-svelte/icons/circle-check';
	import IconClock from '@tabler/icons-svelte/icons/clock';
	import KnowledgeCard from '$lib/components/inventory360/KnowledgeCard.svelte';

	let equipmentId = $derived($page.params.equipment_id as string);
	const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().split('T')[0];

	let loading = $state(true);
	let equipment = $state<any>(null);
	let tasks = $state<any[]>([]);
	let activeTaskId = $state<string | null>(null);
	let hoursmeterInput = $state<number | null>(null);
	let submitting = $state(false);
	let errorMsg = $state('');

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'input_preventive', roles)) {
			goto('/');
		}
	});

	async function load() {
		loading = true;
		[equipment, tasks] = await Promise.all([getEquipmentById(equipmentId), getDuePmTasks(equipmentId)]);
		loading = false;
	}

	onMount(load);

	function isOverdue(t: any) {
		return (t.status?.name || '').toLowerCase() === 'overdue' || (t.due_date && t.due_date < today);
	}

	async function handleComplete(taskId: string) {
		submitting = true;
		errorMsg = '';
		try {
			await completePmTask(taskId, { doneDate: today, hoursmeter: hoursmeterInput });
			const karyawanName = $authStore.karyawanName;
			if (karyawanName) {
				await logActivity({
					user_name: karyawanName,
					action: 'update',
					entity_type: 'pm_due_tracker',
					entity_id: taskId,
					summary: `Tugas PM ${equipment?.name} ditandai selesai`
				});
			}
			activeTaskId = null;
			hoursmeterInput = null;
			await load();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal menandai tugas selesai.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="scroll-body">
	<div class="max-w-2xl mx-auto p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/preventive')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat checklist perawatan PM..." />
		</div>
	{:else}
		<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">{equipment?.name}</h1>
		<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Tugas PM jatuh tempo</p>
			{#if equipment?.identitas_barang_id}<div class="mb-3"><KnowledgeCard itemId={equipment.identitas_barang_id} context="maintenance" label="Panduan perawatan" /></div>{/if}

		{#if errorMsg}
			<p class="text-[12px] mb-3" style="color: #DC2626">{errorMsg}</p>
		{/if}

		{#if tasks.length === 0}
			<div class="text-center py-12 text-[12px]" style="color: var(--sys-label3)">Tidak ada tugas PM jatuh tempo untuk unit ini.</div>
		{:else}
			<div class="flex flex-col gap-2">
				{#each tasks as t (t.id)}
					<div class="rounded-xl border p-3.5" style="border-color: var(--sys-sep)">
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0">
								<p class="text-[13px] font-semibold" style="color: var(--sys-label)">{t.template?.task_name || 'Tugas PM'}</p>
								<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">Jatuh tempo: {t.due_date || '-'}</p>
							</div>
							<span
								class="shrink-0 inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full"
								style={isOverdue(t) ? 'background:var(--rel); color:var(--red)' : 'background:var(--aml); color:var(--amd)'}
							>
								{#if isOverdue(t)}<IconAlertTriangle size={11} /> Overdue{:else}<IconClock size={11} /> Upcoming{/if}
							</span>
						</div>

						{#if activeTaskId === t.id}
							<div class="mt-3 flex flex-col gap-2">
								<input
									type="number"
									class="w-full rounded-lg border text-[12px] p-2"
									style="border-color: var(--sys-sep)"
									placeholder="Hoursmeter/odometer saat ini (opsional)"
									bind:value={hoursmeterInput}
								/>
								<div class="flex gap-2">
									<button
										class="flex-1 h-10 rounded-lg text-[12px] font-semibold"
										style="background:var(--sys-fill); color:var(--sys-label3)"
										onclick={() => (activeTaskId = null)}
									>
										Batal
									</button>
									<button
										class="flex-1 h-10 rounded-lg text-[12px] font-bold text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
										style="background: var(--g)"
										disabled={submitting}
										onclick={() => handleComplete(t.id)}
									>
										{#if submitting}<IconLoader2 size={14} class="animate-spin" />{/if}
										Tandai Selesai
									</button>
								</div>
							</div>
						{:else}
							<button
								class="w-full mt-3 h-9 rounded-lg text-[12px] font-semibold flex items-center justify-center gap-1.5"
								style="background:var(--gl); color:var(--g)"
								onclick={() => (activeTaskId = t.id)}
							>
								<IconCircleCheck size={14} /> Tandai Selesai
							</button>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	{/if}
	</div>
</div>
