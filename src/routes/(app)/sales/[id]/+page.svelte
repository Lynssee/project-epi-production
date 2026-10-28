<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getVisitById, submitVisit, type VisitSalesRow } from '$lib/services/sales';
	// Paket 08c §5.3 — write-ahead offline untuk SUBMIT hasil (bukan hanya check-in): entri
	// ditulis ke antrean SEBELUM mencoba kirim online, pola sama /sales/baru.
	import { enqueueSiteCheckinSubmission, removeQueuedSiteCheckinSubmission } from '$lib/utils/offlineSiteCheckinQueue';
	import { isRetryableError, pesanErrorAwam } from '$lib/utils/networkError';
	import {
		IconArrowLeft,
		IconLoader2,
		IconCamera,
		IconMapPin,
		IconCircleCheck,
		IconCircleX,
		IconBuildingStore,
		IconCalendar,
		IconUser,
		IconClock
	} from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { compressPhoto } from '$lib/utils/photoCompress';
	// Paket 08c Site Visit Release §5.2 — kamera langsung + watermark (bukan <input capture> biasa,
	// yang bisa diisi dari galeri), GPS checkout dipantau sampai akurat seperti check-in (§5.1).
	import { watchPositionUntilAccurate } from '$lib/utils/geoClient';
	import { watermarkPhoto } from '$lib/utils/photoWatermark';
	import CameraCaptureModal from '$lib/components/scanner/CameraCaptureModal.svelte';
	import SalesVisitExpenseSection from '$lib/components/sales/SalesVisitExpenseSection.svelte';

	let visitId = $derived(Number($page.params.id));

	let loading = $state(true);
	let submitting = $state(false);
	let errorMsg = $state('');
	let visit = $state<VisitSalesRow | null>(null);
	let hasilKunjungan = $state('');
	let followUpDate = $state('');
	let nextAction = $state('');
	let kegiatan = $state('');
	let photoFile = $state<File | null>(null);
	let photoPreview = $state<string | null>(null);
	let submitted = $state(false);
	// Paket 08c §5.3 — true bila submit tersimpan di antrean offline (bukan benar-benar terkirim
	// ke server) — pesan dan ikon harus beda, JANGAN klaim "terkirim" padahal baru tersimpan di HP.
	let submittedOffline = $state(false);
	let showCamera = $state(false);
	let memprosesFoto = $state(false);

	// §5.2 — identitas PIC yang ditemui + status BANT (opsional, menambah kualitas data pipeline).
	let picDitemui = $state('');
	let jabatanPic = $state('');
	let noWaPic = $state('');
	let bantBudget = $state('');
	let bantAuthority = $state('');
	let bantNeed = $state('');
	let bantTimeline = $state('');
	const BANT_BUDGET_OPTS = [
		{ value: 'ada', label: '✅ Ada' },
		{ value: 'belum', label: '❌ Belum' },
		{ value: 'belum_tahu', label: '❓ Belum Tahu' }
	];
	const BANT_AUTHORITY_OPTS = [
		{ value: 'decision_maker', label: '✅ Decision Maker' },
		{ value: 'bukan', label: '❌ Bukan' },
		{ value: 'belum_tahu', label: '❓ Belum Tahu' }
	];
	const BANT_NEED_OPTS = [
		{ value: 'ada', label: '✅ Ada Kebutuhan' },
		{ value: 'tidak', label: '❌ Tidak' },
		{ value: 'belum_tahu', label: '❓ Belum Tahu' }
	];
	const BANT_TIMELINE_OPTS = [
		{ value: '<3bulan', label: '✅ < 3 bulan' },
		{ value: '3-6bulan', label: '⏳ 3-6 bulan' },
		{ value: '>6bulan', label: '📅 > 6 bulan' }
	];

	// GPS checkout — dipantau sampai akurat (<=50m) atau timeout, pola sama /sales/baru §5.1.
	let gpsCoords = $state<{ latitude: number; longitude: number; accuracy: number } | null>(null);
	let refiningLocation = $state(false);
	let stopWatchingPosition: (() => void) | null = null;
	function startWatchingLocation() {
		stopWatchingPosition?.();
		refiningLocation = true;
		stopWatchingPosition = watchPositionUntilAccurate(
			(pos) => {
				gpsCoords = { latitude: pos.lat, longitude: pos.lng, accuracy: pos.accuracy };
				if (pos.accuracy <= 50) refiningLocation = false;
			},
			() => {
				refiningLocation = false; // fail-soft: GPS checkout opsional, submit tetap bisa tanpa koordinat
			},
			{ targetAccuracyM: 50, timeoutMs: 20000 }
		);
		setTimeout(() => (refiningLocation = false), 20000);
	}

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && roles.length > 0 && !hasPermission(roleId, 'input_sales', roles, $authStore.roleIds)) {
			goto('/');
		}
	});

	interface VisitDraft {
		hasilKunjungan: string;
		followUpDate: string;
		nextAction: string;
		kegiatan: string;
		picDitemui: string;
		jabatanPic: string;
		noWaPic: string;
	}
	const VISIT_PHOTO_KEY = 'bukti';
	let visitPersist = $derived(createFormPersist<VisitDraft>(`sales_visit_${visitId}`));
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function visitSnapshot(): VisitDraft {
		return { hasilKunjungan, followUpDate, nextAction, kegiatan, picDitemui, jabatanPic, noWaPic };
	}

	onMount(async () => {
		visit = await getVisitById(visitId);
		if (visit) kegiatan = visit.kegiatan || '';

		startWatchingLocation();

		const draft = visitPersist.restore();
		if (draft) {
			hasilKunjungan = draft.hasilKunjungan;
			followUpDate = draft.followUpDate;
			nextAction = draft.nextAction || '';
			kegiatan = draft.kegiatan;
			picDitemui = draft.picDitemui || '';
			jabatanPic = draft.jabatanPic || '';
			noWaPic = draft.noWaPic || '';
			const blob = await visitPersist.restorePhoto(VISIT_PHOTO_KEY);
			if (blob) {
				photoFile = new File([blob], 'bukti.jpg', { type: blob.type || 'image/jpeg' });
				photoPreview = URL.createObjectURL(photoFile);
			}
			draftSavedAt = new Date();
		}
		draftArmed = true;
		loading = false;
	});

	onDestroy(() => stopWatchingPosition?.());

	$effect(() => {
		void visitSnapshot();
		if (!draftArmed) return;
		visitPersist.save(visitSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(visitPersist, visitSnapshot));

	async function handleCapture(file: File) {
		showCamera = false;
		memprosesFoto = true;
		try {
			const gps = gpsCoords
				? { lat: gpsCoords.latitude, lng: gpsCoords.longitude, accuracy: gpsCoords.accuracy }
				: null;
			const stamped = await watermarkPhoto(file, gps, new Date().toISOString(), {
				lokasi: visit?.customer_name || undefined
			});
			const compressed = await compressPhoto(stamped);
			photoFile = compressed;
			photoPreview = URL.createObjectURL(compressed);
			visitPersist.savePhoto(VISIT_PHOTO_KEY, compressed);
		} catch (e) {
			console.error('[sales/id] watermark gagal, pakai foto asli', e);
			photoFile = file;
			photoPreview = URL.createObjectURL(file);
			visitPersist.savePhoto(VISIT_PHOTO_KEY, file);
		} finally {
			memprosesFoto = false;
		}
	}

	function retakePhoto() {
		photoFile = null;
		photoPreview = null;
	}

	async function handleSubmit() {
		if (!visit || submitting) return;
		if (!hasilKunjungan.trim()) {
			errorMsg = 'Isi ringkasan hasil kunjungan.';
			return;
		}
		if (followUpDate && !nextAction.trim()) {
			errorMsg = 'Isi rencana berikutnya bila mengatur tanggal follow-up.';
			return;
		}
		if (followUpDate) {
			const todayWib = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
			if (followUpDate < todayWib) {
				errorMsg = 'Tanggal follow-up tidak boleh sebelum hari ini.';
				return;
			}
		}
		submitting = true;
		errorMsg = '';
		try {
			const statusBant: Record<string, string | null> | null =
				bantBudget || bantAuthority || bantNeed || bantTimeline
					? {
							budget: bantBudget || null,
							authority: bantAuthority || null,
							need: bantNeed || null,
							timeline: bantTimeline || null
						}
					: null;
			const submitParams = {
				hasilKunjungan: hasilKunjungan.trim(),
				followUpDate: followUpDate || null,
				nextAction: nextAction.trim() || null,
				fotoFile: photoFile,
				kegiatan: kegiatan.trim(),
				lat: gpsCoords?.latitude ?? null,
				lng: gpsCoords?.longitude ?? null,
				accuracy: gpsCoords?.accuracy ?? null,
				picDitemui: picDitemui.trim() || null,
				jabatanPic: jabatanPic.trim() || null,
				noWaPic: noWaPic.trim() || null,
				statusBant
			};

			// Paket 08c §5.3 — write-ahead: client_txn_id dibuat SEKALI, entri ditulis ke antrean
			// SEBELUM mencoba kirim online (pola sama /sales/baru). visit.id sudah diketahui di
			// sini (halaman ini sudah memuat kunjungan), jadi extra.visit_id langsung diisi —
			// tidak perlu resolusi checkinClientTxnId seperti jalur /sales/offline.
			const clientTxnId = crypto.randomUUID();
			let entryTersimpan = false;
			try {
				await enqueueSiteCheckinSubmission({
					v: 2,
					client_txn_id: clientTxnId,
					type: 'checkout',
					status: 'pending',
					referensiId: null,
					tipeKeperluan: 'marketing',
					extra: {
						jalur: 'sales',
						visit_id: String(visit.id),
						hasil_kunjungan: submitParams.hasilKunjungan,
						kegiatan: submitParams.kegiatan,
						follow_up_date: submitParams.followUpDate || '',
						next_action: submitParams.nextAction || '',
						pic_ditemui: submitParams.picDitemui || '',
						jabatan_pic: submitParams.jabatanPic || '',
						no_wa_pic: submitParams.noWaPic || '',
						status_bant: statusBant ? JSON.stringify(statusBant) : ''
					},
					namaLokasi: visit.customer_name || visit.tujuan || null,
					checkinId: null,
					lat: submitParams.lat,
					lng: submitParams.lng,
					accuracy: submitParams.accuracy,
					photoBlob: photoFile,
					photoName: photoFile?.name || 'submit.jpg',
					catatan: null,
					kegiatan: null,
					temuan: null,
					tindakLanjut: null,
					rencanaBesok: null,
					createdAt: new Date().toISOString()
				});
				entryTersimpan = true;

				await submitVisit(visit.id, { ...submitParams, clientTxnId });
				if (entryTersimpan) await removeQueuedSiteCheckinSubmission(clientTxnId).catch(() => {});
				visitPersist.clear();
				await visitPersist.clearPhotos();
				draftSavedAt = null;
				submitted = true;
				visit = await getVisitById(visit.id);
			} catch (err) {
				if (entryTersimpan && isRetryableError(err)) {
					// Sudah tersimpan di antrean — siteCheckinSync.ts akan mengirimkannya nanti.
					visitPersist.clear();
					await visitPersist.clearPhotos();
					draftSavedAt = null;
					submitted = true;
					submittedOffline = true;
					return;
				}
				if (entryTersimpan) await removeQueuedSiteCheckinSubmission(clientTxnId).catch(() => {});
				throw err;
			}
		} catch (err: any) {
			errorMsg = pesanErrorAwam(err) || err?.message || 'Gagal submit kunjungan.';
		} finally {
			submitting = false;
		}
	}

	function badgeStyle(status: string) {
		if (status === 'verified') return 'background:var(--gg); color:var(--ggd)';
		if (status === 'rejected') return 'background:var(--rel); color:var(--red)';
		if (status === 'submitted') return 'background:var(--aml); color:var(--amd)';
		return 'background:var(--sys-fill); color:var(--sys-label3)';
	}
	function badgeLabel(status: string) {
		if (status === 'verified') return 'Terverifikasi';
		if (status === 'rejected') return 'Ditolak';
		if (status === 'submitted') return 'Menunggu Verifikasi';
		return 'Draft — belum submit';
	}
</script>

<div class="scroll-body">
	<div class="max-w-2xl mx-auto p-4 pb-24">
		<button
			type="button"
			class="flex items-center gap-1.5 text-[12px] font-medium mb-3"
			style="color: var(--sys-label3)"
			onclick={() => goto('/sales')}
		>
			<IconArrowLeft size={15} /> Kembali ke Kunjungan
		</button>

		{#if loading}
		<div class="flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat rincian kunjungan sales..." />
		</div>
		{:else if !visit}
			<div class="text-center py-16 text-[13px]" style="color: var(--sys-label3)">Kunjungan tidak ditemukan.</div>
		{:else if submitted}
			<div class="rounded-2xl border p-6 text-center shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="w-12 h-12 rounded-full {submittedOffline ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'} flex items-center justify-center mx-auto mb-3">
					<IconCircleCheck size={28} />
				</div>
				{#if submittedOffline}
					<h2 class="text-[16px] font-extrabold" style="color: var(--sys-label)">📱 Tersimpan di HP</h2>
					<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Sinyal sedang lemah — laporan akan terkirim otomatis saat ada sinyal. Jangan isi ulang/kirim dua kali.</p>
				{:else}
					<h2 class="text-[16px] font-extrabold" style="color: var(--sys-label)">Kunjungan Berhasil Disubmit</h2>
					<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Laporan kunjungan Anda telah dikirim dan menunggu verifikasi SPV/Admin.</p>
				{/if}
				<button
					type="button"
					class="mt-5 px-5 py-2.5 rounded-xl text-[12px] font-bold text-white shadow-sm"
					style="background: var(--p, var(--g))"
					onclick={() => goto('/sales')}
				>
					Kembali ke Riwayat Kunjungan
				</button>
			</div>
		{:else}
			<!-- Top Header -->
			<div class="rounded-2xl border p-4 mb-4 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<div class="flex items-start justify-between gap-2 mb-2">
					<div>
						<h1 class="text-[18px] font-extrabold" style="color: var(--sys-label)">{visit.customer_name || visit.tujuan}</h1>
						<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">{visit.tujuan}</p>
					</div>
					<div class="flex items-center gap-2">
						<DraftIndicator savedAt={draftSavedAt} hasPhotos={!!photoFile} />
						<span class="shrink-0 text-[10px] font-bold px-2.5 py-0.5 rounded-full" style={badgeStyle(visit.verifikasi_status)}>
							{badgeLabel(visit.verifikasi_status)}
						</span>
					</div>
				</div>

				<div class="flex items-center flex-wrap gap-x-4 gap-y-1 text-[11px] pt-2 border-t" style="border-color: var(--sys-sep); color: var(--sys-label3)">
					<span class="flex items-center gap-1">
						<IconCalendar size={13} /> {visit.tanggal_kunjungan}
					</span>
					{#if visit.check_in_at}
						<span class="flex items-center gap-1 font-medium" style="color: var(--ggd)">
							<IconMapPin size={13} /> Check-in: {new Date(visit.check_in_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
							{#if visit.latitude && visit.longitude}
								<span class="opacity-70 font-mono">({visit.latitude.toFixed(4)}, {visit.longitude.toFixed(4)})</span>
							{/if}
						</span>
					{/if}
				</div>

				{#if visit.masterCustomerId}
					{@const custId = visit.masterCustomerId}
					<div class="mt-3 pt-2 border-t" style="border-color: var(--sys-sep)">
						<button
							type="button"
							class="text-[11px] font-bold flex items-center gap-1.5 hover:underline"
							style="color: var(--p, var(--g))"
							onclick={() => goto(`/sales/customer/${custId}`)}
						>
							<IconBuildingStore size={14} /> Buka Riwayat & Pipeline Customer Ini &rarr;
						</button>
					</div>
				{/if}
			</div>

			<!-- SPV Rejection Note Alert -->
			{#if visit.verifikasi_status === 'rejected' && visit.catatan_spv}
				<div class="rounded-2xl p-3.5 mb-4 flex items-start gap-2.5 border" style="background: var(--rel); border-color: var(--re)">
					<IconCircleX size={18} style="color: var(--red)" class="shrink-0 mt-0.5" />
					<div class="text-[12px]">
						<strong style="color: var(--red)">Kunjungan Ditolak SPV</strong>
						<p class="mt-0.5" style="color: #7F1D1D">{visit.catatan_spv}</p>
					</div>
				</div>
			{/if}

			{#if visit.verifikasi_status === 'draft'}
				<!-- Form Pengisian Hasil Kunjungan -->
				<div class="rounded-2xl border p-4 shadow-sm flex flex-col gap-3.5" style="border-color: var(--sys-sep); background: var(--sys-bg)">
					<h2 class="text-[13px] font-bold" style="color: var(--sys-label)">Hasil Kunjungan & Dokumentasi</h2>

					<div>
						<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Hasil / Rangkuman Pertemuan *</label>
						<textarea
							class="w-full rounded-xl border text-[13px] p-2.5"
							style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
							rows="4"
							placeholder="Ringkasan hasil diskusi, kebutuhan customer, estimasi volume pekerjaan, kendala teknis, dll..."
							bind:value={hasilKunjungan}
						></textarea>
					</div>

					<div>
						<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Aktivitas / Kegiatan Dilakukan</label>
						<input
							class="w-full h-11 px-3 rounded-xl border text-[13px]"
							style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
							placeholder="cth. Presentasi company profile, penawaran harga sandblasting..."
							bind:value={kegiatan}
						/>
					</div>

					<div>
						<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Foto Bukti Lapangan</label>
						{#if photoPreview}
							<div class="relative h-28 rounded-xl overflow-hidden border" style="border-color: var(--sys-sep)">
								<img src={photoPreview} alt="Preview" class="w-full h-full object-cover" />
								<button
									type="button"
									class="absolute top-2 right-2 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-black/60 text-white hover:bg-black/80 transition-colors"
									onclick={retakePhoto}
								>
									Ambil Ulang
								</button>
							</div>
						{:else}
							<button
								type="button"
								class="w-full flex items-center justify-center gap-2 h-28 rounded-xl border border-dashed hover:bg-black/5 transition-colors disabled:opacity-50"
								style="border-color: var(--sys-sep); color: var(--sys-label3)"
								disabled={memprosesFoto}
								onclick={() => (showCamera = true)}
							>
								{#if memprosesFoto}
									<IconLoader2 size={20} class="animate-spin" />
									<span class="text-[11px] font-semibold">Memproses watermark foto...</span>
								{:else}
									<IconCamera size={22} />
									<span class="text-[11px] font-semibold">Ambil Foto Bukti Kunjungan</span>
								{/if}
							</button>
						{/if}
						<p class="text-[10px] mt-1" style="color: var(--sys-label3)">💡 Foto diberi watermark GPS & waktu otomatis — gunakan kamera langsung, bukan galeri.</p>
					</div>

					<div class="grid grid-cols-2 gap-2.5">
						<div class="col-span-2">
							<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Nama PIC yang Ditemui (opsional)</label>
							<input
								class="w-full h-10 px-3 rounded-xl border text-[13px]"
								style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
								placeholder="Nama PIC"
								bind:value={picDitemui}
							/>
						</div>
						<div>
							<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Jabatan PIC</label>
							<input
								class="w-full h-10 px-3 rounded-xl border text-[13px]"
								style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
								placeholder="mis. Purchasing Manager"
								bind:value={jabatanPic}
							/>
						</div>
						<div>
							<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">No. WA PIC</label>
							<input
								class="w-full h-10 px-3 rounded-xl border text-[13px]"
								style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
								placeholder="08xx..."
								bind:value={noWaPic}
							/>
						</div>
					</div>

					<div>
						<p class="text-[11px] font-bold mb-1.5" style="color: var(--sys-label3)">Status BANT (opsional) — kualifikasi prospek</p>
						<div class="grid grid-cols-2 gap-2">
							<div>
								<label class="text-[10px] block mb-0.5" style="color: var(--sys-label3)">Budget</label>
								<select class="w-full h-9 px-2 rounded-lg text-[11px] border" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)" bind:value={bantBudget}>
									<option value="">-</option>
									{#each BANT_BUDGET_OPTS as o}<option value={o.value}>{o.label}</option>{/each}
								</select>
							</div>
							<div>
								<label class="text-[10px] block mb-0.5" style="color: var(--sys-label3)">Authority</label>
								<select class="w-full h-9 px-2 rounded-lg text-[11px] border" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)" bind:value={bantAuthority}>
									<option value="">-</option>
									{#each BANT_AUTHORITY_OPTS as o}<option value={o.value}>{o.label}</option>{/each}
								</select>
							</div>
							<div>
								<label class="text-[10px] block mb-0.5" style="color: var(--sys-label3)">Need</label>
								<select class="w-full h-9 px-2 rounded-lg text-[11px] border" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)" bind:value={bantNeed}>
									<option value="">-</option>
									{#each BANT_NEED_OPTS as o}<option value={o.value}>{o.label}</option>{/each}
								</select>
							</div>
							<div>
								<label class="text-[10px] block mb-0.5" style="color: var(--sys-label3)">Timeline</label>
								<select class="w-full h-9 px-2 rounded-lg text-[11px] border" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)" bind:value={bantTimeline}>
									<option value="">-</option>
									{#each BANT_TIMELINE_OPTS as o}<option value={o.value}>{o.label}</option>{/each}
								</select>
							</div>
						</div>
					</div>

					<!-- Biaya Operasional Kunjungan & Bukti Bon -->
					<SalesVisitExpenseSection {visitId} />

					<div>
						<label class="text-[11px] font-bold mb-1 block" style="color: var(--sys-label3)">Rencana Jadwal Follow-up (opsional)</label>
						<input
							type="date"
							min={new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })}
							class="w-full h-11 px-3 rounded-xl border text-[13px]"
							style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
							bind:value={followUpDate}
						/>
						{#if followUpDate}
							<input
								class="w-full h-11 px-3 rounded-xl border text-[13px] mt-2"
								style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
								placeholder="Rencana berikutnya (wajib bila atur tanggal follow-up)..."
								bind:value={nextAction}
							/>
						{/if}
					</div>

					{#if errorMsg}
						<p class="text-[12px] font-semibold" style="color: #DC2626">{errorMsg}</p>
					{/if}

					<button
						type="button"
						class="w-full h-12 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 shadow-sm disabled:opacity-40 transition-transform active:scale-[0.99] mt-2"
						style="background: var(--p, var(--g))"
						disabled={submitting}
						onclick={handleSubmit}
					>
						{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
						Submit Laporan Kunjungan
					</button>
				</div>
			{:else}
				<!-- View only result -->
				<div class="rounded-2xl border p-4 shadow-sm mb-3 flex flex-col gap-3" style="border-color: var(--sys-sep); background: var(--sys-bg)">
					<div>
						<span class="text-[10px] font-semibold block" style="color: var(--sys-label3)">Hasil Kunjungan:</span>
						<p class="text-[13px] leading-relaxed mt-0.5 font-medium" style="color: var(--sys-label)">{visit.hasil_kunjungan || '-'}</p>
					</div>

					{#if visit.kegiatan}
						<div class="pt-2 border-t" style="border-color: var(--sys-sep)">
							<span class="text-[10px] font-semibold block" style="color: var(--sys-label3)">Kegiatan:</span>
							<p class="text-[12px] mt-0.5" style="color: var(--sys-label)">{visit.kegiatan}</p>
						</div>
					{/if}

					{#if visit.follow_up_date}
						<div class="pt-2 border-t" style="border-color: var(--sys-sep)">
							<span class="text-[10px] font-semibold block" style="color: var(--sys-label3)">Jadwal Follow-up Berikutnya:</span>
							<p class="text-[12px] font-bold mt-0.5" style="color: var(--amd)">{visit.follow_up_date}</p>
						</div>
					{/if}

					{#if visit.foto_id}
						<div class="pt-2 border-t" style="border-color: var(--sys-sep)">
							<span class="text-[10px] font-semibold block mb-1.5" style="color: var(--sys-label3)">Foto Bukti Kunjungan:</span>
							<div class="h-44 rounded-xl overflow-hidden border" style="border-color: var(--sys-sep)">
								<img src={`/api/directus/assets/${visit.foto_id}`} alt="Bukti Kunjungan" class="w-full h-full object-cover" />
							</div>
						</div>
					{/if}
				</div>

				<!-- Biaya Operasional & Bukti Bon Kunjungan -->
				<div class="mb-4">
					<SalesVisitExpenseSection {visitId} readOnly={false} />
				</div>
			{/if}
		{/if}
	</div>
</div>

{#if showCamera}
	<CameraCaptureModal facing="environment" onCapture={handleCapture} onClose={() => (showCamera = false)} />
{/if}
