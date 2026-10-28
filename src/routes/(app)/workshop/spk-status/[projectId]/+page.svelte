<!-- src/routes/(app)/workshop/spk-status/[projectId]/+page.svelte -->
<!-- R11 — SPK/Tiket Kerja Internal Status Tracking (docs analisis v2 §7). Read-only:
     ciketing_work_ticket SUDAH punya status/qty_completed/qty_shipped di skema (gap
     murni UI, bukan data) — halaman ini baru sekadar menampilkannya untuk leader lapangan. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { WORKSHOP_OPS, parseOpsWorkshop } from '$lib/services/workshopOpsProfile';
	import { fetchWorkTicketsForProject, WORK_TICKET_STATUS_LABEL, type WorkTicketStatusRow } from '$lib/services/workshopOpsApi';
	import { IconArrowLeft, IconLoader2, IconClipboardList } from '@tabler/icons-svelte';

	const projectId = Number(page.params.projectId);
	// Fase 7c: workshop dari ?ws= (dibawa dari halaman /workshop); default ciketing.
	const wsKey = parseOpsWorkshop(page.url.searchParams.get('ws'));
	const P = WORKSHOP_OPS[wsKey];

	let tickets = $state<WorkTicketStatusRow[]>([]);
	let loading = $state(true);
	let errorMsg = $state('');

	const STATUS_STYLE: Record<string, string> = {
		draft: 'background: rgba(148,163,184,0.15); color:#64748b;',
		in_progress: 'background: rgba(245,158,11,0.12); color:#f59e0b;',
		partial_complete: 'background: rgba(59,130,246,0.12); color:#3b82f6;',
		completed: 'background: rgba(16,185,129,0.12); color:#10b981;',
		closed: 'background: rgba(100,116,139,0.12); color:#475569;'
	};

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			tickets = await fetchWorkTicketsForProject(projectId, wsKey);
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat status SPK.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	function pct(t: WorkTicketStatusRow) {
		if (!t.totalQty) return 0;
		return Math.min(100, Math.round((t.qtyCompleted / t.totalQty) * 100));
	}

	function formatTanggal(iso: string | null) {
		if (!iso) return '-';
		try { return new Date(iso).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }); }
		catch { return '-'; }
	}
</script>

<svelte:head><title>Status SPK — Workshop {P.label}</title></svelte:head>

<div class="p-4 max-w-lg mx-auto pb-24">
	<button class="flex items-center gap-1.5 text-sm mb-4" style="color: var(--sys-label2)" onclick={() => goto(`/workshop?ws=${wsKey}`)}>
		<IconArrowLeft size={16} /> Kembali
	</button>

	<h1 class="text-lg font-bold mb-1" style="color: var(--sys-label)">Status SPK / Tiket Kerja</h1>
	<p class="text-[12px] mb-4" style="color: var(--sys-label3)">
		Progres tiket kerja internal proyek ini — qty selesai QC vs total, dan qty yang sudah keluar via Surat Jalan. View-only, status diubah dari admin.
	</p>

	{#if errorMsg}
		<div class="p-3 rounded-lg mb-3 text-[12px]" style="background: rgba(239,68,68,0.1); color:#ef4444;">{errorMsg}</div>
	{/if}

	{#if loading}
		<div class="flex justify-center py-10">
			<CircularProgressGauge size={64} strokeWidth={5} label="Memuat Status Tiket Kerja..." sublabel="Sinkronisasi SPK proyek workshop" />
		</div>
	{:else if tickets.length === 0}
		<div class="text-center py-14 rounded-xl border" style="border-color: var(--sys-sep)">
			<IconClipboardList size={32} style="color: var(--sys-label4); margin: 0 auto;" />
			<p class="text-[13px] font-semibold mt-2" style="color: var(--sys-label)">Belum ada tiket kerja untuk proyek ini.</p>
		</div>
	{:else}
		<div class="space-y-3">
			{#each tickets as t (t.id)}
				<div class="p-3 rounded-xl border" style="border-color: var(--sys-sep)">
					<div class="flex items-center justify-between gap-2 mb-1.5">
						<div class="text-[13px] font-semibold" style="color: var(--sys-label)">{t.ticketNumber}</div>
						<span class="text-[9px] font-bold px-2 py-1 rounded-full" style={STATUS_STYLE[t.status] || ''}>
							{WORK_TICKET_STATUS_LABEL[t.status] || t.status}
						</span>
					</div>
					<div class="text-[11px] mb-2" style="color: var(--sys-label3)">
						{t.poNumber ? `PO: ${t.poNumber}` : 'Non-PO'} · Dibuat {formatTanggal(t.dateCreated)}
					</div>
					<div class="w-full h-1.5 rounded-full overflow-hidden" style="background: var(--sys-fill)">
						<div class="h-full rounded-full" style="width: {pct(t)}%; background: var(--g)"></div>
					</div>
					<div class="flex justify-between text-[10px] mt-1" style="color: var(--sys-label3)">
						<span>QC Selesai: {t.qtyCompleted.toLocaleString('id-ID')} / {t.totalQty.toLocaleString('id-ID')} {t.satuan || ''}</span>
						<span>Terkirim: {t.qtyShipped.toLocaleString('id-ID')} {t.satuan || ''}</span>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
