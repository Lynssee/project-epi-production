<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getSurveyById, type SurveyDetail } from '$lib/services/sales';
	// Pola toast global repo ini: Toast.svelte lewat window.__showToast (bukan svelte-sonner)
	const toast = {
		success: (m: string) => (window as any).__showToast?.(m, 'success'),
		error: (m: string) => (window as any).__showToast?.(m, 'error')
	};
	import { formatQuickEstimateRange, buildWhatsAppDraft, type QuickEstimateResult } from '$lib/utils/quickEstimator';
	import {
		IconArrowLeft,
		IconLoader2,
		IconMapPin,
		IconCalendar,
		IconPhone,
		IconUser,
		IconFileDollar,
		IconPhoto,
		IconX,
		IconBolt,
		IconDroplet,
		IconClock,
		IconShieldCheck,
		IconBuildingStore,
		IconRulerMeasure,
		IconCalculator,
		IconCopy
	} from '@tabler/icons-svelte';

	const JASA_LABEL: Record<string, string> = {
		sandblasting: 'Sandblasting',
		painting: 'Industrial Painting',
		floor_coating: 'Floor Coating / Epoxy'
	};

	function estimasiResult(s: SurveyDetail): (QuickEstimateResult & { jenisJasaLabel?: string }) | null {
		if (s.estimasi_kasar_snapshot?.valid) return s.estimasi_kasar_snapshot as QuickEstimateResult;
		if (s.estimasi_kasar_min == null || s.estimasi_kasar_max == null) return null;
		return {
			valid: true,
			errors: [],
			jenisJasa: s.estimasi_kasar_jenis_jasa || undefined,
			jenisJasaLabel: s.estimasi_kasar_jenis_jasa ? JASA_LABEL[s.estimasi_kasar_jenis_jasa] : undefined,
			luasArea: s.luas_area ?? undefined,
			estimasiTotal: { nilai: (s.estimasi_kasar_min + s.estimasi_kasar_max) / 2, min: s.estimasi_kasar_min, max: s.estimasi_kasar_max },
			estimasiPerM2:
				s.estimasi_kasar_per_m2_min != null && s.estimasi_kasar_per_m2_max != null
					? {
							nilai: (s.estimasi_kasar_per_m2_min + s.estimasi_kasar_per_m2_max) / 2,
							min: s.estimasi_kasar_per_m2_min,
							max: s.estimasi_kasar_per_m2_max
						}
					: undefined
		};
	}

	async function salinEstimasiWA(s: SurveyDetail) {
		const est = estimasiResult(s);
		if (!est) return;
		const teks = buildWhatsAppDraft(est, { jasaLabel: est.jenisJasaLabel, customerName: s.customer_name || undefined });
		try {
			await navigator.clipboard.writeText(teks);
			toast.success('Draft ringkasan disalin — tempel langsung ke chat WhatsApp.');
		} catch {
			toast.error('Gagal menyalin otomatis. Salin manual dari catatan survey.');
		}
	}

	let surveyId = $derived(Number($page.params.id));

	let loading = $state(true);
	let survey = $state<SurveyDetail | null>(null);
	let selectedPhoto = $state<string | null>(null);

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && roles.length > 0 && !hasPermission(roleId, 'input_sales', roles, $authStore.roleIds)) {
			goto('/');
		}
	});

	onMount(async () => {
		try {
			survey = await getSurveyById(surveyId);
		} catch (e) {
			console.error('[sales/survey/[id]] Error loading survey detail:', e);
		} finally {
			loading = false;
		}
	});
</script>

