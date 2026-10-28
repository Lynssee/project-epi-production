<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		getCustomerOptions,
		getCustomerById,
		getRecentVisitedCustomers,
		submitSurvey,
		resolveSalesDisplayName,
		KETERSEDIAAN_OPTIONS,
		JAM_KERJA_OPTIONS,
		SHIFT_KERJA_OPTIONS,
		KONDISI_PERMUKAAN_OPTIONS,
		type CustomerOption
	} from '$lib/services/sales';
	import {
		IconArrowLeft,
		IconLoader2,
		IconCamera,
		IconSearch,
		IconX,
		IconTrash,
		IconMapPin,
		IconBolt,
		IconRulerMeasure,
		IconShieldCheck,
		IconBuildingStore,
		IconCircleCheckFilled,
		IconUser,
		IconPhone,
		IconCalendar,
		IconCalendarEvent,
		IconSparkles
	} from '@tabler/icons-svelte';
	import { onMount } from 'svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import QuickEstimatorCard from '$lib/components/sales/QuickEstimatorCard.svelte';
	import type { QuickEstimateResult } from '$lib/utils/quickEstimator';

	let search = $state('');
	let customers = $state<CustomerOption[]>([]);
	let recentCustomers = $state<CustomerOption[]>([]);
	let selectedCustomer = $state<CustomerOption | null>(null);
	let searching = $state(false);
	let searchTimer: ReturnType<typeof setTimeout>;

	let prospectId = $state<number | null>(null);
	let lokasiProject = $state('');
	let picLapangan = $state('');
	let picLapanganTelp = $state('');
	let tanggalMulaiTarget = $state('');
	let tanggalSelesaiTarget = $state('');
	let luasArea = $state('');
	let kondisiPermukaan = $state('');
	let aksesLokasi = $state('');
	let ketersediaanListrik = $state('');
	let ketersediaanAir = $state('');
	let ketersediaanToilet = $state('');
	let jamKerjaDiizinkan = $state('');
	let shiftKerja = $state('');
	let akomodasi = $state('');
	let kebutuhanSafety = $state('');
	let catatanKhusus = $state('');
	let photoFiles = $state<File[]>([]);
	let photoPreviews = $state<string[]>([]);

	let quickEstimate = $state<(QuickEstimateResult & { jenisJasaLabel?: string }) | null>(null);

	let submitting = $state(false);
	let errorMsg = $state('');

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && roles.length > 0 && !hasPermission(roleId, 'input_sales', roles, $authStore.roleIds)) {
			goto('/');
		}
	});

	interface SurveyDraft {
		customerId: number | null;
		customerName: string;
		search: string;
		prospectId: number | null;
		lokasiProject: string;
		picLapangan: string;
		picLapanganTelp: string;
		tanggalMulaiTarget: string;
		tanggalSelesaiTarget: string;
		luasArea: string;
		kondisiPermukaan: string;
		aksesLokasi: string;
		ketersediaanListrik: string;
		ketersediaanAir: string;
		ketersediaanToilet: string;
		jamKerjaDiizinkan: string;
		shiftKerja: string;
		akomodasi: string;
		kebutuhanSafety: string;
		catatanKhusus: string;
		photoCount: number;
	}

	const surveyPersist = createFormPersist<SurveyDraft>('sales_survey_baru');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function surveySnapshot(): SurveyDraft {
		return {
			customerId: selectedCustomer?.id ?? null,
			customerName: selectedCustomer?.customer_name ?? '',
			search,
			prospectId,
			lokasiProject,
			picLapangan,
			picLapanganTelp,
			tanggalMulaiTarget,
			tanggalSelesaiTarget,
			luasArea,
			kondisiPermukaan,
			aksesLokasi,
			ketersediaanListrik,
			ketersediaanAir,
			ketersediaanToilet,
			jamKerjaDiizinkan,
			shiftKerja,
			akomodasi,
			kebutuhanSafety,
			catatanKhusus,
			photoCount: photoFiles.length
		};
	}

	async function persistPhotos() {
		await surveyPersist.clearPhotos();
		await Promise.all(photoFiles.map((f, i) => surveyPersist.savePhoto(`foto_${i}`, f)));
		photoPreviews = photoFiles.map((f) => URL.createObjectURL(f));
	}

	onMount(async () => {
		// 1. Check query parameters first
		const params = $page.url.searchParams;
		const paramCustomerId = params.get('customer_id');
		const paramCustomerName = params.get('customer_name');
		const paramProspectId = params.get('prospect_id');
		const paramLokasi = params.get('lokasi');
		const paramPic = params.get('pic');
		const paramTelp = params.get('telp');
		const paramLuas = params.get('luas');

		if (paramProspectId) prospectId = Number(paramProspectId) || null;
		if (paramLokasi) lokasiProject = paramLokasi;
		if (paramPic) picLapangan = paramPic;
		if (paramTelp) picLapanganTelp = paramTelp;
		if (paramLuas) luasArea = paramLuas;
		if (paramCustomerName && !paramCustomerId) search = paramCustomerName;

		if (paramCustomerId) {
			const cId = Number(paramCustomerId);
			if (cId) {
				const cust = await getCustomerById(cId);
				if (cust) {
					selectCustomer(cust);
				}
			}
		}

		// 2. Load recent visited customers
		const salesId = $authStore.karyawanId || null;
		getRecentVisitedCustomers(salesId, 6).then((res) => {
			recentCustomers = res;
		});

		// 3. Restore draft if available and not overridden by query params
		if (!paramCustomerId) {
			const draft = surveyPersist.restore();
			if (draft) {
				if (draft.customerId) {
					selectedCustomer = { id: draft.customerId, customer_name: draft.customerName } as CustomerOption;
				}
				search = draft.search || '';
				if (!paramProspectId && draft.prospectId) prospectId = draft.prospectId;
				if (!paramLokasi && draft.lokasiProject) lokasiProject = draft.lokasiProject;
				if (!paramPic && draft.picLapangan) picLapangan = draft.picLapangan;
				if (!paramTelp && draft.picLapanganTelp) picLapanganTelp = draft.picLapanganTelp;
				tanggalMulaiTarget = draft.tanggalMulaiTarget || '';
				tanggalSelesaiTarget = draft.tanggalSelesaiTarget || '';
				if (!paramLuas && draft.luasArea) luasArea = draft.luasArea;
				kondisiPermukaan = draft.kondisiPermukaan;
				aksesLokasi = draft.aksesLokasi;
				ketersediaanListrik = draft.ketersediaanListrik;
				ketersediaanAir = draft.ketersediaanAir;
				ketersediaanToilet = draft.ketersediaanToilet;
				jamKerjaDiizinkan = draft.jamKerjaDiizinkan;
				shiftKerja = draft.shiftKerja;
				akomodasi = draft.akomodasi;
				kebutuhanSafety = draft.kebutuhanSafety;
				catatanKhusus = draft.catatanKhusus;

				const blobs = await Promise.all(
					Array.from({ length: draft.photoCount || 0 }, (_, i) => surveyPersist.restorePhoto(`foto_${i}`))
				);
				photoFiles = blobs
					.map((b, i) => (b ? new File([b], `foto_${i}.jpg`, { type: b.type || 'image/jpeg' }) : null))
					.filter((f): f is File => !!f);
				photoPreviews = photoFiles.map((f) => URL.createObjectURL(f));
				draftSavedAt = new Date();
			}
		}
		draftArmed = true;
	});

	$effect(() => {
		void surveySnapshot();
		if (!draftArmed) return;
		surveyPersist.save(surveySnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(surveyPersist, surveySnapshot));

	function onSearchInput() {
		clearTimeout(searchTimer);
		const q = search.trim();
		if (!q) {
			customers = [];
			searching = false;
			return;
		}
		searching = true;
		searchTimer = setTimeout(async () => {
			customers = await getCustomerOptions(q);
			searching = false;
		}, 250);
	}

	async function selectCustomer(c: CustomerOption) {
		selectedCustomer = c;
		customers = [];
		search = c.customer_name;

		// Autofill PIC & Telp jika ada
		const defaultPic = c.contact_person || c.pic_nama || '';
		if (defaultPic && !picLapangan.trim()) {
			picLapangan = defaultPic;
		}
		const defaultTelp = c.telp || c.telepon || c.pic_telepon || '';
		if (defaultTelp && !picLapanganTelp.trim()) {
			picLapanganTelp = defaultTelp;
		}
	}

	function clearCustomer() {
		selectedCustomer = null;
		search = '';
		customers = [];
	}

	function onPhotoChange(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files) {
			photoFiles = [...photoFiles, ...Array.from(input.files)];
			persistPhotos();
		}
	}

	function removePhoto(index: number) {
		photoFiles = photoFiles.filter((_, i) => i !== index);
		persistPhotos();
	}

	async function handleSubmit() {
		if (submitting) return;
		if (!lokasiProject.trim()) {
			errorMsg = 'Isi lokasi project atau alamat pabrik / area survey.';
			return;
		}
		const salesName = $authStore.karyawanName || resolveSalesDisplayName($authStore.user?.displayName || $authStore.user?.email);
		if (!salesName || salesName === 'Sales Rep') {
			errorMsg = 'Profil karyawan tidak ditemukan di sesi login. Hubungi admin.';
			return;
		}
		submitting = true;
		errorMsg = '';
		try {
			const compressedPhotoFiles = await Promise.all(photoFiles.map((f) => compressPhoto(f)));
			const survey = await submitSurvey({
				surveyorName: salesName,
				customerName: selectedCustomer?.customer_name || search.trim() || 'Customer Lapangan',
				masterCustomerId: selectedCustomer?.id || null,
				prospectId: prospectId || null,
				lokasiProject: lokasiProject.trim(),
				picLapangan: picLapangan.trim(),
				picLapanganTelp: picLapanganTelp.trim(),
				tanggalMulaiTarget: tanggalMulaiTarget || null,
				tanggalSelesaiTarget: tanggalSelesaiTarget || null,
				luasArea: luasArea ? Number(luasArea) : null,
				kondisiPermukaan,
				aksesLokasi: aksesLokasi.trim(),
				ketersediaanListrik,
				ketersediaanAir,
				ketersediaanToilet,
				jamKerjaDiizinkan,
				shiftKerja,
				akomodasi,
				kebutuhanSafety: kebutuhanSafety.trim(),
				catatanKhusus: catatanKhusus.trim(),
				photoFiles: compressedPhotoFiles,
				...(quickEstimate?.valid
					? {
							estimasiKasarJenisJasa: quickEstimate.jenisJasa,
							estimasiKasarMin: quickEstimate.estimasiTotal?.min ?? null,
							estimasiKasarMax: quickEstimate.estimasiTotal?.max ?? null,
							estimasiKasarPerM2Min: quickEstimate.estimasiPerM2?.min ?? null,
							estimasiKasarPerM2Max: quickEstimate.estimasiPerM2?.max ?? null,
							estimasiKasarSnapshot: quickEstimate
						}
					: {})
			});
			surveyPersist.clear();
			await surveyPersist.clearPhotos();
			draftSavedAt = null;
			goto(`/sales/survey/${survey.id}`);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal menyimpan data survey.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="scroll-body">
	<div class="max-w-3xl mx-auto p-4 pb-24">
		<!-- Navigation Bar -->
		<div class="flex items-center justify-between gap-3 mb-3">
			<button
				type="button"
				class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-[12px] font-semibold transition-all hover:bg-black/5 dark:hover:bg-white/5 active:scale-95"
				style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)"
				onclick={() => goto('/sales/survey')}
			>
				<IconArrowLeft size={15} /> Kembali ke Survey
			</button>

			<DraftIndicator savedAt={draftSavedAt} hasPhotos={photoFiles.length > 0} />
		</div>

		<!-- Page Header Banner -->
		<div class="rounded-3xl border p-4 sm:p-5 mb-5 shadow-sm overflow-hidden" style="border-color: var(--sys-sep); background: linear-gradient(135deg, var(--sys-bg) 0%, var(--sys-fill) 100%)">
			<div class="flex items-center gap-2 mb-1">
				<span class="px-2.5 py-0.5 rounded-md text-[10px] font-extrabold uppercase tracking-wider text-white" style="background: var(--p, var(--g))">
					Technical Site Survey
				</span>
				{#if selectedCustomer}
					<span class="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md">
						<IconCircleCheckFilled size={12} /> Customer Terhubung
					</span>
				{/if}
			</div>
			<h1 class="text-[20px] font-extrabold" style="color: var(--sys-label)">Input Survey Lapangan Baru</h1>
			<p class="text-[12px] mt-0.5" style="color: var(--sys-label3)">
				Rekam spesifikasi teknis, kondisi permukaan, utilitas kerja, K3, dan foto bukti untuk acuan kalkulator penawaran.
			</p>
		</div>

		<div class="flex flex-col gap-5">
			<!-- Section 1: Customer & Lokasi Proyek -->
			<div class="rounded-2xl border p-4 sm:p-5 shadow-sm flex flex-col gap-4" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="flex items-center justify-between">
					<h2 class="text-[14px] font-extrabold flex items-center gap-2" style="color: var(--sys-label)">
						<IconBuildingStore size={18} class="text-blue-500" /> 1. Customer & Lokasi Proyek
					</h2>
					{#if selectedCustomer}
						<button
							type="button"
							class="text-[11px] font-bold text-rose-500 hover:underline flex items-center gap-1"
							onclick={clearCustomer}
						>
							<IconX size={13} /> Ganti Customer
						</button>
					{/if}
				</div>

				{#if !selectedCustomer}
					<!-- Customer Autocomplete Search Input -->
					<div class="relative">
						<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">
							Cari Master Customer (atau ketik nama perusahaan baru)
						</label>
						<div class="relative">
							<IconSearch size={16} class="absolute left-3.5 top-1/2 -translate-y-1/2" style="color: var(--sys-label4)" />
							<input
								class="w-full h-11 pl-10 pr-9 rounded-xl border text-[13px] font-medium transition-all focus:outline-none focus:ring-2 focus:ring-[var(--p,var(--g))]/20"
								style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
								placeholder="Ketik nama customer atau kode (mis. Cement, Indocement, Semen Padang)..."
								bind:value={search}
								oninput={onSearchInput}
							/>
							{#if search}
								<button
									type="button"
									class="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-[var(--sys-label3)]"
									onclick={() => { search = ''; customers = []; }}
									aria-label="Bersihkan"
								>
									<IconX size={14} />
								</button>
							{:else if searching}
								<div class="absolute right-3 top-1/2 -translate-y-1/2">
									<IconLoader2 size={15} class="animate-spin text-[var(--sys-label3)]" />
								</div>
							{/if}
						</div>

						<!-- Autocomplete Dropdown List -->
						{#if customers.length > 0}
							<div
								class="absolute z-30 w-full mt-1.5 rounded-2xl border bg-white dark:bg-zinc-900 shadow-2xl max-h-64 overflow-y-auto divide-y"
								style="border-color: var(--sys-sep); divide-color: var(--sys-sep)"
							>
								{#each customers as c (c.id)}
									<button
										type="button"
										class="w-full text-left p-3 text-[12px] hover:bg-blue-500/5 transition-colors flex items-center justify-between group"
										onclick={() => selectCustomer(c)}
									>
										<div class="min-w-0 flex-1 pr-2">
											<p class="font-bold group-hover:text-blue-600 transition-colors" style="color: var(--sys-label)">{c.customer_name}</p>
											{#if c.alamat || c.alamat_surat_jalan}
												<p class="text-[11px] mt-0.5 line-clamp-1" style="color: var(--sys-label3)">
													📍 {c.alamat_surat_jalan || c.alamat}
												</p>
											{/if}
										</div>
										<div class="text-right shrink-0">
											<span class="text-[10px] font-mono font-semibold px-2 py-0.5 rounded-md border" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label2)">
												{c.kode_customer || `#${c.id}`}
											</span>
										</div>
									</button>
								{/each}
							</div>
						{:else if search.trim().length > 1 && !searching}
							<div class="mt-1.5 p-2.5 rounded-xl border bg-black/5 dark:bg-white/5 text-[11px] flex items-center justify-between gap-2" style="border-color: var(--sys-sep); color: var(--sys-label3)">
								<span>Customer "{search}" belum terdaftar di Master. Survey tetap dapat disimpan sebagai customer baru.</span>
							</div>
						{/if}
					</div>

					<!-- Recent Customer Quick Chips -->
					{#if recentCustomers.length > 0}
						<div>
							<p class="text-[10px] font-bold uppercase tracking-wider mb-1.5" style="color: var(--sys-label3)">
								⚡ Customer Terakhir Dikunjungi:
							</p>
							<div class="flex flex-wrap gap-1.5">
								{#each recentCustomers as rc (rc.id)}
									<button
										type="button"
										class="px-2.5 py-1 rounded-lg border text-[11px] font-semibold flex items-center gap-1 hover:border-blue-500 hover:text-blue-600 transition-all active:scale-95"
										style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label2)"
										onclick={() => selectCustomer(rc)}
									>
										<IconBuildingStore size={12} class="opacity-70" />
										<span class="truncate max-w-[160px]">{rc.customer_name}</span>
									</button>
								{/each}
							</div>
						</div>
					{/if}
				{:else}
					<!-- Selected Customer Card -->
					<div class="p-3.5 sm:p-4 rounded-xl border flex flex-col gap-2 relative overflow-hidden" style="border-color: var(--p, #3b82f6); background: rgba(59, 130, 246, 0.05)">
						<div class="flex items-start justify-between gap-2">
							<div class="flex items-start gap-2.5">
								<div class="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0 mt-0.5" style="background: var(--p, #3b82f6)">
									<IconBuildingStore size={18} />
								</div>
								<div>
									<div class="flex items-center gap-2">
										<h3 class="text-[14px] font-bold" style="color: var(--sys-label)">{selectedCustomer.customer_name}</h3>
										<span class="text-[10px] font-mono font-bold px-2 py-0.2 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
											{selectedCustomer.kode_customer || `#${selectedCustomer.id}`}
										</span>
									</div>
									{#if selectedCustomer.alamat || selectedCustomer.alamat_surat_jalan}
										<p class="text-[11px] mt-0.5" style="color: var(--sys-label2)">
											📍 {selectedCustomer.alamat_surat_jalan || selectedCustomer.alamat}
										</p>
									{/if}
									{#if selectedCustomer.contact_person || selectedCustomer.pic_nama || selectedCustomer.telp}
										<div class="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1 text-[11px] font-medium" style="color: var(--sys-label3)">
											{#if selectedCustomer.contact_person || selectedCustomer.pic_nama}
												<span class="flex items-center gap-1"><IconUser size={12} /> PIC: {selectedCustomer.contact_person || selectedCustomer.pic_nama}</span>
											{/if}
											{#if selectedCustomer.telp || selectedCustomer.telepon}
												<span class="flex items-center gap-1"><IconPhone size={12} /> {selectedCustomer.telp || selectedCustomer.telepon}</span>
											{/if}
										</div>
									{/if}
								</div>
							</div>

							<span class="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full shrink-0">
								<IconCircleCheckFilled size={12} /> Terpilih
							</span>
						</div>
					</div>
				{/if}

				<!-- Lokasi Project Input (Autofilled / Editable) -->
				<div>
					<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">
						Lokasi Project / Alamat Pabrik / Area Survey <span class="text-rose-500">*</span>
					</label>
					<div class="relative">
						<IconMapPin size={16} class="absolute left-3.5 top-3.5" style="color: var(--sys-label4)" />
						<textarea
							class="w-full pl-10 pr-3.5 py-2.5 rounded-xl border text-[13px] font-medium transition-all focus:outline-none focus:ring-2 focus:ring-[var(--p,var(--g))]/20"
							style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
							rows="2"
							placeholder="cth. PT Indocement Plant 12 Citeureup, Ruang Tangki Asam Workshop Selatan..."
							bind:value={lokasiProject}
						></textarea>
					</div>
				</div>

				<!-- PIC & Kontak Lapangan -->
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
					<div>
						<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Nama PIC Lapangan</label>
						<div class="relative">
							<IconUser size={15} class="absolute left-3.5 top-1/2 -translate-y-1/2" style="color: var(--sys-label4)" />
							<input
								class="w-full h-11 pl-9 pr-3 rounded-xl border text-[13px] font-medium"
								style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
								placeholder="cth. Pak Joko / Bu Susi"
								bind:value={picLapangan}
							/>
						</div>
					</div>
					<div>
						<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">No. HP / WhatsApp PIC</label>
						<div class="relative">
							<IconPhone size={15} class="absolute left-3.5 top-1/2 -translate-y-1/2" style="color: var(--sys-label4)" />
							<input
								class="w-full h-11 pl-9 pr-3 rounded-xl border text-[13px] font-mono"
								style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
								placeholder="08xxxxxxxxxx"
								bind:value={picLapanganTelp}
							/>
						</div>
					</div>
				</div>
			</div>

			<!-- Section 2: Kondisi Teknis & Estimasi Jadwal -->
			<div class="rounded-2xl border p-4 sm:p-5 shadow-sm flex flex-col gap-4" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<h2 class="text-[14px] font-extrabold flex items-center gap-2" style="color: var(--sys-label)">
					<IconRulerMeasure size={18} class="text-amber-500" /> 2. Kondisi Teknis & Estimasi Luas
				</h2>

				<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
					<div>
						<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Luas Area Estimasi (m²)</label>
						<input
							type="number"
							class="w-full h-11 px-3.5 rounded-xl border text-[13px] font-extrabold"
							style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
							placeholder="cth. 250"
							bind:value={luasArea}
						/>
					</div>
					<div>
						<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Kondisi Permukaan</label>
						<select
							class="w-full h-11 px-3 rounded-xl border text-[13px] font-medium"
							style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
							bind:value={kondisiPermukaan}
						>
							<option value="">-- Pilih Kondisi Permukaan --</option>
							{#each KONDISI_PERMUKAAN_OPTIONS as o}<option value={o}>{o}</option>{/each}
						</select>
					</div>
				</div>

				<!-- Target Schedule (Timeline) -->
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t" style="border-color: var(--sys-sep)">
					<div>
						<label class="text-[11px] font-bold mb-1 block flex items-center gap-1" style="color: var(--sys-label3)">
							<IconCalendarEvent size={13} /> Target Mulai Pengerjaan (opsional)
						</label>
						<input
							type="date"
							class="w-full h-11 px-3 rounded-xl border text-[13px] font-medium"
							style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
							bind:value={tanggalMulaiTarget}
						/>
					</div>
					<div>
						<label class="text-[11px] font-bold mb-1 block flex items-center gap-1" style="color: var(--sys-label3)">
							<IconCalendar size={13} /> Target Selesai Pengerjaan (opsional)
						</label>
						<input
							type="date"
							class="w-full h-11 px-3 rounded-xl border text-[13px] font-medium"
							style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
							bind:value={tanggalSelesaiTarget}
						/>
					</div>
				</div>

				<div>
					<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Akses Lokasi & Manuver Alat / Logistik</label>
					<textarea
						class="w-full rounded-xl border text-[13px] p-3 leading-relaxed"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						rows="2"
						placeholder="Ketinggian scaffolding, akses jalan truk kompresor/blasting, ruang penyimpanan material..."
						bind:value={aksesLokasi}
					></textarea>
				</div>
			</div>

			<!-- Section 3: Utilitas & Waktu Kerja -->
			<div class="rounded-2xl border p-4 sm:p-5 shadow-sm flex flex-col gap-4" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<h2 class="text-[14px] font-extrabold flex items-center gap-2" style="color: var(--sys-label)">
					<IconBolt size={18} class="text-amber-500" /> 3. Fasilitas & Utilitas Kerja Lapangan
				</h2>

				<div class="grid grid-cols-3 gap-2.5">
					<div>
						<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Listrik Kerja</label>
						<select class="w-full h-11 px-2.5 rounded-xl border text-[12px] font-semibold" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)" bind:value={ketersediaanListrik}>
							<option value="">-</option>
							{#each KETERSEDIAAN_OPTIONS as o}<option value={o}>{o}</option>{/each}
						</select>
					</div>
					<div>
						<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Air Bersih</label>
						<select class="w-full h-11 px-2.5 rounded-xl border text-[12px] font-semibold" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)" bind:value={ketersediaanAir}>
							<option value="">-</option>
							{#each KETERSEDIAAN_OPTIONS as o}<option value={o}>{o}</option>{/each}
						</select>
					</div>
					<div>
						<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Toilet / MCK</label>
						<select class="w-full h-11 px-2.5 rounded-xl border text-[12px] font-semibold" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)" bind:value={ketersediaanToilet}>
							<option value="">-</option>
							{#each KETERSEDIAAN_OPTIONS as o}<option value={o}>{o}</option>{/each}
						</select>
					</div>
				</div>

				<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
					<div>
						<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Hari Kerja Diizinkan</label>
						<select class="w-full h-11 px-3 rounded-xl border text-[13px] font-medium" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)" bind:value={jamKerjaDiizinkan}>
							<option value="">-- Pilih Hari Kerja --</option>
							{#each JAM_KERJA_OPTIONS as o}<option value={o}>{o}</option>{/each}
						</select>
					</div>
					<div>
						<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Shift Kerja</label>
						<select class="w-full h-11 px-3 rounded-xl border text-[13px] font-medium" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)" bind:value={shiftKerja}>
							<option value="">-- Pilih Shift Kerja --</option>
							{#each SHIFT_KERJA_OPTIONS as o}<option value={o}>{o}</option>{/each}
						</select>
					</div>
				</div>

				<div>
					<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Akomodasi / Mess Pekerja</label>
					<select class="w-full h-11 px-3 rounded-xl border text-[13px] font-medium" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)" bind:value={akomodasi}>
						<option value="">-- Ketersediaan Mess Lapangan --</option>
						{#each KETERSEDIAAN_OPTIONS as o}<option value={o}>{o}</option>{/each}
					</select>
				</div>
			</div>

			<!-- Quick Estimasi Harga (opsional) — bantu surveyor jawab pertanyaan harga kasar di lokasi -->
			<QuickEstimatorCard
				{luasArea}
				{kondisiPermukaan}
				{ketersediaanListrik}
				{ketersediaanAir}
				customerName={selectedCustomer?.customer_name || ''}
				onEstimate={(r) => (quickEstimate = r)}
			/>

			<!-- Section 4: Aspek K3 & Catatan Khusus -->
			<div class="rounded-2xl border p-4 sm:p-5 shadow-sm flex flex-col gap-4" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<h2 class="text-[14px] font-extrabold flex items-center gap-2" style="color: var(--sys-label)">
					<IconShieldCheck size={18} class="text-emerald-500" /> 4. Aspek K3 & Catatan Khusus
				</h2>

				<div>
					<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Kebutuhan Safety Khusus (K3)</label>
					<textarea
						class="w-full rounded-xl border text-[13px] p-3 leading-relaxed"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						rows="2"
						placeholder="Izin hot work, APD khusus (full body harness, respirator kimia blower, gas detector)..."
						bind:value={kebutuhanSafety}
					></textarea>
				</div>

				<div>
					<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Catatan Tambahan & Request Customer</label>
					<textarea
						class="w-full rounded-xl border text-[13px] p-3 leading-relaxed"
						style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
						rows="2"
						placeholder="Catatan jam operasional pabrik, vendor pendukung, persyaratan garansi..."
						bind:value={catatanKhusus}
					></textarea>
				</div>
			</div>

			<!-- Section 5: Foto Dokumentasi Lapangan -->
			<div class="rounded-2xl border p-4 sm:p-5 shadow-sm flex flex-col gap-4" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="flex items-center justify-between">
					<h2 class="text-[14px] font-extrabold flex items-center gap-2" style="color: var(--sys-label)">
						<IconCamera size={18} class="text-purple-500" /> 5. Foto Dokumentasi Lapangan
					</h2>
					<span class="text-[11px] font-bold px-2 py-0.5 rounded-full bg-black/5 dark:bg-white/5" style="color: var(--sys-label2)">
						{photoFiles.length} Foto
					</span>
				</div>

				{#if photoPreviews.length > 0}
					<div class="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
						{#each photoPreviews as prev, idx}
							<div class="aspect-square rounded-2xl overflow-hidden border relative group shadow-xs" style="border-color: var(--sys-sep)">
								<img src={prev} alt="Preview Survey" class="w-full h-full object-cover" />
								<button
									type="button"
									class="absolute top-2 right-2 w-7 h-7 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-md active:scale-95 transition-transform"
									onclick={() => removePhoto(idx)}
									aria-label="Hapus Foto"
								>
									<IconTrash size={14} />
								</button>
							</div>
						{/each}
					</div>
				{/if}

				<label class="flex items-center justify-center gap-2.5 h-24 rounded-2xl border-2 border-dashed cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors" style="border-color: var(--sys-sep)">
					<div class="flex flex-col items-center gap-1.5" style="color: var(--sys-label2)">
						<IconCamera size={24} class="text-purple-500" />
						<span class="text-[12px] font-bold">Ambil Foto / Upload Dokumen Visual</span>
						<span class="text-[10px] opacity-70">Mendukung multi-upload langsung dari kamera HP / galeri</span>
					</div>
					<input type="file" accept="image/*" capture="environment" multiple class="hidden" onchange={onPhotoChange} />
				</label>
			</div>

			{#if errorMsg}
				<div class="p-3.5 rounded-2xl border bg-rose-500/10 border-rose-500/30 text-[12px] text-rose-600 dark:text-rose-400 font-semibold">
					{errorMsg}
				</div>
			{/if}

			<button
				type="button"
				class="w-full h-13 rounded-2xl text-[14px] font-extrabold text-white flex items-center justify-center gap-2.5 shadow-md shadow-[var(--p,var(--g))]/25 disabled:opacity-50 transition-all active:scale-[0.99]"
				style="background: var(--p, var(--g))"
				disabled={submitting}
				onclick={handleSubmit}
			>
				{#if submitting}
					<IconLoader2 size={18} class="animate-spin" />
					<span>Menyimpan & Mengupload Foto...</span>
				{:else}
					<IconSparkles size={18} />
					<span>Simpan Data Survey Lapangan</span>
				{/if}
			</button>
		</div>
	</div>
</div>
