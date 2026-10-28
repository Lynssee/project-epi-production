<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Kasbon & Piutang Manpower Terpusat (Fase 5 Modul Operasional Terpusat) — kasbon manpower
	// yang belum lunas, lintas SEMUA proyek yang dipegang user. Read-only monitoring — submit
	// kasbon tetap lewat modal "Ajukan Kasbon" di dalam ProjectPayrollRecap.svelte (via halaman
	// Payroll Terpusat), tidak diduplikasi di sini.
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconLoader2 } from '@tabler/icons-svelte';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { getKasbonManpowerForProjects, type KasbonManpowerRow } from '$lib/services/kasbonManpowerTerpusat';

	let loading = $state(true);
	let projects = $state<any[]>([]);
	let kasbonList = $state<KasbonManpowerRow[]>([]);
	let statusFilter = $state<'berjalan' | 'lunas' | 'semua'>('berjalan');

	onMount(load);

	async function load() {
		loading = true;
		try {
			projects = (await getProjectsForCurrentUser(false, { limit: -1 })) || [];
			const projectIds = projects.map((p) => p.id);
			kasbonList = await getKasbonManpowerForProjects(projectIds);
		} finally {
			loading = false;
		}
	}

	function projectName(projectId: number) {
		return projects.find((p) => p.id === projectId)?.name || `Proyek #${projectId}`;
	}

	let rows = $derived(kasbonList.filter((k) => statusFilter === 'semua' || k.payment_status === statusFilter));

	let totalSisaOutstanding = $derived(
		kasbonList.filter((k) => k.payment_status !== 'lunas').reduce((sum, k) => sum + k.sisa, 0)
	);

	function fmtRp(v: number) {
		return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(v || 0);
	}
	function fmtDate(d: string | null) {
		return d ? new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
	}

	const PST: Record<string, { l: string; c: string }> = {
		berjalan: { l: 'Berjalan', c: 'bg-amber-100 text-amber-700' },
		lunas: { l: 'Lunas', c: 'bg-green-100 text-green-700' },
		pending: { l: 'Pending', c: 'bg-gray-100 text-gray-600' }
	};
</script>

<div class="max-w-6xl mx-auto p-4 sm:p-6 space-y-5">
	<div>
		<a href="/manpower/payroll-terpusat" class="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-700 mb-1">
			<IconArrowLeft size={14} /> Payroll Terpusat
		</a>
		<h1 class="text-xl font-bold text-gray-900">Kasbon & Piutang Manpower Terpusat</h1>
		<p class="text-sm text-gray-500">Kasbon manpower yang belum lunas dari semua proyek yang Anda pegang.</p>
	</div>

	{#if !loading}
		<div class="bg-white rounded-xl border border-gray-200 p-4 inline-block">
			<p class="text-xs text-gray-500 uppercase font-semibold">Total Sisa Piutang Outstanding</p>
			<p class="text-xl font-bold text-red-600 mt-1">{fmtRp(totalSisaOutstanding)}</p>
		</div>
	{/if}

	<div class="flex flex-wrap items-center gap-2">
		<select bind:value={statusFilter} class="f-select bg-white h-[38px] text-[13px] border-gray-200">
			<option value="berjalan">Berjalan</option>
			<option value="lunas">Lunas</option>
			<option value="semua">Semua Status</option>
		</select>
	</div>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat kasbon terpusat..." />
		</div>
	{:else if projects.length === 0}
		<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
			<p class="text-[14px] text-gray-500">Anda belum ditugaskan ke proyek manapun.</p>
		</div>
	{:else if rows.length === 0}
		<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
			<p class="text-[14px] text-gray-500">Tidak ada kasbon yang cocok dengan filter.</p>
		</div>
	{:else}
		<div class="bg-white rounded-2xl border border-gray-100 overflow-x-auto shadow-sm">
			<table class="w-full text-[13px]">
				<thead class="bg-gray-50">
					<tr>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Proyek</th>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Pekerja</th>
						<th class="px-4 py-3 text-right text-[11px] font-semibold text-gray-500 uppercase">Nominal</th>
						<th class="px-4 py-3 text-right text-[11px] font-semibold text-gray-500 uppercase">Sudah Dibayar</th>
						<th class="px-4 py-3 text-right text-[11px] font-semibold text-gray-500 uppercase">Sisa</th>
						<th class="px-4 py-3 text-center text-[11px] font-semibold text-gray-500 uppercase">Status</th>
						<th class="px-4 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase">Tanggal Pengajuan</th>
					</tr>
				</thead>
				<tbody class="divide-y divide-gray-100">
					{#each rows as r (r.id)}
						<tr class="hover:bg-gray-50">
							<td class="px-4 py-3 font-medium text-gray-800">{projectName(r.project_id)}</td>
							<td class="px-4 py-3 text-gray-700">{r.manpower_nama}</td>
							<td class="px-4 py-3 text-right text-gray-700">{fmtRp(r.nominal)}</td>
							<td class="px-4 py-3 text-right text-gray-700">{fmtRp(r.total_paid)}</td>
							<td class="px-4 py-3 text-right font-semibold text-red-600">{fmtRp(r.sisa)}</td>
							<td class="px-4 py-3 text-center">
								<span class="px-2.5 py-1 rounded-full text-xs font-semibold {(PST[r.payment_status]||PST.pending).c}">{(PST[r.payment_status]||PST.pending).l}</span>
							</td>
							<td class="px-4 py-3 text-gray-600">{fmtDate(r.tanggal_pengajuan)}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