<div class="scroll-body">
	<div class="max-w-2xl mx-auto p-4 pb-24">
		<button
			type="button"
			class="flex items-center gap-1.5 text-[12px] font-medium mb-3"
			style="color: var(--sys-label3)"
			onclick={() => goto('/sales/survey')}
		>
			<IconArrowLeft size={15} /> Kembali ke Daftar Survey
		</button>

		{#if loading}
		<div class="flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat rincian survey lapangan..." />
		</div>
		{:else if !survey}
			<div class="text-center py-16 text-[13px]" style="color: var(--sys-label3)">Data survey tidak ditemukan.</div>
		{:else}
			<!-- Survey Header Card -->
			<div class="rounded-2xl border p-4 mb-4 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="flex items-start justify-between gap-2 mb-2">
					<div>
						<span class="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-blue-500/10 text-[var(--p,var(--g))]">
							{survey.nomor_survey}
						</span>
						<h1 class="text-[18px] font-extrabold mt-1.5" style="color: var(--sys-label)">
							{survey.customer_name || survey.lokasi_project}
						</h1>
					</div>
					<span class="shrink-0 text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
						{survey.status === 'completed' ? 'Selesai' : 'Draft'}
					</span>
				</div>

				<div class="flex items-center flex-wrap gap-x-4 gap-y-1 text-[11px] pt-2 border-t" style="border-color: var(--sys-sep); color: var(--sys-label3)">
					<span class="flex items-center gap-1">
						<IconCalendar size={13} /> Tanggal Survey: {survey.tanggal_survey}
					</span>
					{#if survey.surveyor}
						<span class="flex items-center gap-1">
							<IconUser size={13} /> Surveyor: {survey.surveyor}
						</span>
					{/if}
				</div>
			</div>

			<!-- Quick Action: Buat Penawaran & Customer Info -->
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-4">
				<button
					type="button"
					class="h-11 px-4 rounded-xl text-[12px] font-bold text-white flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-transform"
					style="background: var(--p, var(--g))"
					onclick={() => {
						if (!survey) return;
						const q = new URLSearchParams({
							survey_id: String(survey.id),
							customer_id: String(survey.customer_id || ''),
							customer_name: survey.customer_name || '',
							lokasi: survey.lokasi_project || '',
							luas: survey.luas_area != null ? String(survey.luas_area) : ''
						});
						if (survey.estimasi_kasar_jenis_jasa) q.set('jenis_jasa', survey.estimasi_kasar_jenis_jasa);
						if (survey.estimasi_kasar_min != null) q.set('estimasi_min', String(survey.estimasi_kasar_min));
						if (survey.estimasi_kasar_max != null) q.set('estimasi_max', String(survey.estimasi_kasar_max));
						goto(`/sales/penawaran/baru?${q.toString()}`);
					}}
				>
					<IconFileDollar size={16} /> Buat Penawaran dari Hasil Survey
				</button>

				{#if survey.customer_id}
					<a
						href={`/sales/customer/${survey.customer_id}`}
						class="h-11 px-4 rounded-xl text-[12px] font-bold border flex items-center justify-center gap-1.5 hover:bg-black/5 dark:hover:bg-white/5 active:scale-95 transition-transform"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
					>
						<IconBuildingStore size={16} class="text-blue-500" /> Lihat Profil Customer
					</a>
				{/if}
			</div>

			<!-- Section 1: Info Proyek & PIC Lapangan -->
			<div class="rounded-2xl border p-4 mb-4 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="flex items-center justify-between mb-3">
					<h2 class="text-[13px] font-bold flex items-center gap-1.5" style="color: var(--sys-label)">
						<IconMapPin size={15} style="color: var(--p, var(--g))" /> Lokasi & PIC Lapangan
					</h2>
					{#if survey.lokasi_project}
						<a
							href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(survey.lokasi_project)}`}
							target="_blank"
							rel="noopener noreferrer"
							class="text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
						>
							<IconMapPin size={13} /> Buka di Google Maps
						</a>
					{/if}
				</div>
				<div class="flex flex-col gap-2.5 text-[12px]">
					<div>
						<span class="text-[10px] font-semibold block" style="color: var(--sys-label3)">Lokasi Project / Alamat Pabrik:</span>
						<p class="font-medium mt-0.5 leading-relaxed" style="color: var(--sys-label)">{survey.lokasi_project || '-'}</p>
					</div>

					{#if survey.tanggal_mulai_target || survey.tanggal_selesai_target}
						<div class="grid grid-cols-2 gap-3 pt-2 border-t" style="border-color: var(--sys-sep)">
							<div>
								<span class="text-[10px] font-semibold block" style="color: var(--sys-label3)">Target Mulai Pengerjaan:</span>
								<p class="font-bold mt-0.5" style="color: var(--sys-label)">{survey.tanggal_mulai_target || '-'}</p>
							</div>
							<div>
								<span class="text-[10px] font-semibold block" style="color: var(--sys-label3)">Target Selesai:</span>
								<p class="font-bold mt-0.5" style="color: var(--sys-label)">{survey.tanggal_selesai_target || '-'}</p>
							</div>
						</div>
					{/if}

					<div class="grid grid-cols-2 gap-3 pt-2 border-t" style="border-color: var(--sys-sep)">
						<div>
							<span class="text-[10px] font-semibold block" style="color: var(--sys-label3)">PIC Lapangan:</span>
							<p class="font-medium mt-0.5" style="color: var(--sys-label)">{survey.pic_lapangan || '-'}</p>
						</div>
						<div>
							<span class="text-[10px] font-semibold block" style="color: var(--sys-label3)">No. HP PIC:</span>
							{#if survey.pic_lapangan_telp}
								<a
									href={`tel:${survey.pic_lapangan_telp}`}
									class="font-bold flex items-center gap-1 mt-0.5 hover:underline"
									style="color: var(--p, var(--g))"
								>
									<IconPhone size={12} /> {survey.pic_lapangan_telp}
								</a>
							{:else}
								<p class="font-medium mt-0.5" style="color: var(--sys-label3)">-</p>
							{/if}
						</div>
					</div>
				</div>
			</div>

			<!-- Section 2: Spesifikasi Teknis -->
			<div class="rounded-2xl border p-4 mb-4 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<h2 class="text-[13px] font-bold mb-3 flex items-center gap-1.5" style="color: var(--sys-label)">
					<IconRulerMeasure size={15} style="color: var(--p, var(--g))" /> Spesifikasi Teknis & Luas
				</h2>
				<div class="grid grid-cols-2 gap-3 text-[12px]">
					<div class="p-3 rounded-xl" style="background: var(--sys-fill)">
						<span class="text-[10px] font-semibold block" style="color: var(--sys-label3)">Luas Area:</span>
						<p class="text-[15px] font-extrabold mt-0.5" style="color: var(--sys-label)">
							{survey.luas_area != null ? `${survey.luas_area} m²` : '-'}
						</p>
					</div>
					<div class="p-3 rounded-xl" style="background: var(--sys-fill)">
						<span class="text-[10px] font-semibold block" style="color: var(--sys-label3)">Kondisi Permukaan:</span>
						<p class="text-[13px] font-bold mt-0.5" style="color: var(--sys-label)">
							{survey.kondisi_permukaan || '-'}
						</p>
					</div>
				</div>

				{#if survey.akses_lokasi}
					<div class="mt-3 text-[12px]">
						<span class="text-[10px] font-semibold block" style="color: var(--sys-label3)">Akses Lokasi & Peralatan:</span>
						<p class="mt-0.5 leading-relaxed" style="color: var(--sys-label)">{survey.akses_lokasi}</p>
					</div>
				{/if}
			</div>

			<!-- Section 2b: Quick Estimasi Harga (hasil tersimpan saat survey) -->
			{#if estimasiResult(survey)}
				{@const est = estimasiResult(survey)}
				<div class="rounded-2xl border p-4 mb-4 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
					<h2 class="text-[13px] font-bold mb-2 flex items-center gap-1.5" style="color: var(--sys-label)">
						<IconCalculator size={15} style="color: var(--p, var(--g))" /> Quick Estimasi Harga ({est?.jenisJasaLabel || '-'})
					</h2>
					<div class="rounded-xl p-3 mb-2.5" style="background: var(--sys-fill)">
						<span class="text-[10px] font-semibold block mb-0.5" style="color: var(--sys-label3)">Estimasi Total:</span>
						<p class="text-[17px] font-extrabold" style="color: var(--p, var(--g))">{est ? formatQuickEstimateRange(est) : '-'}</p>
						{#if est?.estimasiPerM2}
							<span class="text-[10px] block mt-1" style="color: var(--sys-label3)">±{formatQuickEstimateRange(est, { perM2: true })}</span>
						{/if}
					</div>
					<p class="text-[10px] mb-2.5" style="color: var(--sys-label3)">
						Angka kasar saat survey — bukan penawaran resmi. Gunakan "Buat Penawaran" untuk hitungan detail &amp; resmi.
					</p>
					<button
						type="button"
						class="w-full h-9 rounded-xl text-[11px] font-bold border flex items-center justify-center gap-1.5 active:scale-95 transition-transform"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						onclick={() => salinEstimasiWA(survey)}
					>
						<IconCopy size={14} /> Salin Ringkasan ke WhatsApp
					</button>
				</div>
			{/if}

			<!-- Section 3: Fasilitas & Utilitas Lapangan -->
			<div class="rounded-2xl border p-4 mb-4 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<h2 class="text-[13px] font-bold mb-3 flex items-center gap-1.5" style="color: var(--sys-label)">
					<IconBolt size={15} style="color: var(--p, var(--g))" /> Utilitas & Fasilitas Kerja
				</h2>
				<div class="grid grid-cols-3 gap-2 text-center text-[11px] mb-3">
					<div class="p-2.5 rounded-xl border" style="border-color: var(--sys-sep); background: var(--sys-fill)">
						<span class="text-[10px] block opacity-70">Listrik</span>
						<strong class="text-[12px]" style="color: {survey.ketersediaan_listrik === 'ADA' ? 'var(--ggd)' : 'var(--red)'}">
							{survey.ketersediaan_listrik || '-'}
						</strong>
					</div>
					<div class="p-2.5 rounded-xl border" style="border-color: var(--sys-sep); background: var(--sys-fill)">
						<span class="text-[10px] block opacity-70">Air</span>
						<strong class="text-[12px]" style="color: {survey.ketersediaan_air === 'ADA' ? 'var(--ggd)' : 'var(--red)'}">
							{survey.ketersediaan_air || '-'}
						</strong>
					</div>
					<div class="p-2.5 rounded-xl border" style="border-color: var(--sys-sep); background: var(--sys-fill)">
						<span class="text-[10px] block opacity-70">Toilet</span>
						<strong class="text-[12px]" style="color: {survey.ketersediaan_toilet === 'ADA' ? 'var(--ggd)' : 'var(--red)'}">
							{survey.ketersediaan_toilet || '-'}
						</strong>
					</div>
				</div>

				<div class="grid grid-cols-2 gap-3 text-[12px] pt-2 border-t" style="border-color: var(--sys-sep)">
					<div>
						<span class="text-[10px] font-semibold block" style="color: var(--sys-label3)">Jam Kerja Diizinkan:</span>
						<p class="font-bold mt-0.5" style="color: var(--sys-label)">{survey.jam_kerja_diizinkan || '-'}</p>
					</div>
					<div>
						<span class="text-[10px] font-semibold block" style="color: var(--sys-label3)">Shift Kerja:</span>
						<p class="font-bold mt-0.5" style="color: var(--sys-label)">{survey.shift_kerja || '-'}</p>
					</div>
				</div>
			</div>

			<!-- Section 4: Aspek K3 & Catatan Khusus -->
			{#if survey.kebutuhan_safety || survey.catatan_khusus}
				<div class="rounded-2xl border p-4 mb-4 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
					<h2 class="text-[13px] font-bold mb-2.5 flex items-center gap-1.5" style="color: var(--sys-label)">
						<IconShieldCheck size={15} style="color: var(--p, var(--g))" /> K3 & Catatan Khusus
					</h2>
					{#if survey.kebutuhan_safety}
						<div class="text-[12px] mb-2.5">
							<span class="text-[10px] font-semibold block" style="color: var(--sys-label3)">Kebutuhan Safety:</span>
							<p class="mt-0.5 leading-relaxed" style="color: var(--sys-label)">{survey.kebutuhan_safety}</p>
						</div>
					{/if}
					{#if survey.catatan_khusus}
						<div class="text-[12px]">
							<span class="text-[10px] font-semibold block" style="color: var(--sys-label3)">Catatan Khusus:</span>
							<p class="mt-0.5 leading-relaxed" style="color: var(--sys-label)">{survey.catatan_khusus}</p>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Section 5: Galeri Foto Lapangan -->
			<div class="rounded-2xl border p-4 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<h2 class="text-[13px] font-bold mb-3 flex items-center gap-1.5" style="color: var(--sys-label)">
					<IconPhoto size={15} style="color: var(--p, var(--g))" /> Foto Dokumentasi ({survey.images.length})
				</h2>

				{#if survey.images.length === 0}
					<p class="text-[12px] text-center py-6" style="color: var(--sys-label3)">Tidak ada lampiran foto untuk survey ini.</p>
				{:else}
					<div class="grid grid-cols-3 gap-2">
						{#each survey.images as img (img.id)}
							{@const src = `/api/directus/assets/${img.file_id}`}
							<button
								type="button"
								class="aspect-square rounded-xl overflow-hidden border relative group active:scale-95 transition-transform"
								style="border-color: var(--sys-sep)"
								onclick={() => (selectedPhoto = src)}
							>
								<img src={src} alt="Foto Survey" class="w-full h-full object-cover" loading="lazy" />
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Fullscreen Photo Modal -->
			{#if selectedPhoto}
				<div class="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center p-4">
					<button
						type="button"
						class="absolute top-4 right-4 text-white p-2 rounded-full bg-white/10 hover:bg-white/20"
						onclick={() => (selectedPhoto = null)}
						aria-label="Tutup"
					>
						<IconX size={20} />
					</button>
					<img src={selectedPhoto} alt="Foto Preview" class="max-w-full max-h-[85vh] object-contain rounded-xl" />
				</div>
			{/if}
		{/if}
	</div>
</div>
