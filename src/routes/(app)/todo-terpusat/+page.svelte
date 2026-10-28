<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// To-Do Terpusat (Fase 6 Modul Operasional Terpusat) — 3 seksi terpisah lintas proyek:
	// (1) Review Maintenance = SATU-SATUNYA yang actionable, endpoint approve/reject reuse
	// apa adanya dari pola /leader (TIDAK menyentuh /leader itu sendiri); (2) Laporan Harian
	// & (3) Kasbon Manpower = info read-only, bukan aksi (lihat catatan di todoTerpusatApi.ts).
	import { onMount } from 'svelte';
	import { IconLoader2, IconCheck, IconX } from '@tabler/icons-svelte';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { getIdToken } from '$lib/services/secureDirectus';
	import {
		getMaintenanceReviewForProjects,
		getLaporanHarianStatusForProjects,
		getKasbonManpowerInfoForProjects,
		type MaintenanceReviewRow,
		type LaporanHarianStatusRow
	} from '$lib/services/todoTerpusatApi';
	import type { KasbonManpowerRow } from '$lib/services/kasbonManpowerTerpusat';

	let loading = $state(true);
	let projects = $state<any[]>([]);
	let maintenanceRows = $state<MaintenanceReviewRow[]>([]);
	let laporanRows = $state<LaporanHarianStatusRow[]>([]);
	let kasbonRows = $state<KasbonManpowerRow[]>([]);

	let rejectingId = $state<string | null>(null);
	let rejectNote = $state('');
	let actingId = $state<string | null>(null);
	let actionError = $state('');

	onMount(load);

	async function load() {
		loading = true;
		try {
			projects = (await getProjectsForCurrentUser(false, { limit: -1 })) || [];
			const projectIds = projects.map((p) => p.id);
			[maintenanceRows, laporanRows, kasbonRows] = await Promise.all([
				getMaintenanceReviewForProjects(projects),
				getLaporanHarianStatusForProjects(projects),
				getKasbonManpowerInfoForProjects(projectIds)
			]);
		} finally {
			loading = false;
		}
	}

	// Pola sama persis /leader (Review Laporan) -- endpoint existing, tidak ada backend baru.
	async function callApprovalEndpoint(id: string, action: 'approve' | 'reject', catatan?: string) {
		const token = await getIdToken();
		const res = await fetch(`/api/maintenance/mekanik-activity/${id}/${action}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify(catatan ? { catatan } : {})
		});
		const data = await res.json().catch(() => null);
		if (!res.ok) throw new Error(data?.message || `Gagal (${res.status})`);
		return data;
	}

	async function approve(id: string) {
		actingId = id;
		actionError = '';
		try {
			await callApprovalEndpoint(id, 'approve');
			maintenanceRows = maintenanceRows.filter((r) => r.id !== id);
		} catch (err: any) {
			actionError = err?.message || 'Gagal menyetujui laporan.';
		} finally {
			actingId = null;
		}
	}

	async function submitReject(id: string) {
		if (!rejectNote.trim()) return;
		actingId = id;
		actionError = '';
		try {
			await callApprovalEndpoint(id, 'reject', rejectNote.trim());
			maintenanceRows = maintenanceRows.filter((r) => r.id !== id);
			rejectingId = null;
			rejectNote = '';
		} catch (err: any) {
			actionError = err?.message || 'Gagal menolak laporan.';
		} finally {
			actingId = null;
		}
	}

	function fmtRp(v: number) {
		return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(v || 0);
	}
</script>

<div class="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
	<div>
		<h1 class="text-xl font-bold text-gray-900">To-Do Terpusat</h1>
		<p class="text-sm text-gray-500">Ringkasan tindakan & info yang perlu perhatian Anda, dari semua proyek yang Anda pegang.</p>
	</div>

	{#if loading}
		<div class="py-12 flex justify-center">
			<CircularProgressGauge size={72} strokeWidth={6} label="Memuat To-Do Terpusat..." sublabel="Sinkronisasi tugas & review mekanik" />
		</div>
	{:else if projects.length === 0}
		<div class="text-center py-12 bg-white rounded-2xl border border-gray-100">
			<p class="text-[14px] text-gray-500">Anda belum ditugaskan ke proyek manapun.</p>
		</div>
	{:else}
		<!-- Seksi 1: Perlu Tindakan Anda -->
		<div class="space-y-3">
			<h2 class="text-sm font-bold text-gray-700 uppercase tracking-wide">⚡ Perlu Tindakan Anda — Review Maintenance</h2>
			{#if actionError}<p class="text-xs text-red-600">{actionError}</p>{/if}
			{#if maintenanceRows.length === 0}
				<div class="bg-white rounded-xl border border-gray-100 py-8 text-center text-[13px] text-gray-400">Tidak ada aktivitas mekanik menunggu review.</div>
			{:else}
				<div class="space-y-2">
					{#each maintenanceRows as act (act.id)}
						<div class="bg-white rounded-xl border border-gray-100 p-4">
							<div class="flex items-start justify-between gap-3">
								<div>
									<p class="font-semibold text-gray-800 text-[13px]">{act.equipmentName} — {act.projectName}</p>
									<p class="text-[12px] text-gray-500 mt-0.5">{act.kegiatanRepair || '-'} · {act.mekanikName}</p>
									{#if act.kendala}<p class="text-[11px] text-amber-600 mt-1">Kendala: {act.kendala}</p>{/if}
								</div>
								<span class="text-[11px] text-gray-400 shrink-0">{act.tanggalInput}</span>
							</div>
							{#if rejectingId === act.id}
								<div class="mt-3 flex flex-col gap-2">
									<textarea
										class="w-full rounded-lg border border-gray-200 text-[12px] p-2.5"
										rows="2"
										placeholder="Catatan penolakan (wajib)"
										bind:value={rejectNote}
									></textarea>
									<div class="flex gap-2">
										<button
											class="flex-1 h-9 rounded-lg text-[12px] font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40"
											disabled={!rejectNote.trim() || actingId === act.id}
											onclick={() => submitReject(act.id)}
										>
											Kirim Penolakan
										</button>
										<button
											class="px-3 h-9 rounded-lg text-[12px] font-semibold border border-gray-200 text-gray-500"
											onclick={() => { rejectingId = null; rejectNote = ''; }}
										>
											Batal
										</button>
									</div>
								</div>
							{:else}
								<div class="flex gap-2 mt-3">
									<button
										class="flex-1 h-9 rounded-lg text-[12px] font-semibold text-white bg-green-600 hover:bg-green-700 flex items-center justify-center gap-1.5 disabled:opacity-40"
										disabled={actingId === act.id}
										onclick={() => approve(act.id)}
									>
										{#if actingId === act.id}<IconLoader2 size={14} class="animate-spin" />{:else}<IconCheck size={14} />{/if}
										Setujui
									</button>
									<button
										class="flex-1 h-9 rounded-lg text-[12px] font-semibold border border-gray-200 text-gray-600 flex items-center justify-center gap-1.5"
										onclick={() => { rejectingId = act.id; rejectNote = ''; }}
									>
										<IconX size={14} /> Tolak
									</button>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Seksi 2: Info Laporan Harian -->
		<div class="space-y-3">
			<h2 class="text-sm font-bold text-gray-700 uppercase tracking-wide">ℹ️ Info — Laporan Harian Menunggu Review</h2>
			{#if laporanRows.length === 0}
				<div class="bg-white rounded-xl border border-gray-100 py-8 text-center text-[13px] text-gray-400">Semua laporan harian sudah direview.</div>
			{:else}
				<div class="bg-white rounded-xl border border-gray-100 divide-y divide-gray-100">
					{#each laporanRows as r (r.projectId)}
						<a href={`/laporan/${r.projectId}`} class="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
							<span class="text-[13px] font-medium text-gray-800">{r.projectName}</span>
							<span class="text-[12px] font-semibold text-amber-600">{r.belumApproved} belum direview</span>
						</a>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Seksi 3: Info Kasbon -->
		<div class="space-y-3">
			<div class="flex items-center justify-between">
				<h2 class="text-sm font-bold text-gray-700 uppercase tracking-wide">ℹ️ Info — Kasbon Menunggu Admin Proyek</h2>
				<a href="/kasbon-terpusat" class="text-[12px] font-semibold text-green-700 hover:underline">Lihat semua →</a>
			</div>
			{#if kasbonRows.length === 0}
				<div class="bg-white rounded-xl border border-gray-100 py-8 text-center text-[13px] text-gray-400">Tidak ada kasbon menunggu.</div>
			{:else}
				<div class="bg-white rounded-xl border border-gray-100 divide-y divide-gray-100">
					{#each kasbonRows.slice(0, 5) as k (k.id)}
						<div class="flex items-center justify-between px-4 py-3">
							<span class="text-[13px] text-gray-700">{k.manpower_nama}</span>
							<span class="text-[12px] font-semibold text-gray-600">{fmtRp(k.sisa)}</span>
						</div>
					{/each}
					{#if kasbonRows.length > 5}
						<div class="px-4 py-2 text-[11px] text-gray-400">+{kasbonRows.length - 5} lainnya</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}
</div>
