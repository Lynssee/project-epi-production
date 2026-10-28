<!-- src/routes/(app)/proyek/[project_id]/itp/[itp_id]/+page.svelte -->
<!-- Runner ITP: centang+foto per item (Quality Management Proyek v2, Fase 3 — 10 Agustus 2026). -->
<!-- Hold point = WARNING + wajib isi justifikasi, TIDAK memblokir item lain (keputusan user). -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { fetchItpDetail, uploadItpPhoto, checkItem, uncheckItem, updateItpStatus } from '$lib/services/projectItpApi';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { IconArrowLeft, IconLoader2, IconCamera } from '@tabler/icons-svelte';

	let projectId = $derived($page.params.project_id as string);
	let itpId = $derived($page.params.itp_id as string);
	let loading = $state(true);
	let itp = $state<any>(null);
	let executions = $state<any[]>([]);

	let holdPointModalItem = $state<any>(null);
	let holdPointNote = $state('');
	let pendingPhoto = $state<File | null>(null);

	async function load() {
		loading = true;
		try {
			const { itp: itpData, executions: exs } = await fetchItpDetail(Number(itpId));
			itp = itpData;
			executions = exs;
		} finally {
			loading = false;
		}
	}

	onMount(load);

	let doneCount = $derived(executions.filter((e) => e.checked).length);

	async function toggleCheck(exec: any, file: File | null) {
		if (exec.checked) {
			await uncheckItem(exec.id);
			await load();
			return;
		}
		if (exec.template_item_id?.require_photo && !file) {
			return; // foto wajib -- tombol kamera yang memicu check untuk item ini, bukan checkbox
		}
		if (exec.template_item_id?.is_hold_point) {
			holdPointModalItem = exec;
			holdPointNote = '';
			pendingPhoto = file;
			return;
		}
		await doCheck(exec, file, undefined);
	}

	async function doCheck(exec: any, file: File | null | undefined, justification: string | undefined) {
		let photoFileId: string | null = null;
		if (file) photoFileId = await uploadItpPhoto(await compressPhoto(file));
		await checkItem({
			executionId: exec.id,
			checkedById: $authStore.karyawanId,
			photoFileId,
			holdPointJustification: justification
		});
		if (itp?.status === 'assigned') await updateItpStatus(itp.id, 'in_progress');
		await load();
		if (executions.every((e) => e.checked)) {
			await updateItpStatus(Number(itpId), 'completed');
			await load();
		}
	}

	async function confirmHoldPoint() {
		if (!holdPointNote.trim()) return;
		const exec = holdPointModalItem;
		holdPointModalItem = null;
		await doCheck(exec, pendingPhoto, holdPointNote.trim());
		pendingPhoto = null;
	}
</script>

<div class="mx-auto max-w-lg p-4 pb-24">
	<button class="mb-3 flex items-center gap-1 text-sm text-gray-500" onclick={() => goto(`/proyek/${projectId}/itp`)}>
		<IconArrowLeft size={16} /> Kembali
	</button>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-14">
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat rincian checklist ITP..." />
	</div>
	{:else if itp}
		<h1 class="text-lg font-bold text-gray-900">{itp.template_id?.name || '-'}</h1>
		<p class="mb-1 text-sm text-gray-500">{itp.project_id?.name || '-'}</p>
		<p class="mb-4 text-xs text-gray-400">{doneCount} / {executions.length} item selesai</p>

		<div class="space-y-2">
			{#each executions as exec (exec.id)}
				<div class="rounded-lg border border-gray-100 bg-white p-3 text-sm">
					<label class="flex items-start gap-2">
						<input
							type="checkbox"
							checked={exec.checked}
							disabled={!exec.checked && exec.template_item_id?.require_photo}
							onchange={() => toggleCheck(exec, null)}
							class="mt-0.5"
						/>
						<span class="flex-1">
							{exec.template_item_id?.label}
							{#if exec.template_item_id?.is_hold_point}
								<span class="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">HOLD POINT</span>
							{/if}
							{#if exec.checked && exec.hold_point_justification}
								<div class="mt-1 rounded bg-amber-50 p-1.5 text-[11px] text-amber-700">Justifikasi: {exec.hold_point_justification}</div>
							{/if}
						</span>
					</label>
					{#if exec.template_item_id?.require_photo && !exec.checked}
						<label class="mt-2 ml-6 flex w-fit cursor-pointer items-center gap-1 rounded-lg border border-dashed border-blue-300 px-2 py-1 text-[11px] text-blue-600">
							<IconCamera size={14} /> Ambil Foto & Centang
							<input
								type="file"
								accept="image/*"
								capture="environment"
								class="hidden"
								onchange={(e) => toggleCheck(exec, (e.target as HTMLInputElement).files?.[0] || null)}
							/>
						</label>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

{#if holdPointModalItem}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onclick={(e) => e.target === e.currentTarget && (holdPointModalItem = null)}>
		<div class="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
			<h3 class="mb-2 flex items-center gap-1 font-bold text-red-700">⚠️ Hold Point</h3>
			<p class="mb-3 text-sm text-gray-600">"{holdPointModalItem.template_item_id?.label}" adalah hold point — wajib isi justifikasi sebelum lanjut, meski tidak memblokir item lain.</p>
			<textarea class="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" rows="3" placeholder="Justifikasi (wajib)" bind:value={holdPointNote}></textarea>
			<div class="mt-3 flex gap-2">
				<button class="flex-1 rounded-lg bg-red-600 py-2 text-xs font-bold text-white disabled:opacity-60" disabled={!holdPointNote.trim()} onclick={confirmHoldPoint}>
					Konfirmasi & Centang
				</button>
				<button class="px-3 py-2 text-xs text-gray-400" onclick={() => (holdPointModalItem = null)}>Batal</button>
			</div>
		</div>
	</div>
{/if}
