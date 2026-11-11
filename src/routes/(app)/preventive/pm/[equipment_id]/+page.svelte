<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getEquipmentById, getDuePmTasks, selesaikanPmTask } from '$lib/services/preventive';
	import { preparePhotoForUpload, sendPreparedPhoto, p2hPhotoFileName, P2hPhotoCompressFailed, tandaiKonteksFoto } from '$lib/utils/p2hPhotoUpload';
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
	let infoMsg = $state('');
	// PMT-51: temuan -> catatan + foto wajib; tanpa temuan cukup tombol selesai.
	let adaTemuan = $state(false);
	let catatan = $state('');
	let fotoId = $state<string | null>(null);
	let fotoUploading = $state(false);
	let fotoMsg = $state('');

	function resetForm() {
		activeTaskId = null;
		hoursmeterInput = null;
		adaTemuan = false;
		catatan = '';
		fotoId = null;
		fotoMsg = '';
	}

	/** Butir pemeriksaan dari template (bagian sebelum/saat/setelah) — panduan baca-saja untuk mekanik. */
	function butirTemplate(t: any): string[] {
		try {
			const d = typeof t?.template?.checklist_details === 'string' ? JSON.parse(t.template.checklist_details) : t?.template?.checklist_details;
			return ['sebelum', 'saat', 'setelah'].flatMap((k) => (Array.isArray(d?.[k]) ? d[k] : [])).map((i: any) => String(i?.text || '')).filter(Boolean);
		} catch {
			return [];
		}
	}

	async function onFoto(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		fotoMsg = '';
		fotoUploading = true;
		try {
			tandaiKonteksFoto(file, 'pm');
			const prepared = await preparePhotoForUpload(file, 'compress');
			fotoId = await sendPreparedPhoto(prepared, p2hPhotoFileName(equipment?.code || equipmentId, 'pm', prepared), 'compress');
		} catch (err: any) {
			console.error('[PM] unggah foto temuan gagal:', err);
			fotoMsg = err instanceof P2hPhotoCompressFailed ? 'Foto gagal diperkecil di HP ini. Turunkan resolusi kamera lalu foto ulang.' : err?.message || 'Gagal mengunggah foto.';
		} finally {
			fotoUploading = false;
			input.value = '';
		}
	}

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
		errorMsg = '';
		infoMsg = '';
		if (adaTemuan && !catatan.trim()) {
			errorMsg = 'Jelaskan temuan pada catatan.';
			return;
		}
		if (adaTemuan && !fotoId) {
			errorMsg = 'Foto temuan wajib dilampirkan bila ada temuan.';
			return;
		}
		submitting = true;
		try {
			const r = await selesaikanPmTask({ trackerId: taskId, adaTemuan, catatan: catatan.trim(), fotoId, hoursmeter: hoursmeterInput });
			if ('queued' in r) {
				infoMsg = 'Tersimpan di HP dan akan terkirim saat sinyal kembali.';
			} else {
				infoMsg = r.berikutnya ? `PM selesai. Jatuh tempo berikutnya: ${r.berikutnya}.` : 'PM selesai.';
				if (r.workOrderId) infoMsg += ' Temuan dilaporkan ke Maintenance sebagai Work Order.';
			}
			resetForm();
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
			<p class="text-[12px] mb-3" style="color: #DC2626" role="alert">{errorMsg}</p>
		{/if}
		{#if infoMsg}
			<p class="text-[12px] mb-3 rounded-lg p-2" style="background:var(--gl); color:var(--g)" role="status">✓ {infoMsg}</p>
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
								{#if butirTemplate(t).length}
									<div class="rounded-lg p-2.5 text-[11px]" style="background:var(--sys-fill); color:var(--sys-label2)">
										<p class="font-semibold mb-1">Periksa sebelum menandai selesai:</p>
										<ul class="list-disc pl-4 space-y-0.5">{#each butirTemplate(t) as b}<li>{b}</li>{/each}</ul>
									</div>
								{/if}
								<label class="flex items-center gap-2 text-[12px]" style="color: var(--sys-label)">
									<input type="checkbox" bind:checked={adaTemuan} /> Ada temuan (kerusakan / ketidaknormalan)
								</label>
								{#if adaTemuan}
									<textarea
										class="w-full rounded-lg border text-[12px] p-2"
										style="border-color: var(--sys-sep)"
										rows="2"
										placeholder="Jelaskan temuan (wajib)"
										bind:value={catatan}
									></textarea>
									<input type="file" accept="image/*" capture="environment" class="text-[11px]" disabled={fotoUploading} onchange={onFoto} />
									{#if fotoUploading}<p class="text-[11px] animate-pulse" style="color: var(--sys-label3)">Mengunggah foto…</p>{:else if fotoId}<p class="text-[11px]" style="color:#16A34A">✓ Foto temuan terlampir.</p>{/if}
									{#if fotoMsg}<p class="text-[11px]" style="color:#DC2626" role="alert">{fotoMsg}</p>{/if}
									<p class="text-[10px]" style="color: var(--sys-label3)">Temuan otomatis dilaporkan ke Maintenance (Work Order). Foto wajib hanya bila ada temuan.</p>
								{:else}
									<p class="text-[10px]" style="color: var(--sys-label3)">Tanpa temuan, cukup tekan Tandai Selesai. Jatuh tempo berikutnya dihitung dari hari ini.</p>
								{/if}
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
										onclick={resetForm}
									>
										Batal
									</button>
									<button
										class="flex-1 h-10 rounded-lg text-[12px] font-bold text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
										style="background: var(--g)"
										disabled={submitting || fotoUploading}
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
