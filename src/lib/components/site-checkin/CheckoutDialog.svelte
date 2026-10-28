<!-- src/lib/components/site-checkin/CheckoutDialog.svelte -->
<!-- Fase 3: modal check-out modern. + 4 field kunjungan (S-4/Q7-a): kegiatan/temuan/tindak_lanjut/
     rencana_besok — dijembatani otomatis ke project_visit_leader oleh server bila
     kill-switch tulis_visit_leader_aktif aktif. -->
<script lang="ts">
	import { getCurrentPosition } from '$lib/utils/geoClient';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { watermarkPhoto } from '$lib/utils/photoWatermark';
	import CameraCaptureModal from '$lib/components/scanner/CameraCaptureModal.svelte';
	import { submitCheckout, getSiteCheckinSettings, getLastHoursmeter, type SiteCheckinRecord, type SiteCheckinSettings } from '$lib/services/siteCheckin';
	import { enqueueSiteCheckinSubmission, removeQueuedSiteCheckinSubmission } from '$lib/utils/offlineSiteCheckinQueue';
	import { isRetryableError, pesanErrorAwam } from '$lib/utils/networkError';
	import { getReportByProjectAndDate } from '$lib/services/reports';
	import { getTodayStatus, clockOut } from '$lib/services/ess/attendance';
	import {
		IconLoader2,
		IconCamera,
		IconX,
		IconMapPin,
		IconClock,
		IconNotes,
		IconBuildingFactory2,
		IconCheck,
		IconAlertTriangle,
		IconListCheck
	} from '@tabler/icons-svelte';
	import { fade, slide } from 'svelte/transition';

	let {
		checkin,
		checkinClientTxnId = null,
		onDone,
		onClose,
		onError
	}: {
		checkin: SiteCheckinRecord;
		// Paket 02 §3.9.2/§3.8 (worst case I) — diisi saat `checkin` adalah stub lokal
		// (check-in-nya SENDIRI masih di antrean, checkin.id kosong '' — lihat +page.svelte
		// localPendingCheckinInfo). Server me-resolve checkin_id dari nilai ini.
		checkinClientTxnId?: string | null;
		onDone: () => void;
		onClose: () => void;
		// Paket 10 §2.1 (SVR-22) — dipanggil dengan pesan mentah error server sebelum errorMsg
		// ditampilkan, supaya pemanggil (mis. ActiveCheckinBar) bisa mengubah "Check-in sudah
		// ditutup" (kunjungan sudah selesai di tempat lain) jadi pesan netral, bukan error teknis.
		onError?: (message: string) => void;
	} = $props();

	let settings = $state<SiteCheckinSettings | null>(null);
	let locating = $state(false);
	let position = $state<{ lat: number; lng: number; accuracy: number } | null>(null);
	let showCamera = $state(false);
	let photoFile = $state<File | null>(null);
	let photoPreview = $state<string | null>(null);
	// Paket 03 §3.4 — indikator selama watermark diproses (sama pola CheckinForm.svelte §3.3).
	let memprosesFoto = $state(false);

	// UX-06: dulu 4 kolom terpisah (kegiatan/temuan/tindak lanjut/rencana besok) — hampir selalu
	// dilewati karena isinya tumpang tindih dengan laporan harian. Sekarang SATU kolom ringkasan,
	// diprefill dari laporan harian hari itu bila sudah ada (leader tidak mengetik ulang).
	let kegiatan = $state('');
	let temuan = $state('');
	let tindakLanjut = $state('');
	let rencanaBesok = $state('');
	let prefillDariLaporan = $state(false);

	const RINGKASAN_QUICK_TAGS = [
		'🔍 Inspeksi Lapangan',
		'👷 Supervisi Tim',
		'🤝 Meeting Klien',
		'📦 Cek Material & Stok',
		'🛠️ Troubleshooting',
		'📋 Audit K3 / QC'
	];
	function addRingkasanTag(tag: string) {
		const cleanTag = tag.replace(/^[^\w\s]+/, '').trim();
		if (!kegiatan.trim()) kegiatan = cleanTag;
		else if (!kegiatan.includes(cleanTag)) kegiatan = `${kegiatan} • ${cleanTag}`;
	}

	/** Tanggal WIB hari ini (YYYY-MM-DD), independen zona waktu perangkat. */
	function todayWib(): string {
		return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
	}

	async function prefillFromTodayReport() {
		if (!checkin?.referensi_id || checkin.tipe_checkin !== 'proyek') return;
		try {
			const report = await getReportByProjectAndDate(checkin.referensi_id, todayWib());
			const notes = (report as any)?.general_notes?.trim();
			if (notes && !kegiatan.trim()) {
				kegiatan = notes;
				prefillDariLaporan = true;
			}
		} catch {
			// opsional — gagal ambil laporan tidak boleh mengganggu checkout
		}
	}

	// "4-Gate Site Visit System" Fase 3 (8 Sep 2026) — form checkout tipe 'marketing'.
	const isMarketing = $derived(checkin?.tipe_checkin === 'marketing');
	let picDitemui = $state('');
	let jabatanPic = $state('');
	let noWaPic = $state('');
	let hasilMeeting = $state('');
	let bantBudget = $state('');
	let bantAuthority = $state('');
	let bantNeed = $state('');
	let bantTimeline = $state('');
	let nextAction = $state('');
	let followUpDate = $state('');

	// "4-Gate Site Visit System" Fase 3c (8 Sep 2026) — form checkout tipe 'maintenance'.
	const isMaintenance = $derived(checkin?.tipe_checkin === 'maintenance');
	let serviceLog = $state('');
	let sparepartDipakai = $state('');
	let statusUnit = $state('');
	let hourMeter = $state('');

	const STATUS_UNIT_OPTS = [
		{ value: 'running', label: 'Jalan ✅' },
		{ value: 'standby', label: 'Standby ⏸️' },
		{ value: 'breakdown', label: 'Rusak ❌' }
	];

	// Paket 09 §2.6 — hour meter dibandingkan dengan catatan TERAKHIR untuk equipment ini, supaya
	// mekanik diperingatkan bila mengetik angka yang lebih kecil (typo/salah unit), bukan sekadar
	// diterima mentah tanpa validasi.
	let lastHoursmeter = $state<number | null>(null);
	$effect(() => {
		if (isMaintenance && checkin?.referensi_uuid) {
			getLastHoursmeter(checkin.referensi_uuid).then((r) => (lastHoursmeter = r.hoursmeter));
		}
	});
	const hourMeterTerlaluKecil = $derived(
		isMaintenance && hourMeter !== '' && lastHoursmeter != null && Number(hourMeter) >= 0 && Number(hourMeter) < lastHoursmeter
	);

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

	let submitting = $state(false);
	let errorMsg = $state('');
	// Paket 02 §3.8 — hasil submit terakhir (pola sama CheckinForm.svelte §3.6).
	let hasil = $state<'terkirim' | 'tersimpan' | null>(null);

	const elapsedMenit = $derived.by(() => {
		if (!checkin?.check_in_at) return 0;
		return Math.max(0, Math.floor((Date.now() - new Date(checkin.check_in_at).getTime()) / 60000));
	});
	const elapsedSummary = $derived.by(() => {
		const totalMin = elapsedMenit;
		const h = Math.floor(totalMin / 60);
		const m = totalMin % 60;
		return h > 0 ? `${h} jam ${m} menit` : `${m} menit`;
	});

	// U1 (disetujui HRD): tawarkan absen pulang sekaligus bila BK hari ini sudah masuk tapi belum
	// pulang — BK pulang kosong di hari kunjungan adalah penyebab umum sanksi kuota terlewat (SV-09).
	let bisaAbsenPulang = $state(false);
	let absenPulangSekaligus = $state(false);
	async function cekBisaAbsenPulang() {
		try {
			const s = await getTodayStatus();
			const masuk = s.record?.jam_masuk;
			const keluar = s.record?.jam_keluar;
			bisaAbsenPulang = !!masuk && masuk !== '-' && (!keluar || keluar === '-');
		} catch {
			bisaAbsenPulang = false;
		}
	}

	$effect(() => {
		getSiteCheckinSettings()
			.then((r) => (settings = r.settings))
			.catch(() => {});
		requestLocation();
		prefillFromTodayReport();
		cekBisaAbsenPulang();
	});

	async function requestLocation() {
		locating = true;
		try {
			position = await getCurrentPosition();
		} catch {
			// GPS check-out opsional — tidak memblokir kalau gagal, lat/lng dikirim null
		} finally {
			locating = false;
		}
	}

	async function handleCapture(file: File) {
		showCamera = false;
		memprosesFoto = true;
		try {
			// Paket 03 §3.4 — GPS SAAT foto diambil (boleh null: di dalam gedung/GPS belum
			// terkunci — jujur "Lokasi GPS tidak tersedia" di foto, bukan 0.0000,0.0000).
			const gps = position ? { lat: position.lat, lng: position.lng, accuracy: position.accuracy } : null;
			const stamped = await watermarkPhoto(file, gps, new Date().toISOString(), {
				lokasi: checkin.nama_lokasi || undefined
			});
			if (photoPreview) URL.revokeObjectURL(photoPreview);
			photoFile = stamped;
			photoPreview = URL.createObjectURL(stamped);
		} catch (e) {
			console.error('[site-checkin] watermark checkout gagal, pakai foto asli', e);
			if (photoPreview) URL.revokeObjectURL(photoPreview);
			photoFile = file;
			photoPreview = URL.createObjectURL(file);
		} finally {
			memprosesFoto = false;
		}
	}

	const fotoWajib = $derived(settings?.foto_checkout_wajib ?? false);
	// Next Action + Tanggal Follow-up WAJIB untuk checkout marketing (plan Fase 3) — tanpa ini
	// kunjungan sales tercatat tapi tidak ada tindak lanjut terjadwal.
	const marketingValid = $derived(!isMarketing || (!!nextAction.trim() && !!followUpDate));
	const canSubmit = $derived((!fotoWajib || !!photoFile) && marketingValid && !submitting && !memprosesFoto && hasil !== 'tersimpan');
	const isProyekLike = $derived(!isMarketing && !isMaintenance);

	// Paket 10 Site Visit Release §2.4 (SVR-32) — peringatan durasi < minimum SEBELUM checkout,
	// bukan diam-diam tersimpan sebagai anomali yang baru diketahui leader belakangan.
	let sudahKonfirmasiDurasiRendah = $state(false);
	const durasiKurangMinimum = $derived(isProyekLike && settings != null && elapsedMenit < (settings.min_durasi_menit || 0));

	async function handleSubmit() {
		if (!canSubmit) return;
		if (durasiKurangMinimum && !sudahKonfirmasiDurasiRendah) return; // tombol kartu peringatan yang lanjut, bukan tombol utama
		submitting = true;
		errorMsg = '';
		hasil = null;

		const finalPhoto = photoFile ? await compressPhoto(photoFile) : null;
		// Paket 02 §3.8 (write-ahead, pola sama CheckinForm.svelte §3.6) — client_txn_id dibuat
		// SEKALI dan dikirim baik lewat antrean (bila offline) maupun percobaan online langsung,
		// supaya request yang SEBENARNYA sukses tapi responsnya hilang tidak pernah menutup
		// kunjungan yang sama dua kali (server sudah idempoten — Paket 02 §3.9).
		const clientTxnId = crypto.randomUUID();
		// Antrean offline SENGAJA hanya untuk checkout tipe proyek — field marketing/maintenance
		// (follow_ups/mekanik_activity) belum diuji aman direplay dari antrean (paket 08/09).
		const bolehOffline = isProyekLike;
		let entryTersimpan = false;

		try {
			if (bolehOffline) {
				await enqueueSiteCheckinSubmission({
					v: 2,
					client_txn_id: clientTxnId,
					type: 'checkout',
					status: 'pending',
					referensiId: null,
					// Paket 02 §3.9.2 (worst case I) — checkin.id kosong berarti stub lokal
					// (checkinClientTxnId dipakai server untuk resolusi, bukan checkinId).
					checkinId: checkin.id || null,
					checkinClientTxnId: checkin.id ? null : checkinClientTxnId,
					lat: position?.lat ?? null,
					lng: position?.lng ?? null,
					accuracy: position?.accuracy ?? null,
					photoBlob: finalPhoto,
					photoName: finalPhoto?.name || null,
					catatan: null,
					kegiatan: kegiatan || null,
					temuan: temuan || null,
					tindakLanjut: tindakLanjut || null,
					rencanaBesok: rencanaBesok || null,
					createdAt: new Date().toISOString()
				});
				entryTersimpan = true;
			}

			const result = await submitCheckout({
				checkinId: checkin.id || '',
				checkinClientTxnId: checkin.id ? null : checkinClientTxnId,
				lat: position?.lat ?? null,
				lng: position?.lng ?? null,
				accuracy: position?.accuracy ?? null,
				photoFile: finalPhoto,
				kegiatan: isProyekLike ? kegiatan || undefined : undefined,
				temuan: isProyekLike ? temuan || undefined : undefined,
				tindakLanjut: isProyekLike ? tindakLanjut || undefined : undefined,
				rencanaBesok: isProyekLike ? rencanaBesok || undefined : undefined,
				picDitemui: isMarketing ? picDitemui || undefined : undefined,
				jabatanPic: isMarketing ? jabatanPic || undefined : undefined,
				noWaPic: isMarketing ? noWaPic || undefined : undefined,
				hasilMeeting: isMarketing ? hasilMeeting || undefined : undefined,
				statusBant: isMarketing ? { budget: bantBudget || undefined, authority: bantAuthority || undefined, need: bantNeed || undefined, timeline: bantTimeline || undefined } : undefined,
				nextAction: isMarketing ? nextAction || undefined : undefined,
				followUpDate: isMarketing ? followUpDate || undefined : undefined,
				serviceLog: isMaintenance ? serviceLog || undefined : undefined,
				sparepartDipakai: isMaintenance ? sparepartDipakai || undefined : undefined,
				statusUnit: isMaintenance ? statusUnit || undefined : undefined,
				hourMeter: isMaintenance && hourMeter ? Number(hourMeter) : undefined,
				// Online: TANPA clientCreatedAt (jam server dipakai). clientTxnId tetap dikirim.
				clientTxnId
			});
			// U1: absen pulang sekaligus — dijalankan SETELAH check-out sukses & tidak pernah
			// menggagalkannya (aturan istirahat dll. bisa menolak clock-out).
			if (absenPulangSekaligus && bisaAbsenPulang && photoFile && position) {
				try {
					await clockOut({ lat: position.lat, lng: position.lng, accuracy: position.accuracy, photoFile, livenessPassed: false });
				} catch (e: any) {
					alert(`Check-out berhasil, tapi absen pulang gagal: ${e?.message || 'error'}. Silakan absen pulang lewat menu Absensi.`);
				}
			}
			if (entryTersimpan) await removeQueuedSiteCheckinSubmission(clientTxnId).catch(() => {});
			hasil = 'terkirim';
			// Paket 09 §2.2 (SVR-27) — bridge mekanik_activity gagal (personnel belum tertaut):
			// tampilkan SEBELUM dialog menutup, supaya mekanik tahu laporannya tidak masuk.
			if (result?.record?.peringatan) {
				alert(result.record.peringatan);
			}
			onDone();
		} catch (err) {
			if (entryTersimpan && isRetryableError(err)) {
				// SENGAJA tidak memanggil onDone() di sini (beda dari jalur sukses di atas) —
				// menutup modal langsung berarti kartu "Tersimpan di HP" di bawah tidak pernah
				// sempat terlihat pengguna. Biarkan modal terbuka; pengguna menutup manual
				// (tombol X, onClose) setelah membaca konfirmasi. Data sudah aman di antrean.
				hasil = 'tersimpan';
			} else if (!bolehOffline && isRetryableError(err)) {
				// Marketing/maintenance: tidak ada antrean offline — jangan bilang "tersimpan di HP".
				errorMsg = 'Sinyal sedang lemah dan checkout tipe ini belum bisa disimpan offline. Coba lagi saat sinyal lebih baik.';
			} else {
				if (entryTersimpan) await removeQueuedSiteCheckinSubmission(clientTxnId).catch(() => {});
				const rawMessage = err instanceof Error ? err.message : String(err);
				// Paket 10 §2.1 (SVR-22) — "sudah ditutup" berarti kunjungan MEMANG sudah selesai
				// tercatat (mis. auto-close tengah malam, atau checkout dari tab/perangkat lain
				// tepat sebelum ini) — bukan kegagalan yang perlu diperbaiki pengguna.
				if (/sudah ditutup/i.test(rawMessage) && onError) {
					onError(rawMessage);
				} else {
					errorMsg = pesanErrorAwam(err);
				}
			}
		} finally {
			submitting = false;
		}
	}
