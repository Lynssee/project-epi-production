<script lang="ts">
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		submitGaRequest,
		JENIS_CATEGORIES,
		SMART_PRESETS,
		LOKASI_PRESETS,
		PRIORITAS_META
	} from '$lib/services/gaRequest';
	import {
		IconArrowLeft,
		IconLoader2,
		IconCircleCheck,
		IconTool,
		IconNotes,
		IconCup,
		IconCar,
		IconDoor,
		IconDots,
		IconClock,
		IconSparkles,
		IconMapPin,
		IconCalendarEvent,
		IconCheck
	} from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';

	let submitting = $state(false);
	let errorMsg = $state('');
	let success = $state(false);

	let jenis = $state('atk');
	let deskripsi = $state('');
	let prioritas = $state('sedang');
	let lokasi = $state('');
	let tanggalBooking = $state('');
	let jamMulai = $state('09:00');
	let jamSelesai = $state('10:30');

	// Room amenities checklist
	let roomAmenities = $state<string[]>([]);

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'input_support', roles)) {
			goto('/');
		}
	});

	interface GaRequestDraft {
		jenis: string;
		deskripsi: string;
		prioritas: string;
		lokasi: string;
		tanggalBooking: string;
		jamMulai: string;
		jamSelesai: string;
		roomAmenities?: string[];
	}
	const gaRequestPersist = createFormPersist<GaRequestDraft>('ga_request_baru');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function snapshot(): GaRequestDraft {
		return { jenis, deskripsi, prioritas, lokasi, tanggalBooking, jamMulai, jamSelesai, roomAmenities };
	}

	$effect(() => {
		const draft = gaRequestPersist.restore();
		if (draft) {
			jenis = draft.jenis || 'atk';
			deskripsi = draft.deskripsi || '';
			prioritas = draft.prioritas || 'sedang';
			lokasi = draft.lokasi || '';
			tanggalBooking = draft.tanggalBooking || '';
			jamMulai = draft.jamMulai || '09:00';
			jamSelesai = draft.jamSelesai || '10:30';
			roomAmenities = draft.roomAmenities || [];
			draftSavedAt = new Date();
		}
		draftArmed = true;
	});

	$effect(() => {
		void snapshot();
		if (!draftArmed) return;
		gaRequestPersist.save(snapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(gaRequestPersist, snapshot));

	let currentPresets = $derived(SMART_PRESETS[jenis] || []);

	function applyPreset(preset: { label: string; text: string; defaultPrioritas?: string }) {
		deskripsi = preset.text;
		if (preset.defaultPrioritas) {
			prioritas = preset.defaultPrioritas;
		}
	}

	function toggleAmenity(amenity: string) {
		if (roomAmenities.includes(amenity)) {
			roomAmenities = roomAmenities.filter((a) => a !== amenity);
		} else {
			roomAmenities = [...roomAmenities, amenity];
		}
	}

	function getCategoryIcon(j: string) {
		switch (j) {
			case 'atk': return IconNotes;
			case 'rtk': return IconCup;
			case 'perbaikan': return IconTool;
			case 'kendaraan': return IconCar;
			case 'ruangan': return IconDoor;
			default: return IconDots;
		}
	}

	let canSubmit = $derived(
		deskripsi.trim().length > 0 && (jenis !== 'ruangan' || (tanggalBooking.length > 0 && jamMulai.length > 0 && jamSelesai.length > 0))
	);

	async function handleSubmit() {
		if (!canSubmit || submitting) return;
		submitting = true;
		errorMsg = '';

		let finalDesc = deskripsi.trim();
		if (jenis === 'ruangan' && roomAmenities.length > 0) {
			finalDesc += `\n\nFasilitas yang dibutuhkan: ${roomAmenities.join(', ')}`;
		}

		try {
			await submitGaRequest({
				jenis,
				deskripsi: finalDesc,
				lokasi: lokasi.trim() || null,
				prioritas,
				tanggalBooking: jenis === 'ruangan' ? tanggalBooking || null : null,
				jamMulai: jenis === 'ruangan' ? jamMulai || null : null,
				jamSelesai: jenis === 'ruangan' ? jamSelesai || null : null
			});
			gaRequestPersist.clear();
			draftSavedAt = null;
			success = true;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengirim permintaan.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="max-w-3xl mx-auto p-4 md:p-6 pb-28">
	<!-- Back Button -->
	<button
		class="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 px-3 py-1.5 rounded-xl border transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
		style="border-color: var(--sys-sep); color: var(--sys-label)"
		onclick={() => goto('/ga-request')}
	>
		<IconArrowLeft size={15} /> Kembali ke Daftar
	</button>

	{#if success}
		<div
			class="rounded-3xl border p-8 md:p-12 text-center shadow-lg my-6"
			style="background: var(--sys-bg-secondary, #fff); border-color: var(--sys-sep)"
		>
			<div class="w-16 h-16 rounded-full bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center mx-auto mb-4">
				<IconCircleCheck size={36} />
			</div>
			<h2 class="text-lg md:text-xl font-bold tracking-tight" style="color: var(--sys-label)">
				Permintaan Berhasil Diajukan
			</h2>
			<p class="text-xs md:text-sm mt-1.5 max-w-md mx-auto" style="color: var(--sys-label3)">
				Permintaan Anda telah tercatat di Service Desk General Affairs dan akan segera diverifikasi oleh tim GA.
			</p>
			<div class="flex items-center justify-center gap-3 mt-6">
				<button
					class="px-5 py-2.5 rounded-xl text-xs font-bold text-white shadow-sm"
					style="background: var(--p, #1F6592)"
					onclick={() => goto('/ga-request')}
				>
					Lihat Status Pengajuan
				</button>
				<button
					class="px-4 py-2.5 rounded-xl text-xs font-semibold border"
					style="background: var(--sys-fill); color: var(--sys-label); border-color: var(--sys-sep)"
					onclick={() => {
						success = false;
						deskripsi = '';
						lokasi = '';
						roomAmenities = [];
					}}
				>
					+ Buat Lagi
				</button>
			</div>
		</div>
	{:else}
		<!-- Header -->
		<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
			<div>
				<h1 class="text-xl md:text-2xl font-bold tracking-tight" style="color: var(--sys-label)">
					Buat Permintaan Layanan GA Baru
				</h1>
				<p class="text-xs md:text-sm mt-0.5" style="color: var(--sys-label3)">
					Pengadaan ATK/RTK, perbaikan sarana fasilitas, armada kendaraan, atau reservasi ruang meeting.
				</p>
			</div>
			<DraftIndicator savedAt={draftSavedAt} hasPhotos={false} />
		</div>

		<div class="space-y-6">
			<!-- Section 1: Kategori Pilihan (Visual Grid) -->
			<div class="p-5 rounded-3xl border" style="background: var(--sys-bg-secondary, #fff); border-color: var(--sys-sep)">
				<label class="text-xs font-bold uppercase tracking-wider block mb-3" style="color: var(--sys-label3)">
					1. Pilih Kategori Layanan
				</label>
				<div class="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
					{#each JENIS_CATEGORIES as cat}
						{@const CatIcon = getCategoryIcon(cat.value)}
						{@const isSelected = jenis === cat.value}
						<button
							type="button"
							class="p-3 rounded-2xl border text-left transition-all duration-200 flex flex-col justify-between relative"
							style={isSelected
								? `background: ${cat.bg}; border-color: ${cat.color}; box-shadow: 0 0 0 2px ${cat.color}20`
								: 'background: var(--sys-fill); border-color: var(--sys-sep)'}
							onclick={() => (jenis = cat.value)}
						>
							<div class="flex items-center justify-between gap-1 mb-2">
								<div
									class="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
									style="background: {isSelected ? cat.color : 'rgba(0,0,0,0.06)'}; color: {isSelected ? '#fff' : 'var(--sys-label2)'}"
								>
									<CatIcon size={16} />
								</div>
								{#if isSelected}
									<span class="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold" style="background: {cat.color}; color: #fff">
										✓
									</span>
								{/if}
							</div>
							<div>
								<p class="text-xs font-bold leading-tight" style="color: {isSelected ? cat.color : 'var(--sys-label)'}">
									{cat.label}
								</p>
								<p class="text-[10px] mt-0.5 line-clamp-1" style="color: var(--sys-label3)">
									{cat.desc}
								</p>
							</div>
						</button>
					{/each}
				</div>

				<!-- Smart Preset Chips -->
				{#if currentPresets.length > 0}
					<div class="mt-4 pt-3.5 border-t" style="border-color: var(--sys-sep)">
						<div class="flex items-center gap-1.5 mb-2">
							<IconSparkles size={14} class="text-amber-500" />
							<span class="text-[11px] font-bold" style="color: var(--sys-label2)">Rekomendasi Cepat (Klik untuk Isi):</span>
						</div>
						<div class="flex flex-wrap gap-1.5">
							{#each currentPresets as preset}
								<button
									type="button"
									class="text-[11px] font-medium px-2.5 py-1 rounded-lg border transition-all hover:border-blue-500 hover:text-blue-600 active:scale-95"
									style="background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label)"
									onclick={() => applyPreset(preset)}
								>
									+ {preset.label}
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>

			<!-- Section 2: Khusus Ruangan (Room Booking Assistant) -->
			{#if jenis === 'ruangan'}
				<div class="p-5 rounded-3xl border bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 space-y-4">
					<div class="flex items-center gap-2">
						<IconCalendarEvent size={18} class="text-emerald-700 dark:text-emerald-300" />
						<h3 class="text-xs font-bold uppercase tracking-wider text-emerald-900 dark:text-emerald-200">
							2. Reservasi Jadwal & Fasilitas Ruang Rapat
						</h3>
					</div>

					<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
						<div>
							<label class="text-[11px] font-bold block mb-1 text-emerald-900 dark:text-emerald-200" for="tanggalBooking">
								Tanggal Meeting *
							</label>
							<input
								id="tanggalBooking"
								type="date"
								class="w-full h-10 px-3 rounded-xl border text-xs bg-white dark:bg-slate-900 font-medium"
								style="border-color: var(--sys-sep)"
								bind:value={tanggalBooking}
							/>
						</div>
						<div>
							<label class="text-[11px] font-bold block mb-1 text-emerald-900 dark:text-emerald-200" for="jamMulai">
								Jam Mulai *
							</label>
							<input
								id="jamMulai"
								type="time"
								class="w-full h-10 px-3 rounded-xl border text-xs bg-white dark:bg-slate-900 font-medium"
								style="border-color: var(--sys-sep)"
								bind:value={jamMulai}
							/>
						</div>
						<div>
							<label class="text-[11px] font-bold block mb-1 text-emerald-900 dark:text-emerald-200" for="jamSelesai">
								Jam Selesai *
							</label>
							<input
								id="jamSelesai"
								type="time"
								class="w-full h-10 px-3 rounded-xl border text-xs bg-white dark:bg-slate-900 font-medium"
								style="border-color: var(--sys-sep)"
								bind:value={jamSelesai}
							/>
						</div>
					</div>

					<!-- Checklist Fasilitas Tambahan -->
					<div>
						<span class="text-[11px] font-bold block mb-2 text-emerald-900 dark:text-emerald-200">
							Perlengkapan Rapat Tambahan yang Diperlukan:
						</span>
						<div class="flex flex-wrap gap-2">
							{#each ['📺 Proyektor / TV Screen', '🎙️ Sound & Wireless Mic', '📝 Whiteboard & Spidol', '🔌 Colokan / Kabel Roll', '☕ Kopi & Teh Pantry'] as amenity}
								{@const active = roomAmenities.includes(amenity)}
								<button
									type="button"
									class="px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all flex items-center gap-1.5"
									style={active
										? 'background: #047857; color: #fff; border-color: transparent;'
										: 'background: rgba(255,255,255,0.7); color: var(--sys-label); border-color: var(--sys-sep);'}
									onclick={() => toggleAmenity(amenity)}
								>
									{#if active}<IconCheck size={12} />{/if}
									{amenity}
								</button>
							{/each}
						</div>
					</div>
				</div>
			{/if}

			<!-- Section 3: Rincian & Deskripsi -->
			<div class="p-5 rounded-3xl border space-y-4" style="background: var(--sys-bg-secondary, #fff); border-color: var(--sys-sep)">
				<div>
					<label class="text-xs font-bold uppercase tracking-wider block mb-1.5" style="color: var(--sys-label3)" for="deskripsi">
						{jenis === 'ruangan' ? '3. Agenda / Keperluan Rapat' : '2. Deskripsi & Rincian Kebutuhan'} *
					</label>
					<textarea
						id="deskripsi"
						class="w-full rounded-2xl border text-xs p-3.5 focus:outline-none focus:ring-1 leading-relaxed"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						rows="4"
						placeholder={jenis === 'ruangan'
							? 'Tuliskan agenda rapat, peserta yang hadir, atau ruangan yang diinginkan (misal: Ruang Rapat Lt. 2)...'
							: 'Jelaskan rincian kebutuhan Anda secara spesifik (jumlah unit, spesifikasi merk jika ada, nomor ruangan/lokasi kerusakan, dll)...'}
						bind:value={deskripsi}
					></textarea>
				</div>

				<!-- Section 4: Lokasi & Penempatan -->
				<div>
					<label class="text-xs font-bold uppercase tracking-wider block mb-1.5" style="color: var(--sys-label3)" for="lokasi">
						Lokasi / Site Kebutuhan (Opsional)
					</label>
					<div class="flex flex-wrap gap-1.5 mb-2">
						{#each LOKASI_PRESETS as presetLoc}
							<button
								type="button"
								class="text-[10px] font-semibold px-2.5 py-1 rounded-lg border transition-all hover:bg-slate-200 dark:hover:bg-slate-700"
								style={lokasi === presetLoc
									? 'background: var(--p, #1F6592); color: #fff; border-color: transparent;'
									: 'background: var(--sys-fill); border-color: var(--sys-sep); color: var(--sys-label3)'}
								onclick={() => (lokasi = presetLoc)}
							>
								{presetLoc}
							</button>
						{/each}
					</div>
					<div class="relative">
						<IconMapPin size={16} class="absolute left-3 top-1/2 -translate-y-1/2" style="color: var(--sys-label3)" />
						<input
							id="lokasi"
							type="text"
							class="w-full h-10 pl-9 pr-3 rounded-xl border text-xs focus:outline-none focus:ring-1"
							style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
							placeholder="Ketik lokasi lain jika tidak ada pada pilihan di atas..."
							bind:value={lokasi}
						/>
					</div>
				</div>
			</div>

			<!-- Section 5: Prioritas & Target SLA -->
			<div class="p-5 rounded-3xl border" style="background: var(--sys-bg-secondary, #fff); border-color: var(--sys-sep)">
				<div class="flex items-center justify-between mb-3">
					<label class="text-xs font-bold uppercase tracking-wider block" style="color: var(--sys-label3)">
						Prioritas & Target SLA Pengerjaan
					</label>
					<span class="text-[11px] font-semibold text-blue-600 dark:text-blue-400">
						{PRIORITAS_META[prioritas]?.slaText || ''}
					</span>
				</div>

				<div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
					{#each Object.entries(PRIORITAS_META) as [key, meta]}
						{@const isSelected = prioritas === key}
						<button
							type="button"
							class="p-3 rounded-2xl border text-left transition-all duration-200 relative flex flex-col justify-between"
							style={isSelected
								? `background: ${meta.bg}; border-color: ${meta.color}; box-shadow: 0 0 0 2px ${meta.color}20`
								: 'background: var(--sys-fill); border-color: var(--sys-sep)'}
							onclick={() => (prioritas = key)}
						>
							<div class="flex items-center justify-between mb-1.5">
								<span class="text-xs font-bold" style="color: {isSelected ? meta.color : 'var(--sys-label)'}">
									{meta.label}
								</span>
								{#if isSelected}
									<span class="w-3.5 h-3.5 rounded-full flex items-center justify-center text-[9px] font-bold" style="background: {meta.color}; color: #fff">
										✓
									</span>
								{/if}
							</div>
							<p class="text-[10px] leading-tight" style="color: var(--sys-label3)">
								{meta.slaText}
							</p>
						</button>
					{/each}
				</div>
			</div>

			{#if errorMsg}
				<div class="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium">
					{errorMsg}
				</div>
			{/if}

			<!-- Submit Bar -->
			<div class="flex items-center justify-end gap-3 pt-2">
				<button
					type="button"
					class="px-5 py-3 rounded-xl text-xs font-semibold border transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
					style="border-color: var(--sys-sep); color: var(--sys-label)"
					onclick={() => goto('/ga-request')}
				>
					Batal
				</button>

				<button
					type="button"
					class="h-12 px-6 rounded-xl text-xs font-bold text-white flex items-center gap-2 shadow-md transition-all disabled:opacity-40"
					style="background: var(--p, #1F6592)"
					disabled={!canSubmit || submitting}
					onclick={handleSubmit}
				>
					{#if submitting}
						<IconLoader2 size={16} class="animate-spin" />
						Mengirim...
					{:else}
						Kirim Permintaan GA
					{/if}
				</button>
			</div>
		</div>
	{/if}
</div>

