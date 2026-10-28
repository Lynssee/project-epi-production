<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import { authStore } from '$lib/stores/auth';
	import { getProjectById } from '$lib/services/projects';
	import { listProjectHseDocs, createProjectHseDoc, type ProjectHseDoc } from '$lib/services/hse';
	import { IconArrowLeft, IconLoader2, IconPlus, IconPhone } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import FormDraftBar from '$lib/components/shared/FormDraftBar.svelte';

	const TIPE_LABELS: Record<string, string> = {
		induksi: 'Induksi Pekerja Baru',
		erp: 'Rencana Tanggap Darurat (ERP)',
		method_statement: 'Method Statement',
		checklist: 'Checklist HSE Proyek'
	};

	let projectId = $derived($page.params.project_id as string);
	let loading = $state(true);
	let project = $state<any>(null);
	let docs = $state<ProjectHseDoc[]>([]);

	let erpDoc = $derived(docs.find((d) => d.tipe === 'erp' && d.status === 'aktif') || null);

	let showCreateForm = $state(false);
	let formTipe = $state('induksi');
	let formJudul = $state('');
	let formErp = $state({ assembly_point: '', rs_terdekat: '', nomor_darurat: '' });
	let formFreeText = $state(''); // induksi materi / method_statement langkah / checklist items (satu per baris)
	let creating = $state(false);

	// Draf Otomatis (Fase 5 Lapis 2): field form tanpa name/id DOM, tidak tertangkap Lapis 1.
	// Scope per proyek -- dokumen HSE dibuat per-proyek, bukan per-record (form selalu baru).
	interface HseDokDraft {
		formTipe: string;
		formJudul: string;
		formErp: typeof formErp;
		formFreeText: string;
	}
	let persist: ReturnType<typeof createFormPersist<HseDokDraft>> | null = null;
	let draftRestoreInfo = $state<{ savedAt: number | null; apply: () => void; discard: () => void } | null>(null);
	let draftArmed = $state(false);
	let saveTriggerCleanup: (() => void) | null = null;

	const snapshotDraft = (): HseDokDraft => ({ formTipe, formJudul, formErp, formFreeText });

	function applyDraft(draft: HseDokDraft) {
		if (draft.formTipe) formTipe = draft.formTipe;
		if (draft.formJudul) formJudul = draft.formJudul;
		if (draft.formErp) formErp = { ...formErp, ...draft.formErp };
		if (draft.formFreeText) formFreeText = draft.formFreeText;
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
		void formTipe;
		void formJudul;
		void formErp;
		void formFreeText;
		if (!draftArmed || !persist) return;
		persist.save(snapshotDraft());
	});

	onDestroy(() => saveTriggerCleanup?.());

	async function load() {
		loading = true;
		try {
			project = await getProjectById(projectId);
			docs = await listProjectHseDocs(projectId);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		load();
		persist = createFormPersist<HseDokDraft>(`hse_dok_${projectId}`);
		saveTriggerCleanup = registerFormPersistSaveTriggers(persist, snapshotDraft);
	});

	function openCreate() {
		showCreateForm = true;
		formTipe = 'induksi';
		formJudul = '';
		formErp = { assembly_point: '', rs_terdekat: '', nomor_darurat: '' };
		formFreeText = '';
		draftArmed = false;
		draftRestoreInfo = null;
		checkDraft();
		draftArmed = true;
	}

	async function submitCreate() {
		if (!formJudul.trim()) {
			alert('Judul dokumen wajib diisi.');
			return;
		}
		creating = true;
		try {
			const auth = get(authStore);
			let payload: Record<string, any> = {};
			if (formTipe === 'erp') {
				payload = { ...formErp };
			} else if (formTipe === 'induksi') {
				payload = { materi: formFreeText.split('\n').map((s) => s.trim()).filter(Boolean) };
			} else if (formTipe === 'method_statement') {
				payload = { langkah: formFreeText.split('\n').map((s) => s.trim()).filter(Boolean) };
			} else {
				payload = { items: formFreeText.split('\n').map((s) => s.trim()).filter(Boolean) };
			}

			await createProjectHseDoc({
				project_id: projectId,
				tipe: formTipe,
				judul: formJudul.trim(),
				payload,
				dibuat_oleh: auth.karyawanName || auth.user?.displayName || auth.user?.email || 'Project Leader'
			});
			persist?.clear();
			draftRestoreInfo = null;
			showCreateForm = false;
			await load();
		} catch (e: any) {
			alert(e?.message || 'Gagal menyimpan dokumen');
		} finally {
			creating = false;
		}
	}

	function formatDate(d: string | null | undefined) {
		if (!d) return '-';
		try {
			return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(d));
		} catch {
			return d;
		}
	}
</script>

