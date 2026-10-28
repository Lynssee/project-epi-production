<!-- src/routes/(app)/sales/offline/[txnId]/+page.svelte -->
<!--
	Paket 08c Site Visit Release §5.3 — halaman resume untuk kunjungan yang DIMULAI OFFLINE
	(check-in masih di antrean /sales/baru, belum tersinkron, jadi belum punya visit.id numerik
	untuk /sales/[id]). Ditemukan lewat client_txn_id (txnId di URL) yang sama dipakai saat
	check-in ditulis ke offlineSiteCheckinQueue.ts.

	Tidak ada getVisitById() di sini — SEMUA info tampilan (nama lokasi, tujuan) datang dari
	entri antrean lokal itu sendiri (IndexedDB), bukan server (memang belum ada di server).
-->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { submitVisitByTxn, getCurrentPosition } from '$lib/services/sales';
	import {
		IconArrowLeft,
		IconLoader2,
		IconCamera,
		IconCircleCheck,
		IconWifiOff
	} from '@tabler/icons-svelte';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { watermarkPhoto } from '$lib/utils/photoWatermark';
	import CameraCaptureModal from '$lib/components/scanner/CameraCaptureModal.svelte';
	import {
		enqueueSiteCheckinSubmission,
		removeQueuedSiteCheckinSubmission,
		getQueuedSiteCheckinSubmissions,
		type QueuedSiteCheckinSubmission
	} from '$lib/utils/offlineSiteCheckinQueue';
	import { isRetryableError, pesanErrorAwam } from '$lib/utils/networkError';

	let txnId = $derived($page.params.txnId);

	let loading = $state(true);
	let submitting = $state(false);
	let errorMsg = $state('');
	let notFound = $state(false);
	let queuedEntry = $state<QueuedSiteCheckinSubmission | null>(null);

	let hasilKunjungan = $state('');
	let kegiatan = $state('');
	let followUpDate = $state('');
	let nextAction = $state('');
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

	let showCamera = $state(false);
	let photoFile = $state<File | null>(null);
	let photoPreview = $state<string | null>(null);
	let memprosesFoto = $state(false);
	let submitted = $state(false);
	let submittedOffline = $state(false);

	let gpsCoords = $state<{ latitude: number; longitude: number } | null>(null);

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && roles.length > 0 && !hasPermission(roleId, 'input_sales', roles, $authStore.roleIds)) {
			goto('/');
		}
	});

	onMount(async () => {
		const queued = await getQueuedSiteCheckinSubmissions();
		const entry = queued.find((e) => e.client_txn_id === txnId && e.type === 'checkin');
		if (!entry) {
			// Sudah tersinkron & terhapus dari antrean (atau txnId salah) — kunjungan sekarang
			// punya visit.id biasa, bisa dibuka dari Riwayat Kunjungan seperti biasa.
			notFound = true;
			loading = false;
			return;
		}
		queuedEntry = entry;
		loading = false;

		// Best-effort — GPS checkout boleh kosong di sini (fokus halaman ini adalah tetap bisa
		// mengisi laporan walau offline, bukan akurasi GPS tinggi).
		try {
			gpsCoords = await getCurrentPosition();
		} catch {
			/* abaikan — checkout tanpa GPS tetap diterima server (opsional) */
		}
	});

	async function handleCapture(file: File) {
		showCamera = false;
		memprosesFoto = true;
		try {
			const gps = gpsCoords ? { lat: gpsCoords.latitude, lng: gpsCoords.longitude, accuracy: 0 } : null;
			const stamped = await watermarkPhoto(file, gps, new Date().toISOString(), {
				lokasi: queuedEntry?.namaLokasi || undefined
			});
			const compressed = await compressPhoto(stamped);
			photoFile = compressed;
			photoPreview = URL.createObjectURL(compressed);
		} catch (e) {
			console.error('[sales/offline] watermark gagal, pakai foto asli', e);
			photoFile = file;
			photoPreview = URL.createObjectURL(file);
		} finally {
			memprosesFoto = false;
		}
	}

	function retakePhoto() {
		photoFile = null;
		photoPreview = null;
	}

	async function handleSubmit() {
		if (submitting || !txnId) return;
		if (!hasilKunjungan.trim()) {
			errorMsg = 'Isi ringkasan hasil kunjungan.';
			return;
		}
		if (followUpDate && !nextAction.trim()) {
			errorMsg = 'Isi rencana berikutnya bila mengatur tanggal follow-up.';
			return;
		}

		submitting = true;
		errorMsg = '';
		const statusBant: Record<string, string | null> | null =
			bantBudget || bantAuthority || bantNeed || bantTimeline
				? { budget: bantBudget || null, authority: bantAuthority || null, need: bantNeed || null, timeline: bantTimeline || null }
				: null;
		const submitParams = {
			hasilKunjungan: hasilKunjungan.trim(),
			followUpDate: followUpDate || null,
			nextAction: nextAction.trim() || null,
			fotoFile: photoFile,
			kegiatan: kegiatan.trim(),
			lat: gpsCoords?.latitude ?? null,
			lng: gpsCoords?.longitude ?? null,
			accuracy: null,
			picDitemui: picDitemui.trim() || null,
			jabatanPic: jabatanPic.trim() || null,
			noWaPic: noWaPic.trim() || null,
			statusBant
		};

		// Write-ahead (pola sama /sales/[id] & /sales/baru) — client_txn_id BERBEDA dari txnId
		// check-in (checkinClientTxnId di extra yang menautkan keduanya di server).
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
				checkinClientTxnId: txnId,
				extra: {
					jalur: 'sales',
					visit_id: '',
					hasil_kunjungan: submitParams.hasilKunjungan,
					kegiatan: submitParams.kegiatan,
					follow_up_date: submitParams.followUpDate || '',
					next_action: submitParams.nextAction || '',
					pic_ditemui: submitParams.picDitemui || '',
					jabatan_pic: submitParams.jabatanPic || '',
					no_wa_pic: submitParams.noWaPic || '',
					status_bant: statusBant ? JSON.stringify(statusBant) : ''
				},
				namaLokasi: queuedEntry?.namaLokasi || null,
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

			const visit = await submitVisitByTxn(txnId, submitParams);
			if (entryTersimpan) await removeQueuedSiteCheckinSubmission(clientTxnId).catch(() => {});
			goto(`/sales/${visit.id}`);
		} catch (err) {
			if (entryTersimpan && isRetryableError(err)) {
				submitted = true;
				submittedOffline = true;
				submitting = false;
				return;
			}
			if (entryTersimpan) await removeQueuedSiteCheckinSubmission(clientTxnId).catch(() => {});
			errorMsg = pesanErrorAwam(err) || 'Gagal submit kunjungan.';
			submitting = false;
		}
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
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat draft kunjungan offline..." />
		</div>
		{:else if notFound}
			<div class="rounded-2xl border p-6 text-center shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<IconCircleCheck size={28} class="mx-auto mb-2 text-emerald-600 dark:text-emerald-400" />
				<h2 class="text-[15px] font-extrabold" style="color: var(--sys-label)">Kunjungan Ini Sudah Tersinkron</h2>
				<p class="text-[12px] mt-1" style="color: var(--sys-label3)">
					Buka dari Riwayat Kunjungan untuk melengkapi atau melihat hasilnya.
				</p>
				<button
					type="button"
					class="mt-4 px-4 py-2 rounded-xl text-[12px] font-bold text-white shadow-sm"
					style="background: var(--p, var(--g))"
					onclick={() => goto('/sales')}
				>
					Buka Riwayat Kunjungan
				</button>
			</div>
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
			<div class="rounded-2xl border p-3.5 mb-4 flex items-center gap-2.5" style="background: var(--aml); border: 1px solid var(--am)">
				<IconWifiOff size={18} style="color: var(--amd)" class="shrink-0" />
				<p class="text-[11px] font-semibold" style="color: var(--amd)">
					Kunjungan ini dimulai saat offline — belum tersinkron ke server. Anda tetap bisa isi hasilnya sekarang; akan terkirim otomatis begitu ada sinyal.
				</p>
			</div>

			<div class="rounded-2xl border p-4 mb-4 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
				<h1 class="text-[16px] font-extrabold" style="color: var(--sys-label)">{queuedEntry?.namaLokasi || 'Kunjungan Lapangan'}</h1>
				<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">{queuedEntry?.extra?.tujuan || ''}</p>
			</div>

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
		{/if}
	</div>
</div>

{#if showCamera}
	<CameraCaptureModal facing="environment" onCapture={handleCapture} onClose={() => (showCamera = false)} />
{/if}
