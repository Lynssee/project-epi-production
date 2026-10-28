<!-- src/routes/(app)/proyek/[project_id]/rfi/+page.svelte -->
<!-- RFI (Request for Inspection) lapangan (Quality Management Proyek v2, Fase 2 — 10 Agustus 2026). -->
<!-- PL ajukan RFI di sini; Admin/QC Manager menugaskan inspector+jadwal lewat /project-quality/rfi. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { getProjectById } from '$lib/services/projects';
	import { createRfi, fetchProjectRfiList } from '$lib/services/projectRfiApi';
	import { IconArrowLeft, IconLoader2 } from '@tabler/icons-svelte';

	let projectId = $derived($page.params.project_id as string);
	let loading = $state(true);
	let project = $state<any>(null);
	let rfiList = $state<any[]>([]);

	let showForm = $state(false);
	let saving = $state(false);
	let form = $state({ areaZone: '', deskripsi: '' });

	const STATUS_LABEL: Record<string, string> = { open: 'Menunggu Jadwal', scheduled: 'Terjadwal', completed: 'Selesai', cancelled: 'Dibatalkan' };
	const STATUS_COLOR: Record<string, string> = {
		open: 'bg-amber-100 text-amber-700',
		scheduled: 'bg-blue-100 text-blue-700',
		completed: 'bg-green-100 text-green-700',
		cancelled: 'bg-gray-200 text-gray-500'
	};

	async function load() {
		loading = true;
		try {
			const [proj, list] = await Promise.all([getProjectById(projectId), fetchProjectRfiList(Number(projectId))]);
			project = proj;
			rfiList = list as any[];
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function submitRfi() {
		if (!form.deskripsi.trim()) return;
		saving = true;
		try {
			await createRfi({
				projectId: Number(projectId),
				areaZone: form.areaZone || undefined,
				deskripsi: form.deskripsi.trim(),
				requestedById: $authStore.karyawanId || undefined
			});
			form = { areaZone: '', deskripsi: '' };
			showForm = false;
			await load();
		} finally {
			saving = false;
		}
	}
</script>

<div class="mx-auto max-w-lg p-4 pb-24">
	<button class="mb-3 flex items-center gap-1 text-sm text-gray-500" onclick={() => goto(`/proyek/${projectId}`)}>
		<IconArrowLeft size={16} /> Kembali ke Proyek
	</button>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-14">
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat Request for Inspection (RFI)..." />
	</div>
	{:else}
		<h1 class="text-lg font-bold text-gray-900">RFI — Request for Inspection</h1>
		<p class="mb-4 text-sm text-gray-500">{project?.name || '-'}</p>

		<div class="mb-4 flex items-center justify-between">
			<span class="text-xs text-gray-400">{rfiList.length} RFI</span>
			<button class="text-xs font-semibold text-blue-600" onclick={() => (showForm = !showForm)}>
				{showForm ? 'Batal' : '+ Ajukan RFI'}
			</button>
		</div>

		{#if showForm}
			<div class="mb-4 space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
				<input type="text" class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" placeholder="Area/Zone (opsional)" bind:value={form.areaZone} />
				<textarea class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" rows="2" placeholder="Pekerjaan apa yang perlu diinspeksi" bind:value={form.deskripsi}></textarea>
				<button
					class="w-full rounded-lg bg-blue-600 py-1.5 text-xs font-bold text-white disabled:opacity-60"
					disabled={saving}
					onclick={submitRfi}
				>
					{saving ? '…' : 'Ajukan RFI'}
				</button>
			</div>
		{/if}

		<div class="space-y-2">
			{#each rfiList as rfi (rfi.id)}
				<div class="rounded-lg border border-gray-100 bg-white p-3 text-xs">
					<div class="flex items-center justify-between">
						<span class="font-mono text-gray-400">{rfi.rfi_no}</span>
						<span class="rounded-full px-2 py-0.5 {STATUS_COLOR[rfi.status] || 'bg-gray-100'}">{STATUS_LABEL[rfi.status] || rfi.status}</span>
					</div>
					<p class="mt-1 text-gray-700">{rfi.deskripsi}</p>
					{#if rfi.area_zone}<p class="text-gray-400">Area: {rfi.area_zone}</p>{/if}
					{#if rfi.inspector_id?.nama_karyawan}
						<p class="mt-1 text-blue-600">Inspector: {rfi.inspector_id.nama_karyawan}{rfi.scheduled_at ? ` — ${new Date(rfi.scheduled_at).toLocaleString('id-ID')}` : ''}</p>
					{/if}
				</div>
			{:else}
				<p class="text-xs text-gray-400">Belum ada RFI.</p>
			{/each}
		</div>
	{/if}
</div>