<div class="flex-1 flex flex-col h-full">
	<div class="px-4 pt-4 max-w-4xl mx-auto w-full">
		<button
			type="button"
			onclick={() => (showCreateForm ? (showCreateForm = false) : goto(`/proyek/${projectId}`))}
			class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition-colors mb-2"
		>
			<IconArrowLeft size={16} />
			<span>{showCreateForm ? 'Kembali ke Dokumen HSE' : 'Kembali ke Detail Proyek'}</span>
		</button>
		<h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">Dokumen HSE Proyek #{projectId}</h2>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16" style="background: var(--sys-bg)">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat dokumen HSE proyek..." />
		</div>
	{:else if showCreateForm}
		<div class="scroll-body px-4 py-4 flex flex-col gap-3" style="background: var(--sys-bg)">
			<div class="card-section">
				<h4 class="text-[13px] font-semibold mb-3" style="color: var(--sys-label)">Dokumen HSE Baru</h4>

				<FormDraftBar
					restoreInfo={draftRestoreInfo}
					onApplied={() => (draftRestoreInfo = null)}
				/>

				<label class="block text-[11px] font-semibold mb-1" style="color: var(--sys-label3)">Jenis Dokumen</label>
				<select bind:value={formTipe} class="w-full border rounded-lg px-3 py-2 text-[13px] mb-3" style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)">
					{#each Object.entries(TIPE_LABELS) as [value, label]}
						<option {value}>{label}</option>
					{/each}
				</select>

				<label class="block text-[11px] font-semibold mb-1" style="color: var(--sys-label3)">Judul</label>
				<input bind:value={formJudul} class="w-full border rounded-lg px-3 py-2 text-[13px] mb-3" style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)" />

				{#if formTipe === 'erp'}
					<label class="block text-[11px] font-semibold mb-1" style="color: var(--sys-label3)">Assembly Point</label>
					<input bind:value={formErp.assembly_point} class="w-full border rounded-lg px-3 py-2 text-[13px] mb-3" style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)" />
					<label class="block text-[11px] font-semibold mb-1" style="color: var(--sys-label3)">Rumah Sakit Terdekat</label>
					<input bind:value={formErp.rs_terdekat} class="w-full border rounded-lg px-3 py-2 text-[13px] mb-3" style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)" />
					<label class="block text-[11px] font-semibold mb-1" style="color: var(--sys-label3)">Nomor Darurat</label>
					<input bind:value={formErp.nomor_darurat} class="w-full border rounded-lg px-3 py-2 text-[13px]" style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)" />
				{:else}
					<label class="block text-[11px] font-semibold mb-1" style="color: var(--sys-label3)">
						{formTipe === 'induksi' ? 'Materi Induksi (satu per baris)' : formTipe === 'method_statement' ? 'Langkah Kerja (satu per baris)' : 'Item Checklist (satu per baris)'}
					</label>
					<textarea bind:value={formFreeText} rows="6" class="w-full border rounded-lg px-3 py-2 text-[13px]" style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)"></textarea>
				{/if}

				<button
					class="w-full py-3 rounded-xl text-[14px] font-semibold text-white disabled:opacity-50 mt-4"
					style="background: var(--g)"
					disabled={creating}
					onclick={submitCreate}
				>
					{creating ? 'Menyimpan...' : 'Simpan Dokumen'}
				</button>
			</div>
		</div>
	{:else}
		<div class="scroll-body px-4 py-4 flex flex-col gap-3" style="background: var(--sys-bg)">
			{#if erpDoc}
				<!-- Mode "baca cepat" ERP — satu layar tanpa scroll untuk kondisi darurat -->
				<div class="card-section" style="border: 2px solid var(--re)">
					<div class="flex items-center gap-2 mb-2">
						<IconPhone size={18} style="color: var(--re)" />
						<p class="text-[14px] font-bold" style="color: var(--re)">DARURAT — {erpDoc.judul}</p>
					</div>
					<p class="text-[13px] mb-1"><b>Assembly Point:</b> {erpDoc.payload?.assembly_point || '-'}</p>
					<p class="text-[13px] mb-1"><b>RS Terdekat:</b> {erpDoc.payload?.rs_terdekat || '-'}</p>
					<p class="text-[13px]"><b>Nomor Darurat:</b> {erpDoc.payload?.nomor_darurat || '-'}</p>
				</div>
			{/if}

			<button
				class="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-semibold text-white"
				style="background: var(--g)"
				onclick={openCreate}
			>
				<IconPlus size={18} /> Tambah Dokumen HSE
			</button>

			{#if docs.length === 0}
				<div class="card-section text-center py-8">
					<div class="text-4xl mb-2">📄</div>
					<p class="text-[13px]" style="color: var(--sys-label3)">Belum ada dokumen HSE untuk proyek ini.</p>
				</div>
			{:else}
				{#each docs as doc (doc.id)}
					<div class="card-section">
						<div class="flex items-center justify-between mb-1">
							<p class="text-[13px] font-semibold" style="color: var(--sys-label)">{doc.judul}</p>
							<span class="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style="background: var(--sys-fill); color: var(--sys-label3)">{TIPE_LABELS[doc.tipe] || doc.tipe}</span>
						</div>
						<p class="text-[11px]" style="color: var(--sys-label3)">Dibuat {formatDate(doc.date_created)} oleh {doc.dibuat_oleh || '-'}</p>
					</div>
				{/each}
			{/if}
		</div>
	{/if}
</div>
