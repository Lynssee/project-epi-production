<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore, getUserDisplay } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { fetchApprovalTasks, approvePRField, rejectPRField, type ApprovalTask } from '$lib/services/procurementApi';
	import { getPengajuanLampiran } from '$lib/services/attachmentApi';
	import LampiranMobile from '$lib/components/procurement/LampiranMobile.svelte';
	import { IconArrowLeft, IconLoader2, IconCheck, IconX, IconAlertTriangle, IconPaperclip, IconChevronDown } from '@tabler/icons-svelte';

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'approve_pengajuan_pembelian', roles)) {
			goto('/');
		}
	});

	let loading = $state(true);
	let tasks = $state<ApprovalTask[]>([]);
	let processingId = $state<number | null>(null);

	// Lampiran Otomatis PR v2 (Fase 5): badge kelengkapan + panel LampiranMobile per kartu.
	let lampiranStatus = $state<Record<number, { done: number; total: number }>>({});
	let expandedLampiran = $state<number | null>(null);

	const rupiah = (n: number) => 'Rp ' + new Intl.NumberFormat('id-ID').format(Math.round(n || 0));

	async function refreshLampiranBadge(id: number) {
		try {
			const cl = await getPengajuanLampiran(id);
			const req = cl.filter((c) => c.is_required);
			lampiranStatus[id] = { done: req.filter((c) => c.fulfilled).length, total: req.length };
		} catch {
			/* koleksi/aturan belum ada — abaikan, badge tidak muncul */
		}
	}

	async function load() {
		loading = true;
		tasks = await fetchApprovalTasks();
		loading = false;
		// Badge kelengkapan dimuat di belakang layar, tidak menahan render kartu.
		Promise.all(tasks.map((t) => refreshLampiranBadge(t.id)));
	}

	async function handleApprove(task: ApprovalTask) {
		processingId = task.id;
		try {
			const res = await approvePRField(task.id, `Disetujui via HP oleh ${getUserDisplay($authStore.user)}`);
			if (res.success) {
				tasks = tasks.filter((t) => t.id !== task.id);
			} else {
				alert(res.error || 'Gagal approve');
			}
		} finally {
			processingId = null;
		}
	}

	async function handleReject(task: ApprovalTask) {
		const reason = prompt('Alasan penolakan:');
		if (!reason) return;
		processingId = task.id;
		try {
			const res = await rejectPRField(task.id, reason);
			if (res.success) {
				tasks = tasks.filter((t) => t.id !== task.id);
			} else {
				alert(res.error || 'Gagal reject');
			}
		} finally {
			processingId = null;
		}
	}

	onMount(load);
</script>

<div class="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
	<div class="glass-panel border-b border-white/40 sticky top-0 z-30 shadow-sm px-4 py-3 flex items-center gap-3">
		<button onclick={() => goto('/procurement')} class="p-2 -ml-2 rounded-full hover:bg-slate-100">
			<IconArrowLeft size={20} />
		</button>
		<h1 class="text-base font-bold" style="color: var(--sys-label)">Approval Saya</h1>
	</div>

	<div class="flex-1 overflow-y-auto px-4 py-6 pb-24">
		<div class="max-w-xl mx-auto w-full space-y-3">
			{#if loading}
				<div class="flex flex-col items-center justify-center py-12">
		<CircularProgressGauge size={52} strokeWidth={4} label="Memuat approval procurement..." />
	</div>
			{:else if tasks.length === 0}
				<div class="glass-panel rounded-2xl p-8 text-center border border-white/50 shadow-sm">
					<p class="text-sm" style="color: var(--sys-label3)">Tidak ada PR menunggu approval Anda.</p>
				</div>
			{:else}
				{#each tasks as task (task.id)}
					<div class="glass-panel rounded-2xl p-4 border border-white/50 shadow-sm">
						<div class="flex items-start justify-between gap-2 mb-2">
							<div>
								<p class="text-sm font-bold" style="color: var(--sys-label)">#{task.id} — {task.department}</p>
								<p class="text-xs" style="color: var(--sys-label3)">{task.tujuan_pengajuan}</p>
							</div>
							<span class="text-xs font-bold text-blue-600 shrink-0">{rupiah(task.total_estimasi)}</span>
						</div>
						{#if task.stock_gate_status === 'menunggu_cek_stok'}
							<div class="flex items-center gap-1.5 text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2 py-1 mb-2 w-fit">
								<IconAlertTriangle size={12} /> Belum lolos cek stok Inventory
							</div>
						{/if}

						{#if lampiranStatus[task.id]?.total > 0}
							{@const ls = lampiranStatus[task.id]}
							<button
								type="button"
								onclick={() => (expandedLampiran = expandedLampiran === task.id ? null : task.id)}
								class="flex items-center gap-1.5 text-[11px] font-semibold rounded-lg px-2 py-1 mb-1 {ls.done === ls.total
									? 'text-green-700 bg-green-50'
									: 'text-amber-700 bg-amber-50'}"
							>
								<IconPaperclip size={12} />
								Lampiran {ls.done}/{ls.total} wajib
								<IconChevronDown
									size={12}
									class="transition-transform {expandedLampiran === task.id ? 'rotate-180' : ''}"
								/>
							</button>
							{#if expandedLampiran === task.id}
								<div class="mt-1 mb-2">
									<LampiranMobile pengajuanId={task.id} onchanged={() => refreshLampiranBadge(task.id)} />
								</div>
							{/if}
						{/if}

						<div class="flex items-center gap-2 mt-3">
							<button
								onclick={() => handleApprove(task)}
								disabled={processingId === task.id}
								class="flex-1 py-2.5 bg-emerald-500 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"
							>
								{#if processingId === task.id}<IconLoader2 size={16} class="animate-spin" />{:else}<IconCheck size={16} />{/if}
								Setujui
							</button>
							<button
								onclick={() => handleReject(task)}
								disabled={processingId === task.id}
								class="flex-1 py-2.5 bg-red-50 text-red-600 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-50 border border-red-200"
							>
								<IconX size={16} /> Tolak
							</button>
						</div>
					</div>
				{/each}
			{/if}
		</div>
	</div>
</div>
