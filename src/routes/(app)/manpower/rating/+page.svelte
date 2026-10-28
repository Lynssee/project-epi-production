<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconLoader2, IconStar } from '@tabler/icons-svelte';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import directus from '$lib/services/directus';
	import { readItems } from '@directus/sdk';
	import { authStore } from '$lib/stores/auth';
	import { submitWorkerRating } from '$lib/services/workerRating';

	// ── Nilai Pekerja (Fase 4, Manpower v2) ────────────────────────────────
	// PL/Foreman menilai kualitas, safety, ketepatan (bintang 1-5) — dilihat
	// HRD sebagai bagian Worker Scorecard. Kehadiran & skill dihitung otomatis,
	// tidak dinilai di sini.

	let loading = $state(true);
	let submitting = $state(false);
	let projects = $state<any[]>([]);
	let assignments = $state<any[]>([]);
	let selectedProjectId = $state('');
	let selectedAssignmentId = $state('');

	let kualitas = $state(0);
	let safety = $state(0);
	let ketepatan = $state(0);
	let catatan = $state('');
	let submitted = $state(false);

	async function loadProjects() {
		projects = (await getProjectsForCurrentUser(true)) || [];
		if (projects.length > 0) {
			selectedProjectId = String(projects[0].id);
			await loadAssignments();
		}
	}

	async function loadAssignments() {
		if (!selectedProjectId) { assignments = []; return; }
		try {
			assignments = (await directus.request(
				readItems('manpower_assignment', {
					fields: ['id', 'manpower_id.id', 'manpower_id.nama', 'jabatan'],
					filter: { project_id: { _eq: Number(selectedProjectId) }, status: { _eq: 'aktif' } },
					limit: -1
				})
			)) as any[];
		} catch (e) {
			console.error('Gagal memuat penugasan', e);
			assignments = [];
		}
	}

	async function handleProjectChange() {
		selectedAssignmentId = '';
		await loadAssignments();
	}

	function resetForm() {
		selectedAssignmentId = '';
		kualitas = 0;
		safety = 0;
		ketepatan = 0;
		catatan = '';
	}

	async function handleSubmit() {
		if (!selectedAssignmentId || !kualitas || !safety || !ketepatan) return;
		const a = assignments.find((x) => String(x.id) === selectedAssignmentId);
		if (!a) return;
		const manpowerId = typeof a.manpower_id === 'object' ? a.manpower_id?.id : a.manpower_id;
		submitting = true;
		try {
			const res = await submitWorkerRating({
				manpowerId: Number(manpowerId),
				projectId: Number(selectedProjectId),
				kualitas, safety, ketepatan, catatan,
				dinilaiOleh: $authStore.karyawanName || ''
			});
			if (res.success) {
				submitted = true;
				resetForm();
				setTimeout(() => (submitted = false), 2000);
			}
		} finally {
			submitting = false;
		}
	}

	onMount(async () => {
		try {
			await loadProjects();
		} finally {
			loading = false;
		}
	});
</script>

{#snippet stars(value: number, onSet: (v: number) => void)}
	<div class="flex gap-1.5">
		{#each [1, 2, 3, 4, 5] as s}
			<button type="button" onclick={() => onSet(s)} class="text-2xl leading-none {value >= s ? '' : 'opacity-25'}">
				<IconStar size={26} class={value >= s ? 'fill-amber-400 text-amber-400' : 'text-gray-300'} />
			</button>
		{/each}
	</div>
{/snippet}

<div class="flex flex-col h-full bg-gray-50">
	<div class="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
		<button onclick={() => goto('/manpower')} class="p-1 -ml-1 text-gray-500">
			<IconArrowLeft size={20} />
		</button>
		<div>
			<p class="text-[14px] font-semibold text-gray-800">Nilai Pekerja</p>
			<p class="text-[11px] text-gray-400">Kualitas, safety & ketepatan kerja</p>
		</div>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat rating & performa manpower..." />
		</div>
	{:else}
		<div class="flex-1 overflow-y-auto px-4 py-4 space-y-4">
			{#if submitted}
				<div class="bg-emerald-50 border border-emerald-200 text-emerald-700 text-[13px] rounded-lg px-3 py-2 text-center">
					✓ Penilaian tersimpan
				</div>
			{/if}

			<div class="bg-white rounded-xl border border-gray-100 p-3">
				<label class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Proyek</label>
				<select
					bind:value={selectedProjectId}
					onchange={handleProjectChange}
					class="w-full mt-1 text-[13px] px-3 py-2 rounded-lg border border-gray-200 bg-white"
				>
					{#each projects as p}
						<option value={String(p.id)}>{p.name}</option>
					{/each}
				</select>
			</div>

			<div class="bg-white rounded-xl border border-gray-100 p-3 space-y-4">
				<div>
					<label class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Pekerja</label>
					<select bind:value={selectedAssignmentId} class="w-full mt-1 text-[13px] px-3 py-2 rounded-lg border border-gray-200 bg-white">
						<option value="">-- Pilih pekerja --</option>
						{#each assignments as a}
							<option value={String(a.id)}>{a.manpower_id?.nama || '-'} — {a.jabatan || '-'}</option>
						{/each}
					</select>
				</div>

				<div>
					<p class="text-[12px] font-semibold text-gray-700 mb-1.5">Kualitas Kerja</p>
					{@render stars(kualitas, (v) => (kualitas = v))}
				</div>
				<div>
					<p class="text-[12px] font-semibold text-gray-700 mb-1.5">Kepatuhan Safety</p>
					{@render stars(safety, (v) => (safety = v))}
				</div>
				<div>
					<p class="text-[12px] font-semibold text-gray-700 mb-1.5">Ketepatan Waktu/Instruksi</p>
					{@render stars(ketepatan, (v) => (ketepatan = v))}
				</div>

				<div>
					<label class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Catatan</label>
					<textarea bind:value={catatan} rows="2" placeholder="Opsional" class="w-full mt-1 text-[13px] px-3 py-2 rounded-lg border border-gray-200"></textarea>
				</div>

				<button
					onclick={handleSubmit}
					disabled={submitting || !selectedAssignmentId || !kualitas || !safety || !ketepatan}
					class="w-full py-2.5 rounded-lg bg-[var(--g)] text-white text-[13px] font-semibold disabled:opacity-50"
				>
					{submitting ? 'Menyimpan...' : 'Simpan Penilaian'}
				</button>
			</div>
		</div>
	{/if}
</div>
