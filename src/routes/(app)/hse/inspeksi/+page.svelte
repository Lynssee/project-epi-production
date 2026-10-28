<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { fetchActiveInspectionTemplates, submitInspection, type HseInspectionTemplate } from '$lib/services/hse';
	import { IconArrowLeft } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import FormDraftBar from '$lib/components/shared/FormDraftBar.svelte';

	let templates = $state<HseInspectionTemplate[]>([]);
	let loading = $state(true);
	let saving = $state(false);
	let successMsg = $state('');
	let errorMsg = $state('');

	let selectedTemplateId = $state('');
	let lokasi = $state('');
	let temuan = $state('');
	let hasilItems = $state<{ item: string; status: 'ok' | 'tidak_ok'; catatan: string }[]>([]);

	// Draf Otomatis (Fase 5 Lapis 2): hasilItems array & status radio (bukan input/select)
	// tidak tertangkap DOM-scan Lapis 1. Scope per template checklist yang dipilih.
	interface InspeksiDraft {
		lokasi: string;
		temuan: string;
		hasilItems: { item: string; status: 'ok' | 'tidak_ok'; catatan: string }[];
	}
	let persist: ReturnType<typeof createFormPersist<InspeksiDraft>> | null = null;
	let persistScopeId = '';
	let saveTriggerCleanup: (() => void) | null = null;
	let draftRestoreInfo = $state<{ savedAt: number | null; apply: () => void; discard: () => void } | null>(null);
	let draftArmed = $state(false);

	const snapshotDraft = (): InspeksiDraft => ({ lokasi, temuan, hasilItems });

	function applyDraft(draft: InspeksiDraft) {
		if (draft.lokasi) lokasi = draft.lokasi;
		if (draft.temuan) temuan = draft.temuan;
		if (Array.isArray(draft.hasilItems) && draft.hasilItems.length === hasilItems.length) {
			hasilItems = draft.hasilItems;
		}
	}

	function checkDraft() {
		if (!persist) return;
		const draft = persist.restore();
		if (!draft) return;
		draftRestoreInfo = {
			savedAt: persist.savedAt(),
			apply: () => applyDraft(draft),
			discard: () => persist?.clear()
		};
	}

	$effect(() => {
		void lokasi;
		void temuan;
		void hasilItems;
		if (!draftArmed || !persist) return;
		persist.save(snapshotDraft());
	});

	onDestroy(() => saveTriggerCleanup?.());

	async function load() {
		loading = true;
		templates = await fetchActiveInspectionTemplates();
		loading = false;
	}

	onMount(load);

	function pickTemplate(id: string) {
		selectedTemplateId = id;
		const t = templates.find((x) => x.id === Number(id));
		hasilItems = (t?.items || []).map((i) => ({ item: i.item, status: 'ok', catatan: '' }));

		saveTriggerCleanup?.();
		draftArmed = false;
		draftRestoreInfo = null;
		persistScopeId = id;
		persist = createFormPersist<InspeksiDraft>(`hse_inspeksi_${id}`);
		saveTriggerCleanup = registerFormPersistSaveTriggers(persist, snapshotDraft);
		checkDraft();
		draftArmed = true;
	}

	async function submitForm() {
		errorMsg = ''; successMsg = '';
		if (!selectedTemplateId || !lokasi.trim()) { errorMsg = 'Pilih template dan isi lokasi.'; return; }
		saving = true;
		try {
			await submitInspection({
				template_id: Number(selectedTemplateId),
				lokasi,
				inspektur_id: $authStore.karyawanId ?? 0,
				hasil_items: hasilItems,
				temuan
			});
			successMsg = 'Hasil inspeksi tersimpan.';
			persist?.clear();
			draftRestoreInfo = null;
			selectedTemplateId = '';
			lokasi = '';
			temuan = '';
			hasilItems = [];
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal menyimpan hasil inspeksi.';
		}
		saving = false;
	}
</script>

<div class="scroll-body">
	<div class="w-full p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/hse')}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">📋 Isi Checklist Inspeksi</h1>
		</div>

		{#if errorMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>{/if}
		{#if successMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--gg); color: var(--ggd)">{successMsg}</div>{/if}

		{#if loading}
			<CircularProgressGauge size={48} strokeWidth={4} label="Memuat template inspeksi..." />
		{:else}
			<select
				value={selectedTemplateId}
				onchange={(e) => pickTemplate((e.target as HTMLSelectElement).value)}
				class="w-full rounded-lg px-3 py-2 text-[13px] mb-2"
				style="background: var(--sys-fill); border: 1px solid var(--sys-sep)"
			>
				<option value="">Pilih template checklist</option>
				{#each templates as t (t.id)}
					<option value={t.id}>{t.nama_template}</option>
				{/each}
			</select>

			<input
				bind:value={lokasi}
				placeholder="Lokasi"
				class="w-full rounded-lg px-3 py-2 text-[13px] mb-3"
				style="background: var(--sys-fill); border: 1px solid var(--sys-sep)"
			/>

			{#if hasilItems.length > 0}
				<FormDraftBar
					restoreInfo={draftRestoreInfo}
					onApplied={() => (draftRestoreInfo = null)}
				/>
				<div class="space-y-2 mb-3">
					{#each hasilItems as ri, i}
						<div class="rounded-lg p-2.5" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
							<p class="text-[12px] mb-1.5" style="color: var(--sys-label)">{ri.item}</p>
							<div class="flex items-center gap-3 mb-1.5">
								<label class="text-[11px] flex items-center gap-1" style="color: var(--sys-label)">
									<input type="radio" name="ins-status-{i}" checked={ri.status === 'ok'} onclick={() => (ri.status = 'ok')} /> OK
								</label>
								<label class="text-[11px] flex items-center gap-1" style="color: var(--sys-label)">
									<input type="radio" name="ins-status-{i}" checked={ri.status === 'tidak_ok'} onclick={() => (ri.status = 'tidak_ok')} /> Tidak OK
								</label>
							</div>
							<input bind:value={ri.catatan} placeholder="Catatan (opsional)" class="w-full rounded px-2 py-1 text-[11px]" style="background: var(--sys-bg); border: 1px solid var(--sys-sep)" />
						</div>
					{/each}
				</div>

				<textarea
					rows="2"
					bind:value={temuan}
					placeholder="Temuan / tindak lanjut (opsional)"
					class="w-full rounded-lg px-3 py-2 text-[13px] mb-3"
					style="background: var(--sys-fill); border: 1px solid var(--sys-sep)"
				></textarea>

				<button
					class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-50"
					style="background: var(--g)"
					disabled={saving}
					onclick={submitForm}
				>
					{saving ? 'Menyimpan…' : 'Simpan Hasil Inspeksi'}
				</button>
			{/if}
		{/if}
	</div>
</div>
