<!-- src/lib/components/procurement/LampiranMobile.svelte
     Rencana Lampiran Otomatis PR v2 (27 Agu 2026, Fase 5 — Dashboard Lapangan).
     Untuk satu PR yang SUDAH dibuat: tampilkan ceklist lampiran kategori + unggah
     foto (dikompres otomatis) untuk tiap jenis. TANPA "Tarik Data" (admin saja) &
     TANPA pengecualian (approver/atasan di dashboard internal). Non-blocking. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { getPengajuanLampiran, uploadLampiranFoto, type LampiranChecklistItem } from '$lib/services/attachmentApi';
	import { IconCamera, IconCircleCheck, IconLoader2, IconAlertTriangle } from '@tabler/icons-svelte';

	let {
		pengajuanId,
		onchanged = null
	}: { pengajuanId: number | string; onchanged?: (() => void) | null } = $props();

	let loading = $state(true);
	let errorMsg = $state('');
	let checklist = $state<LampiranChecklistItem[]>([]);
	let busyType = $state<number | null>(null);
	let fileInputs: Record<number, HTMLInputElement | null> = {};

	let requiredItems = $derived(checklist.filter((c) => c.is_required));
	let requiredDone = $derived(requiredItems.filter((c) => c.fulfilled).length);

	$effect(() => {
		if (pengajuanId) load();
	});

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			checklist = await getPengajuanLampiran(pengajuanId);
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat lampiran';
			checklist = [];
		} finally {
			loading = false;
		}
	}

	function pick(typeId: number) {
		fileInputs[typeId]?.click();
	}

	async function onFile(e: Event, c: LampiranChecklistItem) {
		const file = (e.target as HTMLInputElement)?.files?.[0];
		if (!file) return;
		busyType = c.attachment_type_id;
		try {
			await uploadLampiranFoto(pengajuanId, c.attachment_type_id, file);
			await load();
			onchanged?.();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal unggah';
		} finally {
			busyType = null;
			if (fileInputs[c.attachment_type_id]) fileInputs[c.attachment_type_id]!.value = '';
		}
	}
</script>

<div class="rounded-xl border p-3" style="border-color: var(--sys-separator)">
	<div class="flex items-center justify-between mb-2">
		<p class="text-sm font-bold" style="color: var(--sys-label)">Lampiran Pendukung</p>
		{#if requiredItems.length > 0}
			<span
				class="text-[11px] font-semibold px-2 py-0.5 rounded-full {requiredDone === requiredItems.length
					? 'bg-green-100 text-green-700'
					: 'bg-amber-100 text-amber-700'}"
			>
				{requiredDone}/{requiredItems.length} wajib
			</span>
		{/if}
	</div>

	{#if loading}
		<CircularProgressGauge size={42} strokeWidth={3} label="Memuat lampiran pengadaan..." />
	{:else if errorMsg}
		<p class="text-xs py-3 text-rose-600 flex items-center gap-1">
			<IconAlertTriangle size={14} /> {errorMsg}
		</p>
	{:else if checklist.length === 0}
		<p class="text-xs py-3" style="color: var(--sys-label3)">
			Kategori PR ini belum punya aturan lampiran.
		</p>
	{:else}
		<ul class="space-y-2">
			{#each checklist as c (c.attachment_type_id)}
				<li class="flex items-start gap-2">
					<span class="mt-0.5">
						{#if c.fulfilled}
							<IconCircleCheck size={16} class="text-green-600" />
						{:else}
							<span class="inline-block w-4 h-4 rounded border" style="border-color: var(--sys-label3)"></span>
						{/if}
					</span>
					<div class="flex-1 min-w-0">
						<p class="text-sm" style="color: var(--sys-label)">
							{c.label || 'Lampiran'}
							{#if c.is_required}<span class="text-[11px] text-rose-600 font-semibold"> · wajib</span>{/if}
						</p>
						{#if c.deskripsi}
							<p class="text-[11px]" style="color: var(--sys-label3)">{c.deskripsi}</p>
						{/if}
						{#if c.lampiran?.status === 'dikecualikan'}
							<p class="text-[11px] text-amber-700">Dikecualikan oleh {c.lampiran.exception_by || 'admin'}</p>
						{:else if c.lampiran?.status === 'completed'}
							<p class="text-[11px]" style="color: var(--sys-label3)">
								{c.lampiran.source_type === 'auto_pull' ? 'Ditarik sistem' : 'Terunggah'}
							</p>
						{/if}
					</div>
					<input
						type="file"
						accept="image/*"
						capture="environment"
						class="hidden"
						bind:this={fileInputs[c.attachment_type_id]}
						onchange={(e) => onFile(e, c)}
					/>
					<button
						type="button"
						class="shrink-0 text-xs px-2.5 py-1.5 rounded-lg border flex items-center gap-1 disabled:opacity-50"
						style="border-color: var(--sys-separator); color: var(--sys-label)"
						disabled={busyType === c.attachment_type_id}
						onclick={() => pick(c.attachment_type_id)}
					>
						{#if busyType === c.attachment_type_id}
							<IconLoader2 size={13} class="animate-spin" />
						{:else}
							<IconCamera size={13} />
						{/if}
						{c.fulfilled ? 'Ganti' : 'Foto'}
					</button>
				</li>
			{/each}
		</ul>
		<p class="text-[11px] mt-2 pt-2 border-t" style="color: var(--sys-label3); border-color: var(--sys-separator)">
			Foto dikompres otomatis. Belum lengkap tidak menahan pengiriman — kelengkapan
			dikejar sebelum tahap persetujuan di dashboard admin.
		</p>
	{/if}
</div>
