<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconLoader2, IconClock } from '@tabler/icons-svelte';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { getAllManpower, getManpowerByIds, type Manpower } from '$lib/services/manpower';
	import directus from '$lib/services/directus';
	import { readItems } from '@directus/sdk';
	import { authStore } from '$lib/stores/auth';
	import { submitOvertimeRequest, getOvertimeRequestsForProject, type OvertimeRequest } from '$lib/services/overtimeRequest';

	// ── Ajukan Lembur Manpower (Fase 3, Manpower v2) ──────────────────────
	// PL mengajukan lembur untuk pekerja di proyeknya; HRD menyetujui di
	// erp-epi-1 (Overtime Control). Tidak menyentuh ot_hours harian yang
	// dicatat terpisah saat absensi — ini murni jejak pengajuan sebelum lembur
	// dikerjakan.

	let loading = $state(true);
	let submitting = $state(false);
	let projects = $state<any[]>([]);
	let assignments = $state<any[]>([]);
	let requests = $state<OvertimeRequest[]>([]);

	let form = $state({
		project_id: '',
		assignment_id: '',
		tanggal: new Date().toISOString().split('T')[0],
		jam: 2,
		alasan: ''
	});

	function today() {
		return new Date().toISOString().split('T')[0];
	}

	async function loadProjects() {
		projects = (await getProjectsForCurrentUser(true)) || [];
		if (projects.length > 0) {
			form.project_id = String(projects[0].id);
			await loadAssignments();
			await loadRequests();
		}
	}

	async function loadAssignments() {
		if (!form.project_id) { assignments = []; return; }
		try {
			assignments = (await directus.request(
				readItems('manpower_assignment', {
					fields: ['id', 'manpower_id.id', 'manpower_id.nama', 'jabatan', 'status'],
					filter: { project_id: { _eq: Number(form.project_id) }, status: { _eq: 'aktif' } },
					limit: -1
				})
			)) as any[];
		} catch (e) {
			console.error('Gagal memuat penugasan', e);
			assignments = [];
		}
	}

	async function loadRequests() {
		if (!form.project_id) { requests = []; return; }
		requests = await getOvertimeRequestsForProject(Number(form.project_id));
	}

	async function handleProjectChange() {
		form.assignment_id = '';
		await loadAssignments();
		await loadRequests();
	}

	async function handleSubmit() {
		if (!form.assignment_id || !form.jam || form.jam <= 0) return;
		const a = assignments.find((x) => String(x.id) === form.assignment_id);
		if (!a) return;
		const manpowerId = typeof a.manpower_id === 'object' ? a.manpower_id?.id : a.manpower_id;
		submitting = true;
		try {
			const res = await submitOvertimeRequest({
				assignmentId: Number(form.assignment_id),
				manpowerId: Number(manpowerId),
				projectId: Number(form.project_id),
				tanggal: form.tanggal,
				jamDiajukan: Number(form.jam),
				alasan: form.alasan,
				diajukanOleh: $authStore.karyawanName || ''
			});
			if (res.success) {
				form = { ...form, assignment_id: '', jam: 2, alasan: '' };
				await loadRequests();
			}
		} finally {
			submitting = false;
		}
	}

	function statusBadge(s: string) {
		if (s === 'disetujui') return 'bg-emerald-100 text-emerald-700';
		if (s === 'ditolak') return 'bg-red-100 text-red-700';
		return 'bg-amber-100 text-amber-700';
	}
	function statusLabel(s: string) {
		if (s === 'disetujui') return 'Disetujui';
		if (s === 'ditolak') return 'Ditolak';
		return 'Menunggu';
	}

	onMount(async () => {
		try {
			await loadProjects();
		} finally {
			loading = false;
		}
	});
</script>

<div class="flex flex-col h-full bg-gray-50">
	<div class="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
		<button onclick={() => goto('/manpower')} class="p-1 -ml-1 text-gray-500">
			<IconArrowLeft size={20} />
		</button>
		<div>
			<p class="text-[14px] font-semibold text-gray-800">Ajukan Lembur Manpower</p>
			<p class="text-[11px] text-gray-400">Diproses HRD sebelum dikerjakan</p>
		</div>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data lembur lapangan..." />
		</div>
	{:else}
		<div class="flex-1 overflow-y-auto px-4 py-4 space-y-4">
			<div class="bg-white rounded-xl border border-gray-100 p-3">
				<label class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Proyek</label>
				<select
					bind:value={form.project_id}
					onchange={handleProjectChange}
					class="w-full mt-1 text-[13px] px-3 py-2 rounded-lg border border-gray-200 bg-white"
				>
					{#each projects as p}
						<option value={String(p.id)}>{p.name}</option>
					{/each}
				</select>
			</div>

			<div class="bg-white rounded-xl border border-gray-100 p-3 space-y-3">
				<div>
					<label class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Pekerja</label>
					<select bind:value={form.assignment_id} class="w-full mt-1 text-[13px] px-3 py-2 rounded-lg border border-gray-200 bg-white">
						<option value="">-- Pilih pekerja --</option>
						{#each assignments as a}
							<option value={String(a.id)}>{a.manpower_id?.nama || '-'} — {a.jabatan || '-'}</option>
						{/each}
					</select>
				</div>
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Tanggal</label>
						<input type="date" bind:value={form.tanggal} max={today()} class="w-full mt-1 text-[13px] px-3 py-2 rounded-lg border border-gray-200" />
					</div>
					<div>
						<label class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Jam Lembur</label>
						<input type="number" min="1" step="0.5" bind:value={form.jam} class="w-full mt-1 text-[13px] px-3 py-2 rounded-lg border border-gray-200" />
					</div>
				</div>
				<div>
					<label class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Alasan</label>
					<textarea bind:value={form.alasan} rows="2" placeholder="Kejar deadline, kurang tenaga, dll" class="w-full mt-1 text-[13px] px-3 py-2 rounded-lg border border-gray-200"></textarea>
				</div>
				<button
					onclick={handleSubmit}
					disabled={submitting || !form.assignment_id}
					class="w-full py-2.5 rounded-lg bg-[var(--g)] text-white text-[13px] font-semibold disabled:opacity-50"
				>
					{submitting ? 'Mengirim...' : 'Ajukan Lembur'}
				</button>
			</div>

			<div>
				<div class="flex items-center gap-1.5 text-[10px] font-semibold text-gray-400 tracking-widest uppercase mb-2">
					<IconClock size={14} />
					Riwayat Pengajuan
				</div>
				{#if requests.length === 0}
					<p class="text-[12px] text-gray-400 text-center py-6">Belum ada pengajuan lembur untuk proyek ini.</p>
				{:else}
					<div class="space-y-1.5">
						{#each requests as r (r.id)}
							<div class="bg-white rounded-lg border border-gray-100 p-2.5 flex items-center justify-between">
								<div>
									<p class="text-[12px] font-medium text-gray-800">{(r as any).manpower_id?.nama || '-'}</p>
									<p class="text-[10px] text-gray-400">{r.tanggal} · {r.jam_diajukan} jam</p>
								</div>
								<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full {statusBadge(r.status)}">{statusLabel(r.status)}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>
