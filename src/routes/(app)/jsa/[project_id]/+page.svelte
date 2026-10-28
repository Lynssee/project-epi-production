<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { authStore } from '$lib/stores/auth';
	import { getProjectById } from '$lib/services/projects';
	import {
		listActiveTemplates,
		listJsaByProject,
		listJsaSteps,
		createJsaFromTemplate,
		updateJsaStep,
		ajukanJsa,
		uploadJsaFoto,
		type JsaTemplate,
		type JsaProject,
		type JsaStep
	} from '$lib/services/jsa';
	import SignaturePad from '$lib/components/shared/SignaturePad.svelte';
	import { createFormPersist } from '$lib/utils/formPersist';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { IconArrowLeft, IconLoader2, IconPlus, IconCheck } from '@tabler/icons-svelte';

	const WORK_TYPE_LABELS: Record<string, string> = {
		sandblasting: 'Sandblasting',
		coating: 'Protective / Floor Coating',
		ketinggian: 'Pekerjaan Ketinggian',
		ruang_terbatas: 'Ruang Terbatas',
		panas: 'Pekerjaan Panas',
		listrik: 'Pekerjaan Listrik',
		galian: 'Galian',
		angkat_angkut: 'Angkat-Angkut',
		umum: 'Umum'
	};

	const STATUS_LABELS: Record<string, { text: string; bg: string; fg: string }> = {
		draft: { text: 'Draft', bg: 'var(--sys-fill)', fg: 'var(--sys-label3)' },
		diajukan: { text: 'Menunggu Persetujuan', bg: 'var(--pl)', fg: 'var(--pd)' },
		disetujui: { text: 'Disetujui', bg: 'var(--gl)', fg: 'var(--gd)' },
		ditolak: { text: 'Ditolak', bg: 'var(--rel)', fg: 'var(--re)' },
		kedaluwarsa: { text: 'Kedaluwarsa', bg: 'var(--rel)', fg: 'var(--re)' }
	};

	let projectId = $derived($page.params.project_id as string);
	let loading = $state(true);
	let project = $state<any>(null);
	let jsaList = $state<JsaProject[]>([]);

	// Detail view state
	let selectedJsa = $state<JsaProject | null>(null);
	let selectedSteps = $state<JsaStep[]>([]);
	let stepsLoading = $state(false);
	let signPad = $state<any>(null);
	let fotoFile = $state<File | null>(null);
	let submitting = $state(false);

	// Create-new flow state
	let showCreateForm = $state(false);
	let templates = $state<JsaTemplate[]>([]);
	let templatesLoading = $state(false);
	let formWorkType = $state('');
	let formTemplateId = $state<number | null>(null);
	let formAktivitas = $state('');
	let formBerlakuDari = $state(new Date().toISOString().slice(0, 10));
	let formBerlakuSampai = $state('');
	let creating = $state(false);

	let projectWorkTypes = $derived(
		(Array.isArray(project?.hse_work_types) ? project.hse_work_types : []) as string[]
	);

	async function load() {
		loading = true;
		try {
			project = await getProjectById(projectId);
			jsaList = await listJsaByProject(projectId);
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function openCreateForm() {
		showCreateForm = true;
		selectedJsa = null;
		formWorkType = projectWorkTypes[0] || '';
		formTemplateId = null;
		formAktivitas = '';
		formBerlakuDari = new Date().toISOString().slice(0, 10);
		formBerlakuSampai = '';
		await loadTemplatesForWorkType();
	}

	async function loadTemplatesForWorkType() {
		templatesLoading = true;
		try {
			templates = await listActiveTemplates(formWorkType || undefined);
			formTemplateId = templates[0]?.id || null;
		} finally {
			templatesLoading = false;
		}
	}

	async function submitCreate() {
		if (!formTemplateId) {
			alert('Pilih template JSA terlebih dahulu.');
			return;
		}
		if (!formAktivitas.trim()) {
			alert('Nama aktivitas wajib diisi.');
			return;
		}
		if (!formBerlakuSampai) {
			alert('Tanggal berlaku sampai wajib diisi.');
			return;
		}
		creating = true;
		try {
			const auth = get(authStore);
			const created = await createJsaFromTemplate({
				projectId,
				templateId: formTemplateId,
				aktivitas: formAktivitas.trim(),
				berlakuDari: formBerlakuDari,
				berlakuSampai: formBerlakuSampai,
				dibuatOleh: auth.karyawanName || auth.user?.displayName || auth.user?.email || 'Project Leader'
			});
			showCreateForm = false;
			await load();
			await openDetail(created as unknown as JsaProject);
		} catch (e: any) {
			alert(e?.message || 'Gagal membuat JSA');
		} finally {
			creating = false;
		}
	}

	// Jaring pengaman draf khusus FOTO. Langkah-langkah JSA sudah tersimpan ke server
	// satu per satu lewat saveStep(), dan tanda tangan sengaja tidak disimpan (langkah
	// terakhir, murah diulang — kebijakan yang sama seperti P2H). Yang benar-benar
	// hilang saat tab dibunuh OS cuma foto kondisi lapangan, dan itu menuntut petugas
	// kembali ke lokasi. Dikunci per JSA.
	const JSA_PHOTO_KEY = 'kondisi';
	let jsaPersist = $derived(
		createFormPersist<Record<string, never>>(`jsa_foto_${selectedJsa?.id ?? 'none'}`)
	);

	async function openDetail(jsa: JsaProject) {
		selectedJsa = jsa;
		showCreateForm = false;
		fotoFile = null;
		stepsLoading = true;
		try {
			selectedSteps = await listJsaSteps(jsa.id);
			// Pulihkan foto yang sempat diambil untuk JSA ini tapi belum terkirim.
			const blob = await createFormPersist<Record<string, never>>(
				`jsa_foto_${jsa.id}`
			).restorePhoto(JSA_PHOTO_KEY);
			if (blob) fotoFile = new File([blob], 'kondisi.jpg', { type: blob.type || 'image/jpeg' });
		} finally {
			stepsLoading = false;
		}
	}

	function closeDetail() {
		selectedJsa = null;
		selectedSteps = [];
	}

	function handleBack() {
		if (selectedJsa) {
			closeDetail();
		} else if (showCreateForm) {
			showCreateForm = false;
		} else {
			goto(`/proyek/${projectId}`);
		}
	}

	async function saveStep(step: JsaStep) {
		await updateJsaStep(step.id, {
			langkah_kerja: step.langkah_kerja,
			bahaya: step.bahaya,
			likelihood: step.likelihood,
			severity: step.severity,
			pengendalian: step.pengendalian,
			risiko_sisa_likelihood: step.risiko_sisa_likelihood,
			risiko_sisa_severity: step.risiko_sisa_severity,
			apd: step.apd
		});
	}

	function apdText(step: JsaStep) {
		return Array.isArray(step.apd) ? step.apd.join(', ') : '';
	}
	function setApdFromText(step: JsaStep, text: string) {
		step.apd = text.split(',').map((s) => s.trim()).filter(Boolean);
	}

	function handleFotoChange(e: Event) {
		const input = e.target as HTMLInputElement;
		fotoFile = input.files?.[0] || null;
		if (fotoFile) jsaPersist.savePhoto(JSA_PHOTO_KEY, fotoFile);
	}

	async function submitAjukan() {
		if (!selectedJsa) return;
		if (!signPad || signPad.isEmpty()) {
			alert('Tanda tangan wajib diisi sebelum mengajukan JSA.');
			return;
		}
		submitting = true;
		try {
			// Simpan dulu semua perubahan langkah yang belum tersimpan.
			for (const s of selectedSteps) await saveStep(s);

			let fotoFileId: string | null = null;
			if (fotoFile) fotoFileId = await uploadJsaFoto(await compressPhoto(fotoFile));

			await ajukanJsa(selectedJsa.id, { ttdDataUrl: signPad.toDataURL(), fotoFileId });
			// Terkirim — foto draf di IndexedDB sudah tidak relevan.
			await jsaPersist.clearPhotos();
			alert('JSA berhasil diajukan untuk persetujuan.');
			closeDetail();
			await load();
		} catch (e: any) {
			alert(e?.message || 'Gagal mengajukan JSA');
		} finally {
			submitting = false;
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
			onclick={handleBack}
			class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition-colors mb-2"
		>
			<IconArrowLeft size={16} />
			<span>{selectedJsa || showCreateForm ? 'Kembali ke Daftar JSA' : 'Kembali ke Detail Proyek'}</span>
		</button>
		<h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">Job Safety Analysis (JSA) — {project?.name || `Proyek #${projectId}`}</h2>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat rincian JSA proyek..." />
		</div>
	{:else if selectedJsa}
		{@const s = STATUS_LABELS[selectedJsa.status] || STATUS_LABELS.draft}
		<!-- ══════════ DETAIL / EDIT JSA ══════════ -->
		<div class="scroll-body px-4 py-4 flex flex-col gap-3" style="background: var(--sys-bg)">
			<div class="card-section">
				<div class="flex items-center justify-between mb-1">
					<p class="text-[15px] font-bold" style="color: var(--sys-label)">{selectedJsa.aktivitas}</p>
					<span class="text-[11px] font-bold px-2 py-1 rounded-full" style="background: {s.bg}; color: {s.fg}">{s.text}</span>
				</div>
				<p class="text-[12px]" style="color: var(--sys-label3)">
					Berlaku {formatDate(selectedJsa.berlaku_dari)} — {formatDate(selectedJsa.berlaku_sampai)}
				</p>
				{#if selectedJsa.status === 'ditolak' && selectedJsa.catatan_approval}
					<p class="text-[12px] mt-2 text-red-600">Alasan ditolak: {selectedJsa.catatan_approval}</p>
				{/if}
			</div>

			{#if stepsLoading}
				<div class="text-center py-8"><IconLoader2 size={22} class="animate-spin" style="color: var(--g)" /></div>
			{:else}
				<div class="card-section">
					<h4 class="text-[13px] font-semibold mb-3" style="color: var(--sys-label)">Langkah Kerja &amp; Penilaian Risiko</h4>
					<div class="flex flex-col gap-3">
						{#each selectedSteps as step (step.id)}
							<div class="border rounded-lg p-3" style="border-color: var(--sys-sep)">
								<p class="text-[11px] font-bold mb-1.5" style="color: var(--sys-label3)">Langkah {step.urutan}</p>
								{#if selectedJsa.status === 'draft'}
									<textarea bind:value={step.langkah_kerja} onblur={() => saveStep(step)} rows="2" placeholder="Uraian langkah kerja" class="w-full border rounded-lg px-2 py-1.5 text-[13px] mb-1.5" style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)"></textarea>
									<textarea bind:value={step.bahaya} onblur={() => saveStep(step)} rows="2" placeholder="Bahaya" class="w-full border rounded-lg px-2 py-1.5 text-[13px] mb-1.5" style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)"></textarea>
									<div class="grid grid-cols-2 gap-1.5 mb-1.5">
										<input type="number" min="1" max="5" bind:value={step.likelihood} onblur={() => saveStep(step)} placeholder="Likelihood" class="border rounded-lg px-2 py-1.5 text-[13px]" style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)" />
										<input type="number" min="1" max="5" bind:value={step.severity} onblur={() => saveStep(step)} placeholder="Severity" class="border rounded-lg px-2 py-1.5 text-[13px]" style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)" />
									</div>
									<textarea bind:value={step.pengendalian} onblur={() => saveStep(step)} rows="2" placeholder="Pengendalian" class="w-full border rounded-lg px-2 py-1.5 text-[13px] mb-1.5" style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)"></textarea>
									<input value={apdText(step)} oninput={(e) => setApdFromText(step, (e.target as HTMLInputElement).value)} onblur={() => saveStep(step)} placeholder="APD (pisahkan dengan koma)" class="w-full border rounded-lg px-2 py-1.5 text-[13px]" style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)" />
								{:else}
									<p class="text-[13px] font-medium mb-1" style="color: var(--sys-label)">{step.langkah_kerja}</p>
									<p class="text-[12px] mb-1" style="color: var(--sys-label3)"><b>Bahaya:</b> {step.bahaya} (L{step.likelihood}×S{step.severity})</p>
									<p class="text-[12px] mb-1" style="color: var(--sys-label3)"><b>Pengendalian:</b> {step.pengendalian}</p>
									<p class="text-[12px]" style="color: var(--sys-label3)"><b>APD:</b> {apdText(step) || '-'}</p>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/if}

			{#if selectedJsa.status === 'draft'}
				<div class="card-section">
					<h4 class="text-[13px] font-semibold mb-2" style="color: var(--sys-label)">Foto Kondisi Lapangan (opsional)</h4>
					<input type="file" accept="image/*" capture="environment" onchange={handleFotoChange} class="text-[12px]" />
				</div>

				<div class="card-section">
					<h4 class="text-[13px] font-semibold mb-2" style="color: var(--sys-label)">Tanda Tangan Pembuat</h4>
					<SignaturePad bind:this={signPad} height={150} />
				</div>

				<button
					class="w-full py-3 rounded-xl text-[14px] font-semibold text-white disabled:opacity-50"
					style="background: var(--g)"
					disabled={submitting}
					onclick={submitAjukan}
				>
					{submitting ? 'Mengajukan...' : 'Ajukan untuk Persetujuan'}
				</button>
			{/if}
		</div>
	{:else if showCreateForm}
		<!-- ══════════ FORM BUAT JSA BARU ══════════ -->
		<div class="scroll-body px-4 py-4 flex flex-col gap-3" style="background: var(--sys-bg)">
			<div class="card-section">
				<h4 class="text-[13px] font-semibold mb-3" style="color: var(--sys-label)">JSA Baru</h4>

				<label class="block text-[11px] font-semibold mb-1" style="color: var(--sys-label3)">Jenis Pekerjaan</label>
				<select
					bind:value={formWorkType}
					onchange={loadTemplatesForWorkType}
					class="w-full border rounded-lg px-3 py-2 text-[13px] mb-3"
					style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)"
				>
					{#if projectWorkTypes.length > 0}
						{#each projectWorkTypes as wt}
							<option value={wt}>{WORK_TYPE_LABELS[wt] || wt}</option>
						{/each}
					{:else}
						{#each Object.entries(WORK_TYPE_LABELS) as [value, label]}
							<option {value}>{label}</option>
						{/each}
					{/if}
				</select>

				<label class="block text-[11px] font-semibold mb-1" style="color: var(--sys-label3)">Template</label>
				{#if templatesLoading}
					<p class="text-[12px] py-2" style="color: var(--sys-label3)">Memuat template...</p>
				{:else if templates.length === 0}
					<p class="text-[12px] py-2 text-red-600">Belum ada template aktif untuk jenis pekerjaan ini. Hubungi HSE Admin.</p>
				{:else}
					<select bind:value={formTemplateId} class="w-full border rounded-lg px-3 py-2 text-[13px] mb-3" style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)">
						{#each templates as t}
							<option value={t.id}>{t.nama} (v{t.versi})</option>
						{/each}
					</select>
				{/if}

				<label class="block text-[11px] font-semibold mb-1" style="color: var(--sys-label3)">Nama Aktivitas Spesifik</label>
				<input
					bind:value={formAktivitas}
					placeholder='mis. "Sandblasting Tangki 01"'
					class="w-full border rounded-lg px-3 py-2 text-[13px] mb-3"
					style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)"
				/>

				<div class="grid grid-cols-2 gap-3 mb-3">
					<div>
						<label class="block text-[11px] font-semibold mb-1" style="color: var(--sys-label3)">Berlaku Dari</label>
						<input type="date" bind:value={formBerlakuDari} class="w-full border rounded-lg px-3 py-2 text-[13px]" style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)" />
					</div>
					<div>
						<label class="block text-[11px] font-semibold mb-1" style="color: var(--sys-label3)">Berlaku Sampai</label>
						<input type="date" bind:value={formBerlakuSampai} class="w-full border rounded-lg px-3 py-2 text-[13px]" style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)" />
					</div>
				</div>

				<button
					class="w-full py-3 rounded-xl text-[14px] font-semibold text-white disabled:opacity-50"
					style="background: var(--g)"
					disabled={creating || templates.length === 0}
					onclick={submitCreate}
				>
					{creating ? 'Membuat...' : 'Buat JSA & Lanjut Sunting'}
				</button>
			</div>
		</div>
	{:else}
		<!-- ══════════ DAFTAR JSA PROYEK ══════════ -->
		<div class="scroll-body px-4 py-4 flex flex-col gap-3" style="background: var(--sys-bg)">
			<button
				class="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-semibold text-white"
				style="background: var(--g)"
				onclick={openCreateForm}
			>
				<IconPlus size={18} /> Buat JSA Baru
			</button>

			{#if jsaList.length === 0}
				<div class="card-section text-center py-8">
					<div class="text-4xl mb-2">📋</div>
					<p class="text-[13px]" style="color: var(--sys-label3)">Belum ada JSA untuk proyek ini.</p>
				</div>
			{:else}
				{#each jsaList as jsa (jsa.id)}
					{@const s = STATUS_LABELS[jsa.status] || STATUS_LABELS.draft}
					<button class="card-section text-left w-full" onclick={() => openDetail(jsa)}>
						<div class="flex items-center justify-between mb-1">
							<p class="text-[14px] font-semibold" style="color: var(--sys-label)">{jsa.aktivitas}</p>
							<span class="text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0" style="background: {s.bg}; color: {s.fg}">{s.text}</span>
						</div>
						<p class="text-[11px]" style="color: var(--sys-label3)">
							{typeof jsa.template_id === 'object' ? jsa.template_id?.nama : ''} · Berlaku {formatDate(jsa.berlaku_dari)} — {formatDate(jsa.berlaku_sampai)}
						</p>
					</button>
				{/each}
			{/if}
		</div>
	{/if}
</div>