</script>

<!-- Backdrop & Modal Container -->
<div
	class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs"
	transition:fade={{ duration: 150 }}
>
	<div
		class="w-full sm:max-w-lg bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-2xl max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
	>
		<!-- Header Modal -->
		<div class="p-4 sm:p-5 flex items-center justify-between border-b border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
			<div class="flex items-center gap-3">
				<div class="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 flex items-center justify-center text-blue-600 dark:text-blue-400 border border-blue-200/60 dark:border-blue-800/60">
					<IconBuildingFactory2 size={20} />
				</div>
				<div>
					<p class="text-sm font-bold text-slate-900 dark:text-slate-100">Check-out Selesai Kunjungan</p>
					<p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate max-w-[240px] sm:max-w-xs">{checkin.nama_lokasi}</p>
				</div>
			</div>
			<button
				type="button"
				onclick={onClose}
				class="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
			>
				<IconX size={20} />
			</button>
		</div>

		<!-- Body Scrollable Content -->
		<div class="p-4 sm:p-5 overflow-y-auto flex flex-col gap-4 flex-1">
			<!-- Duration & Location Status Strip -->
			<div class="grid grid-cols-2 gap-2">
				<div class="p-3 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-800 dark:text-blue-200 flex items-center gap-2.5">
					<IconClock size={18} class="text-blue-600 dark:text-blue-400 shrink-0" />
					<div class="min-w-0">
						<p class="text-[10px] uppercase font-bold text-blue-600 dark:text-blue-400 tracking-wider">Durasi Kunjungan</p>
						<p class="text-xs font-bold truncate mt-0.5">{elapsedSummary}</p>
					</div>
				</div>

				<div class="p-3 rounded-xl bg-slate-100 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 flex items-center gap-2.5">
					<IconMapPin size={18} class="text-slate-500 shrink-0" />
					<div class="min-w-0">
						<p class="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 tracking-wider">Lokasi Keluar</p>
						<p class="text-xs font-semibold truncate mt-0.5 text-slate-700 dark:text-slate-300">
							{#if locating}
								Mengambil GPS...
							{:else if position}
								±{Math.round(position.accuracy)}m GPS
							{:else}
								Sesuai titik awal
							{/if}
						</p>
					</div>
				</div>
			</div>

			<!-- Foto Check-out -->
			<div class="p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
				<div class="flex items-center justify-between mb-2">
					<span class="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
						<IconCamera size={15} class="text-purple-600 dark:text-purple-400" />
						Foto Check-out {fotoWajib ? '(Wajib)' : '(Opsional)'}
					</span>
				</div>
				{#if photoPreview}
					<div class="flex items-center gap-3">
						<div class="relative w-20 h-20 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 shadow-2xs shrink-0">
							<img src={photoPreview} alt="Foto Check-out" class="w-full h-full object-cover" />
							<button
								type="button"
								class="absolute top-1 right-1 w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center shadow-md hover:bg-rose-700 transition-all"
								onclick={() => { photoFile = null; photoPreview = null; }}
							>
								<IconX size={12} />
							</button>
						</div>
						<div class="min-w-0">
							<p class="text-xs font-bold text-slate-800 dark:text-slate-200">Foto Check-out Terlampir</p>
							<button
								type="button"
								class="mt-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
								onclick={() => (showCamera = true)}
							>
								Ambil Ulang
							</button>
						</div>
					</div>
				{:else if memprosesFoto}
					<!-- Paket 03 §3.4/§4 -->
					<div class="w-full py-2.5 px-3 rounded-xl bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 text-xs font-semibold text-purple-700 dark:text-purple-300 flex items-center justify-center gap-2">
						<IconLoader2 size={16} class="animate-spin" />
						⏳ Memproses foto… Mohon tunggu, jangan tutup aplikasi.
					</div>
				{:else}
					<button
						type="button"
						class="w-full py-2.5 px-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 text-xs font-semibold text-slate-600 dark:text-slate-300 transition-all flex items-center justify-center gap-2"
						onclick={() => (showCamera = true)}
					>
						<IconCamera size={16} /> Foto lokasi selesai kerja
					</button>
					{#if !position}
						<p class="text-[10px] text-slate-400 dark:text-slate-500 text-center mt-1.5">
							GPS belum terkunci — foto tetap sah, lokasi ditulis "tidak tersedia".
						</p>
					{/if}
				{/if}
			</div>

			{#if bisaAbsenPulang}
				<label class="flex items-start gap-2 p-3 rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50 dark:bg-emerald-950/30 text-[11px] text-emerald-900 dark:text-emerald-200 cursor-pointer">
					<input type="checkbox" class="mt-0.5" bind:checked={absenPulangSekaligus} disabled={!photoFile || !position} />
					<span>
						<b>Sekalian absen pulang</b> (pakai foto &amp; GPS check-out ini).
						{#if !photoFile || !position}<span class="opacity-80"> Ambil foto dan tunggu GPS dulu untuk mengaktifkan.</span>{/if}
					</span>
				</label>
			{/if}

			<!-- Laporan Kunjungan (Terhubung ke Visit Leader / follow_ups) -->
			<div class="flex flex-col gap-2.5">
				<div class="flex items-center justify-between">
					<span class="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
						<IconListCheck size={16} class="text-blue-600 dark:text-blue-400" />
						{isMarketing ? 'Hasil Kunjungan Marketing' : isMaintenance ? 'Laporan Perbaikan' : 'Ringkasan Laporan Lapangan'}
						{#if isProyekLike || isMaintenance}<span class="text-[10px] lowercase text-slate-400 font-normal">(opsional)</span>{/if}
					</span>
				</div>

				{#if isMaintenance}
					<div class="flex flex-col gap-2">
						<div>
							<label for="co-service-log" class="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1">Log Servis / Kegiatan</label>
							<textarea
								id="co-service-log"
								class="w-full px-3 py-2 rounded-xl text-xs bg-slate-50/70 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
								rows="2"
								bind:value={serviceLog}
								placeholder="Ringkasan pekerjaan yang dilakukan..."
							></textarea>
						</div>

						<div>
							<label for="co-sparepart" class="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1">Sparepart Dipakai</label>
							<input
								id="co-sparepart"
								type="text"
								bind:value={sparepartDipakai}
								placeholder="Mis. oli SAE 40 1L, filter udara 1 pcs"
								class="w-full px-3 py-2 rounded-xl text-xs bg-slate-50/70 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
							/>
							<p class="text-[10px] mt-1 text-slate-400 dark:text-slate-500">Catatan cepat — pencatatan formal tetap lewat modul Maintenance.</p>
						</div>

						<div>
							<span class="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1">Status Unit</span>
							<div class="grid grid-cols-3 gap-1.5">
								{#each STATUS_UNIT_OPTS as o}
									<button
										type="button"
										class="py-2.5 rounded-xl text-xs font-bold transition-all {statusUnit === o.value ? 'bg-blue-600 text-white shadow-2xs' : 'bg-slate-50/70 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}"
										onclick={() => (statusUnit = statusUnit === o.value ? '' : o.value)}
									>
										{o.label}
									</button>
								{/each}
							</div>
						</div>
						<div>
							<label for="co-hour-meter" class="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1">Hour Meter</label>
							<input
								id="co-hour-meter"
								type="number"
								min="0"
								inputmode="decimal"
								bind:value={hourMeter}
								placeholder="0"
								class="w-full px-3 py-2 rounded-xl text-xs bg-slate-50/70 dark:bg-slate-800/60 border {hourMeterTerlaluKecil ? 'border-amber-400 dark:border-amber-700' : 'border-slate-200 dark:border-slate-700'} focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900 dark:text-slate-100"
							/>
							{#if hourMeterTerlaluKecil}
								<p class="text-[10px] mt-1 text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1">
									<IconAlertTriangle size={12} /> Lebih kecil dari catatan terakhir ({lastHoursmeter}). Yakin?
								</p>
							{/if}
						</div>
						<p class="text-[10px] text-slate-400 dark:text-slate-500">
							Laporan ini masuk ke Maintenance sebagai "On Progress" — status selesai tetap diputuskan supervisor.
						</p>
					</div>
				{:else if isMarketing}
					<div class="flex flex-col gap-2">
						<div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
							<div>
								<label for="co-pic" class="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1">PIC Ditemui</label>
								<input id="co-pic" type="text" bind:value={picDitemui} placeholder="Nama PIC" class="w-full px-3 py-2 rounded-xl text-xs bg-slate-50/70 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-400" />
							</div>
							<div>
								<label for="co-jabatan" class="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1">Jabatan</label>
								<input id="co-jabatan" type="text" bind:value={jabatanPic} placeholder="Mis. Purchasing Manager" class="w-full px-3 py-2 rounded-xl text-xs bg-slate-50/70 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-400" />
							</div>
							<div>
								<label for="co-wa" class="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1">No. WA</label>
								<input id="co-wa" type="text" bind:value={noWaPic} placeholder="08xx..." class="w-full px-3 py-2 rounded-xl text-xs bg-slate-50/70 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-400" />
							</div>
						</div>

						<div>
							<label for="co-hasil" class="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1">Hasil Pertemuan</label>
							<textarea
								id="co-hasil"
								class="w-full px-3 py-2 rounded-xl text-xs bg-slate-50/70 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
								rows="2"
								bind:value={hasilMeeting}
								placeholder="Ringkasan pembicaraan / kesepakatan..."
							></textarea>
						</div>

						<div class="p-3 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/80">
							<p class="text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-2">Status BANT (opsional)</p>
							<div class="grid grid-cols-2 gap-2">
								<div>
									<label for="co-bant-budget" class="text-[10px] text-slate-500 dark:text-slate-400 block mb-1">Budget</label>
									<select id="co-bant-budget" bind:value={bantBudget} class="w-full px-2 py-1.5 rounded-lg text-[11px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200">
										<option value="">-</option>
										{#each BANT_BUDGET_OPTS as o}<option value={o.value}>{o.label}</option>{/each}
									</select>
								</div>
								<div>
									<label for="co-bant-authority" class="text-[10px] text-slate-500 dark:text-slate-400 block mb-1">Authority</label>
									<select id="co-bant-authority" bind:value={bantAuthority} class="w-full px-2 py-1.5 rounded-lg text-[11px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200">
										<option value="">-</option>
										{#each BANT_AUTHORITY_OPTS as o}<option value={o.value}>{o.label}</option>{/each}
									</select>
								</div>
								<div>
									<label for="co-bant-need" class="text-[10px] text-slate-500 dark:text-slate-400 block mb-1">Need</label>
									<select id="co-bant-need" bind:value={bantNeed} class="w-full px-2 py-1.5 rounded-lg text-[11px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200">
										<option value="">-</option>
										{#each BANT_NEED_OPTS as o}<option value={o.value}>{o.label}</option>{/each}
									</select>
								</div>
								<div>
									<label for="co-bant-timeline" class="text-[10px] text-slate-500 dark:text-slate-400 block mb-1">Timeline</label>
									<select id="co-bant-timeline" bind:value={bantTimeline} class="w-full px-2 py-1.5 rounded-lg text-[11px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200">
										<option value="">-</option>
										{#each BANT_TIMELINE_OPTS as o}<option value={o.value}>{o.label}</option>{/each}
									</select>
								</div>
							</div>
						</div>

						<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
							<div>
								<label for="co-next-action" class="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1">
									Next Action <span class="text-rose-500">*</span>
								</label>
								<input id="co-next-action" type="text" bind:value={nextAction} placeholder="Mis. kirim penawaran" class="w-full px-3 py-2 rounded-xl text-xs bg-slate-50/70 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-400" />
							</div>
							<div>
								<label for="co-follow-date" class="text-[11px] font-semibold text-slate-600 dark:text-slate-400 block mb-1">
									Tanggal Follow-up <span class="text-rose-500">*</span>
								</label>
								<input id="co-follow-date" type="date" bind:value={followUpDate} class="w-full px-3 py-2 rounded-xl text-xs bg-slate-50/70 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900 dark:text-slate-100" />
							</div>
						</div>
					</div>
				{:else}
				<div class="flex flex-col gap-2">
					{#if prefillDariLaporan}
						<p class="text-[10px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
							<IconCheck size={12} /> Diisi otomatis dari laporan harian hari ini — sunting bila perlu.
						</p>
					{/if}
					<div class="flex flex-wrap gap-1.5">
						{#each RINGKASAN_QUICK_TAGS as tag}
							<button
								type="button"
								class="text-[11px] font-medium px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-blue-50 dark:hover:bg-blue-950/60 hover:text-blue-600 dark:hover:text-blue-400 border border-slate-200/80 dark:border-slate-700/80 text-slate-600 dark:text-slate-300 transition-all active:scale-95"
								onclick={() => addRingkasanTag(tag)}
							>
								{tag}
							</button>
						{/each}
					</div>
					<textarea
						id="co-kegiatan"
						class="w-full px-3 py-2 rounded-xl text-xs bg-slate-50/70 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
						rows="3"
						bind:value={kegiatan}
						placeholder="Ringkasan kegiatan, temuan, dan tindak lanjut di lokasi ini..."
					></textarea>
				</div>
				{/if}
			</div>

			{#if hasil === 'tersimpan'}
				<div transition:slide={{ duration: 150 }} class="rounded-xl p-3 bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-2">
					<IconAlertTriangle size={16} class="shrink-0 text-amber-600 mt-0.5" />
					<span>📱 <strong>Tersimpan di HP</strong> — sinyal lemah. Data checkout aman dan akan terkirim otomatis saat ada sinyal. Boleh tutup jendela ini.</span>
				</div>
			{/if}

			{#if errorMsg}
				<div transition:slide={{ duration: 150 }} class="rounded-xl p-3 bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs flex items-center gap-2">
					<IconAlertTriangle size={16} class="shrink-0 text-rose-600" />
					<span>{errorMsg}</span>
				</div>
			{/if}

			<!-- Paket 10 §2.4 (SVR-32) — peringatan durasi di bawah minimum, sebelum checkout. -->
			{#if durasiKurangMinimum && !sudahKonfirmasiDurasiRendah}
				<div transition:slide={{ duration: 150 }} class="rounded-xl p-3.5 bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 text-xs flex flex-col gap-2.5">
					<div class="flex items-start gap-2">
						<IconAlertTriangle size={16} class="shrink-0 text-amber-600 mt-0.5" />
						<span>
							Kunjungan baru {elapsedMenit} menit. Kunjungan di bawah {settings?.min_durasi_menit ?? 15} menit
							<strong>tidak dihitung tunjangan lokasi</strong> kecuali disetujui HRD.
						</span>
					</div>
					<div class="flex gap-2">
						<button
							type="button"
							class="flex-1 h-9 rounded-lg text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white"
							onclick={() => {
								sudahKonfirmasiDurasiRendah = true;
								handleSubmit();
							}}
						>
							Tetap Check-out
						</button>
						<button type="button" class="flex-1 h-9 rounded-lg text-xs font-bold text-amber-800 dark:text-amber-300 bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700" onclick={onClose}>
							Nanti Saja
						</button>
					</div>
				</div>
			{/if}
		</div>

		<!-- Footer Action Button -->
		<div class="p-4 sm:p-5 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
			<button
				type="button"
				class="w-full h-12 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99]"
				style="background: linear-gradient(135deg, #1E40AF 0%, #2563EB 100%)"
				disabled={!canSubmit || (durasiKurangMinimum && !sudahKonfirmasiDurasiRendah)}
				onclick={handleSubmit}
			>
				{#if submitting}
					<IconLoader2 size={18} class="animate-spin" /> Menyimpan Check-out...
				{:else}
					<IconCheck size={18} /> Selesaikan Check-out Sekarang
				{/if}
			</button>
		</div>
	</div>
</div>

{#if showCamera}
	<CameraCaptureModal onCapture={handleCapture} onClose={() => (showCamera = false)} />
{/if}

