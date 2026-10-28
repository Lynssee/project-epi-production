<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { resolveOperatorId, logActivity, getEquipmentById } from '$lib/services/preventive';
	import { getWorkOrderById, submitDailyActivity, uploadActivityPhoto, type WorkOrderRow } from '$lib/services/maintenance';
	import { searchSparepartStockOptions, type SparepartStockOption } from '$lib/services/assetOwnership';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { IconArrowLeft, IconLoader2, IconCircleCheck, IconCamera, IconX, IconPlus, IconEdit } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { maintenanceActivitySchema } from '$lib/schemas/maintenanceActivity';
	import PhotoAnnotator from '$lib/components/shared/PhotoAnnotator.svelte';
	import VoiceInputButton from '$lib/components/shared/VoiceInputButton.svelte';

	let workOrderId = $derived($page.params.id as string);

	let loading = $state(true);
	let submitting = $state(false);
	let errorMsg = $state('');
	let workOrder = $state<WorkOrderRow | null>(null);
	let equipment = $state<any>(null);
	let success = $state(false);

	let deskripsi = $state('');
	let progress = $state(0);
	let kondisi = $state<'baik' | 'rusak'>('baik');
	// Fase 5 Pusat Maintenance v2 (14 Sep 2026): jam kerja manual per laporan (keputusan Lead
	// 14 Sep — lebih akurat utk MTTR & biaya jasa internal drpd rentang kalender kasar).
	// Disimpan ke mekanik_activity.durasi_kerja_menit (kolom sudah ada) — jamMulai/jamSelesai
	// sendiri TIDAK disimpan mentah (tidak ada kolomnya), cuma dipakai hitung durasi di sini.
	let jamMulai = $state('');
	let jamSelesai = $state('');
	let durasiKerjaMenit = $derived.by(() => {
		if (!jamMulai || !jamSelesai) return null;
		const [h1, m1] = jamMulai.split(':').map(Number);
		const [h2, m2] = jamSelesai.split(':').map(Number);
		const menit = h2 * 60 + m2 - (h1 * 60 + m1);
		return menit > 0 ? menit : null;
	});
	// Fase 4 Pusat Maintenance v2 (14 Sep 2026): part dipilih dari STOK GUDANG (koleksi
	// `sparepart`), bukan lagi Master Barang — supaya pemakaian tercatat resmi ke
	// sparepart_usage_log (G_WO4). hargaSatuan tetap dihitung di background untuk
	// biaya_sparepart WO tapi TIDAK ditampilkan (Q2 — mekanik tanpa nominal Rupiah).
	let spareparts = $state<{ nama: string; qty: number; sparepartId: string | null; unitCategoryId: string | null; hargaSatuan: number; qtyStock: number | null }[]>([]);
	let sparepartQuery = $state<string[]>([]);
	let sparepartResults = $state<SparepartStockOption[][]>([]);
	let sparepartSearching = $state<boolean[]>([]);
	let biayaSparepart = $derived(spareparts.reduce((s, sp) => s + (Number(sp.qty) || 0) * (Number(sp.hargaSatuan) || 0), 0));
	let photoFile = $state<File | null>(null);
	let photoPreview = $state<string | null>(null);
	let annotatingFile = $state<File | null>(null);

	// Jaring pengaman draf: di HP, OS bisa membunuh tab selagi kamera native terbuka
	// (RAM habis) dan halaman dimuat ulang dengan form kosong. Draf disimpan ke
	// sessionStorage + foto ke IndexedDB, dikunci per work order supaya isian WO satu
	// tidak bocor ke WO lain.
	interface LaporDraft {
		deskripsi: string;
		progress: number;
		kondisi: 'baik' | 'rusak';
		spareparts: { nama: string; qty: number; sparepartId: string | null; unitCategoryId: string | null; hargaSatuan: number; qtyStock: number | null }[];
		jamMulai: string;
		jamSelesai: string;
	}
	const LAPOR_PHOTO_KEY = 'bukti';
	let laporPersist = $derived(createFormPersist<LaporDraft>(`wo_lapor_${workOrderId}`));
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function laporSnapshot(): LaporDraft {
		return { deskripsi, progress, kondisi, spareparts, jamMulai, jamSelesai };
	}

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'input_maintenance', roles)) {
			goto('/');
		}
	});

	onMount(async () => {
		workOrder = await getWorkOrderById(workOrderId);
		if (!workOrder) {
			errorMsg = 'Work Order tidak ditemukan.';
			loading = false;
			return;
		}
		progress = workOrder.progress || 0;
		equipment = await getEquipmentById(workOrder.equipment_id);

		// Pulihkan draf SETELAH nilai awal dari server dipasang, supaya isian mekanik
		// yang belum terkirim menang atas progress default milik WO.
		const draft = laporPersist.restore();
		if (draft) {
			deskripsi = draft.deskripsi;
			progress = draft.progress;
			kondisi = draft.kondisi;
			spareparts = draft.spareparts ?? [];
			jamMulai = draft.jamMulai ?? '';
			jamSelesai = draft.jamSelesai ?? '';
			const blob = await laporPersist.restorePhoto(LAPOR_PHOTO_KEY);
			if (blob) {
				photoFile = new File([blob], 'bukti.jpg', { type: blob.type || 'image/jpeg' });
				photoPreview = URL.createObjectURL(photoFile);
			}
			draftSavedAt = new Date();
		}
		draftArmed = true;
		loading = false;
	});

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	$effect(() => {
		void laporSnapshot();
		if (!draftArmed) return;
		laporPersist.save(laporSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(laporPersist, laporSnapshot));

	function addSparepart() {
		spareparts = [...spareparts, { nama: '', qty: 1, sparepartId: null, unitCategoryId: null, hargaSatuan: 0, qtyStock: null }];
		sparepartQuery = [...sparepartQuery, ''];
		sparepartResults = [...sparepartResults, []];
		sparepartSearching = [...sparepartSearching, false];
	}

	function removeSparepart(index: number) {
		spareparts = spareparts.filter((_, i) => i !== index);
		sparepartQuery = sparepartQuery.filter((_, i) => i !== index);
		sparepartResults = sparepartResults.filter((_, i) => i !== index);
		sparepartSearching = sparepartSearching.filter((_, i) => i !== index);
	}

	let sparepartSearchTimers: (ReturnType<typeof setTimeout> | null)[] = [];

	function onSparepartQueryInput(index: number, value: string) {
		sparepartQuery[index] = value;
		spareparts[index].nama = value;
		spareparts[index].sparepartId = null;
		spareparts[index].unitCategoryId = null;
		spareparts[index].hargaSatuan = 0;
		spareparts[index].qtyStock = null;
		if (sparepartSearchTimers[index]) clearTimeout(sparepartSearchTimers[index]!);
		sparepartSearchTimers[index] = setTimeout(async () => {
			sparepartSearching[index] = true;
			sparepartResults[index] = await searchSparepartStockOptions(value);
			sparepartSearching[index] = false;
		}, 300);
	}

	function pickSparepart(index: number, option: SparepartStockOption) {
		spareparts[index].nama = option.nama;
		spareparts[index].sparepartId = option.id;
		spareparts[index].unitCategoryId = option.unitCategoryId;
		spareparts[index].hargaSatuan = option.lastPrice;
		spareparts[index].qtyStock = option.qtyStock;
		sparepartQuery[index] = option.nama;
		sparepartResults[index] = [];
	}

	function handlePhotoChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		photoFile = file;
		photoPreview = URL.createObjectURL(file);
		laporPersist.savePhoto(LAPOR_PHOTO_KEY, file);
	}

	async function handleSubmit() {
		if (!deskripsi.trim() || submitting || !workOrder) return;
		const parsed = maintenanceActivitySchema.safeParse({
			deskripsi,
			progress,
			kondisi,
			spareparts: spareparts.filter((s) => s.nama.trim()),
			biayaSparepart,
			durasiKerjaMenit
		});
		if (!parsed.success) {
			errorMsg = parsed.error.issues[0]?.message || 'Data laporan tidak valid.';
			return;
		}
		submitting = true;
		errorMsg = '';
		try {
			const karyawanName = $authStore.karyawanName;
			if (!karyawanName) throw new Error('Nama operator tidak ditemukan di sesi login.');
			const personnelId = await resolveOperatorId(karyawanName);

			let fotoId: string | null = null;
			if (photoFile) {
				const compressed = await compressPhoto(photoFile);
				fotoId = await uploadActivityPhoto(compressed);
			}

			await submitDailyActivity({
				work_order_id: workOrderId,
				equipment_id: workOrder.equipment_id,
				deskripsi: parsed.data.deskripsi,
				progress: parsed.data.progress,
				kondisi: parsed.data.kondisi,
				spareparts: parsed.data.spareparts,
				biaya_sparepart: parsed.data.biayaSparepart,
				durasi_kerja_menit: parsed.data.durasiKerjaMenit ?? null,
				fotoFileIds: fotoId ? [fotoId] : [],
				pic_mekanik_1_id: personnelId
			});

			await logActivity({
				user_name: karyawanName,
				action: 'create',
				entity_type: 'mekanik_activity',
				entity_id: workOrderId,
				summary: `Laporan harian ${equipment?.name || workOrder.equipment_id} — progres ${progress}%`
			});

			// Terkirim — draf lokal (termasuk foto di IndexedDB) sudah tidak relevan.
			laporPersist.clear();
			await laporPersist.clearPhotos();
			draftSavedAt = null;

			success = true;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengirim laporan harian.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="max-w-2xl mx-auto p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto(`/maintenance/work-order/${workOrderId}`)}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat form laporan pekerjaan..." />
		</div>
	{:else if success}
		<div class="text-center py-16">
			<IconCircleCheck size={40} style="color: #16A34A; margin: 0 auto" />
			<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">Laporan harian tersimpan</p>
			<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Progres WO diperbarui menjadi {progress}%.</p>
			<button class="mt-5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--g)" onclick={() => goto(`/maintenance/work-order/${workOrderId}`)}>
				Kembali ke Detail WO
			</button>
		</div>
	{:else if errorMsg && !workOrder}
		<div class="text-center py-16 text-[13px]" style="color: #DC2626">{errorMsg}</div>
	{:else}
		<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Laporan Harian</h1>
		<div class="flex items-center justify-between gap-2 mb-4">
			<p class="text-[11px]" style="color: var(--sys-label3)">{equipment?.name || ''}</p>
			<DraftIndicator savedAt={draftSavedAt} hasPhotos={!!photoFile} />
		</div>

		<div class="flex flex-col gap-4">
			<div>
				<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="deskripsi">Apa yang dikerjakan hari ini?</label>
				<div class="flex items-start gap-1.5">
					<textarea
						id="deskripsi"
						class="w-full rounded-lg border text-[13px] p-3"
						style="border-color: var(--sys-sep)"
						rows="3"
						placeholder="Contoh: Ganti oli hidrolik, cek kebocoran seal"
						bind:value={deskripsi}
					></textarea>
					<VoiceInputButton onResult={(text) => (deskripsi = deskripsi ? `${deskripsi} ${text}` : text)} />
				</div>
			</div>

			<div>
				<div class="flex items-center justify-between mb-1.5">
					<label class="text-[12px] font-semibold" style="color: var(--sys-label)" for="progress">% Progres</label>
					<span class="text-[13px] font-bold" style="color: var(--g)">{progress}%</span>
				</div>
				<input id="progress" type="range" min="0" max="100" step="5" bind:value={progress} class="w-full" />
			</div>

			<div>
				<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Jam Kerja Hari Ini</p>
				<div class="flex items-center gap-2">
					<input
						type="time"
						aria-label="Jam mulai"
						bind:value={jamMulai}
						class="flex-1 rounded-lg border text-[13px] p-2.5"
						style="border-color: var(--sys-sep)"
					/>
					<span class="text-[12px]" style="color: var(--sys-label3)">s/d</span>
					<input
						type="time"
						aria-label="Jam selesai"
						bind:value={jamSelesai}
						class="flex-1 rounded-lg border text-[13px] p-2.5"
						style="border-color: var(--sys-sep)"
					/>
				</div>
				{#if jamMulai && jamSelesai && durasiKerjaMenit === null}
					<p class="text-[10px] mt-1" style="color: #D97706">Jam selesai harus setelah jam mulai.</p>
				{:else if durasiKerjaMenit !== null}
					<p class="text-[10px] mt-1" style="color: var(--sys-label4)">Durasi: {Math.floor(durasiKerjaMenit / 60)} jam {durasiKerjaMenit % 60} menit</p>
				{/if}
			</div>

			<div>
				<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Kondisi Unit</p>
				<div class="grid grid-cols-2 gap-2">
					<button
						class="h-11 rounded-lg text-[13px] font-bold flex items-center justify-center gap-1.5"
						style={kondisi === 'baik' ? 'background:#16A34A; color:#fff' : 'background:var(--sys-fill); color:var(--sys-label3)'}
						onclick={() => kondisi = 'baik'}
					>
						Baik
					</button>
					<button
						class="h-11 rounded-lg text-[13px] font-bold flex items-center justify-center gap-1.5"
						style={kondisi === 'rusak' ? 'background:#DC2626; color:#fff' : 'background:var(--sys-fill); color:var(--sys-label3)'}
						onclick={() => kondisi = 'rusak'}
					>
						Rusak
					</button>
				</div>
			</div>

			<div>
				<div class="flex items-center justify-between mb-1.5">
					<p class="text-[12px] font-semibold" style="color: var(--sys-label)">Sparepart Terpakai</p>
					<button class="text-[11px] font-semibold flex items-center gap-1" style="color: var(--g)" onclick={addSparepart}>
						<IconPlus size={13} /> Tambah
					</button>
				</div>
				{#if spareparts.length > 0}
					<div class="flex flex-col gap-2 mb-2">
						{#each spareparts as sp, i}
							<div class="flex flex-col gap-1">
								<div class="flex items-center gap-2">
									<div class="flex-1 relative">
										<input
											type="text"
											placeholder="Cari sparepart di stok gudang..."
											value={sparepartQuery[i] ?? sp.nama}
											oninput={(e) => onSparepartQueryInput(i, (e.target as HTMLInputElement).value)}
											class="w-full rounded-lg border text-[12px] p-2"
											style="border-color: var(--sys-sep)"
										/>
										{#if sparepartResults[i]?.length > 0}
											<div class="absolute z-10 top-full left-0 right-0 mt-1 rounded-lg border bg-white shadow-lg max-h-40 overflow-y-auto" style="border-color: var(--sys-sep)">
												{#each sparepartResults[i] as opt (opt.id)}
													<button
														type="button"
														class="w-full text-left px-2 py-1.5 text-[12px] hover:bg-gray-50 flex items-center justify-between gap-2"
														onclick={() => pickSparepart(i, opt)}
													>
														<span>{opt.nama} {opt.code ? `(${opt.code})` : ''}</span>
														<span class="text-[10px]" style="color: var(--sys-label4)">Stok: {opt.qtyStock}</span>
													</button>
												{/each}
											</div>
										{/if}
									</div>
									<input
										type="number"
										min="1"
										bind:value={sp.qty}
										class="w-16 rounded-lg border text-[12px] p-2"
										style="border-color: var(--sys-sep)"
									/>
									<button onclick={() => removeSparepart(i)} style="color: #DC2626"><IconX size={16} /></button>
								</div>
								{#if sp.sparepartId}
									<p class="text-[10px] pl-1" style="color: var(--sys-label4)">
										✓ dari stok gudang — sisa stok saat ini: {sp.qtyStock ?? '-'}
									</p>
								{:else if sp.nama.trim()}
									<p class="text-[10px] pl-1" style="color: #D97706">Belum ditautkan ke stok gudang — part ini tidak akan tercatat resmi, hanya sebagai catatan bebas.</p>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<div>
				<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Foto Bukti Pengerjaan</p>
				{#if photoPreview}
					<div class="flex items-center gap-2 mb-2">
						<div class="relative w-28 h-28">
							<img src={photoPreview} alt="Preview" class="w-28 h-28 object-cover rounded-lg" />
							<button
								class="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-white"
								style="background: #DC2626"
								onclick={() => { photoFile = null; photoPreview = null; }}
							>
								<IconX size={14} />
							</button>
						</div>
						<button
							type="button"
							class="flex items-center gap-1.5 rounded-lg border text-[11px] font-semibold px-2.5 py-1.5"
							style="border-color: var(--sys-sep); color: var(--sys-label2)"
							onclick={() => (annotatingFile = photoFile)}
						>
							<IconEdit size={14} /> Tandai di foto
						</button>
					</div>
				{:else}
					<label class="w-28 h-28 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer" style="border-color: var(--sys-sep)">
						<IconCamera size={22} style="color: var(--sys-label4)" />
						<span class="text-[10px]" style="color: var(--sys-label4)">Ambil foto</span>
						<input type="file" accept="image/*" capture="environment" class="hidden" onchange={handlePhotoChange} />
					</label>
				{/if}
			</div>

			{#if errorMsg}
				<p class="text-[12px]" style="color: #DC2626">{errorMsg}</p>
			{/if}

			<button
				class="w-full h-12 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
				style="background: var(--g)"
				disabled={!deskripsi.trim() || submitting}
				onclick={handleSubmit}
			>
				{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
				Simpan Laporan Harian
			</button>
		</div>
	{/if}
</div>

{#if annotatingFile}
	<PhotoAnnotator
		file={annotatingFile}
		onSave={(annotated) => {
			photoFile = annotated;
			photoPreview = URL.createObjectURL(annotated);
			laporPersist.savePhoto(LAPOR_PHOTO_KEY, annotated);
			annotatingFile = null;
		}}
		onCancel={() => (annotatingFile = null)}
	/>
{/if}
