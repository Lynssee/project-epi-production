<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { logActivity } from '$lib/services/preventive';
	import { getOperatorEquipment } from '$lib/services/preventive';
	import { createFieldTicket, createFieldSurvey, uploadTicketPhoto, type MaintTicketRow } from '$lib/services/maintenance';
	import { getAssetOwnershipSummary, type AssetOwnershipSummary } from '$lib/services/assetOwnership';
	import {
		IconArrowLeft,
		IconLoader2,
		IconCircleCheck,
		IconCamera,
		IconX,
		IconTool,
		IconAlertTriangle,
		IconInfoCircle,
		IconPhoto,
		IconSend,
		IconCheck
	} from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { compressPhoto } from '$lib/utils/photoCompress';

	let loading = $state(true);
	let submitting = $state(false);
	let errorMsg = $state('');
	let success = $state(false);
	let createdTicket = $state<MaintTicketRow | null>(null);
	let equipmentList = $state<any[]>([]);

	const prefilledEquipmentId = $page.url.searchParams.get('equipment_id') || '';
	const prefilledLoanId = $page.url.searchParams.get('loan_id') || null;

	let equipmentId = $state(prefilledEquipmentId);
	let masalah = $state('');
	let tingkatKerusakan = $state<'low' | 'medium' | 'high'>('medium');
	let photoFile = $state<File | null>(null);
	let photoPreview = $state<string | null>(null);

	// Fase 6.4 (Penajaman Aset Produktif, 29 Agu 2026): peringatan biaya sadar-konteks saat
	// memilih alat yang sudah kritis biaya perawatannya — bukan menghalangi laporan, cuma info.
	let ownershipWarning = $state<AssetOwnershipSummary | null>(null);
	$effect(() => {
		const id = equipmentId;
		if (!id) {
			ownershipWarning = null;
			return;
		}
		getAssetOwnershipSummary(id).then((summary) => {
			if (equipmentId !== id) return; // equipment berganti lagi sebelum fetch selesai
			ownershipWarning = summary && !summary.hargaBeliKosong && summary.statusLevel && summary.statusLevel !== 'aman' ? summary : null;
		});
	});

	// Jaring pengaman draf
	interface SurveyDraft {
		equipmentId: string;
		masalah: string;
		tingkatKerusakan: 'low' | 'medium' | 'high';
	}
	const SURVEY_PHOTO_KEY = 'kerusakan';
	const surveyPersist = createFormPersist<SurveyDraft>('maintenance_survey_baru');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function surveySnapshot(): SurveyDraft {
		return { equipmentId, masalah, tingkatKerusakan };
	}

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && roles.length > 0 && !hasPermission(roleId, 'input_maintenance', roles)) {
			goto('/');
		}
	});

	onMount(async () => {
		try {
			equipmentList = await getOperatorEquipment();

			const draft = surveyPersist.restore();
			if (draft) {
				equipmentId = prefilledEquipmentId || draft.equipmentId;
				masalah = draft.masalah;
				tingkatKerusakan = draft.tingkatKerusakan;
				const blob = await surveyPersist.restorePhoto(SURVEY_PHOTO_KEY);
				if (blob) {
					photoFile = new File([blob], 'kerusakan.jpg', { type: blob.type || 'image/jpeg' });
					photoPreview = URL.createObjectURL(photoFile);
				}
				draftSavedAt = new Date();
			}
		} catch (err: any) {
			console.warn('Gagal memuat peralatan:', err);
		} finally {
			draftArmed = true;
			loading = false;
		}
	});

	// Autosave
	$effect(() => {
		void surveySnapshot();
		if (!draftArmed) return;
		surveyPersist.save(surveySnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(surveyPersist, surveySnapshot));

	function handlePhotoChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		photoFile = file;
		photoPreview = URL.createObjectURL(file);
		surveyPersist.savePhoto(SURVEY_PHOTO_KEY, file);
	}

	let selectedEquipment = $derived(equipmentList.find((e) => e.id === equipmentId));
	let canSubmit = $derived(!!equipmentId && masalah.trim().length > 0);

	async function handleSubmit() {
		if (!canSubmit || submitting) return;
		submitting = true;
		errorMsg = '';
		try {
			const karyawanName = $authStore.karyawanName;
			if (!karyawanName) throw new Error('Nama operator tidak ditemukan di sesi login.');

			let fotoId: string | null = null;
			if (photoFile) fotoId = await uploadTicketPhoto(await compressPhoto(photoFile));

			const ticket = await createFieldTicket({
				equipment_id: equipmentId,
				masalah: masalah.trim(),
				pelapor: karyawanName,
				prioritas: tingkatKerusakan,
				foto: fotoId,
				loan_id: prefilledLoanId
			});

			await createFieldSurvey({
				ticket_id: ticket.id,
				equipment_id: equipmentId,
				notes: masalah.trim(),
				temuan_kerusakan: masalah.trim(),
				surveyor: karyawanName
			});

			await logActivity({
				user_name: karyawanName,
				action: 'create',
				entity_type: 'maint_ticket',
				entity_id: ticket.id,
				summary: `Lapor kerusakan: ${masalah.trim()}`
			});

			createdTicket = ticket;
			surveyPersist.clear();
			await surveyPersist.clearPhotos();
			draftSavedAt = null;
			success = true;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengirim laporan kerusakan.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="max-w-3xl mx-auto p-4 md:p-6 pb-28">
	<!-- Top Navigation -->
	<div class="mb-5 flex items-center justify-between">
		<button
			type="button"
			class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
			onclick={() => goto('/maintenance/survey')}
		>
			<IconArrowLeft size={16} />
			<span>Kembali ke Daftar Tiket</span>
		</button>
		{#if !success}
			<DraftIndicator savedAt={draftSavedAt} hasPhotos={!!photoFile} />
		{/if}
	</div>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat formulir survey tiket..." />
		</div>
	{:else if success}
		<!-- Success Submission Card -->
		<div
			class="rounded-3xl border p-8 md:p-10 text-center max-w-lg mx-auto shadow-lg"
			style="background: var(--sys-bg-secondary, #ffffff); border-color: var(--sys-sep)"
		>
			<div class="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4 bg-emerald-100 text-emerald-700 dark:bg-emerald-950/80 dark:text-emerald-300 shadow-inner">
				<IconCircleCheck size={36} />
			</div>
			<h2 class="text-xl font-bold mb-1" style="color: var(--sys-label)">Laporan Kerusakan Terkirim</h2>
			<p class="text-xs md:text-sm text-slate-500 dark:text-slate-400 mb-6">
				Tiket kerusakan Anda berhasil dicatat dalam sistem dan masuk ke antrian verifikasi admin.
			</p>

			{#if createdTicket}
				<div class="p-4 rounded-2xl border bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700 text-left mb-6 space-y-2">
					<div class="flex items-center justify-between text-xs">
						<span class="text-slate-400">Nomor Tiket:</span>
						<span class="font-mono font-bold text-sky-700 dark:text-sky-300">{createdTicket.nomor_tiket}</span>
					</div>
					<div class="flex items-center justify-between text-xs">
						<span class="text-slate-400">Unit / Alat:</span>
						<span class="font-semibold text-slate-700 dark:text-slate-200">{selectedEquipment?.name || createdTicket.equipment_id}</span>
					</div>
					<div class="flex items-center justify-between text-xs">
						<span class="text-slate-400">Status Awal:</span>
						<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
							Menunggu Survey & WO
						</span>
					</div>
				</div>
			{/if}

			<div class="flex items-center gap-3 justify-center">
				<button
					type="button"
					class="px-5 py-2.5 rounded-xl border text-xs font-bold transition-all hover:bg-slate-50 dark:hover:bg-slate-800"
					style="border-color: var(--sys-sep); color: var(--sys-label)"
					onclick={() => {
						success = false;
						createdTicket = null;
						equipmentId = '';
						masalah = '';
						photoFile = null;
						photoPreview = null;
					}}
				>
					Lapor Unit Lain
				</button>
				<button
					type="button"
					class="px-6 py-2.5 rounded-xl text-xs font-bold text-white shadow-md transition-all hover:opacity-90"
					style="background: var(--g)"
					onclick={() => goto('/maintenance/survey')}
				>
					Lihat Daftar Tiket Saya
				</button>
			</div>
		</div>
	{:else}
		<!-- Form Container -->
		<div
			class="rounded-3xl border p-5 md:p-8 shadow-sm"
			style="background: var(--sys-bg-secondary, #ffffff); border-color: var(--sys-sep)"
		>
			<div class="mb-6 pb-4 border-b border-slate-100 dark:border-slate-800">
				<h1 class="text-xl md:text-2xl font-extrabold" style="color: var(--sys-label)">
					Lapor Kerusakan Baru
				</h1>
				<p class="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-1">
					Laporkan kendala alat operasional secara detail agar admin dapat segera menerbitkan Work Order penanganan.
				</p>
			</div>

			<div class="flex flex-col gap-5">
				<!-- Pilih Equipment / Unit -->
				<div>
					<label class="text-xs font-bold block mb-1.5 flex items-center justify-between" style="color: var(--sys-label)" for="equipment">
						<span class="flex items-center gap-1.5">
							<IconTool size={15} class="text-sky-600" />
							Unit / Equipment
						</span>
						<span class="text-[10px] text-rose-500 font-semibold">* Wajib dipilih</span>
					</label>
					<div class="relative">
						<select
							id="equipment"
							bind:value={equipmentId}
							class="w-full rounded-xl border text-xs p-3 appearance-none font-medium focus:outline-none transition-colors"
							style="border-color: var(--sys-sep); background: var(--sys-bg, #f8fafc); color: var(--sys-label)"
						>
							<option value="">-- Pilih Unit / Alat yang Mengalami Kendala --</option>
							{#each equipmentList as eq (eq.id)}
								<option value={eq.id}>
									{eq.name} {eq.code ? `[Kode: ${eq.code}]` : ''} {eq.category ? `(${eq.category})` : ''}
								</option>
							{/each}
						</select>
					</div>
					{#if selectedEquipment}
						<div class="mt-2 p-2.5 rounded-xl border bg-sky-50/50 dark:bg-sky-950/30 border-sky-200 dark:border-sky-900 flex items-center justify-between text-xs">
							<span class="text-sky-800 dark:text-sky-300 font-medium">
								Unit terpilih: <span class="font-bold">{selectedEquipment.name}</span>
							</span>
							{#if selectedEquipment.code}
								<span class="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-sky-200/60 dark:bg-sky-900/60 text-sky-900 dark:text-sky-200">
									{selectedEquipment.code}
								</span>
							{/if}
						</div>
					{/if}

					<!-- Fase 6.4: peringatan biaya sadar-konteks -->
					{#if ownershipWarning}
						<div
							class="mt-2 p-3 rounded-xl border flex items-start gap-2.5 text-xs {ownershipWarning.statusLevel === 'kritis' ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900' : 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900'}"
						>
							<IconAlertTriangle size={16} class={ownershipWarning.statusLevel === 'kritis' ? 'text-rose-600 dark:text-rose-400 shrink-0 mt-0.5' : 'text-amber-600 dark:text-amber-400 shrink-0 mt-0.5'} />
							<p class={ownershipWarning.statusLevel === 'kritis' ? 'text-rose-800 dark:text-rose-300' : 'text-amber-900 dark:text-amber-300'}>
								Alat ini sudah menghabiskan <strong>Rp{ownershipWarning.totalBiaya.toLocaleString('id-ID')}</strong>
								untuk perbaikan ({ownershipWarning.woCount}× WO) — <strong>{ownershipWarning.rasioPct?.toFixed(1)}%</strong> dari nilai belinya.
								{ownershipWarning.statusLevel === 'kritis'
									? ' Pertimbangkan lapor ke supervisor sebelum perbaikan berikutnya — mungkin lebih hemat diganti.'
									: ' Pantau terus kondisinya.'}
							</p>
						</div>
					{/if}
				</div>

				<!-- Uraian Gejala Kerusakan -->
				<div>
					<label class="text-xs font-bold block mb-1.5 flex items-center justify-between" style="color: var(--sys-label)" for="masalah">
						<span>Gejala / Keluhan Kerusakan</span>
						<span class="text-[10px] text-rose-500 font-semibold">* Wajib diisi</span>
					</label>
					<textarea
						id="masalah"
						class="w-full rounded-xl border text-xs p-3 focus:outline-none transition-colors leading-relaxed"
						style="border-color: var(--sys-sep); background: var(--sys-bg, #f8fafc); color: var(--sys-label)"
						rows="4"
						placeholder="Jelaskan secara rinci gejala kerusakan (misal: Suara mendecit pada putaran tinggi, oli transmisi menetes di bawah kabin, silinder hidrolik bocor saat beban berat)..."
						bind:value={masalah}
					></textarea>
					<p class="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
						<IconInfoCircle size={13} />
						<span>Deskripsi yang spesifik mempercepat mekanik menyiapkan suku cadang yang tepat.</span>
					</p>
				</div>

				<!-- Tingkat Kerusakan (Prioritas) -->
				<div>
					<p class="text-xs font-bold mb-2" style="color: var(--sys-label)">Tingkat Urgensi / Kerusakan</p>
					<div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
						<!-- Ringan -->
						<button
							type="button"
							class="p-3 rounded-2xl border text-left transition-all relative cursor-pointer"
							style={tingkatKerusakan === 'low'
								? 'background: #DCFCE7; border-color: #16A34A; color: #14532D'
								: 'background: var(--sys-bg, #f8fafc); border-color: var(--sys-sep); color: var(--sys-label2)'}
							onclick={() => (tingkatKerusakan = 'low')}
						>
							<div class="flex items-center justify-between mb-1">
								<span class="text-xs font-extrabold">Ringan</span>
								{#if tingkatKerusakan === 'low'}<IconCheck size={16} class="text-emerald-700" />{/if}
							</div>
							<p class="text-[10px] opacity-80 leading-snug">Alat masih bisa jalan, butuh servis minor</p>
						</button>

						<!-- Sedang -->
						<button
							type="button"
							class="p-3 rounded-2xl border text-left transition-all relative cursor-pointer"
							style={tingkatKerusakan === 'medium'
								? 'background: #FEF3C7; border-color: #D97706; color: #78350F'
								: 'background: var(--sys-bg, #f8fafc); border-color: var(--sys-sep); color: var(--sys-label2)'}
							onclick={() => (tingkatKerusakan = 'medium')}
						>
							<div class="flex items-center justify-between mb-1">
								<span class="text-xs font-extrabold">Sedang</span>
								{#if tingkatKerusakan === 'medium'}<IconCheck size={16} class="text-amber-700" />{/if}
							</div>
							<p class="text-[10px] opacity-80 leading-snug">Performa terganggu, perlu jadwal perbaikan</p>
						</button>

						<!-- Berat -->
						<button
							type="button"
							class="p-3 rounded-2xl border text-left transition-all relative cursor-pointer"
							style={tingkatKerusakan === 'high'
								? 'background: #FEE2E2; border-color: #DC2626; color: #7F1D1D'
								: 'background: var(--sys-bg, #f8fafc); border-color: var(--sys-sep); color: var(--sys-label2)'}
							onclick={() => (tingkatKerusakan = 'high')}
						>
							<div class="flex items-center justify-between mb-1">
								<span class="text-xs font-extrabold flex items-center gap-1">
									<IconAlertTriangle size={13} />
									Berat / Darurat
								</span>
								{#if tingkatKerusakan === 'high'}<IconCheck size={16} class="text-rose-700" />{/if}
							</div>
							<p class="text-[10px] opacity-80 leading-snug">Alat breakdown / membahayakan operasional</p>
						</button>
					</div>
				</div>

				<!-- Foto Kondisi Kerusakan -->
				<div>
					<p class="text-xs font-bold mb-1.5" style="color: var(--sys-label)">Foto Bukti Kerusakan (Opsional)</p>
					{#if photoPreview}
						<div class="relative w-full sm:w-64 h-40 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-sm">
							<img src={photoPreview} alt="Preview Foto" class="w-full h-full object-cover" />
							<button
								type="button"
								class="absolute top-2 right-2 w-7 h-7 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-md hover:bg-rose-700 transition-colors"
								title="Hapus foto"
								onclick={() => {
									photoFile = null;
									photoPreview = null;
								}}
							>
								<IconX size={15} />
							</button>
							<div class="absolute bottom-2 left-2 px-2 py-0.5 rounded-lg bg-black/60 text-white text-[10px] font-semibold">
								Foto siap diunggah
							</div>
						</div>
					{:else}
						<label
							class="w-full sm:w-72 h-32 rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-all hover:bg-slate-50 dark:hover:bg-slate-800/40"
							style="border-color: var(--sys-sep)"
						>
							<div class="w-10 h-10 rounded-xl bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300 flex items-center justify-center">
								<IconCamera size={20} />
							</div>
							<span class="text-xs font-bold text-slate-700 dark:text-slate-300">Ambil Foto / Unggah Gambar</span>
							<span class="text-[10px] text-slate-400">Kamera smartphone atau galeri</span>
							<input type="file" accept="image/*" capture="environment" class="hidden" onchange={handlePhotoChange} />
						</label>
					{/if}
				</div>

				<!-- Error Message Banner -->
				{#if errorMsg}
					<div class="p-3.5 rounded-xl text-xs font-semibold bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-900 flex items-center gap-2">
						<IconAlertTriangle size={16} />
						<span>{errorMsg}</span>
					</div>
				{/if}

				<!-- Submit Button -->
				<div class="pt-2">
					<button
						type="button"
						class="w-full h-12 rounded-2xl text-xs md:text-sm font-bold text-white flex items-center justify-center gap-2 shadow-lg transition-all active:scale-[0.99] hover:opacity-95 disabled:opacity-40 disabled:pointer-events-none"
						style="background: linear-gradient(135deg, #1F6592 0%, #163F5A 100%)"
						disabled={!canSubmit || submitting}
						onclick={handleSubmit}
					>
						{#if submitting}
							<IconLoader2 size={18} class="animate-spin" />
							<span>Mengirim Laporan Kerusakan...</span>
						{:else}
							<IconSend size={18} />
							<span>Kirim Laporan Kerusakan</span>
						{/if}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

