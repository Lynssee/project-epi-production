<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { ajukanLembur } from '$lib/services/ess/lembur';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { auth } from '$lib/firebase';
	import {
		enqueueLemburSubmission,
		registerLemburAutoFlush,
		type QueuedLemburSubmission
	} from '$lib/utils/offlineLemburQueue';
	import { IconArrowLeft, IconLoader2, IconCircleCheck, IconCamera, IconX, IconCalculator, IconMapPin, IconAlertTriangle } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { SectionGuide, FieldHint, HelpIcon } from '$lib/components/hints';
	// Impor modul hint langsung (bukan barrel) — lihat catatan bundling di getHint.ts.
	import { essHints } from '$lib/data/hints/ess';
	import { getHint } from '$lib/data/hints/getHint';

	/** Pintasan pembaca hint modul ESS; memperingatkan kunci salah-ketik saat DEV. */
	const h = (key: string) => getHint(essHints, key, 'ess');

	function getTodayString() {
		const d = new Date();
		const offset = d.getTimezoneOffset();
		const localDate = new Date(d.getTime() - offset * 60 * 1000);
		return localDate.toISOString().split('T')[0];
	}

	let tanggal = $state(getTodayString());
	let jamMulai = $state('17:00');
	let jamSelesai = $state('20:00');
	let alasan = $state('');
	let buktiFile = $state<File | null>(null);
	let buktiPreview = $state<string | null>(null);
	let compressingBukti = $state(false);

	let lat = $state<number | null>(null);
	let lng = $state<number | null>(null);

	// Peta lokasi (Fase 6 open-source plan, MapLibre) — lazy-load (tombol).
	let showLocationMap = $state(false);
	let LocationMap = $state<any>(null);
	async function toggleLocationMap() {
		if (!LocationMap) LocationMap = (await import('$lib/components/shared/LocationMap.svelte')).default;
		showLocationMap = !showLocationMap;
	}
	let gettingLocation = $state(false);

	interface ProyekOption { id: number; name: string | null; nomor_po: string | null; }
	let proyekOptions = $state<ProyekOption[]>([]);
	let proyekId = $state('');

	let submitting = $state(false);
	let errorMsg = $state('');
	let success = $state(false);
	// FITUR-6 (PWA Absensi Offline): pengajuan tersimpan lokal, belum terkirim ke server.
	let queued = $state(false);

	// FITUR-2 (Smart Overtime Request): tandai jam masih nilai default supaya sugesti dari
	// absensi tidak menimpa input yang sudah diubah manual oleh karyawan.
	let jamDiubahManual = $state(false);
	let overtimeSuggestion = $state<{ tanggal: string; jamMulai: string; jamSelesai: string } | null>(null);

	// L-01 fix: estimator sebelumnya hanya cek Sabtu/Minggu — sekarang fetch kalender libur nasional
	// juga (sumber sama dengan validasi server) supaya estimasi tidak misleading di hari libur pada hari kerja.
	let holidayDates = $state<Set<string>>(new Set());

	onMount(() => {
		// Dipulihkan SINKRON di awal, sebelum fetch sugesti jam di bawah sempat selesai:
		// sugesti hanya menimpa jam kalau `jamDiubahManual` false, jadi flag dari draf
		// harus sudah terpasang lebih dulu.
		const draft = lemburPersist.restore();
		if (draft) {
			tanggal = draft.tanggal;
			jamMulai = draft.jamMulai;
			jamSelesai = draft.jamSelesai;
			alasan = draft.alasan;
			proyekId = draft.proyekId;
			jamDiubahManual = draft.jamDiubahManual;
			draftSavedAt = new Date();
			lemburPersist.restorePhoto(LEMBUR_PHOTO_KEY).then((blob) => {
				if (!blob) return;
				buktiFile = new File([blob], 'bukti.jpg', { type: blob.type || 'image/jpeg' });
				buktiPreview = URL.createObjectURL(buktiFile);
			});
		}
		draftArmed = true;

		(async () => {
			try {
				const idToken = await auth.currentUser?.getIdToken();
				if (!idToken) return;
				const res = await fetch('/api/ess/lembur/projects', { headers: { Authorization: `Bearer ${idToken}` } });
				if (res.ok) {
					const data = await res.json();
					proyekOptions = data.projects || [];
				}
			} catch (e) {
				console.warn('Gagal memuat daftar proyek:', e);
			}
		})();

		(async () => {
			try {
				const idToken = await auth.currentUser?.getIdToken();
				if (!idToken) return;
				const today = new Date();
				const start = today.toISOString().slice(0, 10);
				const future = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);
				const end = future.toISOString().slice(0, 10);
				const res = await fetch(`/api/ess/holidays?start=${start}&end=${end}`, { headers: { Authorization: `Bearer ${idToken}` } });
				if (res.ok) {
					const data = await res.json();
					holidayDates = new Set(data.dates || []);
				}
			} catch (e) {
				console.warn('Gagal memuat kalender libur:', e);
			}
		})();

		// FITUR-2 (Smart Overtime Request): sugesti jam lembur dari absensi aktual hari ini
		// (checkout melebihi jam_keluar_normal jadwal kerja) — prefill kalau karyawan belum ubah manual.
		(async () => {
			try {
				const idToken = await auth.currentUser?.getIdToken();
				if (!idToken) return;
				const res = await fetch('/api/ess/lembur/suggest', { headers: { Authorization: `Bearer ${idToken}` } });
				if (res.ok) {
					const data = await res.json();
					if (data.suggestion) {
						overtimeSuggestion = data.suggestion;
						if (!jamDiubahManual) {
							tanggal = data.suggestion.tanggal;
							jamMulai = data.suggestion.jamMulai;
							jamSelesai = data.suggestion.jamSelesai;
						}
					}
				}
			} catch (e) {
				console.warn('Gagal memuat sugesti lembur:', e);
			}
		})();

		// FITUR-6 (PWA Absensi Offline): kirim ulang pengajuan lembur yang tersimpan lokal
		// begitu koneksi kembali online.
		registerLemburAutoFlush(sendQueuedLembur);

		if ('geolocation' in navigator) {
			gettingLocation = true;
			navigator.geolocation.getCurrentPosition(
				(pos) => {
					lat = pos.coords.latitude;
					lng = pos.coords.longitude;
					gettingLocation = false;
				},
				(err) => {
					console.warn('Geolocation error:', err.message);
					gettingLocation = false;
				},
				{ enableHighAccuracy: true, timeout: 10000 }
			);
		}
	});

	function isWeekend(t: string) {
		const d = new Date(t + 'T00:00:00+07:00');
		const day = d.getDay();
		return day === 0 || day === 6;
	}

	let durasiJam = $derived.by(() => {
		if (!jamMulai || !jamSelesai) return 0;
		const [mH, mM] = jamMulai.split(':').map(Number);
		const [sH, sM] = jamSelesai.split(':').map(Number);
		// C-05 fix: shift yang melewati tengah malam (mis. 22:00-02:00) — tambahkan 1440 menit
		// ke waktu selesai supaya durasinya positif alih-alih diblokir/menghasilkan 0.
		let menit = sH * 60 + sM - (mH * 60 + mM);
		if (menit <= 0) menit += 1440;
		return Math.round((menit / 60) * 100) / 100;
	});

	let isLiburDay = $derived(isWeekend(tanggal) || holidayDates.has(tanggal));

	let jamSetara = $derived.by(() => {
		if (durasiJam <= 0) return 0;
		let total = 0;
		const rounded = Math.ceil(durasiJam);
		for (let i = 1; i <= rounded; i++) {
			const portion = i === rounded ? (durasiJam % 1 === 0 ? 1 : durasiJam % 1) : 1;
			let mult = 1.5;
			if (!isLiburDay) {
				mult = i === 1 ? 1.5 : 2.0;
			} else {
				// Pola 5 hari kerja (kanon, samakan dgn overtimeCalculator.ts server) — jam 1-8=2x, jam9=3x, jam10+=4x
				mult = i <= 8 ? 2.0 : i === 9 ? 3.0 : 4.0;
			}
			total += portion * mult;
		}
		return Math.round(total * 100) / 100;
	});

	// Jaring pengaman draf: pengajuan lembur diisi malam hari di lapangan sambil
	// memfoto bukti pekerjaan. `jamDiubahManual` ikut disimpan supaya sugesti jam dari
	// absensi tidak menimpa jam yang sudah dikoreksi manual saat draf dipulihkan.
	interface LemburDraft {
		tanggal: string;
		jamMulai: string;
		jamSelesai: string;
		alasan: string;
		proyekId: string;
		jamDiubahManual: boolean;
	}
	const LEMBUR_PHOTO_KEY = 'bukti';
	const lemburPersist = createFormPersist<LemburDraft>('ess_lembur_baru');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function lemburSnapshot(): LemburDraft {
		return { tanggal, jamMulai, jamSelesai, alasan, proyekId, jamDiubahManual };
	}

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	$effect(() => {
		void lemburSnapshot();
		if (!draftArmed) return;
		lemburPersist.save(lemburSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(lemburPersist, lemburSnapshot));

	async function handleBuktiChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		compressingBukti = true;
		errorMsg = '';
		try {
			const compressed = await compressPhoto(file);
			buktiFile = compressed;
			if (buktiPreview) URL.revokeObjectURL(buktiPreview);
			buktiPreview = URL.createObjectURL(compressed);
			await lemburPersist.savePhoto(LEMBUR_PHOTO_KEY, compressed);
		} catch (err: any) {
			console.warn('Gagal memproses foto bukti:', err);
			errorMsg = err?.message || 'Foto tidak dapat diproses. Coba ambil ulang foto dengan resolusi standar.';
			input.value = '';
		} finally {
			compressingBukti = false;
		}
	}

	function removeBukti() {
		if (buktiPreview) URL.revokeObjectURL(buktiPreview);
		buktiFile = null;
		buktiPreview = null;
		void lemburPersist.savePhoto(LEMBUR_PHOTO_KEY, new Blob([]));
	}

	// C-05 fix: jamSelesai <= jamMulai valid untuk shift lintas tengah malam — validasi durasi lewat durasiJam, bukan perbandingan jam mentah.
	let canSubmit = $derived(!!tanggal && !!jamMulai && !!jamSelesai && durasiJam > 0 && alasan.trim().length > 0 && !submitting && !compressingBukti);

	// FITUR-6 (PWA Absensi Offline): kirim ulang 1 entri antrian — dipanggil registerLemburAutoFlush.
	async function sendQueuedLembur(entry: QueuedLemburSubmission) {
		const buktiFileFromQueue = entry.buktiBlob
			? new File([entry.buktiBlob], entry.buktiName || 'bukti.jpg', { type: entry.buktiBlob.type || 'image/jpeg' })
			: null;
		await ajukanLembur({
			tanggal: entry.tanggal,
			jam_mulai: entry.jam_mulai,
			jam_selesai: entry.jam_selesai,
			alasan: entry.alasan,
			buktiFile: buktiFileFromQueue,
			latitude: entry.latitude,
			longitude: entry.longitude,
			proyek_id: entry.proyek_id
		});
	}

	async function handleSubmit() {
		if (!canSubmit) return;
		submitting = true;
		errorMsg = '';
		try {
			await ajukanLembur({
				tanggal,
				jam_mulai: jamMulai,
				jam_selesai: jamSelesai,
				alasan: alasan.trim(),
				buktiFile,
				latitude: lat,
				longitude: lng,
				proyek_id: proyekId || null
			});
			// Terkirim — draf lokal (termasuk foto bukti di IndexedDB) sudah tidak relevan.
			lemburPersist.clear();
			await lemburPersist.clearPhotos();
			draftSavedAt = null;
			success = true;
		} catch (err: any) {
			// FITUR-6 (PWA Absensi Offline): gagal jaringan (bukan error HTTP dari server, mis. lokasi
			// tanpa sinyal) -> simpan ke antrian lokal, dikirim ulang otomatis saat online kembali
			// (registerLemburAutoFlush) — sama seperti pola ess/absen (lihat offlineAttendanceQueue.ts).
			const isNetworkError = err instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(String(err?.message || ''));
			if (isNetworkError) {
				try {
					await enqueueLemburSubmission({
						client_txn_id: crypto.randomUUID(),
						tanggal,
						jam_mulai: jamMulai,
						jam_selesai: jamSelesai,
						alasan: alasan.trim(),
						buktiBlob: buktiFile,
						buktiName: buktiFile?.name || null,
						latitude: lat,
						longitude: lng,
						proyek_id: proyekId || null,
						createdAt: new Date().toISOString()
					});
					queued = true;
					// Masuk antrean offline — draf lokal juga sudah tidak relevan.
					lemburPersist.clear();
					await lemburPersist.clearPhotos();
					draftSavedAt = null;
					success = true;
				} catch (queueErr: any) {
					errorMsg = queueErr?.message || 'Gagal menyimpan pengajuan secara lokal.';
				}
				submitting = false;
				return;
			}
			errorMsg = err?.message || 'Gagal mengajukan lembur.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="w-full p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/ess/lembur')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	{#if success}
		<div class="text-center py-16">
			<IconCircleCheck size={40} style="color: {queued ? '#D97706' : '#16A34A'}; margin: 0 auto" />
			<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">
				{queued ? 'Pengajuan lembur tersimpan di perangkat' : 'Pengajuan lembur terkirim'}
			</p>
			<p class="text-[12px] mt-1" style="color: var(--sys-label3)">
				{queued ? 'Tidak ada koneksi internet — akan otomatis terkirim begitu sinyal kembali. Jangan hapus aplikasi sebelum terkirim.' : 'Menunggu persetujuan atasan.'}
			</p>
			<button class="mt-5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--p, var(--g))" onclick={() => goto('/ess/lembur')}>
				Kembali ke Riwayat Lembur
			</button>
		</div>
	{:else}
		<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Ajukan Lembur</h1>
		<DraftIndicator savedAt={draftSavedAt} hasPhotos={!!buktiFile} />
		<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Isi form berikut untuk mengajukan lembur</p>

		<SectionGuide
			id="ess.lembur.page"
			title={h('lembur.page').sectionGuide?.title}
			steps={h('lembur.page').sectionGuide?.steps ?? []}
		/>

		<div class="flex flex-col gap-4">
			<div>
				<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="tanggal">Tanggal</label>
				<input id="tanggal" type="date" class="w-full rounded-lg border text-[13px] p-3" style="border-color: var(--sys-sep)" bind:value={tanggal} />
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="jamMulai">Jam Mulai</label>
					<input id="jamMulai" type="time" class="w-full rounded-lg border text-[13px] p-3" style="border-color: var(--sys-sep)" bind:value={jamMulai} oninput={() => (jamDiubahManual = true)} />
				</div>
				<div>
					<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="jamSelesai">Jam Selesai</label>
					<input id="jamSelesai" type="time" class="w-full rounded-lg border text-[13px] p-3" style="border-color: var(--sys-sep)" bind:value={jamSelesai} oninput={() => (jamDiubahManual = true)} />
				</div>
			</div>
			<FieldHint text={h('lembur.form.jam').fieldHint} />
			{#if overtimeSuggestion && !jamDiubahManual}
				<p class="text-[11px] text-emerald-600 -mt-1 mb-3">✓ Jam otomatis terisi dari data absensi hari ini (checkout melebihi jadwal kerja). Bisa diedit manual.</p>
			{/if}

			<!-- Real-time Estimator Widget -->
			{#if durasiJam > 0}
				<div class="p-3.5 rounded-xl border bg-blue-50/50 border-blue-100 flex flex-col gap-2">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2">
							<IconCalculator size={18} class="text-blue-600" />
							<span class="text-[12px] font-bold text-blue-900 inline-flex items-center gap-1.5">
								Estimasi Kalkulasi PP 35/2021<HelpIcon text={h('lembur.form.durasi').helpIcon} position="bottom" />
							</span>
						</div>
						{#if isLiburDay}
							<span class="text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 border border-amber-200">Hari Libur / Weekend</span>
						{:else}
							<span class="text-[10px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">Hari Kerja</span>
						{/if}
					</div>
					<div class="grid grid-cols-2 gap-2 text-[11px] text-blue-800">
						<div>Durasi Aktual: <strong>{durasiJam} Jam</strong></div>
						<div>Jam Setara Upah: <strong>{jamSetara} Jam</strong></div>
					</div>
					<FieldHint text={h('lembur.form.durasi').fieldHint} />
					<p class="text-[10px] text-blue-600 italic">
						{!isLiburDay
							? `Pengali: Jam 1 @ 1.5x ${durasiJam > 1 ? `+ Sisa ${durasiJam - 1} Jam @ 2.0x` : ''}`
							: 'Pengali Akhir Pekan: 2.0x s/d 4.0x upah per jam'}
					</p>
					<p class="text-[10px] text-blue-500 italic">
						*Estimasi (termasuk hari libur nasional 60 hari ke depan). Nilai final tetap ditentukan server saat pengajuan dikirim.
					</p>
				</div>
			{/if}

			<!-- Location Status -->
			<div class="flex items-center gap-2 text-[11px]" style="color: var(--sys-label3)">
				<IconMapPin size={15} class={gettingLocation ? 'animate-pulse text-amber-500' : lat ? 'text-emerald-600' : 'text-slate-400'} />
				{#if gettingLocation}
					<span>Mengambil titik GPS lokasi...</span>
				{:else if lat && lng}
					<span class="text-emerald-700 font-medium">GPS Terdeteksi: {lat.toFixed(5)}, {lng.toFixed(5)}</span>
				{:else}
					<span>Lokasi GPS opsional</span>
				{/if}
			</div>
			{#if lat && lng}
				<button type="button" class="text-[11px] font-semibold text-emerald-700" onclick={toggleLocationMap}>
					📍 {showLocationMap ? 'Sembunyikan peta lokasi' : 'Lihat peta lokasi'}
				</button>
				{#if showLocationMap && LocationMap}
					<div transition:slide={{ duration: 200 }}>
						<LocationMap {lat} {lng} label="Lokasi pengajuan lembur" height="200px" />
					</div>
				{/if}
			{/if}

			<div>
				<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="proyek">Proyek / SPK (opsional)</label>
				<select id="proyek" class="w-full rounded-lg border text-[13px] p-3 bg-white" style="border-color: var(--sys-sep)" bind:value={proyekId}>
					<option value="">— Tidak terkait proyek tertentu —</option>
					{#each proyekOptions as p (p.id)}
						<option value={String(p.id)}>{p.name || p.nomor_po || `Proyek #${p.id}`}</option>
					{/each}
				</select>
				<FieldHint text={h('lembur.form.proyek').fieldHint} />
			</div>

			<div>
				<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="alasan">Alasan / Pekerjaan</label>
				<textarea id="alasan" class="w-full rounded-lg border text-[13px] p-3" style="border-color: var(--sys-sep)" rows="3" placeholder="Jelaskan pekerjaan yang dilembur" bind:value={alasan}></textarea>
				<FieldHint
					text={h('lembur.form.alasan').fieldHint}
					type={h('lembur.form.alasan').type}
				/>
			</div>

			<div>
				<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Bukti Foto (opsional)</p>
				{#if compressingBukti}
					<div class="w-28 h-28 rounded-lg border border-dashed flex flex-col items-center justify-center gap-1.5" style="border-color: var(--sys-sep); background: var(--sys-bg-subtle, #f8fafc)">
						<IconLoader2 size={22} class="animate-spin text-blue-600" />
						<span class="text-[10px]" style="color: var(--sys-label3)">Mengompresi...</span>
					</div>
				{:else if buktiPreview}
					<div class="relative w-28 h-28 mb-2">
						<img src={buktiPreview} alt="Preview" class="w-28 h-28 object-cover rounded-lg" />
						<button
							type="button"
							class="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-white shadow-sm"
							style="background: #DC2626"
							onclick={removeBukti}
							aria-label="Hapus foto bukti"
						>
							<IconX size={14} />
						</button>
					</div>
				{:else}
					<label class="w-28 h-28 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer" style="border-color: var(--sys-sep)">
						<IconCamera size={22} style="color: var(--sys-label4)" />
						<span class="text-[10px]" style="color: var(--sys-label4)">Ambil foto</span>
						<input type="file" accept="image/*" capture="environment" class="hidden" onchange={handleBuktiChange} />
					</label>
				{/if}
			</div>

			{#if errorMsg}
				<div class="p-3 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2 text-red-700 text-[12px]">
					<IconAlertTriangle size={18} class="shrink-0 mt-0.5 text-red-500" />
					<div>{errorMsg}</div>
				</div>
			{/if}

			<button
				class="w-full h-12 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
				style="background: var(--p, var(--g))"
				disabled={!canSubmit}
				onclick={handleSubmit}
			>
				{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
				Kirim Pengajuan
			</button>
		</div>
	{/if}
</div>

